// The Moth virtual machine: runs the bytecode that moth.js compiles. It imports nothing, so `moth build`
// can copy this file into a compiled program as its runtime.

export class MothError extends Error {
  constructor(at, message) {
    super(`line ${at.line}: ${message}`);
    this.line = at.line;
    this.col = at.col;
    this.reason = message;
    this.incomplete = at.type === "eof"; // the code ended too early, so the shell asks for more lines
  }
}

export const fail = (at, message) => {
  throw new MothError(at, message);
};

// The line a MothError points at, with a ^ under the exact spot.
export function excerpt(source, { line, col }) {
  const text = source.split(/\r?\n/)[line - 1] ?? "";
  return `${text}\n${text.slice(0, col - 1).replace(/\S/g, " ")}^`;
}

export const COMPARISONS = {
  "is": (a, b) => equal(a, b),
  "less than": (a, b) => a < b,
  "greater than": (a, b) => a > b,
  "at least": (a, b) => a >= b,
  "at most": (a, b) => a <= b,
  "divisible by": (a, b) => a % b === 0,
};
export const COMPARE_OPS = Object.keys(COMPARISONS);
const COMPARE_FNS = Object.values(COMPARISONS);
const DIVISIBLE = COMPARE_OPS.indexOf("divisible by");

// ---------- bytecode ----------

// Each opcode, and how many operands follow it in a function's code array.
export const OPCODES = [
  ["GET", 3], ["SET", 2], ["CONST", 1], ["JUMP", 1], ["JUMP_IF_FALSE", 1], ["COMPARE", 1],
  ["ADD", 0], ["SUB", 0], ["MUL", 0], ["DIV", 0], ["CALL", 2], ["GET_FN", 3], ["RETURN", 0], ["POP", 0],
  ["AND", 1], ["OR", 1], ["NEG", 0], ["NOT", 0], ["LIST", 1], ["LENGTH", 0], ["ITEM", 0], ["ITEM_REF", 0],
  ["SET_ITEM", 0], ["ADD_TO", 3], ["SAY", 1], ["CHECK_REPEAT", 0], ["REPEAT_NEXT", 1], ["CHECK_RANGE", 0],
  ["RANGE_NEXT", 1], ["ITER", 0], ["ITER_NEXT", 1], ["MAKE_FN", 1], ["UNDEFINED", 1], ["HALT", 0],
];
export const OP = Object.fromEntries(OPCODES.map(([name], i) => [name, i]));
const { GET, SET, CONST, JUMP, JUMP_IF_FALSE, COMPARE, ADD, SUB, MUL, DIV, CALL, GET_FN, RETURN, POP, AND, OR, NEG, NOT,
  LIST, LENGTH, ITEM, ITEM_REF, SET_ITEM, ADD_TO, SAY, CHECK_REPEAT, REPEAT_NEXT, CHECK_RANGE, RANGE_NEXT, ITER, ITER_NEXT,
  MAKE_FN, UNDEFINED, HALT } = OP;

// ---------- values ----------

class Closure {
  constructor(fn, env) {
    this.fn = fn;
    this.env = env;
  }
}

export const UNSET = Symbol("unset"); // a variable that is declared but hasn't been given a value yet
const isList = Array.isArray;
const truthy = (v) => v !== null && v !== false;
const equal = (a, b) => (isList(a) && isList(b) ? a.length === b.length && a.every((x, i) => equal(x, b[i])) : a === b);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
export const noValue = (name) => `'${name}' has no value yet (give it one with 'set ${name} to ...')`;

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

export function newEnv(fn, parent) {
  const env = new Array(fn.nslots + 1).fill(UNSET);
  env[0] = parent; // slot 0 links to the scope the function was made in
  return env;
}

export function execute(main, print = console.log, maxSteps = Infinity, env = newEnv(main, null)) {
  const stack = [];
  const frames = [];
  let fn = main;
  let code = fn.code;
  let consts = fn.consts;
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
        case UNDEFINED: // a name nothing ever sets; the compiler wrote the message, with any "did you mean"
          error(consts[code[ip]]);
          break;
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
