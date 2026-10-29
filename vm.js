// The Moth virtual machine: runs the bytecode that moth.js compiles. It imports nothing, so `moth build`
// can copy this file into a compiled program as its runtime.

// `value` is set by `fail with value`, so a program that called Moth code (see load()) can read it.
// `trail` is the calls that led to the mistake (see trailOf).
export class MothError extends Error {
  constructor(at, message, value, trail = []) {
    super(`${at.file ? `${at.file}, ` : ""}line ${at.line}: ${message}`); // file: a file the program uses
    this.file = at.file || undefined;
    this.line = at.line;
    this.col = at.col;
    this.reason = message;
    this.value = value;
    this.trail = trail;
    this.incomplete = at.type === "eof"; // the code ended too early, so the shell asks for more lines
  }
}

// What `try` catches: any mistake but one that ends the program on purpose, like running past maxSteps
// (a loop that never ends must stop, try or not). `if it fails with x` gets the value of a `fail with`,
// or a mistake's message.
export const catchable = (err) => err instanceof MothError && !err.final;
export const caughtValue = (err) => (err.value !== undefined ? err.value : err.reason);

export const fail = (at, message, value, final = false, trail = []) => {
  const err = new MothError(at, message, value, trail);
  if (final) err.final = true;
  throw err;
};

// The calls in progress when a mistake happened, innermost first: the function each was running, and where
// it was called from. `calls` is [{ name, at }], innermost first. A function that called itself from the
// same spot many times running is one entry, with how many `times`, so deep recursion is one line.
export function trailOf(calls) {
  const trail = [];
  for (const { name, at } of calls) {
    const last = trail.at(-1);
    if (last && last.name === name && last.line === at.line && last.col === at.col && last.file === at.file) last.times++;
    else trail.push({ name, line: at.line, col: at.col, file: at.file, times: 1 });
  }
  return trail;
}

// A trail as lines to show under the mistake, at most `limit` of them.
export function describeTrail(trail, limit = 10) {
  const lines = trail.slice(0, limit).map(({ name, line, file, times }) =>
    `  in '${name}', called from ${file ? `${file}, ` : ""}line ${line}${times > 1 ? ` (${times.toLocaleString("en")} times)` : ""}`);
  if (trail.length > limit) lines.push(`  ... and ${trail.length - limit} more`);
  return lines.join("\n");
}

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
export function closest(name, candidates) {
  let best = null;
  let bestDistance = (name.length <= 3 ? 1 : 2) + 1;
  for (const c of candidates) {
    const d = distance(name, c);
    if (d < bestDistance) [best, bestDistance] = [c, d];
  }
  return best;
}

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
  "in": (a, b) => isIn(a, b),
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
  ["LINE", 1], // only in debug builds: a new statement starts on this line
  ["TURTLE", 1], // a drawing command, one of TURTLE_ACTIONS
  ["RECORD", 1], // its field names are a constant; their values are on the stack
  ["FIELD", 1], ["RECORD_REF", 1], ["SET_FIELD", 1], // the operand is the field's name, a constant
  ["FAIL", 0],
  ["BUILTIN", 1], // one of BUILTINS, which takes its inputs off the stack
  ["ASK", 0],
  ["TRY", 1], // where its `if it fails` starts
  ["END_TRY", 0], ["CAUGHT", 0],
  ["DICT", 1], // the keys and values on the stack, one after the other, become a dictionary; the operand counts both
  ["REMOVE", 0],
  ["READ", 1], // the operand is 1 to read bytes, 0 to read text
  ["WRITE", 0], ["ARGUMENTS", 0],
];
export const OP = Object.fromEntries(OPCODES.map(([name], i) => [name, i]));
const { GET, SET, CONST, JUMP, JUMP_IF_FALSE, COMPARE, ADD, SUB, MUL, DIV, CALL, GET_FN, RETURN, POP, AND, OR, NEG, NOT,
  LIST, LENGTH, ITEM, ITEM_REF, SET_ITEM, ADD_TO, SAY, CHECK_REPEAT, REPEAT_NEXT, CHECK_RANGE, RANGE_NEXT, ITER, ITER_NEXT,
  MAKE_FN, UNDEFINED, HALT, LINE, TURTLE, RECORD, FIELD, RECORD_REF, SET_FIELD, FAIL, BUILTIN, ASK, TRY, END_TRY, CAUGHT, DICT, REMOVE, READ, WRITE, ARGUMENTS } = OP;
// `move forward 10`, `turn left 90`, `pen up`, `pen color "red"`...; the first four and the last two take a value
export const TURTLE_ACTIONS = ["forward", "back", "left", "right", "up", "down", "color", "width"];

// ---------- values ----------

// A Moth function. `fn` is its compiled code (or, from the JIT, just its name and inputs plus `run`, the
// JavaScript function it became); `env` is the scope it was made in.
export class Closure {
  constructor(fn, env) {
    this.fn = fn;
    this.env = env;
  }
}

export const UNSET = Symbol("unset"); // a variable that is declared but hasn't been given a value yet
const isList = Array.isArray;
// A record is made by `new Record()`, whose prototype has no properties and no prototype of its own, so a
// field can be called anything, even "constructor" or "__proto__". Object.create(null) would do that too,
// but V8 keeps those as slow dictionaries; objects made with `new` get shapes, so field access is fast.
export function Record() {}
Record.prototype = Object.create(null);
export const isRecord = (v) => v instanceof Record;
// A dictionary is a Map whose keys are text or numbers. It keeps them in the order they were added.
export const isDictionary = (v) => v instanceof Map;
// Bytes are a block of memory: a fixed number of whole numbers from 0 to 255.
export const isBytes = (v) => v instanceof Uint8Array;
export const truthy = (v) => v !== null && v !== false;
export function equal(a, b) {
  if (a === b) return true;
  if (isList(a) && isList(b)) return a.length === b.length && a.every((x, i) => equal(x, b[i]));
  if (isBytes(a) && isBytes(b)) return a.length === b.length && a.every((x, i) => x === b[i]);
  if (isDictionary(a) && isDictionary(b)) return a.size === b.size && [...a].every(([key, value]) => b.has(key) && equal(value, b.get(key)));
  if (isRecord(a) && isRecord(b)) {
    const fields = Object.keys(a);
    return fields.length === Object.keys(b).length && fields.every((f) => Object.hasOwn(b, f) && equal(a[f], b[f]));
  }
  return a === b;
}
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
export const noValue = (name) => `'${name}' has no value yet (give it one with 'set ${name} to ...')`;
export const stoppedMessage = (steps) => `stopped after ${steps.toLocaleString("en")} steps (is there a loop that never ends?)`;

export function kindOf(v) {
  if (v === null) return "nothing";
  if (typeof v === "boolean") return "yes/no";
  if (typeof v === "string") return "text";
  if (isList(v)) return "a list";
  if (v instanceof Closure) return "a function";
  if (isRecord(v)) return "a record";
  if (isDictionary(v)) return "a dictionary";
  if (isBytes(v)) return "bytes";
  return "a number";
}

export function show(v, nested = false) {
  if (v === null) return "nothing";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "string") return nested ? JSON.stringify(v) : v;
  if (isList(v)) return `[${v.map((x) => show(x, true)).join(", ")}]`;
  if (v instanceof Closure) return `<function ${v.fn.name}>`;
  if (isRecord(v)) {
    const fields = Object.keys(v);
    return fields.length ? `(record with ${fields.map((f) => `${f} ${show(v[f], true)}`).join(", ")})` : "(empty record)";
  }
  if (isDictionary(v)) {
    const entries = [...v].map(([key, value]) => `${show(key, true)} is ${show(value, true)}`);
    return entries.length ? `(dictionary where ${entries.join(", ")})` : "(empty dictionary)";
  }
  if (isBytes(v)) return `(${plural(v.length, "byte")}${v.length ? `: ${v.join(", ")}` : ""})`;
  return String(v);
}

// ---------- what operations do, shared by both engines ----------
// The VM below and the JIT (jit.js) run every check through these, so they can't drift apart. Each takes
// `error`, which throws: the VM's version positions the error at the instruction it was running, the JIT's
// at the spot in the source the code came from.

// Where `item n of target` is: [the list (or the text's letters, the bytes or the dictionary), the place in
// it]. Any key of a dictionary can be set, but one that is read must be there.
export function item(target, n, writing, error = oops) {
  if (isDictionary(target)) {
    dictionaryKey(n, error);
    if (!writing && !target.has(n)) error(notIn(target, n));
    return [target, n];
  }
  if (writing && !isList(target) && !isBytes(target)) error(`can only change items of a list, dictionary or bytes, not ${kindOf(target)}`);
  if (!isList(target) && !isBytes(target) && typeof target !== "string") error(`can only take an item of a list, text, dictionary or bytes, not ${kindOf(target)}`);
  const seq = typeof target === "string" ? [...target] : target; // by character, so "é" and emoji count as one
  if (!Number.isInteger(n)) error(`item numbers must be whole numbers, not ${show(n, true)}`);
  if (n < 1) error(`there is no item ${n}, items are counted from 1`);
  if (n > seq.length) {
    if (isBytes(target)) error(`there is no item ${n}, there are only ${plural(seq.length, "byte")}`);
    error(`there is no item ${n}, the ${isList(target) ? "list" : "text"} only has ${plural(seq.length, isList(target) ? "item" : "letter")}`);
  }
  return [seq, n - 1];
}

const byte = (v, error) => {
  if (!Number.isInteger(v) || v < 0 || v > 255) error(`a byte is a whole number from 0 to 255, not ${show(v, true)}`);
  return v;
};

// the value at the place item() found, and putting one there
export const itemAt = (seq, i) => (isDictionary(seq) ? seq.get(i) : seq[i]);
export function putItem(seq, i, value, error = oops) {
  if (isDictionary(seq)) seq.set(i, value);
  else if (isBytes(seq)) seq[i] = byte(value, error);
  else seq[i] = value;
}

const dictionaryKey = (key, error) => {
  if (typeof key !== "string" && typeof key !== "number") error(`a dictionary's keys are text or numbers, not ${kindOf(key)}`);
  return key;
};

// "there is no "aple" in this dictionary. Did you mean "apple"?"
function notIn(dictionary, key) {
  const guess = typeof key === "string" ? closest(key, [...dictionary.keys()].filter((k) => typeof k === "string")) : null;
  return `there is no ${show(key, true)} in this dictionary${guess !== null ? `. Did you mean ${show(guess, true)}?` : ""}`;
}

// `dictionary where "Sam" is 20, "Ana" is 31`: `items` holds each key, then its value. A key given twice keeps
// its first place and its last value. `keyOf` makes a key a JavaScript value (the WebAssembly engine's are its own).
export function makeDictionary(items, error, keyOf = (key) => key) {
  const dictionary = new Map();
  for (let i = 0; i < items.length; i += 2) dictionary.set(dictionaryKey(keyOf(items[i]), error), items[i + 1]);
  return dictionary;
}

// `remove key from dictionary`
export function removeKey(key, dictionary, error) {
  if (!isDictionary(dictionary)) error(`can only remove from a dictionary, not ${kindOf(dictionary)}`);
  dictionaryKey(key, error);
  if (!dictionary.has(key)) error(notIn(dictionary, key));
  dictionary.delete(key);
}

// `x is in y`: an item of a list or bytes, a key of a dictionary, or a piece of a text
function isIn(a, b, error = oops) {
  if (isList(b)) return b.some((x) => equal(a, x));
  if (isBytes(b)) return b.includes(a);
  if (isDictionary(b)) return b.has(a);
  if (typeof a !== "string" || typeof b !== "string") error(`can't check if ${kindOf(a)} is in ${kindOf(b)}`);
  return b.includes(a);
}

export function compare(op, a, b, error = oops) {
  if (op === "is") return equal(a, b);
  if (op === "in") return isIn(a, b, error);
  const ok = op === "divisible by"
    ? typeof a === "number" && typeof b === "number"
    : typeof a === typeof b && (typeof a === "number" || typeof a === "string");
  if (!ok) error(`can't check if ${kindOf(a)} is ${op} ${kindOf(b)}`);
  if (op === "divisible by" && b === 0) error("can't divide by zero");
  return COMPARISONS[op](a, b);
}

// `+` when a and b aren't both numbers
export function plus(a, b, error) {
  if (typeof a === "string" || typeof b === "string") return show(a) + show(b);
  error(`can't use '+' on ${kindOf(a)} and ${kindOf(b)}`);
}

// `-`, `*` and `/`
export function arithmetic(op, a, b, error) {
  if (typeof a !== "number" || typeof b !== "number") error(`can't use '${op}' on ${kindOf(a)} and ${kindOf(b)}`);
  if (op === "/" && b === 0) error("can't divide by zero");
  return op === "-" ? a - b : op === "*" ? a * b : a / b;
}

export function negate(v, error) {
  if (typeof v !== "number") error(`'-' needs a number, not ${kindOf(v)}`);
  return -v;
}

export function lengthOf(v, error) {
  if (typeof v === "string") return [...v].length;
  if (isDictionary(v)) return v.size;
  if (!isList(v) && !isBytes(v)) error(`'length of' needs a list, text, dictionary or bytes, not ${kindOf(v)}`);
  return v.length;
}

// `add value to name`: returns the variable's new value
export function addInto(current, value, name, error) {
  if (current === UNSET) error(noValue(name));
  if (isList(current)) {
    current.push(value);
    return current;
  }
  if (typeof current === "string") return current + show(value);
  if (typeof current !== "number" || typeof value !== "number") error(`can't add ${kindOf(value)} to ${kindOf(current)}`);
  return current + value;
}

export function checkRepeat(n, error) {
  if (!Number.isInteger(n) || n < 0) error(`repeat needs a whole number of times, not ${show(n, true)}`);
}

export function checkRange(from, to, error) {
  if (typeof from !== "number" || typeof to !== "number") error(`'from' and 'to' need numbers, not ${kindOf(from)} and ${kindOf(to)}`);
}

// what `for each` goes through: a copy, so adding to the list inside the loop can't make it endless; for a
// dictionary, its keys
export function itemsOf(v, error) {
  if (isDictionary(v)) return [...v.keys()];
  if (!isList(v) && !isBytes(v) && typeof v !== "string") error(`can only go through a list, text, dictionary or bytes, not ${kindOf(v)}`);
  return [...v];
}

export function callable(f, name, error) {
  if (f === UNSET) error(`there is no function called '${name}'`);
  if (!(f instanceof Closure)) error(`'${name}' is ${kindOf(f)}, not a function`);
  return f;
}

export function checkInputs(f, argc, name, error) {
  const n = f.fn.params.length;
  if (argc !== n) error(`'${name}' needs ${plural(n, "input")} but got ${argc}`);
}

// `record with name "Sam", age 20`
export function makeRecord(fields, values) {
  const record = new Record();
  for (let i = 0; i < fields.length; i++) record[fields[i]] = values[i];
  return record;
}

// `name of person`
export function fieldOf(record, field, error) {
  if (!isRecord(record)) error(`can't take '${field}' of ${kindOf(record)}`);
  if (!Object.hasOwn(record, field)) {
    const guess = closest(field, Object.keys(record));
    error(`this record has no '${field}'${guess ? `. Did you mean '${guess}'?` : ""}`);
  }
  return record[field];
}

// the record in `set name of person to ...`; setting a field it doesn't have yet adds it
export function recordFor(record, field, error) {
  if (!isRecord(record)) error(`can only change '${field}' of a record, not ${kindOf(record)}`);
  return record;
}

// Moth's built-in operations: what `uppercase of x`, `split x by y` and the rest do. `run` checks what each
// input is before it does anything that depends on the values, and `needs` says the same for the checker.
const needText = (what, v, error) => {
  if (typeof v !== "string") error(`${what} needs text, not ${kindOf(v)}`);
  return v;
};
// Bits work on whole numbers from 0 to the biggest a Moth number holds exactly, so they never round.
const MAX_BITS = 2 ** 53 - 1;
// a number that's wrong as itself; anything else as what kind it is (as the checker knows only that)
const described = (v) => (typeof v === "number" ? show(v) : kindOf(v));
const bits = (what, v, error) => {
  if (!Number.isInteger(v) || v < 0) error(`${what} needs whole numbers of 0 or more, not ${described(v)}`);
  if (v > MAX_BITS) error(`${what} works on numbers up to ${MAX_BITS}, not ${show(v)}`);
  return v;
};
// JavaScript's own bit operators take 32 bits, so the high bits and the low 32 go through them apart
const bitwise = (op, a, b) => (op(Math.floor(a / 2 ** 32), Math.floor(b / 2 ** 32)) >>> 0) * 2 ** 32 + (op(a >>> 0, b >>> 0) >>> 0);
export const BUILTINS = [
  { name: "uppercase", needs: [["text"]], gives: "text", run: ([t], error) => needText("'uppercase of'", t, error).toUpperCase() },
  { name: "lowercase", needs: [["text"]], gives: "text", run: ([t], error) => needText("'lowercase of'", t, error).toLowerCase() },
  {
    name: "split", needs: [["text"], ["text"]], gives: "list",
    run: ([text, by], error) => {
      needText("'split'", text, error);
      needText("'split ... by'", by, error);
      return by === "" ? [...text] : text.split(by); // by "" gives the letters, an emoji counted as one
    },
  },
  {
    name: "join", needs: [["list"], ["text"]], gives: "text",
    run: ([list, by], error) => {
      if (!isList(list)) error(`'join' needs a list, not ${kindOf(list)}`);
      needText("'join ... with'", by, error);
      return list.map((x) => show(x)).join(by);
    },
  },
  {
    name: "number", needs: [["text", "number"]], gives: "number",
    run: ([text], error) => {
      if (typeof text === "number") return text;
      needText("'number of'", text, error);
      if (!/^\s*-?\d+(\.\d+)?\s*$/.test(text)) error(`${show(text, true)} isn't a number`); // a number as Moth writes them
      return Number(text);
    },
  },
  {
    name: "position", needs: [["text"], ["text"]], gives: "number",
    run: ([part, whole], error) => {
      needText("'position of'", part, error);
      needText("'position of ... in'", whole, error);
      const at = whole.indexOf(part);
      return at < 0 ? 0 : [...whole.slice(0, at)].length + 1; // counted in letters, from 1; 0 if it isn't there
    },
  },
  {
    name: "keys", needs: [["dictionary"]], gives: "list",
    run: ([dictionary], error) => {
      if (!isDictionary(dictionary)) error(`'keys of' needs a dictionary, not ${kindOf(dictionary)}`);
      return [...dictionary.keys()];
    },
  },
  // `a bit and b`, `a bit or b`, `a bit xor b`
  ...[(a, b) => a & b, (a, b) => a | b, (a, b) => a ^ b].map((op, i) => {
    const name = `bit ${["and", "or", "xor"][i]}`;
    return { name, needs: [["number"], ["number"]], gives: "number", run: ([a, b], error) => bitwise(op, bits(`'${name}'`, a, error), bits(`'${name}'`, b, error)) };
  }),
  // `shift x left by 2` is x * 2 * 2; `shift x right by 2` is x / 2 / 2, rounded down
  {
    name: "shift left", needs: [["number"], ["number"]], gives: "number",
    run: ([x, n], error) => {
      bits("'shift'", x, error);
      bits("'shift ... by'", n, error);
      const shifted = x === 0 ? 0 : x * 2 ** n; // 0 * 2 ** 2000 would be 0 * Infinity
      if (shifted > MAX_BITS) error(`${show(x)} shifted left by ${show(n)} is too big: bits work on numbers up to ${MAX_BITS}`);
      return shifted;
    },
  },
  {
    name: "shift right", needs: [["number"], ["number"]], gives: "number",
    run: ([x, n], error) => Math.floor(bits("'shift'", x, error) / 2 ** bits("'shift ... by'", n, error)),
  },
  {
    name: "bytes", needs: [["number"]], gives: "bytes", // `100 bytes`, all 0
    run: ([n], error) => {
      if (!Number.isInteger(n) || n < 0) error(`'bytes' needs a whole number in front of it, not ${described(n)}`);
      return new Uint8Array(n);
    },
  },
  {
    name: "as bytes", needs: [["text", "list", "bytes"]], gives: "bytes", // text as UTF-8, or a list of numbers
    run: ([v], error) => {
      if (typeof v === "string") return new TextEncoder().encode(v);
      if (isBytes(v)) return v.slice();
      if (!isList(v)) error(`'as bytes' needs text, a list or bytes, not ${kindOf(v)}`);
      return Uint8Array.from(v, (x) => byte(x, error));
    },
  },
  {
    name: "as text", needs: [["number", "text", "yes/no", "nothing", "list", "record", "dictionary", "bytes"]], gives: "text",
    run: ([v]) => (isBytes(v) ? new TextDecoder().decode(v) : show(v)), // bytes are read as UTF-8; anything else as `say` shows it
  },
  { name: "as hex", needs: [["number"]], gives: "text", run: ([n], error) => bits("'as hex'", n, error).toString(16) },
  { name: "as binary", needs: [["number"]], gives: "text", run: ([n], error) => bits("'as binary'", n, error).toString(2) },
];

// `ask question`: the answer, as text. `answer` is whoever can answer (a person at a terminal, a page): it gets
// the question as text and returns the answer, or null when there is no more input.
export function askFor(question, answer, error) {
  if (!answer) error("this program asks a question, but nothing can answer it here");
  const reply = answer(show(question));
  if (reply === null || reply === undefined) error("there was no answer to this question: the input ended");
  return String(reply);
}

// `read "notes.txt"` (as text) and `read bytes "photo.png"`. `disk` is whatever holds the files: it has
// read(name, asBytes), which gives the file's text or bytes, or null if there is no such file, and
// write(name, data), where data is text or bytes. Either may throw an Error, whose message is passed on.
export function readFile(name, asBytes, disk, error) {
  if (typeof name !== "string") error(`a file name is text, not ${kindOf(name)}`);
  if (!disk) error("this program reads a file, but there are no files here");
  let data;
  try {
    data = disk.read(name, asBytes);
  } catch (err) {
    error(`can't read '${name}': ${err.message}`);
  }
  if (data === null || data === undefined) error(`there is no file called '${name}'`);
  return data;
}

// `write value to "out.txt"`: bytes as they are, anything else as `say` would show it
export function writeFile(value, name, disk, error) {
  if (typeof name !== "string") error(`a file name is text, not ${kindOf(name)}`);
  if (!disk) error("this program writes a file, but there are no files here");
  try {
    disk.write(name, isBytes(value) ? value.slice() : show(value)); // a copy, so changing the bytes later can't change the file
  } catch (err) {
    error(`can't write '${name}': ${err.message}`);
  }
}

// `fail with value`: stops the program with the value as its message, and keeps the value for whoever ran it
export function failWith(value, error) {
  error(show(value), value);
}

// The turtle: starts in the middle, facing up, with its pen down, and reports each line it draws to `draw`
// as { x1, y1, x2, y2, color, width }, with y going up.
export class Turtle {
  constructor(draw = () => {}) {
    Object.assign(this, { draw, x: 0, y: 0, heading: 90, pen: true, color: "#4f8ff7", width: 2 });
  }

  act(action, value, error = oops) {
    const name = TURTLE_ACTIONS[action];
    if (action < 4 && typeof value !== "number") error(`'${action < 2 ? "move" : "turn"} ${name}' needs a number, not ${kindOf(value)}`);
    if (name === "forward" || name === "back") {
      const steps = name === "forward" ? value : -value;
      const angle = (this.heading * Math.PI) / 180;
      const x = this.x + steps * Math.cos(angle);
      const y = this.y + steps * Math.sin(angle);
      const round = (n) => Math.round(n * 100) / 100 || 0; // 0, not 6.123e-17 or -0, where a line should end at 0
      if (this.pen) this.draw({ x1: round(this.x), y1: round(this.y), x2: round(x), y2: round(y), color: this.color, width: this.width });
      Object.assign(this, { x, y });
    } else if (name === "left" || name === "right") {
      this.heading += name === "left" ? value : -value;
    } else if (name === "color") {
      if (typeof value !== "string") error(`'pen color' needs text like "red", not ${kindOf(value)}`);
      this.color = value;
    } else if (name === "width") {
      if (typeof value !== "number" || value <= 0) error(`'pen width' needs a number above 0, not ${show(value, true)}`);
      this.width = value;
    } else {
      this.pen = name === "down";
    }
  }
}

// ---------- the virtual machine ----------

// Thrown inside the run loop; the loop's catch block turns it into a MothError at the instruction that was running.
class Failure {
  constructor(message, value, final = false) {
    this.message = message;
    this.value = value;
    this.final = final;
  }
}
const oops = (message, value) => {
  throw new Failure(message, value);
};
const stopped = (steps) => {
  throw new Failure(stoppedMessage(steps), undefined, true);
};

const MAX_DEPTH = 100_000; // function calls in progress at once; the VM keeps its own stack, so this is a choice, not a JS limit

export function newEnv(fn, parent) {
  const env = new Array(fn.nslots + 1).fill(UNSET);
  env[0] = parent; // slot 0 links to the scope the function was made in
  return env;
}

// Runs bytecode. A Machine keeps its state between run() calls, so a debugger can pause it and carry on later.
export class Machine {
  // `draw` gets each line the turtle draws (see Turtle), `ask` answers questions (see askFor), `disk` holds
  // the files `read` and `write` use (see readFile), and `args` is what `arguments` gives: a list of text.
  constructor(main, print = console.log, { maxSteps = Infinity, env = newEnv(main, null), draw, ask, disk, args = [] } = {}) {
    Object.assign(this, { main, print, maxSteps, ask, disk, args, fn: main, env, ip: 0, base: 0, steps: 0, stack: [], frames: [], line: 0, done: false });
    this.handlers = []; // the `try`s running, innermost last: where each one's `if it fails` is, and what to go back to
    this.caught = null; // the value of the mistake an `if it fails` is handling
    this.turtle = new Turtle(draw);
  }

  // Runs until the program ends ("done") or, while `pauseAtLines` is on, reaches a LINE marker ("line").
  run({ pauseAtLines = false } = {}) {
    const { frames, print, maxSteps } = this;
    // A stack made right here runs ~1.4x faster than one read off `this`: V8 optimises push and pop best on
    // arrays it saw being created. So each run starts a fresh one with whatever an earlier, paused run left.
    const stack = [];
    for (const v of this.stack) stack.push(v);
    let { fn, env, ip, base, steps } = this; // the hot loop works on locals, written back when it pauses
    let code = fn.code;
    let consts = fn.consts;
    let pc = ip; // instruction being run, for error positions
    let why; // why the loop below stopped

    for (;;) {
    try {
      loop: for (;;) {
        pc = ip;
        switch (code[ip++]) {
          case GET: {
            let e = env;
            for (let d = code[ip]; d > 0; d--) e = e[0];
            const v = e[code[ip + 1]];
            if (v === UNSET) oops(noValue(consts[code[ip + 2]]));
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
            if (to < ip && ++steps > maxSteps) stopped(maxSteps); // jumping back means another loop round
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
            // two numbers is the common case; compare() handles the rest, divisible by and in (the ops after
            // the ones two numbers can't fail), and the error messages
            if (typeof a === "number" && typeof b === "number" && op < DIVISIBLE) stack.push(COMPARE_FNS[op](a, b));
            else stack.push(compare(COMPARE_OPS[op], a, b));
            break;
          }
          case ADD: {
            const b = stack.pop();
            const a = stack.pop();
            stack.push(typeof a === "number" && typeof b === "number" ? a + b : plus(a, b, oops));
            break;
          }
          case SUB:
          case MUL:
          case DIV: {
            const op = code[pc];
            const b = stack.pop();
            const a = stack.pop();
            stack.push(arithmetic(op === SUB ? "-" : op === MUL ? "*" : "/", a, b, oops));
            break;
          }
          case GET_FN: {
            let e = env;
            for (let d = code[ip]; d > 0; d--) e = e[0];
            stack.push(callable(e[code[ip + 1]], consts[code[ip + 2]], oops));
            ip += 3;
            break;
          }
          case CALL: {
            const argc = code[ip];
            const name = consts[code[ip + 1]];
            ip += 2;
            const first = stack.length - argc;
            const callee = stack[first - 1];
            checkInputs(callee, argc, name, oops);
            if (frames.length >= MAX_DEPTH) oops("too much recursion: a function kept calling itself");
            if (++steps > maxSteps) stopped(maxSteps);
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
            while (this.handlers.length && this.handlers.at(-1).frames === frames.length) this.handlers.pop(); // its tries end with it
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
          case NEG:
            stack.push(negate(stack.pop(), oops));
            break;
          case NOT:
            stack.push(!truthy(stack.pop()));
            break;
          case LIST: {
            const n = code[ip++];
            stack.push(stack.splice(stack.length - n, n));
            break;
          }
          case LENGTH:
            stack.push(lengthOf(stack.pop(), oops));
            break;
          case ITEM: {
            const n = stack.pop();
            const [seq, i] = item(stack.pop(), n, false);
            stack.push(itemAt(seq, i));
            break;
          }
          case ITEM_REF: {
            const n = stack.pop();
            stack.push(...item(stack.pop(), n, true)); // leaves the list (or dictionary) and the place for SET_ITEM
            break;
          }
          case SET_ITEM: {
            const v = stack.pop();
            const i = stack.pop();
            putItem(stack.pop(), i, v, oops);
            break;
          }
          case DICT: {
            const n = code[ip++];
            stack.push(makeDictionary(stack.splice(stack.length - n, n), oops));
            break;
          }
          case REMOVE: {
            const dictionary = stack.pop();
            removeKey(stack.pop(), dictionary, oops);
            break;
          }
          case ADD_TO: {
            const value = stack.pop();
            let e = env;
            for (let d = code[ip]; d > 0; d--) e = e[0];
            const slot = code[ip + 1];
            e[slot] = addInto(e[slot], value, consts[code[ip + 2]], oops);
            ip += 3;
            break;
          }
          case SAY: {
            const n = code[ip++];
            print(stack.splice(stack.length - n, n).map((v) => show(v)).join(""));
            break;
          }
          case CHECK_REPEAT:
            checkRepeat(stack[stack.length - 1], oops);
            break;
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
          case CHECK_RANGE:
            checkRange(stack[stack.length - 2], stack[stack.length - 1], oops);
            break;
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
          case ITER:
            stack.push({ items: itemsOf(stack.pop(), oops), i: 0 });
            break;
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
            oops(consts[code[ip]]);
            break;
          case RECORD: {
            const fields = consts[code[ip++]];
            stack.push(makeRecord(fields, stack.splice(stack.length - fields.length, fields.length)));
            break;
          }
          case FIELD:
            stack.push(fieldOf(stack.pop(), consts[code[ip++]], oops));
            break;
          case RECORD_REF: // checks the record in `set name of r to ...` before the value is worked out
            recordFor(stack[stack.length - 1], consts[code[ip++]], oops);
            break;
          case SET_FIELD: {
            const value = stack.pop();
            stack.pop()[consts[code[ip++]]] = value;
            break;
          }
          case ASK:
            stack.push(askFor(stack.pop(), this.ask, oops));
            break;
          case READ:
            stack.push(readFile(stack.pop(), code[ip++] === 1, this.disk, oops));
            break;
          case WRITE: {
            const name = stack.pop();
            writeFile(stack.pop(), name, this.disk, oops);
            break;
          }
          case ARGUMENTS:
            stack.push([...this.args]); // a new list each time, so changing one can't change the next
            break;
          case TRY:
            this.handlers.push({ ip: code[ip++], frames: frames.length, stack: stack.length, fn, env, base });
            break;
          case END_TRY:
            this.handlers.pop();
            break;
          case CAUGHT:
            stack.push(this.caught);
            break;
          case BUILTIN: {
            const builtin = BUILTINS[code[ip++]];
            stack.push(builtin.run(stack.splice(stack.length - builtin.needs.length), oops));
            break;
          }
          case FAIL:
            failWith(stack.pop(), oops);
            break;
          case TURTLE: {
            const action = code[ip++];
            this.turtle.act(action, action < 4 || action > 5 ? stack.pop() : null); // pen up and pen down take no value
            break;
          }
          case LINE:
            this.line = code[ip++];
            if (pauseAtLines) {
              why = "line";
              break loop;
            }
            break;
          case HALT:
            this.done = true;
            why = "done";
            break loop;
        }
      }
      break;
    } catch (err) {
      // with no recursion in the VM, a RangeError here means a string or list grew past what JavaScript allows
      const failure = err instanceof RangeError ? new Failure("a value got too big to fit in memory") : err;
      if (!(failure instanceof Failure)) throw err;
      const handler = failure.final ? undefined : this.handlers.pop();
      if (!handler) fail(fn.at[pc], failure.message, failure.value, failure.final, this.trail(fn));
      // back to where the `try` began: its function, its stack, then on to its `if it fails`
      frames.length = handler.frames;
      ({ fn, env, base } = handler);
      code = fn.code;
      consts = fn.consts;
      stack.length = handler.stack;
      ip = handler.ip;
      this.caught = failure.value !== undefined ? failure.value : failure.message;
    }
    }
    Object.assign(this, { fn, env, ip, base, steps, stack });
    return why;
  }

  // The calls in progress, for a mistake (see trailOf), while `fn` runs. Each frame was saved by a CALL, which
  // has two operands, so the call it made is the instruction three before where it returns to.
  trail(fn) {
    const calls = [];
    for (let i = this.frames.length - 1; i >= 0; i--) {
      const caller = this.frames[i];
      calls.push({ name: fn.name, at: caller.fn.at[caller.ip - 3] });
      fn = caller.fn;
    }
    return trailOf(calls);
  }

  // For a debugger: the functions being run (outermost first), and every variable with a value that the
  // running function can see, innermost scope first: its own, then those of the functions it was made
  // inside, then the top level's. Scopes and functions nest the same way, so the two chains walk together.
  inspect() {
    const scopes = [];
    for (let fn = this.fn, env = this.env; fn; fn = fn.parent, env = env[0]) {
      scopes.push({ name: fn.name, vars: fn.names.flatMap((name, slot) => (env[slot] === UNSET ? [] : [[name, show(env[slot], true)]])) });
    }
    return { line: this.line, calls: [...this.frames.map((f) => f.fn.name), this.fn.name], scopes };
  }
}

export function execute(main, print, maxSteps, env, ask, disk, args) {
  new Machine(main, print, { maxSteps, env, ask, disk, args }).run();
}
