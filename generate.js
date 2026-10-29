// Random Moth programs, made from the grammar: every one can be read, and most run into a mistake
// somewhere, on purpose. The tests run them on all three engines, through the compiler written in Moth,
// the checker and the formatter, which must all agree. The seed is fixed, so a failure always reproduces.

const NUMBERS = ["0", "1", "2", "3", "-1", "2.5", "10", "255", "256", "0x10", "0b11", "1000000", "0.1", "9007199254740991"];
const TEXTS = ['""', '"a"', '"Sam"', '"hello world"', '"é"', '"😀"', '"1"', '"a,b,c"', '"x\\ny"', '"tab\\there"'];
const VARIABLES = ["a", "b", "c", "n", "items", "d", "t"];
const FIELDS = ["x", "y", "name"];

export function generatePrograms(seed, count) {
  let state = seed;
  const random = (n) => {
    state = (state * 1103515245 + 12345) % 2 ** 31;
    return Math.floor((state / 2 ** 31) * n);
  };
  const pick = (list) => list[random(list.length)];
  const chance = (p) => random(1000) < p * 1000;

  // most programs start with a sensible value in each variable, so they get further before a mistake
  const START = ["set a to 3", 'set b to "Sam"', "set c to list of 1, 2, 3", "set n to 0", 'set items to list of "a", "b"',
    'set d to dictionary where "a" is 1, "b" is 2', 'set t to "file.txt"'];

  function program() {
    const lines = chance(0.85) ? START.filter(() => chance(0.85)) : [];
    const functions = []; // [name, how many inputs]
    for (let i = random(3); i > 0; i--) {
      const name = ["f", "g", "h"][functions.length];
      const params = ["p", "q"].slice(0, random(3));
      functions.push([name, params.length]);
      const kinds = params.map((p) => (chance(0.3) ? `${p} as ${pick(["a number", "text", "a list", "yes or no", "a record"])}` : p)); // what some inputs say they are
      lines.push(`to ${name}${params.length ? ` with ${kinds.join(", ")}` : ""}`);
      if (params.length && chance(0.6)) { // a way out, for recursion
        lines.push(`    if ${params[0]} is at most 0`, `        return ${atom(params)}`, "    end");
      }
      block(lines, 1, { params, functions, loop: false, inFunction: true }, 1 + random(4));
      if (chance(0.8)) lines.push(`    return ${expr(2, { params, functions })}`);
      lines.push("end");
    }
    block(lines, 0, { params: [], functions, loop: false, inFunction: false }, 3 + random(10));
    return lines.join("\n");
  }

  // some statements are wrapped in a `try`, so a program carries on past a mistake and gets further
  function block(lines, depth, ctx, count) {
    for (let i = 0; i < count; i++) {
      if (depth < 3 && chance(0.3)) {
        const pad = "    ".repeat(depth);
        lines.push(`${pad}try`);
        statement(lines, depth + 1, ctx);
        lines.push(`${pad}if it fails${chance(0.5) ? ` with ${pick(VARIABLES)}` : ""}`, `${pad}    say "caught"`, `${pad}end`);
      } else statement(lines, depth, ctx);
    }
  }

  function statement(lines, depth, ctx) {
    const pad = "    ".repeat(depth);
    const v = pick(VARIABLES);
    const e = (d = 2) => expr(d, ctx);
    const nested = depth < 3;
    const kinds = ["set", "set", "set", "say", "say", "add", "setItem", "setField", "remove", "expect", "write", "call", "fail", "chart"];
    if (nested) kinds.push("if", "if", "repeat", "each", "count", "try", "while");
    if (ctx.loop) kinds.push("stop");
    if (ctx.inFunction) kinds.push("return");
    switch (pick(kinds)) {
      case "set": return void lines.push(`${pad}set ${v} to ${e()}`);
      case "say": return void lines.push(`${pad}say ${e()}${chance(0.3) ? ` " " ${e(1)}` : ""}`);
      case "add": return void lines.push(`${pad}add ${e(1)} to ${v}`);
      case "setItem": return void lines.push(`${pad}set ${pick(["item", "byte"])} ${wrap(e(1))} of ${v} to ${e(1)}`);
      case "setField": return void lines.push(`${pad}set ${pick(FIELDS)} of ${v} to ${e(1)}`);
      case "remove": return void lines.push(`${pad}remove ${wrap(e(1))} from ${v}`);
      case "expect": return void lines.push(`${pad}expect ${chance(0.5) ? e() : `${wrap(e(1))} is ${wrap(e(1))}`}`);
      case "write": return void lines.push(`${pad}write ${e(1)} to ${pick(['"out.txt"', '"file.txt"', "t"])}`);
      case "chart": return void lines.push(`${pad}draw chart of ${chance(0.3) ? `${pick(FIELDS)} in ` : ""}${e()}`);
      case "fail": return void (chance(0.3) && lines.push(`${pad}fail with ${e(1)}`));
      case "stop": return void lines.push(`${pad}stop`);
      case "return": return void lines.push(`${pad}return ${e(1)}`);
      case "call": {
        if (!ctx.functions.length) return void lines.push(`${pad}say ${e()}`);
        const [name, inputs] = pick(ctx.functions);
        return void lines.push(`${pad}${name}(${Array.from({ length: inputs }, () => e(1)).join(", ")})`);
      }
      case "if":
        lines.push(`${pad}if ${e()}`);
        block(lines, depth + 1, ctx, 1 + random(3));
        if (chance(0.5)) {
          lines.push(`${pad}else${chance(0.3) ? ` if ${e()}` : ""}`);
          block(lines, depth + 1, ctx, 1 + random(2));
        }
        return void lines.push(`${pad}end`);
      case "repeat":
        lines.push(`${pad}repeat ${pick(["0", "1", "2", "3", e(1)])} times`);
        block(lines, depth + 1, { ...ctx, loop: true }, 1 + random(3));
        return void lines.push(`${pad}end`);
      case "each":
        lines.push(`${pad}for each ${v} in ${e()}${chance(0.3) ? ` where ${e()}` : ""}`);
        block(lines, depth + 1, { ...ctx, loop: true }, 1 + random(3));
        return void lines.push(`${pad}end`);
      case "count":
        lines.push(`${pad}for each ${v} from ${pick(["0", "1", "-2", e(1)])} to ${pick(["0", "3", "5", e(1)])}`);
        block(lines, depth + 1, { ...ctx, loop: true }, 1 + random(3));
        return void lines.push(`${pad}end`);
      case "while":
        lines.push(`${pad}repeat while ${e()}`);
        block(lines, depth + 1, { ...ctx, loop: true }, 1 + random(3));
        return void lines.push(`${pad}end`);
      case "try":
        lines.push(`${pad}try`);
        block(lines, depth + 1, ctx, 1 + random(3));
        lines.push(`${pad}if it fails${chance(0.6) ? ` with ${v}` : ""}`);
        block(lines, depth + 1, ctx, 1 + random(2));
        return void lines.push(`${pad}end`);
    }
  }

  const wrap = (text) => (/^[\w"]+$/.test(text) || /^-?\d/.test(text) && !/\s/.test(text) ? text : `(${text})`);

  function atom(params = []) {
    switch (random(9)) {
      case 0: case 1: return pick(NUMBERS);
      case 2: case 3: return pick(TEXTS);
      case 4: return pick(["yes", "no", "nothing"]);
      case 5: return params.length ? pick(params) : pick(VARIABLES);
      case 6: return pick(["empty list", "empty dictionary", "empty record", "arguments"]);
      default: return pick(VARIABLES);
    }
  }

  function expr(depth, ctx) {
    if (depth <= 0 || chance(0.25)) return atom(ctx.params);
    const e = () => wrap(expr(depth - 1, ctx));
    switch (random(28)) {
      case 0: return `${e()} ${pick(["+", "-", "*", "/"])} ${e()}`;
      case 1: return `list of ${e()}, ${e()}`;
      case 2: return `record with ${pick(FIELDS)} ${e()}, ${pick(FIELDS)} ${e()}`;
      case 3: return `dictionary where ${e()} is ${e()}, ${e()} is ${e()}`;
      case 4: return `${pick(["item", "byte"])} ${e()} of ${e()}`;
      case 5: return `length of ${e()}`;
      case 6: return `keys of ${e()}`;
      case 7: return `${pick(FIELDS)} of ${e()}`;
      case 8: return `${e()} is ${pick(["", "not ", "less than ", "at least ", "in ", "not in ", "divisible by "])}${e()}`;
      case 9: return `${e()} ${pick(["and", "or"])} ${e()}`;
      case 10: return `not ${e()}`;
      case 11: return `${pick(["uppercase", "lowercase", "number"])} of ${e()}`;
      case 12: return `split ${e()} by ${e()}`;
      case 13: return `join ${e()} with ${e()}`;
      case 14: return `position of ${e()} in ${e()}`;
      case 15: return `${e()} bit ${pick(["and", "or", "xor"])} ${e()}`;
      case 16: return `shift ${e()} ${pick(["left", "right"])} by ${e()}`;
      case 17: return `${e()} as ${pick(["text", "bytes", "hex", "binary"])}`;
      case 18: return `${pick(["0", "1", "3", e()])} bytes`;
      case 19: return `read ${pick(["", "bytes ", "table "])}${pick(['"file.txt"', '"data.bin"', '"data.csv"', '"missing.txt"', e()])}`;
      case 20: return `-${e()}`;
      case 21: {
        if (!ctx.functions.length) return atom(ctx.params);
        const [name, inputs] = pick(ctx.functions);
        return `${name}(${Array.from({ length: inputs }, () => expr(depth - 1, ctx)).join(", ")})`;
      }
      case 22: return `${pick(["1", "2.5", "0x10", "3", "0"])} ${pick(["km", "m", "miles", "feet", "hours", "minutes", "seconds", "kg", "g", "litres", "ml"])}`;
      case 23: return `${e()} in ${pick(["km", "m", "miles", "hours", "seconds", "g", "ml"])}`;
      case 24: return `${pick(["total", "average", "largest", "smallest"])} of ${e()}`;
      case 25: return `${pick(["total", "average", "largest", "smallest"])} of ${pick(FIELDS)} in ${e()}`;
      default: return atom(ctx.params);
    }
  }

  return Array.from({ length: count }, program);
}
