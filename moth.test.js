import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { run, debug, timeline, check, compile, compileToJs, compileToWasm, load, mothCompiler, excerpt, MothError } from "./moth.js";
import { Machine } from "./vm.js";
import examples from "./examples.js";

const ENGINES = ["jit", "wasm", "vm"];

function output(source, options) {
  const lines = [];
  run(source, (line) => lines.push(line), options);
  return lines.join("\n");
}

function error(source, options) {
  try {
    output(source, options);
  } catch (err) {
    if (err instanceof MothError) return err;
    throw err;
  }
  assert.fail("expected the program to fail");
}

const EXAMPLES = {
  "Spiral": "", // the drawing examples only draw; see the next test
  "Tree": "",
  "Hello": "Hello, world!\nMy name is Moth and it has 4 letters.",
  "Repeat": "*\n**\n***\n****\n*****",
  "FizzBuzz": "1\n2\nFizz\n4\nBuzz\nFizz\n7\n8\nFizz\nBuzz\n11\nFizz\n13\n14\nFizzBuzz",
  "Lists": "I like apple\nI like banana\nI like cherry\nI like mango\nThat's 4 fruits, and the first is apple",
  "Functions": "Hello, Sam!\nfib(20) is 6765",
  "Counter": "Ticked 3 times",
  "Records": 'Sam is 20\nAna is 31\n(record with name "Sam", age 21)',
  "Primes": "Primes up to 50: [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47]",
};

test("every playground example runs, on all three engines", () => {
  for (const engine of ENGINES) {
    for (const [name, source] of Object.entries(examples)) {
      if (name === "Errors") assert.equal(error(source, { engine }).message, "line 3: there is no item 5, the list only has 2 items");
      else assert.equal(output(source, { engine }), EXAMPLES[name], `${engine}: ${name}`);
    }
  }
});

const PROGRAMS = [
  // a `set` inside a function changes a variable the top level also sets
  ["set total to 0\nto bump\n    add 5 to total\nend\nbump\nbump\nsay total", "10"],
  // this is decided when the program is read, so it holds even before the top level's own `set` runs
  ["to f\n    set x to 1\nend\nf\nsay x\nset x to 2", "1"],
  // ...but a variable only the function sets stays inside it, so every call starts fresh
  ["to f\n    set count to 0\n    add 1 to count\n    return count\nend\nsay f() f()", "11"],
  // inputs and functions made with `to` always belong to their own function
  ["set n to 1\nto f with n\n    set n to 5\nend\nf(2)\nsay n", "1"],
  ['to helper\n    say "global"\nend\nto f\n    to helper\n        say "inner"\n    end\n    helper\nend\nf\nhelper', "inner\nglobal"],
  ["to sum with n\n    if n is 0\n        return 0\n    end\n    return n + sum(n - 1)\nend\nsay sum(10000)", "50005000"],
  ["to find with xs\n    for each x in xs\n        if x is greater than 1\n            return x\n        end\n    end\nend\nsay find(list of 1, 2, 3) find(list of 0)", "2nothing"],
  ["if yes\n    set x to 1\nend\nsay x", "1"],
  ['to boom\n    return 1 / 0\nend\nsay (no and boom()) " " (yes or boom())', "no yes"],
  ['say (3 is less than 5) " " (5 is at least 5) " " (4 is not divisible by 2) " " ("apple" is less than "banana")', "yes yes no yes"],
  ['say (list of 1, 2) is (list of 1, 2) " " (list of "a", nothing, yes)', 'yes ["a", nothing, yes]'],
  ['say length of "héllo😀" " " item 6 of "héllo😀"', "6 😀"],
  ['say "tab\\there \\"quoted\\""', 'tab\there "quoted"'],
  ["set xs to list of 1, 2\nset item 1 of xs to 9\nsay xs", "[9, 2]"],
  ['set s to "a"\nadd 1 to s\nsay s', "a1"],
  ["set total to 1 +\n    2\nsay total", "3"],
  ['SAY "hi"\nSet X to 1\nsay x', "hi\n1"],
  ["to area with width and height\n    return width * height\nend\nsay area(3, 4)", "12"],
  ['to pair with a, b\n    say a " & " b\nend\npair "x", "y"\npair("p", "q")', "x & y\np & q"],
  ["to f\n    return\nend\nsay f()", "nothing"],
  ['repeat 0 times\n    say "never"\nend\nfor each n from 3 to 1\n    say "never"\nend\nsay "done"', "done"],
  ['say 2 + 3 * 4 " " (-(2 + 3)) " " (not 1 is 2)', "14 -5 yes"],
  ["set n to 0\nrepeat while n is less than 3\n    add 1 to n\nend\nsay n", "3"],
  // records
  ['set p to record with name "Sam", age 20\nset age of p to 21\nsay name of p " " age of p', "Sam 21"],
  ['set a to record with x 1, inner record with y 2\nsay y of inner of a " " (a is record with x 1, inner record with y 2)', "2 yes"],
  ['set r to empty record\nset colour of r to "red"\nsay r " " (r is empty record)', '(record with colour "red") no'],
  ["set r to record with n 2\nset xs to list of 10, 20\nsay item (n of r) of xs \" \" item 1 of xs", "20 10"], // `n of r` needs brackets inside `item ... of`
  // numbers: leading zeros are fine, and one too big for JavaScript is Infinity on both engines
  ["say 007 + 00.5 \" \" 2.50", "7.5 2.5"],
  [`say 1${"0".repeat(400)}`, "Infinity"],
  // divisible by: fractions, negatives, and numbers past 2^52, where the WebAssembly engine leaves it to JavaScript
  ["say (7.5 is divisible by 2.5) \" \" (0 - 4 is divisible by 2) \" \" (9007199254740992 is divisible by 3) \" \" (10 is divisible by 4)", "yes yes no no"],
  // variables that only ever hold numbers (unboxed by the WebAssembly engine)
  ['set n to 1\nsay n\nadd 2 to n\nsay n " " (n * 2) " " (n is 3) " " (n / 4)', "1\n3 6 yes 0.75"],
  ['set total to 0\nfor each i from 1 to 5\n    add i to total\nend\nsay total " " i', "15 5"],
  ['set x to 10\nset y to x - 3\nset x to y * 2\nsay x " " y " " (x is divisible by 7) " " (0 - x)', "14 7 yes -14"],
  ["set a to 0 / 1\nset b to 1\nrepeat 3 times\n    set b to b * 2 + a\nend\nsay b", "8"],
  // every control character is a space, and a comment runs to the end of the line
  ["say 1\v+\f2\r\n# a comment say 3\nsay 4", "3\n4"],
];

test("programs print what they should, on all three engines", () => {
  for (const engine of ENGINES) for (const [source, expected] of PROGRAMS) assert.equal(output(source, { engine }), expected, `${engine}: ${source}`);
});

const ERRORS = [
  ["\n\nsay totl", "line 3: 'totl' has no value yet (give it one with 'set totl to ...')"],
  ["to f\n    set secret to 1\nend\nf\nsay secret", "line 5: 'secret' has no value yet (give it one with 'set secret to ...')"],
  ["say x\nset x to 1", "line 1: 'x' has no value yet (give it one with 'set x to ...')"],
  // misspellings get the closest name that exists, including Moth's own words at the start of a line
  ["set total to 1\nsay totl", "line 2: 'totl' has no value yet. Did you mean 'total'?"],
  ["set total to 1\nadd 2 to totla", "line 2: 'totla' has no value yet. Did you mean 'total'?"],
  ["to greet with who\nend\ngreeet 1", "line 3: there is no function called 'greeet'. Did you mean 'greet'?"],
  ['sya "hi"', "line 1: there is no function called 'sya'. Did you mean 'say'?"],
  ["to fib with n\n    if n is less than 2\n        return n\n    end\n    return fib(n - 1) + fbi(n - 2)\nend\nsay fib(3)", "line 5: there is no function called 'fbi'. Did you mean 'fib'?"],
  ["set cat to 1\nsay dog", "line 2: 'dog' has no value yet (give it one with 'set dog to ...')"],
  ["x is 5", "line 1: to give 'x' a value write 'set x to ...'"],
  ["x = 5", "line 1: I don't understand '=' (to store a value write 'set x to 5', to compare write 'x is 5')"],
  ["if x > 5\nend", "line 1: I don't understand '>' (write 'is greater than')"],
  ["say 1 + yes", "line 1: can't use '+' on a number and yes/no"],
  ['say -"a"', "line 1: '-' needs a number, not text"],
  ['say "abc" * 2', "line 1: can't use '*' on text and a number"],
  ["say 1 / 0", "line 1: can't divide by zero"],
  ['say "a" is less than 5', "line 1: can't check if text is less than a number"],
  ['say item 0 of "abc"', "line 1: there is no item 0, items are counted from 1"],
  ['say item 4 of "abc"', "line 1: there is no item 4, the text only has 3 letters"],
  ['set s to "ab"\nset item 1 of s to "x"', "line 2: can only change items of a list, not text"],
  ["set n to 5\nadd list of 1 to n", "line 2: can't add a list to a number"],
  ["to f with a\nend\nf", "line 3: 'f' needs 1 input but got 0"],
  ['greet "x"', "line 1: there is no function called 'greet'"],
  ["constructor 1", "line 1: there is no function called 'constructor'"], // a name JavaScript objects already have
  ["set n to 5\nn", "line 2: 'n' is a number, not a function"],
  ["for each x in 5\nend", "line 1: can only go through a list or text, not a number"],
  ['repeat "a" times\nend', 'line 1: repeat needs a whole number of times, not "a"'],
  ['say "hi', "line 1: this text is missing its closing quote"],
  ['if yes\n    say "hi"', "line 2: 'if' from line 1 is missing its 'end'"],
  ["set list to 5", "line 1: 'list' is a Moth word, so it can't be used as a variable name"],
  ["set x to 5 6", "line 1: expected a new line but found '6'"],
  ['if yes say "hi"\nend', "line 1: expected a new line but found 'say'"],
  ["end", "line 1: a line can't start with 'end'"],
  ["return 1", "line 1: 'return' only works inside a function (one made with 'to')"],
  ["to down with n\n    return down(n + 1)\nend\nsay down(0)", "line 2: too much recursion: a function kept calling itself"],
  ['set s to "ab"\nrepeat while yes\n    add s to s\nend', "line 3: a value got too big to fit in memory"],
  ['move forward "a"', "line 1: 'move forward' needs a number, not text"],
  ["turn left yes", "line 1: 'turn left' needs a number, not yes/no"],
  ["pen color 5", "line 1: 'pen color' needs text like \"red\", not a number"],
  ["pen width 0", "line 1: 'pen width' needs a number above 0, not 0"],
  ["move sideways 5", "line 1: expected 'forward' or 'back' but found 'sideways'"],
  ["set pen to 1", "line 1: 'pen' is a Moth word, so it can't be used as a variable name"],
  ['set p to record with name "Sam"\nsay nmae of p', "line 2: this record has no 'nmae'. Did you mean 'name'?"],
  ["say name of 5", "line 1: can't take 'name' of a number"],
  ['set s to "x"\nset name of s to 1', "line 2: can only change 'name' of a record, not text"],
  ["set x to empty thing", "line 1: expected 'list' or 'record' but found 'thing'"],
  ["say person.name", "line 1: I don't understand '.' (to get a field write 'name of person')"],
  ['say "before"\nfail with "your own message"', "line 2: your own message"],
  ["set x to 5 007", "line 1: expected a new line but found '007'"], // numbers are shown as written
  // variables that only ever hold numbers keep every mistake
  ['set n to 1\nadd "x" to n', "line 2: can't add text to a number"],
  ["say n + 1\nset n to 5", "line 1: 'n' has no value yet (give it one with 'set n to ...')"],
  ["add 1 to n\nset n to 0", "line 1: 'n' has no value yet (give it one with 'set n to ...')"],
  ["set n to 4\nset m to 0\nsay n / m", "line 3: can't divide by zero"],
  ["set n to 3\nsay n is divisible by 0", "line 2: can't divide by zero"],
  ['say "a\u0001b"', "line 1: this text is missing its closing quote"], // text can't hold control characters but tab
  ["say 1 😀", "line 1: I don't understand '😀'"],
];

test("mistakes give a clear message, on all three engines", () => {
  for (const engine of ENGINES) for (const [source, message] of ERRORS) assert.equal(error(source, { engine }).message, message, `${engine}: ${source}`);
});

test("errors point at the exact spot", () => {
  const source = "if yes\n    say 1 / 0\nend";
  assert.equal(excerpt(source, error(source)), "    say 1 / 0\n          ^");
  const example = examples["Errors"];
  assert.equal(excerpt(example, error(example)), "say item 5 of fruits\n    ^");
});

test("maxSteps stops a loop that never ends", () => {
  assert.equal(error("repeat while yes\nend", { maxSteps: 1000 }).message, "line 1: stopped after 1,000 steps (is there a loop that never ends?)");
});

test("the drawing examples draw", () => {
  for (const [name, count] of [["Spiral", 150], ["Tree", 511]]) {
    let drawn = 0;
    run(examples[name], () => {}, { draw: () => drawn++ });
    assert.equal(drawn, count, name);
  }
});

test("the turtle draws where it moves with its pen down", () => {
  const lines = [];
  run('repeat 4 times\n    move forward 10\n    turn right 90\nend\npen up\nmove back 5\npen down\npen color "red"\npen width 3\nmove forward 1', () => {}, {
    draw: (line) => lines.push(line),
  });
  const blue = { color: "#4f8ff7", width: 2 };
  assert.deepEqual(lines, [
    { x1: 0, y1: 0, x2: 0, y2: 10, ...blue }, // starts in the middle, facing up
    { x1: 0, y1: 10, x2: 10, y2: 10, ...blue },
    { x1: 10, y1: 10, x2: 10, y2: 0, ...blue },
    { x1: 10, y1: 0, x2: 0, y2: 0, ...blue },
    { x1: 0, y1: -5, x2: 0, y2: -4, color: "red", width: 3 }, // pen up moved it without drawing
  ]);
});

test("output said before a mistake is kept", () => {
  const lines = [];
  assert.throws(() => run('say "first"\nsay nope', (line) => lines.push(line)), MothError);
  assert.deepEqual(lines, ["first"]);
});

// The debugger: a debug build pauses before each statement, and on a loop's line before each round.
function pauses(source) {
  const lines = [];
  const machine = debug(source, () => {});
  while (machine.run({ pauseAtLines: true }) === "line") lines.push(machine.line);
  return lines;
}

test("the debugger pauses at each statement and each loop round", () => {
  assert.deepEqual(pauses("set x to 1\nrepeat 2 times\n    add 1 to x\nend\nsay x"), [1, 2, 3, 2, 3, 5]);
  assert.deepEqual(pauses("for each n from 1 to 2\n    say n\nend"), [1, 2, 1, 2]);
  assert.deepEqual(pauses("set n to 0\nrepeat while n is less than 2\n    add 1 to n\nend"), [1, 2, 3, 2, 3, 2]);
  assert.deepEqual(pauses("if no\n    say 1\nelse if yes\n    say 2\nend"), [1, 3, 4]);
});

test("the debugger shows the calls in progress and the variables they can see", () => {
  const machine = debug("set x to 10\nto double with n\n    set y to n * 2\n    return y\nend\nsay double(x)", () => {});
  while (machine.run({ pauseAtLines: true }) === "line" && machine.line !== 4);
  assert.deepEqual(machine.inspect(), {
    line: 4,
    calls: ["main", "double"],
    scopes: [
      { name: "double", vars: [["n", "10"], ["y", "20"]] },
      { name: "main", vars: [["double", "<function double>"], ["x", "10"]] },
    ],
  });
});

test("the debugger shows the variables a closure remembers", () => {
  const machine = debug(examples["Counter"], () => {});
  while (machine.run({ pauseAtLines: true }) === "line" && machine.line !== 6);
  assert.deepEqual(machine.inspect().scopes.map(({ name, vars }) => [name, vars]), [
    ["next", []],
    ["counter", [["next", "<function next>"], ["count", "1"]]],
    ["main", [["counter", "<function counter>"], ["tick", "<function next>"]]],
  ]);
});

test("a debug build prints exactly what a normal run prints", () => {
  for (const [name, source] of Object.entries(examples)) {
    if (name === "Errors") continue;
    const lines = [];
    const machine = debug(source, (line) => lines.push(line));
    while (machine.run({ pauseAtLines: true }) !== "done");
    assert.equal(lines.join("\n"), EXAMPLES[name], name);
  }
});

// Time travel: timeline() records every step, so a debugger can go backwards as well as forwards.
test("a timeline records each step with the variables, output and drawing so far", () => {
  const { steps, said, drawn, cut } = timeline("set x to 1\nrepeat 2 times\n    add 1 to x\n    say x\n    move forward x\nend");
  const x = (step) => step.scopes.at(-1).vars.find(([name]) => name === "x")?.[1];
  assert.deepEqual(
    steps.map((s) => [s.done ? "done" : s.line, x(s), s.said, s.drawn]),
    [[1, undefined, 0, 0], [2, "1", 0, 0], [3, "1", 0, 0], [4, "2", 0, 0], [5, "2", 1, 0], [2, "2", 1, 1], [3, "2", 1, 1], [4, "3", 1, 1], [5, "3", 2, 1], ["done", "3", 2, 2]],
  );
  assert.deepEqual(said, ["2", "3"]);
  assert.equal(drawn.length, 2);
  assert.equal(cut, false);
});

test("a timeline ends with the mistake, or is cut short if the program never ends", () => {
  const failed = timeline('say "hi"\nsay item 2 of "a"');
  assert.equal(failed.steps.at(-1).error.message, "line 2: there is no item 2, the text only has 1 letter");
  assert.equal(failed.steps.at(-1).said, 1);
  const forever = timeline("repeat while yes\nend", { limit: 50 });
  assert.equal(forever.steps.length, 50);
  assert.equal(forever.cut, true);
});

test("when JavaScript's stack runs out, the JIT hands over to the VM without repeating anything", () => {
  const said = [];
  let drawn = 0;
  const source = 'say "start"\nmove forward 10\nto sum with n\n    if n is 0\n        return 0\n    end\n    return n + sum(n - 1)\nend\nsay sum(20000)';
  run(source, (line) => said.push(line), { draw: () => drawn++ }); // 20,000 calls deep is past JavaScript's stack
  assert.deepEqual(said, ["start", "200010000"]);
  assert.equal(drawn, 1);
});

// The checker: problems found without running.
const problems = (source) => check(source).map(({ line, col, kind, message }) => `${line}:${col} ${kind}: ${message}`);

test("the checker finds mistakes without running the program", () => {
  const source = [
    'set name to "Moth"',
    "say name * 2", // 2
    "to double with n",
    "    return n * 2",
    '    say "never"', // 5
    "end",
    "say double(1, 2)", // 7
    "set spare to 5", // 8
    "say totl", // 9
    "set total to 0",
    "sya total", // 11
    'add "x" to total', // 12
    "set count to 5",
    "count", // 14
    'repeat "x" times', // 15
    "end",
    "say item 0 of list of 1", // 17
    "say length of 5", // 18
    "for each c in 7", // 19
    "end",
    'move forward "far"', // 21
    "say 1 / 0", // 22
    'say no and ("a" * 2)', // the right side of `and` might not run, so nothing is certain there
  ].join("\n");
  assert.deepEqual(problems(source), [
    "2:10 fails: can't use '*' on text and a number",
    "5:5 never runs: this line can never run, because 'return' comes first",
    "7:5 fails: 'double' needs 1 input but got 2",
    "8:1 unused: 'spare' is set but never used",
    "9:5 fails: 'totl' has no value yet. Did you mean 'total'?",
    "11:1 fails: there is no function called 'sya'. Did you mean 'say'?",
    "12:1 fails: can't add text to a number",
    "14:1 fails: 'count' is a number, not a function",
    '15:1 fails: repeat needs a whole number of times, not "x"',
    "17:5 fails: there is no item 0, items are counted from 1",
    "18:5 fails: 'length of' needs a list or text, not a number",
    "19:1 fails: can only go through a list or text, not a number",
    "21:1 fails: 'move forward' needs a number, not text",
    "22:7 fails: can't divide by zero",
  ]);
  assert.deepEqual(problems("say (1"), ["1:7 error: expected ')' but found the end of the code"]);
  assert.deepEqual(problems('set n to 5\nsay name of n\nfail with "stop"\nsay "after"'), [
    "2:5 fails: can't take 'name' of a number",
    "4:1 never runs: this line can never run, because 'fail' comes first",
  ]);
});

test("load() hands JavaScript what a program made, and fail with's value", () => {
  const made = load('to greet with who\n    return "Hello, " + who\nend\nset version to 3\nto check with n\n    fail with record with problem "bad", value n\nend');
  assert.equal(made.greet("JavaScript"), "Hello, JavaScript");
  assert.equal(made.version, 3);
  assert.equal(load("set __proto__ to 5").__proto__, 5);
  // a call that fails deep inside leaves nothing behind: the next call starts from the bottom again
  const { outer } = load("to outer with n\n    return inner(n)\nend\nto inner with n\n    fail with n\nend");
  for (let i = 0; i < 2500; i++) assert.throws(() => outer(i), MothError);
  assert.throws(() => made.check(7), (err) => err instanceof MothError && err.value.problem === "bad" && err.value.value === 7);
});

// A "fails" warning on a line that never runs is still true (like `return 1 / 0` in a function nobody
// calls), so the rule for working programs is: no warned line actually runs.
test("the checker raises no false alarms on working programs", () => {
  for (const source of [...Object.values(examples), ...PROGRAMS.map(([source]) => source)]) {
    const { lines } = trace(source);
    for (const p of check(source)) if (p.kind !== "unused") assert.ok(!lines.has(p.line), `${p.line}: ${p.message} in:\n${source}`);
  }
});

// The lines a program really runs (its LINE markers), and the mistake it stops at, if any.
function trace(source) {
  const lines = new Set();
  const machine = new Machine(compile(source, { debug: true }), () => {}, { maxSteps: 10_000 });
  try {
    while (machine.run({ pauseAtLines: true }) === "line") lines.add(machine.line);
  } catch (err) {
    if (!(err instanceof MothError)) throw err;
    return { lines, error: err };
  }
  return { lines };
}

// Checking the checker against what really happens, on thousands of randomly broken programs: a line
// it says will fail never runs in a program that finishes; when a program does fail where it said, it
// said the same words; and a line it says never runs, never does. One known gap: the checker doesn't
// follow the order code runs in, so a name used before it's set fails with "no value yet" instead.
test("the checker's claims hold on randomly broken programs", () => {
  let seed = 7;
  const random = (n) => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return Math.floor((seed / 2 ** 31) * n);
  };
  const pick = (list) => list[random(list.length)];
  const sources = [...Object.values(examples), ...PROGRAMS.map(([source]) => source), ...ERRORS.map(([source]) => source)];
  const mutations = [
    (s) => { const i = random(s.length); return s.slice(0, i) + s.slice(i + 1); },
    (s) => { const lines = s.split("\n"); lines.splice(random(lines.length), 0, pick(lines)); return lines.join("\n"); },
    (s) => { const words = s.match(/\w+|\S/g); return s.replace(pick(words), pick(words)); },
  ];
  let predicted = 0;
  for (let i = 0; i < 3000; i++) {
    let source = pick(sources);
    for (let n = random(4); n > 0; n--) source = pick(mutations)(source);
    const found = check(source);
    if (found.some((p) => p.kind === "error")) continue; // doesn't compile, so nothing ran
    const { lines, error } = trace(source);
    for (const p of found) {
      if (p.kind === "never runs") assert.ok(!lines.has(p.line), `line ${p.line} ran:\n${source}`);
      if (p.kind !== "fails") continue;
      if (error && error.line === p.line && error.col === p.col) {
        if (error.reason !== p.message) assert.match(error.reason, /has no value yet|there is no function called/, source);
        predicted++;
      }
      if (!error) assert.ok(!lines.has(p.line), `said line ${p.line} fails, but it ran fine:\n${source}`);
    }
  }
  assert.ok(predicted > 100, `only ${predicted} runtime errors were predicted`); // the checker isn't silent either
});

// Everything one engine does with a program: what it said and drew, and the mistake it stopped at.
function outcome(source, engine) {
  const said = [];
  const drawn = [];
  try {
    run(source, (line) => said.push(line), { engine, maxSteps: 10_000, draw: (line) => drawn.push(line) });
    return { said, drawn };
  } catch (err) {
    if (!(err instanceof MothError)) assert.fail(`the ${engine} crashed with ${err.stack}\non this program:\n${source}`);
    assert.ok(err.line >= 1 && err.line <= source.split("\n").length && err.col >= 1, `bad position ${err.line}:${err.col} in:\n${source}`);
    return { said, drawn, error: [err.message, err.col] };
  }
}

// The examples and the tables above, each broken by up to three random edits. The seed is fixed, so a
// failure always reproduces.
function brokenPrograms(seed, count) {
  const random = (n) => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return Math.floor((seed / 2 ** 31) * n);
  };
  const pick = (list) => list[random(list.length)];
  const sources = [...Object.values(examples), ...PROGRAMS.map(([source]) => source), ...ERRORS.map(([source]) => source)];
  const mutations = [
    (s) => { const i = random(s.length); return s.slice(0, i) + s.slice(i + 1); }, // delete a character
    (s) => { const i = random(s.length); return s.slice(0, i) + s[random(s.length)] + s.slice(i); }, // copy one in
    (s) => { const lines = s.split("\n"); lines.splice(random(lines.length), 0, pick(lines)); return lines.join("\n"); }, // repeat a line
    (s) => { const words = s.match(/\w+|\S/g); return s.replace(pick(words), pick(words)); }, // swap a word for another
  ];
  const programs = [];
  for (let i = 0; i < count; i++) {
    let source = pick(sources);
    for (let n = random(4); n > 0; n--) source = pick(mutations)(source);
    programs.push(source);
  }
  return programs;
}

// Fuzzing: thousands of randomly broken programs must only ever fail with a MothError that points inside
// the code, never with a JavaScript crash, and the JIT and the WebAssembly engine must do exactly what the
// VM does with every one of them: same output, same drawing, same mistake at the same spot.
test("randomly broken programs fail cleanly, and all three engines agree on every one", () => {
  for (const source of brokenPrograms(42, 5000)) {
    const vm = outcome(source, "vm");
    assert.deepEqual(outcome(source, "jit"), vm, source);
    assert.deepEqual(outcome(source, "wasm"), vm, `wasm: ${source}`);
  }
});

// ---------- the compiler written in Moth ----------

const COMPILER = readFileSync(new URL("./compiler.moth", import.meta.url), "utf8");

// What a compiler makes of a program: its JavaScript and the spot each position in it points at, or the
// mistake it stops at.
function compiled(compiler, source) {
  try {
    const { source: js, ats } = compiler(source);
    return { js, ats: ats.map(({ line, col }) => [line, col]) };
  } catch (err) {
    if (!(err instanceof MothError)) throw err;
    return { error: [err.message, err.col, err.incomplete] };
  }
}

test("the compiler written in Moth writes the JIT's JavaScript, byte for byte, and stops at the same mistakes", () => {
  const moth = mothCompiler(COMPILER);
  const deep = `say ${"(".repeat(3000)}1${")".repeat(3000)}`; // too deep for both
  for (const source of [...Object.values(examples), ...PROGRAMS.map(([s]) => s), ...ERRORS.map(([s]) => s), deep, COMPILER])
    assert.deepEqual(compiled(moth, source), compiled(compileToJs, source), source);
});

// The one known difference: Moth sees text as whole characters, so it can't tell half of an emoji (a lone
// UTF-16 surrogate, which no file can hold) from a whole one. The fuzzer cuts emoji in half, so those are left out.
test("the compiler written in Moth matches the JIT on randomly broken programs", () => {
  const moth = mothCompiler(COMPILER);
  for (const source of brokenPrograms(1, 3000)) {
    if (/[\ud800-\udfff]/u.test(source)) continue;
    assert.deepEqual(compiled(moth, source), compiled(compileToJs, source), source);
  }
});

// Bootstrapping: compiler.moth compiled by the JIT compiles itself; the compiler that makes compiles it
// again, and so on. Each one writes exactly the JIT's JavaScript, so the compiler has reached a fixed point.
test("the compiler written in Moth compiles itself, and what it makes does the same", () => {
  const js = compileToJs(COMPILER).source;
  let compiler = compileToJs;
  for (let stage = 1; stage <= 3; stage++) {
    compiler = mothCompiler(COMPILER, compiler);
    assert.equal(compiler(COMPILER).source, js, `stage ${stage}`);
  }
  const said = [];
  compiler(examples.Functions).run((line) => said.push(line), undefined, Infinity); // and what it compiles runs
  assert.deepEqual(said, ["Hello, Sam!", "fib(20) is 6765"]);
});

// ---------- the neural network written in Moth ----------

// It makes its own random numbers, so a run is the same every time: all three engines must say and draw
// exactly the same things, and the network must learn to put every dot on the right side.
test("the neural network written in Moth learns, the same way on all three engines", () => {
  const network = readFileSync(new URL("./neural.moth", import.meta.url), "utf8");
  const train = (engine) => {
    const said = [];
    const drawn = [];
    run(network, (line) => said.push(line), { engine, draw: (line) => drawn.push(line) });
    return { said, drawn };
  };
  const jit = train("jit");
  assert.deepEqual(train("vm"), jit);
  assert.deepEqual(train("wasm"), jit);
  assert.equal(jit.said[1], "step 1: loss 1.173, 50% right");
  assert.equal(jit.said.at(-1), "after 60 steps: 100% of the dots are on the right side");
  assert.deepEqual(check(network), []);
});

// ---------- the WebAssembly encoder ----------

test("the WebAssembly encoder writes numbers as the spec does, and modules that validate", async () => {
  const { uleb, sleb, Module } = await import("./wasm-binary.js");
  assert.deepEqual(uleb(624485), [0xe5, 0x8e, 0x26]); // the examples from the LEB128 article the spec points to
  assert.deepEqual(sleb(-123456), [0xc0, 0xbb, 0x78]);
  assert.deepEqual([sleb(63), sleb(64), sleb(-64), sleb(-65)], [[0x3f], [0xc0, 0x00], [0x40], [0xbf, 0x7f]]);
  const m = new Module();
  const f = m.func("answer", [], ["i32"]);
  f.code.emit("i32.const", 42);
  m.export("answer", f.index);
  const { instance } = await WebAssembly.instantiate(m.encode());
  assert.equal(instance.exports.answer(), 42);
  assert.throws(() => f.code.emit("local.get", undefined), /needs indices/);
  for (const source of Object.values(examples)) assert.ok(WebAssembly.validate(compileToWasm(source).bytes));
});
