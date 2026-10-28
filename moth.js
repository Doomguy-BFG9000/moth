// Moth: a small programming language that reads like plain English.
// Source text -> tokens -> syntax tree -> bytecode -> a small stack-based virtual machine.

export class MothError extends Error {
  constructor(at, message) {
    super(`line ${at.line}: ${message}`);
    this.line = at.line;
    this.col = at.col;
  }
}

const fail = (at, message) => {
  throw new MothError(at, message);
};

// The line a MothError points at, with a ^ under the exact spot.
export function excerpt(source, { line, col }) {
  const text = source.split(/\r?\n/)[line - 1] ?? "";
  return `${text}\n${text.slice(0, col - 1).replace(/\S/g, " ")}^`;
}

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
const RESERVED = new Set(["set", "add", "say", "if", "else", "end", "repeat", "while", "for", "to", "return", "and", "or", "not", "is", "yes", "no", "nothing", "list", "empty", "length", "item"]);
const COMPARISONS = {
  "is": (a, b) => equal(a, b),
  "less than": (a, b) => a < b,
  "greater than": (a, b) => a > b,
  "at least": (a, b) => a >= b,
  "at most": (a, b) => a <= b,
  "divisible by": (a, b) => a % b === 0,
};

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

// ---------- bytecode ----------

const [GET, SET, CONST, JUMP, JUMP_IF_FALSE, COMPARE, ADD, SUB, MUL, DIV, CALL, GET_FN, RETURN, POP, AND, OR, NEG, NOT,
  LIST, LENGTH, ITEM, ITEM_REF, SET_ITEM, ADD_TO, SAY, CHECK_REPEAT, REPEAT_NEXT, CHECK_RANGE, RANGE_NEXT, ITER, ITER_NEXT,
  MAKE_FN, UNDEFINED, HALT] = Array.from({ length: 34 }, (_, i) => i);
const COMPARE_OPS = Object.keys(COMPARISONS);
const COMPARE_FNS = Object.values(COMPARISONS);
const DIVISIBLE = COMPARE_OPS.indexOf("divisible by");
const MATH_OPS = { "+": ADD, "-": SUB, "*": MUL, "/": DIV };

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
  constructor(parent, name, params, body) {
    this.parent = parent;
    this.slots = new Map();
    this.fn = { name, params, nslots: 0, code: [], consts: [], at: [] };
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

  load(name, at) {
    const found = this.resolve(name);
    if (found) this.emit(at, GET, ...found, this.constant(name));
    else this.emit(at, UNDEFINED, this.constant(name), 0);
  }

  store(name, at) {
    this.emit(at, SET, ...this.resolve(name)); // always found: declarations() saw every name that is stored
  }

  loop(s, next) {
    const top = this.here();
    const exit = this.jump(s.at, next);
    if (s.name) this.store(s.name, s.at);
    for (const inner of s.body) this.statement(inner);
    this.jump(s.at, JUMP, top);
    this.patch(exit);
  }

  call(e) {
    const found = this.resolve(e.name);
    if (found) this.emit(e.at, GET_FN, ...found, this.constant(e.name));
    else this.emit(e.at, UNDEFINED, this.constant(e.name), 1);
    for (const arg of e.args) this.expr(arg);
    this.emit(e.at, CALL, e.args.length, this.constant(e.name));
  }

  statement(s) {
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
        else this.emit(s.at, UNDEFINED, this.constant(s.name), 0);
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
        this.call(s);
        this.emit(s.at, POP);
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

// ---------- values ----------

class Closure {
  constructor(fn, env) {
    this.fn = fn;
    this.env = env;
  }
}

const UNSET = Symbol("unset"); // a variable that is declared but hasn't been given a value yet
const isList = Array.isArray;
const truthy = (v) => v !== null && v !== false;
const equal = (a, b) => (isList(a) && isList(b) ? a.length === b.length && a.every((x, i) => equal(x, b[i])) : a === b);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const noValue = (name) => `'${name}' has no value yet (give it one with 'set ${name} to ...')`;

function kindOf(v) {
  if (v === null) return "nothing";
  if (typeof v === "boolean") return "yes/no";
  if (typeof v === "string") return "text";
  if (isList(v)) return "a list";
  if (v instanceof Closure) return "a function";
  return "a number";
}

function show(v, nested = false) {
  if (v === null) return "nothing";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "string") return nested ? JSON.stringify(v) : v;
  if (isList(v)) return `[${v.map((x) => show(x, true)).join(", ")}]`;
  if (v instanceof Closure) return `<function ${v.fn.name}>`;
  return String(v);
}

function item(target, n, writing, error) {
  if (writing && !isList(target)) error(`can only change items of a list, not ${kindOf(target)}`);
  if (!isList(target) && typeof target !== "string") error(`can only take an item of a list or text, not ${kindOf(target)}`);
  const seq = typeof target === "string" ? [...target] : target; // by character, so "é" and emoji count as one
  if (!Number.isInteger(n)) error(`item numbers must be whole numbers, not ${show(n, true)}`);
  if (n < 1) error(`there is no item ${n}, items are counted from 1`);
  if (n > seq.length) error(`there is no item ${n}, the ${isList(target) ? "list" : "text"} only has ${plural(seq.length, isList(target) ? "item" : "letter")}`);
  return [seq, n - 1];
}

function compare(op, a, b, error) {
  if (op === "is") return equal(a, b);
  const ok = op === "divisible by"
    ? typeof a === "number" && typeof b === "number"
    : typeof a === typeof b && (typeof a === "number" || typeof a === "string");
  if (!ok) error(`can't check if ${kindOf(a)} is ${op} ${kindOf(b)}`);
  if (op === "divisible by" && b === 0) error("can't divide by zero");
  return COMPARISONS[op](a, b);
}

// ---------- the virtual machine ----------

const MAX_DEPTH = 100_000; // function calls in progress at once; the VM keeps its own stack, so this is a choice, not a JS limit

function newEnv(fn, parent) {
  const env = new Array(fn.nslots + 1).fill(UNSET);
  env[0] = parent; // slot 0 links to the scope the function was made in
  return env;
}

function execute(main, print, maxSteps) {
  const stack = [];
  const frames = [];
  let fn = main;
  let code = fn.code;
  let consts = fn.consts;
  let env = newEnv(fn, null);
  let ip = 0; // next instruction
  let pc = 0; // instruction being run, for error positions
  let base = 0; // where this call's values start on the stack
  let steps = 0;
  const error = (message) => fail(fn.at[pc], message);
  const tick = () => {
    if (++steps > maxSteps) error(`stopped after ${maxSteps.toLocaleString("en")} steps (is there a loop that never ends?)`);
  };

  try {
    for (;;) {
      pc = ip;
      switch (code[ip++]) {
        case GET: {
          let e = env;
          for (let d = code[ip]; d > 0; d--) e = e[0];
          const v = e[code[ip + 1]];
          if (v === UNSET) error(noValue(consts[code[ip + 2]]));
          ip += 3;
          stack.push(v);
          break;
        }
        case SET: {
          let e = env;
          for (let d = code[ip]; d > 0; d--) e = e[0];
          e[code[ip + 1]] = stack.pop();
          ip += 2;
          break;
        }
        case CONST:
          stack.push(consts[code[ip++]]);
          break;
        case JUMP: {
          const to = code[ip];
          if (to < ip) tick(); // jumping back means another loop round
          ip = to;
          break;
        }
        case JUMP_IF_FALSE: {
          const to = code[ip++];
          if (!truthy(stack.pop())) ip = to;
          break;
        }
        case COMPARE: {
          const op = code[ip++];
          const b = stack.pop();
          const a = stack.pop();
          // two numbers is the common case; compare() handles the rest, divisible by, and the error messages
          if (typeof a === "number" && typeof b === "number" && op !== DIVISIBLE) stack.push(COMPARE_FNS[op](a, b));
          else stack.push(compare(COMPARE_OPS[op], a, b, error));
          break;
        }
        case ADD: {
          const b = stack.pop();
          const a = stack.pop();
          if (typeof a === "number" && typeof b === "number") stack.push(a + b);
          else if (typeof a === "string" || typeof b === "string") stack.push(show(a) + show(b));
          else error(`can't use '+' on ${kindOf(a)} and ${kindOf(b)}`);
          break;
        }
        case SUB:
        case MUL:
        case DIV: {
          const op = code[pc];
          const b = stack.pop();
          const a = stack.pop();
          if (typeof a !== "number" || typeof b !== "number") error(`can't use '${op === SUB ? "-" : op === MUL ? "*" : "/"}' on ${kindOf(a)} and ${kindOf(b)}`);
          if (op === DIV && b === 0) error("can't divide by zero");
          stack.push(op === SUB ? a - b : op === MUL ? a * b : a / b);
          break;
        }
        case GET_FN: {
          let e = env;
          for (let d = code[ip]; d > 0; d--) e = e[0];
          const f = e[code[ip + 1]];
          const name = consts[code[ip + 2]];
          ip += 3;
          if (f === UNSET) error(`there is no function called '${name}'`);
          if (!(f instanceof Closure)) error(`'${name}' is ${kindOf(f)}, not a function`);
          stack.push(f);
          break;
        }
        case CALL: {
          const argc = code[ip];
          const name = consts[code[ip + 1]];
          ip += 2;
          const first = stack.length - argc;
          const callee = stack[first - 1];
          if (argc !== callee.fn.params.length) error(`'${name}' needs ${plural(callee.fn.params.length, "input")} but got ${argc}`);
          if (frames.length >= MAX_DEPTH) error("too much recursion: a function kept calling itself");
          tick();
          const inner = newEnv(callee.fn, callee.env);
          for (let i = 0; i < argc; i++) inner[i + 1] = stack[first + i]; // inputs take the first slots
          for (let i = argc; i >= 0; i--) stack.pop();
          frames.push({ fn, ip, env, base });
          fn = callee.fn;
          code = fn.code;
          consts = fn.consts;
          env = inner;
          ip = 0;
          base = stack.length;
          break;
        }
        case RETURN: {
          const value = stack.pop();
          while (stack.length > base) stack.pop(); // drops anything a loop left behind
          stack.push(value);
          ({ fn, ip, env, base } = frames.pop());
          code = fn.code;
          consts = fn.consts;
          break;
        }
        case POP:
          stack.pop();
          break;
        case AND: {
          const to = code[ip++];
          if (truthy(stack[stack.length - 1])) stack.pop();
          else ip = to;
          break;
        }
        case OR: {
          const to = code[ip++];
          if (truthy(stack[stack.length - 1])) ip = to;
          else stack.pop();
          break;
        }
        case NEG: {
          const v = stack.pop();
          if (typeof v !== "number") error(`'-' needs a number, not ${kindOf(v)}`);
          stack.push(-v);
          break;
        }
        case NOT:
          stack.push(!truthy(stack.pop()));
          break;
        case LIST: {
          const n = code[ip++];
          stack.push(stack.splice(stack.length - n, n));
          break;
        }
        case LENGTH: {
          const v = stack.pop();
          if (typeof v === "string") stack.push([...v].length);
          else if (isList(v)) stack.push(v.length);
          else error(`'length of' needs a list or text, not ${kindOf(v)}`);
          break;
        }
        case ITEM: {
          const n = stack.pop();
          const [seq, i] = item(stack.pop(), n, false, error);
          stack.push(seq[i]);
          break;
        }
        case ITEM_REF: {
          const n = stack.pop();
          stack.push(...item(stack.pop(), n, true, error)); // leaves the list and the index for SET_ITEM
          break;
        }
        case SET_ITEM: {
          const v = stack.pop();
          const i = stack.pop();
          stack.pop()[i] = v;
          break;
        }
        case ADD_TO: {
          const value = stack.pop();
          let e = env;
          for (let d = code[ip]; d > 0; d--) e = e[0];
          const slot = code[ip + 1];
          const current = e[slot];
          if (current === UNSET) error(noValue(consts[code[ip + 2]]));
          ip += 3;
          if (isList(current)) current.push(value);
          else if (typeof current === "string") e[slot] = current + show(value);
          else if (typeof current === "number" && typeof value === "number") e[slot] = current + value;
          else error(`can't add ${kindOf(value)} to ${kindOf(current)}`);
          break;
        }
        case SAY: {
          const n = code[ip++];
          print(stack.splice(stack.length - n, n).map((v) => show(v)).join(""));
          break;
        }
        case CHECK_REPEAT: {
          const n = stack[stack.length - 1];
          if (!Number.isInteger(n) || n < 0) error(`repeat needs a whole number of times, not ${show(n, true)}`);
          break;
        }
        case REPEAT_NEXT: { // stack: [... times left]
          const exit = code[ip++];
          const left = stack[stack.length - 1];
          if (left > 0) stack[stack.length - 1] = left - 1;
          else {
            stack.pop();
            ip = exit;
          }
          break;
        }
        case CHECK_RANGE: {
          const to = stack[stack.length - 1];
          const from = stack[stack.length - 2];
          if (typeof from !== "number" || typeof to !== "number") error(`'from' and 'to' need numbers, not ${kindOf(from)} and ${kindOf(to)}`);
          break;
        }
        case RANGE_NEXT: { // stack: [... next, last]; pushes the loop variable's value
          const exit = code[ip++];
          const top = stack.length;
          const next = stack[top - 2];
          if (next <= stack[top - 1]) {
            stack[top - 2] = next + 1;
            stack.push(next);
          } else {
            stack.length = top - 2;
            ip = exit;
          }
          break;
        }
        case ITER: {
          const v = stack.pop();
          if (!isList(v) && typeof v !== "string") error(`can only go through a list or text, not ${kindOf(v)}`);
          stack.push({ items: [...v], i: 0 }); // a copy, so adding to the list inside the loop can't make it endless
          break;
        }
        case ITER_NEXT: { // stack: [... iterator]; pushes the loop variable's value
          const exit = code[ip++];
          const it = stack[stack.length - 1];
          if (it.i < it.items.length) stack.push(it.items[it.i++]);
          else {
            stack.pop();
            ip = exit;
          }
          break;
        }
        case MAKE_FN:
          stack.push(new Closure(consts[code[ip++]], env));
          break;
        case UNDEFINED: { // a name nothing ever sets
          const name = consts[code[ip]];
          error(code[ip + 1] ? `there is no function called '${name}'` : noValue(name));
          break;
        }
        case HALT:
          return;
      }
    }
  } catch (err) {
    // with no recursion in the VM, a RangeError here means a string or list grew past what JavaScript allows
    if (err instanceof RangeError) error("a value got too big to fit in memory");
    throw err;
  }
}

// Runs a Moth program. Each `say` line goes to `print`; mistakes in the program throw MothError.
// `maxSteps` stops loops and calls after that many rounds, for running untrusted code without a Stop button.
export function run(source, print = console.log, { maxSteps = Infinity } = {}) {
  let main;
  try {
    main = new Compiler(null, "main", [], parse(tokenize(source))).fn;
  } catch (err) {
    // shortcut: points at line 1, since the overflow hides where the nesting was; only ~1,000 levels of brackets get here
    if (err instanceof RangeError) fail({ line: 1, col: 1 }, "the code is nested too deeply");
    throw err;
  }
  execute(main, print, maxSteps);
}
