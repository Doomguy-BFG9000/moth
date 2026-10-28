// Which variable each name means. Both back ends build on this: the bytecode compiler (moth.js) and
// the JavaScript compiler (jit.js), so the two can't disagree about what a name refers to.
import { noValue, closest } from "./vm.js";

const STATEMENT_WORDS = ["set", "add", "say", "if", "repeat", "for", "to", "return", "move", "turn", "pen", "fail", "stop", "use", "try", "remove", "write"];

// Names each function sets. Inputs and functions made with `to` always belong to the function itself;
// a name it `set`s (or loops over) belongs to the outermost enclosing function, or the top level, that also sets it.
export function declarations(body, found = { own: [], shared: [] }) {
  for (const s of body) {
    if (s.kind === "define") found.own.push(s.name);
    if (s.kind === "set" || s.kind === "count" || s.kind === "each" || (s.kind === "try" && s.name)) found.shared.push(s.name);
    for (const inner of [s.then, s.otherwise, s.kind !== "define" && s.body, s.handler]) if (inner) declarations(inner, found);
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
    const at = name.indexOf("'s "); // `math's sine`: a name the file used `as math` makes
    const message = at >= 0 ? `'${name.slice(0, at)}' has nothing called '${name.slice(at + 3)}'`
      : call ? `there is no function called '${name}'` : guess ? `'${name}' has no value yet` : noValue(name);
    return guess ? `${message}. Did you mean '${guess}'?` : message;
  }
}
