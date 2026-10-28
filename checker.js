// The checker: finds mistakes without running the program. It only speaks when it is sure, and it says
// what running would say: each "will fail" warning comes from the VM's own checks (vm.js), run on sample
// values of the types it worked out, so its message is the exact error that line would stop with.
import { Scope } from "./scope.js";
import { Turtle, TURTLE_ACTIONS, BUILTINS, plus, arithmetic, negate, lengthOf, compare, item, addInto, checkRepeat, checkRange, itemsOf,
  callable, checkInputs, makeRecord, fieldOf, recordFor, removeKey, readFile, writeFile } from "./vm.js";

// A stand-in value for each type. Only checks that depend on the type alone use these; a check that
// depends on the value itself (like dividing by zero) only runs when the code has that value written out.
const SAMPLES = { number: 1, text: "a", "yes/no": true, nothing: null, list: [], record: makeRecord([], []), dictionary: new Map(), bytes: new Uint8Array(0) };
const literalType = (v) => (v === null ? "nothing" : typeof v === "boolean" ? "yes/no" : typeof v === "string" ? "text" : "number");

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
  constructor(parent, name, params, body, all) {
    super(parent, name, params, body);
    this.all = all;
    this.id = all.scopes++;
    this.maybeSkipped = 0; // inside the right side of `and`/`or`, which might not run, so nothing is certain
    for (const p of params) this.source(p, () => null); // inputs could be anything
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
          return a === "number" && b === "number" ? "number" : null;
        };
      }
      case "compare":
      case "not":
        return () => "yes/no";
      case "negate":
      case "length":
        return () => "number";
      case "builtin": {
        const { gives } = BUILTINS.find((b) => b.name === e.name);
        return () => gives;
      }
      case "ask":
        return () => "text";
      case "read":
        return () => (e.bytes ? "bytes" : "text");
      case "arguments":
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
      if ((s.kind === "return" || s.kind === "fail" || s.kind === "stop") && body[i + 1]) {
        this.warn(body[i + 1].at, "never runs", `this line can never run, because '${s.kind}' comes first`);
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
        if (!this.all.made.has(key)) this.all.made.set(key, { at: s.at, message: `'${s.name}' is made but never used` });
        this.all.defines.set(key, [...(this.all.defines.get(key) ?? []), s.params.length]);
        new Checker(this, s.name, s.params, s.body, this.all);
        return;
      }
      case "return":
        if (s.value) this.expr(s.value);
        return;
      case "fail": // stopping on purpose is not a mistake
        this.expr(s.value);
        return;
      case "stop":
        return;
      case "remove": { // which keys a dictionary has isn't known, so only removing from something else is certain to fail
        this.expr(s.key);
        this.expr(s.target);
        const type = this.type(s.target);
        this.willFail(s.at, () => this.known(type()) && type() !== "dictionary" && removeKey("a", SAMPLES[type()], found));
        return;
      }
      case "write": { // whether the file can be written isn't known, so only a name that isn't text is certain to fail
        this.expr(s.value);
        this.expr(s.target);
        const type = this.type(s.target);
        this.willFail(s.at, () => this.known(type()) && type() !== "text" && writeFile(null, SAMPLES[type()], null, found));
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
      case "turtle": {
        if (!s.value) return;
        this.expr(s.value);
        const action = TURTLE_ACTIONS.indexOf(s.action);
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
    this.willFail(e.at, () => {
      const type = this.slotType(key);
      if (this.known(type)) callable(SAMPLES[type], e.name, found); // not a function at all
      const arities = this.all.defines.get(key);
      // the number of inputs is only certain when the name is a function made exactly once, and never anything else
      if (type === "function" && arities?.length === 1 && this.all.sources.get(key).length === 1) {
        checkInputs({ fn: { params: { length: arities[0] } } }, e.args.length, e.name, found);
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
      case "read": { // as with `write`, only a name that isn't text is certain to fail
        this.expr(e.of);
        const type = this.type(e.of);
        this.willFail(e.at, () => this.known(type()) && type() !== "text" && readFile(SAMPLES[type()], e.bytes, null, found));
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
