// Which variable each name means. Both back ends build on this: the bytecode compiler (moth.js) and
// the JavaScript compiler (jit.js), so the two can't disagree about what a name refers to.
import { noValue } from "./vm.js";

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

// One function (or the whole program). Each variable gets a numbered slot here, once, so a name resolves
// to a (depth, slot) pair: how many functions out it lives, and which of that function's slots it is.
export class Scope {
  // `slots` carries a shell's earlier top-level variables; `debug` asks the compiler for pause points.
  constructor(parent, name, params, body, { slots = new Map(), debug = parent?.debug ?? false } = {}) {
    this.parent = parent;
    this.slots = slots;
    this.debug = debug;
    this.fn = { name, params, nslots: slots.size, names: [] };
    for (const [n, slot] of slots) this.fn.names[slot] = n; // each slot's name, for the debugger and disassembler
    Object.defineProperty(this.fn, "parent", { value: parent?.fn }); // for the debugger; not enumerable, so `moth build`'s JSON skips it
    for (const p of params) this.declare(p);
    const { own, shared } = declarations(body);
    for (const n of own) if (!this.slots.has(n)) this.declare(n);
    for (const n of shared) if (!this.slots.has(n) && !parent?.resolve(n)) this.declare(n);
  }

  declare(name) {
    this.slots.set(name, ++this.fn.nslots);
    this.fn.names[this.fn.nslots] = name;
  }

  resolve(name) {
    for (let c = this, depth = 0; c; c = c.parent, depth++) if (c.slots.has(name)) return [depth, c.slots.get(name)];
    return null;
  }

  // What to say when a name nothing ever sets is used: suggest the closest name that does exist. A line
  // that starts with an unknown name may be a misspelled Moth word instead, like `sya "hi"`.
  undefinedMessage(name, { call = false, statement = false } = {}) {
    const known = [];
    for (let c = this; c; c = c.parent) known.push(...c.slots.keys());
    const guess = closest(name, statement ? [...known, ...STATEMENT_WORDS] : known);
    const message = call ? `there is no function called '${name}'` : guess ? `'${name}' has no value yet` : noValue(name);
    return guess ? `${message}. Did you mean '${guess}'?` : message;
  }
}
