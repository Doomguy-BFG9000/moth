import { test } from "node:test";
import assert from "node:assert/strict";
import { run, debug, timeline, excerpt, MothError } from "./moth.js";
import examples from "./examples.js";

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
  "Primes": "Primes up to 50: [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47]",
};

test("every playground example runs", () => {
  for (const [name, source] of Object.entries(examples)) {
    if (name === "Errors") assert.equal(error(source).message, "line 3: there is no item 5, the list only has 2 items");
    else assert.equal(output(source), EXAMPLES[name], name);
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
];

test("programs print what they should", () => {
  for (const [source, expected] of PROGRAMS) assert.equal(output(source), expected, source);
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
];

test("mistakes give a clear message", () => {
  for (const [source, message] of ERRORS) assert.equal(error(source).message, message, source);
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

// Fuzzing: thousands of randomly broken programs must only ever fail with a MothError that points
// inside the code, never with a JavaScript crash. The seed is fixed, so a failure always reproduces.
test("randomly broken programs fail cleanly", () => {
  let seed = 42;
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
  for (let i = 0; i < 5000; i++) {
    let source = pick(sources);
    for (let n = 1 + random(3); n > 0; n--) source = pick(mutations)(source);
    try {
      run(source, () => {}, { maxSteps: 10_000 });
    } catch (err) {
      if (!(err instanceof MothError)) assert.fail(`crashed with ${err.stack}\non this program:\n${source}`);
      assert.ok(err.line >= 1 && err.line <= source.split("\n").length && err.col >= 1, `bad position ${err.line}:${err.col} in:\n${source}`);
    }
  }
});
