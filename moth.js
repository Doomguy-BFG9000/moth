// Moth: a small programming language that reads like plain English.
// Source text -> tokens -> syntax tree -> bytecode (this file) -> the virtual machine (vm.js).

import { MothError, fail, COMPARISONS, COMPARE_OPS, OP, OPCODES, TURTLE_ACTIONS, UNSET, Closure, Machine, execute, isRecord } from "./vm.js";
import { Scope } from "./scope.js";
import { jit, fromJs, TooDeep } from "./jit.js";
import { check as checkProgram } from "./checker.js";

export { MothError, excerpt } from "./vm.js";

// ---------- tokens ----------

// Every control character counts as a space (as in Wirth's compilers), and text holds any character but a
// control character other than tab (\n makes a new line). Rules this small let the compiler written in Moth,
// which has no character codes, follow them exactly.
const TOKEN = /([\0-\x20]+)|(#[^\n]*)|(\d+(?:\.\d+)?)|([A-Za-z_]\w*)|("(?:\\[^\0-\x08\n-\x1f]|[^"\\\0-\x08\n-\x1f])*")|([-+*/(),])/y;
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

function tokenize(src) {
  const tokens = [];
  let line = 1;
  let lineStart = 0;
  let nl = true; // does the next token start a new line?
  for (let at = 0; at < src.length; at = TOKEN.lastIndex) {
    TOKEN.lastIndex = at;
    const m = TOKEN.exec(src);
    const where = { line, col: at - lineStart + 1 };
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
  tokens.push({ type: "eof", value: "", line, col: src.length - lineStart + 1, nl: true });
  return tokens;
}

// ---------- syntax tree ----------

// words that start a statement or a value, so they can't name a variable
const RESERVED = new Set([
  "set", "add", "say", "if", "else", "end", "repeat", "while", "for", "to", "return", "and", "or", "not", "is", "yes", "no",
  "nothing", "list", "empty", "length", "item", "move", "turn", "pen", "record", "fail"]);
// drawing: `move forward 10`, `turn left 90`, `pen up`, `pen color "red"`
const TURTLE_WORDS = new Map([["move", ["forward", "back"]], ["turn", ["left", "right"]], ["pen", ["up", "down", "color", "width"]]]);

// Every node keeps the token it came from (`at`), so errors can point at it.
function parse(tokens) {
  let pos = 0;
  let fnDepth = 0;
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

  function statements(opener) {
    const body = [];
    while (opener ? !isWord("end") && !isWord("else") : !check("eof")) {
      if (check("eof")) fail(peek(), `'${opener.value}' from line ${opener.line} is missing its 'end'`);
      body.push(statement());
      if (!peek().nl) expected("a new line");
    }
    return body;
  }

  function block(opener) {
    if (!peek().nl) expected("a new line");
    return statements(opener);
  }

  function blockEnd(opener) {
    const body = block(opener);
    expectWord("end");
    return body;
  }

  function statement() {
    const t = peek();
    if (word("set")) {
      if (isWord("item")) {
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
      if (word("while")) return { kind: "while", cond: expression(), body: blockEnd(t), at: t };
      const count = expression();
      expectWord("times");
      return { kind: "repeat", count, body: blockEnd(t), at: t };
    }
    if (word("for")) {
      expectWord("each");
      const variable = name("a variable name");
      if (word("from")) {
        const from = expression();
        expectWord("to");
        return { kind: "count", name: variable, from, to: expression(), body: blockEnd(t), at: t };
      }
      if (!word("in")) expected("'in' or 'from'");
      return { kind: "each", name: variable, list: expression(), body: blockEnd(t), at: t };
    }
    if (word("to")) {
      const fnName = name("a function name");
      const params = [];
      if (word("with")) do params.push(name("an input name")); while (match(",") || word("and"));
      fnDepth++;
      const body = blockEnd(t);
      fnDepth--;
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
      if (isWord("is")) fail(t, `to give '${t.value}' a value write 'set ${t.value} to ...'`);
      let args = [];
      if (match("(")) args = argList();
      else if (!peek().nl) do args.push(expression()); while (match(","));
      return { kind: "call", name: t.value, args, at: t };
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
    const left = additive();
    const t = word("is");
    if (!t) return left;
    const negate = Boolean(word("not"));
    const phrase = check("word") && tokens[pos + 1].type === "word" ? `${peek().value} ${tokens[pos + 1].value}` : "";
    const op = Object.hasOwn(COMPARISONS, phrase) ? ((pos += 2), phrase) : "is";
    return { kind: "compare", op, negate, left, right: additive(), at: t };
  }

  function additive() {
    let left = multiplicative();
    for (let t; (t = match("+") || match("-")); ) left = { kind: "math", op: t.type, left, right: multiplicative(), at: t };
    return left;
  }

  function multiplicative() {
    let left = unary();
    for (let t; (t = match("*") || match("/")); ) left = { kind: "math", op: t.type, left, right: unary(), at: t };
    return left;
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
    if (word("empty")) {
      if (word("record")) return { kind: "record", fields: [], values: [], at: t };
      if (!word("list")) expected("'list' or 'record'");
      return { kind: "list", items: [], at: t };
    }
    if (word("length")) {
      expectWord("of");
      return { kind: "length", of: unary(), at: t };
    }
    if (word("item")) {
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
      if (match("(")) return { kind: "call", name: t.value, args: argList(), at: t };
      if (!indexing && word("of")) return { kind: "field", name: t.value, of: unary(), at: t }; // `name of person`
      return { kind: "name", name: t.value, at: t };
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

// ---------- bytecode compiler ----------

const { GET, SET, CONST, JUMP, JUMP_IF_FALSE, COMPARE, ADD, SUB, MUL, DIV, CALL, GET_FN, RETURN, POP, AND, OR, NEG, NOT,
  LIST, LENGTH, ITEM, ITEM_REF, SET_ITEM, ADD_TO, SAY, CHECK_REPEAT, REPEAT_NEXT, CHECK_RANGE, RANGE_NEXT, ITER, ITER_NEXT,
  MAKE_FN, UNDEFINED, HALT, LINE, TURTLE, RECORD, FIELD, RECORD_REF, SET_FIELD, FAIL } = OP;
const MATH_OPS = { "+": ADD, "-": SUB, "*": MUL, "/": DIV };
const LOOPS = new Set(["while", "repeat", "count", "each"]);

// Compiles one function (or the whole program) to bytecode for vm.js. Scope (scope.js) has already given
// every variable a slot, so a name becomes a (depth, slot) pair here.
class Compiler extends Scope {
  constructor(parent, name, params, body, options) {
    super(parent, name, params, body, options);
    Object.assign(this.fn, { code: [], consts: [], at: [] });
    for (const s of body) this.statement(s);
    if (parent) this.emit(null, CONST, this.constant(null), RETURN);
    else this.emit(null, HALT);
  }

  // In a debug build, the machine can pause here: a statement on this line is about to run.
  mark(s) {
    if (this.debug) this.emit(s.at, LINE, s.at.line);
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

  loop(s, next) {
    const top = this.here();
    const exit = this.jump(s.at, next);
    if (s.name) this.store(s.name, s.at);
    this.mark(s); // every round pauses on the loop's line, after the loop variable has its new value
    for (const inner of s.body) this.statement(inner);
    this.jump(s.at, JUMP, top);
    this.patch(exit);
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
        this.emit(s.at, SET_ITEM);
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
        for (const inner of s.body) this.statement(inner);
        this.jump(s.at, JUMP, top);
        this.patch(exit);
        return;
      }
      case "repeat":
        this.expr(s.count);
        this.emit(s.at, CHECK_REPEAT);
        this.loop(s, REPEAT_NEXT);
        return;
      case "count":
        this.expr(s.from);
        this.expr(s.to);
        this.emit(s.at, CHECK_RANGE);
        this.loop(s, RANGE_NEXT);
        return;
      case "each":
        this.expr(s.list);
        this.emit(s.at, ITER);
        this.loop(s, ITER_NEXT);
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
      case "field":
        this.expr(e.of);
        this.emit(e.at, FIELD, this.constant(e.name));
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
function build(source, backEnd) {
  try {
    return backEnd(parse(tokenize(source)));
  } catch (err) {
    // shortcut: points at line 1, since the overflow hides where the nesting was; only ~1,000 levels of brackets get here
    if (err instanceof RangeError) fail({ line: 1, col: 1 }, "the code is nested too deeply");
    throw err;
  }
}

// Compiles Moth source to bytecode for vm.js. Options: `slots` carries over the top-level variables of
// earlier shell entries; `debug` adds LINE markers so a debugger can pause at each statement.
export function compile(source, options) {
  return build(source, (program) => new Compiler(null, "main", [], program, options).fn);
}

// Compiles Moth source to JavaScript (jit.js): { source, run(print, draw, maxSteps) }.
export function compileToJs(source) {
  return build(source, jit);
}

// Problems found without running the program (checker.js): [{ line, col, kind, message }]. Code that
// can't even be read comes back as a single problem of kind "error".
export function check(source) {
  try {
    return build(source, checkProgram);
  } catch (err) {
    if (!(err instanceof MothError)) throw err;
    return [{ line: err.line, col: err.col, kind: "error", message: err.reason }];
  }
}

// Runs a Moth program. Each `say` line goes to `print`, each line the turtle draws to `draw`; mistakes in
// the program throw MothError. `maxSteps` stops loops and calls after that many rounds, for running
// untrusted code without a Stop button. `engine` is "jit" (compile to JavaScript) or "vm" (bytecode).
export function run(source, print = console.log, { maxSteps = Infinity, draw, engine = "jit" } = {}) {
  let program = null;
  if (engine === "jit") {
    try {
      program = compileToJs(source);
    } catch (err) {
      if (!(err instanceof EvalError)) throw err; // a page whose security policy forbids making code from text
    }
  }
  if (!program) return new Machine(compile(source), print, { maxSteps, draw }).run();
  let said = 0;
  let drawn = 0;
  try {
    // counted once passed on, so a hand-over in the middle of passing one on can't lose it
    program.run((line) => (print(line), said++), (line) => (draw?.(line), drawn++), maxSteps);
  } catch (err) {
    if (!(err instanceof TooDeep || err instanceof RangeError || err?.name === "InternalError")) throw err;
    // Calls went deeper than the JIT goes (or JavaScript's stack ran out anyway), or a value outgrew what
    // JavaScript allows. Moth programs can't read input or the clock, so a second run says and draws exactly
    // the same things: run it again on the VM, which keeps its own stack and reports a too-big value at the
    // right line, and pass on only what the first run hadn't already.
    new Machine(compile(source), (line) => said-- > 0 || print(line), { maxSteps, draw: (line) => drawn-- > 0 || draw?.(line) }).run();
  }
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
  return (source) => {
    let made;
    try {
      made = compile(source);
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
export function debug(source, print = console.log, draw = undefined) {
  return new Machine(compile(source, { debug: true }), print, { draw });
}

// A whole run, recorded for a time-travel debugger: at every statement, where the program was, what its
// variables held, and how many lines it had said and drawn by then. Recording stops after `limit` steps
// (`cut` is then true), so a loop that never ends can't run forever. A mistake ends it with an `error` step.
export function timeline(source, { limit = 10_000 } = {}) {
  const said = [];
  const drawn = [];
  const machine = debug(source, (line) => said.push(line), (line) => drawn.push(line));
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
export function session(print = console.log) {
  const slots = new Map();
  const env = [null];
  return (source) => {
    const main = compile(source, { slots });
    while (env.length <= main.nslots) env.push(UNSET); // room for the variables this entry adds
    execute(main, print, Infinity, env);
  };
}
