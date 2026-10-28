// The JIT: Moth's second back end. At run time it turns a program into JavaScript, which V8 then compiles
// to machine code. The VM (vm.js) stays the reference: both engines call the same checks, and the tests
// run thousands of random programs through both and require the same output, drawings and errors.
import { Scope } from "./scope.js";
import { UNSET, Closure, Turtle, TURTLE_ACTIONS, fail, truthy, equal, show, item, compare, plus, arithmetic, negate, lengthOf,
  addInto, checkRepeat, checkRange, itemsOf, callable, checkInputs, noValue, stoppedMessage, Record, makeRecord, fieldOf, recordFor,
  failWith, BUILTINS } from "./vm.js";

const q = JSON.stringify; // a JavaScript literal
const COMPARE_HELPERS = { "is": "eq", "less than": "lt", "greater than": "gt", "at least": "ge", "at most": "le", "divisible by": "dv" };
const MATH_HELPERS = { "+": "add", "-": "sub", "*": "mul", "/": "div" };

// Compiles one Moth function (or the program) to the body of a JavaScript function. Each variable becomes a
// JavaScript `let` named after its slot, v<level>_<slot>, so Moth's scopes become JavaScript's: a function
// made inside another reaches the outer one's variables through a JavaScript closure, just as the VM's
// functions reach them through scope arrays. `ats` collects every position an error can point at.
class JsCompiler extends Scope {
  constructor(parent, name, params, body, ats) {
    super(parent, name, params, body);
    this.level = parent ? parent.level + 1 : 0;
    this.ats = ats;
    this.temps = 0;
    const statements = this.block(body);
    const locals = [];
    for (let slot = params.length + 1; slot <= this.fn.nslots; slot++) locals.push(`${this.v(slot)} = UNSET`); // inputs are the parameters
    for (let t = 1; t <= this.temps; t++) locals.push(`$t${t}`);
    this.code = `${locals.length ? `let ${locals.join(", ")};\n` : ""}${statements}`;
  }

  v(slot, level = this.level) {
    return `v${level}_${slot}`;
  }

  ref(name) {
    const [depth, slot] = this.resolve(name);
    return this.v(slot, this.level - depth);
  }

  pos(at) {
    return this.ats.push(at) - 1;
  }

  temp() {
    return `$t${++this.temps}`;
  }

  undefined(name, at, options) {
    return `fail(${q(this.undefinedMessage(name, options))}, ${this.pos(at)})`;
  }

  block(body) {
    return body.map((s) => this.statement(s)).join("\n");
  }

  // Loops count a step at the end of each round, like the VM's jump back, so `maxSteps` stops both at the same place.
  statement(s) {
    switch (s.kind) {
      case "set":
        return `${this.ref(s.name)} = ${this.expr(s.value)};`;
      case "setItem":
        return `{ const $r = itemRef(${this.expr(s.target.of)}, ${this.expr(s.target.index)}, ${this.pos(s.target.at)}); $r[0][$r[1]] = ${this.expr(s.value)}; }`;
      case "add": {
        const value = this.expr(s.value);
        if (!this.resolve(s.name)) return `${value};\n${this.undefined(s.name, s.at)};`;
        const v = this.ref(s.name);
        return `{ const $v = ${value}; ${v} = addInto(${v}, $v, ${q(s.name)}, ${this.pos(s.at)}); }`; // the value first, as the VM does
      }
      case "say":
        return `say([${s.parts.map((p) => this.expr(p)).join(", ")}]);`;
      case "if":
        return `if (truthy(${this.expr(s.cond)})) {\n${this.block(s.then)}\n} else {\n${this.block(s.otherwise)}\n}`;
      case "while":
        return `for (;;) {\nif (!truthy(${this.expr(s.cond)})) break;\n${this.block(s.body)}\ntick(${this.pos(s.at)});\n}`;
      case "repeat": {
        const k = this.pos(s.at);
        return `for (let $n = checkRepeat(${this.expr(s.count)}, ${k}); $n > 0; $n--) {\n${this.block(s.body)}\ntick(${k});\n}`;
      }
      case "count": {
        const k = this.pos(s.at);
        const range = `checkRange(${this.expr(s.from)}, ${this.expr(s.to)}, ${k})`;
        return `for (let [$i, $last] = ${range}; $i <= $last; $i++) {\n${this.ref(s.name)} = $i;\n${this.block(s.body)}\ntick(${k});\n}`;
      }
      case "each": {
        const k = this.pos(s.at);
        return `for (const $x of itemsOf(${this.expr(s.list)}, ${k})) {\n${this.ref(s.name)} = $x;\n${this.block(s.body)}\ntick(${k});\n}`;
      }
      case "define": {
        const inner = new JsCompiler(this, s.name, s.params, s.body, this.ats);
        const params = s.params.map((_, i) => inner.v(i + 1)).join(", ");
        return `${this.ref(s.name)} = fn(${q(s.name)}, ${q(s.params)}, function (${params}) {\n${inner.code}\nreturn null;\n});`;
      }
      case "return":
        return `return ${s.value ? this.expr(s.value) : "null"};`;
      case "call":
        return `${this.call(s, true)};`;
      case "turtle":
        return `turtle(${TURTLE_ACTIONS.indexOf(s.action)}, ${s.value ? this.expr(s.value) : "null"}, ${this.pos(s.at)});`;
      case "setField":
        return `{ const $o = recordFor(${this.expr(s.target)}, ${q(s.name)}, ${this.pos(s.at)}); $o[${q(s.name)}] = ${this.expr(s.value)}; }`;
      case "fail":
        return `failWith(${this.expr(s.value)}, ${this.pos(s.at)});`;
      case "stop":
        return "break;"; // every Moth loop is a JavaScript loop, and nothing else is
    }
  }

  // The function is looked up before its inputs are worked out, and checked after, as in the VM.
  call(e, statement = false) {
    if (!this.resolve(e.name)) return this.undefined(e.name, e.at, { call: true, statement });
    const k = this.pos(e.at);
    const f = `callable(${this.ref(e.name)}, ${q(e.name)}, ${k})`;
    const args = e.args.map((a) => this.expr(a));
    if (args.length > 3) return `callN(${f}, [${args.join(", ")}], ${q(e.name)}, ${k})`;
    return `call${args.length}(${[f, ...args, q(e.name), k].join(", ")})`;
  }

  expr(e) {
    switch (e.kind) {
      case "value": // a number goes in as written, less leading zeros (JavaScript reads 07 as octal): no floats to format
        return e.value === null ? "null" : typeof e.value === "number" ? e.at.text.replace(/^0+(?=\d)/, "") : q(e.value);
      case "name":
        if (!this.resolve(e.name)) return this.undefined(e.name, e.at);
        return `(${this.ref(e.name)} === UNSET ? unset(${q(e.name)}, ${this.pos(e.at)}) : ${this.ref(e.name)})`;
      case "call":
        return this.call(e);
      case "math":
        return `${MATH_HELPERS[e.op]}(${this.expr(e.left)}, ${this.expr(e.right)}, ${this.pos(e.at)})`;
      case "compare": {
        const test = `${COMPARE_HELPERS[e.op]}(${this.expr(e.left)}, ${this.expr(e.right)}, ${this.pos(e.at)})`;
        return e.negate ? `!${test}` : test;
      }
      case "and": {
        const t = this.temp();
        return `(truthy(${t} = ${this.expr(e.left)}) ? ${this.expr(e.right)} : ${t})`;
      }
      case "or": {
        const t = this.temp();
        return `(truthy(${t} = ${this.expr(e.left)}) ? ${t} : ${this.expr(e.right)})`;
      }
      case "not":
        return `!truthy(${this.expr(e.operand)})`;
      case "negate":
        return `neg(${this.expr(e.operand)}, ${this.pos(e.at)})`;
      case "list":
        return `[${e.items.map((x) => this.expr(x)).join(", ")}]`;
      case "length":
        return `lengthOf(${this.expr(e.of)}, ${this.pos(e.at)})`;
      case "item":
        return `item(${this.expr(e.of)}, ${this.expr(e.index)}, ${this.pos(e.at)})`;
      case "record":
        return `record(${q(e.fields)}, [${e.values.map((v) => this.expr(v)).join(", ")}])`;
      case "field":
        return `field(${this.expr(e.of)}, ${q(e.name)}, ${this.pos(e.at)})`;
      case "builtin":
        return `builtin(${BUILTINS.findIndex((b) => b.name === e.name)}, [${e.args.map((a) => this.expr(a)).join(", ")}], ${this.pos(e.at)})`;
    }
  }
}

// Thrown when Moth calls go deeper than MAX_DEPTH, so run() can hand the program to the VM. The JIT's Moth
// calls are JavaScript calls, and stopping at a depth of our own, well before JavaScript's stack runs out,
// means the hand-over never happens halfway through something else, like the code that prints a line.
export class TooDeep {}
const MAX_DEPTH = 2000;

// What the generated code calls. The fast paths (two numbers) are written out here so V8 can inline them;
// everything else goes to the checks the VM uses too. `k` is a position, so an error points at the right spot.
function helpers(ats, print, draw, maxSteps) {
  // An error ends every Moth call in progress, so the depth goes back to 0: load() lets JavaScript call in again.
  const errors = ats.map((at) => (message, value) => {
    depth = 0;
    fail(at, message, value);
  });
  const turtle = new Turtle(draw);
  let steps = 0;
  let depth = 0; // a failed call needs no undoing: any error ends the run
  const tick = (k) => {
    if (++steps > maxSteps) errors[k](stoppedMessage(maxSteps));
  };
  const enter = (f, argc, name, k) => {
    checkInputs(f, argc, name, errors[k]);
    tick(k);
    if (++depth > MAX_DEPTH) {
      depth = 0;
      throw new TooDeep();
    }
  };
  const leave = (result) => (depth--, result);
  const ordered = (op, test) => (a, b, k) => (typeof a === "number" && typeof b === "number" ? test(a, b) : compare(op, a, b, errors[k]));
  return {
    UNSET,
    truthy,
    tick,
    fail: (message, k) => errors[k](message),
    unset: (name, k) => errors[k](noValue(name)),
    fn: (name, params, run) => new Closure({ name, params, run }, null),
    callable: (f, name, k) => callable(f, name, errors[k]),
    call0: (f, name, k) => (enter(f, 0, name, k), leave(f.fn.run())),
    call1: (f, a, name, k) => (enter(f, 1, name, k), leave(f.fn.run(a))),
    call2: (f, a, b, name, k) => (enter(f, 2, name, k), leave(f.fn.run(a, b))),
    call3: (f, a, b, c, name, k) => (enter(f, 3, name, k), leave(f.fn.run(a, b, c))),
    callN: (f, args, name, k) => (enter(f, args.length, name, k), leave(f.fn.run(...args))),
    add: (a, b, k) => (typeof a === "number" && typeof b === "number" ? a + b : plus(a, b, errors[k])),
    sub: (a, b, k) => (typeof a === "number" && typeof b === "number" ? a - b : arithmetic("-", a, b, errors[k])),
    mul: (a, b, k) => (typeof a === "number" && typeof b === "number" ? a * b : arithmetic("*", a, b, errors[k])),
    div: (a, b, k) => (typeof a === "number" && typeof b === "number" && b !== 0 ? a / b : arithmetic("/", a, b, errors[k])),
    neg: (v, k) => (typeof v === "number" ? -v : negate(v, errors[k])),
    eq: (a, b) => equal(a, b),
    lt: ordered("less than", (a, b) => a < b),
    gt: ordered("greater than", (a, b) => a > b),
    ge: ordered("at least", (a, b) => a >= b),
    le: ordered("at most", (a, b) => a <= b),
    dv: (a, b, k) => (typeof a === "number" && typeof b === "number" && b !== 0 ? a % b === 0 : compare("divisible by", a, b, errors[k])),
    lengthOf: (v, k) => lengthOf(v, errors[k]),
    item: (target, n, k) => {
      if (Array.isArray(target) && Number.isInteger(n) && n >= 1 && n <= target.length) return target[n - 1];
      const [seq, i] = item(target, n, false, errors[k]);
      return seq[i];
    },
    itemRef: (target, n, k) => item(target, n, true, errors[k]),
    addInto: (current, value, name, k) => (typeof current === "number" && typeof value === "number" ? current + value : addInto(current, value, name, errors[k])),
    say: (parts) => print(parts.map((p) => show(p)).join("")),
    checkRepeat: (n, k) => (checkRepeat(n, errors[k]), n),
    checkRange: (from, to, k) => (checkRange(from, to, errors[k]), [from, to]),
    itemsOf: (v, k) => itemsOf(v, errors[k]),
    turtle: (action, value, k) => turtle.act(action, value, errors[k]),
    record: makeRecord,
    field: (r, name, k) => {
      const value = r instanceof Record ? r[name] : undefined; // no Moth value is undefined, and a record's prototype is empty
      return value !== undefined ? value : fieldOf(r, name, errors[k]);
    },
    recordFor: (r, name, k) => recordFor(r, name, errors[k]),
    failWith: (value, k) => failWith(value, errors[k]),
    builtin: (i, args, k) => BUILTINS[i].run(args, errors[k]),
  };
}
export const HELPER_NAMES = Object.keys(helpers([], () => {}, undefined, 0));

// Compiles a parsed program to JavaScript: its source (to look at), the names of its top-level variables,
// and a function that runs it and returns those variables' values (see load() in moth.js).
export function jit(program) {
  const ats = [];
  const main = new JsCompiler(null, "main", [], program, ats);
  const slots = main.fn.names.map((_, slot) => main.v(slot)).filter((_, slot) => slot > 0);
  return fromJs(`${main.code}\nreturn [${slots.join(", ")}];`, ats, main.fn.names);
}

// Runs JavaScript made for these helpers, whoever made it: jit() above, or the compiler written in Moth.
// `ats` are the tokens the code's positions point at.
export function fromJs(code, ats, names) {
  const source = `"use strict";\nconst { ${HELPER_NAMES.join(", ")} } = R;\n${code}`;
  const compiled = new Function("R", source);
  return { source, names, ats, run: (print, draw, maxSteps) => compiled(helpers(ats, print, draw, maxSteps)) };
}
