// The checker: finds mistakes without running the program. It only speaks when it is sure, and it says
// what running would say: each "will fail" warning comes from the VM's own checks (vm.js), run on sample
// values of the types it worked out, so its message is the exact error that line would stop with.
import { Scope } from "./scope.js";
import { Turtle, TURTLE_ACTIONS, BUILTINS, plus, arithmetic, negate, lengthOf, compare, item, addInto, checkRepeat, checkRange, itemsOf,
  callable, checkInputs, checkKinds, makeRecord, fieldOf, recordFor, removeKey, readFile, writeFile, randomWhole, everyInterval, Closure,
  Quantity, isQuantity, measureOf, unitNamed, UNITS, MEASURE_TYPES, exitCode, removeFile, NOW_WORDS, waitFor, fakeClock, readFolder, soundOf } from "./vm.js";

// A stand-in value for each type. Only checks that depend on the type alone use these; a check that
// depends on the value itself (like dividing by zero) only runs when the code has that value written out.
const SAMPLES = { number: 1, text: "a", "yes/no": true, nothing: null, list: [], record: makeRecord([], []), dictionary: new Map(), bytes: new Uint8Array(0),
  function: new Closure({ name: "f", params: [] }, null),
  // an amount of each measure: 1 m, 1 second, 1 g, 1 litre
  ...Object.fromEntries(MEASURE_TYPES.map((type, measure) => [type, new Quantity(1, UNITS.findIndex((u) => u[2] === measure && u[3] === 1))])) };
// the type of what an operation on samples gave: a number, text, or an amount of some measure
const resultType = (v) => (typeof v === "number" ? "number" : typeof v === "string" ? "text" : isQuantity(v) ? MEASURE_TYPES[measureOf(v)] : null);
// what an amount of the unit `word` (written out, as `5 km` and `in miles` have it) measures
const unitType = (word) => MEASURE_TYPES[UNITS[unitNamed(word)][2]];
// what an input that says what it is (`as a number`) holds, by its number in vm.js's KINDS
const KIND_TYPES = ["number", "text", "yes/no", "list", "record", "dictionary", "bytes", "function"];
const literalType = (v) => (v === null ? "nothing" : typeof v === "boolean" ? "yes/no" : typeof v === "string" ? "text" : "number");
// the statements after which nothing in the same block runs, as a warning names them
const ENDINGS = new Map([["return", "return"], ["fail", "fail"], ["stop", "stop"], ["exit", "stop the program"]]);

class Found {
  constructor(message) {
    this.message = message;
  }
}
const found = (message) => {
  throw new Found(message);
};

// One function (or the program). Types are worked out for the whole program at once: a variable's type is
// what every `set` of it agrees on. `undefined` means "nothing known yet", `null` means "could be several".
class Checker extends Scope {
  constructor(parent, name, params, body, all, kinds = []) {
    super(parent, name, params, body);
    this.all = all;
    this.id = all.scopes++;
    this.maybeSkipped = 0; // inside the right side of `and`/`or`, which might not run, so nothing is certain
    // inputs could be anything, but one that says what it is is that: each call checks it before the function runs
    params.forEach((p, i) => this.source(p, () => (kinds[i] >= 0 ? KIND_TYPES[kinds[i]] : null)));
    this.block(body);
  }

  key(name) {
    let [depth, slot] = this.resolve(name);
    let scope = this;
    while (depth--) scope = scope.parent;
    return `${scope.id}:${slot}`;
  }

  source(name, type) {
    const key = this.key(name);
    if (!this.all.sources.has(key)) this.all.sources.set(key, []);
    this.all.sources.get(key).push(type);
    return key;
  }

  slotType(key) {
    return this.all.types.get(key);
  }

  warn(at, kind, message) {
    if (at.file && kind === "unused") return; // a file the program uses can make more than this program needs
    this.all.warnings.push({ line: at.line, col: at.col, kind, message, ...(at.file && { file: at.file }) });
  }

  // Runs `test` once the types are known; if it throws, this spot will fail whenever it runs.
  willFail(at, test) {
    if (this.maybeSkipped) return;
    this.all.checks.push(() => {
      try {
        test();
      } catch (err) {
        if (!(err instanceof Found)) throw err;
        this.warn(at, "fails", err.message);
      }
    });
  }

  // What we can know about an expression: its type (a function, since types settle later) and its value, if written out.
  type(e) {
    switch (e.kind) {
      case "value": {
        const t = literalType(e.value);
        return () => t;
      }
      case "name": {
        const key = this.resolve(e.name) && this.key(e.name);
        return () => (key ? this.slotType(key) : null);
      }
      case "math": {
        const [left, right] = [this.type(e.left), this.type(e.right)];
        return () => {
          const [a, b] = [left(), right()];
          if (a === undefined || b === undefined) return undefined;
          if (e.op === "+" && (a === "text" || b === "text")) return "text";
          if (!this.known(a, b)) return null;
          try { // what the same operation on samples gives: 2 km * 3 is a distance, 2 km / 1 km a number
            return resultType(e.op === "+" ? plus(SAMPLES[a], SAMPLES[b], found) : arithmetic(e.op, SAMPLES[a], SAMPLES[b], found));
          } catch (error) {
            if (error instanceof Found) return null; // it fails, which the check says
            throw error;
          }
        };
      }
      case "compare":
      case "not":
        return () => "yes/no";
      case "negate": { // a number, or an amount (which keeps its unit); fails on anything else
        const operand = this.type(e.operand);
        return () => (MEASURE_TYPES.includes(operand()) ? operand() : operand() === null ? null : operand() === undefined ? undefined : "number");
      }
      case "length":
      case "random":
        return () => "number";
      case "now": // `the time`, `the date` and `the weekday` are text; the rest are numbers
        return () => (["time", "date", "weekday"].includes(NOW_WORDS[e.which]) ? "text" : "number");
      case "builtin": {
        if (e.name === "unit" || e.name === "in") return () => unitType(e.args[1].value); // `5 km`, `trip in miles`
        const { gives } = BUILTINS.find((b) => b.name === e.name);
        return () => gives;
      }
      case "ask":
        return () => "text";
      case "read":
        return () => (e.bytes ? "bytes" : "text");
      case "arguments":
      case "readFolder":
      case "list":
        return () => "list";
      case "record":
        return () => "record";
      case "dictionary":
        return () => "dictionary";
      default: // calls, items, fields, and/or: could be anything
        return () => null;
    }
  }

  sample(e, type = this.type(e)()) {
    return e.kind === "value" ? e.value : SAMPLES[type];
  }

  known(...types) {
    return types.every((t) => t !== undefined && t !== null && t !== "function");
  }

  block(body) {
    for (const [i, s] of body.entries()) {
      this.statement(s);
      if (ENDINGS.has(s.kind) && body[i + 1]) {
        this.warn(body[i + 1].at, "never runs", `this line can never run, because '${ENDINGS.get(s.kind)}' comes first`);
        break;
      }
    }
  }

  undefinedName(name, at, options) {
    if (!this.maybeSkipped) this.warn(at, "fails", this.undefinedMessage(name, options));
  }

  statement(s) {
    switch (s.kind) {
      case "set": {
        this.expr(s.value);
        const key = this.source(s.name, this.type(s.value));
        if (!this.all.made.has(key)) this.all.made.set(key, { at: s.at, message: `'${s.name}' is set but never used` });
        return;
      }
      case "setItem": {
        const target = s.target.of;
        this.expr(target);
        this.expr(s.target.index);
        this.expr(s.value);
        const type = this.type(target);
        this.willFail(s.target.at, () => this.known(type()) && type() !== "list" && type() !== "bytes" && item(SAMPLES[type()], 1, true, found));
        return;
      }
      case "add": {
        this.expr(s.value);
        if (!this.resolve(s.name)) return this.undefinedName(s.name, s.at);
        const key = this.key(s.name);
        this.all.used.add(key);
        const value = this.type(s.value);
        this.source(s.name, () => {
          const [current, v] = [this.slotType(key), value()];
          if (current === "list" || current === "text") return current;
          if (current === "number" && v === "number") return "number";
          if (MEASURE_TYPES.includes(current) && v === current) return current; // `add 300 m to trip`
          // an add that will fail doesn't change the type: the program stops there
          return current === undefined || v === undefined || this.known(current, v) ? undefined : null;
        });
        this.willFail(s.at, () => this.known(this.slotType(key), value()) && addInto(SAMPLES[this.slotType(key)], this.sample(s.value), s.name, found));
        return;
      }
      case "say":
        for (const part of s.parts) this.expr(part);
        return;
      case "if":
        this.expr(s.cond);
        this.block(s.then);
        this.block(s.otherwise);
        return;
      case "while":
        this.expr(s.cond);
        this.block(s.body);
        return;
      case "repeat":
        this.expr(s.count);
        if (s.count.kind === "value") this.willFail(s.at, () => checkRepeat(s.count.value, found));
        this.block(s.body);
        return;
      case "count": {
        this.expr(s.from);
        this.expr(s.to);
        this.source(s.name, () => "number");
        const [from, to] = [this.type(s.from), this.type(s.to)];
        this.willFail(s.at, () => this.known(from(), to()) && checkRange(this.sample(s.from), this.sample(s.to), found));
        this.block(s.body);
        return;
      }
      case "each": {
        this.expr(s.list);
        const list = this.type(s.list);
        this.source(s.name, () => (list() === "text" ? "text" : null)); // a list's items could be anything
        this.willFail(s.at, () => this.known(list()) && itemsOf(SAMPLES[list()], found));
        this.block(s.body);
        return;
      }
      case "define": {
        const key = this.source(s.name, () => "function");
        const isTest = !this.parent && s.name.startsWith("test_"); // the test runner, test() in moth.js, calls it
        if (!this.all.made.has(key) && !isTest) this.all.made.set(key, { at: s.at, message: `'${s.name}' is made but never used` });
        this.all.defines.set(key, [...(this.all.defines.get(key) ?? []), { params: s.params, kinds: s.kinds }]);
        new Checker(this, s.name, s.params, s.body, this.all, s.kinds);
        return;
      }
      case "every": { // how often must be a number
        this.expr(s.interval);
        const type = this.type(s.interval);
        this.willFail(s.at, () => this.known(type()) && type() !== "number" && everyInterval(this.sample(s.interval), s.unit, found));
        new Checker(this, s.fn.name, s.fn.params, s.fn.body, this.all);
        return;
      }
      case "when":
        if (s.label) this.expr(s.label); // the button or text box it waits for
        new Checker(this, s.fn.name, s.fn.params, s.fn.body, this.all);
        return;
      case "return":
        if (s.value) this.expr(s.value);
        return;
      case "fail": // stopping on purpose is not a mistake
        this.expr(s.value);
        return;
      case "stop":
        return;
      case "exit": { // the number it stops with must be a whole number from 0 to 255
        if (!s.value) return;
        this.expr(s.value);
        const type = this.type(s.value);
        this.willFail(s.at, () => this.known(type()) && exitCode(this.sample(s.value), found));
        return;
      }
      case "remove": { // which keys a dictionary has isn't known, so only removing from something else is certain to fail
        this.expr(s.key);
        this.expr(s.target);
        const type = this.type(s.target);
        this.willFail(s.at, () => this.known(type()) && type() !== "dictionary" && removeKey("a", SAMPLES[type()], found));
        return;
      }
      case "expect": { // whether it is so is up to the values; only comparing kinds that can't be compared is certain to fail
        const c = s.cond;
        if (c.kind !== "compare") return this.expr(c);
        this.expr(c.left);
        this.expr(c.right);
        const [left, right] = [this.type(c.left), this.type(c.right)];
        if (c.op !== "is") this.willFail(s.at, () => this.known(left(), right()) && compare(c.op, this.sample(c.left), this.sample(c.right), found));
        return;
      }
      case "write": { // whether the file can be written isn't known, so only a name that isn't text is certain to fail
        this.expr(s.value);
        this.expr(s.target);
        const type = this.type(s.target);
        this.willFail(s.at, () => this.known(type()) && type() !== "text" && writeFile(null, SAMPLES[type()], null, found));
        return;
      }
      case "removeFile": { // as with `write`, only a name that isn't text is certain to fail
        this.expr(s.target);
        const type = this.type(s.target);
        this.willFail(s.at, () => this.known(type()) && type() !== "text" && removeFile(SAMPLES[type()], null, found));
        return;
      }
      case "wait": { // how long must be a number of 0 or more
        this.expr(s.amount);
        const type = this.type(s.amount);
        this.willFail(s.at, () => this.known(type()) && waitFor(this.sample(s.amount), s.unit, fakeClock(), found));
        return;
      }
      case "try": // inside it, a mistake is caught, so nothing in it is certain to stop the program
        this.maybeSkipped++;
        this.block(s.body);
        this.maybeSkipped--;
        if (s.name) this.source(s.name, () => null); // a message, or whatever `fail with` gave
        this.block(s.handler);
        return;
      case "setField": {
        this.expr(s.target);
        this.expr(s.value);
        const type = this.type(s.target);
        this.willFail(s.at, () => this.known(type()) && type() !== "record" && recordFor(SAMPLES[type()], s.name, found));
        return;
      }
      case "call":
        this.call(s, true);
        return;
      case "play": { // a note or a time of the wrong kind fails, and so does one written out wrong
        if (!s.note) return; // a beep
        this.expr(s.note);
        this.expr(s.time);
        const [note, time] = [this.type(s.note), this.type(s.time)];
        // the value written out (`"H"`, `-1`), or one of the type that can't fail
        const written = (e, type, fine) => (e.kind === "value" ? e.value
          : e.kind === "negate" && e.operand.kind === "value" && typeof e.operand.value === "number" ? -e.operand.value
          : Object.hasOwn(fine, type) ? fine[type] : SAMPLES[type]);
        this.willFail(s.at, () => {
          if (!this.known(note())) return;
          const sound = written(s.note, note(), { text: "C", number: 440 });
          if (!this.known(time())) return soundOf(sound, 1, 1000, found); // the note can still be wrong on its own
          soundOf(sound, written(s.time, time(), { number: 1 }), s.unit, found);
        });
        return;
      }
      case "turtle": {
        if (!s.value) return;
        this.expr(s.value);
        const action = TURTLE_ACTIONS.indexOf(s.action);
        if (s.action === "picture") { // whether a file is a picture isn't known: only what is neither a name nor bytes is sure to fail
          const type = this.type(s.value.items[0]);
          this.willFail(s.at, () => this.known(type()) && type() !== "text" && type() !== "bytes" && new Turtle().act(action, [SAMPLES[type()], 0, 0, null, null], found));
          return;
        }
        if (s.value.kind === "list" && s.action !== "forward") return; // `move to`, `draw ...`: what's in the list isn't known
        const value = this.type(s.value);
        // the width check depends on the value, so it only runs when the width is written out
        if (s.action === "width" ? s.value.kind === "value" : true) {
          this.willFail(s.at, () => this.known(value()) && new Turtle().act(action, this.sample(s.value), found));
        }
        return;
      }
    }
  }

  call(e, statement = false) {
    if (!this.resolve(e.name)) return this.undefinedName(e.name, e.at, { call: true, statement });
    const key = this.key(e.name);
    this.all.used.add(key);
    for (const arg of e.args) this.expr(arg);
    const types = e.args.map((arg) => this.type(arg));
    this.willFail(e.at, () => {
      const type = this.slotType(key);
      if (this.known(type)) callable(SAMPLES[type], e.name, found); // not a function at all
      const made = this.all.defines.get(key);
      // the number of inputs is only certain when the name is a function made exactly once, and never anything else
      if (type === "function" && made?.length === 1 && this.all.sources.get(key).length === 1) {
        const { params, kinds } = made[0];
        checkInputs({ fn: { params } }, e.args.length, e.name, found);
        // and an input that says what it is must get that, where the checker knows what it gets
        const sure = kinds.map((k, i) => (types[i]() === undefined || types[i]() === null ? -1 : k));
        checkKinds({ fn: { params, kinds: sure } }, e.args.map((arg, i) => (sure[i] >= 0 ? this.sample(arg, types[i]()) : null)), e.name, found);
      }
    });
  }

  expr(e) {
    switch (e.kind) {
      case "name":
        if (this.resolve(e.name)) this.all.used.add(this.key(e.name));
        else this.undefinedName(e.name, e.at);
        return;
      case "call":
        return this.call(e);
      case "math": {
        this.expr(e.left);
        this.expr(e.right);
        const [left, right] = [this.type(e.left), this.type(e.right)];
        this.willFail(e.at, () => {
          if (!this.known(left(), right())) return;
          if (e.op !== "+") arithmetic(e.op, this.sample(e.left), this.sample(e.right), found);
          else if (left() !== "number" || right() !== "number") plus(this.sample(e.left), this.sample(e.right), found);
        });
        return;
      }
      case "compare": {
        this.expr(e.left);
        this.expr(e.right);
        const [left, right] = [this.type(e.left), this.type(e.right)];
        if (e.op !== "is") this.willFail(e.at, () => this.known(left(), right()) && compare(e.op, this.sample(e.left), this.sample(e.right), found));
        return;
      }
      case "and":
      case "or":
        this.expr(e.left);
        this.maybeSkipped++;
        this.expr(e.right);
        this.maybeSkipped--;
        return;
      case "not":
        return this.expr(e.operand);
      case "negate": {
        this.expr(e.operand);
        const type = this.type(e.operand);
        this.willFail(e.at, () => this.known(type()) && negate(this.sample(e.operand), found));
        return;
      }
      case "list":
        for (const x of e.items) this.expr(x);
        return;
      case "record":
        for (const value of e.values) this.expr(value);
        return;
      case "dictionary":
        for (const x of e.items) this.expr(x);
        return;
      case "field": { // which fields a record has isn't known, so only taking a field of something else is certain to fail
        this.expr(e.of);
        const type = this.type(e.of);
        this.willFail(e.at, () => this.known(type()) && type() !== "record" && fieldOf(SAMPLES[type()], e.name, found));
        return;
      }
      case "length": {
        this.expr(e.of);
        const type = this.type(e.of);
        this.willFail(e.at, () => this.known(type()) && lengthOf(this.sample(e.of), found));
        return;
      }
      case "ask":
        this.expr(e.question);
        return;
      case "now":
        return;
      case "random": { // only numbers that aren't numbers at all are certain to fail
        this.expr(e.left);
        this.expr(e.right);
        const [low, high] = [this.type(e.left), this.type(e.right)];
        this.willFail(e.at, () => this.known(low(), high()) && (low() !== "number" || high() !== "number") && randomWhole(this.sample(e.left), this.sample(e.right), Math.random, found));
        return;
      }
      case "read": { // as with `write`, only a name that isn't text is certain to fail
        this.expr(e.of);
        const type = this.type(e.of);
        this.willFail(e.at, () => this.known(type()) && type() !== "text" && readFile(SAMPLES[type()], e.bytes, null, found));
        return;
      }
      case "readFolder": { // as with `read`, only a name that isn't text is certain to fail
        this.expr(e.of);
        const type = this.type(e.of);
        this.willFail(e.at, () => this.known(type()) && type() !== "text" && readFolder(SAMPLES[type()], null, found));
        return;
      }
      case "builtin": { // fails when an input is known to be the wrong kind; what the values are is left to run time
        for (const arg of e.args) this.expr(arg);
        const builtin = BUILTINS.find((b) => b.name === e.name);
        const types = e.args.map((arg) => this.type(arg));
        this.willFail(e.at, () => this.known(...types.map((t) => t())) && types.some((t, i) => !builtin.needs[i].includes(t()))
          && builtin.run(e.args.map((arg) => this.sample(arg)), found));
        return;
      }
      case "item": {
        this.expr(e.of);
        this.expr(e.index);
        const type = this.type(e.of);
        this.willFail(e.at, () => {
          const t = type();
          if (!this.known(t) || t === "dictionary") return; // which keys a dictionary has isn't known
          if (t !== "list" && t !== "text" && t !== "bytes") return item(SAMPLES[t], 1, false, found); // can't take an item of this
          // the index is only certain when it is written out; the length of the list never is
          const n = e.index.kind === "value" ? e.index.value : undefined;
          if (n !== undefined && !(typeof n === "number" && Number.isInteger(n) && n >= 1)) item(t === "text" ? "x" : ["x"], n, false, found);
        });
        return;
      }
    }
  }
}

// Every problem in a parsed program, in order: { line, col, kind, message }, where kind is "fails" (this
// line stops the program whenever it runs), "never runs", or "unused".
export function check(program) {
  const all = { scopes: 0, sources: new Map(), types: new Map(), checks: [], warnings: [], used: new Set(), made: new Map(), defines: new Map() };
  new Checker(null, "main", [], program, all);
  // Work out every variable's type: repeat until nothing changes. A type can only go from unknown, to one
  // type, to "could be several", so this stops after a few rounds.
  for (let changed = true; changed; ) {
    changed = false;
    for (const [key, sources] of all.sources) {
      let type;
      for (const source of sources) {
        const t = source();
        if (t === undefined) continue;
        type = type === undefined || type === t ? t : null;
      }
      if (type !== all.types.get(key)) {
        all.types.set(key, type);
        changed = true;
      }
    }
  }
  for (const run of all.checks) run();
  for (const [key, { at, message }] of all.made) {
    if (!all.used.has(key) && !at.file) all.warnings.push({ line: at.line, col: at.col, kind: "unused", message }); // a used file can make more than one program needs
  }
  const seen = new Set();
  return all.warnings
    .filter((w) => !seen.has(`${w.line}:${w.col}:${w.message}`) && seen.add(`${w.line}:${w.col}:${w.message}`))
    .sort((a, b) => a.line - b.line || a.col - b.col);
}
