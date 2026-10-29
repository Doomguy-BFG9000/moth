// The WebAssembly engine: Moth's third back end. It compiles a program to a WebAssembly module, byte by
// byte (wasm-binary.js), which the browser or node compiles to machine code.
//
// Moth's values live inside the module, as WebAssembly GC values: a number is a struct holding an f64,
// yes and no are i31 values, nothing is null, and lists, records and functions are structs. Text is a
// struct holding a JavaScript string, so joining it is as cheap as in JavaScript (which joins long text
// without copying it) and it fails at exactly the same length. The common cases run in WebAssembly: arithmetic on numbers, comparisons, list
// items, fields, calls and loops. Everything else, and every mistake, calls out to the same checks the VM
// and the JIT use (vm.js), so all three engines say exactly the same things.
import { Scope } from "./scope.js";
import { Module, Code, ref, refNull } from "./wasm-binary.js";
import { TooDeep } from "./jit.js";
import { MothError, catchable, caughtValue, UNSET, Closure, Turtle, TURTLE_ACTIONS, COMPARE_OPS, fail, equal, show, item, compare, plus, arithmetic, negate,
  lengthOf, addInto, checkRepeat, checkRange, itemsOf, callable, checkInputs, KINDS, numberOrder, divisible, canon, noValue, stoppedMessage, makeRecord, fieldOf,
  recordFor, failWith, BUILTINS, askFor, putItem, makeDictionary, removeKey, readFile, writeFile, trailOf, expectThat, expectYes, randomWhole, seeded, EVENTS, everyInterval } from "./vm.js";

const EQ = refNull("eq"); // any Moth value
const I32 = "i32";
const F64 = "f64";
const MAX_DEPTH = 2000; // as in the JIT: deeper calls go to the VM, which has its own stack
const MATH = ["+", "-", "*", "/"];
const BIT_BUILTINS = ["bit and", "bit or", "bit xor", "shift left", "shift right"]; // in the order R.bits numbers them
const TAGS = { number: 1, text: 2, list: 3, record: 4, function: 5, unset: 6, dictionary: 7, bytes: 8 };
// ncmp's answer (-1, 0, 1, or 2 for NaN) made yes or no, for each comparison of two numbers
const ORDER_TESTS = {
  "is": (c) => c.emit("i32.eqz"),
  "less than": (c) => c.emit("i32.const", -1).emit("i32.eq"),
  "greater than": (c) => c.emit("i32.const", 1).emit("i32.eq"),
  "at least": (c) => c.emit("i32.const", 1).emit("i32.le_u"), // 0 or 1
  "at most": (c) => c.emit("i32.const", 1).emit("i32.add").emit("i32.const", 1).emit("i32.le_u"), // -1 or 0
};
// each tag as kindOf in vm.js says it, and each of vm.js's KINDS as kindOf says it
const TAG_KINDS = { 1: "a number", 2: "text", 3: "a list", 4: "a record", 5: "a function", 7: "a dictionary", 8: "bytes" };
const KIND_TAGS = ["a number", "text", "yes/no", "a list", "a record", "a dictionary", "bytes", "a function"];

// What the module imports: the checks and actions it leaves to JavaScript. Most only ever throw.
const IMPORTS = {
  say: [[EQ], []],
  fail: [[I32, I32], []], // a message the compiler worked out (a name nothing sets), and a position
  unset: [[I32, I32], []],
  plus: [[EQ, EQ, I32], [EQ]],
  arithmetic: [[I32, EQ, EQ, I32], []],
  negate: [[EQ, I32], []],
  compare: [[I32, EQ, EQ, I32], [I32]],
  remainder: [[F64, F64], [F64]],
  numberOrder: [[F64, F64], [I32]],
  divisible: [[F64, F64], [I32]],
  equal: [[EQ, EQ], [I32]],
  sameText: [["externref", "externref"], [I32]],
  text: [[I32], ["externref"]], // the program's text, by number
  lengthOf: [[EQ, I32], [F64]],
  item: [[EQ, EQ, I32], [EQ]],
  itemRef: [[EQ, EQ, I32], []],
  put: [[EQ, EQ, EQ, I32], []], // what `set item` does that WebAssembly doesn't: where, the key, the value, and a position
  dict: [[EQ, I32], [EQ]], // a new dictionary, from a list of each key and then its value
  remove: [[EQ, EQ, I32], []],
  // a dictionary's Map and a key as JavaScript holds it (text, or a number): fast, as nothing needs converting
  dictGetText: [["externref", "externref", I32], [EQ]],
  dictGetNum: [["externref", F64, I32], [EQ]],
  dictSetText: [["externref", "externref", EQ], []],
  dictSetNum: [["externref", F64, EQ], []],
  dictHasText: [["externref", "externref"], [I32]],
  dictHasNum: [["externref", F64], [I32]],
  addInto: [[EQ, EQ, I32, I32], [EQ]],
  checkRepeat: [[EQ, I32], [F64]],
  checkRange: [[EQ, EQ, I32], []],
  itemsOf: [[EQ, I32], [EQ]],
  callable: [[EQ, I32, I32], []],
  checkInputs: [[EQ, I32, I32, I32], []],
  checkKind: [[I32, I32, EQ, I32, I32], []],
  stopped: [[I32], []],
  tooDeep: [[], []],
  turtle: [[I32, EQ, I32], []],
  field: [[EQ, I32, I32], []],
  recordFor: [[EQ, I32, I32], []],
  failWith: [[EQ, I32], []],
  builtin: [[I32, EQ, I32], [EQ]], // which one, its inputs as a list, and a position
  ask: [[EQ, I32], [EQ]],
  read: [[EQ, I32, I32], [EQ]], // the file's name, 1 for bytes or 0 for text, and a position
  write: [[EQ, EQ, I32], []],
  args: [[], [EQ]],
  random: [[EQ, EQ, I32], [EQ]], // low, high, a position
  handle: [[I32, EQ, I32], []], // which event (EVENTS), its handler, a position
  every: [[EQ, F64, EQ, I32], []], // how often, 1 or 1000 (for seconds), the handler, a position
  expect: [[I32, I32, EQ, EQ, I32], []], // which comparison, 1 for `is not`, its two sides, and a position
  expectYes: [[EQ, I32], []],
  tryStart: [[], []], // a `try` begins: forget the last mistake
  caught: [[], [I32]], // 1 if what was thrown is a mistake a `try` catches
  caughtValue: [[], [EQ]],
};

// ---------- the module's types and runtime ----------

function declareTypes(m) {
  const T = {};
  T.num = m.type({ kind: "struct", fields: [{ type: F64 }] });
  T.text = m.type({ kind: "struct", fields: [{ type: "externref" }] });
  T.items = m.type({ kind: "array", element: { type: EQ, mutable: true } });
  T.list = m.type({ kind: "struct", fields: [{ type: ref(T.items), mutable: true }, { type: I32, mutable: true }] });
  T.ids = m.type({ kind: "array", element: { type: I32, mutable: true } });
  T.record = m.type({ kind: "struct", fields: [{ type: ref(T.ids), mutable: true }, { type: ref(T.items), mutable: true }, { type: I32, mutable: true }] });
  T.env = m.types.length; // a scope: the one it was made in, and its variables' slots
  m.type({ kind: "struct", fields: [{ type: refNull(T.env) }, { type: ref(T.items) }] });
  T.closure = m.type({ kind: "struct", fields: [{ type: "funcref" }, { type: refNull(T.env) }, { type: I32 }, { type: I32 }, { type: I32 }] });
  T.unset = m.type({ kind: "struct", fields: [] });
  // A value JavaScript keeps, and its tag: a dictionary, which is a Map from keys as JavaScript values to the
  // module's own values.
  T.host = m.type({ kind: "struct", fields: [{ type: "externref" }, { type: I32 }] });
  // Bytes live here, as an array of 8-bit numbers, so reading and changing one never leaves WebAssembly.
  T.u8 = m.type({ kind: "array", element: { type: "i8", mutable: true } });
  T.bytes = m.type({ kind: "struct", fields: [{ type: ref(T.u8) }] });
  T.fn = (n) => { // a Moth function with n inputs
    const index = m.funcType([refNull(T.env), ...Array(n).fill(EQ)], [EQ]);
    m.typeNames[index] = `fn${n}`;
    return index;
  };
  for (const name of ["num", "text", "items", "list", "ids", "record", "env", "closure", "unset", "host", "u8", "bytes"]) m.typeNames[T[name]] = name;
  return T;
}

// Small helpers for writing WebAssembly by hand: each takes the Code and emits a few instructions.
const isNum = (c, T, local) => c.emit("local.get", local).emit("ref.test", T.num);
const numOf = (c, T, local) => c.emit("local.get", local).emit("ref.cast", T.num).emit("struct.get", T.num, 0);
const bothNums = (c, T, a, b) => (isNum(c, T, a), isNum(c, T, b), c.emit("i32.and"));
const mapOf = (c, T, local) => c.emit("local.get", local).emit("ref.cast", T.host).emit("struct.get", T.host, 0); // a dictionary's Map
const textOf = (c, T, local) => c.emit("local.get", local).emit("ref.cast", T.text).emit("struct.get", T.text, 0); // text's JavaScript string
const bytesOf = (c, T, local) => c.emit("local.get", local).emit("ref.cast", T.bytes).emit("struct.get", T.bytes, 0);
// leaves 1 if the f64 in `local` is a whole number from `low` to `high`
const wholeIn = (c, local, low, high) => c.emit("local.get", local).emit("local.get", local).emit("f64.trunc").emit("f64.eq")
  .emit("local.get", local).emit("f64.const", low).emit("f64.ge").emit("i32.and").emit("local.get", local).emit("f64.const", high).emit("f64.le").emit("i32.and");

// The functions every module has: fast paths for the common cases, calling out to JavaScript for the rest.
function declareRuntime(m, T, im) {
  const R = {};
  const fn = (label, params, results, write) => {
    const f = m.func(label, params, results);
    R[label] = f.index;
    write(f.code, f);
  };

  fn("truthy", [EQ], [I32], (c) => {
    c.emit("local.get", 0).emit("ref.is_null").emit("if", I32).emit("i32.const", 0).emit("else");
    c.emit("local.get", 0).emit("ref.test", "i31").emit("if", I32);
    c.emit("local.get", 0).emit("ref.cast", "i31").emit("i31.get_u").emit("else").emit("i32.const", 1).emit("end");
    c.emit("end");
  });

  // + - * /: two numbers here, anything else (joining text, or a mistake) in JavaScript
  MATH.forEach((sign, op) => {
    fn(["add", "sub", "mul", "div"][op], [EQ, EQ, I32], [EQ], (c) => {
      bothNums(c, T, 0, 1).emit("if", EQ);
      if (sign === "/") numOf(c, T, 1).emit("f64.const", 0).emit("f64.ne").emit("if", EQ);
      numOf(c, T, 0);
      numOf(c, T, 1);
      c.emit(["f64.add", "f64.sub", "f64.mul", "f64.div"][op]).emit("struct.new", T.num);
      const slow = () => {
        if (sign === "+") c.emit("local.get", 0).emit("local.get", 1).emit("local.get", 2).emit("call", im.plus);
        else c.emit("i32.const", op).emit("local.get", 0).emit("local.get", 1).emit("local.get", 2).emit("call", im.arithmetic).emit("unreachable");
      };
      if (sign === "/") c.emit("else").emit("i32.const", op).emit("local.get", 0).emit("local.get", 1).emit("local.get", 2).emit("call", im.arithmetic).emit("unreachable").emit("end");
      c.emit("else");
      slow();
      c.emit("end");
    });
  });

  fn("neg", [EQ, I32], [EQ], (c) => {
    isNum(c, T, 0).emit("if", EQ);
    numOf(c, T, 0).emit("f64.neg").emit("struct.new", T.num);
    c.emit("else").emit("local.get", 0).emit("local.get", 1).emit("call", im.negate).emit("unreachable").emit("end");
  });

  // How two numbers compare, to 15 digits (numberOrder in vm.js): -1, 0, 1, or 2 if either is NaN. Two that are
  // equal, two whole numbers, and two further apart than 15 digits tell are answered here; the rest, which
  // agree to 15 digits or nearly, in JavaScript.
  fn("ncmp", [F64, F64], [I32], (c) => {
    c.emit("local.get", 0).emit("local.get", 1).emit("f64.eq").emit("if").emit("i32.const", 0).emit("return").emit("end");
    const whole = (x) => c.emit("local.get", x).emit("local.get", x).emit("f64.trunc").emit("f64.eq");
    whole(0);
    whole(1);
    c.emit("i32.and").emit("i32.eqz");
    c.emit("local.get", 0).emit("local.get", 1).emit("f64.sub").emit("f64.abs");
    c.emit("local.get", 0).emit("f64.abs").emit("local.get", 1).emit("f64.abs").emit("f64.max").emit("f64.const", 1e-14).emit("f64.mul").emit("f64.le");
    c.emit("i32.and").emit("if").emit("local.get", 0).emit("local.get", 1).emit("call", im.numberOrder).emit("return").emit("end");
    c.emit("local.get", 0).emit("local.get", 1).emit("f64.lt").emit("if").emit("i32.const", -1).emit("return").emit("end");
    c.emit("local.get", 0).emit("local.get", 1).emit("f64.gt").emit("if").emit("i32.const", 1).emit("return").emit("end");
    c.emit("i32.const", 2);
  });

  // `is`: numbers by value, text by its letters, lists, records, dictionaries and bytes (in JavaScript) by
  // what they hold, everything else (yes, no, nothing, functions) by identity
  fn("eq", [EQ, EQ], [I32], (c) => {
    bothNums(c, T, 0, 1).emit("if");
    numOf(c, T, 0);
    numOf(c, T, 1);
    c.emit("call", R.ncmp).emit("i32.eqz").emit("return").emit("end");
    c.emit("local.get", 0).emit("local.get", 1).emit("ref.eq").emit("if").emit("i32.const", 1).emit("return").emit("end");
    const both = (type) => c.emit("local.get", 0).emit("ref.test", type).emit("local.get", 1).emit("ref.test", type).emit("i32.and");
    both(T.text).emit("if");
    c.emit("local.get", 0).emit("ref.cast", T.text).emit("struct.get", T.text, 0).emit("local.get", 1).emit("ref.cast", T.text).emit("struct.get", T.text, 0);
    c.emit("call", im.sameText).emit("return").emit("end");
    both(T.list);
    both(T.record);
    c.emit("i32.or");
    both(T.host);
    c.emit("i32.or");
    both(T.bytes);
    c.emit("i32.or").emit("if").emit("local.get", 0).emit("local.get", 1).emit("call", im.equal).emit("return").emit("end");
    c.emit("i32.const", 0);
  });

  // less than, greater than, at least, at most: numbers here, text and mistakes in JavaScript
  ["lt", "gt", "ge", "le"].forEach((label, i) => {
    fn(label, [EQ, EQ, I32], [I32], (c) => {
      bothNums(c, T, 0, 1).emit("if", I32);
      numOf(c, T, 0);
      numOf(c, T, 1);
      c.emit("call", R.ncmp);
      ORDER_TESTS[["less than", "greater than", "at least", "at most"][i]](c);
      c.emit("else");
      c.emit("i32.const", i + 1).emit("local.get", 0).emit("local.get", 1).emit("local.get", 2).emit("call", im.compare).emit("end");
    });
  });

  // `is divisible by` on two numbers. For whole numbers below 2^52, a is divisible by b exactly when
  // a = trunc(a / b) * b: a whole quotient divides exactly, and every product here is a whole number a
  // float holds exactly. Fractions and huge numbers go to JavaScript's %, and 0 to the shared check's error.
  fn("dvf", [F64, F64, I32], [I32], (c) => {
    const whole = (x) => c.emit("local.get", x).emit("local.get", x).emit("f64.trunc").emit("f64.eq").emit("local.get", x).emit("f64.abs").emit("f64.const", 2 ** 52).emit("f64.lt").emit("i32.and");
    c.emit("local.get", 1).emit("f64.const", 0).emit("f64.eq").emit("if");
    c.emit("i32.const", COMPARE_OPS.indexOf("divisible by")).emit("local.get", 0).emit("struct.new", T.num).emit("local.get", 1).emit("struct.new", T.num);
    c.emit("local.get", 2).emit("call", im.compare).emit("return").emit("end");
    whole(0);
    whole(1);
    c.emit("i32.and").emit("if", I32);
    c.emit("local.get", 0).emit("local.get", 0).emit("local.get", 1).emit("f64.div").emit("f64.trunc").emit("local.get", 1).emit("f64.mul").emit("f64.eq");
    c.emit("else").emit("local.get", 0).emit("local.get", 1).emit("call", im.divisible).emit("end"); // to 15 digits, in JavaScript
  });

  fn("dv", [EQ, EQ, I32], [I32], (c) => {
    bothNums(c, T, 0, 1).emit("if", I32);
    numOf(c, T, 0);
    numOf(c, T, 1);
    c.emit("local.get", 2).emit("call", R.dvf);
    c.emit("else").emit("i32.const", COMPARE_OPS.indexOf("divisible by")).emit("local.get", 0).emit("local.get", 1).emit("local.get", 2).emit("call", im.compare).emit("end");
  });

  fn("lengthOf", [EQ, I32], [EQ], (c) => {
    c.emit("local.get", 0).emit("ref.test", T.list).emit("if", F64);
    c.emit("local.get", 0).emit("ref.cast", T.list).emit("struct.get", T.list, 1).emit("f64.convert_i32_s");
    c.emit("else").emit("local.get", 0).emit("ref.test", T.bytes).emit("if", F64);
    bytesOf(c, T, 0).emit("array.len").emit("f64.convert_i32_s");
    c.emit("else").emit("local.get", 0).emit("local.get", 1).emit("call", im.lengthOf).emit("end").emit("end").emit("struct.new", T.num);
  });

  // The 0-based place of item n in a list, if n is a whole number from 1 to its length, or -1.
  fn("place", [EQ, EQ], [I32], (c, f) => {
    const x = f.local(F64);
    c.emit("local.get", 0).emit("ref.test", T.list);
    isNum(c, T, 1).emit("i32.and").emit("i32.eqz").emit("if").emit("i32.const", -1).emit("return").emit("end");
    numOf(c, T, 1).emit("local.tee", x).emit("local.get", x).emit("f64.trunc").emit("f64.eq");
    c.emit("local.get", x).emit("f64.const", 1).emit("f64.ge").emit("i32.and");
    c.emit("local.get", x).emit("local.get", 0).emit("ref.cast", T.list).emit("struct.get", T.list, 1).emit("f64.convert_i32_s").emit("f64.le").emit("i32.and");
    c.emit("if", I32).emit("local.get", x).emit("i32.trunc_f64_s").emit("i32.const", 1).emit("i32.sub").emit("else").emit("i32.const", -1).emit("end");
  });

  // The same for bytes.
  fn("bytePlace", [EQ, EQ], [I32], (c, f) => {
    const x = f.local(F64);
    c.emit("local.get", 0).emit("ref.test", T.bytes);
    isNum(c, T, 1).emit("i32.and").emit("i32.eqz").emit("if").emit("i32.const", -1).emit("return").emit("end");
    numOf(c, T, 1).emit("local.tee", x).emit("local.get", x).emit("f64.trunc").emit("f64.eq");
    c.emit("local.get", x).emit("f64.const", 1).emit("f64.ge").emit("i32.and");
    c.emit("local.get", x);
    bytesOf(c, T, 0).emit("array.len").emit("f64.convert_i32_s").emit("f64.le").emit("i32.and");
    c.emit("if", I32).emit("local.get", x).emit("i32.trunc_f64_s").emit("i32.const", 1).emit("i32.sub").emit("else").emit("i32.const", -1).emit("end");
  });

  // `item n of x`: a list's item, or a byte, here; a dictionary's value straight from its Map; the rest, and
  // every mistake, in the shared code
  fn("item", [EQ, EQ, I32], [EQ], (c, f) => {
    const at = f.local(I32);
    c.emit("local.get", 0).emit("local.get", 1).emit("call", R.place).emit("local.tee", at).emit("i32.const", 0).emit("i32.ge_s").emit("if");
    c.emit("local.get", 0).emit("ref.cast", T.list).emit("struct.get", T.list, 0).emit("local.get", at).emit("array.get", T.items).emit("return").emit("end");
    c.emit("local.get", 0).emit("local.get", 1).emit("call", R.bytePlace).emit("local.tee", at).emit("i32.const", 0).emit("i32.ge_s").emit("if");
    bytesOf(c, T, 0).emit("local.get", at).emit("array.get_u", T.u8).emit("f64.convert_i32_u").emit("struct.new", T.num).emit("return").emit("end");
    c.emit("local.get", 0).emit("ref.test", T.host).emit("if");
    c.emit("local.get", 1).emit("ref.test", T.text).emit("if");
    mapOf(c, T, 0);
    textOf(c, T, 1).emit("local.get", 2).emit("call", im.dictGetText).emit("return").emit("end");
    isNum(c, T, 1).emit("if");
    mapOf(c, T, 0);
    numOf(c, T, 1).emit("local.get", 2).emit("call", im.dictGetNum).emit("return").emit("end");
    c.emit("end");
    c.emit("local.get", 0).emit("local.get", 1).emit("local.get", 2).emit("call", im.item);
  });

  // where `set item n of x to ...` goes: the place in a list, or -1 for a byte or a dictionary's key (see
  // put), checked before the value is worked out; anything else fails in the shared code
  fn("itemRef", [EQ, EQ, I32], [I32], (c, f) => {
    const at = f.local(I32);
    c.emit("local.get", 0).emit("local.get", 1).emit("call", R.place).emit("local.tee", at).emit("i32.const", 0).emit("i32.ge_s").emit("if").emit("local.get", at).emit("return").emit("end");
    c.emit("local.get", 0).emit("local.get", 1).emit("call", R.bytePlace).emit("i32.const", 0).emit("i32.ge_s").emit("if").emit("i32.const", -1).emit("return").emit("end");
    c.emit("local.get", 0).emit("ref.test", T.host).emit("local.get", 1).emit("ref.test", T.text);
    isNum(c, T, 1).emit("i32.or").emit("i32.and").emit("if").emit("i32.const", -1).emit("return").emit("end");
    c.emit("local.get", 0).emit("local.get", 1).emit("local.get", 2).emit("call", im.itemRef).emit("i32.const", -1);
  });

  // a value into a byte (a whole number from 0 to 255), or into a dictionary's Map, where itemRef said to;
  // anything else is a mistake, which the shared code words
  fn("put", [EQ, EQ, EQ, I32], [], (c, f) => {
    const [at, v] = [f.local(I32), f.local(F64)];
    c.emit("local.get", 0).emit("local.get", 1).emit("call", R.bytePlace).emit("local.tee", at).emit("i32.const", 0).emit("i32.ge_s");
    isNum(c, T, 2).emit("i32.and").emit("if");
    numOf(c, T, 2).emit("local.set", v);
    wholeIn(c, v, 0, 255).emit("if");
    bytesOf(c, T, 0).emit("local.get", at).emit("local.get", v).emit("i32.trunc_f64_s").emit("array.set", T.u8).emit("return");
    c.emit("end").emit("end");
    c.emit("local.get", 0).emit("ref.test", T.host).emit("if");
    c.emit("local.get", 1).emit("ref.test", T.text).emit("if");
    mapOf(c, T, 0);
    textOf(c, T, 1).emit("local.get", 2).emit("call", im.dictSetText).emit("return").emit("end");
    isNum(c, T, 1).emit("if");
    mapOf(c, T, 0);
    numOf(c, T, 1).emit("local.get", 2).emit("call", im.dictSetNum).emit("return").emit("end");
    c.emit("end");
    c.emit("local.get", 0).emit("local.get", 1).emit("local.get", 2).emit("local.get", 3).emit("call", im.put);
  });

  // `x is in d` for a dictionary, straight from its Map; anything else in the shared code
  fn("isIn", [EQ, EQ, I32], [I32], (c) => {
    c.emit("local.get", 1).emit("ref.test", T.host).emit("if");
    c.emit("local.get", 0).emit("ref.test", T.text).emit("if");
    mapOf(c, T, 1);
    textOf(c, T, 0).emit("call", im.dictHasText).emit("return").emit("end");
    isNum(c, T, 0).emit("if");
    mapOf(c, T, 1);
    numOf(c, T, 0).emit("call", im.dictHasNum).emit("return").emit("end");
    c.emit("end");
    c.emit("i32.const", COMPARE_OPS.indexOf("in")).emit("local.get", 0).emit("local.get", 1).emit("local.get", 2).emit("call", im.compare);
  });

  // `bit and`, `bit or`, `bit xor` (which = 0, 1, 2) and `shift ... left/right by` (3, 4), here when both are
  // whole numbers below 2^31 (and a shift left is by at most 21, a right by at most 31, so the result is
  // exact); anything else goes to the shared code, as built-in number `index`
  fn("bits", [EQ, EQ, I32, I32, I32], [EQ], (c, f) => {
    const [x, y, a, b] = [f.local(F64), f.local(F64), f.local(I32), f.local(I32)];
    bothNums(c, T, 0, 1).emit("if");
    numOf(c, T, 0).emit("local.set", x);
    numOf(c, T, 1).emit("local.set", y);
    wholeIn(c, x, 0, 2 ** 31 - 1);
    wholeIn(c, y, 0, 2 ** 31 - 1);
    c.emit("i32.and").emit("if");
    c.emit("local.get", x).emit("i32.trunc_f64_s").emit("local.set", a).emit("local.get", y).emit("i32.trunc_f64_s").emit("local.set", b);
    ["i32.and", "i32.or", "i32.xor"].forEach((op, which) => {
      c.emit("local.get", 2).emit("i32.const", which).emit("i32.eq").emit("if");
      c.emit("local.get", a).emit("local.get", b).emit(op).emit("f64.convert_i32_u").emit("struct.new", T.num).emit("return").emit("end");
    });
    c.emit("local.get", 2).emit("i32.const", 3).emit("i32.eq").emit("local.get", b).emit("i32.const", 21).emit("i32.le_u").emit("i32.and").emit("if");
    c.emit("local.get", x).emit("i32.const", 1).emit("local.get", b).emit("i32.shl").emit("f64.convert_i32_u").emit("f64.mul").emit("struct.new", T.num).emit("return").emit("end");
    c.emit("local.get", 2).emit("i32.const", 4).emit("i32.eq").emit("local.get", b).emit("i32.const", 31).emit("i32.le_u").emit("i32.and").emit("if");
    c.emit("local.get", a).emit("local.get", b).emit("i32.shr_u").emit("f64.convert_i32_u").emit("struct.new", T.num).emit("return").emit("end");
    c.emit("end").emit("end");
    c.emit("local.get", 3).emit("local.get", 0).emit("local.get", 1).emit("array.new_fixed", T.items, 2).emit("i32.const", 2).emit("struct.new", T.list);
    c.emit("local.get", 4).emit("call", im.builtin);
  });

  // `n bytes`, all 0, here when n is a whole number up to 2^28; anything else goes to the shared code
  fn("newBytes", [EQ, I32, I32], [EQ], (c, f) => {
    const n = f.local(F64);
    isNum(c, T, 0).emit("if");
    numOf(c, T, 0).emit("local.set", n);
    wholeIn(c, n, 0, 2 ** 28).emit("if");
    c.emit("local.get", n).emit("i32.trunc_f64_s").emit("array.new_default", T.u8).emit("struct.new", T.bytes).emit("return").emit("end");
    c.emit("end");
    c.emit("local.get", 1).emit("local.get", 0).emit("array.new_fixed", T.items, 1).emit("i32.const", 1).emit("struct.new", T.list);
    c.emit("local.get", 2).emit("call", im.builtin);
  });

  // grows the list's array by doubling when it's full
  fn("push", [EQ, EQ], [], (c, f) => {
    const [list, items, n, bigger] = [f.local(refNull(T.list)), f.local(refNull(T.items)), f.local(I32), f.local(refNull(T.items))];
    c.emit("local.get", 0).emit("ref.cast", T.list).emit("local.tee", list).emit("struct.get", T.list, 0).emit("local.set", items);
    c.emit("local.get", list).emit("struct.get", T.list, 1).emit("local.tee", n).emit("local.get", items).emit("array.len").emit("i32.eq").emit("if");
    c.emit("local.get", n).emit("i32.const", 1).emit("i32.shl").emit("i32.const", 4).emit("i32.add").emit("array.new_default", T.items).emit("local.tee", bigger);
    c.emit("i32.const", 0).emit("local.get", items).emit("i32.const", 0).emit("local.get", n).emit("array.copy", T.items, T.items);
    c.emit("local.get", list).emit("local.get", bigger).emit("ref.as_non_null").emit("struct.set", T.list, 0).emit("local.get", bigger).emit("local.set", items).emit("end");
    c.emit("local.get", items).emit("local.get", n).emit("local.get", 1).emit("array.set", T.items);
    c.emit("local.get", list).emit("local.get", n).emit("i32.const", 1).emit("i32.add").emit("struct.set", T.list, 1);
  });

  // `add value to name`: numbers and lists here, text and mistakes in JavaScript; returns the new value
  fn("addInto", [EQ, EQ, I32, I32], [EQ], (c) => {
    bothNums(c, T, 0, 1).emit("if");
    numOf(c, T, 0);
    numOf(c, T, 1);
    c.emit("f64.add").emit("struct.new", T.num).emit("return").emit("end");
    c.emit("local.get", 0).emit("ref.test", T.list).emit("if").emit("local.get", 0).emit("local.get", 1).emit("call", R.push).emit("local.get", 0).emit("return").emit("end");
    c.emit("local.get", 0).emit("local.get", 1).emit("local.get", 2).emit("local.get", 3).emit("call", im.addInto);
  });

  // what `for each` goes through: a copy, so adding to the list inside the loop can't make it endless
  fn("itemsOf", [EQ, I32], [refNull(T.list)], (c, f) => {
    const [n, copy, i, bytes] = [f.local(I32), f.local(refNull(T.items)), f.local(I32), f.local(refNull(T.u8))];
    c.emit("local.get", 0).emit("ref.test", T.list).emit("if");
    c.emit("local.get", 0).emit("ref.cast", T.list).emit("struct.get", T.list, 1).emit("local.tee", n).emit("array.new_default", T.items).emit("local.tee", copy);
    c.emit("i32.const", 0).emit("local.get", 0).emit("ref.cast", T.list).emit("struct.get", T.list, 0).emit("i32.const", 0).emit("local.get", n).emit("array.copy", T.items, T.items);
    c.emit("local.get", copy).emit("ref.as_non_null").emit("local.get", n).emit("struct.new", T.list).emit("return").emit("end");
    c.emit("local.get", 0).emit("ref.test", T.bytes).emit("if"); // bytes: a list of their numbers
    bytesOf(c, T, 0).emit("local.tee", bytes).emit("array.len").emit("local.tee", n).emit("array.new_default", T.items).emit("local.set", copy);
    c.emit("block").emit("loop").emit("local.get", i).emit("local.get", n).emit("i32.ge_s").emit("br_if", 1);
    c.emit("local.get", copy).emit("local.get", i).emit("local.get", bytes).emit("local.get", i).emit("array.get_u", T.u8).emit("f64.convert_i32_u").emit("struct.new", T.num).emit("array.set", T.items);
    c.emit("local.get", i).emit("i32.const", 1).emit("i32.add").emit("local.set", i).emit("br", 0).emit("end").emit("end");
    c.emit("local.get", copy).emit("ref.as_non_null").emit("local.get", n).emit("struct.new", T.list).emit("return").emit("end");
    c.emit("local.get", 0).emit("local.get", 1).emit("call", im.itemsOf).emit("ref.cast", T.list);
  });

  fn("repeatCount", [EQ, I32], [F64], (c, f) => {
    const x = f.local(F64);
    isNum(c, T, 0).emit("if");
    numOf(c, T, 0).emit("local.tee", x).emit("local.get", x).emit("f64.trunc").emit("f64.eq");
    c.emit("local.get", x).emit("f64.const", 0).emit("f64.ge").emit("i32.and");
    c.emit("local.get", x).emit("local.get", x).emit("f64.sub").emit("f64.const", 0).emit("f64.eq").emit("i32.and"); // not infinite
    c.emit("if").emit("local.get", x).emit("return").emit("end").emit("end");
    c.emit("local.get", 0).emit("local.get", 1).emit("call", im.checkRepeat); // whole to 15 digits, or a mistake
  });

  // where a field is in a record, or -1
  fn("find", [EQ, I32], [I32], (c, f) => {
    const [i, n] = [f.local(I32), f.local(I32)];
    c.emit("local.get", 0).emit("ref.cast", T.record).emit("struct.get", T.record, 2).emit("local.set", n);
    c.emit("block").emit("loop").emit("local.get", i).emit("local.get", n).emit("i32.ge_s").emit("br_if", 1);
    c.emit("local.get", 0).emit("ref.cast", T.record).emit("struct.get", T.record, 0).emit("local.get", i).emit("array.get", T.ids);
    c.emit("local.get", 1).emit("i32.eq").emit("if").emit("local.get", i).emit("return").emit("end");
    c.emit("local.get", i).emit("i32.const", 1).emit("i32.add").emit("local.set", i).emit("br", 0).emit("end").emit("end");
    c.emit("i32.const", -1);
  });

  fn("newRecord", [], [EQ], (c) => {
    c.emit("i32.const", 4).emit("array.new_default", T.ids).emit("i32.const", 4).emit("array.new_default", T.items).emit("i32.const", 0).emit("struct.new", T.record);
  });

  // sets a field, adding it at the end if the record doesn't have it yet
  fn("setField", [EQ, I32, EQ], [], (c, f) => {
    const [r, at, n, ids, values] = [f.local(refNull(T.record)), f.local(I32), f.local(I32), f.local(refNull(T.ids)), f.local(refNull(T.items))];
    c.emit("local.get", 0).emit("ref.cast", T.record).emit("local.set", r);
    c.emit("local.get", 0).emit("local.get", 1).emit("call", R.find).emit("local.tee", at).emit("i32.const", 0).emit("i32.ge_s").emit("if");
    c.emit("local.get", r).emit("struct.get", T.record, 1).emit("local.get", at).emit("local.get", 2).emit("array.set", T.items).emit("return").emit("end");
    c.emit("local.get", r).emit("struct.get", T.record, 2).emit("local.tee", n).emit("local.get", r).emit("struct.get", T.record, 0).emit("array.len").emit("i32.eq").emit("if");
    c.emit("local.get", n).emit("i32.const", 1).emit("i32.shl").emit("i32.const", 4).emit("i32.add").emit("array.new_default", T.ids).emit("local.tee", ids);
    c.emit("i32.const", 0).emit("local.get", r).emit("struct.get", T.record, 0).emit("i32.const", 0).emit("local.get", n).emit("array.copy", T.ids, T.ids);
    c.emit("local.get", n).emit("i32.const", 1).emit("i32.shl").emit("i32.const", 4).emit("i32.add").emit("array.new_default", T.items).emit("local.tee", values);
    c.emit("i32.const", 0).emit("local.get", r).emit("struct.get", T.record, 1).emit("i32.const", 0).emit("local.get", n).emit("array.copy", T.items, T.items);
    c.emit("local.get", r).emit("local.get", ids).emit("ref.as_non_null").emit("struct.set", T.record, 0);
    c.emit("local.get", r).emit("local.get", values).emit("ref.as_non_null").emit("struct.set", T.record, 1).emit("end");
    c.emit("local.get", r).emit("struct.get", T.record, 0).emit("local.get", n).emit("local.get", 1).emit("array.set", T.ids);
    c.emit("local.get", r).emit("struct.get", T.record, 1).emit("local.get", n).emit("local.get", 2).emit("array.set", T.items);
    c.emit("local.get", r).emit("local.get", n).emit("i32.const", 1).emit("i32.add").emit("struct.set", T.record, 2);
  });

  fn("field", [EQ, I32, I32], [EQ], (c, f) => {
    const at = f.local(I32);
    c.emit("local.get", 0).emit("ref.test", T.record).emit("if");
    c.emit("local.get", 0).emit("local.get", 1).emit("call", R.find).emit("local.tee", at).emit("i32.const", 0).emit("i32.ge_s").emit("if");
    c.emit("local.get", 0).emit("ref.cast", T.record).emit("struct.get", T.record, 1).emit("local.get", at).emit("array.get", T.items).emit("return");
    c.emit("end").emit("end");
    c.emit("local.get", 0).emit("local.get", 1).emit("local.get", 2).emit("call", im.field).emit("unreachable");
  });

  return R;
}

// What JavaScript calls to look inside Moth's values, and to make them, when a check or `say` needs them.
function declareExports(m, T, R) {
  const fn = (label, params, results, write) => {
    const f = m.func(label, params, results);
    write(f.code);
    m.export(label, f.index);
  };
  fn("tag", [EQ], [I32], (c) => {
    for (const [type, tag] of [[T.num, TAGS.number], [T.text, TAGS.text], [T.list, TAGS.list], [T.record, TAGS.record], [T.closure, TAGS.function]])
      c.emit("local.get", 0).emit("ref.test", type).emit("if").emit("i32.const", tag).emit("return").emit("end");
    c.emit("local.get", 0).emit("ref.test", T.host).emit("if").emit("local.get", 0).emit("ref.cast", T.host).emit("struct.get", T.host, 1).emit("return").emit("end");
    c.emit("local.get", 0).emit("ref.test", T.bytes).emit("if").emit("i32.const", TAGS.bytes).emit("return").emit("end");
    c.emit("i32.const", TAGS.unset);
  });
  fn("num", [EQ], [F64], (c) => numOf(c, T, 0));
  fn("textValue", [EQ], ["externref"], (c) => c.emit("local.get", 0).emit("ref.cast", T.text).emit("struct.get", T.text, 0));
  fn("listLength", [EQ], [I32], (c) => c.emit("local.get", 0).emit("ref.cast", T.list).emit("struct.get", T.list, 1));
  fn("listItem", [EQ, I32], [EQ], (c) => c.emit("local.get", 0).emit("ref.cast", T.list).emit("struct.get", T.list, 0).emit("local.get", 1).emit("array.get", T.items));
  fn("recordSize", [EQ], [I32], (c) => c.emit("local.get", 0).emit("ref.cast", T.record).emit("struct.get", T.record, 2));
  fn("recordKey", [EQ, I32], [I32], (c) => c.emit("local.get", 0).emit("ref.cast", T.record).emit("struct.get", T.record, 0).emit("local.get", 1).emit("array.get", T.ids));
  fn("recordValue", [EQ, I32], [EQ], (c) => c.emit("local.get", 0).emit("ref.cast", T.record).emit("struct.get", T.record, 1).emit("local.get", 1).emit("array.get", T.items));
  fn("functionName", [EQ], [I32], (c) => c.emit("local.get", 0).emit("ref.cast", T.closure).emit("struct.get", T.closure, 3));
  fn("functionInputs", [EQ], [I32], (c) => c.emit("local.get", 0).emit("ref.cast", T.closure).emit("struct.get", T.closure, 2));
  fn("makeNum", [F64], [EQ], (c) => c.emit("local.get", 0).emit("struct.new", T.num));
  fn("makeText", ["externref"], [EQ], (c) => c.emit("local.get", 0).emit("struct.new", T.text));
  fn("newList", [], [EQ], (c) => c.emit("i32.const", 0).emit("array.new_default", T.items).emit("i32.const", 0).emit("struct.new", T.list));
  fn("listPush", [EQ, EQ], [], (c) => c.emit("local.get", 0).emit("local.get", 1).emit("call", R.push));
  fn("hostValue", [EQ], ["externref"], (c) => c.emit("local.get", 0).emit("ref.cast", T.host).emit("struct.get", T.host, 0));
  fn("makeHost", ["externref", I32], [EQ], (c) => c.emit("local.get", 0).emit("local.get", 1).emit("struct.new", T.host));
  fn("bytesLength", [EQ], [I32], (c) => bytesOf(c, T, 0).emit("array.len"));
  fn("byteAt", [EQ, I32], [I32], (c) => bytesOf(c, T, 0).emit("local.get", 1).emit("array.get_u", T.u8));
  fn("makeBytes", [I32], [EQ], (c) => c.emit("local.get", 0).emit("array.new_default", T.u8).emit("struct.new", T.bytes));
  fn("setByte", [EQ, I32, I32], [], (c) => bytesOf(c, T, 0).emit("local.get", 1).emit("local.get", 2).emit("array.set", T.u8));
}

// ---------- which variables need the heap ----------

// Escape analysis: a variable that a function made inside its own function uses must outlive the call,
// so it goes in the heap; every other variable is a WebAssembly local, which the machine can keep in a
// register. Returns, for each function's body (the program's, or a `define`'s), the slots to keep in the heap.
function findCaptured(program) {
  const captured = new Map();
  function visit(scope, body) {
    captured.set(body, new Set());
    const use = (name) => {
      const found = scope.resolve(name);
      if (!found || found[0] === 0) return;
      let owner = scope;
      for (let d = 0; d < found[0]; d++) owner = owner.parent;
      captured.get(owner.body).add(found[1]);
    };
    const expr = (e) => {
      if (e.kind === "name" || e.kind === "call") use(e.name);
      for (const child of [e.left, e.right, e.operand, e.of, e.index, ...(e.args ?? []), ...(e.items ?? []), ...(e.values ?? [])]) if (child) expr(child);
    };
    const statement = (s) => {
      if (["set", "add", "count", "each", "call"].includes(s.kind) || (s.kind === "try" && s.name)) use(s.name);
      for (const e of [s.value, s.cond, s.count, s.from, s.to, s.list, s.key, s.target, ...(s.parts ?? []), ...(s.args ?? [])]) if (e) expr(e);
      const made = s.kind === "define" ? s : s.fn; // `when` and `every` make a function too
      if (made) {
        if (s.interval) expr(s.interval);
        const inner = new Scope(scope, made.name, made.params, made.body);
        inner.body = made.body;
        return visit(inner, made.body);
      }
      for (const block of [s.then, s.otherwise, s.body, s.handler]) if (block) block.forEach(statement);
    };
    body.forEach(statement);
  }
  const main = new Scope(null, "main", [], program);
  main.body = program;
  visit(main, program);
  return captured;
}

const makesFunctions = (body) => body.some((s) => s.kind === "define" || s.fn || [s.then, s.otherwise, s.body, s.handler].some((b) => b && makesFunctions(b)));

// ---------- compiling Moth ----------

// One Moth function (or the program) as one WebAssembly function. Variables that functions made inside it
// use live in an array of slots in a scope struct, made when it's called, so those functions can reach
// them later; the rest are locals.
class WasmCompiler extends Scope {
  constructor(parent, name, params, body, ctx) {
    super(parent, name, params, body);
    this.ctx = ctx;
    this.labels = 0; // blocks, loops and ifs open where code is being written
    this.stops = []; // for each loop being written, the label count outside it, which a `stop` breaks out to
    const { m, T } = ctx;
    this.f = parent ? m.func(name, [refNull(T.env), ...params.map(() => EQ)], [EQ]) : m.func("main", [F64], []);
    this.c = this.f.code;
    const c = this.c;
    if (!parent) c.emit("local.get", 0).emit("global.set", ctx.maxSteps).emit("call", ctx.init.index);
    const captured = ctx.captured.get(body);
    this.numberSet = this.numericSlots(body, captured, parent ? params.length : 0);
    this.numbers = []; // slot -> { value, box } for the variables that only ever hold numbers
    this.locals = []; // slot -> local, for the other variables that stay here
    for (let slot = 1; slot <= this.fn.nslots; slot++) {
      if (captured.has(slot)) continue;
      if (this.numberSet.has(slot)) {
        this.numbers[slot] = { value: this.f.local(F64), box: this.f.local(EQ) };
        c.emit("global.get", ctx.unset).emit("local.set", this.numbers[slot].box).note(`${this.fn.names[slot]} has no value yet`);
        continue;
      }
      if (parent && slot <= params.length) this.locals[slot] = slot; // an input, already a parameter
      else c.emit("global.get", ctx.unset).emit("local.set", (this.locals[slot] = this.f.local(EQ))).note(`${this.fn.names[slot]} has no value yet`);
    }
    if (captured.size || makesFunctions(body)) {
      this.slotArray = this.f.local(refNull(T.items));
      this.envLocal = this.f.local(refNull(T.env));
      c.emit("global.get", ctx.unset).emit("i32.const", this.fn.nslots + 1).emit("array.new", T.items).emit("local.set", this.slotArray);
      if (parent) c.emit("local.get", 0); // the scope the function was made in
      else c.emit("ref.null", T.env);
      c.emit("local.get", this.slotArray).emit("ref.as_non_null").emit("struct.new", T.env).emit("local.set", this.envLocal);
      params.forEach((_, i) => {
        if (captured.has(i + 1)) c.emit("local.get", this.slotArray).emit("i32.const", i + 1).emit("local.get", i + 1).emit("array.set", T.items);
      });
    }
    for (const s of body) this.statement(s);
    if (parent) c.emit("ref.null", "eq");
  }

  // Type-directed unboxing: the variables of this function (not captured, not inputs) that can only ever
  // hold a number, because every `set` gives them one, or they count in `for each ... from`, or `add` adds
  // to them (which gives a number or fails). Each lives in an f64 local, so arithmetic on it allocates
  // nothing, with a box made only when the number is used as a value, and kept until the number changes.
  // The box local starts as UNSET, so "has no value yet" still works.
  numericSlots(body, captured, inputs) {
    const writes = new Map();
    const note = (name, value) => {
      const found = this.resolve(name);
      if (!found || found[0] !== 0 || found[1] <= inputs || captured.has(found[1])) return;
      if (!writes.has(found[1])) writes.set(found[1], []);
      writes.get(found[1]).push(value);
    };
    const walk = (statements) => {
      for (const s of statements) {
        if (s.kind === "set") note(s.name, s.value);
        else if (s.kind === "add") note(s.name, "adds");
        else if (s.kind === "count") note(s.name, "counts");
        else if (s.kind === "each" || s.kind === "define" || (s.kind === "try" && s.name)) note(s.name, null);
        if (s.kind !== "define") for (const block of [s.then, s.otherwise, s.body, s.handler]) if (block) walk(block);
      }
    };
    walk(body);
    const slots = new Set(writes.keys());
    for (let changed = true; changed; ) { // the most variables that stay numbers if all the others do
      changed = false;
      for (const slot of slots) {
        if (writes.get(slot).every((w) => w === "adds" || w === "counts" || (w !== null && this.isNumber(w, slots)))) continue;
        slots.delete(slot);
        changed = true;
      }
    }
    return slots;
  }

  // whether an expression can only give a number (or fail), when the variables in `slots` hold numbers
  isNumber(e, slots = this.numberSet) {
    switch (e.kind) {
      case "value":
        return typeof e.value === "number";
      case "name": {
        const found = this.resolve(e.name);
        return Boolean(found) && found[0] === 0 && slots.has(found[1]);
      }
      case "math":
        return e.op !== "+" || (this.isNumber(e.left, slots) && this.isNumber(e.right, slots));
      case "negate":
      case "length":
        return true;
      default:
        return false;
    }
  }

  // worth working out as an f64 and boxing once: its parts are numbers already
  unboxed(e) {
    if (e.kind === "math") return this.isNumber(e.left) && this.isNumber(e.right);
    return e.kind === "negate" && this.isNumber(e.operand);
  }

  numberSlot(name) {
    const found = this.resolve(name);
    return found && found[0] === 0 ? this.numbers[found[1]] : undefined;
  }

  // An expression isNumber() says gives a number, as an f64 on the stack.
  exprNum(e) {
    const { T, im } = this.ctx;
    if (e.kind === "value") return void this.e("f64.const", e.value);
    if (e.kind === "name") {
      const { value, box } = this.numberSlot(e.name);
      this.e("local.get", box).e("global.get", this.ctx.unset).e("ref.eq");
      this.e("if").e("i32.const", this.id(e.name)).e("i32.const", this.pos(e.at)).e("call", im.unset).e("unreachable").e("end");
      return void this.e("local.get", value).note(e.name);
    }
    if (e.kind === "math" && this.unboxed(e)) {
      this.exprNum(e.left);
      this.exprNum(e.right);
      if (e.op !== "/") return void this.e({ "+": "f64.add", "-": "f64.sub", "*": "f64.mul" }[e.op]);
      const [a, b] = [this.temp(F64), this.temp(F64)];
      this.e("local.set", b).e("local.set", a).e("local.get", b).e("f64.const", 0).e("f64.eq").e("if");
      this.e("i32.const", MATH.indexOf("/")).e("local.get", a).e("struct.new", T.num).e("local.get", b).e("struct.new", T.num);
      this.e("i32.const", this.pos(e.at)).e("call", im.arithmetic).e("unreachable").e("end");
      return void this.e("local.get", a).e("local.get", b).e("f64.div");
    }
    if (e.kind === "negate" && this.unboxed(e)) return void (this.exprNum(e.operand), this.e("f64.neg"));
    this.expr(e); // gives a number or fails
    this.e("ref.cast", T.num).e("struct.get", T.num, 0);
  }

  // stores the f64 on the stack in a number variable, forgetting its old box
  setNumber(slot) {
    this.e("local.set", slot.value).e("ref.null", "eq").e("local.set", slot.box);
  }

  e(op, ...args) {
    if (op === "end") this.labels--;
    this.c.emit(op, ...args);
    if (op === "block" || op === "loop" || op === "if" || op === "try") this.labels++;
    return this;
  }

  note(text) {
    this.c.note(text);
    return this;
  }

  pos(at) {
    return this.ctx.ats.push(at) - 1;
  }

  id(name) {
    return this.ctx.id(name);
  }

  temp(type = EQ) {
    return this.f.local(type);
  }

  // pushes the slots array a variable lives in, and its slot number
  slotOf(name) {
    const [depth, slot] = this.resolve(name);
    if (depth === 0) this.e("local.get", this.slotArray);
    else {
      // from this function's own scope, or, if it made none, from the one it was made in (its first parameter)
      const own = this.envLocal !== undefined;
      this.e("local.get", own ? this.envLocal : 0);
      for (let d = own ? 0 : 1; d < depth; d++) this.e("struct.get", this.ctx.T.env, 0);
      this.e("struct.get", this.ctx.T.env, 1);
    }
    this.e("i32.const", slot);
  }

  load(name) {
    const number = this.numberSlot(name);
    if (number) { // its box, made now if the number changed since the last one
      this.e("local.get", number.box).e("ref.is_null").e("if").e("local.get", number.value).e("struct.new", this.ctx.T.num).e("local.set", number.box).e("end");
      return this.e("local.get", number.box).note(name);
    }
    const [depth, slot] = this.resolve(name);
    if (depth === 0 && this.locals[slot] !== undefined) return this.e("local.get", this.locals[slot]).note(name);
    this.slotOf(name);
    this.e("array.get", this.ctx.T.items).note(name);
  }

  // `write` emits the value
  store(name, write) {
    if (this.numberSlot(name)) throw new Error(`'${name}' holds an f64, so it can't be stored boxed`);
    const [depth, slot] = this.resolve(name);
    if (depth === 0 && this.locals[slot] !== undefined) {
      write();
      return this.e("local.set", this.locals[slot]).note(`set ${name}`);
    }
    this.slotOf(name);
    write();
    this.e("array.set", this.ctx.T.items).note(`set ${name}`);
  }

  // A name nothing ever sets: fail when this runs, with the same message (and "did you mean") as the other engines.
  undefinedName(name, at, options) {
    this.e("i32.const", this.ctx.message(this.undefinedMessage(name, options))).e("i32.const", this.pos(at)).e("call", this.ctx.im.fail).e("unreachable");
  }

  // Each loop counts a step at the end of each round, and each call when it starts, as the other engines do.
  tick(k) {
    const { ctx } = this;
    this.e("global.get", ctx.steps).e("f64.const", 1).e("f64.add").e("global.set", ctx.steps).e("global.get", ctx.steps).e("global.get", ctx.maxSteps).e("f64.gt");
    this.e("if").e("i32.const", k).e("call", ctx.im.stopped).e("unreachable").e("end");
  }

  truthy() {
    this.e("call", this.ctx.R.truthy);
  }

  block(body) {
    for (const s of body) this.statement(s);
  }

  // block, loop, then `test` (leaving an i32 that is 1 to stop), the body, a step, and round again
  loop(k, test, body) {
    this.stops.push(this.labels);
    this.e("block").e("loop");
    test();
    this.e("br_if", 1);
    body();
    this.tick(k);
    this.e("br", 0).e("end").e("end");
    this.stops.pop();
  }

  statement(s) {
    const { T, R, im } = this.ctx;
    switch (s.kind) {
      case "set": {
        const number = this.numberSlot(s.name);
        if (!number) return this.store(s.name, () => this.expr(s.value));
        this.exprNum(s.value);
        return this.setNumber(number);
      }
      case "setItem": { // a list's item here, a byte or a dictionary's key in R.put
        const k = this.pos(s.target.at);
        const [list, key, at, value] = [this.temp(), this.temp(), this.temp(I32), this.temp()];
        this.expr(s.target.of);
        this.e("local.set", list);
        this.expr(s.target.index);
        this.e("local.set", key);
        this.e("local.get", list).e("local.get", key).e("i32.const", k).e("call", R.itemRef).e("local.set", at);
        this.expr(s.value);
        this.e("local.set", value);
        this.e("local.get", at).e("i32.const", 0).e("i32.ge_s").e("if");
        this.e("local.get", list).e("ref.cast", T.list).e("struct.get", T.list, 0).e("local.get", at).e("local.get", value).e("array.set", T.items);
        this.e("else").e("local.get", list).e("local.get", key).e("local.get", value).e("i32.const", k).e("call", R.put).e("end");
        return;
      }
      case "add": {
        const number = this.resolve(s.name) && this.numberSlot(s.name);
        if (number) return this.addToNumber(s, number);
        const value = this.temp();
        this.expr(s.value);
        this.e("local.set", value);
        if (!this.resolve(s.name)) return this.undefinedName(s.name, s.at);
        return this.store(s.name, () => {
          this.load(s.name);
          this.e("local.get", value).e("i32.const", this.id(s.name)).e("i32.const", this.pos(s.at)).e("call", R.addInto);
        });
      }
      case "say":
        for (const part of s.parts) this.expr(part);
        this.e("array.new_fixed", T.items, s.parts.length).e("i32.const", s.parts.length).e("struct.new", T.list).e("call", im.say);
        return;
      case "if":
        this.expr(s.cond);
        this.truthy();
        this.e("if");
        this.block(s.then);
        this.e("else");
        this.block(s.otherwise);
        this.e("end");
        return;
      case "while":
        return this.loop(this.pos(s.at), () => (this.expr(s.cond), this.truthy(), this.e("i32.eqz")), () => this.block(s.body));
      case "repeat": {
        const k = this.pos(s.at);
        const n = this.temp(F64);
        this.expr(s.count);
        this.e("i32.const", k).e("call", R.repeatCount).e("local.set", n);
        return this.loop(k, () => this.e("local.get", n).e("f64.const", 0).e("f64.le"), () => {
          this.block(s.body);
          this.e("local.get", n).e("f64.const", 1).e("f64.sub").e("local.set", n);
        });
      }
      case "count": {
        const k = this.pos(s.at);
        const [from, to, i, last] = [this.temp(), this.temp(), this.temp(F64), this.temp(F64)];
        this.expr(s.from);
        this.e("local.set", from);
        this.expr(s.to);
        this.e("local.set", to);
        bothNums(this.c, T, from, to);
        this.e("i32.eqz").e("if").e("local.get", from).e("local.get", to).e("i32.const", k).e("call", im.checkRange).e("unreachable").e("end");
        numOf(this.c, T, from);
        this.e("local.set", i);
        numOf(this.c, T, to);
        this.e("local.set", last);
        return this.loop(k, () => (this.e("local.get", i).e("local.get", last).e("call", R.ncmp), ORDER_TESTS["at most"](this.c), this.e("i32.eqz")), () => {
          const number = this.numberSlot(s.name);
          if (number) this.e("local.get", i), this.setNumber(number);
          else this.store(s.name, () => this.e("local.get", i).e("struct.new", T.num));
          this.block(s.body);
          this.e("local.get", i).e("f64.const", 1).e("f64.add").e("local.set", i);
        });
      }
      case "each": {
        const k = this.pos(s.at);
        const [list, i] = [this.temp(refNull(T.list)), this.temp(I32)];
        this.expr(s.list);
        this.e("i32.const", k).e("call", R.itemsOf).e("local.set", list).e("i32.const", 0).e("local.set", i); // locals start at 0 only once per call
        return this.loop(k, () => this.e("local.get", i).e("local.get", list).e("struct.get", T.list, 1).e("i32.ge_s"), () => {
          this.store(s.name, () => this.e("local.get", list).e("struct.get", T.list, 0).e("local.get", i).e("array.get", T.items));
          this.e("local.get", i).e("i32.const", 1).e("i32.add").e("local.set", i);
          this.block(s.body);
        });
      }
      case "define":
        return this.store(s.name, this.closure(s));
      case "when": { // a handler is a function of its own, made and handed over, not kept in a variable
        const make = this.closure(s.fn);
        this.e("i32.const", EVENTS.indexOf(s.event));
        make();
        this.e("i32.const", this.pos(s.at)).e("call", im.handle);
        return;
      }
      case "every": {
        this.expr(s.interval);
        this.e("f64.const", s.unit);
        this.closure(s.fn)();
        this.e("i32.const", this.pos(s.at)).e("call", im.every);
        return;
      }
      case "return":
        if (s.value) this.expr(s.value);
        else this.e("ref.null", "eq");
        this.e("return");
        return;
      case "call":
        this.call(s, true);
        this.e("drop");
        return;
      case "turtle":
        this.e("i32.const", TURTLE_ACTIONS.indexOf(s.action));
        if (s.value) this.expr(s.value);
        else this.e("ref.null", "eq");
        this.e("i32.const", this.pos(s.at)).e("call", im.turtle);
        return;
      case "setField": {
        const k = this.pos(s.at);
        const [target, value] = [this.temp(), this.temp()];
        this.expr(s.target);
        this.e("local.tee", target).e("ref.test", T.record).e("i32.eqz");
        this.e("if").e("local.get", target).e("i32.const", this.id(s.name)).e("i32.const", k).e("call", im.recordFor).e("unreachable").e("end");
        this.expr(s.value);
        this.e("local.set", value);
        this.e("local.get", target).e("i32.const", this.id(s.name)).e("local.get", value).e("call", R.setField);
        return;
      }
      case "fail":
        this.expr(s.value);
        this.e("i32.const", this.pos(s.at)).e("call", im.failWith).e("unreachable");
        return;
      case "stop":
        this.e("br", this.labels - 1 - this.stops.at(-1)).note("stop");
        return;
      case "remove":
        this.expr(s.key);
        this.expr(s.target);
        this.e("i32.const", this.pos(s.at)).e("call", im.remove);
        return;
      case "write":
        this.expr(s.value);
        this.expr(s.target);
        this.e("i32.const", this.pos(s.at)).e("call", im.write);
        return;
      case "expect":
        if (s.cond.kind !== "compare") {
          this.expr(s.cond);
          this.e("i32.const", this.pos(s.at)).e("call", im.expectYes);
          return;
        }
        this.e("i32.const", COMPARE_OPS.indexOf(s.cond.op)).e("i32.const", s.cond.negate ? 1 : 0);
        this.expr(s.cond.left);
        this.expr(s.cond.right);
        this.e("i32.const", this.pos(s.at)).e("call", im.expect);
        return;
      case "try": { // what JavaScript throws is caught here; JavaScript says whether it was a mistake to handle
        const depth = this.temp(I32);
        this.e("global.get", this.ctx.depth).e("local.set", depth).e("call", im.tryStart);
        this.e("try");
        this.block(s.body);
        this.e("catch_all");
        this.e("call", im.caught).e("i32.eqz").e("if").e("rethrow", 1).e("end"); // going too deep, say: not ours
        this.e("local.get", depth).e("global.set", this.ctx.depth);
        if (s.name) this.store(s.name, () => this.e("call", im.caughtValue));
        else this.e("call", im.caughtValue).e("drop");
        this.block(s.handler);
        this.e("end");
        return;
      }
    }
  }

  // `add value to name` where name only holds numbers: the value first, then the check that name has one
  addToNumber(s, number) {
    const { R, im, T } = this.ctx;
    const k = this.pos(s.at);
    const fast = this.isNumber(s.value);
    const value = this.temp(fast ? F64 : EQ);
    if (fast) this.exprNum(s.value);
    else this.expr(s.value);
    this.e("local.set", value);
    this.e("local.get", number.box).e("global.get", this.ctx.unset).e("ref.eq");
    this.e("if").e("i32.const", this.id(s.name)).e("i32.const", k).e("call", im.unset).e("unreachable").e("end");
    if (fast) this.e("local.get", number.value).e("local.get", value).e("f64.add");
    else { // any other value gives a number (if it is one) or fails, in the shared check
      this.load(s.name);
      this.e("local.get", value).e("i32.const", this.id(s.name)).e("i32.const", k).e("call", R.addInto).e("ref.cast", T.num).e("struct.get", T.num, 0);
    }
    this.setNumber(number);
  }

  // A Moth function, made from `to` (or a handler's `when`), compiled now; what's returned emits the closure.
  closure(d) {
    const { T } = this.ctx;
    const inner = new WasmCompiler(this, d.name, d.params, d.body, this.ctx);
    this.ctx.m.declared.add(inner.f.index);
    const kinds = d.kinds?.some((k) => k >= 0) ? this.ctx.kinds.push({ params: d.params, kinds: d.kinds }) - 1 : 0;
    return () => this.e("ref.func", inner.f.index).e("local.get", this.envLocal).e("i32.const", d.params.length).e("i32.const", this.id(d.name)).e("i32.const", kinds).e("struct.new", T.closure);
  }

  // The function is looked up before its inputs are worked out, and checked after, as in the other engines.
  call(e, statement = false) {
    if (!this.resolve(e.name)) return this.undefinedName(e.name, e.at, { call: true, statement });
    const { T, im, ctx } = { ...this.ctx, ctx: this.ctx };
    const k = this.pos(e.at);
    const f = this.temp();
    const args = e.args.map(() => this.temp());
    this.load(e.name);
    this.e("local.tee", f).e("ref.test", T.closure).e("i32.eqz");
    this.e("if").e("local.get", f).e("i32.const", this.id(e.name)).e("i32.const", k).e("call", im.callable).e("unreachable").e("end");
    e.args.forEach((arg, i) => {
      this.expr(arg);
      this.e("local.set", args[i]);
    });
    this.e("local.get", f).e("ref.cast", T.closure).e("struct.get", T.closure, 2).e("i32.const", args.length).e("i32.ne");
    this.e("if").e("local.get", f).e("i32.const", args.length).e("i32.const", this.id(e.name)).e("i32.const", k).e("call", im.checkInputs).e("unreachable").e("end");
    if (args.length) { // a function whose inputs say what they are: each one checked
      this.e("local.get", f).e("ref.cast", T.closure).e("struct.get", T.closure, 4).e("if");
      args.forEach((a, i) => {
        this.e("local.get", f).e("ref.cast", T.closure).e("struct.get", T.closure, 4).e("i32.const", i).e("local.get", a);
        this.e("i32.const", this.id(e.name)).e("i32.const", k).e("call", im.checkKind);
      });
      this.e("end");
    }
    this.tick(k);
    this.e("global.get", ctx.depth).e("i32.const", 1).e("i32.add").e("global.set", ctx.depth).e("global.get", ctx.depth).e("i32.const", MAX_DEPTH).e("i32.gt_s");
    this.e("if").e("call", im.tooDeep).e("unreachable").e("end");
    // for a mistake's trail: where this call is, and the function it runs, at 2 * depth - 2 and 2 * depth - 1
    this.e("global.get", ctx.calls).e("global.get", ctx.depth).e("i32.const", 1).e("i32.shl").e("i32.const", 2).e("i32.sub").e("i32.const", k).e("array.set", T.ids);
    this.e("global.get", ctx.calls).e("global.get", ctx.depth).e("i32.const", 1).e("i32.shl").e("i32.const", 1).e("i32.sub");
    this.e("local.get", f).e("ref.cast", T.closure).e("struct.get", T.closure, 3).e("array.set", T.ids);
    this.e("local.get", f).e("ref.cast", T.closure).e("struct.get", T.closure, 1);
    for (const a of args) this.e("local.get", a);
    this.e("local.get", f).e("ref.cast", T.closure).e("struct.get", T.closure, 0).e("ref.cast", T.fn(args.length)).e("call_ref", T.fn(args.length)).note(e.name);
    this.e("global.get", ctx.depth).e("i32.const", 1).e("i32.sub").e("global.set", ctx.depth);
  }

  expr(e) {
    const { T, R, im } = this.ctx;
    if (this.unboxed(e)) return void (this.exprNum(e), this.e("struct.new", T.num));
    switch (e.kind) {
      case "value":
        if (e.value === null) this.e("ref.null", "eq");
        else if (typeof e.value === "boolean") this.e("i32.const", e.value ? 1 : 0).e("ref.i31");
        else if (typeof e.value === "number") this.e("global.get", this.ctx.number(e.value)).note(e.value);
        else this.e("global.get", this.ctx.text(e.value)).note(JSON.stringify(e.value).slice(0, 40));
        return;
      case "name": {
        if (!this.resolve(e.name)) return this.undefinedName(e.name, e.at);
        const value = this.temp();
        this.load(e.name);
        this.e("local.tee", value).e("global.get", this.ctx.unset).e("ref.eq");
        this.e("if").e("i32.const", this.id(e.name)).e("i32.const", this.pos(e.at)).e("call", im.unset).e("unreachable").e("end");
        this.e("local.get", value);
        return;
      }
      case "call":
        return this.call(e);
      case "math":
        this.expr(e.left);
        this.expr(e.right);
        this.e("i32.const", this.pos(e.at)).e("call", R[["add", "sub", "mul", "div"][MATH.indexOf(e.op)]]);
        return;
      case "compare":
        if (e.op === "in") {
          this.expr(e.left);
          this.expr(e.right);
          this.e("i32.const", this.pos(e.at)).e("call", R.isIn);
          if (e.negate) this.e("i32.eqz");
          this.e("ref.i31");
          return;
        }
        if (this.isNumber(e.left) && this.isNumber(e.right)) { // two numbers: no boxes, no checks
          this.exprNum(e.left);
          this.exprNum(e.right);
          if (e.op === "divisible by") this.e("i32.const", this.pos(e.at)).e("call", R.dvf);
          else this.e("call", R.ncmp), ORDER_TESTS[e.op](this.c); // to 15 digits
          if (e.negate) this.e("i32.eqz");
          this.e("ref.i31");
          return;
        }
        this.expr(e.left);
        this.expr(e.right);
        if (e.op === "is") this.e("call", R.eq);
        else this.e("i32.const", this.pos(e.at)).e("call", R[{ "less than": "lt", "greater than": "gt", "at least": "ge", "at most": "le", "divisible by": "dv" }[e.op]]);
        if (e.negate) this.e("i32.eqz");
        this.e("ref.i31");
        return;
      case "and":
      case "or": {
        const left = this.temp();
        this.expr(e.left);
        this.e("local.tee", left);
        this.truthy();
        this.e("if", EQ);
        if (e.kind === "and") this.expr(e.right);
        else this.e("local.get", left);
        this.e("else");
        if (e.kind === "and") this.e("local.get", left);
        else this.expr(e.right);
        this.e("end");
        return;
      }
      case "not":
        this.expr(e.operand);
        this.truthy();
        this.e("i32.eqz").e("ref.i31");
        return;
      case "negate":
        this.expr(e.operand);
        this.e("i32.const", this.pos(e.at)).e("call", R.neg);
        return;
      case "list":
        for (const x of e.items) this.expr(x);
        this.e("array.new_fixed", T.items, e.items.length).e("i32.const", e.items.length).e("struct.new", T.list);
        return;
      case "length":
        this.expr(e.of);
        this.e("i32.const", this.pos(e.at)).e("call", R.lengthOf);
        return;
      case "item":
        this.expr(e.of);
        this.expr(e.index);
        this.e("i32.const", this.pos(e.at)).e("call", R.item);
        return;
      case "record": {
        if (new Set(e.fields).size === e.fields.length) {
          for (const field of e.fields) this.e("i32.const", this.id(field));
          this.e("array.new_fixed", T.ids, e.fields.length);
          for (const v of e.values) this.expr(v);
          this.e("array.new_fixed", T.items, e.values.length).e("i32.const", e.fields.length).e("struct.new", T.record);
          return;
        }
        const record = this.temp(); // a name given twice: the later value wins, in the place of the first
        this.e("call", R.newRecord).e("local.set", record);
        e.fields.forEach((field, i) => {
          this.e("local.get", record).e("i32.const", this.id(field));
          this.expr(e.values[i]);
          this.e("call", R.setField);
        });
        this.e("local.get", record);
        return;
      }
      case "dictionary":
        for (const x of e.items) this.expr(x);
        this.e("array.new_fixed", T.items, e.items.length).e("i32.const", e.items.length).e("struct.new", T.list);
        this.e("i32.const", this.pos(e.at)).e("call", im.dict);
        return;
      case "field":
        this.expr(e.of);
        this.e("i32.const", this.id(e.name)).e("i32.const", this.pos(e.at)).e("call", R.field);
        return;
      case "ask":
        this.expr(e.question);
        this.e("i32.const", this.pos(e.at)).e("call", im.ask);
        return;
      case "read":
        this.expr(e.of);
        this.e("i32.const", e.bytes ? 1 : 0).e("i32.const", this.pos(e.at)).e("call", im.read);
        return;
      case "arguments":
        this.e("call", im.args);
        return;
      case "random":
        this.expr(e.left);
        this.expr(e.right);
        this.e("i32.const", this.pos(e.at)).e("call", im.random);
        return;
      case "builtin": {
        const index = BUILTINS.findIndex((b) => b.name === e.name);
        const bits = BIT_BUILTINS.indexOf(e.name);
        if (bits >= 0) { // see R.bits
          for (const arg of e.args) this.expr(arg);
          this.e("i32.const", bits).e("i32.const", index).e("i32.const", this.pos(e.at)).e("call", R.bits);
          return;
        }
        if (e.name === "bytes") {
          this.expr(e.args[0]);
          this.e("i32.const", index).e("i32.const", this.pos(e.at)).e("call", R.newBytes);
          return;
        }
        this.e("i32.const", index).note(e.name);
        for (const arg of e.args) this.expr(arg);
        this.e("array.new_fixed", T.items, e.args.length).e("i32.const", e.args.length).e("struct.new", T.list);
        this.e("i32.const", this.pos(e.at)).e("call", im.builtin);
        return;
      }
    }
  }
}

// ---------- the whole module, and running it ----------

export function compileToWasmModule(program) {
  const m = new Module();
  const T = declareTypes(m);
  const im = {};
  for (const [label, [params, results]] of Object.entries(IMPORTS)) im[label] = m.import("moth", label, m.funcType(params, results));
  const R = declareRuntime(m, T, im);
  declareExports(m, T, R);

  const names = [];
  const nameIds = new Map();
  const messages = [];
  const numbers = new Map();
  const texts = new Map();
  const named = (name, global) => ((m.globalNames[global] = name), global);
  const ctx = {
    m, T, R, im, ats: [], names, messages, captured: findCaptured(program),
    kinds: [null], // what the inputs of each function whose inputs say so are (see closure())
    unset: named("unset", m.global(ref(T.unset), false, new Code().emit("struct.new", T.unset))),
    steps: named("steps", m.global(F64, true, new Code().emit("f64.const", 0))),
    maxSteps: named("maxSteps", m.global(F64, true, new Code().emit("f64.const", Infinity))),
    depth: named("depth", m.global(I32, true, new Code().emit("i32.const", 0))),
    calls: named("calls", m.global(ref(T.ids), false, new Code().emit("i32.const", 2 * MAX_DEPTH).emit("array.new_default", T.ids))), // see call()
    init: m.func("init", [], []), // makes the text the program holds
    texts: [],
    id(name) {
      if (!nameIds.has(name)) nameIds.set(name, names.push(name) - 1);
      return nameIds.get(name);
    },
    message: (text) => messages.push(text) - 1,
    number(value) {
      const key = String(value);
      if (!numbers.has(key)) numbers.set(key, named(`number${numbers.size}`, m.global(ref(T.num), false, new Code().emit("f64.const", value).emit("struct.new", T.num))));
      return numbers.get(key);
    },
    text(value) {
      if (!texts.has(value)) {
        const global = named(`text${texts.size}`, m.global(refNull(T.text), true, new Code().emit("ref.null", T.text)));
        texts.set(value, global);
        ctx.init.code.emit("i32.const", ctx.texts.push(value) - 1).emit("call", im.text).emit("struct.new", T.text).emit("global.set", global);
      }
      return texts.get(value);
    },
  };
  const main = new WasmCompiler(null, "main", [], program, ctx);
  m.export("main", main.f.index);
  // the calls in progress, for a mistake's trail: how many, and for each (outermost first), where it was made
  // and the name of its function
  for (const [label, params, write] of [
    ["callDepth", [], (c) => c.emit("global.get", ctx.depth)],
    ["callSite", [I32], (c) => c.emit("global.get", ctx.calls).emit("local.get", 0).emit("i32.const", 1).emit("i32.shl").emit("array.get", T.ids)],
    ["callName", [I32], (c) => c.emit("global.get", ctx.calls).emit("local.get", 0).emit("i32.const", 1).emit("i32.shl").emit("i32.const", 1).emit("i32.add").emit("array.get", T.ids)],
  ]) {
    const f = m.func(label, params, [I32]);
    write(f.code);
    m.export(label, f.index);
  }
  // an app's handler, called from outside with its inputs (as many as it takes: 0, 1 or 2); and its steps
  // and depth from 0 before each
  const invoke = m.func("invoke", [EQ, EQ, EQ], [EQ]);
  for (const n of [0, 1, 2]) {
    const c = invoke.code;
    c.emit("local.get", 0).emit("ref.cast", T.closure).emit("struct.get", T.closure, 2).emit("i32.const", n).emit("i32.eq").emit("if");
    c.emit("local.get", 0).emit("ref.cast", T.closure).emit("struct.get", T.closure, 1);
    for (let i = 1; i <= n; i++) c.emit("local.get", i);
    c.emit("local.get", 0).emit("ref.cast", T.closure).emit("struct.get", T.closure, 0).emit("ref.cast", T.fn(n)).emit("call_ref", T.fn(n)).emit("return").emit("end");
  }
  invoke.code.emit("ref.null", "eq");
  m.export("invoke", invoke.index);
  const restart = m.func("restart", [], []);
  restart.code.emit("f64.const", 0).emit("global.set", ctx.steps).emit("i32.const", 0).emit("global.set", ctx.depth);
  m.export("restart", restart.index);
  return { bytes: m.encode(), listing: m.listing(ctx.init.index), ats: ctx.ats, names, messages, texts: ctx.texts, kinds: ctx.kinds };
}

// Compiles a parsed program: { bytes, listing, run(print, draw, maxSteps) }, like jit() in jit.js.
export function wasm(program) {
  const made = compileToWasmModule(program);
  const module = new WebAssembly.Module(made.bytes);
  return { ...made, run: (print, draw, maxSteps, ask, disk, args, random, host) => instantiate(module, made, print, draw, maxSteps, ask, disk, args, random, host).main(maxSteps) };
}

// The JavaScript side of a run: the imports, and moving values in and out of the module.
function instantiate(module, { ats, names, messages, texts, kinds }, print, draw, maxSteps, answer, disk, args = [], chance = seeded(), host = { handlers: [] }) {
  // Every mistake made is kept, for a `try`: JavaScript's exceptions cross WebAssembly, but only JavaScript can
  // tell which ones it was. A `fail with` keeps its value as WebAssembly holds it, so catching it keeps it whole.
  let lastError = null;
  let caughtError = null;
  let failing;
  const throwing = (err) => {
    lastError = err;
    throw err;
  };
  const trail = () => {
    const calls = [];
    for (let i = x.callDepth() - 1; i >= 0; i--) calls.push({ name: names[x.callName(i)], at: ats[x.callSite(i)] });
    return trailOf(calls);
  };
  const errors = ats.map((at) => (message, value) => {
    const err = new MothError(at, message, value, trail());
    err.wasm = failing;
    failing = undefined;
    throwing(err);
  });
  const turtle = new Turtle(draw);
  let x = null; // the module's exports, once it exists

  function toJs(v, seen = new Map()) {
    if (v === null) return null;
    if (typeof v === "number") return v === 1; // yes and no are i31 values, which reach JavaScript as numbers
    if (seen.has(v)) return seen.get(v);
    switch (x.tag(v)) {
      case TAGS.number:
        return x.num(v);
      case TAGS.text:
        return x.textValue(v);
      case TAGS.list: {
        const list = [];
        seen.set(v, list);
        for (let i = 0, n = x.listLength(v); i < n; i++) list.push(toJs(x.listItem(v, i), seen));
        return list;
      }
      case TAGS.record: {
        const record = makeRecord([], []);
        seen.set(v, record);
        for (let i = 0, n = x.recordSize(v); i < n; i++) record[names[x.recordKey(v, i)]] = toJs(x.recordValue(v, i), seen);
        return record;
      }
      case TAGS.function:
        return new Closure({ name: names[x.functionName(v)], params: Array(x.functionInputs(v)) }, null);
      case TAGS.dictionary: {
        const dictionary = new Map();
        seen.set(v, dictionary);
        for (const [key, value] of x.hostValue(v)) dictionary.set(key, toJs(value, seen));
        return dictionary;
      }
      case TAGS.bytes: { // a copy, made byte by byte
        const bytes = new Uint8Array(x.bytesLength(v));
        for (let i = 0; i < bytes.length; i++) bytes[i] = x.byteAt(v, i);
        return bytes;
      }
      default:
        return UNSET;
    }
  }

  // A dictionary's own Map, whose values stay the module's, so changing it changes the dictionary; any other
  // value as JavaScript (bytes as a copy). For checks that only need to see the dictionary, not what is in it.
  const rawOf = (v) => (v !== null && typeof v !== "number" && x.tag(v) === TAGS.dictionary ? x.hostValue(v) : toJs(v));

  // only new values come back from JavaScript (text, and the letters of a text), never a list it changed
  function toWasm(v) {
    if (v === null) return null;
    if (typeof v === "boolean") return v ? 1 : 0;
    if (typeof v === "number") return x.makeNum(v);
    if (typeof v === "string") return x.makeText(v);
    if (v instanceof Map) return x.makeHost(new Map([...v].map(([key, value]) => [key, toWasm(value)])), TAGS.dictionary);
    if (v instanceof Uint8Array) {
      const bytes = x.makeBytes(v.length); // all 0 to start with
      for (let i = 0; i < v.length; i++) if (v[i]) x.setByte(bytes, i, v[i]);
      return bytes;
    }
    const list = x.newList();
    for (const item of v) x.listPush(list, toWasm(item));
    return list;
  }

  const imports = {
    say: (parts) => print(toJs(parts).map((p) => show(p)).join("")),
    fail: (message, k) => errors[k](messages[message]),
    unset: (name, k) => errors[k](noValue(names[name])),
    plus: (a, b, k) => toWasm(plus(toJs(a), toJs(b), errors[k])),
    arithmetic: (op, a, b, k) => arithmetic(MATH[op], toJs(a), toJs(b), errors[k]),
    negate: (v, k) => negate(toJs(v), errors[k]),
    compare: (op, a, b, k) => (compare(COMPARE_OPS[op], toJs(a), COMPARE_OPS[op] === "in" ? rawOf(b) : toJs(b), errors[k]) ? 1 : 0),
    remainder: (a, b) => a % b,
    numberOrder: (a, b) => {
      const order = numberOrder(a, b);
      return Number.isNaN(order) ? 2 : order;
    },
    divisible: (a, b) => (divisible(a, b) ? 1 : 0),
    equal: (a, b) => (equal(toJs(a), toJs(b)) ? 1 : 0),
    sameText: (a, b) => (a === b ? 1 : 0),
    text: (i) => texts[i],
    lengthOf: (v, k) => lengthOf(rawOf(v), errors[k]),
    item: (target, n, k) => { // a list's items are found in WebAssembly, so a list here is a mistake
      const [seq, i] = item(rawOf(target), toJs(n), false, errors[k]);
      return seq instanceof Map ? seq.get(i) : toWasm(seq[i]);
    },
    itemRef: (target, n, k) => {
      item(rawOf(target), toJs(n), true, errors[k]);
    },
    put: (target, n, value, k) => { // only for a mistake: R.put does the rest
      const [seq, i] = item(rawOf(target), toJs(n), true, errors[k]);
      putItem(seq, i, seq instanceof Map ? value : toJs(value), errors[k]);
    },
    dictGetText: (map, key, k) => (map.has(key) ? map.get(key) : item(map, key, false, errors[k])),
    dictGetNum: (map, key, k) => (map.has(canon(key)) ? map.get(canon(key)) : item(map, key, false, errors[k])), // keys to 15 digits
    dictSetText: (map, key, value) => void map.set(key, value),
    dictSetNum: (map, key, value) => void map.set(canon(key), value),
    dictHasText: (map, key) => (map.has(key) ? 1 : 0),
    dictHasNum: (map, key) => (map.has(canon(key)) ? 1 : 0),
    dict: (list, k) => x.makeHost(makeDictionary(Array.from({ length: x.listLength(list) }, (_, i) => x.listItem(list, i)), errors[k], toJs), TAGS.dictionary),
    remove: (key, target, k) => removeKey(toJs(key), rawOf(target), errors[k]),
    addInto: (current, value, name, k) => toWasm(addInto(toJs(current), toJs(value), names[name], errors[k])),
    checkRepeat: (n, k) => checkRepeat(toJs(n), errors[k]), // a count that's whole to 15 digits comes back whole
    checkRange: (from, to, k) => checkRange(toJs(from), toJs(to), errors[k]),
    itemsOf: (v, k) => toWasm(itemsOf(rawOf(v), errors[k])),
    callable: (f, name, k) => callable(toJs(f), names[name], errors[k]),
    checkInputs: (f, argc, name, k) => checkInputs(toJs(f), argc, names[name], errors[k]),
    // input i of a function whose inputs say what they are: its kind from its tag, so a big list isn't copied
    checkKind: (id, i, v, name, k) => {
      const wanted = kinds[id].kinds[i];
      const kind = v === null ? "nothing" : typeof v === "number" ? "yes/no" : TAG_KINDS[x.tag(v)];
      if (wanted >= 0 && kind !== KIND_TAGS[wanted]) errors[k](`'${names[name]}' needs ${kinds[id].params[i]} to be ${KINDS[wanted]}, not ${kind}`);
    },
    stopped: (k) => {
      const err = new MothError(ats[k], stoppedMessage(maxSteps), undefined, trail());
      err.final = true; // no try catches it
      throwing(err);
    },
    tooDeep: () => {
      throw new TooDeep();
    },
    turtle: (action, value, k) => turtle.act(action, toJs(value), errors[k]),
    field: (r, name, k) => fieldOf(toJs(r), names[name], errors[k]),
    recordFor: (r, name, k) => recordFor(toJs(r), names[name], errors[k]),
    failWith: (value, k) => {
      failing = value;
      failWith(toJs(value), errors[k]);
    },
    tryStart: () => {
      lastError = null;
    },
    caught: () => {
      [caughtError, lastError] = [lastError, null];
      return catchable(caughtError) ? 1 : 0;
    },
    caughtValue: () => (caughtError.wasm !== undefined ? caughtError.wasm : toWasm(caughtValue(caughtError))),
    builtin: (i, args, k) => toWasm(BUILTINS[i].run(toJs(args), errors[k])),
    ask: (question, k) => toWasm(askFor(toJs(question), answer, errors[k])),
    read: (name, asBytes, k) => toWasm(readFile(toJs(name), asBytes === 1, disk, errors[k])),
    write: (value, name, k) => writeFile(toJs(value), toJs(name), disk, errors[k]),
    args: () => toWasm(args),
    random: (low, high, k) => toWasm(randomWhole(toJs(low), toJs(high), chance, errors[k])),
    handle: (event, closure) => void host.handlers.push({ event: EVENTS[event], closure }),
    every: (interval, unit, closure, k) => void host.handlers.push({ event: "every", interval: everyInterval(toJs(interval), unit, errors[k]), closure }),
    expect: (op, negate, a, b, k) => expectThat(COMPARE_OPS[op], negate === 1, toJs(a), toJs(b), errors[k]),
    expectYes: (value, k) => expectYes(toJs(value), errors[k]),
  };
  x = new WebAssembly.Instance(module, { moth: imports }).exports;
  host.call = (handler, inputs) => {
    x.restart();
    const [a = null, b = null] = inputs.map(toWasm);
    x.invoke(handler.closure, a, b);
  };
  return x;
}
