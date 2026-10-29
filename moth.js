// Moth: a small programming language that reads like plain English.
// Source text -> tokens -> syntax tree -> bytecode (this file) -> the virtual machine (vm.js).

import { MothError, fail, makeRecord, catchable, caughtValue, COMPARISONS, COMPARE_OPS, OP, OPCODES, TURTLE_ACTIONS, BUILTINS, UNSET, Closure, Machine, execute, isRecord } from "./vm.js";
import { Scope, declarations } from "./scope.js";
import { jit, fromJs, TooDeep } from "./jit.js";
import { wasm, compileToWasmModule } from "./wasm.js";
import { check as checkProgram } from "./checker.js";

export { MothError, excerpt, describeTrail } from "./vm.js";

// ---------- tokens ----------

// Every control character counts as a space (as in Wirth's compilers), and text holds any character but a
// control character other than tab (\n makes a new line). Rules this small let the compiler written in Moth,
// which has no character codes, follow them exactly.
const TOKEN = /([\0-\x20]+)|(#[^\n]*)|(0x[\da-fA-F]+|0b[01]+|\d+(?:\.\d+)?)|([A-Za-z_]\w*)|("(?:\\[^\0-\x08\n-\x1f]|[^"\\\0-\x08\n-\x1f])*")|([-+*/(),]|'s(?!\w))/y;
const ESCAPES = { n: "\n", t: "\t" };
// symbols people type out of habit from other languages, and what Moth says instead
const HINTS = {
  "=": "to store a value write 'set x to 5', to compare write 'x is 5'",
  "!": "write 'is not'",
  "<": "write 'is less than'",
  ">": "write 'is greater than'",
  "%": "write 'is divisible by'",
  "[": "make a list with 'list of 1, 2, 3'",
  "]": "make a list with 'list of 1, 2, 3'",
  "{": "blocks finish with 'end', not braces",
  "}": "blocks finish with 'end', not braces",
  "'": "put text in double quotes",
  ".": "to get a field write 'name of person'",
};

// `file` names a file the program uses, for errors in it; the program's own file has none
function tokenize(src, file) {
  const tokens = [];
  let line = 1;
  let lineStart = 0;
  let nl = true; // does the next token start a new line?
  for (let at = 0; at < src.length; at = TOKEN.lastIndex) {
    TOKEN.lastIndex = at;
    const m = TOKEN.exec(src);
    const where = file ? { line, col: at - lineStart + 1, file } : { line, col: at - lineStart + 1 };
    if (!m) {
      const c = String.fromCodePoint(src.codePointAt(at)); // a whole emoji, not half of one
      if (c === '"') fail(where, "this text is missing its closing quote");
      fail(where, `I don't understand '${c}'${Object.hasOwn(HINTS, c) ? ` (${HINTS[c]})` : ""}`);
    }
    const [text, space, comment, number, word, string] = m;
    if (space || comment) {
      const newlines = text.split("\n").length - 1;
      if (newlines) {
        line += newlines;
        lineStart = at + text.lastIndexOf("\n") + 1;
        nl = true;
      }
      continue;
    }
    const [type, value] = number
      ? ["number", Number(number)]
      : word
        ? ["word", word.toLowerCase()]
        : string
          ? ["string", string.slice(1, -1).replace(/\\(.)/gs, (_, c) => ESCAPES[c] ?? c)]
          : [text, text];
    const token = { type, value, ...where, nl };
    if (number) token.text = number; // as written, for messages and the JIT
    tokens.push(token);
    nl = false;
  }
  tokens.push({ type: "eof", value: "", line, col: src.length - lineStart + 1, nl: true, ...(file && { file }) });
  return tokens;
}

// ---------- syntax tree ----------

// words that start a statement or a value, so they can't name a variable
const RESERVED = new Set([
  "set", "add", "say", "if", "else", "end", "repeat", "while", "for", "to", "return", "and", "or", "not", "is", "yes", "no",
  "nothing", "list", "empty", "length", "item", "move", "turn", "pen", "record", "fail", "stop",
  "uppercase", "lowercase", "split", "join", "number", "position", "ask", "use", "try", "dictionary", "remove", "keys", "in",
  "byte", "bytes", "as", "shift", "read", "write", "arguments", "expect"]);
// built-in operations (BUILTINS in vm.js), by the word that starts them: the word after it, if any, then
// either one input, or two with a word between them: `uppercase of x`, `split x by ","`, `position of "a" in x`
const BUILTIN_SYNTAX = new Map([["uppercase", ["of"]], ["lowercase", ["of"]], ["number", ["of"]], ["split", [null, "by"]],
  ["join", [null, "with"]], ["position", ["of", "in"]], ["keys", ["of"]]]);
// `a bit and b`, `a bit or b`, `a bit xor b`; `bit` alone is still a name
const BIT_WORDS = ["and", "or", "xor"];
// what `as` turns a value into: `block as text`, `"hi" as bytes`, `255 as hex`
const AS_WORDS = ["bytes", "text", "hex", "binary"];
// drawing: `move forward 10`, `turn left 90`, `pen up`, `pen color "red"`
const TURTLE_WORDS = new Map([["move", ["forward", "back"]], ["turn", ["left", "right"]], ["pen", ["up", "down", "color", "width"]]]);

// Every node keeps the token it came from (`at`), so errors can point at it. `reading` is shared with the
// files the program uses: `files` gives a file's text by name, `loaded` is every file read so far (each is read
// once), and `open` the files being read right now, to catch two that use each other.
function parse(tokens, reading = { loaded: new Set(), open: [] }) {
  let pos = 0;
  let atTop = false; // directly in the program, not in a block or a function
  let fnDepth = 0;
  let loopDepth = 0; // loops around this spot, in this function: `stop` needs one
  let indexing = false; // inside `item ... of`, where a name followed by `of` is the item number, not a field
  const peek = () => tokens[pos];
  const check = (type) => tokens[pos].type === type;
  const match = (type) => check(type) && tokens[pos++];
  const isWord = (w) => check("word") && tokens[pos].value === w;
  const word = (w) => isWord(w) && tokens[pos++];
  const describe = (t) => (t.type === "eof" ? "the end of the code" : t.type === "string" ? `"${t.value}"` : `'${t.text ?? t.value}'`);
  const expected = (what) => fail(peek(), `expected ${what} but found ${describe(peek())}`);
  const expectWord = (w) => word(w) || expected(`'${w}'`);

  function name(what) {
    const t = peek();
    if (t.type !== "word") expected(what);
    if (RESERVED.has(t.value)) fail(t, `'${t.value}' is a Moth word, so it can't be used as ${what}`);
    pos++;
    return t.value;
  }

  // the line that starts a `try`'s handler: `if it fails`
  const isIfItFails = () => isWord("if") && tokens[pos + 1].type === "word" && tokens[pos + 1].value === "it"
    && tokens[pos + 2]?.type === "word" && tokens[pos + 2].value === "fails";

  // `inTry`: the statements of a `try`, which also end at its `if it fails`
  function statements(opener, inTry = false) {
    const body = [];
    const outside = atTop;
    atTop = !opener;
    while (opener ? !isWord("end") && !isWord("else") && !(inTry && isIfItFails()) : !check("eof")) {
      if (check("eof")) fail(peek(), `'${opener.value}' from line ${opener.line} is missing its 'end'`);
      const s = statement();
      if (s.kind === "use") body.push(...s.body); // the file's code, in its place
      else body.push(s);
      if (!peek().nl) expected("a new line");
    }
    atTop = outside;
    return body;
  }

  // The statements of a file the program uses, or none if it was read already. Used `as` a name, its own
  // names are kept apart (see prefixed), and it can be used again as another.
  function useFile(nameToken, alias) {
    const name = nameToken.value;
    const key = alias ? `${name} as ${alias}` : name;
    if (reading.open.includes(name)) fail(nameToken, `'${name}' is already being read, so it can't be used here: files can't use each other in a circle`);
    if (reading.loaded.has(key)) return [];
    const text = reading.files?.(name);
    if (typeof text !== "string") fail(nameToken, `there is no file called '${name}'`);
    reading.loaded.add(key);
    reading.open.push(name);
    const body = parse(tokenize(text, name), reading);
    reading.open.pop();
    return alias ? prefixed(body, alias) : body;
  }

  // `math's sine`: a name the file used `as math` makes
  const member = (first) => (match("'s") ? `${first}'s ${name("a name")}` : first);

  function block(opener) {
    if (!peek().nl) expected("a new line");
    return statements(opener);
  }

  function loopBody(opener) {
    loopDepth++;
    const body = blockEnd(opener);
    loopDepth--;
    return body;
  }

  function blockEnd(opener) {
    const body = block(opener);
    expectWord("end");
    return body;
  }

  function statement() {
    const t = peek();
    if (word("set")) {
      if (isWord("item") || isWord("byte")) {
        const target = primary();
        expectWord("to");
        return { kind: "setItem", target, value: expression(), at: t };
      }
      const variable = name("a variable name");
      if (word("of")) { // `set name of person to ...` changes a field
        const target = unary();
        expectWord("to");
        return { kind: "setField", name: variable, target, value: expression(), at: t };
      }
      expectWord("to");
      return { kind: "set", name: variable, value: expression(), at: t };
    }
    if (word("add")) {
      const value = expression();
      expectWord("to");
      return { kind: "add", value, name: name("a variable name"), at: t };
    }
    if (word("say")) {
      const parts = [expression()];
      while (!peek().nl) parts.push(expression());
      return { kind: "say", parts, at: t };
    }
    if (word("if")) return ifRest(t);
    if (word("repeat")) {
      if (word("while")) return { kind: "while", cond: expression(), body: loopBody(t), at: t };
      const count = expression();
      expectWord("times");
      return { kind: "repeat", count, body: loopBody(t), at: t };
    }
    if (word("for")) {
      expectWord("each");
      const variable = name("a variable name");
      if (word("from")) {
        const from = expression();
        expectWord("to");
        return { kind: "count", name: variable, from, to: expression(), body: loopBody(t), at: t };
      }
      if (!word("in")) expected("'in' or 'from'");
      return { kind: "each", name: variable, list: expression(), body: loopBody(t), at: t };
    }
    if (word("to")) {
      const fnName = name("a function name");
      const params = [];
      if (word("with")) do params.push(name("an input name")); while (match(",") || word("and"));
      const outside = loopDepth; // a function's body starts outside any loop
      fnDepth++;
      loopDepth = 0;
      const body = blockEnd(t);
      fnDepth--;
      loopDepth = outside;
      return { kind: "define", name: fnName, params, body, at: t };
    }
    if (word("return")) {
      if (!fnDepth) fail(t, "'return' only works inside a function (one made with 'to')");
      return { kind: "return", value: peek().nl ? null : expression(), at: t };
    }
    if (word("fail")) {
      expectWord("with");
      return { kind: "fail", value: expression(), at: t };
    }
    if (word("try")) {
      if (!peek().nl) expected("a new line");
      const body = statements(t, true);
      if (!isIfItFails()) expected("'if it fails'");
      pos += 3;
      const caught = word("with") ? name("a variable name") : null;
      return { kind: "try", body, name: caught, handler: blockEnd(t), at: t };
    }
    if (word("use")) {
      const nameToken = match("string") || expected("a file name in quotes, like \"shapes.moth\"");
      const alias = word("as") ? name("a name for the file") : null; // `use "math.moth" as math`
      if (!atTop) fail(t, "'use' only works at the top level of a program");
      return { kind: "use", body: useFile(nameToken, alias), at: t };
    }
    if (word("stop")) {
      if (!loopDepth) fail(t, "'stop' only works inside a loop (one made with 'repeat' or 'for each')");
      return { kind: "stop", at: t };
    }
    if (word("remove")) { // `remove "Sam" from ages`
      const key = additive();
      expectWord("from");
      return { kind: "remove", key, target: unary(), at: t };
    }
    if (word("expect")) return { kind: "expect", cond: expression(), at: t }; // `expect total(2, 3) is 5`
    if (word("write")) { // `write "hello" to "notes.txt"`: the file's name is its target
      const value = expression();
      expectWord("to");
      return { kind: "write", value, target: expression(), at: t };
    }
    const turtle = t.type === "word" && TURTLE_WORDS.get(t.value);
    if (turtle) {
      pos++;
      const action = turtle.find(isWord);
      if (!action) expected(turtle.map((w) => `'${w}'`).join(" or "));
      pos++;
      return { kind: "turtle", action, value: action === "up" || action === "down" ? null : expression(), at: t };
    }
    if (t.type === "word" && !RESERVED.has(t.value)) {
      // a line that starts with a name calls it: `greet "Sam"` or `greet("Sam")`
      pos++;
      const called = member(t.value);
      if (isWord("is")) fail(t, `to give '${called}' a value write 'set ${called} to ...'`);
      let args = [];
      if (match("(")) args = argList();
      else if (!peek().nl) do args.push(expression()); while (match(","));
      return { kind: "call", name: called, args, at: t };
    }
    fail(t, `a line can't start with ${describe(t)}`);
  }

  function ifRest(t) {
    const cond = expression();
    const then = block(t);
    let otherwise = [];
    if (word("else")) {
      const elseIf = word("if");
      if (elseIf) return { kind: "if", cond, then, otherwise: [ifRest(elseIf)], at: t };
      otherwise = block(t);
    }
    expectWord("end");
    return { kind: "if", cond, then, otherwise, at: t };
  }

  function expression() {
    let left = and();
    for (let t; (t = word("or")); ) left = { kind: "or", left, right: and(), at: t };
    return left;
  }

  function and() {
    let left = not();
    for (let t; (t = word("and")); ) left = { kind: "and", left, right: not(), at: t };
    return left;
  }

  function not() {
    const t = word("not");
    return t ? { kind: "not", operand: not(), at: t } : comparison();
  }

  function comparison() {
    const left = bitwise();
    const t = word("is");
    if (!t) return left;
    const negate = Boolean(word("not"));
    const phrase = check("word") && tokens[pos + 1].type === "word" ? `${peek().value} ${tokens[pos + 1].value}` : "";
    const op = Object.hasOwn(COMPARISONS, phrase) ? ((pos += 2), phrase) : word("in") ? "in" : "is";
    return { kind: "compare", op, negate, left, right: bitwise(), at: t };
  }

  function bitwise() {
    let left = additive();
    while (isWord("bit") && tokens[pos + 1].type === "word" && BIT_WORDS.includes(tokens[pos + 1].value)) {
      const t = peek();
      const name = `bit ${tokens[pos + 1].value}`;
      pos += 2;
      left = { kind: "builtin", name, args: [left, additive()], at: t };
    }
    return left;
  }

  function additive() {
    let left = multiplicative();
    for (let t; (t = match("+") || match("-")); ) left = { kind: "math", op: t.type, left, right: multiplicative(), at: t };
    return left;
  }

  function multiplicative() {
    let left = postfix(unary());
    for (let t; (t = match("*") || match("/")); ) left = { kind: "math", op: t.type, left, right: postfix(unary()), at: t };
    return left;
  }

  // `100 bytes`, `block as text`
  function postfix(e) {
    for (;;) {
      const t = peek();
      if (word("bytes")) e = { kind: "builtin", name: "bytes", args: [e], at: t };
      else if (word("as")) {
        const to = AS_WORDS.find(isWord) ?? expected(AS_WORDS.map((w) => `'${w}'`).join(" or "));
        pos++;
        e = { kind: "builtin", name: `as ${to}`, args: [e], at: t };
      } else return e;
    }
  }

  function unary() {
    const t = match("-");
    return t ? { kind: "negate", operand: unary(), at: t } : primary();
  }

  function primary() {
    const t = peek();
    if (match("number") || match("string")) return { kind: "value", value: t.value, at: t };
    if (word("yes") || word("no")) return { kind: "value", value: t.value === "yes", at: t };
    if (word("nothing")) return { kind: "value", value: null, at: t };
    if (word("list")) {
      expectWord("of");
      const items = [];
      do items.push(expression()); while (match(","));
      return { kind: "list", items, at: t };
    }
    if (word("record")) {
      expectWord("with");
      const [fields, values] = [[], []];
      do {
        fields.push(name("a field name"));
        values.push(expression());
      } while (match(","));
      return { kind: "record", fields, values, at: t };
    }
    if (word("dictionary")) { // `dictionary where "Sam" is 20, "Ana" is 31`: its items are each key, then its value
      expectWord("where");
      const items = [];
      do {
        items.push(additive());
        expectWord("is");
        items.push(expression());
      } while (match(","));
      return { kind: "dictionary", items, at: t };
    }
    if (word("empty")) {
      if (word("record")) return { kind: "record", fields: [], values: [], at: t };
      if (word("dictionary")) return { kind: "dictionary", items: [], at: t };
      if (!word("list")) expected("'list', 'record' or 'dictionary'");
      return { kind: "list", items: [], at: t };
    }
    if (word("length")) {
      expectWord("of");
      return { kind: "length", of: unary(), at: t };
    }
    if (word("ask")) return { kind: "ask", question: additive(), at: t }; // `ask "How old are you? "`
    if (word("read")) { // `read "notes.txt"`, `read bytes "photo.png"`: `of` is the file's name
      const bytes = Boolean(word("bytes"));
      return { kind: "read", bytes, of: additive(), at: t };
    }
    if (word("arguments")) return { kind: "arguments", at: t }; // what the program was started with: `moth run tool.moth a b`
    const syntax = t.type === "word" && BUILTIN_SYNTAX.get(t.value);
    if (syntax) {
      pos++;
      if (syntax[0]) expectWord(syntax[0]);
      if (syntax.length === 1) return { kind: "builtin", name: t.value, args: [unary()], at: t };
      const first = additive();
      expectWord(syntax[1]);
      return { kind: "builtin", name: t.value, args: [first, additive()], at: t };
    }
    if (word("shift")) { // `shift x left by 2`
      const value = additive();
      const way = ["left", "right"].find(isWord) ?? expected("'left' or 'right'");
      pos++;
      expectWord("by");
      return { kind: "builtin", name: `shift ${way}`, args: [value, additive()], at: t };
    }
    if (word("item") || word("byte")) { // `byte 5 of block` is another way to say `item 5 of block`
      const outside = indexing;
      indexing = true;
      const index = additive();
      indexing = outside;
      expectWord("of");
      return { kind: "item", index, of: unary(), at: t };
    }
    if (match("(")) {
      const outside = indexing;
      indexing = false;
      const inner = expression();
      indexing = outside;
      if (!match(")")) expected("')'");
      return inner;
    }
    if (t.type === "word" && !RESERVED.has(t.value)) {
      pos++;
      const full = member(t.value);
      if (match("(")) return { kind: "call", name: full, args: argList(), at: t };
      if (full === t.value && !indexing && word("of")) return { kind: "field", name: t.value, of: unary(), at: t }; // `name of person`
      return { kind: "name", name: full, at: t };
    }
    expected("a value");
  }

  function argList() {
    const outside = indexing;
    indexing = false;
    const args = [];
    while (!check(")")) {
      args.push(expression());
      if (!match(",")) break;
    }
    if (!match(")")) expected("')'");
    indexing = outside;
    return args;
  }

  return statements(null);
}

// `use "math.moth" as math`: each name the file's top level makes becomes `math's pi`, `math's sine`, which
// no name in the program can be, so the two can't clash. The file's code is then the program's, as with any
// `use`. A name is renamed only where it means the top level's: not where an input of a function, or a
// function that a function makes, has the same name.
const NAMED = new Set(["set", "add", "count", "each", "define", "call", "name", "try"]); // nodes whose `name` is a variable
function prefixed(body, alias) {
  const { own, shared } = declarations(body);
  const top = new Set([...own, ...shared]);
  const walk = (node, hidden) => {
    if (NAMED.has(node.kind) && top.has(node.name) && !hidden.has(node.name)) node.name = `${alias}'s ${node.name}`;
    const inside = node.kind === "define" ? new Set([...hidden, ...node.params, ...declarations(node.body).own]) : hidden;
    for (const [key, child] of Object.entries(node)) {
      if (key !== "at") for (const c of Array.isArray(child) ? child : [child]) if (c?.kind) walk(c, key === "body" ? inside : hidden);
    }
  };
  for (const s of body) walk(s, new Set());
  return body;
}

// ---------- bytecode compiler ----------

const { GET, SET, CONST, JUMP, JUMP_IF_FALSE, COMPARE, ADD, SUB, MUL, DIV, CALL, GET_FN, RETURN, POP, AND, OR, NEG, NOT,
  LIST, LENGTH, ITEM, ITEM_REF, SET_ITEM, ADD_TO, SAY, CHECK_REPEAT, REPEAT_NEXT, CHECK_RANGE, RANGE_NEXT, ITER, ITER_NEXT,
  MAKE_FN, UNDEFINED, HALT, LINE, TURTLE, RECORD, FIELD, RECORD_REF, SET_FIELD, FAIL, BUILTIN, ASK, TRY, END_TRY, CAUGHT, DICT, REMOVE, READ, WRITE, ARGUMENTS, EXPECT } = OP;
const MATH_OPS = { "+": ADD, "-": SUB, "*": MUL, "/": DIV };
const LOOPS = new Set(["while", "repeat", "count", "each"]);

// Compiles one function (or the whole program) to bytecode for vm.js. Scope (scope.js) has already given
// every variable a slot, so a name becomes a (depth, slot) pair here.
class Compiler extends Scope {
  constructor(parent, name, params, body, options) {
    super(parent, name, params, body, options);
    Object.assign(this.fn, { code: [], consts: [], at: [] });
    this.loops = []; // the loops being compiled, innermost last: how much each keeps on the stack, and its stops
    this.tries = 0; // `try`s around the code being compiled, in this function
    for (const s of body) this.statement(s);
    if (parent) this.emit(null, CONST, this.constant(null), RETURN);
    else this.emit(null, HALT);
  }

  // In a debug build, the machine can pause here: a statement on this line is about to run.
  mark(s) {
    if (this.debug && !s.at.file) this.emit(s.at, LINE, s.at.line); // the debugger steps through this file, not the ones it uses
  }

  emit(at, ...code) {
    this.fn.at[this.fn.code.length] = at;
    this.fn.code.push(...code);
  }

  constant(value) {
    return this.fn.consts.push(value) - 1;
  }

  here() {
    return this.fn.code.length;
  }

  jump(at, op, to = -1) {
    this.emit(at, op, to);
    return this.here() - 1; // where the target goes, for patch()
  }

  patch(i) {
    this.fn.code[i] = this.here();
  }

  // A name nothing ever sets: fail when this line runs (with any "did you mean" from Scope).
  undefinedName(name, at, options) {
    this.emit(at, UNDEFINED, this.constant(this.undefinedMessage(name, options)));
  }

  load(name, at) {
    const found = this.resolve(name);
    if (found) this.emit(at, GET, ...found, this.constant(name));
    else this.undefinedName(name, at);
  }

  store(name, at) {
    this.emit(at, SET, ...this.resolve(name)); // always found: declarations() saw every name that is stored
  }

  // `state` is how many values the loop keeps on the stack while it runs, which a `stop` takes off
  loop(s, next, state) {
    const top = this.here();
    const exit = this.jump(s.at, next);
    if (s.name) this.store(s.name, s.at);
    this.mark(s); // every round pauses on the loop's line, after the loop variable has its new value
    this.body(s.body, state);
    this.jump(s.at, JUMP, top);
    this.patch(exit);
    this.patchStops();
  }

  body(statements, state) {
    this.loops.push({ state, stops: [], tries: this.tries });
    for (const inner of statements) this.statement(inner);
  }

  patchStops() {
    for (const i of this.loops.pop().stops) this.patch(i);
  }

  call(e, statement = false) {
    const found = this.resolve(e.name);
    if (found) this.emit(e.at, GET_FN, ...found, this.constant(e.name));
    else this.undefinedName(e.name, e.at, { call: true, statement });
    for (const arg of e.args) this.expr(arg);
    this.emit(e.at, CALL, e.args.length, this.constant(e.name));
  }

  statement(s) {
    if (!LOOPS.has(s.kind)) this.mark(s); // loops mark each round instead
    switch (s.kind) {
      case "set":
        this.expr(s.value);
        this.store(s.name, s.at);
        return;
      case "setItem":
        this.expr(s.target.of);
        this.expr(s.target.index);
        this.emit(s.target.at, ITEM_REF);
        this.expr(s.value);
        this.emit(s.target.at, SET_ITEM); // fails if the value can't go there, like 300 in a byte
        return;
      case "add": {
        this.expr(s.value);
        const found = this.resolve(s.name);
        if (found) this.emit(s.at, ADD_TO, ...found, this.constant(s.name));
        else this.undefinedName(s.name, s.at);
        return;
      }
      case "say":
        for (const part of s.parts) this.expr(part);
        this.emit(s.at, SAY, s.parts.length);
        return;
      case "if": {
        this.expr(s.cond);
        const toElse = this.jump(s.at, JUMP_IF_FALSE);
        for (const inner of s.then) this.statement(inner);
        const toEnd = this.jump(s.at, JUMP);
        this.patch(toElse);
        for (const inner of s.otherwise) this.statement(inner);
        this.patch(toEnd);
        return;
      }
      case "while": {
        const top = this.here();
        this.mark(s);
        this.expr(s.cond);
        const exit = this.jump(s.at, JUMP_IF_FALSE);
        this.body(s.body, 0);
        this.jump(s.at, JUMP, top);
        this.patch(exit);
        this.patchStops();
        return;
      }
      case "repeat":
        this.expr(s.count);
        this.emit(s.at, CHECK_REPEAT);
        this.loop(s, REPEAT_NEXT, 1);
        return;
      case "count":
        this.expr(s.from);
        this.expr(s.to);
        this.emit(s.at, CHECK_RANGE);
        this.loop(s, RANGE_NEXT, 2);
        return;
      case "each":
        this.expr(s.list);
        this.emit(s.at, ITER);
        this.loop(s, ITER_NEXT, 1);
        return;
      case "define": {
        const fn = new Compiler(this, s.name, s.params, s.body).fn;
        this.emit(s.at, MAKE_FN, this.constant(fn));
        this.store(s.name, s.at);
        return;
      }
      case "return":
        if (s.value) this.expr(s.value);
        else this.emit(s.at, CONST, this.constant(null));
        this.emit(s.at, RETURN);
        return;
      case "call":
        this.call(s, true);
        this.emit(s.at, POP);
        return;
      case "turtle":
        if (s.value) this.expr(s.value);
        this.emit(s.at, TURTLE, TURTLE_ACTIONS.indexOf(s.action));
        return;
      case "setField": // the record is checked before the value is worked out, as `set item` does
        this.expr(s.target);
        this.emit(s.at, RECORD_REF, this.constant(s.name));
        this.expr(s.value);
        this.emit(s.at, SET_FIELD, this.constant(s.name));
        return;
      case "fail":
        this.expr(s.value);
        this.emit(s.at, FAIL);
        return;
      case "remove":
        this.expr(s.key);
        this.expr(s.target);
        this.emit(s.at, REMOVE);
        return;
      case "write":
        this.expr(s.value);
        this.expr(s.target);
        this.emit(s.at, WRITE);
        return;
      case "expect": // a comparison keeps both its sides, to say what they were
        if (s.cond.kind === "compare") {
          this.expr(s.cond.left);
          this.expr(s.cond.right);
          this.emit(s.at, EXPECT, COMPARE_OPS.indexOf(s.cond.op), s.cond.negate ? 1 : 0);
        } else {
          this.expr(s.cond);
          this.emit(s.at, EXPECT, -1, 0);
        }
        return;
      case "try": {
        const handler = this.jump(s.at, TRY);
        this.tries++;
        for (const inner of s.body) this.statement(inner);
        this.tries--;
        this.emit(s.at, END_TRY);
        const end = this.jump(s.at, JUMP);
        this.patch(handler);
        this.emit(s.at, CAUGHT);
        if (s.name) this.store(s.name, s.at);
        else this.emit(s.at, POP);
        for (const inner of s.handler) this.statement(inner);
        this.patch(end);
        return;
      }
      case "stop": { // leave the tries inside the loop, take its own values off the stack, and jump to its end
        const loop = this.loops.at(-1);
        for (let i = loop.tries; i < this.tries; i++) this.emit(s.at, END_TRY);
        for (let i = 0; i < loop.state; i++) this.emit(s.at, POP);
        loop.stops.push(this.jump(s.at, JUMP));
        return;
      }
    }
  }

  expr(e) {
    switch (e.kind) {
      case "value":
        this.emit(e.at, CONST, this.constant(e.value));
        return;
      case "name":
        this.load(e.name, e.at);
        return;
      case "call":
        this.call(e);
        return;
      case "math":
        this.expr(e.left);
        this.expr(e.right);
        this.emit(e.at, MATH_OPS[e.op]);
        return;
      case "compare":
        this.expr(e.left);
        this.expr(e.right);
        this.emit(e.at, COMPARE, COMPARE_OPS.indexOf(e.op));
        if (e.negate) this.emit(e.at, NOT);
        return;
      case "and":
      case "or": {
        this.expr(e.left);
        const end = this.jump(e.at, e.kind === "and" ? AND : OR);
        this.expr(e.right);
        this.patch(end);
        return;
      }
      case "not":
        this.expr(e.operand);
        this.emit(e.at, NOT);
        return;
      case "negate":
        this.expr(e.operand);
        this.emit(e.at, NEG);
        return;
      case "list":
        for (const item of e.items) this.expr(item);
        this.emit(e.at, LIST, e.items.length);
        return;
      case "length":
        this.expr(e.of);
        this.emit(e.at, LENGTH);
        return;
      case "item":
        this.expr(e.of);
        this.expr(e.index);
        this.emit(e.at, ITEM);
        return;
      case "record":
        for (const value of e.values) this.expr(value);
        this.emit(e.at, RECORD, this.constant(e.fields));
        return;
      case "dictionary":
        for (const x of e.items) this.expr(x);
        this.emit(e.at, DICT, e.items.length);
        return;
      case "field":
        this.expr(e.of);
        this.emit(e.at, FIELD, this.constant(e.name));
        return;
      case "ask":
        this.expr(e.question);
        this.emit(e.at, ASK);
        return;
      case "read":
        this.expr(e.of);
        this.emit(e.at, READ, e.bytes ? 1 : 0);
        return;
      case "arguments":
        this.emit(e.at, ARGUMENTS);
        return;
      case "builtin":
        for (const arg of e.args) this.expr(arg);
        this.emit(e.at, BUILTIN, BUILTINS.findIndex((b) => b.name === e.name));
        return;
    }
  }
}

// ---------- reading bytecode ----------

const shown = (v) => (v === null ? "nothing" : typeof v === "boolean" ? (v ? "yes" : "no") : JSON.stringify(v));

// What an instruction's operands mean, where a number alone wouldn't say.
function note(fn, op, args, scopes) {
  switch (op) {
    case "SET": return scopes.at(-1 - args[0]).names[args[1]];
    case "LINE": return `line ${args[0]}`;
    case "CONST": return shown(fn.consts[args[0]]);
    case "MAKE_FN": return `function ${fn.consts[args[0]].name}`;
    case "GET": case "GET_FN": case "ADD_TO": return fn.consts[args[2]];
    case "CALL": return fn.consts[args[1]];
    case "UNDEFINED": return fn.consts[args[0]];
    case "COMPARE": return args[0] ? `is ${COMPARE_OPS[args[0]]}` : "is";
    case "RECORD": return fn.consts[args[0]].join(", ");
    case "FIELD": case "RECORD_REF": case "SET_FIELD": return fn.consts[args[0]];
    case "BUILTIN": return BUILTINS[args[0]].name;
    default: return "";
  }
}

// Bytecode as readable text, for `moth bytecode` and the playground.
export function disassemble(fn, scopes = [fn], out = []) {
  out.push(`${fn.name}${fn.params.length ? ` with ${fn.params.join(", ")}` : ""}:`);
  for (let i = 0; i < fn.code.length; ) {
    const [op, count] = OPCODES[fn.code[i]];
    const args = fn.code.slice(i + 1, i + 1 + count);
    const why = note(fn, op, args, scopes);
    out.push(`  ${String(i).padStart(4)}  ${op.padEnd(13)} ${args.join(" ").padEnd(8)}${why ? ` ; ${why}` : ""}`.trimEnd());
    i += 1 + count;
  }
  for (const c of fn.consts) if (c?.code) disassemble(c, [...scopes, c], out); // functions made inside this one
  return out.join("\n");
}

// ---------- running ----------

// Parses the source and hands the syntax tree to a back end.
// `files` gives the text of a file the program uses, by name, and `file` is the program's own name, if it has one.
function build(source, backEnd, { files, file } = {}) {
  try {
    return backEnd(parse(tokenize(source), { files, loaded: new Set(file ? [file] : []), open: file ? [file] : [] }));
  } catch (err) {
    // shortcut: points at line 1, since the overflow hides where the nesting was; only ~1,000 levels of brackets get here
    if (err instanceof RangeError) fail({ line: 1, col: 1 }, "the code is nested too deeply");
    throw err;
  }
}

// Compiles Moth source to bytecode for vm.js. Options: `slots` carries over the top-level variables of
// earlier shell entries; `debug` adds LINE markers so a debugger can pause at each statement.
export function compile(source, options) {
  return build(source, (program) => new Compiler(null, "main", [], program, options).fn, options);
}

// Compiles Moth source to JavaScript (jit.js): { source, run(print, draw, maxSteps) }.
export function compileToJs(source, options) {
  return build(source, jit, options);
}

// Compiles Moth source to a WebAssembly module (wasm.js): { bytes, listing, run(print, draw, maxSteps) }.
export function compileToWasm(source, options) {
  return build(source, wasm, options);
}

// The same module's bytes and a readable listing, without compiling it (which a browser page may only do
// for small modules unless it waits): { bytes, listing }.
export function compileToWasmBytes(source, options) {
  return build(source, compileToWasmModule, options);
}

// Problems found without running the program (checker.js): [{ line, col, kind, message }]. Code that
// can't even be read comes back as a single problem of kind "error".
export function check(source, options) {
  try {
    return build(source, checkProgram, options);
  } catch (err) {
    if (!(err instanceof MothError)) throw err;
    return [{ line: err.line, col: err.col, kind: "error", message: err.reason, ...(err.file && { file: err.file }) }];
  }
}

// Runs a Moth program. Each `say` line goes to `print`, each line the turtle draws to `draw`, and each
// `ask` to `ask`, which returns the answer (see askFor in vm.js); mistakes in the program throw MothError.
// `maxSteps` stops loops and calls after that many rounds, for running untrusted code without a Stop button.
// `engine` is "jit" (compile to JavaScript), "wasm" (WebAssembly) or "vm" (bytecode). `files` and `file` are
// for `use` (see build). `disk` holds the files `read` and `write` use (see readFile in vm.js, and memoryDisk
// below), and `args` is what `arguments` gives.
export function run(source, print = console.log, { maxSteps = Infinity, draw, engine = "jit", ask, files, file, disk, args = [] } = {}) {
  const reading = { files, file };
  // What the program got from outside, in order: each answer, each file it read, and how each write went.
  // Kept, so that running it again (below) gets the same, and writes nothing twice.
  const outside = [];
  const kept = (f) => (...inputs) => {
    try {
      const got = f(...inputs);
      outside.push({ got: copy(got) });
      return got;
    } catch (err) {
      outside.push({ err });
      throw err;
    }
  };
  const answer = ask && kept(ask);
  const drive = disk && { read: kept((name, asBytes) => disk.read(name, asBytes)), write: kept((name, data) => disk.write(name, data)) };
  let program = null;
  if (engine !== "vm") {
    try {
      program = engine === "wasm" ? compileToWasm(source, reading) : compileToJs(source, reading);
    } catch (err) {
      if (!(err instanceof EvalError)) throw err; // a page whose security policy forbids making code from text
    }
  }
  if (!program) return new Machine(compile(source, reading), print, { maxSteps, draw, ask: answer, disk: drive, args }).run();
  let said = 0;
  let drawn = 0;
  try {
    // counted once passed on, so a hand-over in the middle of passing one on can't lose it
    program.run((line) => (print(line), said++), (line) => (draw?.(line), drawn++), maxSteps, answer, drive, args);
  } catch (err) {
    if (!(err instanceof TooDeep || err instanceof RangeError || err?.name === "InternalError")) throw err;
    // Calls went deeper than the JIT (or the WebAssembly engine) goes, or the stack ran out anyway, or a value outgrew what
    // JavaScript allows. Moth programs can't read the clock, and get the same answers and files again, so a
    // second run says and draws exactly the same things: run it again on the VM, which keeps its own stack and
    // reports a too-big value at the right line, and pass on only what the first run hadn't already.
    let next = 0;
    const again = (f) => f && ((...inputs) => {
      if (next >= outside.length) return f(...inputs);
      const before = outside[next++];
      if ("err" in before) throw before.err;
      return copy(before.got);
    });
    new Machine(compile(source, reading), (line) => said-- > 0 || print(line), {
      maxSteps, draw: (line) => drawn-- > 0 || draw?.(line), ask: again(answer), disk: drive && { read: again(drive.read), write: again(drive.write) }, args,
    }).run();
  }
}
const copy = (v) => (v instanceof Uint8Array ? v.slice() : v); // bytes a program read could be changed after

// Runs a file's tests: each function at its top level named test_something, on its own, in a fresh run of
// the file, so one test can't spoil another. A mistake in it, like an `expect` that isn't so, fails it. A
// file with no tests is one test itself. Gives [{ name, said, error }], `error` only for a test that failed,
// whose trail leaves out the call that started the test. Options as for run(); a file that can't be read
// at all throws, as in run().
export function test(source, options = {}) {
  const program = build(source, (body) => body, options);
  const names = program.filter((s) => s.kind === "define" && s.name.startsWith("test_")).map((s) => s.name);
  const last = source.split("\n").length; // the call that starts a test goes on the line after this one
  const one = (name) => {
    const said = [];
    try {
      run(name ? `${source}\n${name}()` : source, (line) => said.push(line), options);
      return { name, said };
    } catch (err) {
      if (!(err instanceof MothError)) throw err;
      err.trail = err.trail.filter((t) => t.file || t.line <= last);
      return { name, said, error: err };
    }
  };
  return names.length ? names.map(one) : [one(null)];
}

// Files kept in memory, for a page or a test: `start` gives the first ones, by name, as text or bytes.
export function memoryDisk(start = {}) {
  const files = new Map(Object.entries(start));
  return {
    files,
    read: (name, asBytes) => {
      if (!files.has(name)) return null;
      const data = files.get(name);
      if (asBytes) return typeof data === "string" ? new TextEncoder().encode(data) : data.slice();
      return typeof data === "string" ? data : new TextDecoder().decode(data);
    },
    write: (name, data) => void files.set(name, data),
  };
}

// Runs a program and hands back what it made at the top level, by name; a Moth function comes back as a
// JavaScript function. This is how JavaScript drives code written in Moth, like Moth's own compiler.
export function load(source, print = console.log) {
  return loadProgram(compileToJs(source), print);
}

function loadProgram(program, print = console.log) {
  const values = program.run(print, undefined, Infinity);
  const made = Object.create(null); // a variable could be called __proto__
  program.names.forEach((name, slot) => {
    const value = values[slot - 1];
    if (value !== UNSET) made[name] = value instanceof Closure ? (...args) => value.fn.run(...args) : value;
  });
  return made;
}

// Moth's compiler written in Moth (compiler.moth): give it that file's text and get back a compiler that
// works like compileToJs(). `using` compiles compiler.moth itself: compileToJs() by default, or a compiler
// made by this function, which is how the tests show the compiler compiling itself.
export function mothCompiler(compilerSource, using = compileToJs) {
  const { compile } = loadProgram(using(compilerSource));
  return (source, files = {}) => { // files: each file a program may use, by name
    let made;
    try {
      made = compile(source, Object.entries(files).map(([name, text]) => makeRecord(["name", "text"], [name, text])));
    } catch (err) {
      // a mistake in the program it compiles comes back as `fail with` a record of where and why
      if (err instanceof MothError && isRecord(err.value) && Object.hasOwn(err.value, "reason")) fail(err.value.at, err.value.reason);
      if (err instanceof TooDeep) fail({ line: 1, col: 1 }, "the code is nested too deeply");
      throw err;
    }
    const names = [];
    made.names.forEach((name, i) => (names[i + 1] = name)); // slot 1 is the first name, as in jit()
    return fromJs(made.js, made.ats, names);
  };
}

// A paused program for a debugger: call run({ pauseAtLines: true }) to go to the next statement, and
// inspect() to see where it is and what its variables hold.
export function debug(source, print = console.log, draw = undefined, ask = undefined, { files, file, disk, args } = {}) {
  return new Machine(compile(source, { debug: true, files, file }), print, { draw, ask, disk, args });
}

// A whole run, recorded for a time-travel debugger: at every statement, where the program was, what its
// variables held, and how many lines it had said and drawn by then. Recording stops after `limit` steps
// (`cut` is then true), so a loop that never ends can't run forever. A mistake ends it with an `error` step.
// `answers` answer its questions, in order, each shown after its question as a line of output.
export function timeline(source, { limit = 10_000, answers = [], files, file, disk, args } = {}) {
  const said = [];
  const drawn = [];
  let asked = 0;
  const ask = (question) => {
    if (asked >= answers.length) return null;
    said.push(`${question} ${answers[asked]}`);
    return answers[asked++];
  };
  const machine = debug(source, (line) => said.push(line), (line) => drawn.push(line), ask, { files, file, disk, args });
  const steps = [];
  const snapshot = (extra) => steps.push({ ...machine.inspect(), said: said.length, drawn: drawn.length, ...extra });
  let cut = false;
  try {
    for (;;) {
      if (machine.run({ pauseAtLines: true }) === "done") {
        snapshot({ done: true });
        break;
      }
      snapshot();
      if ((cut = steps.length >= limit)) break;
    }
  } catch (err) {
    if (!(err instanceof MothError)) throw err;
    snapshot({ error: err }); // the variables as they were when it failed, since lists and values change in place
  }
  return { steps, said, drawn, cut };
}

// A shell session: each entry runs with the variables and functions made by the entries before it.
export function session(print = console.log, { files, disk } = {}) {
  const slots = new Map();
  const env = [null];
  return (source) => {
    const main = compile(source, { slots, files });
    while (env.length <= main.nslots) env.push(UNSET); // room for the variables this entry adds
    execute(main, print, Infinity, env, undefined, disk);
  };
}
