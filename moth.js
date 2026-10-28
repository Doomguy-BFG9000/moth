// Moth: a small programming language that reads like plain English.
// Source text -> tokens -> syntax tree -> bytecode (this file) -> the virtual machine (vm.js).

import { fail, noValue, COMPARISONS, COMPARE_OPS, OP, OPCODES, TURTLE_ACTIONS, UNSET, Machine, execute } from "./vm.js";

export { MothError, excerpt } from "./vm.js";

// ---------- tokens ----------

const TOKEN = /(\s+)|(#.*)|(\d+(?:\.\d+)?)|([A-Za-z_]\w*)|("(?:\\.|[^"\\\n])*")|([-+*/(),])/y;
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
      const c = src[at];
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
          ? ["string", string.slice(1, -1).replace(/\\(.)/g, (_, c) => ESCAPES[c] ?? c)]
          : [text, text];
    tokens.push({ type, value, ...where, nl });
    nl = false;
  }
  tokens.push({ type: "eof", value: "", line, col: src.length - lineStart + 1, nl: true });
  return tokens;
}

// ---------- syntax tree ----------

// words that start a statement or a value, so they can't name a variable
const RESERVED = new Set(["set", "add", "say", "if", "else", "end", "repeat", "while", "for", "to", "return", "and", "or", "not", "is", "yes", "no", "nothing", "list", "empty", "length", "item", "move", "turn", "pen"]);

// Every node keeps the token it came from (`at`), so errors can point at it.
function parse(tokens) {
  let pos = 0;
  let fnDepth = 0;
  const peek = () => tokens[pos];
  const check = (type) => tokens[pos].type === type;
  const match = (type) => check(type) && tokens[pos++];
  const isWord = (w) => check("word") && tokens[pos].value === w;
  const word = (w) => isWord(w) && tokens[pos++];
  const describe = (t) => (t.type === "eof" ? "the end of the code" : t.type === "string" ? `"${t.value}"` : `'${t.value}'`);
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
    // drawing: `move forward 10`, `turn left 90`, `pen up`, `pen color "red"`
    const turtle = { move: ["forward", "back"], turn: ["left", "right"], pen: ["up", "down", "color", "width"] }[t.value];
    if (t.type === "word" && turtle) {
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
    if (word("empty")) {
      expectWord("list");
      return { kind: "list", items: [], at: t };
    }
    if (word("length")) {
      expectWord("of");
      return { kind: "length", of: unary(), at: t };
    }
    if (word("item")) {
      const index = additive();
      expectWord("of");
      return { kind: "item", index, of: unary(), at: t };
    }
    if (match("(")) {
      const inner = expression();
      if (!match(")")) expected("')'");
      return inner;
    }
    if (t.type === "word" && !RESERVED.has(t.value)) {
      pos++;
      if (match("(")) return { kind: "call", name: t.value, args: argList(), at: t };
      return { kind: "name", name: t.value, at: t };
    }
    expected("a value");
  }

  function argList() {
    const args = [];
    while (!check(")")) {
      args.push(expression());
      if (!match(",")) break;
    }
    if (!match(")")) expected("')'");
    return args;
  }

  return statements(null);
}

// ---------- bytecode compiler ----------

const { GET, SET, CONST, JUMP, JUMP_IF_FALSE, COMPARE, ADD, SUB, MUL, DIV, CALL, GET_FN, RETURN, POP, AND, OR, NEG, NOT,
  LIST, LENGTH, ITEM, ITEM_REF, SET_ITEM, ADD_TO, SAY, CHECK_REPEAT, REPEAT_NEXT, CHECK_RANGE, RANGE_NEXT, ITER, ITER_NEXT,
  MAKE_FN, UNDEFINED, HALT, LINE, TURTLE } = OP;
const MATH_OPS = { "+": ADD, "-": SUB, "*": MUL, "/": DIV };
const LOOPS = new Set(["while", "repeat", "count", "each"]);
const STATEMENT_WORDS = ["set", "add", "say", "if", "repeat", "for", "to", "return", "move", "turn", "pen"];

// Edits needed to turn one word into another, counting a swap of two neighbours as one ("sya" -> "say").
function distance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i ? (j ? 0 : i) : j)));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

// The candidate a misspelled name most likely meant, or null if none is close: 1 edit for short names, 2 otherwise.
function closest(name, candidates) {
  let best = null;
  let bestDistance = (name.length <= 3 ? 1 : 2) + 1;
  for (const c of candidates) {
    const d = distance(name, c);
    if (d < bestDistance) [best, bestDistance] = [c, d];
  }
  return best;
}

// Names each function sets. Inputs and functions made with `to` always belong to the function itself;
// a name it `set`s (or loops over) belongs to the outermost enclosing function, or the top level, that also sets it.
function declarations(body, found = { own: [], shared: [] }) {
  for (const s of body) {
    if (s.kind === "define") found.own.push(s.name);
    if (s.kind === "set" || s.kind === "count" || s.kind === "each") found.shared.push(s.name);
    for (const inner of [s.then, s.otherwise, s.kind !== "define" && s.body]) if (inner) declarations(inner, found);
  }
  return found;
}

// Compiles one function (or the whole program) to bytecode. Variables are resolved here, once,
// to a (depth, slot) pair: how many scopes out to walk, and which slot in that scope's array.
class Compiler {
  // `slots` carries a shell's earlier top-level variables; `debug` adds LINE markers for the debugger.
  constructor(parent, name, params, body, { slots = new Map(), debug = parent?.debug ?? false } = {}) {
    this.parent = parent;
    this.slots = slots;
    this.debug = debug;
    this.fn = { name, params, nslots: slots.size, names: [], code: [], consts: [], at: [] };
    for (const [n, slot] of slots) this.fn.names[slot] = n; // each slot's name, for the debugger and disassembler
    Object.defineProperty(this.fn, "parent", { value: parent?.fn }); // for the debugger; not enumerable, so `moth build`'s JSON skips it
    for (const p of params) this.declare(p);
    const { own, shared } = declarations(body);
    for (const n of own) if (!this.slots.has(n)) this.declare(n);
    for (const n of shared) if (!this.slots.has(n) && !parent?.resolve(n)) this.declare(n);
    for (const s of body) this.statement(s);
    if (parent) this.emit(null, CONST, this.constant(null), RETURN);
    else this.emit(null, HALT);
  }

  declare(name) {
    this.slots.set(name, ++this.fn.nslots);
    this.fn.names[this.fn.nslots] = name;
  }

  // In a debug build, the machine can pause here: a statement on this line is about to run.
  mark(s) {
    if (this.debug) this.emit(s.at, LINE, s.at.line);
  }

  resolve(name) {
    for (let c = this, depth = 0; c; c = c.parent, depth++) if (c.slots.has(name)) return [depth, c.slots.get(name)];
    return null;
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

  // A name nothing ever sets: fail when this line runs, suggesting the closest name that does exist.
  // A line that starts with an unknown name may be a misspelled Moth word instead, like `sya "hi"`.
  undefinedName(name, at, { call = false, statement = false } = {}) {
    const known = [];
    for (let c = this; c; c = c.parent) known.push(...c.slots.keys());
    const guess = closest(name, statement ? [...known, ...STATEMENT_WORDS] : known);
    const message = call ? `there is no function called '${name}'` : guess ? `'${name}' has no value yet` : noValue(name);
    this.emit(at, UNDEFINED, this.constant(guess ? `${message}. Did you mean '${guess}'?` : message));
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

// Compiles Moth source to bytecode for vm.js. Options: `slots` carries over the top-level variables of
// earlier shell entries; `debug` adds LINE markers so a debugger can pause at each statement.
export function compile(source, options) {
  try {
    return new Compiler(null, "main", [], parse(tokenize(source)), options).fn;
  } catch (err) {
    // shortcut: points at line 1, since the overflow hides where the nesting was; only ~1,000 levels of brackets get here
    if (err instanceof RangeError) fail({ line: 1, col: 1 }, "the code is nested too deeply");
    throw err;
  }
}

// Runs a Moth program. Each `say` line goes to `print`, each line the turtle draws to `draw`; mistakes in
// the program throw MothError. `maxSteps` stops loops and calls after that many rounds, for running
// untrusted code without a Stop button.
export function run(source, print = console.log, { maxSteps = Infinity, draw } = {}) {
  new Machine(compile(source), print, { maxSteps, draw }).run();
}

// A paused program for a debugger: call run({ pauseAtLines: true }) to go to the next statement, and
// inspect() to see where it is and what its variables hold.
export function debug(source, print = console.log, draw = undefined) {
  return new Machine(compile(source, { debug: true }), print, { draw });
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
