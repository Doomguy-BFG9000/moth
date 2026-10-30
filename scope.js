// Which variable each name means. Both back ends build on this: the bytecode compiler (moth.js) and
// the JavaScript compiler (jit.js), so the two can't disagree about what a name refers to.
import { noValue, closest } from "./vm.js";

const STATEMENT_WORDS = ["set", "add", "say", "if", "repeat", "for", "to", "return", "move", "turn", "pen", "fail", "stop", "use", "try", "remove", "write", "expect", "when", "every"];

// Names each function changes. Inputs and functions made with `to` always belong to the function itself;
// a name it sets (or loops over, or adds to) belongs to the function too, unless a variable of that name is
// made above its `to` line, in the code around it (see Scope).
export function declarations(body, found = { own: [], shared: [], adds: [] }) {
  for (const s of body) {
    if (s.kind === "define") found.own.push(s.name);
    if (s.kind === "set" || s.kind === "count" || s.kind === "each" || (s.kind === "try" && s.name)) found.shared.push(s.name);
    if (s.kind === "add") found.adds.push(s.name);
    for (const inner of [s.then, s.otherwise, s.kind !== "define" && s.body, s.handler]) if (inner) declarations(inner, found);
  }
  return found;
}

// Where things are in one function's code (or the program's), in the order they're written: for each name,
// how many functions the code makes before the name is first made, and for each function it makes, its own
// number. A name is made above a function when its count is less than the function's number. A function's
// own name counts as made on its `to` line, so above the functions after it, not above itself; a try's
// `with` name is made at its `if it fails`, after the try's code.
function madeOrder(body, made, places, count = { n: 0 }) {
  const make = (name) => made.has(name) || made.set(name, count.n);
  for (const s of body) {
    const fn = s.kind === "define" ? s : s.fn; // `when` and `every` make a function too
    if (fn) places.set(fn.body, ++count.n);
    if (s.kind === "define" || s.kind === "set" || s.kind === "count" || s.kind === "each") make(s.name);
    for (const inner of [s.then, s.otherwise, s.kind !== "define" && s.body]) if (inner) madeOrder(inner, made, places, count);
    if (s.kind === "try" && s.name) make(s.name);
    if (s.handler) madeOrder(s.handler, made, places, count);
  }
}

// One function (or the whole program). Each variable gets a numbered slot here, once, so a name resolves
// to a (depth, slot) pair: how many functions out it lives, and which of that function's slots it is.
// a line that starts like a phrase but isn't one, which would otherwise be a call to a function nothing made
const PHRASE_HINTS = new Map([["wait", "to wait, say how long: 'wait 2 seconds'"],
  ["save", "to save a value, say where: 'save scores to \"scores.txt\"'"]]);

export class Scope {
  // `slots` carries a shell's earlier top-level variables; `debug` asks the compiler for pause points.
  constructor(parent, name, params, body, { slots = new Map(), debug = parent?.debug ?? false } = {}) {
    this.parent = parent;
    this.slots = slots;
    this.debug = debug;
    this.fn = { name, params, nslots: slots.size, names: [] };
    for (const [n, slot] of slots) this.fn.names[slot] = n; // each slot's name, for the debugger and disassembler
    Object.defineProperty(this.fn, "parent", { value: parent?.fn }); // for the debugger; not enumerable, so the bytecode's JSON skips it
    this.made = new Map(); // see madeOrder: the shell's earlier variables and the inputs are made above everything
    this.places = new Map();
    for (const n of [...slots.keys(), ...params]) this.made.set(n, 0);
    madeOrder(body, this.made, this.places);
    this.place = parent ? parent.places.get(body) : 0; // where this function is in the code around it
    for (const p of params) this.declare(p);
    const { own, shared, adds } = declarations(body);
    for (const n of own) if (!this.slots.has(n)) this.declare(n);
    for (const n of shared) if (!this.slots.has(n) && !this.reaches(n)) this.declare(n);
    // `add 1 to n` with no n anywhere is a name nothing sets; with one made below, it's this function's own
    for (const n of adds) if (!this.slots.has(n) && !this.reaches(n) && parent?.resolve(n)) this.declare(n);
  }

  declare(name) {
    this.slots.set(name, ++this.fn.nslots);
    this.fn.names[this.fn.nslots] = name;
  }

  // Whether a name this function changes means a variable outside it. It does only if the nearest function
  // around it with a variable of that name (or the top level) makes it above this function's `to` line.
  reaches(name) {
    for (let outer = this.parent, place = this.place; outer; place = outer.place, outer = outer.parent) {
      if (outer.slots.has(name)) return outer.made.get(name) < place;
    }
    return false;
  }

  resolve(name) {
    for (let c = this, depth = 0; c; c = c.parent, depth++) if (c.slots.has(name)) return [depth, c.slots.get(name)];
    return null;
  }

  // What to say when a name nothing ever sets is used: suggest the closest name that does exist. A line
  // that starts with an unknown name may be a misspelled Moth word instead, like `sya "hi"`, or a phrase
  // missing its last part, like `wait 2`.
  undefinedMessage(name, { call = false, statement = false } = {}) {
    if (call && PHRASE_HINTS.has(name)) return `there is no function called '${name}' (${PHRASE_HINTS.get(name)})`;
    const known = [];
    for (let c = this; c; c = c.parent) known.push(...c.slots.keys());
    const guess = closest(name, statement ? [...known, ...STATEMENT_WORDS] : known);
    const at = name.indexOf("'s "); // `math's sine`: a name the file used `as math` makes
    const message = at >= 0 ? `'${name.slice(0, at)}' has nothing called '${name.slice(at + 3)}'`
      : call ? `there is no function called '${name}'` : guess ? `'${name}' has no value yet` : noValue(name);
    return guess ? `${message}. Did you mean '${guess}'?` : message;
  }
}
