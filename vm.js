// The Moth virtual machine: runs the bytecode that moth.js compiles. It imports only pictures.js, which
// imports nothing, so the playground's worker and a page made from an app can carry the two as they are.
import { decodePicture } from "./pictures.js";

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

// Thrown by `stop the program`, which ends a run on purpose with the number the program ends with (0 if it
// gives none). It isn't a mistake, so no `try` catches it; run() in moth.js hands the number on.
export class Ended {
  constructor(code) {
    this.code = code;
  }
}

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

// ---------- numbers, as a spreadsheet has them ----------
// Moth works to 15 significant digits, like a spreadsheet: 0.1 + 0.2 is 0.3. The arithmetic is the computer's
// own, fast and binary, but a number is shown, compared, and used as a whole number by its value to 15
// digits: `canon`. A whole number is always exactly itself.
export const canon = (x) => (Number.isInteger(x) || !Number.isFinite(x) ? x : Number(x.toPrecision(15)));

// How two numbers compare, as their values to 15 digits do: -1, 0 or 1, or NaN if either is NaN. Most pairs
// don't need canon: two whole numbers, or two numbers further apart than 15 digits can tell.
export function numberOrder(a, b) {
  if (a === b) return 0;
  if (!(Number.isInteger(a) && Number.isInteger(b)) && Math.abs(a - b) <= 1e-14 * Math.max(Math.abs(a), Math.abs(b))) {
    [a, b] = [canon(a), canon(b)];
    if (a === b) return 0;
  }
  return a < b ? -1 : a > b ? 1 : NaN;
}
export const atMost = (a, b) => a <= b || numberOrder(a, b) === 0; // a count loop's test: `for each i from 1 to n`

// `a is divisible by b`: whole numbers by their remainder, anything else by whether a / b is whole, to 15 digits
export const divisible = (a, b) => (Number.isInteger(a) && Number.isInteger(b) ? a % b === 0 : Number.isInteger(canon(a / b)));

export const COMPARISONS = {
  "is": (a, b) => equal(a, b),
  "less than": (a, b) => (typeof a === "number" ? numberOrder(a, b) === -1 : a < b),
  "greater than": (a, b) => (typeof a === "number" ? numberOrder(a, b) === 1 : a > b),
  "at least": (a, b) => (typeof a === "number" ? numberOrder(a, b) >= 0 : a >= b),
  "at most": (a, b) => (typeof a === "number" ? numberOrder(a, b) <= 0 : a <= b),
  "divisible by": (a, b) => divisible(a, b),
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
  ["EXPECT", 2], // which comparison (COMPARE_OPS), or -1 for just a value that must be yes; and 1 for `is not`
  ["RANDOM", 0],
  ["HANDLE", 1], // the function on the stack handles an event, one of EVENTS
  ["EVERY", 1], // the function on the stack runs every so often: the number under it, times the operand (1 or 1000)
  ["SAY_ERROR", 1], // as SAY, but the line goes to the error output
  ["EXIT", 0], // `stop the program with` the number on the stack
  ["REMOVE_FILE", 0], // `remove the file` named on the stack
  ["NOW", 1], // `the time`, `the date` and the rest: the operand is which, in NOW_WORDS
  ["WAIT", 1], // `wait` the number on the stack, times the operand (milliseconds in each)
  ["READ_FOLDER", 0], // `read the folder` named on the stack
  ["PLAY", 1], // `play note` with how long on the stack, above the note, in units of the operand's milliseconds; 0 for `play a beep`
  ["WORKER", 2], // as CALL, for `start f(x) on another core`: the call made on copies, and a worker given back (see workerCopy)
];
export const OP = Object.fromEntries(OPCODES.map(([name], i) => [name, i]));
const { GET, SET, CONST, JUMP, JUMP_IF_FALSE, COMPARE, ADD, SUB, MUL, DIV, CALL, GET_FN, RETURN, POP, AND, OR, NEG, NOT,
  LIST, LENGTH, ITEM, ITEM_REF, SET_ITEM, ADD_TO, SAY, CHECK_REPEAT, REPEAT_NEXT, CHECK_RANGE, RANGE_NEXT, ITER, ITER_NEXT,
  MAKE_FN, UNDEFINED, HALT, LINE, TURTLE, RECORD, FIELD, RECORD_REF, SET_FIELD, FAIL, BUILTIN, ASK, TRY, END_TRY, CAUGHT, DICT, REMOVE, READ, WRITE, ARGUMENTS, EXPECT, RANDOM, HANDLE, EVERY, SAY_ERROR, EXIT, REMOVE_FILE, NOW, WAIT,
  READ_FOLDER, PLAY, WORKER } = OP;
// `move forward 10`, `turn left 90`, `pen up`, `pen color "red"`...; the first four and the last two take a value
export const TURTLE_ACTIONS = ["forward", "back", "left", "right", "up", "down", "color", "width",
  "to", "clear", "box", "circle", "text", "chart", "picture", // `move to x, y`, `clear`, `draw box at ...`, `draw circle at ...`, `draw "hi" at ...`, `draw chart of ...`, `draw picture "cat.png" at ...`
  "button", "text box", "clear text box", // `draw button "Start" at ...`, `draw text box "Name" at ...`, `clear the text box "Name"`
  "checkbox", "tick", "untick", "text area", "list", // `draw checkbox "Done" at ...`, `tick the checkbox "Done"`, `untick ...`, `draw text area ...`, `draw list ...`
  "dropdown", "slider", "set slider"]; // `draw dropdown "Size" showing ... at ...`, `draw slider "Volume" from 0 to 100 at ...`, `set the slider "Volume" to 50`
// the drawing commands that take no value; the rest take one, which for the later ones is a list of numbers
export const TURTLE_BARE = new Set(["up", "down", "clear"].map((name) => TURTLE_ACTIONS.indexOf(name)));

// ---------- values ----------

// A Moth function. `fn` is its compiled code (or, from the JIT, just its name and inputs plus `run`, the
// JavaScript function it became); `env` is the scope it was made in.
export class Closure {
  constructor(fn, env) {
    this.fn = fn;
    this.env = env;
  }
}

// ---------- amounts with units: 5 km, 2 hours, 300 g ----------
// What each unit measures, and each unit: how it is written for one and for many, what it measures, and
// how many of that measure's base unit (a metre, a second, a gram, a litre) it is.
export const MEASURES = ["a distance", "a time", "a weight", "a volume"];
export const UNITS = [
  ["mm", "mm", 0, 0.001], ["cm", "cm", 0, 0.01], ["m", "m", 0, 1], ["km", "km", 0, 1000],
  ["millimetre", "millimetres", 0, 0.001], ["centimetre", "centimetres", 0, 0.01], ["metre", "metres", 0, 1], ["kilometre", "kilometres", 0, 1000],
  ["millimeter", "millimeters", 0, 0.001], ["centimeter", "centimeters", 0, 0.01], ["meter", "meters", 0, 1], ["kilometer", "kilometers", 0, 1000],
  ["inch", "inches", 0, 0.0254], ["foot", "feet", 0, 0.3048], ["yard", "yards", 0, 0.9144], ["mile", "miles", 0, 1609.344],
  ["millisecond", "milliseconds", 1, 0.001], ["second", "seconds", 1, 1], ["minute", "minutes", 1, 60], ["hour", "hours", 1, 3600],
  ["day", "days", 1, 86400], ["week", "weeks", 1, 604800],
  ["mg", "mg", 2, 0.001], ["g", "g", 2, 1], ["kg", "kg", 2, 1000], ["milligram", "milligrams", 2, 0.001], ["gram", "grams", 2, 1],
  ["kilogram", "kilograms", 2, 1000], ["ounce", "ounces", 2, 28.349523125], ["pound", "pounds", 2, 453.59237], ["tonne", "tonnes", 2, 1000000],
  ["ml", "ml", 3, 0.001], ["millilitre", "millilitres", 3, 0.001], ["litre", "litres", 3, 1], ["milliliter", "milliliters", 3, 0.001], ["liter", "liters", 3, 1],
];
const UNIT_WORDS = new Map(UNITS.flatMap(([one, many], i) => [[one, i], [many, i]]));
export const unitNamed = (word) => UNIT_WORDS.get(word); // a unit's place in UNITS, by either way it is written

// An amount of a unit. It never changes: arithmetic makes a new one.
export class Quantity {
  constructor(amount, unit) {
    this.amount = amount;
    this.unit = unit;
  }
}
export const isQuantity = (v) => v instanceof Quantity;
export const measureOf = (q) => UNITS[q.unit][2];
// q's amount in another unit of the same measure: 5 km is 5000 in m
const amountIn = (q, unit) => (q.unit === unit ? q.amount : (q.amount * UNITS[q.unit][3]) / UNITS[unit][3]);
const sameMeasure = (a, b) => isQuantity(a) && isQuantity(b) && measureOf(a) === measureOf(b);

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
// `comparing` holds the pairs being compared further up: a list that holds itself comes round to the same
// pair again, which counts as equal so far, instead of going round for ever. It's made only for lists,
// dictionaries and records: two texts, the comparison programs make most, need none.
export function equal(a, b, comparing) {
  if (a === b) return true;
  if (typeof a === "string" || typeof b === "string" || a === null || b === null || typeof a === "boolean") return false;
  if (typeof a === "number" && typeof b === "number") return numberOrder(a, b) === 0;
  if (isQuantity(a) || isQuantity(b)) return sameMeasure(a, b) && numberOrder(a.amount, amountIn(b, a.unit)) === 0; // 1 km is 1000 m
  if (isBytes(a) && isBytes(b)) return a.length === b.length && a.every((x, i) => x === b[i]);
  const both = (test) => test(a) && test(b);
  if (!both(isList) && !both(isDictionary) && !both(isRecord)) return false;
  comparing ??= new Map();
  if (comparing.get(a)?.has(b)) return true;
  if (!comparing.has(a)) comparing.set(a, new Set());
  comparing.get(a).add(b);
  let same;
  if (isList(a)) same = a.length === b.length && a.every((x, i) => equal(x, b[i], comparing));
  else if (isDictionary(a)) same = a.size === b.size && [...a].every(([key, value]) => b.has(key) && equal(value, b.get(key), comparing));
  else {
    const fields = Object.keys(a);
    same = fields.length === Object.keys(b).length && fields.every((f) => Object.hasOwn(b, f) && equal(a[f], b[f], comparing));
  }
  comparing.get(a).delete(b);
  return same;
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
  if (isQuantity(v)) return MEASURES[measureOf(v)];
  return "a number";
}

// `showing` holds the values being shown further up: a list that holds itself shows as [...] where it
// comes round again, and a record or dictionary as (...).
export function show(v, nested = false, showing = new Set()) {
  if (v === null) return "nothing";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "string") return nested ? JSON.stringify(v) : v;
  if (v instanceof Closure) return `<function ${v.fn.name}>`;
  if (isBytes(v)) return `(${plural(v.length, "byte")}${v.length ? `: ${v.join(", ")}` : ""})`;
  if (isQuantity(v)) return `${show(v.amount)} ${UNITS[v.unit][Math.abs(canon(v.amount)) === 1 ? 0 : 1]}`; // 1 mile, 2 miles
  if (!isList(v) && !isRecord(v) && !isDictionary(v)) return String(canon(v)); // a number, to 15 digits
  if (showing.has(v)) return isList(v) ? "[...]" : "(...)";
  showing.add(v);
  const inner = (x) => show(x, true, showing);
  let text;
  if (isList(v)) text = `[${v.map(inner).join(", ")}]`;
  else if (isRecord(v)) {
    const fields = Object.keys(v);
    text = fields.length ? `(record with ${fields.map((f) => `${f} ${inner(v[f])}`).join(", ")})` : "(empty record)";
  } else {
    const entries = [...v].map(([key, value]) => `${inner(key)} is ${inner(value)}`);
    text = entries.length ? `(dictionary where ${entries.join(", ")})` : "(empty dictionary)";
  }
  showing.delete(v); // the same value twice side by side, not inside itself, shows in full both times
  return text;
}

// ---------- what operations do, shared by both engines ----------
// The VM below and the JIT (jit.js) run every check through these, so they can't drift apart. Each takes
// `error`, which throws: the VM's version positions the error at the instruction it was running, the JIT's
// at the spot in the source the code came from.

// Where `item n of target` is: [the list (or the text's letters, the bytes or the dictionary), the place in
// it]. Any key of a dictionary can be set, but one that is read must be there.
// A text's letters, an emoji counted as one. The last text asked about is remembered, so going through a long
// text a letter at a time, `item k of words` for each k, takes as long as the text is, not that squared.
let lettersText = null;
let lettersMade = [];
export function lettersOf(text) {
  if (text !== lettersText) [lettersText, lettersMade] = [text, [...text]];
  return lettersMade;
}

export function item(target, n, writing, error = oops) {
  if (typeof n === "number") n = canon(n); // 0.1 * 30 is item 3
  if (isDictionary(target)) {
    n = dictionaryKey(n, error);
    if (!writing && !target.has(n)) error(notIn(target, n));
    return [target, n];
  }
  if (writing && !isList(target) && !isBytes(target)) error(`can only change items of a list, dictionary or bytes, not ${kindOf(target)}`);
  if (!isList(target) && !isBytes(target) && typeof target !== "string") error(`can only take an item of a list, text, dictionary or bytes, not ${kindOf(target)}`);
  const seq = typeof target === "string" ? lettersOf(target) : target; // by character, so "é" and emoji count as one
  if (!Number.isInteger(n)) error(`item numbers must be whole numbers, not ${show(n, true)}`);
  if (n < 1) error(`there is no item ${n}, items are counted from 1`);
  if (n > seq.length) {
    if (isBytes(target)) error(`there is no item ${n}, there are only ${plural(seq.length, "byte")}`);
    error(`there is no item ${n}, the ${isList(target) ? "list" : "text"} only has ${plural(seq.length, isList(target) ? "item" : "letter")}`);
  }
  return [seq, n - 1];
}

const byte = (v, error) => {
  if (typeof v === "number") v = canon(v);
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
  return typeof key === "number" ? canon(key) : key; // so 0.1 + 0.2 finds the key 0.3
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
  key = dictionaryKey(key, error);
  if (!dictionary.has(key)) error(notIn(dictionary, key));
  dictionary.delete(key);
}

// `x is in y`: an item of a list or bytes, a key of a dictionary, or a piece of a text
function isIn(a, b, error = oops) {
  if (isList(b)) return b.some((x) => equal(a, x));
  if (isBytes(b)) return typeof a === "number" && b.includes(canon(a));
  if (isDictionary(b)) return b.has(typeof a === "number" ? canon(a) : a);
  if (typeof a !== "string" || typeof b !== "string") error(`can't check if ${kindOf(a)} is in ${kindOf(b)}`);
  return b.includes(a);
}

export function compare(op, a, b, error = oops) {
  if (op === "is") return equal(a, b);
  if (op === "in") return isIn(a, b, error);
  const ok = op === "divisible by"
    ? typeof a === "number" && typeof b === "number"
    : (typeof a === typeof b && (typeof a === "number" || typeof a === "string")) || sameMeasure(a, b);
  if (!ok) error(`can't check if ${kindOf(a)} is ${op} ${kindOf(b)}`);
  if (op === "divisible by" && b === 0) error("can't divide by zero");
  if (isQuantity(a)) return COMPARISONS[op](a.amount, amountIn(b, a.unit)); // in a's unit
  return COMPARISONS[op](a, b);
}

// `+` when a and b aren't both numbers
export function plus(a, b, error) {
  if (typeof a === "string" || typeof b === "string") return show(a) + show(b);
  if (sameMeasure(a, b)) return new Quantity(a.amount + amountIn(b, a.unit), a.unit); // 5 km + 300 m is 5.3 km
  error(`can't use '+' on ${kindOf(a)} and ${kindOf(b)}`);
}

// `-`, `*` and `/`
export function arithmetic(op, a, b, error) {
  if (typeof a === "number" && typeof b === "number") {
    if (op === "/" && b === 0) error("can't divide by zero");
    return op === "-" ? a - b : op === "*" ? a * b : a / b;
  }
  // amounts: less an amount of the same measure, times a number, or over a number (or an amount of the same
  // measure, which gives how many times it goes in)
  if (op === "-" && sameMeasure(a, b)) return new Quantity(a.amount - amountIn(b, a.unit), a.unit);
  if (op === "*" && isQuantity(a) && typeof b === "number") return new Quantity(a.amount * b, a.unit);
  if (op === "*" && typeof a === "number" && isQuantity(b)) return new Quantity(a * b.amount, b.unit);
  if (op === "/" && isQuantity(a) && (typeof b === "number" || sameMeasure(a, b))) {
    const by = typeof b === "number" ? b : amountIn(b, a.unit);
    if (by === 0) error("can't divide by zero");
    return typeof b === "number" ? new Quantity(a.amount / by, a.unit) : a.amount / by;
  }
  error(`can't use '${op}' on ${kindOf(a)} and ${kindOf(b)}`);
}

export function negate(v, error) {
  if (isQuantity(v)) return new Quantity(-v.amount, v.unit);
  if (typeof v !== "number") error(`'-' needs a number, not ${kindOf(v)}`);
  return -v;
}

export function lengthOf(v, error) {
  if (typeof v === "string") return lettersOf(v).length;
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
  if (sameMeasure(current, value)) return new Quantity(current.amount + amountIn(value, current.unit), current.unit);
  if (typeof current !== "number" || typeof value !== "number") error(`can't add ${kindOf(value)} to ${kindOf(current)}`);
  return current + value;
}

// how many times a `repeat` goes round: a whole number, to 15 digits
export function checkRepeat(n, error) {
  if (typeof n === "number") n = canon(n);
  if (!Number.isInteger(n) || n < 0) error(`repeat needs a whole number of times, not ${show(n, true)}`);
  return n;
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

// Inputs that say what they are: `to area with width as a number`. A function's `kinds` has one of these for
// each input that says, by its number here, and -1 for the others; a function whose inputs say nothing has none.
export const KINDS = ["a number", "text", "yes or no", "a list", "a record", "a dictionary", "bytes", "a function"];
const KIND_TESTS = [(v) => typeof v === "number", (v) => typeof v === "string", (v) => typeof v === "boolean", isList, isRecord, isDictionary, isBytes,
  (v) => v instanceof Closure];
export const fitsKind = (kind, v) => kind < 0 || KIND_TESTS[kind](v);

// Checked at the call, after the number of inputs: `args[from + i]` is input i
export function checkKinds(f, args, name, error, from = 0) {
  const { kinds, params } = f.fn;
  for (let i = 0; i < kinds.length; i++) {
    if (!fitsKind(kinds[i], args[from + i])) error(`'${name}' needs ${params[i]} to be ${KINDS[kinds[i]]}, not ${kindOf(args[from + i])}`);
  }
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
  if (typeof v === "number") v = canon(v);
  if (!Number.isInteger(v) || v < 0) error(`${what} needs whole numbers of 0 or more, not ${described(v)}`);
  if (v > MAX_BITS) error(`${what} works on numbers up to ${MAX_BITS}, not ${show(v)}`);
  return v;
};
// JavaScript's own bit operators take 32 bits, so the high bits and the low 32 go through them apart
const bitwise = (op, a, b) => (op(Math.floor(a / 2 ** 32), Math.floor(b / 2 ** 32)) >>> 0) * 2 ** 32 + (op(a >>> 0, b >>> 0) >>> 0);
// what the checker calls each measure, as a type
export const MEASURE_TYPES = ["distance", "time", "weight", "volume"];

const isNumberText = (text) => /^\s*-?\d+(\.\d+)?\s*$/.test(text); // a number as Moth writes them, spaces around it allowed

// ---------- tables: `read table "sales.csv"`, `total of price in sales` ----------

// A CSV file's text as a table: a list of records, one for each row after the first, whose cells name the
// fields (in lower case, with _ for anything but letters, digits and _). A cell that is a number is that
// number, an empty one (or one the row is missing) is nothing, and any other is text. Cells in "quotes" can hold commas, line
// breaks and "" for a quote; blank lines are skipped.
export function tableOf(text, error) {
  needText("'read table'", text, error);
  const rows = [];
  let [row, cell, quoted] = [[], "", false];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c !== '"') cell += c;
      else if (text[i + 1] === '"') (cell += '"'), i++;
      else quoted = false;
    } else if (c === '"' && cell === "") quoted = true;
    else if (c === ",") row.push(cell), (cell = "");
    else if (c === "\n" || c === "\r") {
      row.push(cell);
      rows.push(row);
      [row, cell] = [[], ""];
      if (c === "\r" && text[i + 1] === "\n") i++;
    } else cell += c;
  }
  if (cell !== "" || row.length) row.push(cell), rows.push(row);
  const [header, ...data] = rows.filter((r) => r.length > 1 || r[0] !== "");
  if (!header) return [];
  const used = new Set();
  const names = header.map((cell, i) => {
    let name = cell.replace(/[A-Z]/g, (c) => c.toLowerCase()).replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
    if (name === "") name = `column_${i + 1}`;
    else if (/^[0-9]/.test(name)) name = `column_${name}`;
    while (used.has(name)) name += `_${i + 1}`;
    used.add(name);
    return name;
  });
  return data.map((r) => makeRecord(names, names.map((_, j) => (j >= r.length || r[j] === "" ? null : isNumberText(r[j]) ? Number(r[j]) : r[j]))));
}

// What `total of`, `average of`, `largest of` and `smallest of` work on: the items that aren't nothing (as a
// spreadsheet skips empty cells)
function present(what, list, error) {
  if (!isList(list)) error(`'${what} of' needs a list, not ${kindOf(list)}`);
  return list.filter((x) => x !== null);
}

// `total of`, and `average of` before it divides: numbers, or amounts of one measure (in the first one's unit)
function sumOf(what, items, error) {
  let sum = 0;
  items.forEach((x, i) => {
    if (typeof x !== "number" && !isQuantity(x)) error(`'${what} of' needs numbers, not ${kindOf(x)}`);
    if (i === 0) sum = x;
    else if (typeof sum === "number" && typeof x === "number") sum += x;
    else if (sameMeasure(sum, x)) sum = new Quantity(sum.amount + amountIn(x, sum.unit), sum.unit);
    else error(`'${what} of' can't add ${kindOf(x)} to ${kindOf(sum)}`);
  });
  return sum;
}

// `largest of`, `smallest of`: the first of the items no other beats
function extreme(what, list, error) {
  const items = present(what, list, error);
  if (!items.length) error(`'${what} of' needs a list with something in it`);
  let best = items[0];
  for (let i = 1; i < items.length; i++) if (compare(what === "largest" ? "greater than" : "less than", items[i], best, error)) best = items[i];
  return best;
}

// what `save`, `as json` and `send` take
const SAVABLE = ["number", "text", "yes/no", "nothing", "list", "record", "dictionary"];

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
    name: "number", needs: [["text", "number", ...MEASURE_TYPES]], gives: "number",
    run: ([text], error) => {
      if (typeof text === "number") return text;
      if (isQuantity(text)) return text.amount; // the number alone: `number of (trip in miles)`
      needText("'number of'", text, error);
      if (!isNumberText(text)) error(`${show(text, true)} isn't a number`);
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
      if (typeof n === "number") n = canon(n);
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
    name: "as text", needs: [["number", "text", "yes/no", "nothing", "list", "record", "dictionary", "bytes", ...MEASURE_TYPES]], gives: "text",
    run: ([v]) => (isBytes(v) ? new TextDecoder().decode(v) : show(v)), // bytes are read as UTF-8; anything else as `say` shows it
  },
  { name: "as hex", needs: [["number"]], gives: "text", run: ([n], error) => bits("'as hex'", n, error).toString(16) },
  { name: "as binary", needs: [["number"]], gives: "text", run: ([n], error) => bits("'as binary'", n, error).toString(2) },
  // `5 km`: a number written out with a unit after it (the parser makes these), and `trip in miles`. What they
  // give depends on the unit, so the checker works it out itself.
  {
    name: "unit", needs: [["number"], ["text"]], gives: null,
    run: ([n, word], error) => {
      if (typeof n !== "number") error(`'${word}' needs a number in front of it, not ${kindOf(n)}`);
      return new Quantity(n, unitNamed(word));
    },
  },
  {
    name: "in", needs: [MEASURE_TYPES, ["text"]], gives: null,
    run: ([q, word], error) => {
      const unit = unitNamed(word);
      if (!isQuantity(q) || measureOf(q) !== UNITS[unit][2]) error(`'in ${word}' needs ${MEASURES[UNITS[unit][2]]}, not ${kindOf(q)}`);
      return new Quantity(amountIn(q, unit), unit);
    },
  },
  // `read table "sales.csv"` (the parser makes these), `price in sales` (the price of each row: only after
  // `total of` and the like), and what can be worked out from a list
  { name: "table", needs: [["text"]], gives: "list", run: ([text], error) => tableOf(text, error) },
  {
    name: "column", needs: [["text"], ["list"]], gives: "list",
    run: ([field, rows], error) => {
      if (!isList(rows)) error(`'${field} in' needs a list of records, not ${kindOf(rows)}`);
      return rows.map((row) => fieldOf(row, field, error));
    },
  },
  { name: "total", needs: [["list"]], gives: null, run: ([list], error) => sumOf("total", present("total", list, error), error) },
  {
    name: "average", needs: [["list"]], gives: null,
    run: ([list], error) => {
      const items = present("average", list, error);
      const sum = sumOf("average", items, error);
      if (!items.length) error("'average of' needs a list with something in it");
      return isQuantity(sum) ? new Quantity(sum.amount / items.length, sum.unit) : sum / items.length;
    },
  },
  { name: "largest", needs: [["list"]], gives: null, run: ([list], error) => extreme("largest", list, error) },
  { name: "smallest", needs: [["list"]], gives: null, run: ([list], error) => extreme("smallest", list, error) },
  // `run program "tool.exe" with (list of "a")`: starts it, waits for it, and gives the number it ended
  // with; `... keeping its output` gives a record of that number and what it said instead. Only a program
  // moth build makes can start one; anywhere else it's a mistake, once its inputs are what they must be.
  ...["run program", "run program keeping"].map((name) => ({
    name, needs: [["text"], ["list"]], gives: name === "run program" ? "number" : "record",
    run: ([program, args], error) => {
      needText("'run program'", program, error);
      if (!isList(args)) error(`'run program ... with' needs a list, not ${kindOf(args)}`);
      for (const arg of args) needText("'run program ... with'", arg, error);
      error("can't run programs here: only a program made by moth build can");
    },
  })),
  // `scores in order`, `scores in reverse order`, `people in order by age`: a new list, sorted (see inOrder)
  ...["order", "reverse order"].flatMap((how) => [
    { name: how, needs: [["list"]], gives: "list", run: ([list], error) => inOrder(list, null, how !== "order", error) },
    { name: `${how} by`, needs: [["list"], ["text"]], gives: "list", run: ([list, field], error) => inOrder(list, field, how !== "order", error) },
  ]),
  // `save scores to "scores.txt"` writes what this makes; `load "scores.txt"` reads it back (see savedText)
  { name: "save", needs: [SAVABLE], gives: "text", run: ([value], error) => savedText(value, error) },
  { name: "load", needs: [["text"]], gives: null, run: ([text], error) => loadedValue(text, error) },
  // `scores as json`, `json from reply`, `send data to "https://..."` (with headers), and `read` with headers
  // (see jsonText, jsonValue and sendTo). A builtin that goes online gets the program's disk.
  { name: "as json", needs: [SAVABLE], gives: "text", run: ([value], error) => jsonText(value, error, "'as json' can't write") },
  { name: "json from", needs: [["text"]], gives: null, run: ([text], error) => jsonValue(text, error) },
  { name: "send", needs: [SAVABLE, ["text"]], gives: "text", run: ([body, address], error, turtle, disk) => sendTo(body, address, null, disk, error) },
  {
    name: "send with headers", needs: [SAVABLE, ["text"], ["dictionary"]], gives: "text",
    run: ([body, address, headers], error, turtle, disk) => sendTo(body, address, headers, disk, error),
  },
  ...[["read with headers", false, "text"], ["read bytes with headers", true, "bytes"]].map(([name, asBytes, gives]) => ({
    name, needs: [["text"], ["dictionary"]], gives, run: ([address, headers], error, turtle, disk) => readFile(address, asBytes, disk, error, headers),
  })),
  // `the checkbox "Done" is ticked`, and `the choice in the list "Fruits"`: the item chosen, or nothing
  { name: "ticked", needs: [["number", "text", "yes/no", "nothing", "list", "record", "dictionary", "bytes", "function", ...MEASURE_TYPES]], gives: "yes/no", run: ([label], error, turtle) => turtle?.ticks.get(show(label)) ?? false },
  {
    name: "choice in list", needs: [["number", "text", "yes/no", "nothing", "list", "record", "dictionary", "bytes", "function", ...MEASURE_TYPES]], gives: null,
    run: ([label], error, turtle) => {
      const [items, chosen] = [turtle?.items.get(show(label)), turtle?.choices.get(show(label))];
      return items && chosen !== undefined && chosen < items.length ? items[chosen] : null;
    },
  },
  // `the text in the text box "Name"`: what's typed in it so far (see Turtle). The checker has no turtle.
  { name: "text in box", needs: [["number", "text", "yes/no", "nothing", "list", "record", "dictionary", "bytes", "function", ...MEASURE_TYPES]], gives: "text", run: ([label], error, turtle) => turtle?.texts.get(show(label)) ?? "" },
  // `the value of the slider "Volume"`: a whole number, or nothing for one never drawn or set (DESIGN §42)
  { name: "slider value", needs: [["number", "text", "yes/no", "nothing", "list", "record", "dictionary", "bytes", "function", ...MEASURE_TYPES]], gives: null, run: ([label], error, turtle) => turtle?.values.get(show(label)) ?? null },
  // `choose a file to open`: what `ask "Which file to open?"` gives, or nothing for no answer (DESIGN §42)
  { name: "chosen file", needs: [["text", "nothing"]], gives: null, run: ([answer]) => (answer === "" || answer === null ? null : answer) },
  // the body of a library's function (see library in moth.js): only a program moth build makes can call one
  {
    name: "library call", needs: [["text"]], gives: null,
    run: ([library], error) => error(`can't use the library '${library}' here: only a program made by moth build can`),
  },
  // `start count(10)` and `wait for job` (see taskOf)
  { name: "power", needs: [["number"], ["number"]], gives: "number", run: ([x, n], error) => power(x, n, error) },
  { name: "items", needs: [["number"], ["number"], ["list", "text", "bytes"]], gives: null, run: ([from, upto, x], error) => slice(from, upto, x, error) },
  ...["rounded down", "rounded up", "rounded"].map((how) => ({ name: how, needs: [["number"]], gives: "number", run: ([x], error) => rounded(how, x, error) })),
  { name: "remainder", needs: [["number"], ["number"]], gives: "number", run: ([a, b], error) => remainder(a, b, error) },
  { name: "start", needs: [["number", "text", "yes/no", "nothing", "list", "record", "dictionary", "bytes", "function", ...MEASURE_TYPES]], gives: "record", run: ([gave]) => taskOf(gave) },
  { name: "wait for", needs: [["record"]], gives: null, run: ([task], error) => waitedFor(task, error) },
  { name: "has ended", needs: [["record"]], gives: "yes/no", run: ([task], error) => taskEnded(task, error) },
  // `start count(10) on another core`: each engine makes the call itself (see startWorker)
  { name: "start worker", needs: [["number", "text", "yes/no", "nothing", "list", "record", "dictionary", "bytes", "function", ...MEASURE_TYPES]], gives: "record", run: (_, error) => error("a worker is started by the engine") },
];

// `x to the power of n` (DESIGN §66): n a whole number to 15 digits, as an item's number is, and x multiplied by
// itself by squaring, the bits of n from the lowest, so machine code, doing the same multiplications in the
// same order, gives the same bits. Past 2^62 a whole number is even, as 2^62 is, so it counts as that.
function power(x, n, error) {
  if (typeof x !== "number") error(`'to the power of' needs a number, not ${kindOf(x)}`);
  if (typeof n !== "number") error(`'to the power of' needs a number, not ${kindOf(n)}`);
  let k = canon(n);
  if (!Number.isInteger(k)) error(`'to the power of' needs a whole number, not ${show(n)}: math.moth's power(x, y) takes any`);
  k = Math.max(-(2 ** 62), Math.min(2 ** 62, k));
  if (x === 0 && k < 0) error("can't raise 0 to a power below 0");
  let [made, base, left] = [1, x, Math.abs(k)];
  while (left > 0) {
    if (left % 2 === 1) made *= base;
    left = Math.floor(left / 2);
    if (left > 0) base *= base;
  }
  return k < 0 ? 1 / made : made;
}

// `x rounded down`, `x rounded up`, `x rounded` (DESIGN §66): a whole number, from x as it's shown, to 15
// digits, so (0.1 * 30) rounded down is 3; a half rounds away from 0. A whole number is itself.
function rounded(how, x, error) {
  if (typeof x !== "number") error(`'${how}' needs a number, not ${kindOf(x)}`);
  const c = canon(x);
  if (Number.isInteger(c) || !Number.isFinite(c)) return c;
  if (how === "rounded down") return Math.floor(c) + 0; // + 0: never -0
  if (how === "rounded up") return Math.ceil(c) + 0;
  const size = Math.abs(c);
  const whole = Math.floor(size);
  const near = size - whole >= 0.5 ? whole + 1 : whole;
  return (c < 0 ? -near : near) + 0;
}

// `remainder of 17 divided by 5`: what's left over, which has the divisor's sign (so -7 by 3 leaves 2). Of two
// whole numbers, exactly; else 0 whenever `is divisible by` says so, and a - b times a / b, to 15 digits,
// rounded down.
function remainder(a, b, error) {
  if (typeof a !== "number") error(`'remainder of' needs a number, not ${kindOf(a)}`);
  if (typeof b !== "number") error(`'remainder of' needs a number, not ${kindOf(b)}`);
  if (b === 0) error("can't divide by zero");
  if (Number.isInteger(a) && Number.isInteger(b)) {
    const r = a % b;
    return r === 0 ? 0 : (r < 0) !== (b < 0) ? r + b : r;
  }
  if (divisible(a, b)) return 0;
  return a - b * Math.floor(canon(a / b));
}

// `items 2 to 4 of xs` (DESIGN §66): a list's items, text's letters or bytes from one place to another, both
// kept, as a new one of them; none if the second is before the first. The places are as item's are: whole to
// 15 digits, from 1, up to how many there are.
function slice(from, upto, x, error) {
  if (!isList(x) && !isBytes(x) && typeof x !== "string") error(`can only take items of a list, text or bytes, not ${kindOf(x)}`);
  const place = (n) => {
    if (typeof n === "number") n = canon(n);
    if (!Number.isInteger(n)) error(`item numbers must be whole numbers, not ${show(n, true)}`);
    return n;
  };
  const [a, b] = [place(from), place(upto)];
  const seq = typeof x === "string" ? lettersOf(x) : x;
  if (b >= a) {
    if (a < 1) error(`there is no item ${a}, items are counted from 1`);
    if (b > seq.length) {
      if (isBytes(x)) error(`there is no item ${b}, there are only ${plural(seq.length, "byte")}`);
      error(`there is no item ${b}, the ${isList(x) ? "list" : "text"} only has ${plural(seq.length, isList(x) ? "item" : "letter")}`);
    }
  }
  const part = b >= a ? seq.slice(a - 1, b) : seq.slice(0, 0);
  return typeof x === "string" ? part.join("") : part;
}

// Tasks (DESIGN §62): `start count(10)` gives one, a record of its number, and in a program moth build makes
// the call runs on a thread of its own. Here it has run already, as starting a task runs it to its end at
// once, which is one of the ways threads that take turns can go, and what the call gave is kept, by the
// task's number, for `wait for`. They're numbered from 1 in each run, as machine code numbers them.
const tasksGave = new Map();
export const startTasks = () => {
  tasksGave.clear();
  workersGave.clear();
};
function taskOf(gave) {
  tasksGave.set(tasksGave.size + 1, gave);
  return makeRecord(["task"], [tasksGave.size]);
}
// `job has ended` (DESIGN §94): here a task runs to its end when it's started, so a task has always ended,
// and so has a worker
function taskEnded(task, error) {
  if (workerOf(task)) return true;
  if (!isRecord(task) || !Object.hasOwn(task, "task") || !tasksGave.has(task.task)) error(`'has ended' needs a task, as 'start' gives, not ${isRecord(task) ? "this record" : kindOf(task)}`);
  return true;
}

function waitedFor(task, error) {
  const worker = workerOf(task);
  if (worker) {
    if (Object.hasOwn(worker, "failed")) failWith(worker.failed, error);
    return worker.gave;
  }
  if (!isRecord(task) || !Object.hasOwn(task, "task") || !tasksGave.has(task.task)) error(`'wait for' needs a task, as 'start' gives, not ${isRecord(task) ? "this record" : kindOf(task)}`);
  return tasksGave.get(task.task);
}

// Workers (DESIGN §104): `start count(10) on another core` gives one, a record of its number. In a program moth
// build makes, a worker is a thread with memory of its own: a copy of the program's variables as they were
// when it started, and of its function's inputs, which it changes as it likes and no one else sees, and a copy
// of what it gives back, or of the mistake it ended with, for `wait for`. Here it runs to its end when it's
// started, as a task does, on copies all the same: the program's variables are swapped for copies of them
// while it runs, and put back after, so it can't change them. A function made inside another can't be copied,
// as it shares that function's variables, and nor can a value nested deeper than DEEPEST_COPY, which a list
// that holds itself is. Numbered from 1 in each run, apart from tasks, as machine code numbers them.
const workersGave = new Map();
export const DEEPEST_COPY = 1000;
export class CantCopy {
  constructor(message) {
    this.message = message;
  }
}
export const madeInside = (name) => `a worker can only be given, or give back, functions made at the top of a file, and '${name}' was made inside another function`;
export const tooDeepToCopy = `a worker can't be given, or give back, a value nested more than ${DEEPEST_COPY.toLocaleString("en")} deep (a list that holds itself is nested for ever)`;

// A copy of v for a worker, or of what one gives back: lists, records, dictionaries and bytes made again, all
// the way down; functions made at the top of a file, which `topLevel` tells, as they are. Throws CantCopy.
export function workerCopy(v, topLevel, depth = 0) {
  if (v === null || typeof v !== "object") return v; // a number, text, yes or no, or no value yet
  if (depth >= DEEPEST_COPY) throw new CantCopy(tooDeepToCopy);
  if (isList(v)) return v.map((x) => workerCopy(x, topLevel, depth + 1));
  if (v instanceof Closure) {
    if (!topLevel(v)) throw new CantCopy(madeInside(v.fn.name));
    return v;
  }
  if (isRecord(v)) {
    const fields = Object.keys(v);
    return makeRecord(fields, fields.map((f) => workerCopy(v[f], topLevel, depth + 1)));
  }
  if (isDictionary(v)) return new Map([...v].map(([key, value]) => [key, workerCopy(value, topLevel, depth + 1)]));
  if (isBytes(v)) return v.slice();
  return v; // an amount, which never changes
}

// The worker a record is, or null
export function workerResult(task) {
  return workerOf(task);
}
function workerOf(task) {
  return isRecord(task) && Object.hasOwn(task, "worker") && !Object.hasOwn(task, "task") ? workersGave.get(task.worker) ?? null : null;
}

// A worker that has ended, with what it gave ({ gave }) or the mistake it ended with ({ failed }): its record
export function workerEnded(result) {
  workersGave.set(workersGave.size + 1, result);
  return makeRecord(["worker"], [workersGave.size]);
}

// What a worker gave, copied for the program: what workerEnded keeps
export function workerGave(gave, topLevel) {
  try {
    return { gave: workerCopy(gave, topLevel) };
  } catch (err) {
    if (!(err instanceof CantCopy)) throw err;
    return { failed: err.message };
  }
}

// The mistake a worker ended with, copied: what `if it fails with` would have given it
export function workerFailed(value, topLevel) {
  try {
    return { failed: workerCopy(value, topLevel) };
  } catch (err) {
    if (!(err instanceof CantCopy)) throw err;
    return { failed: err.message };
  }
}

// The copies a worker starts with: of its inputs, or a mistake (through `error`) if one can't be copied, or
// the function was made inside another; and of the program's variables, `globals`, where one that can't be
// copied has no value yet, as the worker can't have it
export function workerStart(f, inputs, globals, topLevel, error) {
  try {
    if (!topLevel(f)) throw new CantCopy(madeInside(f.fn.name));
    return [workerCopy(inputs, topLevel), globals.map((v) => workerGlobal(v, topLevel))];
  } catch (err) {
    if (!(err instanceof CantCopy)) throw err;
    error(err.message);
  }
}

// a copy of one of the program's variables for a worker, or no value if it can't have one
export function workerGlobal(v, topLevel, unset = UNSET) {
  try {
    return workerCopy(v, topLevel);
  } catch (err) {
    if (!(err instanceof CantCopy)) throw err;
    return unset;
  }
}

// `start f(x) on another core` for an engine that calls functions straight (the JIT): `call(f, inputs)` makes
// the call; `globals(values)` gives the program's variables, and puts `values` in their place if it's given
// them; `topLevel(f)` says whether f was made at the top of a file; `caught(err)` gives the value of a mistake a
// `try` would catch, or throws err on.
export function startWorker(f, inputs, name, error, { call, globals, topLevel, caught }) {
  checkInputs(f, inputs.length, name, error);
  if (f.fn.kinds) checkKinds(f, inputs, name, error);
  const saved = globals();
  const [given, fresh] = workerStart(f, inputs, saved, topLevel, error);
  globals(fresh);
  let result;
  try {
    result = workerGave(call(f, given), topLevel);
  } catch (err) {
    result = workerFailed(caught(err), topLevel);
  } finally {
    globals(saved);
  }
  return workerEnded(result);
}

// `scores in order`: a new list, the old one as it was. Numbers go by size, text by each character's number
// in turn (so "B" comes before "a", and "apple" before "apples"), records `by` a field by that field. All of
// them must be numbers, or all text; ones that are equal keep the order they had, and `in reverse order`
// goes from the largest, still keeping equal ones in the order they had.
export function inOrder(list, field, reverse, error) {
  const phrase = `'in ${reverse ? "reverse " : ""}order${field === null ? "" : ` by ${field}`}'`;
  if (!isList(list)) error(`${phrase} needs a list, not ${kindOf(list)}`);
  const keys = list.map((item) => {
    if (field === null) return item;
    if (!isRecord(item)) error(`${phrase} needs a list of records, not one with ${kindOf(item)} in it`);
    return fieldOf(item, field, error);
  });
  let sort = null;
  for (const key of keys) {
    const what = typeof key === "number" ? "numbers" : typeof key === "string" ? "text" : null;
    if (!what) error(`${phrase} puts numbers or text in order, not ${kindOf(key)}`);
    if (sort && what !== sort) error(`${phrase} can't put numbers and text in order together`);
    sort = what;
  }
  const by = sort === "numbers" ? (a, b) => numberOrder(a, b) || 0 : textOrder;
  const places = keys.map((_, i) => i).sort((a, b) => (reverse ? by(keys[b], keys[a]) : by(keys[a], keys[b])));
  return places.map((i) => list[i]);
}

// text in order by each character's number in turn (by code point, as its UTF-8 bytes would sort): -1, 0 or 1
export function textOrder(a, b) {
  let [i, j] = [0, 0];
  while (i < a.length && j < b.length) {
    const [x, y] = [a.codePointAt(i), b.codePointAt(j)];
    if (x !== y) return x < y ? -1 : 1;
    i += x > 0xffff ? 2 : 1;
    j += y > 0xffff ? 2 : 1;
  }
  return (i < a.length) - (j < b.length);
}

// `save value to "file"`: the value, written as `say` shows a value inside a list, which `load` reads back:
// numbers (to 15 digits, as Moth compares them), text in quotes, yes, no, nothing, lists, records and
// dictionaries. Functions, bytes and amounts with units can't be saved, and nor can a list that holds itself.
export function savedText(value, error) {
  const inside = new Set();
  const check = (v) => {
    if (v instanceof Closure || isBytes(v) || isQuantity(v)) error(`'save' can't save ${kindOf(v)}`);
    if (!isList(v) && !isRecord(v) && !isDictionary(v)) return;
    if (inside.has(v)) error(`'save' can't save ${kindOf(v)} that holds itself`);
    inside.add(v);
    for (const x of isList(v) ? v : isRecord(v) ? Object.values(v) : v.values()) check(x);
    inside.delete(v);
  };
  check(value);
  return show(value, true);
}

// `load "scores.txt"`: a value `save` wrote. Spaces and new lines may come between its parts.
export function loadedValue(text, error) {
  let at = 0;
  const bad = () => error("'load' can't read this: it isn't a value 'save' wrote");
  const space = () => {
    while (at < text.length && " \t\r\n".includes(text[at])) at++;
  };
  const sees = (word) => {
    space();
    if (!text.startsWith(word, at)) return false;
    const next = text[at + word.length];
    if (/^[A-Za-z]/.test(word) && next !== undefined && /[A-Za-z0-9_]/.test(next)) return false;
    at += word.length;
    return true;
  };
  const must = (word) => sees(word) || bad();
  const value = () => {
    space();
    const c = text[at];
    if (c === '"') {
      const end = /^"(?:[^"\\\u0000-\u001f]|\\["\\/bfnrt]|\\u[0-9a-fA-F]{4})*"/.exec(text.slice(at));
      if (!end) bad();
      at += end[0].length;
      return JSON.parse(end[0]);
    }
    if (c === "[") {
      at++;
      const list = [];
      if (sees("]")) return list;
      do list.push(value()); while (sees(","));
      must("]");
      return list;
    }
    if (c === "(") {
      at++;
      if (sees("empty")) {
        const what = sees("record") ? new Record() : sees("dictionary") ? new Map() : bad();
        must(")");
        return what;
      }
      if (sees("record")) {
        must("with");
        const record = new Record();
        do {
          space();
          const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(text.slice(at)) ?? bad();
          at += name[0].length;
          record[name[0]] = value();
        } while (sees(","));
        must(")");
        return record;
      }
      must("dictionary");
      must("where");
      const items = [];
      do {
        const key = value();
        if (typeof key !== "string" && typeof key !== "number") bad();
        must("is");
        items.push(key, value());
      } while (sees(","));
      must(")");
      return makeDictionary(items, error);
    }
    for (const [word, v] of [["yes", true], ["no", false], ["nothing", null], ["Infinity", Infinity], ["-Infinity", -Infinity], ["NaN", NaN]]) {
      if (sees(word)) return v;
    }
    const number = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:e[+-][0-9]+)?/.exec(text.slice(at));
    if (!number) bad();
    at += number[0].length;
    return Number(number[0]);
  };
  if (typeof text !== "string") error(`'load' needs text, not ${kindOf(text)}`);
  const loaded = value();
  space();
  if (at < text.length) bad();
  return loaded;
}

// ---------- sending, and JSON ----------

// `scores as json`: the value as JSON, which most sites and programs that take data read: numbers as Moth
// shows them (to 15 digits), text in quotes as JSON writes it, yes, no and nothing as true, false and null,
// lists as [...], and records and dictionaries as {...}, a dictionary's number keys as their text, with no
// spaces. Functions, bytes, amounts with units, Infinity and NaN have no JSON, nor does a list that holds itself.
export function jsonText(value, error, cant) {
  const inside = new Set();
  const write = (v) => {
    if (v === null) return "null";
    if (typeof v === "boolean") return v ? "true" : "false";
    if (typeof v === "number") {
      if (!Number.isFinite(v)) error(`${cant} ${show(v)}: JSON has no such number`);
      return show(v);
    }
    if (typeof v === "string") return JSON.stringify(v);
    if (v instanceof Closure || isBytes(v) || isQuantity(v)) error(`${cant} ${kindOf(v)}`);
    if (inside.has(v)) error(`${cant} ${kindOf(v)} that holds itself`);
    inside.add(v);
    const text = isList(v) ? `[${v.map(write).join(",")}]`
      : `{${(isRecord(v) ? Object.entries(v) : [...v]).map(([k, x]) => `${JSON.stringify(typeof k === "string" ? k : show(k))}:${write(x)}`).join(",")}}`;
    inside.delete(v);
    return text;
  };
  return write(value);
}

// `json from reply`: what JSON text says, as Moth's values: an object becomes a dictionary (its keys are
// text, which a record's fields can't always be), an array a list, true, false and null yes, no and nothing.
// Spaces, tabs and new lines may come between the parts; anything else that isn't JSON is a mistake.
const JSON_STRING = /"(?:[^"\\\u0000-\u001f]|\\["\\/bfnrt]|\\u[0-9a-fA-F]{4})*"/y;
const JSON_NUMBER = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
export function jsonValue(text, error) {
  if (typeof text !== "string") error(`'json from' needs text, not ${kindOf(text)}`);
  let at = 0;
  const bad = () => error("'json from' can't read this: it isn't JSON");
  const space = () => {
    while (at < text.length && " \t\r\n".includes(text[at])) at++;
  };
  const sees = (c) => {
    space();
    if (text[at] !== c) return false;
    at++;
    return true;
  };
  const string = () => {
    JSON_STRING.lastIndex = at;
    const m = JSON_STRING.exec(text) ?? bad();
    at += m[0].length;
    return JSON.parse(m[0]).toWellFormed(); // half a pair of surrogates is U+FFFD, as machine code's text has it
  };
  const value = () => {
    space();
    const c = text[at];
    if (c === '"') return string();
    if (c === "[") {
      at++;
      const list = [];
      if (sees("]")) return list;
      do list.push(value()); while (sees(","));
      if (!sees("]")) bad();
      return list;
    }
    if (c === "{") {
      at++;
      const items = [];
      if (sees("}")) return new Map();
      do {
        space();
        if (text[at] !== '"') bad();
        items.push(string());
        if (!sees(":")) bad();
        items.push(value());
      } while (sees(","));
      if (!sees("}")) bad();
      return makeDictionary(items, error);
    }
    for (const [word, v] of [["true", true], ["false", false], ["null", null]]) {
      if (text.startsWith(word, at)) {
        at += word.length;
        return v;
      }
    }
    JSON_NUMBER.lastIndex = at;
    const number = JSON_NUMBER.exec(text) ?? bad();
    at += number[0].length;
    return Number(number[0]);
  };
  const got = value();
  space();
  if (at < text.length) bad();
  return got;
}

// a site's address: http:// or https:// at its start, in either case
export const isSite = (name) => /^https?:\/\//i.test(name);

// `with headers (dictionary where "Authorization" is "Bearer x")`: [name, value] pairs, each name a token as
// HTTP has them and each value text without a line break, which would start a header of its own
function headerFields(headers, error) {
  if (!isDictionary(headers)) error(`'with headers' needs a dictionary, not ${kindOf(headers)}`);
  return [...headers].map(([name, value]) => {
    if (typeof name !== "string") error(`a header's name is text, not ${kindOf(name)}`);
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) error(`'${name}' can't be a header's name: it's letters, digits and - (and !#$%&'*+.^_\`|~)`);
    if (typeof value !== "string") error(`the header '${name}' needs text, not ${kindOf(value)}`);
    if (/[\0\r\n]/.test(value)) error(`the header '${name}' can't hold a line break`);
    return [name, value];
  });
}

// `send data to "https://..."`: the data, sent to a site (POST), and the site's reply, as text. Text goes as
// it is (text/plain), anything else as JSON (application/json), unless a Content-Type header says otherwise.
// An answer from 300 up is a mistake, a move to another address too: data isn't sent on anywhere by itself.
// A disk that can send has send(address, data, headers), headers as [name, value] pairs.
export function sendTo(body, address, headers, disk, error) {
  if (typeof address !== "string") error(`'send ... to' needs a site's address, not ${kindOf(address)}`);
  const text = typeof body === "string";
  const data = text ? body : jsonText(body, error, "'send' can't send");
  const fields = headers ? headerFields(headers, error) : [];
  if (!isSite(address)) error(`'send' sends to a site, and '${address}' isn't one (its address starts http:// or https://)`);
  if (!fields.some(([name]) => name.toLowerCase() === "content-type")) {
    fields.unshift(["Content-Type", text ? "text/plain; charset=utf-8" : "application/json"]);
  }
  if (!disk?.send) error("this program sends to a site, but there are no sites here");
  try {
    return disk.send(address, data, fields);
  } catch (err) {
    error(`can't send to '${address}': ${err.message}`);
  }
}

// The clock a program reads with `the time` and `wait`s on: `now()` the time of day where it runs, in
// milliseconds since 1970 as if that were UTC (so the UTC parts of a Date are the local ones), `since()` the
// milliseconds since the program started, and `sleep(ms)`. A run isn't given a real one unless it asks
// (the playground does): fakeClock() always starts at the same moment, and its waits take no time at all.
export const FAKE_NOW = Date.UTC(2026, 0, 2, 3, 4, 5, 678); // a Friday
export function fakeClock(start = FAKE_NOW) {
  let slept = 0;
  return { now: () => start + slept, since: () => slept, sleep: (ms) => void (slept += ms) };
}
export function realClock() {
  const started = performance.now();
  return {
    now: () => Date.now() - new Date().getTimezoneOffset() * 60_000,
    since: () => performance.now() - started,
    sleep: (ms) => {
      try {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); // a worker can sleep
      } catch {
        for (const end = performance.now() + ms; performance.now() < end; ); // a page can't, so it waits busily
      }
    },
  };
}

// `the time`, `the date`, ... `the clock`
export const NOW_WORDS = ["time", "date", "year", "month", "day", "hour", "minute", "second", "weekday", "clock"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export function nowValue(which, clock) {
  const word = NOW_WORDS[which];
  if (word === "clock") return Math.round(clock.since()) / 1000; // seconds since the program started, to the millisecond
  const d = new Date(Math.floor(clock.now()));
  const two = (n) => String(n).padStart(2, "0");
  if (word === "time") return `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}:${two(d.getUTCSeconds())}`;
  if (word === "date") return `${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())}`;
  if (word === "weekday") return WEEKDAYS[d.getUTCDay()];
  return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()][which - 2];
}

// `wait 2 seconds`: `unit` is the milliseconds in each
export function waitFor(amount, unit, clock, error) {
  if (typeof amount !== "number" || !(amount >= 0) || amount === Infinity) error(`'wait' needs a number of 0 or more, not ${described(amount)}`);
  clock.sleep(amount * unit);
}

// `stop the program with 2`: the number a program ends with, a whole number from 0 to 255 (all Linux keeps)
export function exitCode(v, error) {
  if (typeof v === "number") v = canon(v);
  if (!Number.isInteger(v) || v < 0 || v > 255) error(`'stop the program with' needs a whole number from 0 to 255, not ${described(v)}`);
  return v;
}

// `ask question`: the answer, as text. `answer` is whoever can answer (a person at a terminal, a page): it gets
// the question as text and returns the answer, or null when there is no more input.
export function askFor(question, answer, error) {
  if (!answer) error("this program asks a question, but nothing can answer it here");
  const reply = answer(show(question));
  if (reply === null || reply === undefined) error("there was no answer to this question: the input ended");
  return String(reply);
}

// What an app's handlers wait for: `when a key is pressed`, `when the mouse is clicked`, `... is dragged`,
// `when the button "Start" is clicked` and `when enter is pressed in the text box "Name"`. A handler is
// { event, closure }, with the label it waits for as `label` for the last two, or for `every`, { event:
// "every", interval (in milliseconds), closure }.
export const EVENTS = ["key", "click", "drag", "button", "enter", "checkbox", "choice", "slider"];
export const LABELLED = new Set(["button", "enter", "checkbox", "choice", "slider"].map((event) => EVENTS.indexOf(event)));

// `every 100 milliseconds`: how often, in milliseconds (`unit` is 1000 for seconds)
export function everyInterval(interval, unit, error) {
  if (typeof interval !== "number" || !(interval > 0) || interval === Infinity) error(`'every' needs a number above 0, not ${described(interval)}`);
  return interval * unit;
}

// `random number from 1 to 6`: a whole number from low to high, each as likely. `random` is where the
// randomness comes from: a number from 0 up to (not including) 1, like Math.random.
export function randomWhole(low, high, random, error) {
  [low, high] = [low, high].map((n) => (typeof n === "number" ? canon(n) : n));
  for (const n of [low, high]) if (!Number.isInteger(n)) error(`'random number from' needs whole numbers, not ${described(n)}`);
  if (low > high) error(`there is no number from ${show(low)} to ${show(high)}`);
  return low + Math.floor(random() * (high - low + 1));
}

// The random numbers a run gets when it isn't given real ones: the same every time, so a run can be
// repeated exactly (mulberry32, a small fast generator).
export function seeded(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// `expect a is b`, or any comparison: a mistake if it isn't so, which says what each side was
export function expectThat(op, negate, a, b, error) {
  if (compare(op, a, b, error) !== negate) return;
  error(`expected ${show(a, true)} ${negate ? "not " : ""}to be${op === "is" ? "" : ` ${op}`} ${show(b, true)}`);
}

// `expect done`: the value must be yes
export function expectYes(value, error) {
  if (!truthy(value)) error(`expected yes, but got ${show(value, true)}`);
}

// `read "notes.txt"` (as text) and `read bytes "photo.png"`. `disk` is whatever holds the files: it has
// read(name, asBytes), which gives the file's text or bytes, or null if there is no such file, and
// write(name, data), where data is text or bytes. Either may throw an Error, whose message is passed on.
export function readFile(name, asBytes, disk, error, headers = null) {
  if (typeof name !== "string") error(`a file name is text, not ${kindOf(name)}`);
  const fields = headers && headerFields(headers, error);
  if (fields && !isSite(name)) error(`only a site is read with headers, and '${name}' isn't one (its address starts http:// or https://)`);
  if (!disk) error("this program reads a file, but there are no files here");
  let data;
  try {
    data = fields ? disk.read(name, asBytes, fields) : disk.read(name, asBytes);
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

// `remove the file "old.txt"`: there must be such a file. A disk that can remove files has remove(name), which
// gives whether there was one, and may throw an Error, whose message is passed on.
export function removeFile(name, disk, error) {
  if (typeof name !== "string") error(`a file name is text, not ${kindOf(name)}`);
  if (!disk?.remove) error("this program removes a file, but there are no files here");
  let gone;
  try {
    gone = disk.remove(name);
  } catch (err) {
    error(`can't remove '${name}': ${err.message}`);
  }
  if (!gone) error(`there is no file called '${name}'`);
}

// `read the folder "tests"`: the names of what is in a folder, in order, a folder's with "/" after it. A disk
// that can look in folders has folder(name), which gives those names in any order, or null if there is no
// such folder, and may throw an Error, whose message is passed on.
export function readFolder(name, disk, error) {
  if (typeof name !== "string") error(`a folder name is text, not ${kindOf(name)}`);
  if (!disk?.folder) error("this program reads a folder, but there are no files here");
  let names;
  try {
    names = disk.folder(name);
  } catch (err) {
    error(`can't read '${name}': ${err.message}`);
  }
  if (names === null || names === undefined) error(`there is no folder called '${name}'`);
  return [...names].sort();
}

// `fail with value`: stops the program with the value as its message, and keeps the value for whoever ran it
export function failWith(value, error) {
  error(show(value), value);
}

// how many letters a text box holds, and a text area
export const BOX_LETTERS = 40;
export const AREA_LETTERS = 2000;
// how high a line of a list is, and of a text area; and what can have the focus (DESIGN §40)
export const LIST_ROW = 24;
export const AREA_LINE = 20;
const FOCUSABLE = new Set(["box", "area", "list", "dropdown", "slider"]);
// how many of a dropdown's items show at once, in a list below it, while it's open (DESIGN §42)
export const DROP_ROWS = 6;
// What's typed in a box is drawn a letter to every LETTER_WIDE across, from 8 in, whatever the font, so a click
// lands between the same two letters on every engine and in machine code (DESIGN §41)
export const LETTER_WIDE = 10;

// A key's name as hosts send it: "ctrl+" first for Ctrl (or a Mac's Command) with a letter, and "shift+" for
// Shift with a key that moves the cursor, then the key's own name
export function keyParts(name) {
  const ctrl = typeof name === "string" && name.startsWith("ctrl+") && name.length > 5;
  const rest = ctrl ? name.slice(5) : name;
  const shift = typeof rest === "string" && rest.startsWith("shift+") && rest.length > 6;
  return { ctrl, shift, key: shift ? rest.slice(6) : rest };
}

// where letter `at` of `letters` is, its lines split at "\n": [its line, and its place in that line], from 0
function placeOf(letters, at) {
  let [line, start] = [0, 0];
  for (let i = 0; i < at; i++) if (letters[i] === "\n") [line, start] = [line + 1, i + 1];
  return [line, at - start];
}

// the place in `letters` of letter `col` of line `line`, which there is, or the end of the line if it's shorter
function placeAt(letters, line, col) {
  let start = 0;
  for (let l = 0; l < line; l++) start = letters.indexOf("\n", start) + 1;
  const end = letters.indexOf("\n", start);
  return start + Math.min(Math.max(col, 0), (end < 0 ? letters.length : end) - start);
}

// The turtle: starts in the middle, facing up, with its pen down, and reports each line it draws to `draw`
// as { x1, y1, x2, y2, color, width }, with y going up.
export class Turtle {
  constructor(draw = () => {}) {
    Object.assign(this, { draw, x: 0, y: 0, heading: 90, pen: true, color: "#4f8ff7", width: 2 });
    // buttons and text boxes (DESIGN §36): those on the picture since the last `clear`, in the order drawn,
    // as { kind: "button" or "box", label, x, y, width, height }; what's typed in each box, by its label,
    // kept through `clear`; and the label of the box that has the focus, or null
    Object.assign(this, { widgets: [], texts: new Map(), focus: null });
    // checkboxes, text areas and lists (DESIGN §40): whether each checkbox is ticked, by its label, kept
    // through `clear` as what's typed is; and for each list, by its label, the items it shows, which of them
    // is chosen (by its place, from 0), and the first one in view
    Object.assign(this, { ticks: new Map(), items: new Map(), choices: new Map(), tops: new Map() });
    // where the cursor is in each box, by its label, and what's selected (DESIGN §41); and the label of the
    // box a drag selects in, the one last clicked
    Object.assign(this, { edits: new Map(), selecting: null });
    // each slider's value, by its label, kept through `clear`; and the label of the dropdown that's open, or
    // null (DESIGN §42). A dropdown's items, what's chosen and what's first in view are kept as a list's.
    Object.assign(this, { values: new Map(), open: null });
  }

  // Where an event goes once the picture's buttons and text boxes have seen it: [the event the handlers wait
  // for, the label they wait for (or undefined), their inputs], or null for none. A click inside a button is
  // its own, one inside a text box gives it the focus, and one anywhere else takes the focus away. While a box
  // has the focus, every key is its (see editIn), and "type" (the text typed, as it was typed) goes into it,
  // up to BOX_LETTERS letters. A click in a box puts its cursor there, and a drag from it selects.
  // A click on a checkbox ticks it or unticks it, then goes to its handlers; one on a list gives it the focus
  // and chooses the item there. "scroll" ([x, y, lines], from a mouse wheel) scrolls the list under it. While a
  // text area has the focus, Enter starts a new line in it, up to AREA_LETTERS letters; while a list has it,
  // the up and down arrows choose the item before or after, and no key goes anywhere else. A key with Ctrl
  // goes nowhere but a box, and one with Shift goes to the program without it, as it always has.
  // A dropdown is a list that's closed: a click on it opens it, and one on an item while it's open chooses
  // that item; any click while it's open closes it, and does nothing else. While it has the focus, the up and
  // down arrows choose, Enter and Space open and close it, and Escape closes it. A click on a slider gives it
  // the focus and moves it there, as a drag from it does; the arrows, Home and End move it while it has the
  // focus. Moving it to a new value goes to its handlers, with the value.
  route(event, inputs) {
    const focused = this.focus === null ? null : this.widgets.findLast((w) => w.label === this.focus && FOCUSABLE.has(w.kind));
    if (this.focus !== null && !focused) this.focus = null; // its box is gone
    const opened = this.open === null ? null : this.widgets.findLast((w) => w.kind === "dropdown" && w.label === this.open);
    if (this.open !== null && !opened) this.open = null; // and so is the dropdown that was open
    const below = (x, y) => opened && x >= opened.x && x <= opened.x + opened.width && y < opened.y && y >= opened.y - LIST_ROW * this.rowsOf(opened);
    const at = (x, y) => this.widgets.findLast((w) => x >= w.x && x <= w.x + w.width && y >= w.y && y <= w.y + w.height);
    if (event === "scroll") {
      if (below(inputs[0], inputs[1])) {
        this.scrollTo(opened, (this.tops.get(opened.label) ?? 0) + inputs[2]);
        return null;
      }
      const hit = at(inputs[0], inputs[1]);
      if (hit?.kind === "list") this.scrollTo(hit, (this.tops.get(hit.label) ?? 0) + inputs[2]);
      return null;
    }
    if (event === "click") {
      const [x, y] = inputs;
      this.selecting = null;
      if (opened) { // closed, and the item clicked on, if any, chosen
        this.setOpen(null);
        if (!below(x, y)) return null;
        const row = (this.tops.get(opened.label) ?? 0) + Math.floor((opened.y - y) / LIST_ROW);
        return row < this.items.get(opened.label).length ? this.choose(opened, row) : null;
      }
      const hit = at(x, y);
      if (hit?.kind === "button") return ["button", hit.label, []];
      if (hit?.kind === "checkbox") {
        this.tick(hit.label, !this.ticks.get(hit.label));
        return ["checkbox", hit.label, []];
      }
      this.focusOn(hit ? hit.label : null);
      if (hit?.kind === "list") {
        const row = (this.tops.get(hit.label) ?? 0) + Math.floor((hit.y + hit.height - y) / LIST_ROW);
        return row < this.items.get(hit.label).length ? this.choose(hit, row) : null;
      }
      if (hit?.kind === "dropdown") {
        this.setOpen(hit.label);
        return null;
      }
      if (hit?.kind === "slider") {
        this.selecting = hit.label;
        return this.slide(hit, this.valueAt(hit, x));
      }
      if (hit) { // a text box or a text area: its cursor where it was clicked
        const place = this.placeIn(hit, x, y);
        this.edited(hit.label, this.texts.get(hit.label) ?? "", place, place, hit);
        this.selecting = hit.label;
        return null;
      }
      return [event, undefined, inputs];
    }
    if (event === "drag" && focused?.kind === "slider" && this.selecting === focused.label) return this.slide(focused, this.valueAt(focused, inputs[0]));
    if (event === "drag" && focused && focused.kind !== "list" && this.selecting === focused.label) { // selecting, from the click
      this.edited(focused.label, this.texts.get(focused.label) ?? "", this.placeIn(focused, inputs[0], inputs[1]), this.editOf(focused.label).anchor, focused);
      return null;
    }
    const { ctrl, key } = keyParts(inputs[0]);
    if (!focused) return event === "type" || (event === "key" && ctrl) ? null : [event, undefined, event === "key" ? [key] : inputs];
    if (event !== "key" && event !== "type") return [event, undefined, inputs];
    if (focused.kind === "list" || focused.kind === "dropdown") {
      const count = this.items.get(focused.label).length;
      const now = this.choices.get(focused.label) ?? -1;
      if (event === "key" && !ctrl && (key === "up" || key === "down") && count) {
        const next = Math.max(0, Math.min(count - 1, key === "up" ? now - 1 : now + 1));
        if (next !== now) return this.choose(focused, next);
      } else if (event === "key" && !ctrl && focused.kind === "dropdown" && (key === "enter" || key === "space")) {
        this.setOpen(this.open === focused.label ? null : focused.label);
      } else if (event === "key" && key === "escape") this.setOpen(null);
      return null;
    }
    if (focused.kind === "slider") {
      const { from, to } = focused;
      const step = to < from ? -1 : 1;
      const now = this.values.get(focused.label);
      const next = event !== "key" || ctrl ? null : key === "left" || key === "down" ? now - step : key === "right" || key === "up" ? now + step
        : key === "home" ? from : key === "end" ? to : null;
      return next === null ? null : this.slide(focused, Math.min(Math.max(from, to), Math.max(Math.min(from, to), next)));
    }
    return this.editIn(focused, event, inputs);
  }

  // A key, or text typed, in the text box or text area `box`, which has the focus. The arrows, Home and End
  // move the cursor (up and down only in a text area, Home and End to the ends of its line), and select with
  // Shift; an arrow with something selected and no Shift goes to that end of it. Backspace and Delete take off
  // what's selected, or the letter before or after the cursor. Enter is a text box's (its handlers, with its
  // text) and a new line in a text area. Ctrl+A selects everything and Ctrl+X takes off what's selected:
  // copying it, and pasting, which comes as text typed, are the host's (DESIGN §41). Text typed takes the
  // place of what's selected, with as many letters as there's room for; a text area keeps new lines in it.
  editIn(box, event, inputs) {
    const label = box.label;
    const letters = [...(this.texts.get(label) ?? "")];
    const { cursor, anchor } = this.editOf(label);
    const [from, to] = [Math.min(cursor, anchor), Math.max(cursor, anchor)];
    const most = box.kind === "area" ? AREA_LETTERS : BOX_LETTERS;
    const replace = (put, start, end) => { // letters start to end, put in place of, the cursor after them
      const room = most - (letters.length - (end - start));
      const kept = put.slice(0, Math.max(0, room));
      letters.splice(start, end - start, ...kept);
      this.edited(label, letters.join(""), start + kept.length, start + kept.length, box);
    };
    if (event === "type") {
      const typed = [...show(inputs[0])].filter((c) => (c >= " " && c !== "\x7f") || (c === "\n" && box.kind === "area"));
      if (typed.length) replace(typed, from, to);
      return null;
    }
    const { ctrl, shift, key } = keyParts(inputs[0]);
    const move = (place) => this.edited(label, letters.join(""), place, shift ? anchor : place, box);
    const [line, col] = placeOf(letters, cursor);
    if (ctrl) {
      if (key === "a") this.edited(label, letters.join(""), letters.length, 0, box);
      else if (key === "x" && from !== to) replace([], from, to);
    } else if (key === "left") move(from !== to && !shift ? from : Math.max(0, cursor - 1));
    else if (key === "right") move(from !== to && !shift ? to : Math.min(letters.length, cursor + 1));
    else if (key === "home") move(cursor - col);
    else if (key === "end") move(placeAt(letters, line, Infinity));
    else if ((key === "up" || key === "down") && box.kind === "area") {
      const next = line + (key === "up" ? -1 : 1);
      move(next < 0 ? 0 : next > placeOf(letters, letters.length)[0] ? letters.length : placeAt(letters, next, col));
    } else if (key === "backspace" || key === "delete") {
      if (from !== to) replace([], from, to);
      else if (key === "backspace" && cursor > 0) replace([], cursor - 1, cursor);
      else if (key === "delete" && cursor < letters.length) replace([], cursor, cursor + 1);
    } else if (key === "enter") {
      if (box.kind === "box") return ["enter", label, [letters.join("")]];
      replace(["\n"], from, to);
    }
    return null;
  }

  // where the cursor is in the box with this label, by its place among the letters, from 0; the other end of
  // what's selected (where the cursor is when nothing is); and the first column and line in view. A box no
  // one has clicked in yet has its cursor at its end.
  editOf(label) {
    if (!this.edits.has(label)) {
      const end = [...(this.texts.get(label) ?? "")].length;
      this.edits.set(label, { cursor: end, anchor: end, left: 0, top: 0 });
    }
    return this.edits.get(label);
  }

  // what a box with this label shows: { text, focused, cursor, anchor, left, top }
  boxState(label) {
    const { cursor, anchor, left, top } = this.editOf(label);
    return { text: this.texts.get(label) ?? "", focused: this.focus === label, cursor, anchor, left, top };
  }

  // the box with this label, its text and cursor changed: the cursor kept in view in `box` (the box drawn, or
  // null to show it from its start), and the box drawn again if anything about it changed
  edited(label, text, cursor, anchor, box) {
    const before = JSON.stringify(this.boxState(label));
    const edit = this.editOf(label);
    Object.assign(edit, { cursor, anchor });
    this.texts.set(label, text);
    if (box) {
      const [line, col] = placeOf([...text], cursor);
      const cols = Math.max(1, Math.floor((box.width - 16) / LETTER_WIDE));
      if (col < edit.left) edit.left = col;
      else if (col > edit.left + cols) edit.left = col - cols;
      if (box.kind === "area") {
        const rows = Math.max(1, Math.floor((box.height - 8) / AREA_LINE));
        if (line < edit.top) edit.top = line;
        else if (line >= edit.top + rows) edit.top = line - rows + 1;
      }
    } else Object.assign(edit, { left: 0, top: 0 });
    if (JSON.stringify(this.boxState(label)) !== before) this.draw({ textbox: label, ...this.boxState(label) });
  }

  // the place in the text of `box` nearest the point (x, y): a letter every LETTER_WIDE from 8 in, a line every
  // AREA_LINE from 4 below the top, from the first column and line in view, and no further than the text goes
  placeIn(box, x, y) {
    const letters = [...(this.texts.get(box.label) ?? "")];
    const { left, top } = this.editOf(box.label);
    const last = placeOf(letters, letters.length)[0];
    const line = box.kind === "area" ? Math.min(last, Math.max(0, top + Math.floor((box.y + box.height - 4 - y) / AREA_LINE))) : 0;
    return placeAt(letters, line, left + Math.floor((x - box.x - 8) / LETTER_WIDE + 0.5));
  }

  // the checkbox with this label, ticked or not: drawn again
  tick(label, ticked) {
    this.ticks.set(label, ticked);
    this.draw({ checkbox: label, ticked });
  }

  // the item at `row` of this list chosen, and in view: its handlers' event, with the item
  choose(list, row) {
    this.choices.set(list.label, row);
    this.scrollTo(list, this.inView(list, row), true);
    return ["choice", list.label, [this.items.get(list.label)[row]]];
  }

  // how many rows of a list are in view: as many as fit, a row every LIST_ROW; for a dropdown, as many as it
  // has, up to DROP_ROWS
  rowsOf(list) {
    return list.kind === "dropdown" ? Math.max(1, Math.min(DROP_ROWS, this.items.get(list.label).length)) : Math.max(1, Math.floor(list.height / LIST_ROW));
  }

  // the first row of this list in view once `row` is: where it is if that's so already, else `row` first or last
  inView(list, row) {
    const top = this.tops.get(list.label) ?? 0;
    const rows = this.rowsOf(list);
    return row < top ? row : row >= top + rows ? row - rows + 1 : top;
  }

  // the first item in view of this list, as near to `top` as its items allow: drawn again
  scrollTo(list, top, always = false) {
    const first = Math.max(0, Math.min(top, this.items.get(list.label).length - this.rowsOf(list)));
    if (first === (this.tops.get(list.label) ?? 0) && !always) return;
    this.tops.set(list.label, first);
    this.listChanged(list.label);
  }

  // what a list or dropdown shows changed without it being drawn again: which item is chosen, which is first,
  // its focus, and whether a dropdown is open
  listChanged(label) {
    const state = { chosen: this.choices.get(label) ?? -1, top: this.tops.get(label) ?? 0, focused: this.focus === label };
    const dropdown = this.widgets.findLast((w) => w.label === label && (w.kind === "list" || w.kind === "dropdown"))?.kind === "dropdown";
    this.draw(dropdown ? { dropdown: label, ...state, open: this.open === label } : { list: label, ...state });
  }

  // the dropdown with this label opened, with what's chosen in view, or none open: those that changed drawn again
  setOpen(label) {
    const before = this.open;
    if (label === before || (label !== null && !this.items.get(label).length)) return;
    this.open = label;
    if (label !== null) {
      const dropdown = this.widgets.findLast((w) => w.kind === "dropdown" && w.label === label);
      this.tops.set(label, Math.max(0, Math.min(this.inView(dropdown, this.choices.get(label) ?? 0), this.items.get(label).length - this.rowsOf(dropdown))));
    }
    for (const changed of [before, label]) if (changed !== null) this.listChanged(changed);
  }

  // the value a click at x gives a slider: from its `from` 10 in to its `to` 10 from its other end, a whole number
  valueAt(slider, x) {
    const along = Math.min(1, Math.max(0, (x - slider.x - 10) / (slider.width - 20)));
    return Math.floor(slider.from + along * (slider.to - slider.from) + 0.5);
  }

  // the slider moved to `value`: if that's new, drawn again, and its handlers' event, with the value
  slide(slider, value) {
    if (value === this.values.get(slider.label)) return null;
    this.values.set(slider.label, value);
    this.draw({ slider: slider.label, value, focused: this.focus === slider.label });
    return ["slider", slider.label, [value]];
  }

  // the focus, to the box with this label (or none): each box whose focus changed is drawn again
  focusOn(label) {
    const before = this.focus;
    if (label === before) return;
    this.focus = label;
    for (const box of [before, label]) {
      if (box === null) continue;
      const kind = this.widgets.findLast((w) => w.label === box && FOCUSABLE.has(w.kind))?.kind;
      if (kind === "list" || kind === "dropdown") this.listChanged(box);
      else if (kind === "slider") this.draw({ slider: box, value: this.values.get(box), focused: box === label });
      else this.draw({ textbox: box, ...this.boxState(box) });
    }
  }

  // Besides lines, the turtle reports { clear: true } when the picture is wiped, and filled shapes:
  // { shape: "box", x, y, width, height, color } (x, y its bottom left corner), { shape: "circle", x, y,
  // radius, color } and { shape: "text", text, x, y, size, color }; pictures from files, { shape: "picture", x,
  // y, width, height, image }, where the image is what decodePicture gives; and { shape: "button", text, x, y,
  // width, height, color }, { shape: "textbox", label, text, focused, cursor, anchor, left, top, x, y, width,
  // height, color }, and { textbox: label, text, focused, cursor, anchor, left, top } when what a text box shows
  // changes without it being drawn again (see editOf: the cursor, the other end of what's selected, and the
  // first column and line in view); and
  // { shape: "checkbox", label, ticked, x, y, width, height, color }, { shape: "textarea", label, text,
  // focused, x, y, width, height, color }, { shape: "list", label, items, chosen, top, focused, x, y, width,
  // height, color }, items as `say` shows them and chosen -1 for none, with { checkbox: label, ticked } and
  // { list: label, chosen, top, focused } when they change, and a text area's text as a text box's; and
  // { shape: "dropdown", label, items, chosen, top, open, focused, x, y, width, height, color } with
  // { dropdown: label, chosen, top, focused, open }, and { shape: "slider", label, value, from, to, focused, x,
  // y, width, height, color } with { slider: label, value, focused } (DESIGN §42). `disk`
  // has the files `draw picture` reads, as for readFile.
  act(action, value, error = oops, disk = null) {
    const name = TURTLE_ACTIONS[action];
    if (action < 4 && typeof value !== "number") error(`'${action < 2 ? "move" : "turn"} ${name}' needs a number, not ${kindOf(value)}`);
    const round = (n) => Math.round(n * 100) / 100 || 0; // 0, not 6.123e-17 or -0, where a line should end at 0
    const numbers = (what, list) => {
      for (const n of list) if (typeof n !== "number") error(`${what} needs numbers, not ${kindOf(n)}`);
      return list.map(round);
    };
    if (name === "forward" || name === "back" || name === "to") {
      let x;
      let y;
      if (name === "to") [x, y] = numbers("'move to'", value);
      else {
        const steps = name === "forward" ? value : -value;
        const angle = (this.heading * Math.PI) / 180;
        x = this.x + steps * Math.cos(angle);
        y = this.y + steps * Math.sin(angle);
      }
      if (this.pen) this.draw({ x1: round(this.x), y1: round(this.y), x2: round(x), y2: round(y), color: this.color, width: this.width });
      Object.assign(this, { x, y });
    } else if (name === "clear") {
      this.widgets = [];
      this.draw({ clear: true });
    } else if (name === "button" || name === "text box") { // [label, x, y]: the label as `say` shows it
      const [x, y] = numbers(`'draw ${name}'`, value.slice(1));
      const label = show(value[0]);
      if (name === "button") {
        const width = 20 + 10 * [...label].length;
        this.widgets.push({ kind: "button", label, x, y, width, height: 30 });
        this.draw({ shape: "button", text: label, x, y, width, height: 30, color: this.color });
      } else {
        this.widgets.push({ kind: "box", label, x, y, width: 200, height: 30 });
        this.draw({ shape: "textbox", label, ...this.boxState(label), x, y, width: 200, height: 30, color: this.color });
      }
    } else if (name === "clear text box") {
      this.edited(show(value), "", 0, 0, null);
    } else if (name === "checkbox") { // [label, x, y]: a box 20 by 20 with its label after it
      const [x, y] = numbers("'draw checkbox'", value.slice(1));
      const label = show(value[0]);
      const width = 28 + 10 * [...label].length;
      this.widgets.push({ kind: "checkbox", label, x, y, width, height: 20 });
      this.draw({ shape: "checkbox", label, ticked: this.ticks.get(label) ?? false, x, y, width, height: 20, color: this.color });
    } else if (name === "tick" || name === "untick") {
      this.tick(show(value), name === "tick");
    } else if (name === "text area" || name === "list") { // [label, (items,) x, y, width or nothing, height or nothing]
      const label = show(value[0]);
      const items = name === "list" ? value[1] : null;
      if (name === "list" && !isList(items)) error(`'draw list ... showing' needs a list, not ${kindOf(items)}`);
      const rest = value.slice(name === "list" ? 2 : 1);
      const sized = rest[2] !== null || rest[3] !== null;
      const [x, y, width, height] = numbers(`'draw ${name}'`, sized ? rest : [...rest.slice(0, 2), ...(name === "list" ? [200, 144] : [300, 120])]);
      for (const n of [width, height]) if (n <= 0) error(`a ${name}'s size is a number above 0, not ${show(n)}`);
      if (name === "text area") {
        this.widgets.push({ kind: "area", label, x, y, width, height });
        this.draw({ shape: "textarea", label, ...this.boxState(label), x, y, width, height, color: this.color });
      } else {
        this.items.set(label, items.slice());
        this.widgets.push({ kind: "list", label, x, y, width, height });
        const list = this.widgets.at(-1);
        this.scrollTo(list, this.tops.get(label) ?? 0); // as near to where it was as its items allow now
        this.draw({ shape: "list", label, items: items.map((item) => show(item)), chosen: this.choices.get(label) ?? -1, top: this.tops.get(label) ?? 0,
          focused: this.focus === label, x, y, width, height, color: this.color });
      }
    } else if (name === "dropdown") { // [label, items, x, y]: 200 by 30, its items in a list below it while it's open
      const label = show(value[0]);
      if (!isList(value[1])) error(`'draw dropdown ... showing' needs a list, not ${kindOf(value[1])}`);
      const [x, y] = numbers("'draw dropdown'", value.slice(2));
      this.items.set(label, value[1].slice());
      this.widgets.push({ kind: "dropdown", label, x, y, width: 200, height: 30 });
      if (this.open === label && !value[1].length) this.open = null;
      this.scrollTo(this.widgets.at(-1), this.tops.get(label) ?? 0); // as near to where it was as its items allow now
      this.draw({ shape: "dropdown", label, items: value[1].map((item) => show(item)), chosen: this.choices.get(label) ?? -1, top: this.tops.get(label) ?? 0,
        open: this.open === label, focused: this.focus === label, x, y, width: 200, height: 30, color: this.color });
    } else if (name === "slider") { // [label, from, to, x, y]: 200 by 20, its value a whole number from `from` to `to`
      const label = show(value[0]);
      const [low, high, x, y] = numbers("'draw slider'", value.slice(1));
      const [from, to] = [Math.floor(low + 0.5), Math.floor(high + 0.5)];
      const now = Math.min(Math.max(from, to), Math.max(Math.min(from, to), this.values.get(label) ?? from));
      this.values.set(label, now);
      this.widgets.push({ kind: "slider", label, x, y, width: 200, height: 20, from, to });
      this.draw({ shape: "slider", label, value: now, from, to, focused: this.focus === label, x, y, width: 200, height: 20, color: this.color });
    } else if (name === "set slider") { // [label, value]: a whole number, kept to the slider's range if it's drawn
      const label = show(value[0]);
      if (typeof value[1] !== "number") error(`'set the slider' needs a number, not ${kindOf(value[1])}`);
      const slider = this.widgets.findLast((w) => w.kind === "slider" && w.label === label);
      let now = Math.floor(value[1] + 0.5);
      if (slider) now = Math.min(Math.max(slider.from, slider.to), Math.max(Math.min(slider.from, slider.to), now));
      if (now !== this.values.get(label)) {
        this.values.set(label, now);
        if (slider) this.draw({ slider: label, value: now, focused: this.focus === label });
      }
    } else if (name === "box") {
      const [x, y, width, height] = numbers("'draw box'", value);
      this.draw({ shape: "box", x, y, width, height, color: this.color });
    } else if (name === "circle") {
      const [x, y, radius] = numbers("'draw circle'", value);
      if (radius < 0) error(`a circle's size is 0 or more, not ${show(radius)}`);
      this.draw({ shape: "circle", x, y, radius, color: this.color });
    } else if (name === "text") {
      const [text, ...rest] = value;
      const [x, y, size] = numbers("'draw ... at'", rest.map((n, i) => (i === 2 && n === null ? 16 : n))); // 16 when no size is given
      if (size <= 0) error(`text's size is a number above 0, not ${show(size)}`);
      this.draw({ shape: "text", text: show(text), x, y, size, color: this.color });
    } else if (name === "chart") {
      // `draw chart of sales`: a bar for each number (or amount) in a list, or each value of a dictionary,
      // labelled with its place in the list or its key. The longest bar is 200 long, each 30 wide and 10 from
      // the next, from (0, 0), with its value at its end; nothing has a label and no bar.
      const isDict = isDictionary(value);
      if (!isList(value) && !isDict) error(`'draw chart of' needs a list or a dictionary, not ${kindOf(value)}`);
      const values = isDict ? [...value.values()] : value;
      const labels = isDict ? [...value.keys()].map((k) => show(k)) : values.map((_, i) => String(i + 1));
      const first = values.find((v) => v !== null);
      const sizes = values.map((v) => {
        if (v === null) return null;
        if (isQuantity(first) ? !sameMeasure(first, v) : typeof v !== "number") error(`'draw chart of' needs numbers, or amounts of one measure, not ${kindOf(v)}`);
        return isQuantity(v) ? amountIn(v, first.unit) : v;
      });
      let biggest = 0;
      for (const n of sizes) if (n !== null && Math.abs(n) > biggest) biggest = Math.abs(n);
      const scale = biggest === 0 ? 0 : 200 / biggest;
      sizes.forEach((n, i) => {
        const [x, height] = [i * 40, n === null ? 0 : round(n * scale)];
        if (n !== null) {
          this.draw({ shape: "box", x, y: Math.min(height, 0), width: 30, height: Math.abs(height), color: this.color });
          this.draw({ shape: "text", text: show(values[i]), x, y: Math.max(height, 0) + 4, size: 12, color: this.color });
        }
        this.draw({ shape: "text", text: labels[i], x, y: Math.min(height, 0) - 18, size: 12, color: this.color });
      });
    } else if (name === "picture") {
      // `draw picture "cat.png" at x, y size w by h`: a PNG or BMP file, or its bytes, with its bottom left
      // corner at x, y, as a box has it, and as big as it is in pixels unless it's given a size
      const [what, ...rest] = value;
      if (typeof what !== "string" && !isBytes(what)) error(`'draw picture' needs a file's name or its bytes, not ${kindOf(what)}`);
      const sized = rest[2] !== null || rest[3] !== null; // `size w by h`; with no size, both are nothing
      const [x, y, ...size] = numbers("'draw picture'", sized ? rest : rest.slice(0, 2));
      for (const n of size) if (n <= 0) error(`a picture's size is a number above 0, not ${show(n)}`);
      const image = typeof what === "string" ? pictureOf(readFile(what, true, disk, error), what, error) : pictureOf(what, null, error);
      const [width, height] = sized ? size : [image.width, image.height];
      this.draw({ shape: "picture", x, y, width, height, image });
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

// The pictures drawn lately, by what their files hold, so a game that draws the same sprite every frame
// decodes it once, and every drawing of it is the same image (which a page can then draw from once).
const PICTURES = new Map(); // a hash of the bytes: [[bytes, image], ...]
let pictured = 0; // how many bytes of pixels PICTURES keeps
function pictureOf(data, name, error) {
  let hash = 2166136261; // FNV-1a
  for (let i = 0; i < data.length; i++) hash = Math.imul(hash ^ data[i], 16777619);
  const key = `${hash >>> 0}:${data.length}`;
  const same = PICTURES.get(key)?.find(([kept]) => equal(kept, data));
  if (same) return same[1];
  const image = decodePicture(data, name, error);
  if (pictured + image.pixels.length > 64 << 20) { // at most 64 MB of them
    PICTURES.clear();
    pictured = 0;
  }
  pictured += image.pixels.length;
  PICTURES.set(key, [...(PICTURES.get(key) ?? []), [data.slice(), image]]);
  return image;
}

// ---------- sound ----------
// `play note "C4" for 0.5 seconds`, `play note 440 for 1 second` and `play a beep`. A sound is { hertz,
// seconds }: how many times a second it shakes (0 for a rest, which is silence) and how long it lasts. The
// engines hand each sound to `play`, in order, and whoever runs the program plays them one after the other.

// The notes from middle C up, C4 to B4, in hertz: A4 is 440, and each is 2 to the power 1/12 times the one
// before. They're written out, so every engine and machine code have exactly the same numbers; another
// octave is these doubled or halved, which is exact.
export const NOTE_HERTZ = [261.6255653005986, 277.1826309768721, 293.6647679174076, 311.1269837220809, 329.6275569128699,
  349.2282314330039, 369.9944227116344, 391.99543598174927, 415.3046975799451, 440, 466.1637615180899, 493.8833012561241];
const NOTE_STEPS = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }; // each letter's place among the 12
export const BEEP = { hertz: 880, seconds: 0.2 }; // `play a beep`: the A above A4, for a fifth of a second

// A note's name, in hertz, or undefined if it isn't one: a letter from A to G in either case, maybe # (a
// step up) or b (a step down), maybe an octave from 0 to 9 (4 if none), or "rest".
export function noteHertz(name) {
  if (name.toLowerCase() === "rest") return 0;
  const m = /^([A-Ga-g])([#b]?)([0-9]?)$/.exec(name);
  if (!m) return undefined;
  let step = NOTE_STEPS[m[1].toLowerCase()] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0);
  let octave = m[3] === "" ? 4 : Number(m[3]);
  if (step < 0) [step, octave] = [step + 12, octave - 1]; // Cb4 is B3
  if (step > 11) [step, octave] = [step - 12, octave + 1]; // B#4 is C5
  let hertz = NOTE_HERTZ[step];
  for (; octave > 4; octave--) hertz *= 2;
  for (; octave < 4; octave++) hertz /= 2;
  return hertz;
}

// `play note ... for ...`: the sound, from the note (a name or a number of hertz) and how long, which is
// `time` units of `unit` milliseconds, as `every` takes them. A sound lasts at most a minute.
export function soundOf(note, time, unit, error) {
  let hertz;
  if (typeof note === "number") {
    if (!(note >= 20 && note <= 20000)) error(`a note's pitch is from 20 to 20000 hertz, not ${show(note)}`);
    hertz = note;
  } else if (typeof note === "string") {
    hertz = noteHertz(note);
    if (hertz === undefined) error(`there is no note called '${note}' (write A to G, maybe with # or b and an octave from 0 to 9, like "C#4", or "rest")`);
  } else error(`'play note' needs a note like "C4" or a number, not ${kindOf(note)}`);
  if (typeof time !== "number") error(`'play note ... for' needs a number, not ${kindOf(time)}`);
  const ms = time * unit;
  if (!(ms >= 0 && ms <= 60000)) error(`a sound lasts from 0 to 60 seconds, not ${show(ms / 1000)} seconds`);
  return { hertz, seconds: ms / 1000 };
}

// A sound's samples, 44,100 a second, as 16-bit numbers, the way the playground and machine code play it:
// close to a sine wave (two parabolas, refined), a quarter as loud as it could be, rising from silence over
// its first 10 ms and falling back over its last 10, so it starts and stops without a click. Only + - * /
// and floor go into each one, so machine code works out exactly the same numbers.
export const SOUND_RATE = 44100;
export function soundSamples({ hertz, seconds }) {
  const n = Math.floor(seconds * SOUND_RATE + 0.5);
  const step = hertz / SOUND_RATE;
  const samples = new Int16Array(n);
  for (let k = 0; k < n; k++) {
    const x = k * step;
    const z = 2 * (x - Math.floor(x)) - 1; // where in its wave, from -1 to 1
    let y = 4 * z * (1 - Math.abs(z));
    y = 0.225 * (y * Math.abs(y) - y) + y; // about sin(pi z)
    const loud = Math.min(1, k / 441, (n - 1 - k) / 441);
    samples[k] = Math.floor(-y * loud * 8192 + 0.5);
  }
  return samples;
}

// Sounds, one after the other, as the bytes of a WAV file: what MOTH_SOUND=file.wav gets from machine code.
export function soundWav(sounds) {
  const parts = sounds.map(soundSamples);
  const size = parts.reduce((n, p) => n + 2 * p.length, 0);
  const bytes = new Uint8Array(44 + size);
  const view = new DataView(bytes.buffer);
  const text = (at, t) => [...t].forEach((c, i) => (bytes[at + i] = c.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + size, true);
  text(8, "WAVEfmt ");
  for (const [at, n, width] of [[16, 16, 4], [20, 1, 2], [22, 1, 2], [24, SOUND_RATE, 4], [28, 2 * SOUND_RATE, 4], [32, 2, 2], [34, 16, 2]]) {
    if (width === 4) view.setUint32(at, n, true);
    else view.setUint16(at, n, true);
  }
  text(36, "data");
  view.setUint32(40, size, true);
  let at = 44;
  for (const p of parts) for (const s of p) (view.setInt16(at, s, true), (at += 2));
  return bytes;
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

// the program's own scope, which every other is made in
const topOf = (env) => {
  while (env[0]) env = env[0];
  return env;
};

export function newEnv(fn, parent) {
  const env = new Array(fn.nslots + 1).fill(UNSET);
  env[0] = parent; // slot 0 links to the scope the function was made in
  return env;
}

// Runs bytecode. A Machine keeps its state between run() calls, so a debugger can pause it and carry on later.
export class Machine {
  // `draw` gets each line the turtle draws (see Turtle), `ask` answers questions (see askFor), `disk` holds
  // the files `read` and `write` use (see readFile), `args` is what `arguments` gives: a list of text, and
  // `random` gives the random numbers (see randomWhole). An app's handlers go in `listeners`, and `turtle`
  // keeps one picture going from one handler to the next (see callFunction). `printError` gets each line
  // said to the error output, and `play` each sound (see soundOf).
  constructor(main, print = console.log, { maxSteps = Infinity, env = newEnv(main, null), draw, ask, disk, args = [], random = seeded(), listeners = [], turtle, printError = console.error, clock = fakeClock(), play = () => {} } = {}) {
    Object.assign(this, { main, print, printError, play, maxSteps, ask, disk, args, random, clock, listeners, fn: main, env, ip: 0, base: 0, steps: 0, stack: [], frames: [], line: 0, done: false });
    this.handlers = []; // the `try`s running, innermost last: where each one's `if it fails` is, and what to go back to
    this.caught = null; // the value of the mistake an `if it fails` is handling
    this.turtle = turtle ?? new Turtle(draw);
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
            if (typeof a === "number" && typeof b === "number" && op < DIVISIBLE) stack.push(COMPARE_FNS[op](a, b)); // to 15 digits (see numberOrder)
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
            if (callee.fn.kinds) checkKinds(callee, stack, name, oops, first);
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
            if (!frames.length) { // the function this machine was made to run (see callFunction) is done
              this.done = true;
              why = "done";
              break loop;
            }
            const value = stack.pop();
            while (stack.length > base) stack.pop(); // drops anything a loop left behind
            const frame = frames.pop();
            ({ fn, ip, env, base } = frame);
            code = fn.code;
            consts = fn.consts;
            if (frame.worker) { // a worker's call, done: what it gave copied, and the program's variables back
              this.handlers.pop();
              const top = topOf(env);
              const result = workerGave(value, (f) => f.env === top);
              top.splice(1, top.length - 1, ...frame.worker);
              stack.push(workerEnded(result));
            } else stack.push(value);
            break;
          }
          case WORKER: { // as CALL, on copies: see workerCopy
            const argc = code[ip];
            const name = consts[code[ip + 1]];
            ip += 2;
            const first = stack.length - argc;
            const callee = stack[first - 1];
            checkInputs(callee, argc, name, oops);
            if (callee.fn.kinds) checkKinds(callee, stack, name, oops, first);
            if (frames.length >= MAX_DEPTH) oops("too much recursion: a function kept calling itself");
            if (++steps > maxSteps) stopped(maxSteps);
            const top = topOf(env);
            const saved = top.slice(1);
            const [given, fresh] = workerStart(callee, stack.slice(first), saved, (f) => f.env === top, oops);
            top.splice(1, top.length - 1, ...fresh);
            const inner = newEnv(callee.fn, callee.env);
            for (let i = 0; i < argc; i++) inner[i + 1] = given[i];
            stack.length = first - 1;
            this.handlers.push({ ip, frames: frames.length, stack: stack.length, fn, env, base, worker: saved });
            frames.push({ fn, ip, env, base, worker: saved });
            fn = callee.fn;
            code = fn.code;
            consts = fn.consts;
            env = inner;
            ip = 0;
            base = stack.length;
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
          case SAY_ERROR: {
            const n = code[ip++];
            this.printError(stack.splice(stack.length - n, n).map((v) => show(v)).join(""));
            break;
          }
          case EXIT: // not a Failure, so no `try` catches it, and it isn't a mistake
            throw new Ended(exitCode(stack.pop(), oops));
          case REMOVE_FILE:
            removeFile(stack.pop(), this.disk, oops);
            break;
          case READ_FOLDER:
            stack.push(readFolder(stack.pop(), this.disk, oops));
            break;
          case PLAY: {
            const unit = code[ip++];
            if (unit === 0) this.play({ ...BEEP });
            else {
              const time = stack.pop();
              this.play(soundOf(stack.pop(), time, unit, oops));
            }
            break;
          }
          case CHECK_REPEAT:
            stack[stack.length - 1] = checkRepeat(stack[stack.length - 1], oops); // to 15 digits: 0.1 * 30 is 3 times
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
            if (atMost(next, stack[top - 1])) {
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
          case HANDLE: {
            const event = code[ip++];
            const closure = stack.pop();
            if (LABELLED.has(event)) this.listeners.push({ event: EVENTS[event], label: show(stack.pop()), closure }); // the label under it
            else this.listeners.push({ event: EVENTS[event], closure });
            break;
          }
          case EVERY: {
            const closure = stack.pop();
            this.listeners.push({ event: "every", interval: everyInterval(stack.pop(), code[ip++], oops), closure });
            break;
          }
          case RANDOM: {
            const high = stack.pop();
            stack.push(randomWhole(stack.pop(), high, this.random, oops));
            break;
          }
          case NOW:
            stack.push(nowValue(code[ip++], this.clock));
            break;
          case WAIT:
            waitFor(stack.pop(), code[ip++], this.clock, oops);
            break;
          case ARGUMENTS:
            stack.push([...this.args]); // a new list each time, so changing one can't change the next
            break;
          case EXPECT: {
            const op = code[ip];
            if (op < 0) expectYes(stack.pop(), oops);
            else {
              const b = stack.pop();
              expectThat(COMPARE_OPS[op], code[ip + 1] === 1, stack.pop(), b, oops);
            }
            ip += 2;
            break;
          }
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
            stack.push(builtin.run(stack.splice(stack.length - builtin.needs.length), oops, this.turtle, this.disk));
            break;
          }
          case FAIL:
            failWith(stack.pop(), oops);
            break;
          case TURTLE: {
            const action = code[ip++];
            this.turtle.act(action, TURTLE_BARE.has(action) ? null : stack.pop(), oops, this.disk);
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
      if (handler.worker) { // a worker's mistake, kept for `wait for`, and the program's variables back
        const top = topOf(env);
        const result = workerFailed(this.caught, (f) => f.env === top);
        top.splice(1, top.length - 1, ...handler.worker);
        stack.push(workerEnded(result));
      }
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
  // A name no program can write, made for what a statement is written as (`the step on line 3`), isn't shown.
  inspect() {
    const scopes = [];
    for (let fn = this.fn, env = this.env; fn; fn = fn.parent, env = env[0]) {
      scopes.push({ name: fn.name, vars: fn.names.flatMap((name, slot) => (env[slot] === UNSET || name.includes(" on line ") ? [] : [[name, show(env[slot], true)]])) });
    }
    return { line: this.line, calls: [...this.frames.map((f) => f.fn.name), this.fn.name], scopes };
  }
}

// Runs a Moth function from outside, as an app runs a handler: a machine of its own, whose program is the
// function's code, with `inputs` in its first slots. `options` are the Machine's.
export function callFunction(closure, inputs, print, options) {
  const env = newEnv(closure.fn, closure.env);
  inputs.slice(0, closure.fn.params.length).forEach((value, i) => (env[i + 1] = value));
  new Machine(closure.fn, print, { ...options, env }).run();
}

export function execute(main, print, maxSteps, env, ask, disk, args, random) {
  new Machine(main, print, { maxSteps, env, ask, disk, args, random }).run();
}
