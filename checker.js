// The checker: finds mistakes without running the program. It only speaks when it is sure, and it says
// what running would say: each "will fail" warning comes from the VM's own checks (vm.js), run on sample
// values of the types it worked out, so its message is the exact error that line would stop with.
//
// It works the types out twice (DESIGN §103). Once from what is sure: values written out, what each operation
// and builtin gives, an input whose `as` each call checks, what a kind makes, what a function returns. A
// check that fails on those types "fails": that line stops the program whenever it runs. Then again, adding
// what the code says of itself that no run checks: `with pet as a dog` (each call checks only that it's a
// record), `as a list of numbers` (only that it's a list), `gives a number`. A check that fails only on those
// "doesn't fit": the code goes against what it says. Code that says nothing gets the same types both times,
// so it gets no "doesn't fit": it stays as dynamic as it was.
import { Scope } from "./scope.js";
import { Turtle, TURTLE_ACTIONS, BUILTINS, plus, arithmetic, negate, lengthOf, compare, item, addInto, checkRepeat, checkRange, itemsOf,
  callable, checkInputs, checkKinds, makeRecord, fieldOf, recordFor, removeKey, readFile, writeFile, randomWhole, everyInterval, Closure,
  Quantity, isQuantity, measureOf, unitNamed, UNITS, MEASURE_TYPES, MEASURES, exitCode, removeFile, NOW_WORDS, waitFor, fakeClock, readFolder, soundOf,
  KINDS, closest } from "./vm.js";

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

// ---------- types beyond SAMPLES' (DESIGN §103) ----------
// A type is text: one of SAMPLES' keys, or "record:dog", a record the kind dog makes, or "list:number", a list
// whose every item is a number ("list:list:text", "list:record:dog"...). `undefined` means nothing known yet,
// `null` could be several.
const base = (t) => (typeof t !== "string" ? t : t.startsWith("record:") ? "record" : t.startsWith("list:") ? "list" : t);
const holds = (t) => (typeof t === "string" && t.startsWith("list:") ? t.slice(5) : null); // what each item of a list is, if known
// what a variable is, given two things it can be: the same, or one that says less about it, or could be several
function join(a, b) {
  if (a === undefined) return b;
  if (b === undefined || a === b) return a;
  if (a === null || b === null || base(a) !== base(b)) return null;
  if (base(a) === "list") {
    const items = join(holds(a) ?? null, holds(b) ?? null);
    return items === null ? "list" : `list:${items}`;
  }
  return base(a); // two kinds of record are still a record
}
const plural = (name) => (/[^aeiou]y$/.test(name) ? `${name.slice(0, -1)}ies` : /(s|x|z|ch|sh)$/.test(name) ? `${name}es` : `${name}s`);
// a type as a message says it: "a number", "text", "a dog", "a list of numbers"
function described(t) {
  if (t.startsWith("record:")) return `${/^[aeiou]/.test(t.slice(7)) ? "an" : "a"} ${t.slice(7)}`;
  if (t.startsWith("list:")) return `a list of ${each(t.slice(5))}`;
  if (MEASURE_TYPES.includes(t)) return MEASURES[MEASURE_TYPES.indexOf(t)];
  return { number: "a number", list: "a list", record: "a record", dictionary: "a dictionary", function: "a function" }[t] ?? t;
}
// the items of a list of t, as `a list of` says them: "numbers", "text", "dogs", "lists of numbers"
function each(t) {
  if (t.startsWith("record:")) return plural(t.slice(7));
  if (t.startsWith("list:")) return `lists of ${each(t.slice(5))}`;
  if (MEASURE_TYPES.includes(t)) return plural(t);
  return { number: "numbers", "yes/no": "yes or no", list: "lists", record: "records", dictionary: "dictionaries", function: "functions" }[t] ?? t;
}
const ITEM_WORDS = { numbers: "number", text: "text", "yes or no": "yes/no", lists: "list", records: "record", dictionaries: "dictionary", bytes: "bytes", functions: "function" };

class Found {
  constructor(message) {
    this.message = message;
  }
}
const found = (message) => {
  throw new Found(message);
};

// One function (or the program). Types are worked out for the whole program at once: a variable's type is
// what every `set` of it agrees on.
class Checker extends Scope {
  constructor(parent, name, params, body, all, def = { kinds: [] }) {
    super(parent, name, params, body);
    this.all = all;
    this.id = all.scopes++;
    this.def = def; // the `define` this function is, if it is one: its kinds, types, gives and madeKind
    this.maybeSkipped = 0; // inside the right side of `and`/`or`, which might not run, so nothing is certain
    this.returns = []; // what each `return` gives, for what a call of this function gives
    // inputs could be anything, but one that says what it is is that: each call checks it before the function
    // runs; and what it says beyond that is what it is, where the code is taken at its word
    params.forEach((p, i) => {
      const key = this.source(p, () => (def.kinds[i] >= 0 ? KIND_TYPES[def.kinds[i]] : null));
      if (def.types?.[i]) all.declared.set(key, () => this.typeNamed(def.types[i], def.at));
    });
    if (def.gives) all.gives.set(def, () => this.typeNamed(def.gives, def.at));
    this.block(body);
    this.endsOpen = !ends(body); // whether it can reach its end, and give nothing there
    // what a call of it gives, worked out with the variables' types: what its returns give, and nothing at its end
    this.returnKey = `returns ${this.id}`;
    all.sources.set(this.returnKey, [...this.returns, ...(this.endsOpen ? [() => "nothing"] : [])]);
    if (def.gives && this.endsOpen) {
      this.typeCheck(def.at, () => {
        const wanted = all.gives.get(def)();
        if (wanted !== "nothing" && !wanted?.endsWith(" or nothing")) found(`'${name}' must give ${def.gives}, but it can reach its end without giving anything`);
      });
    }
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
    return this.all.types[this.all.mode].get(key);
  }

  warn(at, kind, message) {
    if (at.file && kind === "unused") return; // a file the program uses can make more than this program needs
    this.all.warnings.push({ line: at.line, col: at.col, kind, message, ...(at.file && { file: at.file }) });
  }

  // Runs `test` once the types are known, first on what's sure, then on what the code says too: if it throws
  // the first time, this spot will fail whenever it runs; if only the second, it doesn't fit what the code says.
  willFail(at, test) {
    if (this.maybeSkipped) return;
    this.all.checks.push(() => {
      for (const mode of ["sure", "said"]) {
        this.all.mode = mode;
        try {
          test();
        } catch (err) {
          if (!(err instanceof Found)) throw err;
          return this.warn(at, mode === "sure" ? "fails" : "doesn't fit", err.message);
        }
      }
    });
  }

  // Runs `test` once the types are known, on what the code says too: if it throws, the code doesn't fit what
  // it says of itself (a `return` that gives what its `gives` doesn't). No run checks this, so it's never "fails".
  typeCheck(at, test) {
    this.all.checks.push(() => {
      this.all.mode = "said";
      try {
        test();
      } catch (err) {
        if (!(err instanceof Found)) throw err;
        this.warn(at, "doesn't fit", err.message);
      }
    });
  }

  // The type an input's `as`, or a `gives`, names, as written: "a number", "a dog", "a list of numbers",
  // "a dog or nothing" (which says too little to check anything by but a `return`). `at` is where a kind it
  // names that the program doesn't make is said to be wrong, once.
  typeNamed(words, at) {
    if (words === "nothing") return "nothing";
    if (words.endsWith(" or nothing")) return words; // checked only by fits()
    const kind = KINDS.indexOf(words);
    if (kind >= 0) return KIND_TYPES[kind];
    if (words.startsWith("a list of ")) {
      const items = this.itemsNamed(words.slice(10), at);
      return items === null ? "list" : `list:${items}`;
    }
    return this.kindNamed(words.replace(/^an? /, ""), at, false) ?? "record";
  }

  itemsNamed(words, at) {
    if (words.startsWith("lists of ")) {
      const items = this.itemsNamed(words.slice(9), at);
      return items === null ? "list" : `list:${items}`;
    }
    if (Object.hasOwn(ITEM_WORDS, words) || words === "texts") return ITEM_WORDS[words] ?? "text";
    return this.kindNamed(words, at, true);
  }

  // "record:dog", for a kind the program makes called `name` (or, `many`, the kind `name` is more than one
  // of: dogs, boxes, puppies), or null, having said there's none
  kindNamed(name, at, many) {
    const kinds = this.all.kinds;
    const singular = !many ? [name] : [name, name.replace(/s$/, ""), name.replace(/es$/, ""), name.replace(/ies$/, "y")];
    const kind = singular.find((n) => kinds.has(n));
    if (kind) return `record:${kind}`;
    const key = `${at.line}:${at.col}:${name}`;
    if (!this.all.unknownKinds.has(key)) {
      this.all.unknownKinds.add(key);
      const guess = closest(singular.at(-1), [...kinds.keys()]) ?? closest(name, [...kinds.keys()]);
      this.warn(at, "doesn't fit", `there is no kind called '${name}'${guess ? `. Did you mean '${guess}'?` : ""}`);
    }
    return null;
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
          const [a, b] = [base(left()), base(right())];
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
        return () => {
          const t = base(operand());
          return MEASURE_TYPES.includes(t) ? t : t === null ? null : t === undefined ? undefined : "number";
        };
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
      case "field": { // a field of a record a kind makes is what the kind's input says it is
        const of = this.type(e.of);
        return () => this.fieldType(of(), e.name);
      }
      case "item": { // where the code says what a list holds, an item of it is that
        const of = this.type(e.of);
        return () => (of() === undefined ? undefined : this.all.mode === "said" ? holds(of()) : null);
      }
      case "call":
        return this.callType(e);
      default: // and/or: could be anything
        return () => null;
    }
  }

  // what a call gives: what a kind makes, or what a function returns, where the name is a function made once
  // and never anything else; and, where the code is taken at its word, what its `gives` says
  callType(e) {
    if (!this.resolve(e.name)) return () => null;
    const key = this.key(e.name);
    return () => {
      const made = this.all.defines.get(key);
      if (made?.length !== 1 || this.all.sources.get(key).length !== 1) return null;
      const [{ define, checker }] = made;
      if (define.madeKind) return `record:${define.madeKind}`;
      if (this.all.mode === "said" && define.gives) {
        const said = this.all.gives.get(define)();
        return said?.endsWith(" or nothing") ? null : said;
      }
      return this.slotType(checker.returnKey);
    };
  }

  // what field `name` of a value of type `of` is: for a record the kind K makes, what K's input says it is, or
  // a function for one of K's own; null where it can't be known, or where anything in the program changes it
  fieldType(of, name) {
    if (of === undefined) return undefined;
    const kind = typeof of === "string" && of.startsWith("record:") && this.all.kinds.get(of.slice(7));
    if (!kind || this.all.fieldsSet.has(name)) return null;
    if (name === "kind") return "text";
    for (let k = kind; k; k = this.all.kinds.get(this.parentKind(k))) {
      const { define } = k;
      const i = define.params.indexOf(name);
      if (i >= 0) return define.kinds[i] < 0 ? null : this.all.mode === "said" && define.types?.[i] ? this.typeNamed(define.types[i], define.at) : KIND_TYPES[define.kinds[i]];
      if (k.owns.includes(name)) return "function";
    }
    return null;
  }

  // the kind a kind is made from (`kind puppy with name from dog(name)`), if it's made from one
  parentKind(kind) {
    return kind?.from ? this.all.makers.get(kind.from) : undefined;
  }

  // every field a record the kind K makes has, in the order it has them, or null if that can't be known
  fieldsOf(name, seen = new Set()) {
    const kind = this.all.kinds.get(name);
    if (!kind || seen.has(name)) return null;
    seen.add(name);
    const [start, ...rest] = kind.define.body;
    let fields;
    if (start.value.kind === "record") fields = [...start.value.fields];
    else if (this.parentKind(kind)) fields = this.fieldsOf(this.parentKind(kind), seen);
    if (!fields) return null;
    for (const s of rest) if (s.kind === "setField" && !fields.includes(s.name)) fields.push(s.name);
    return fields;
  }

  sample(e, type = base(this.type(e)())) {
    return e.kind === "value" ? e.value : SAMPLES[type];
  }

  known(...types) {
    return types.every((t) => t !== undefined && t !== null && base(t) !== "function");
  }

  // whether a value of type `t` is what `wanted` (a type typeNamed made) says: yes, no, or null if it can't be known
  fits(t, wanted) {
    if (t === undefined || t === null || wanted === undefined || wanted === null) return null;
    if (wanted.endsWith(" or nothing")) return t === "nothing" ? true : this.fits(t, this.typeNamed(wanted.slice(0, -11), { line: 0, col: 0 }));
    if (base(t) !== base(wanted)) return false;
    if (wanted.startsWith("record:")) {
      if (!t.startsWith("record:")) return null; // a record that may be one
      for (let k = t.slice(7), seen = 0; k && seen < 100; k = this.parentKind(this.all.kinds.get(k)), seen++) if (k === wanted.slice(7)) return true;
      return false;
    }
    if (wanted.startsWith("list:")) return t.startsWith("list:") ? this.fits(t.slice(5), wanted.slice(5)) : null;
    return true;
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
        this.willFail(s.target.at, () => this.known(type()) && base(type()) !== "list" && type() !== "bytes" && item(SAMPLES[base(type())], 1, true, found));
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
          if (base(current) === "list") return holds(current) && this.fits(v, holds(current)) === false ? "list" : current;
          if (current === "text") return current;
          if (current === "number" && v === "number") return "number";
          if (MEASURE_TYPES.includes(current) && v === current) return current; // `add 300 m to trip`
          // an add that will fail doesn't change the type: the program stops there
          return current === undefined || v === undefined || this.known(current, v) ? undefined : null;
        });
        this.willFail(s.at, () => {
          const [current, v] = [this.slotType(key), value()];
          if (!this.known(current, v)) return;
          addInto(SAMPLES[base(current)], this.sample(s.value), s.name, found);
          if (holds(current) && this.fits(v, holds(current)) === false) found(`can't add ${described(v)} to ${described(current)}`);
        });
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
        // a list's items could be anything, unless the code says what it holds
        this.source(s.name, () => (list() === undefined ? undefined : list() === "text" ? "text" : this.all.mode === "said" ? holds(list()) : null));
        this.willFail(s.at, () => this.known(list()) && itemsOf(SAMPLES[base(list())], found));
        this.block(s.body);
        return;
      }
      case "define": {
        const key = this.source(s.name, () => "function");
        const isTest = !this.parent && s.name.startsWith("test_"); // the test runner, test() in moth.js, calls it
        if (!this.all.made.has(key) && !isTest) this.all.made.set(key, { at: s.at, message: `'${s.name}' is made but never used` });
        if (s.madeKind) { // what a record the kind makes holds: its maker's inputs, its own functions, and what it's made from
          const from = s.body[0].value.kind === "call" ? s.body[0].value.name : null;
          const owns = s.body.filter((b) => b.kind === "setField" && b.value.kind === "name" && b.value.name === `${s.name}'s ${b.name}`).map((b) => b.name);
          if (!this.all.kinds.has(s.madeKind)) this.all.kinds.set(s.madeKind, { define: s, from, owns });
          this.all.makers.set(s.name, s.madeKind);
        }
        const checker = new Checker(this, s.name, s.params, s.body, this.all, s);
        this.all.defines.set(key, [...(this.all.defines.get(key) ?? []), { define: s, checker }]);
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
      case "return": {
        if (s.value) this.expr(s.value);
        const type = s.value ? this.type(s.value) : () => "nothing";
        this.returns.push(type);
        const { gives } = this.def;
        if (gives) { // what it gives must be what it says it gives
          this.typeCheck(s.at, () => {
            if (this.fits(type(), this.all.gives.get(this.def)()) === false) found(`'${this.fn.name}' must give ${gives}, not ${described(type())}`);
          });
        }
        return;
      }
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
        this.willFail(s.at, () => this.known(type()) && type() !== "dictionary" && removeKey("a", SAMPLES[base(type())], found));
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
        this.willFail(s.at, () => this.known(type()) && type() !== "text" && writeFile(null, SAMPLES[base(type())], null, found));
        return;
      }
      case "removeFile": { // as with `write`, only a name that isn't text is certain to fail
        this.expr(s.target);
        const type = this.type(s.target);
        this.willFail(s.at, () => this.known(type()) && type() !== "text" && removeFile(SAMPLES[base(type())], null, found));
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
        if (!this.def.madeKind) this.all.fieldsSet.add(s.name); // a record's field can then be anything
        const type = this.type(s.target);
        this.willFail(s.at, () => this.known(type()) && base(type()) !== "record" && recordFor(SAMPLES[base(type())], s.name, found));
        return;
      }
      case "call":
        this.call(s, true);
        return;
      case "do":
        this.expr(s.value);
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
          const sound = written(s.note, base(note()), { text: "C", number: 440 });
          if (!this.known(time())) return soundOf(sound, 1, 1000, found); // the note can still be wrong on its own
          soundOf(sound, written(s.time, base(time()), { number: 1 }), s.unit, found);
        });
        return;
      }
      case "turtle": {
        if (!s.value) return;
        this.expr(s.value);
        const action = TURTLE_ACTIONS.indexOf(s.action);
        if (s.action === "picture") { // whether a file is a picture isn't known: only what is neither a name nor bytes is sure to fail
          const type = this.type(s.value.items[0]);
          this.willFail(s.at, () => this.known(type()) && type() !== "text" && type() !== "bytes" && new Turtle().act(action, [SAMPLES[base(type())], 0, 0, null, null], found));
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
      if (this.known(type)) callable(SAMPLES[base(type)], e.name, found); // not a function at all
      const made = this.all.defines.get(key);
      // the number of inputs is only certain when the name is a function made exactly once, and never anything else
      if (type === "function" && made?.length === 1 && this.all.sources.get(key).length === 1) {
        const [{ define }] = made;
        const { params, kinds } = define;
        checkInputs({ fn: { params } }, e.args.length, e.name, found);
        // and an input that says what it is must get that, where the checker knows what it gets
        const sure = kinds.map((k, i) => (types[i]() === undefined || types[i]() === null ? -1 : k));
        checkKinds({ fn: { params, kinds: sure } }, e.args.map((arg, i) => (sure[i] >= 0 ? this.sample(arg, base(types[i]())) : null)), e.name, found);
        // what it says beyond that, which no run checks, is checked by what the code says too
        if (this.all.mode === "said" && define.types) {
          define.types.forEach((words, i) => {
            if (words && this.fits(types[i](), this.typeNamed(words, define.at)) === false) found(`'${e.name}' needs ${params[i]} to be ${words}, not ${described(types[i]())}`);
          });
        }
      }
      this.ownCall(e, types);
    });
  }

  // `rex's speak()`, where rex is surely a dog: dog has no `speak`, and nothing gives a record one (see ownCalls in moth.js)
  ownCall(e, types) {
    const helper = this.all.defines.get(this.key(e.name))?.[0]?.define;
    const tried = helper?.params[0] === "the record" && helper.body[0]?.kind === "try" ? helper.body[0] : null;
    const kind = tried && types[0]?.();
    if (typeof kind !== "string" || !kind.startsWith("record:")) return;
    const own = tried.body[0].name;
    const fields = this.fieldsOf(kind.slice(7));
    if (fields && !fields.includes(own) && !this.all.fieldsSet.has(own)) found(tried.handler[0].value.value);
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
          else if (base(left()) !== "number" || base(right()) !== "number") plus(this.sample(e.left), this.sample(e.right), found);
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
        this.willFail(e.at, () => {
          const t = type();
          if (!this.known(t)) return;
          if (base(t) !== "record") fieldOf(SAMPLES[base(t)], e.name, found);
          // but a record a kind makes has the fields the kind gives it, and only those, unless something adds one
          const fields = t.startsWith("record:") && this.fieldsOf(t.slice(7));
          if (fields && !fields.includes(e.name) && !this.all.fieldsSet.has(e.name)) fieldOf(makeRecord(fields, fields), e.name, found);
        });
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
        this.willFail(e.at, () => this.known(type()) && type() !== "text" && readFile(SAMPLES[base(type())], e.bytes, null, found));
        return;
      }
      case "readFolder": { // as with `read`, only a name that isn't text is certain to fail
        this.expr(e.of);
        const type = this.type(e.of);
        this.willFail(e.at, () => this.known(type()) && type() !== "text" && readFolder(SAMPLES[base(type())], null, found));
        return;
      }
      case "builtin": { // fails when an input is known to be the wrong kind; what the values are is left to run time
        for (const arg of e.args) this.expr(arg);
        const builtin = BUILTINS.find((b) => b.name === e.name);
        const types = e.args.map((arg) => this.type(arg));
        this.willFail(e.at, () => this.known(...types.map((t) => t())) && types.some((t, i) => !builtin.needs[i].includes(base(t())))
          && builtin.run(e.args.map((arg) => this.sample(arg)), found));
        return;
      }
      case "item": {
        this.expr(e.of);
        this.expr(e.index);
        const type = this.type(e.of);
        this.willFail(e.at, () => {
          const t = base(type());
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

// whether a block can't reach its end: its last statement returns, fails or stops the program, or is an `if`
// whose every way does (a loop around a `return` may still end, so it doesn't count)
function ends(body) {
  const last = body.at(-1);
  if (!last) return false;
  if (last.kind === "return" || last.kind === "fail" || last.kind === "exit") return true;
  if (last.kind === "if") return ends(last.then) && ends(last.otherwise);
  if (last.kind === "several") return ends(last.body);
  return false;
}

// Every problem in a parsed program, in order: { line, col, kind, message }, where kind is "fails" (this
// line stops the program whenever it runs), "doesn't fit" (it goes against what the code says of itself),
// "never runs", or "unused".
export function check(program) {
  const all = { scopes: 0, sources: new Map(), types: { sure: new Map(), said: new Map() }, mode: "sure", checks: [], warnings: [], used: new Set(),
    made: new Map(), defines: new Map(), declared: new Map(), gives: new Map(), kinds: new Map(), makers: new Map(), fieldsSet: new Set(),
    unknownKinds: new Set() };
  new Checker(null, "main", [], program, all);
  // Work out every variable's type: repeat until nothing changes. A type can only go from unknown, to one
  // type, to one that says less, to "could be several", so this stops after a few rounds. Then again, with
  // what the code says of itself, where an input that says what it is is that.
  for (const mode of ["sure", "said"]) {
    all.mode = mode;
    const types = all.types[mode];
    for (let changed = true; changed; ) {
      changed = false;
      for (const [key, sources] of all.sources) {
        let type;
        if (mode === "said" && all.declared.has(key)) type = all.declared.get(key)();
        else for (const source of sources) type = join(type, source());
        if (type !== types.get(key)) {
          types.set(key, type);
          changed = true;
        }
      }
    }
  }
  all.mode = "said";
  for (const gives of all.gives.values()) gives(); // a kind a `gives` names that the program doesn't make
  for (const run of all.checks) run();
  for (const [key, { at, message }] of all.made) {
    if (!all.used.has(key) && !at.file) all.warnings.push({ line: at.line, col: at.col, kind: "unused", message }); // a used file can make more than one program needs
  }
  const seen = new Set();
  return all.warnings
    .filter((w) => !seen.has(`${w.line}:${w.col}:${w.message}`) && seen.add(`${w.line}:${w.col}:${w.message}`))
    .sort((a, b) => a.line - b.line || a.col - b.col);
}
