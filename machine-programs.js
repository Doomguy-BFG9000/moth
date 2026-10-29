// Random programs made only from the part of Moth that machine.moth turns into machine code: numbers
// chosen to be awkward (0.1, numbers 15 digits can't tell apart, 2^53, tiny and huge ones), yes, no and
// nothing where a number should be, every comparison, the loops, and functions that call each other. Most
// finish; some stop at a mistake on purpose. The seed is fixed, so a failure always reproduces.

const NUMBERS = ["0", "1", "2", "3", "7", "10", "0.1", "0.2", "0.3", "0.5", "2.5", "1.5", "0.7", "100", "255", "1000000",
  "0.000001", "0.0000001", "123456789012345", "9007199254740991", "9007199254740992", "0.1 * 3", "1 / 3", "2 / 3",
  "4.35", "1.005", "99999999999999.99", "0x10", "0b101", "3.141592653589793"];
const ODD = ["nothing", "yes", "no"];
const COMPARE = ["is", "is not", "is less than", "is greater than", "is at least", "is at most", "is divisible by"];

// Programs written by hand for what is easy to get wrong: how numbers show, 15-digit comparisons, every
// mistake the machine code can make, and long trails of calls.
export const MACHINE_CASES = [
  "say 0.1 + 0.2\nsay 1 / 3\nsay 2 / 3\nsay 0 - 1 / 3\nsay 100 / 7\nsay 1 / 1000000\nsay 1 / 10000000\nsay 15 / 100000000000\nsay 123456789012344.5\nsay 0 - 123456789012344.5\nsay 3.141592653589793\nsay 2.9999999999999996\nsay 0.000001\nsay 0.0000012345\nsay 1234.5678\nsay 99999999999999.99\nsay 999999999999999.9\nset big to 1\nrepeat 53 times\n    set big to big * 2\nend\nsay big\nsay big + 2\nsay big * 2\nsay big * 1024\nset p to 1\nrepeat 21 times\n    set p to p * 10\nend\nsay p\nsay p * 10\nsay p / 10\nset huge to 1\nrepeat 300 times\n    set huge to huge * 10\nend\nsay huge\nsay huge * 1000000000\nsay huge * huge\nsay 0 - huge * huge\nsay huge * huge - huge * huge\nset tiny to 1\nrepeat 1074 times\n    set tiny to tiny / 2\nend\nsay tiny\nsay tiny * 3\nset small to 1\nrepeat 300 times\n    set small to small / 10\nend\nsay small\nsay small * 7.5\nsay 0 - 0\nsay 0 * (0 - 1)\nset f to 1\nfor each i from 1 to 25\n    set f to f * i\n    say i \": \" f\nend\nsay 0.1 * 3\nsay 1.1 * 1.1\nsay 4.35 * 100\nsay 1.005 * 1000\nsay 0.07 * 100\nsay 1 / 3 * 3\nsay 9007199254740993\nsay 0x10 \" \" 0b101 \" \" 0xFF\nsay -5\nsay 5 - 7.25",
  "say 0.1 + 0.2 is 0.3\nsay 0.1 + 0.2 is less than 0.3\nsay 0.1 + 0.2 is at most 0.3\nsay 0.3 is at least 0.1 + 0.2\nsay 0.3 is greater than 0.1 + 0.2\nsay 0.3 is divisible by 0.1\nsay 0.35 is divisible by 0.1\nsay 10 is divisible by 3\nsay 12 is divisible by 4\nsay -12 is divisible by 4\nsay 1 / 3 is 0.333333333333333\nsay 1 / 3 is 0.3333333333333333\nsay 2 / 3 is 0.666666666666667\nsay 1 is 1.00000000000001\nsay 1 is 1.000000000000001\nsay 1000000000000000 is 1000000000000001\nsay 9007199254740993 is 9007199254740992\nsay 5 is not 6\nsay nothing is nothing\nsay yes is yes\nsay yes is no\nsay nothing is 0\nsay 3 is nothing\nsay not yes\nsay not nothing\nsay not 0\nsay yes and 5\nsay no and 5\nsay nothing or 7\nsay 3 or 4\nsay (1 is 1) and (2 is 3)\nset big to 1\nrepeat 60 times\n    set big to big * 2\nend\nsay big is divisible by 3\nsay big is divisible by 1024\nsay big + 1 is big\nsay 7.5 is divisible by 2.5\nsay 7.5 is divisible by 0.5\nfor each i from 0.1 * 10 to 0.1 * 30\n    say i\nend\nset n to 0\nrepeat 0.1 * 30 times\n    add 1 to n\nend\nsay n\nrepeat 0 times\n    say \"never\"\nend\nfor each j from 5 to 3\n    say \"never\"\nend\nfor each j from 1 to 2.5\n    say j\nend\nset k to 0\nrepeat while k is less than 5\n    add 1 to k\n    if k is 3\n        stop\n    end\nend\nsay k\nif 0\n    say \"0 counts as true\"\nend\nif nothing\n    say \"never\"\nelse if no\n    say \"never\"\nelse\n    say \"both false\"\nend",
  "to fib with n\n    if n is less than 2\n        return n\n    end\n    return fib(n - 1) + fib(n - 2)\nend\nsay fib(20)\nset total to 0\nto bump with by\n    add by to total\nend\nbump(5)\nbump 2\nsay total\nto nothing_back\n    set x to 1\nend\nsay nothing_back()\nto early with n\n    for each i from 1 to 10\n        if i is n\n            return i * 100\n        end\n    end\n    return\nend\nsay early(3) \" \" early(20)\nto area with width as a number, height as a number\n    return width * height\nend\nsay area(3, 4)\nto flag with ok as yes or no\n    if ok\n        return 1 is 1\n    end\n    return no\nend\nsay flag(yes) \" \" flag(no)\nto sum with n\n    if n is 0\n        return 0\n    end\n    return n + sum(n - 1)\nend\nsay sum(10000)\nto two with a, b\n    return a - b\nend\nsay two(10, 3)\nsay two(two(10, 3), two(1, 2))",
  "set a to 1\nif a is 2\n    set b to 5\nend\nsay a + b",
  "to f\n    set x to 1\nend\nsay f() + 1",
  "to half with n\n    return n / (n - n)\nend\nto outer with n\n    return half(n) + 1\nend\nsay outer(4)",
  "set count to 0\nto f with n\n    add 1 to count\n    return f(n + 1)\nend\nsay f(1)",
  "to ping with n\n    return pong(n + 1)\nend\nto pong with n\n    return ping(n + 1)\nend\nsay ping(1)",
  "to two with a, b\n    return a + b\nend\nsay \"start\"\nsay two(1)",
  "to area with width as a number, height as a number\n    return width * height\nend\nsay area(2, 3)\nsay area(2, yes)",
  "to flag with ok as yes or no\n    return ok\nend\nsay flag(no)\nsay flag(1)",
  "to shout with words as text\n    return 1\nend\nshout(5)",
  "set total to 5\nsay totl",
  "say helper(2)\nto helper with x\n    return x\nend",
  "to helper with x\n    return x\nend\nsay helpr(2)",
  "repeat 2.5 times\n    say \"x\"\nend",
  "to f\n    return\nend\nrepeat f() times\n    say \"x\"\nend",
  "for each i from 1 to yes\n    say i\nend",
  "say -(1 is 1)",
  "say 3 is less than nothing",
  "say 10 is divisible by 0",
  "set x to nothing\nadd 1 to x",
  "set x to 1\nadd yes to x",
  "add 1 to y",
  "to a1 with n\n    return a2(n)\nend\nto a2 with n\n    return a3(n)\nend\nto a3 with n\n    return a4(n)\nend\nto a4 with n\n    return a5(n)\nend\nto a5 with n\n    return a6(n)\nend\nto a6 with n\n    return a7(n)\nend\nto a7 with n\n    return a8(n)\nend\nto a8 with n\n    return a9(n)\nend\nto a9 with n\n    return b1(n)\nend\nto b1 with n\n    return b2(n)\nend\nto b2 with n\n    return b3(n)\nend\nto b3 with n\n    return n / 0\nend\nsay a1(5)",
  "say \"before\"\nsay \"a \" 1 \" b \" c",
  "to f\n\tsay 1 + nothing\nend\nf()",
];

export function machinePrograms(seed, count) {
  let state = seed;
  const random = (n) => {
    state = (state * 1103515245 + 12345) % 2 ** 31;
    return Math.floor((state / 2 ** 31) * n);
  };
  const pick = (list) => list[random(list.length)];
  const chance = (p) => random(1000) < p * 1000;

  function program() {
    const vars = ["a", "b", "c"];
    const fns = [];
    const lines = [];
    const number = () => (chance(0.01) ? pick(ODD) : pick(NUMBERS));
    function value(depth, names) {
      const r = random(10);
      if (depth > 2 || r < 3) return chance(0.5) && names.length ? pick(names) : number();
      if (r < 6) return `(${value(depth + 1, names)} ${pick(["+", "-", "*", "/"])} ${value(depth + 1, names)})`;
      if (r < 7) return `-${value(depth + 1, names)}`;
      if (r < 8 && fns.length) {
        const [f, n] = pick(fns);
        return `${f}(${Array.from({ length: chance(0.05) ? n + 1 : n }, () => value(depth + 1, names)).join(", ")})`;
      }
      if (r < 9 && chance(0.3)) return `(${test(depth + 1, names)})`;
      if (r < 9) return names.length ? pick(names) : number();
      return `(${value(depth + 1, names)} ${pick(["and", "or"])} ${value(depth + 1, names)})`;
    }
    function test(depth, names) {
      if (chance(0.15)) return `not ${test(depth + 1, names)}`;
      if (chance(0.15) && depth < 3) return `${test(depth + 1, names)} ${pick(["and", "or"])} ${test(depth + 1, names)}`;
      return `${value(depth + 1, names)} ${pick(COMPARE)} ${value(depth + 1, names)}`;
    }
    function block(indent, names, depth, inLoop, inFn) {
      const out = [];
      for (let k = 1 + random(3); k > 0; k--) {
        const pad = "    ".repeat(indent);
        const r = random(12);
        if (r < 3) out.push(`${pad}say ${chance(0.4) ? '"v: " ' : ""}${value(0, names)}${chance(0.3) ? ` " " ${value(0, names)}` : ""}`);
        else if (r < 5) out.push(`${pad}set ${pick(names.length ? names : vars)} to ${value(0, names)}`);
        else if (r < 6) out.push(`${pad}add ${value(1, names)} to ${pick(names.length ? names : vars)}`);
        else if (r < 7 && depth < 2) {
          out.push(`${pad}if ${test(0, names)}`, ...block(indent + 1, names, depth + 1, inLoop, inFn));
          if (chance(0.5)) out.push(`${pad}else`, ...block(indent + 1, names, depth + 1, inLoop, inFn));
          out.push(`${pad}end`);
        } else if (r < 8 && depth < 2) {
          out.push(`${pad}repeat ${pick(["2", "3", "0.1 * 30", "0", "1.5", "2.9999999999999996", "nothing", pick(names.length ? names : ["2"])])} times`,
            ...block(indent + 1, names, depth + 1, true, inFn), `${pad}end`);
        } else if (r < 9 && depth < 2) {
          const v = pick(["i", "j", ...names]);
          out.push(`${pad}for each ${v} from ${pick(["1", "0.1 * 10", "0", "2.5", "-1"])} to ${pick(["3", "0.1 * 30", "2", "0", "yes"])}`,
            ...block(indent + 1, [...new Set([...names, v])], depth + 1, true, inFn), `${pad}end`);
        } else if (r < 10 && inLoop) out.push(`${pad}if ${test(0, names)}`, `${pad}    stop`, `${pad}end`);
        else if (r < 11 && inFn) out.push(`${pad}return ${chance(0.2) ? "" : value(0, names)}`.trimEnd());
        else if (fns.length) {
          const [f, n] = pick(fns);
          out.push(`${pad}${f}(${Array.from({ length: n }, () => value(1, names)).join(", ")})`);
        } else out.push(`${pad}say ${value(0, names)}`);
      }
      return out;
    }
    for (const v of vars) if (chance(0.97)) lines.push(`set ${v} to ${pick(NUMBERS)}`);
    for (let i = random(3); i > 0; i--) {
      const name = ["f", "g", "h"][fns.length];
      const params = ["p", "q"].slice(0, random(3));
      const kinds = params.map((p) => (chance(0.2) ? `${p} as ${pick(["a number", "yes or no", "text"])}` : p));
      lines.push(`to ${name}${params.length ? ` with ${kinds.join(", ")}` : ""}`);
      fns.push([name, params.length]);
      // a function may call itself, but only so deep: its first input counts down
      if (params.length && chance(0.3)) lines.push(`    if ${params[0]} is greater than 3`, `        return ${name}(${[`${params[0]} - 1`, ...params.slice(1)].join(", ")})`, "    end");
      lines.push(...block(1, [...params, ...vars.slice(0, random(2))], 0, false, true), "end");
    }
    lines.push(...block(0, vars, 0, false, false));
    return lines.join("\n");
  }
  return Array.from({ length: count }, program);
}
