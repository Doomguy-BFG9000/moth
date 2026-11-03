import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { run, test as testMoth, format, suggestedFix, debug, timeline, check, compile, compileToJs, compileToWasm, load, mothCompiler, memoryDisk, excerpt, describeTrail, MothError, soundSamples, soundWav } from "./moth.js";
import { Machine, BEEP, Ended } from "./vm.js";
import examples from "./examples.js";
import { generatePrograms } from "./generate.js";
import { PROGRAMS, ERRORS, SAVING, brokenPrograms } from "./cases.js";
import { pngCases, bmpCases, brokenPictures, handmadeBroken } from "./picture-cases.js";

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
  "Data": "Trip: 5.3 km, or 3.29326731885787 miles\nTime: 165 minutes\n0.1 + 0.2 is 0.3\nTue was a good day\nWed was a good day\nAverage: 7425 steps",
  "Tune": "Twinkle, twinkle, little star",
  "Primes": "Primes up to 50: [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47]",
  "Guess": "Guess my number (1 to 100): 50\nLower\nGuess my number (1 to 100): 25\nHigher\nGuess my number (1 to 100): 37\nYes! 37 in 3 tries",
};

test("every playground example runs, on all three engines", () => {
  for (const engine of ENGINES) {
    for (const [name, source] of Object.entries(examples)) {
      if (name === "Errors") assert.equal(error(source, { engine }).message, "line 3: there is no item 5, the list only has 2 items");
      else {
        const answers = ["50", "25", "37"]; // for Guess, the one that asks
        const said = [];
        run(source, (line) => said.push(line), { engine, ask: (question) => (said.push(`${question} ${answers[0]}`), answers.shift()) });
        assert.equal(said.join("\n"), EXAMPLES[name], `${engine}: ${name}`);
      }
    }
  }
});


test("programs print what they should, on all three engines", () => {
  for (const engine of ENGINES) for (const [source, expected] of PROGRAMS) assert.equal(output(source, { engine }), expected, `${engine}: ${source}`);
});


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
    const answers = ["50", "25", "37"]; // for Guess
    const machine = debug(source, (line) => lines.push(line), undefined, (question) => (lines.push(`${question} ${answers[0]}`), answers.shift()));
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
    "18:5 fails: 'length of' needs a list, text, dictionary or bytes, not a number",
    "19:1 fails: can only go through a list, text, dictionary or bytes, not a number",
    "21:1 fails: 'move forward' needs a number, not text",
    "22:7 fails: can't divide by zero",
  ]);
  assert.deepEqual(problems('draw picture 5 at 0, 0\ndraw picture "cat.png" at 0, 0\nset b to "x" as bytes\ndraw picture b at "a", 0'), [
    "1:1 fails: 'draw picture' needs a file's name or its bytes, not a number", // whether a file is a picture isn't known
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
// calls), so the rule for working programs is: no warned line actually runs. A program with a `try` can
// run a failing line and still finish, so those are left out.
const catches = (source) => /\btry\b/i.test(source);
test("the checker raises no false alarms on working programs", () => {
  for (const source of [...Object.values(examples), ...PROGRAMS.map(([source]) => source)]) {
    if (catches(source)) continue;
    const { lines } = trace(source);
    for (const p of check(source)) if (p.kind !== "unused") assert.ok(!lines.has(p.line), `${p.line}: ${p.message} in:\n${source}`);
  }
});

// The lines a program really runs (its LINE markers), and the mistake it stops at, if any. A program that
// stops itself (`stop the program with 2`) ran its lines and made no mistake.
function trace(source) {
  const lines = new Set();
  const machine = new Machine(compile(source, { debug: true }), () => {}, { maxSteps: 10_000 });
  try {
    while (machine.run({ pauseAtLines: true }) === "line") lines.add(machine.line);
  } catch (err) {
    if (err instanceof Ended) return { lines };
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
      if (!error && !catches(source)) assert.ok(!lines.has(p.line), `said line ${p.line} fails, but it ran fine:\n${source}`);
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
    return { said, drawn, error: [err.message, err.col, err.trail] };
  }
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

test("save, load, the clock and in order say the same on all three engines, and compile as the JIT compiles them", () => {
  const moth = mothCompiler(COMPILER);
  for (const [source, expected] of SAVING) {
    for (const engine of ENGINES) {
      let said = "";
      try {
        run(source, (line) => (said += `${line}\n`), { engine, disk: memoryDisk() });
      } catch (err) {
        if (!(err instanceof MothError)) throw err;
        said += `${err.message}\n`;
      }
      assert.equal(said.replace(/\n$/, ""), expected, `${engine}: ${source}`);
    }
    assert.deepEqual(compiled(moth, source), compiled(compileToJs, source), source);
  }
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
  const files = (name) => readFileSync(new URL(`./${name}`, import.meta.url), "utf8"); // math.moth
  const train = (engine) => {
    const said = [];
    const drawn = [];
    run(network, (line) => said.push(line), { engine, draw: (line) => drawn.push(line), files });
    return { said, drawn };
  };
  const jit = train("jit");
  assert.deepEqual(train("vm"), jit);
  assert.deepEqual(train("wasm"), jit);
  assert.equal(jit.said[1], "step 1: loss 1.173, 50% right");
  assert.equal(jit.said.at(-1), "after 60 steps: 100% of the dots are on the right side");
  assert.deepEqual(check(network, { files }), []);
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

// ---------- ask ----------

// A question goes to whoever can answer, as text, and the answer comes back as text. Running the program
// again on the VM (after deep recursion here) must reuse the answers already given, not ask twice.
test("ask gets answers, on all three engines, and a hand-over to the VM doesn't ask again", () => {
  const source = 'set a to ask "first?"\nto down with n\n    if n is 0\n        return 0\n    end\n    return 1 + down(n - 1)\nend\nsay a " " down(5000)\nsay ask "second " + a + "?"';
  for (const engine of ENGINES) {
    const asked = [];
    const replies = ["x", "y"];
    assert.equal(output(source, { engine, ask: (question) => (asked.push(question), replies.shift()) }), "x 5000\ny", engine);
    assert.deepEqual(asked, ["first?", "second x?"], engine);
  }
  const { said } = timeline('say ask "name?"\nsay "bye"', { answers: ["Sam"] });
  assert.deepEqual(said, ["name? Sam", "Sam", "bye"]); // the debugger replays the answers it was given
  assert.equal(error('say ask "x"', { ask: () => null }).message, "line 1: there was no answer to this question: the input ended");
});

// ---------- use ----------

// `use "x.moth"` puts another file's code in the program, once; a mistake in it names that file. The
// compiler written in Moth reads files the same way, and still writes the JIT's JavaScript.
test("use reads other files once, on all three engines, and mistakes in them say which file", () => {
  const files = {
    "shapes.moth": "to square with n\n    return n * n\nend\nset unit to 1",
    "twice.moth": 'use "shapes.moth"\nsay "twice"',
    "bad.moth": "say 1 +",
    "loop.moth": 'use "loop2.moth"',
    "loop2.moth": 'use "loop.moth"',
    "boom.moth": "to boom\n    say 1 / 0\nend",
  };
  const reading = { files: (name) => files[name] };
  const program = 'use "shapes.moth"\nuse "twice.moth"\nsay square(4) + unit';
  const mistakes = [
    ['use "nope.moth"', "line 1: there is no file called 'nope.moth'", undefined],
    ['use "bad.moth"', "bad.moth, line 1: expected a value but found the end of the code", "bad.moth"],
    ['use "loop.moth"', "loop2.moth, line 1: 'loop.moth' is already being read, so it can't be used here: files can't use each other in a circle", "loop2.moth"],
    ['if yes\n    use "shapes.moth"\nend', "line 2: 'use' only works at the top level of a program", undefined],
    ['use "boom.moth"\nboom', "boom.moth, line 2: can't divide by zero", "boom.moth"],
    ["use shapes", 'line 1: expected a file name in quotes, like "shapes.moth" but found \'shapes\'', undefined],
  ];
  for (const engine of ENGINES) {
    assert.equal(output(program, { engine, ...reading }), "twice\n17", engine);
    for (const [source, message, file] of mistakes) {
      const err = error(source, { engine, ...reading });
      assert.equal(err.message, message, `${engine}: ${source}`);
      assert.equal(err.file, file);
    }
  }
  files["warns.moth"] = "say 1 / 0";
  assert.deepEqual(check('use "warns.moth"\nsay "a" * 2', reading).map((p) => [p.file, p.line, p.message]),
    [["warns.moth", 1, "can't divide by zero"], [undefined, 2, "can't use '*' on text and a number"]]);
  const moth = mothCompiler(COMPILER);
  for (const source of [program, ...mistakes.map(([source]) => source)]) {
    assert.deepEqual(compiled((s) => moth(s, files), source), compiled((s) => compileToJs(s, reading), source), source);
  }
});

// ---------- reading handwriting ----------

const here = (name) => readFileSync(new URL(`./${name}`, import.meta.url), "utf8");

// Digits drawn differently from the shapes it learned from (other proportions, another start, a sloppy 8),
// and smaller, off to one side, as the drawing pad would send them.
const DRAWN = {
  0: ["70,52 66,25 45,14 24,25 20,52 26,80 45,90 64,80 70,52 68,40"],
  1: ["40,22 50,10 48,90"],
  2: ["25,30 35,15 55,12 70,22 68,40 30,85 75,85"],
  3: ["25,15 55,10 68,25 50,45 70,60 65,85 35,90 22,80"],
  4: ["55,10 20,60 80,60", "60,35 58,95"],
  5: ["70,12 35,12 32,45 55,42 70,58 62,85 30,85"],
  6: ["65,12 35,40 30,75 45,90 65,80 62,60 40,58 32,70"],
  7: ["20,15 80,15 45,90"],
  8: ["55,15 35,20 38,40 60,55 65,75 50,90 30,80 35,60 60,42 62,25 55,15"],
  9: ["65,35 50,15 30,25 35,45 60,42 65,30 62,90"],
};
const small = (stroke) => stroke.split(" ").map((p) => p.split(",").map(Number)).map(([x, y]) => `${Math.round(x * 0.6 + 25)},${Math.round(y * 0.6 + 15)}`).join(" ");

test("the network written in Moth reads digits drawn on the pad, on all three engines", () => {
  for (const engine of ENGINES) {
    const answers = Object.values(DRAWN).map((strokes) => strokes.map(small).join(";"));
    const said = [];
    try {
      run(here("handwriting.moth"), (line) => said.push(line), { engine, files: here, ask: () => answers.shift() ?? null });
    } catch (err) {
      assert.match(err.message, /the input ended/); // it asks for another until the answers run out
    }
    assert.deepEqual(said.map((line) => line.match(/it's an? (\d)/)?.[1]), Object.keys(DRAWN), engine);
  }
  for (const name of ["handwriting.moth", "digits-train.moth", "neural.moth"]) assert.deepEqual(check(here(name), { files: here }), [], name);
});

// The real training takes seconds; a tiny one checks that it learns something and writes a model Moth can read.
test("digits-train.moth writes the model as Moth", () => {
  const source = here("digits-train.moth").replace(/set per_digit to \d+/, "set per_digit to 5").replace(/set rounds to \d+/, "set rounds to 1");
  const said = [];
  run(source, (line) => said.push(line), { engine: "wasm", files: here });
  assert.match(said[1], /^# round 1: \d+% right while learning$/);
  const model = said.join("\n");
  assert.ok(compileToJs(`${model}\nsay length of hidden_weights of model " " length of output_bias of model`));
  const out = [];
  run(`${model}\nsay length of hidden_weights of model " " length of output_bias of model`, (line) => out.push(line));
  assert.deepEqual(out, ["8192 10"]);
});

// ---------- try ----------

// A loop that never ends must still stop: running past maxSteps isn't a mistake a `try` catches. And the
// checker doesn't warn about a mistake inside a `try`, which is there to catch it.
test("try can't catch running out of steps, and the checker trusts it", () => {
  const forever = 'repeat while yes\n    try\n        set x to 1\n    if it fails\n        say "caught"\n    end\nend';
  for (const engine of ENGINES) assert.equal(error(forever, { engine, maxSteps: 100 }).message, "line 1: stopped after 100 steps (is there a loop that never ends?)", engine);
  assert.deepEqual(problems('try\n    say 1 / 0\nif it fails\n    say "zero"\nend'), []);
  assert.deepEqual(problems('try\n    say 1\nif it fails with e\n    say 1 / 0\nend'), ["4:11 fails: can't divide by zero"]);
});

// ---------- files and arguments ----------

// Files in memory that keep a log of what was done to them.
function loggedDisk(start) {
  const disk = memoryDisk(start);
  const { read, write } = disk;
  disk.log = [];
  disk.read = (name, asBytes) => (disk.log.push(`read ${name}`), read(name, asBytes));
  disk.write = (name, data) => (disk.log.push(`write ${name}`), write(name, data));
  return disk;
}

test("tables: read table, for each ... where, total of, average of, largest of, and charts, on all three engines", () => {
  const source = [
    'set sales to read table "sales.csv"',
    "say length of sales \" rows: \" item 1 of sales",
    "for each row in sales where price of row is not nothing and price of row is greater than 1.6",
    "    say name of row",
    "end",
    "say total of price in sales \" \" average of price in sales \" \" largest of qty in sales \" \" smallest of name in sales",
    "say total of (list of 5 km, 300 m) \" \" average of (list of 1 hour, 30 minutes)",
    "draw chart of price in sales",
  ].join("\n");
  const csv = 'Name,Price,Qty\nApple,1.5,10\nPear,2,3\n"Big, red melon",12.25,1\nKiwi,,\n';
  const drawings = [];
  for (const engine of ENGINES) {
    const drawn = [];
    const said = output(source, { engine, disk: memoryDisk({ "sales.csv": csv }), draw: (d) => drawn.push(d) });
    assert.equal(said, [
      '4 rows: (record with name "Apple", price 1.5, qty 10)',
      "Pear",
      "Big, red melon",
      "15.75 5.25 10 Apple",
      "5.3 km 0.75 hours",
    ].join("\n"), engine);
    drawings.push(drawn);
  }
  assert.deepEqual(drawings[0].slice(0, 3), [
    { shape: "box", x: 0, y: 0, width: 30, height: 24.49, color: "#4f8ff7" },
    { shape: "text", text: "1.5", x: 0, y: 28.49, size: 12, color: "#4f8ff7" },
    { shape: "text", text: "1", x: 0, y: -18, size: 12, color: "#4f8ff7" },
  ]);
  assert.equal(drawings[0].length, 10); // three bars with their values and labels, and Kiwi's label alone
  assert.deepEqual(drawings[1], drawings[0]);
  assert.deepEqual(drawings[2], drawings[0]);
});

test("programs read and write files, and get their arguments, on all three engines", () => {
  const source = [
    'write "one\\ntwo" to "notes.txt"',
    'set lines to split read "notes.txt" by "\\n"',
    'say length of lines " lines, the last is " item 2 of lines',
    'set data to read bytes "photo.bin"',
    "set byte 1 of data to 255",
    'write data to "copy.bin"',
    'say read bytes "copy.bin"',
    'say read bytes "photo.bin"',
    "try",
    '    say read "missing.txt"',
    "if it fails with why",
    "    say why",
    "end",
    "for each a in arguments",
    '    say "argument: " a',
    "end",
  ].join("\n");
  for (const engine of ENGINES) {
    const disk = loggedDisk({ "photo.bin": new Uint8Array([1, 2, 3]) });
    const said = output(source, { engine, disk, args: ["-v", "x.txt"] });
    assert.equal(said, "2 lines, the last is two\n(3 bytes: 255, 2, 3)\n(3 bytes: 1, 2, 3)\nthere is no file called 'missing.txt'\nargument: -v\nargument: x.txt", engine);
    assert.equal(disk.files.get("notes.txt"), "one\ntwo", engine);
  }
});

// The JIT and the WebAssembly engine hand a program that goes too deep to the VM, which runs it again from
// the start: it must read what the first run read, and not write again what the first run wrote.
test("a hand-over to the VM reads the same files and writes nothing twice", () => {
  const source = [
    'set n to number of read "count.txt"',
    'write n + 1 to "count.txt"',
    'say "count was " n',
    "to deep with k",
    "    if k is 0",
    "        return 0",
    "    end",
    "    return deep(k - 1)",
    "end",
    "say deep(3000)",
    'say read "count.txt"',
  ].join("\n");
  for (const engine of ENGINES) {
    const disk = loggedDisk({ "count.txt": "41" });
    assert.equal(output(source, { engine, disk }), "count was 41\n0\n42", engine);
    assert.deepEqual(disk.log, ["read count.txt", "write count.txt", "read count.txt"], engine);
  }
});

// ---------- modules ----------

// The file's names become shapes's sides and so on, so they can't clash with the program's; a file used as
// two names is two separate copies; and inside the file, a function's inputs and its own functions still
// hide the file's names, as they would anywhere. The file keeps its own top level: a variable only its
// functions set is theirs, never the program's, and a name the file doesn't make isn't the program's either.
test("use ... as keeps a file's names apart, on all three engines and in the compiler written in Moth", () => {
  const files = {
    "shapes.moth": 'set sides to 4\nto area with w, h\n    return w * h\nend\nto describe\n    return "a shape with " + sides + " sides"\nend',
    "counter.moth": "set count to 0\nto bump\n    add 1 to count\n    return count\nend",
    "hide.moth": 'set n to 10\nset helper to 1\nto plus_one with n\n    return n + 1\nend\nto grow\n    set n to n + 5\n    return n\nend\nto own_helper\n    to helper\n        return "inner"\n    end\n    return helper()\nend',
    "isolate.moth": 'to tally with things\n    set total to 0\n    for each k in things\n        add k to total\n    end\n    return total\nend\nto first_word with text\n    set found to item 1 of (split text by " ")\n    return found\nend\nset found to "top"',
    "leak.moth": 'to greet\n    return "hi " + who\nend',
  };
  const reading = { files: (name) => files[name] };
  const program = [
    'use "shapes.moth" as shapes',
    'use "counter.moth" as a',
    'use "counter.moth" as b',
    'use "hide.moth" as h',
    "set sides to 3",
    'say shapes\'s sides " " sides',
    "say shapes's area(2, 3)",
    "say shapes's describe()",
    'say a\'s bump() " " a\'s bump() " " b\'s bump()',
    "a's bump",
    "say a's count",
    'say h\'s plus_one(1) " " h\'s grow() " " h\'s n',
    'say h\'s own_helper() " " h\'s helper',
    "set total to 100",
    'set k to "mine"',
    'use "isolate.moth" as iso',
    'use "isolate.moth" as again',
    'say iso\'s tally((list of 1, 2, 3)) " " again\'s tally((list of 4)) " " total " " k',
    'say iso\'s first_word("hello there") " " iso\'s found " " again\'s found',
  ].join("\n");
  const mistakes = [
    ['use "shapes.moth" as shapes\nsay shapes\'s sids', "line 2: 'shapes' has nothing called 'sids'. Did you mean 'shapes's sides'?"],
    ['use "shapes.moth" as shapes\nshapes\'s nope(1)', "line 2: 'shapes' has nothing called 'nope'"],
    ["say x's y", "line 1: 'x' has no value yet (give it one with 'set x to ...')"],
    ['use "shapes.moth" as list', "line 1: 'list' is a Moth word, so it can't be used as a name for the file"],
    ['use "shapes.moth" as shapes\nsay shapes\'s 5', "line 2: expected a name but found '5'"],
    ['set who to "Sam"\nuse "leak.moth" as leak\nsay leak\'s greet()', "leak.moth, line 2: 'leak' has nothing called 'who'"],
  ];
  for (const engine of ENGINES) {
    assert.equal(output(program, { engine, ...reading }), "4 3\n6\na shape with 4 sides\n1 2 1\n3\n2 15 15\ninner 1\n6 4 100 mine\nhello top top", engine);
    for (const [source, message] of mistakes) assert.equal(error(source, { engine, ...reading }).message, message, `${engine}: ${source}`);
  }
  assert.deepEqual(check(program, reading), []);
  const moth = mothCompiler(COMPILER);
  for (const source of [program, ...mistakes.map(([source]) => source)]) {
    assert.deepEqual(compiled((s) => moth(s, files), source), compiled((s) => compileToJs(s, reading), source), source);
  }
});

test("a file uses files from its own folder, and use the package finds packages/<name>/<name>.moth, on all three engines and in the compiler written in Moth", () => {
  const files = {
    "packages/greet/greet.moth": 'use "words.moth" as words\nto hello with n\n    return words\'s hi + ", " + n\nend',
    "packages/greet/words.moth": 'set hi to "Hello"',
    "packages/shout/shout.moth": 'use the package "greet" as greet\nto shout with n\n    return uppercase of greet\'s hello(n)\nend',
    "lib/a.moth": 'use "b.moth"\nset a_value to b_value + 1',
    "lib/b.moth": "set b_value to 41",
    "b.moth": "set b_value to 0", // the program's own folder's, which lib/a.moth doesn't mean
  };
  const reading = { files: (name) => files[name] };
  const programs = [
    ['use the package "greet" as greet\nuse "lib/a.moth"\nsay greet\'s hello("Sam") " " a_value', "Hello, Sam 42"],
    ['use the package "shout" as shout\nsay shout\'s shout("Bo")', "HELLO, BO"],
    ['use the package "greet"\nsay hello("Ana")', "Hello, Ana"],
  ];
  const mistakes = [
    ['use the package "no/pe"', "line 1: 'no/pe' isn't a package's name: letters, digits, '-', '_' and '.' make one"],
    ['use the package "missing" as m', "line 1: there is no file called 'packages/missing/missing.moth'"],
    ["use the package\nsay 1", "line 2: expected a package's name in quotes, like \"json\" but found 'say'"],
    ['use "lib/nope.moth"', "line 1: there is no file called 'lib/nope.moth'"],
  ];
  for (const engine of ENGINES) {
    for (const [source, want] of programs) assert.equal(output(source, { engine, ...reading }), want, `${engine}: ${source}`);
    for (const [source, message] of mistakes) assert.equal(error(source, { engine, ...reading }).message, message, `${engine}: ${source}`);
  }
  const moth = mothCompiler(COMPILER);
  for (const source of [...programs, ...mistakes].map(([source]) => source)) {
    assert.deepEqual(compiled((s) => moth(s, files), source), compiled((s) => compileToJs(s, reading), source), source);
  }
});

// ---------- error trails ----------

// Each engine keeps track of the calls in progress its own way (the VM's frames, the JIT's arrays, an array
// inside the WebAssembly module), and all three must give the same trail. The fuzzer compares them too.
test("a mistake inside functions shows the calls that led to it, the same on all three engines", () => {
  const files = { "lib.moth": "to boom\n    say 1 / 0\nend\nto go\n    boom()\nend" };
  const cases = [
    [[
      "to average with numbers",
      "    set total to 0",
      "    for each n in numbers",
      "        add n to total",
      "    end",
      "    return total / length of numbers",
      "end",
      "to report with groups",
      "    for each g in groups",
      '        say "average: " average(g)',
      "    end",
      "end",
      "report(list of (list of 1, 2), empty list)",
    ], [["average", 10, 1], ["report", 13, 1]], "  in 'average', called from line 10\n  in 'report', called from line 13"],
    [["to countdown with n", "    if n is 0", "        say 1 / 0", "    end", "    countdown(n - 1)", "end", "countdown(3)"],
      [["countdown", 5, 3], ["countdown", 7, 1]], "  in 'countdown', called from line 5 (3 times)\n  in 'countdown', called from line 7"],
    [["to countdown with n", "    if n is 0", "        say 1 / 0", "    end", "    countdown(n - 1)", "end", "countdown(5000)"], // handed to the VM
      [["countdown", 5, 5000], ["countdown", 7, 1]], "  in 'countdown', called from line 5 (5,000 times)\n  in 'countdown', called from line 7"],
    [['use "lib.moth" as lib', "lib's go()"],
      [["lib's boom", 5, 1], ["lib's go", 2, 1]], "  in 'lib's boom', called from lib.moth, line 5\n  in 'lib's go', called from line 2"],
    [["to safe", "    try", "        say 1 / 0", "    if it fails", "        say 2", "    end", "end", "safe()", "say 1 / 0"], [], ""],
    [["to spin", "    repeat while yes", "    end", "end", "spin()"], [["spin", 5, 1]], "  in 'spin', called from line 5"],
  ];
  for (const [lines, expected, shown] of cases) {
    const source = lines.join("\n");
    const vm = error(source, { engine: "vm", files: (name) => files[name], maxSteps: 100_000 });
    assert.deepEqual(vm.trail.map(({ name, line, times }) => [name, line, times]), expected, source);
    assert.equal(describeTrail(vm.trail), shown, source);
    for (const engine of ["jit", "wasm"]) assert.deepEqual(error(source, { engine, files: (name) => files[name], maxSteps: 100_000 }).trail, vm.trail, `${engine}: ${source}`);
  }
  const deep = error("to dive with n\n    dive(n + 1)\nend\ndive(1)", { engine: "vm" }); // the VM's own limit
  assert.equal(deep.reason, "too much recursion: a function kept calling itself");
  assert.equal(describeTrail(deep.trail), "  in 'dive', called from line 2 (99,999 times)\n  in 'dive', called from line 4");
});

// ---------- fast paths ----------

// WebAssembly does bytes, bits and dictionary lookups itself where it can, and hands everything else to the
// shared code. Right at the edges of what it does itself, all three engines must still agree.
test("WebAssembly's fast paths for bytes, bits and dictionaries agree with the other engines at their edges", () => {
  const programs = [];
  const pairs = [[0, 0], [5, 3], [2147483647, 1], [2147483648, 1], [2147483647, 2147483647], [4294967295, 65535],
    [9007199254740991, 255], [9007199254740992, 1], [1.5, 1], [-1, 1], ['"a"', 1], ["yes", 1]];
  for (const [a, b] of pairs) for (const op of ["bit and", "bit or", "bit xor"]) programs.push(`say ${a} ${op} ${b}\nsay ${b} ${op} ${a}`);
  const shifts = [[1, 0], [1, 21], [1, 22], [3, 21], [2147483647, 21], [2147483647, 22], [1, 52], [1, 53], [0, 5000],
    [5, 31], [5, 32], [2147483647, 31], [4294967296, 1], [1, -1], [1, 0.5], ['"a"', 1]];
  for (const [x, n] of shifts) for (const way of ["left", "right"]) programs.push(`say shift ${x} ${way} by ${n}`);
  for (const v of ["0", "255", "256", "-1", "0.5", "-0", "yes", '"a"', "nothing", "list of 1"]) programs.push(`set b to 3 bytes\nset byte 2 of b to ${v}\nsay b`);
  for (const i of ["0", "1", "3", "4", "1.5", '"a"', "-0"]) {
    programs.push(`set b to (list of 7, 8, 9) as bytes\nsay byte ${i} of b`);
    programs.push(`set b to (list of 7, 8, 9) as bytes\nset byte ${i} of b to 1\nsay b`);
  }
  for (const n of ["0", "5", "-1", "1.5", '"a"']) programs.push(`set b to ${n} bytes\nsay length of b`);
  programs.push("set b to 3 bytes\nsay length of b\nfor each x in b\n    say x\nend\nsay b is 3 bytes\nsay 0 is in b\nsay 1 is in b\nsay b is (list of 0, 0, 0) as bytes\nsay b is list of 0, 0, 0");
  for (const key of ["1", "-0", "0", "1.5", '"1"', '""', "yes", "list of 1", "nothing", "3 bytes"]) {
    programs.push(`set d to empty dictionary\nset item ${key} of d to "v"\nsay d\nsay item ${key} of d\nsay ${key} is in d`);
    programs.push(`set d to dictionary where 1 is "one", "1" is "text one"\nsay ${key} is in d\nsay item ${key} of d`);
  }
  programs.push('set d to dictionary where 0 is "zero"\nsay item -0 of d\nsay -0 is in d\nsay "0" is in d');
  programs.push('set d to dictionary where "a" is yes, "b" is nothing, "c" is list of 1\nsay item "a" of d " " item "b" of d " " item "c" of d\nset l to item "c" of d\nadd 2 to l\nsay d\nsay item "a" of d is yes');
  programs.push('set d to dictionary where "a" is 1\nset item "a" of d to item "a" of d + 1\nsay d\nsay item "b" of d');
  for (const source of programs) {
    const vm = outcome(source, "vm");
    assert.deepEqual(outcome(source, "jit"), vm, `jit: ${source}`);
    assert.deepEqual(outcome(source, "wasm"), vm, `wasm: ${source}`);
  }
});

// ---------- tests written in Moth: test() ----------

// Each test_ function runs on its own, in a fresh run of the file: test_two doesn't see what test_one did.
test("test() runs each test_ function on its own, and says why one failed, on all three engines", () => {
  const source = [
    "set count to 0",
    "to average with numbers",
    "    return 10 / length of numbers",
    "end",
    "to test_one",
    "    add 1 to count",
    "    expect count is 1",
    "end",
    "to test_two",
    "    add 1 to count",
    '    say "count is " count',
    "    expect count is 2",
    "end",
    "to test_three",
    "    expect average(empty list) is 1",
    "end",
    "to helper",
    "    expect 1 is 2",
    "end",
  ].join("\n");
  for (const engine of ENGINES) {
    const results = testMoth(source, { engine });
    assert.deepEqual(results.map((r) => [r.name, r.said, r.error?.message]), [
      ["test_one", [], undefined],
      ["test_two", ["count is 1"], "line 12: expected 1 to be 2"],
      ["test_three", [], "line 3: can't divide by zero"],
    ], engine);
    assert.deepEqual(results[2].error.trail.map((t) => [t.name, t.line]), [["average", 15]], engine); // not the call that started it
    assert.deepEqual(results[1].error.trail, [], engine);
  }
  const [whole] = testMoth("say 1\nexpect 1 is 2"); // no tests: the file is one
  assert.deepEqual([whole.name, whole.said, whole.error.message], [null, ["1"], "line 2: expected 1 to be 2"]);
  assert.throws(() => testMoth("to test_a\n    say 1"), /'to' from line 1 is missing its 'end'/);
});

// ---------- the error output, and the number a program ends with ----------

// One log for both outputs and the end, so their order shows: "out", "err" or "end", then what came.
function streams(source, options = {}) {
  const log = [];
  try {
    const app = run(source, (line) => log.push(["out", line]), { ...options, printError: (line) => log.push(["err", line]), exit: (code) => log.push(["end", code]) });
    return { log, app };
  } catch (err) {
    if (!(err instanceof MothError)) throw err;
    log.push(["mistake", err.message]);
    return { log };
  }
}

test("say ... to the error output and stop the program, on all three engines and in the compiler written in Moth", () => {
  const cases = [
    ['say "a"\nsay "oops: " 1 + 2 " " list of 1, "x" to the error output\nsay "b"', [["out", "a"], ["err", 'oops: 3 [1, "x"]'], ["out", "b"]]],
    ['say "a"\nstop the program\nsay "b"', [["out", "a"], ["end", 0]]],
    ['for each i from 1 to 3\n    say i\n    if i is 2\n        stop the program with 0.1 * 30\n    end\nend', [["out", "1"], ["out", "2"], ["end", 3]]],
    // no try catches it, however deep
    ["to f with n\n    try\n        if n is 0\n            stop the program with 4\n        end\n        f(n - 1)\n    if it fails\n        say \"caught\"\n    end\nend\nf(10)\nsay \"after\"", [["end", 4]]],
    ["stop the program with 255", [["end", 255]]],
    ["stop the program with 256", [["mistake", "line 1: 'stop the program with' needs a whole number from 0 to 255, not 256"]]],
    ["stop the program with 1.5", [["mistake", "line 1: 'stop the program with' needs a whole number from 0 to 255, not 1.5"]]],
    ["try\n    stop the program with \"2\"\nif it fails with why\n    say why\nend", [["out", "'stop the program with' needs a whole number from 0 to 255, not text"]]],
    // too deep for the JIT and WebAssembly: the VM runs it again, and says nothing twice
    ['say "a" to the error output\nsay "b"\nto deep with n\n    if n is 0\n        say "bottom" to the error output\n        stop the program with 5\n    end\n    deep(n - 1)\nend\ndeep(5000)',
      [["err", "a"], ["out", "b"], ["err", "bottom"], ["end", 5]]],
    ['set c to run program "tool" with (list of "a")', [["mistake", "line 1: can't run programs here: only a program made by moth build can"]]],
    ['set c to run program "x" with (list of "a", "b")', [["mistake", "line 1: can't run programs here: only a program made by moth build can"]]],
    ['set c to run program "x" with (list of 5)', [["mistake", "line 1: 'run program ... with' needs text, not a number"]]],
    ["set c to run program 5", [["mistake", "line 1: 'run program' needs text, not a number"]]],
    ['set c to run program "x" with "a"', [["mistake", "line 1: 'run program ... with' needs a list, not text"]]],
    // words the phrases are made of are still names, and the phrases only start where they could never have
    // meant anything else
    ['set run to 1\nset program to 2\nset the to 3\nsay run + program + the\nto stop_it\n    return 0\nend\nset c to run\nsay c', [["out", "6"], ["out", "1"]]],
    ['repeat 2 times\n    say "x"\n    stop\nend\nsay "y"', [["out", "x"], ["out", "y"]]],
    ["say 1 to the errors", [["mistake", "line 1: expected 'the error output' but found 'the'"]]],
    ["say 1 to", [["mistake", "line 1: expected 'the error output' but found the end of the code"]]],
    ['run program "x"', [["mistake", "line 1: 'run program' gives back the number the program ended with, so it goes where a value goes: 'set code to run program ...'"]]],
    ["stop the", [["mistake", "line 1: 'stop' only works inside a loop (one made with 'repeat' or 'for each')"]]],
  ];
  const moth = mothCompiler(COMPILER);
  for (const [source, want] of cases) {
    for (const engine of ENGINES) assert.deepEqual(streams(source, { engine }).log, want, `${engine}: ${source}`);
    assert.deepEqual(compiled(moth, source), compiled(compileToJs, source), source);
    if (want[0][0] !== "mistake" || !/expected|gives back|only works/.test(want[0][1])) assert.equal(format(format(source)), format(source));
  }
  // an app's handler can stop it: events after that do nothing
  const app = 'say "ready"\nwhen a key is pressed with key\n    if key is "q"\n        say "bye" to the error output\n        stop the program with 3\n    end\n    say key\nend';
  for (const engine of ENGINES) {
    const { log, app: running } = streams(app, { engine });
    for (const key of ["a", "q", "b"]) running.send("key", [key]);
    assert.deepEqual(log, [["out", "ready"], ["out", "a"], ["err", "bye"], ["end", 3]], engine);
    assert.equal(running.stopped, 3, engine);
  }
  // a file used `as` a name: the names in its code are renamed, `stop the program` and `remove the file` too
  const files = { "runner.moth": 'set code to 3\nto quit\n    say "from the module" to the error output\n    stop the program with code\nend\nto clean with name\n    remove the file name\nend' };
  const using = `use "runner.moth" as runner\nsay runner's code\nrunner's clean("gone.txt")\nrunner's quit()\nsay "never"`;
  for (const engine of ENGINES) {
    const disk = memoryDisk({ "gone.txt": "x" });
    assert.deepEqual(streams(using, { engine, files: (name) => files[name], disk }).log, [["out", "3"], ["err", "from the module"], ["end", 3]], engine);
    assert.deepEqual([...disk.files.keys()], [], engine);
  }
  assert.deepEqual(compiled((s) => moth(s, files), using), compiled((s) => compileToJs(s, { files: (name) => files[name] }), using));
  // a test that stops the program with a number other than 0 fails; the debugger's timeline ends there
  assert.deepEqual(testMoth("to test_a\n    stop the program with 4\nend\nto test_b\n    say 1\n    stop the program\n    say 2\nend", { printError: () => {} }),
    [{ name: "test_a", said: [], stopped: 4 }, { name: "test_b", said: ["1"] }]);
  const { steps } = timeline("say 1 to the error output\nstop the program with 6\nsay 2");
  assert.deepEqual([steps.at(-1).done, steps.at(-1).stopped, steps.length], [true, 6, 3]);
  assert.deepEqual(problems("stop the program with 300\nsay 1"), ["1:1 fails: 'stop the program with' needs a whole number from 0 to 255, not 300",
    "2:1 never runs: this line can never run, because 'stop the program' comes first"]);
  assert.deepEqual(problems('set c to run program 5 with (list of "a")\nsay c'), ["1:10 fails: 'run program' needs text, not a number"]);
  // remove the file: on every engine, through what holds the files
  for (const engine of ENGINES) {
    const disk = memoryDisk({ "old.txt": "x", "keep.txt": "y" });
    const removing = 'remove the file "old.txt"\nsay "gone"\ntry\n    remove the file "old.txt"\nif it fails with why\n    say why\nend\nremove the file 5';
    assert.deepEqual(streams(removing, { engine, disk }).log, [["out", "gone"], ["out", "there is no file called 'old.txt'"], ["mistake", "line 8: a file name is text, not a number"]], engine);
    assert.deepEqual([...disk.files.keys()], ["keep.txt"], engine);
    assert.deepEqual(streams('remove the file "a"', { engine }).log, [["mistake", "line 1: this program removes a file, but there are no files here"]], engine);
  }
  assert.deepEqual(problems("remove the file 5"), ["1:1 fails: a file name is text, not a number"]);
});

// `read the folder "tests"`, which `moth test` needs to find tests: the names in a folder, in order, a folder's
// with / after it, through what holds the files, on every engine and in the compiler written in Moth
test("read the folder, on all three engines and in the compiler written in Moth", () => {
  const source = ['say read the folder "."', 'for each name in read the folder "data/"', "    say name", "end", "try",
    '    say read the folder "nowhere"', "if it fails with why", "    say why", "end", "say read the folder 5"].join("\n");
  const files = { "b.txt": "x", "A.txt": "y", "data/z.txt": "1", "data/a b.txt": "2", "data/sub/deep.txt": "3", "data/sub/more.txt": "4" };
  const moth = mothCompiler(COMPILER);
  for (const engine of ENGINES) {
    assert.deepEqual(streams(source, { engine, disk: memoryDisk(files) }).log, [["out", '["A.txt", "b.txt", "data/"]'],
      ["out", "a b.txt"], ["out", "sub/"], ["out", "z.txt"], ["out", "there is no folder called 'nowhere'"],
      ["mistake", "line 10: a folder name is text, not a number"]], engine);
    assert.deepEqual(streams('say read the folder "."', { engine }).log, [["mistake", "line 1: this program reads a folder, but there are no files here"]], engine);
    // its words are still names, and the phrase only starts where it could never have meant anything else
    assert.deepEqual(streams('set the to "b.txt"\nset folder to 2\nsay read the\nsay folder', { engine, disk: memoryDisk(files) }).log, [["out", "x"], ["out", "2"]], engine);
  }
  for (const program of [source, "say read the folder", 'set the to 1\nsay read the folder\n"x"']) {
    assert.deepEqual(compiled(moth, program), compiled(compileToJs, program), program);
  }
  assert.equal(format('say  read the folder   "x"'), 'say read the folder "x"\n');
  assert.deepEqual(problems('say read the folder 5\nsay length of read the folder "."'), ["1:5 fails: a folder name is text, not a number"]);
  // in a file used `as` a name, its name is renamed with the rest
  const used = { "lister.moth": 'set where to "data"\nto names\n    return read the folder where\nend' };
  const using = 'use "lister.moth" as lister\nsay lister\'s names()';
  for (const engine of ENGINES) {
    assert.deepEqual(streams(using, { engine, files: (name) => used[name], disk: memoryDisk(files) }).log, [["out", '["a b.txt", "sub/", "z.txt"]']], engine);
  }
  assert.deepEqual(compiled((s) => moth(s, used), using), compiled((s) => compileToJs(s, { files: (name) => used[name] }), using));
});

// ---------- tidying ----------

test("format() tidies code the one way, without changing a piece of it, and tidy code stays as it is", () => {
  const messy = [
    "to   area with w,h", "return w*h", "  end", "", "", "", "if area( 2,3 ) is 6   # check", '        say "six"',
    "# a note before else", "else", 'say  "no"', "end", "set l to list of 1 ,2,", " 3", "say - 5", "try", "say 1/0",
    "if it fails with why", " say why", "end", "set r to record with label -1, x (2 + 3)", "move forward (1 + 2)", "", "",
  ].join("\n");
  const tidy = [
    "to area with w, h", "    return w * h", "end", "", "if area(2, 3) is 6   # check", '    say "six"',
    "    # a note before else", "else", '    say "no"', "end", "set l to list of 1, 2,", "    3", "say -5", "try",
    "    say 1 / 0", "if it fails with why", "    say why", "end", "set r to record with label -1, x (2 + 3)",
    "move forward (1 + 2)", "",
  ].join("\n");
  assert.equal(format(messy), tidy);
  assert.equal(format(tidy), tidy);
  for (const source of Object.values(examples)) assert.equal(format(source), `${source}\n`); // they only lack the last new line
  for (const folder of [".", "tools", "apps"]) { // and all the Moth here is tidy
    for (const file of readdirSync(new URL(`./${folder}/`, import.meta.url)).filter((f) => f.endsWith(".moth"))) {
      const text = readFileSync(new URL(`./${folder}/${file}`, import.meta.url), "utf8");
      assert.equal(format(text), text, `${folder}/${file}`);
    }
  }
  assert.throws(() => format("if yes\n    say 1"), MothError);
  let tidied = 0;
  for (const source of brokenPrograms(7, 2000)) {
    let once;
    try {
      once = format(source); // which itself checks that every piece is the same
    } catch (err) {
      if (err instanceof MothError) continue;
      throw err;
    }
    assert.equal(format(once), once, source);
    tidied++;
  }
  assert.ok(tidied > 500, `only ${tidied} could be tidied`);
});

// ---------- the tools written in Moth ----------

const tool = (name) => readFileSync(new URL(`./tools/${name}`, import.meta.url), "utf8");

test("picture.moth writes the same BMP picture on all three engines", () => {
  const pictures = ENGINES.map((engine) => {
    const disk = memoryDisk();
    assert.equal(output(tool("picture.moth"), { engine, disk, args: ["60", "40", "p.bmp"] }), "drew the Mandelbrot set, 60 by 40, in p.bmp", engine);
    return disk.files.get("p.bmp");
  });
  const [bmp] = pictures;
  assert.equal(String.fromCharCode(bmp[0], bmp[1]), "BM");
  assert.equal(bmp.length, 54 + 60 * 3 * 40); // 180 bytes a row, which 4 divides already
  assert.deepEqual([bmp[18], bmp[22], bmp[28]], [60, 40, 24]); // width, height, bits per pixel
  assert.ok(bmp.subarray(54).some((b) => b > 0) && bmp.subarray(54).some((b) => b === 0)); // colours, and the black set
  for (const other of pictures) assert.deepEqual(other, bmp);
});

test("wordcount.moth counts a file's words, on all three engines", () => {
  for (const engine of ENGINES) {
    const disk = memoryDisk({ "story.txt": tool("story.txt") });
    assert.equal(output(tool("wordcount.moth"), { engine, disk, args: ["story.txt", "3"] }), [
      "290 words, 107 different ones",
      "the  ██████████████████████████████ 45",
      "and  █████████████ 20",
      "it   ███████ 11",
    ].join("\n"), engine);
  }
  assert.equal(error(tool("wordcount.moth"), {}).reason, "which file? write: wordcount story.txt");
});

test("json.moth passes its own tests, json.test.moth, on all three engines", () => {
  for (const engine of ENGINES) {
    const results = testMoth(tool("json.test.moth"), { engine, files: (name) => tool(name) });
    assert.deepEqual(results.map((r) => [r.name, r.error?.message]), [
      ["test_values", undefined], ["test_lists_and_objects", undefined], ["test_spaces_and_lines", undefined],
      ["test_escapes", undefined], ["test_mistakes", undefined],
    ], engine);
  }
});

test("text.moth, dates.moth, hash.moth, big.moth, xml.moth and zip.moth pass their own tests on all three engines", () => {
  for (const engine of ENGINES) {
    for (const [file, names] of [
      ["text.test.moth", ["test_whole_matches", "test_finding", "test_replacing_and_splitting", "test_no_endless_loops",
        "test_bad_patterns", "test_numbers", "test_widths", "test_csv"]],
      ["dates.test.moth", ["test_days", "test_four_hundred_years", "test_months_and_weekdays", "test_reading_and_writing",
        "test_today", "test_mistakes"]],
      ["hash.test.moth", ["test_known_hashes", "test_block_edges", "test_text_and_bytes"]],
      ["big.test.moth", ["test_reading_and_writing", "test_adding_and_taking", "test_multiplying", "test_dividing",
        "test_comparing", "test_mistakes"]],
      ["xml.test.moth", ["test_elements", "test_finding", "test_around_the_element", "test_entities_and_cdata",
        "test_writing", "test_mistakes"]],
      ["zip.test.moth", ["test_checks", "test_reading_what_zlib_makes", "test_round_trips", "test_archives", "test_mistakes"]]]) {
      const results = testMoth(tool(file), { engine, files: (name) => tool(name) });
      assert.deepEqual(results.map((r) => [r.name, r.error?.message]), names.map((n) => [n, undefined]), `${file} on ${engine}`);
    }
  }
});

test("math.moth passes its own tests, math.test.moth, on all three engines", () => {
  const here = (name) => readFileSync(new URL(`./${name}`, import.meta.url), "utf8");
  for (const engine of ENGINES) {
    const results = testMoth(here("math.test.moth"), { engine, files: here });
    assert.deepEqual(results.map((r) => [r.name, r.error?.message]),
      ["test_logarithms", "test_powers", "test_angles", "test_rounding", "test_mistakes"].map((n) => [n, undefined]), engine);
  }
});

// ---------- a file used inside a module ----------

// A module that uses a file plainly gets its own copy of it, under the module's name, and the program can
// still use the same file for itself.
test("a file used inside a module is the module's own, and the program can use it too", () => {
  const files = { "lib.moth": "set x to 1\nto twice with n\n    return n * 2\nend", "m.moth": 'use "lib.moth"\nto get\n    return twice(x)\nend' };
  const reading = { files: (name) => files[name] };
  const program = 'use "m.moth" as m\nuse "lib.moth"\nset x to 5\nsay x " " m\'s get() " " m\'s x " " twice(x)';
  for (const engine of ENGINES) assert.equal(output(program, { engine, ...reading }), "5 2 1 10", engine);
  const moth = mothCompiler(COMPILER);
  assert.deepEqual(compiled((s) => moth(s, files), program), compiled((s) => compileToJs(s, reading), program));
});

// ---------- generated programs ----------

// The randomly broken programs above only break programs that exist. These are new ones, made from the
// grammar with every feature mixed in (generate.js): the three engines must do exactly the same with each,
// files and trails included; the compiler written in Moth must write the JIT's JavaScript; tidied code
// must run the same; and the checker must never say a line that runs in a finished program will fail.
test("generated programs: the engines, the compiler in Moth, the formatter and the checker all agree", () => {
  const moth = mothCompiler(COMPILER);
  const world = (engine, source) => {
    const said = [];
    const disk = memoryDisk({ "file.txt": "hello\nworld", "data.bin": new Uint8Array([1, 2, 3]), "data.csv": "Name,Price, x\n\"a, b\",1.5,\r\n\nb,-2,\"q\"\"uote\"\nc,3\n" });
    try {
      run(source, (line) => said.push(line), { engine, maxSteps: 5_000, disk, args: ["one", "2"] });
      return { said, files: [...disk.files] };
    } catch (err) {
      if (!(err instanceof MothError)) assert.fail(`the ${engine} crashed with ${err.stack}\non this program:\n${source}`);
      return { said, files: [...disk.files], error: [err.message, err.col, err.trail] };
    }
  };
  let finished = 0;
  generatePrograms(2026, 1500).forEach((source, i) => {
    const vm = world("vm", source);
    assert.deepEqual(world("jit", source), vm, source);
    assert.deepEqual(world("wasm", source), vm, `wasm: ${source}`);
    if (i % 10 === 0) assert.deepEqual(compiled(moth, source), compiled(compileToJs, source), source);
    let tidy;
    try {
      tidy = format(source);
    } catch (err) {
      if (err instanceof MothError) return; // code that can't be read: the engines agreed on that above
      throw err;
    }
    assert.equal(format(tidy), tidy, source);
    assert.deepEqual(world("vm", tidy), vm, `tidied: ${source}`);
    if (vm.error) return;
    finished++;
    const ran = new Set(timeline(source, { limit: 20_000 }).steps.map((step) => step.line));
    for (const p of problems(source)) {
      const [line] = p.split(":").map(Number);
      if (p.includes(" fails: ") && !catches(source)) assert.ok(!ran.has(line), `said line ${line} fails, but it ran fine:\n${source}`);
    }
  });
  assert.ok(finished > 20, `only ${finished} programs finished`);
});

// ---------- drawing for apps ----------

test("the turtle draws boxes, circles and text, moves to a spot, and clear wipes the picture, on all three engines", () => {
  const source = [
    "move forward 10",
    "clear",
    'pen color "red"',
    "draw box at 10, 20 size 30 by 40",
    "draw circle at 0, 0 size 5",
    'draw "Score: " + 3 at -50, 100',
    'draw "Big" at 0, 0 size 30',
    "move to 50, 60",
    "pen up",
    "move to 0, 0",
  ].join("\n");
  for (const engine of ENGINES) {
    const drawn = [];
    run(source, () => {}, { engine, draw: (d) => drawn.push(d) });
    assert.deepEqual(drawn, [
      { x1: 0, y1: 0, x2: 0, y2: 10, color: "#4f8ff7", width: 2 },
      { clear: true },
      { shape: "box", x: 10, y: 20, width: 30, height: 40, color: "red" },
      { shape: "circle", x: 0, y: 0, radius: 5, color: "red" },
      { shape: "text", text: "Score: 3", x: -50, y: 100, size: 16, color: "red" },
      { shape: "text", text: "Big", x: 0, y: 0, size: 30, color: "red" },
      { x1: 0, y1: 10, x2: 50, y2: 60, color: "red", width: 2 },
    ], engine);
  }
});

// ---------- random numbers ----------

// Real randomness has to be given; a run handed to the VM gets the same numbers again.
test("random number from uses the randomness it's given, and a hand-over to the VM gets the same numbers", () => {
  const counts = new Map();
  run("repeat 6000 times\n    say random number from 1 to 3\nend", (line) => counts.set(line, (counts.get(line) ?? 0) + 1), { random: Math.random });
  assert.deepEqual([...counts.keys()].sort(), ["1", "2", "3"]);
  for (const n of counts.values()) assert.ok(n > 1700 && n < 2300, `${n} of 6000`); // about a third each
  const deep = "say random number from 1 to 1000000\nto deep with n\n    if n is 0\n        return random number from 1 to 1000000\n    end\n    return deep(n - 1)\nend\nsay deep(3000)";
  const real = () => Math.random();
  for (const engine of ENGINES) {
    const fixed = [0.5, 0.25, 0.75];
    let i = 0;
    const random = () => fixed[i++ % fixed.length];
    assert.equal(output(deep, { engine, random }), "500001\n250001", engine);
    assert.equal(i, 2, `${engine} asked for ${i} random numbers`); // the VM's second run got them again, not new ones
  }
  assert.notEqual(output("say random number from 1 to 1000000000", { random: real }), output("say random number from 1 to 1000000000", { random: real }));
});

// ---------- sound ----------

// What each engine hands to `play`, in order, and what it says and stops with, as `streams` has it.
function sounds(source, options = {}) {
  const played = [];
  const { log } = streams(source, { ...options, play: (sound) => played.push(sound) });
  return { played, log };
}
const NOTE = (hertz, seconds) => ({ hertz, seconds });

test("play note and play a beep make the same sounds on all three engines, and in the compiler written in Moth", () => {
  const source = [
    'play note "C" for 0.5 seconds', // middle C: octave 4 unless it says
    'play note "A4" for 200 milliseconds',
    "play a beep",
    "play note 440 for 1 second", // a number is a pitch in hertz
    'play note "rest" for 0.25 seconds', // silence, which still takes its turn
    'play note "Bb3" for 1 minute',
    'play note "c#5" for 10 milliseconds',
    'play note "Cb4" for 0 seconds', // B3, the B below
    'play note "B#9" for 1 millisecond', // C10
    'play note "A0" for 0.1 seconds',
    "set tune to list of \"E\", \"D\", 523.25",
    "for each pitch in tune",
    "    play note pitch for 3 * 100 milliseconds", // the unit at the end counts what comes before it
    "end",
  ].join("\n");
  const want = [NOTE(261.6255653005986, 0.5), NOTE(440, 0.2), NOTE(880, 0.2), NOTE(440, 1), NOTE(0, 0.25), NOTE(233.08188075904496, 60),
    NOTE(554.3652619537442, 0.01), NOTE(246.94165062806206, 0), NOTE(16744.036179238312, 0.001), NOTE(27.5, 0.1),
    NOTE(329.6275569128699, 0.3), NOTE(293.6647679174076, 0.3), NOTE(523.25, 0.3)];
  for (const engine of ENGINES) assert.deepEqual(sounds(source, { engine }), { played: want, log: [] }, engine);
  const moth = mothCompiler(COMPILER);
  const cases = [
    source,
    // the words a sound is made of are still names, and the phrases only start where nothing else could
    'set play to "a"\nset note to 2\nset beep to 3\nset a to 4\nsay play + note + beep + a\nto play_it with note\n    play note note for 1 second\nend\nplay_it(30)',
    'to play with a\n    say "my own " a\nend\nplay 3\nplay(4)',
    'play note "H" for 1 second',
    'play note "C" for -1 seconds',
    'play note "C" for -n seconds',
    'play note "C" for 1',
    'play note "C"',
    "play note",
    "play beep",
    "beep",
    'play note "C" for 2 km',
    'when a key is pressed with key\n    play note key for 100 milliseconds\nend\nevery 1 second\n    play a beep\nend',
  ];
  for (const s of cases) {
    assert.deepEqual(compiled(moth, s), compiled(compileToJs, s), s);
    try {
      assert.equal(format(format(s)), format(s), s);
    } catch (err) {
      if (!(err instanceof MothError)) throw err;
    }
  }
  assert.deepEqual(sounds(cases[1]).log, [["out", "a234"]]);
  assert.deepEqual(sounds(cases[1]).played, [NOTE(30, 1)]);
  assert.deepEqual(sounds(cases[2]).log, [["out", "my own 3"], ["out", "my own 4"]]);
  // tidying: one space between the pieces, as everywhere
  assert.equal(format('play   note  "C"   for 0.5   seconds\n  play  a   beep\nif yes\nplay note -1 for - 2 seconds\nend'),
    'play note "C" for 0.5 seconds\nplay a beep\nif yes\n    play note -1 for -2 seconds\nend\n');
});

test("a sound's mistakes say what's wrong, the same on all three engines, and the checker finds them without running", () => {
  const hint = '(write A to G, maybe with # or b and an octave from 0 to 9, like "C#4", or "rest")';
  const mistakes = [
    ['play note "H" for 1 second', `there is no note called 'H' ${hint}`],
    ['play note "C10" for 1 second', `there is no note called 'C10' ${hint}`],
    ['play note "C4 " for 1 second', `there is no note called 'C4 ' ${hint}`],
    ['play note "Cbb" for 1 second', `there is no note called 'Cbb' ${hint}`],
    ['play note "" for 1 second', `there is no note called '' ${hint}`],
    ["play note 5 for 1 second", "a note's pitch is from 20 to 20000 hertz, not 5"],
    ["play note -440 for 1 second", "a note's pitch is from 20 to 20000 hertz, not -440"],
    ["play note 20000.5 for 1 second", "a note's pitch is from 20 to 20000 hertz, not 20000.5"],
    ["play note yes for 1 second", "'play note' needs a note like \"C4\" or a number, not yes/no"],
    ["play note list of 1 for 1 second", "'play note' needs a note like \"C4\" or a number, not a list"],
    ['play note "C" for -1 seconds', "a sound lasts from 0 to 60 seconds, not -1 seconds"],
    ['play note "C" for -5 milliseconds', "a sound lasts from 0 to 60 seconds, not -0.005 seconds"],
    ['play note "C" for 2 minutes', "a sound lasts from 0 to 60 seconds, not 120 seconds"],
    ['play note "C" for "a" seconds', "'play note ... for' needs a number, not text"],
    ['play note "H" for -1 seconds', `there is no note called 'H' ${hint}`], // the note first
    ['play note "C" for 1', "expected 'milliseconds' or 'seconds' but found the end of the code"],
    ['play note "C"', "expected 'for' but found the end of the code"],
    ['play note "C" for 1 km', "expected 'milliseconds' or 'seconds' but found the end of the code"],
    ["play beep", "there is no function called 'play' (to make a sound, write 'play note \"C\" for 1 second' or 'play a beep')"],
    ["beep", "there is no function called 'beep' (to make one, write 'play a beep')"],
  ];
  for (const [source, message] of mistakes) {
    for (const engine of ENGINES) assert.deepEqual(sounds(source, { engine }), { played: [], log: [["mistake", `line 1: ${message}`]] }, `${engine}: ${source}`);
    const found = check(source);
    assert.deepEqual(found.map((p) => p.message), [message], source);
  }
  // a try catches one, and the sounds before a mistake were played
  for (const engine of ENGINES) {
    assert.deepEqual(sounds('try\n    play note "Q" for 1 second\nif it fails with why\n    say why\nend\nplay a beep', { engine }),
      { played: [BEEP], log: [["out", `there is no note called 'Q' ${hint}`]] }, engine);
    assert.deepEqual(sounds('play note "C" for 1 second\nplay note "C" for -1 seconds\nplay a beep', { engine }),
      { played: [NOTE(261.6255653005986, 1)], log: [["mistake", "line 2: a sound lasts from 0 to 60 seconds, not -1 seconds"]] }, engine);
  }
  // the checker only speaks when it's sure: of a note or a time written out, or of a kind that can't be one
  assert.deepEqual(problems('set n to "C"\nplay note n for 0.5 seconds\nset t to "x"\nplay note 440 for t seconds\nset l to list of 1\nplay note l for 1 second'),
    ["4:1 fails: 'play note ... for' needs a number, not text", "6:1 fails: 'play note' needs a note like \"C4\" or a number, not a list"]);
  assert.deepEqual(problems('to f\n    return 1\nend\nplay note "Q" for f() seconds\nplay note f() for -1 seconds'), [`4:1 fails: there is no note called 'Q' ${hint}`]);
});

test("a hand-over to the VM plays nothing twice, and an app's handlers make sounds as events come", () => {
  const deep = 'play note "C" for 0.5 seconds\nto deep with n\n    if n is 0\n        play a beep\n        return 0\n    end\n    return deep(n - 1)\nend\nsay deep(5000)\nplay note "E" for 0.5 seconds';
  const app = 'set n to 0\nwhen a key is pressed with key\n    add 1 to n\n    play note key for n * 100 milliseconds\nend\nevery 1 second\n    play a beep\nend\nplay note "rest" for 1 second';
  for (const engine of ENGINES) {
    assert.deepEqual(sounds(deep, { engine }), { played: [NOTE(261.6255653005986, 0.5), BEEP, NOTE(329.6275569128699, 0.5)], log: [["out", "0"]] }, engine);
    const played = [];
    const running = run(app, () => {}, { engine, play: (sound) => played.push(sound) });
    running.send("key", ["e"]);
    running.handle(1);
    running.send("key", ["g"]);
    assert.throws(() => running.send("key", ["x"]), { message: `line 4: there is no note called 'x' (write A to G, maybe with # or b and an octave from 0 to 9, like "C#4", or "rest")` });
    assert.deepEqual(played, [NOTE(0, 1), NOTE(329.6275569128699, 0.1), BEEP, NOTE(391.99543598174927, 0.2)], engine);
  }
});

// The samples the playground plays, and machine code too: close to a sine wave at the note's pitch, a quarter
// as loud as it could be, starting and ending at 0 with no click, and as a WAV file what MOTH_SOUND gets.
test("a sound's samples are a wave at its pitch that fades in and out, and a WAV file holds them one after the other", () => {
  const samples = soundSamples(NOTE(440, 0.5));
  assert.equal(samples.length, 22050);
  assert.deepEqual([samples[0], samples.at(-1)], [0, 0]);
  assert.equal(Math.max(...samples.map(Math.abs)), 8192);
  for (let k = 1; k < 441; k++) assert.ok(Math.abs(samples[k]) <= Math.ceil((8192 * k) / 441), `sample ${k} is too loud for its fade`);
  let [first, last, ups] = [-1, -1, 0]; // where it goes up through 0, between the fades
  for (let k = 442; k < samples.length - 441; k++) {
    if (samples[k - 1] < 0 && samples[k] >= 0) {
      const at = k - 1 - samples[k - 1] / (samples[k] - samples[k - 1]);
      if (first < 0) first = at;
      else ups++;
      last = at;
    }
  }
  assert.ok(Math.abs((ups * 44100) / (last - first) - 440) < 0.01, `${(ups * 44100) / (last - first)} hertz`);
  for (let k = 0; k < 100; k++) assert.ok(Math.abs(samples[1000 + k] / 8192 - Math.sin((2 * Math.PI * 440 * (1000 + k)) / 44100)) < 0.002, "a sine wave, near enough");
  assert.deepEqual([...soundSamples(NOTE(0, 0.1))], new Array(4410).fill(0)); // a rest is silence
  assert.equal(soundSamples(NOTE(440, 0)).length, 0);
  const wav = soundWav([NOTE(440, 0.5), BEEP]);
  const view = new DataView(wav.buffer);
  const text = (at) => String.fromCharCode(...wav.slice(at, at + 4));
  assert.deepEqual([text(0), view.getUint32(4, true), text(8), text(12), view.getUint16(20, true), view.getUint16(22, true), view.getUint32(24, true),
    view.getUint16(34, true), text(36), view.getUint32(40, true)], ["RIFF", 36 + 2 * (22050 + 8820), "WAVE", "fmt ", 1, 1, 44100, 16, "data", 2 * (22050 + 8820)]);
  assert.equal(view.getInt16(44 + 2 * 100, true), samples[100]);
  assert.equal(soundWav([]).length, 44);
});

// ---------- apps ----------

const APP = [
  "set count to 0",
  'say "ready"',
  "when a key is pressed with key",
  "    add 1 to count",
  '    say "key " key " (" count ")"',
  "end",
  "when the mouse is clicked with x and y",
  '    say "click at " x ", " y',
  "    draw circle at x, y size 3",
  "end",
  "every 100 milliseconds",
  '    say "tick " count',
  "end",
  "when a key is pressed",
  '    say "and again"',
  "end",
].join("\n");

test("an app sets up its handlers, then each event runs the ones waiting for it, on all three engines", () => {
  for (const engine of ENGINES) {
    const said = [];
    const drawn = [];
    const app = run(APP, (line) => said.push(line), { engine, draw: (d) => drawn.push(d) });
    assert.deepEqual(app.waits, [{ event: "key" }, { event: "click" }, { event: "every", interval: 100 }, { event: "key" }], engine);
    assert.deepEqual(said, ["ready"], engine);
    app.send("key", ["left"]);
    app.send("click", [10, -20]);
    app.handle(2);
    app.send("key", ["a"]);
    app.send("drag", [1, 1]); // nothing waits for it
    assert.deepEqual(said, ["ready", "key left (1)", "and again", "click at 10, -20", "tick 1", "key a (2)", "and again"], engine);
    assert.deepEqual(drawn, [{ shape: "circle", x: 10, y: -20, radius: 3, color: "#4f8ff7" }], engine);
  }
  assert.equal(run('say "no handlers"', () => {}), undefined);
});

test("a handler's mistake says where, each event gets its own steps, and going too deep inside one moves the app to the VM", () => {
  const source = [
    "set total to 0",
    "to deep with n",
    "    if n is 0",
    "        return random number from 1 to 1000000",
    "    end",
    "    return deep(n - 1)",
    "end",
    "when a key is pressed with key",
    '    if key is "x"',
    "        say 1 / 0",
    "    end",
    '    if key is "deep"',
    '        say "deep " deep(3000)',
    "    end",
    "    add 1 to total",
    '    say "total " total',
    "end",
    "every 1 second",
    "    repeat 3000 times",
    "        add 1 to total",
    "    end",
    "end",
  ].join("\n");
  for (const engine of ENGINES) {
    const said = [];
    const app = run(source, (line) => said.push(line), { engine, maxSteps: 5000 });
    app.send("key", ["a"]);
    app.handle(1);
    app.handle(1); // 3,000 rounds each time: more than 5,000 in all, but each event counts its own
    app.send("key", ["deep"]); // too deep for the JIT and WebAssembly: the VM runs it all again, then this
    app.send("key", ["b"]);
    assert.deepEqual(said, ["total 1", "deep 627074", "total 6002", "total 6003"], engine);
    assert.throws(() => app.send("key", ["x"]), { name: "Error", message: "line 10: can't divide by zero" }, engine);
  }
});

// ---------- buttons and text boxes ----------

// A list to add to: a text box, and buttons that read it. "Deep" goes too deep for the JIT and WebAssembly, so
// the app moves to the VM in the middle, which must have what was typed in the box by then.
const FORM = [
  "set items to empty list",
  "to show",
  "    clear",
  '    draw text box "Item" at -100, 100',
  '    draw button "Add" at 110, 100',
  '    draw button "Deep" at 110, 60',
  "    for each i from 1 to length of items",
  "        draw item i of items at -100, 80 - 20 * i",
  "    end",
  "end",
  "to deep with n",
  "    if n is 0",
  '        return the text in the text box "Item"',
  "    end",
  "    return deep(n - 1)",
  "end",
  'when the button "Add" is clicked',
  '    add the text in the text box "Item" to items',
  '    say "added " the text in the text box "Item"',
  '    clear the text box "Item"',
  "    show()",
  "end",
  'when the button "Deep" is clicked',
  '    say "deep " deep(3000)',
  "end",
  'when enter is pressed in the text box "Item" with words',
  '    say "enter " words',
  "end",
  "when the mouse is clicked with x and y",
  '    say "click " x " " y',
  "end",
  "when a key is pressed with key",
  '    say "key " key',
  "end",
  "show()",
].join("\n");

test("buttons and text boxes take their clicks and keys, and keep what's typed through a move to the VM, on all three engines", () => {
  const drawings = [];
  for (const engine of ENGINES) {
    const said = [];
    const drawn = [];
    const app = run(FORM, (line) => said.push(line), { engine, draw: (d) => drawn.push(d) });
    assert.deepEqual(app.waits, [{ event: "button", label: "Add" }, { event: "button", label: "Deep" }, { event: "enter", label: "Item" },
      { event: "click" }, { event: "key" }], engine);
    app.send("key", ["a"]); // nothing has the focus: the key is the program's
    app.send("type", ["zz"]); // and typing goes nowhere
    app.send("click", [0, 110]); // the box: the focus, and not a click for the program
    app.send("key", ["h"]);
    app.send("type", ["H"]);
    app.send("type", ["i\n"]); // a control character is dropped
    app.send("key", ["x"]);
    app.send("key", ["enter"]);
    app.send("click", [120, 110]); // "Add", which leaves the focus where it was
    app.send("type", ["Yo"]);
    app.send("click", [115, 70]); // "Deep", too deep for the JIT and WebAssembly
    app.send("key", ["backspace"]);
    app.send("click", [0, -200]); // nothing there: the focus goes, and the program gets the click
    app.send("key", ["b"]);
    app.send("type", ["q"]);
    app.send("click", [160, 130]); // the corner of "Add" is inside it
    assert.deepEqual(said, ["key a", "enter Hi", "added Hi", "deep Yo", "click 0 -200", "key b", "added Y"], engine);
    assert.deepEqual(drawn.slice(0, 5), [
      { clear: true },
      { shape: "textbox", label: "Item", text: "", focused: false, cursor: 0, anchor: 0, left: 0, top: 0, x: -100, y: 100, width: 200, height: 30, color: "#4f8ff7" },
      { shape: "button", text: "Add", x: 110, y: 100, width: 50, height: 30, color: "#4f8ff7" },
      { shape: "button", text: "Deep", x: 110, y: 60, width: 60, height: 30, color: "#4f8ff7" },
      { textbox: "Item", text: "", focused: true, cursor: 0, anchor: 0, left: 0, top: 0 },
    ], engine);
    drawings.push(drawn);
  }
  assert.deepEqual(drawings[1], drawings[0]);
  assert.deepEqual(drawings[2], drawings[0]);
  const said = [];
  const full = run(FORM.replace('say "enter " words', 'say length of words'), (line) => said.push(line), { engine: "vm" });
  full.send("click", [0, 110]);
  full.send("type", ["x".repeat(50)]);
  full.send("key", ["enter"]);
  full.send("key", ["backspace"]);
  full.send("type", ["😀"]);
  full.send("key", ["enter"]);
  assert.deepEqual(said, ["40", "40"]); // a box holds 40 letters, an emoji counted as one
});

test("a button or text box is its label, the one drawn last is on top, and clear leaves what's typed", () => {
  const source = [
    'draw button "A" at 0, 0',
    'draw text box 7 at 0, 0', // on top of "A", and called "7"
    'when the button "A" is clicked',
    '    say "A"',
    "end",
    "when enter is pressed in the text box 3 + 4",
    '    say "entered " the text in the text box "7"',
    '    clear',
    '    draw button "A" at 100, 100',
    '    draw button "A" at -100, -100',
    "end",
  ].join("\n");
  for (const engine of ENGINES) {
    const said = [];
    const app = run(source, (line) => said.push(line), { engine });
    app.send("click", [5, 5]); // the box, which is on top
    app.send("type", ["ok"]);
    app.send("key", ["enter"]);
    app.send("type", ["more"]); // its box is gone, and the focus with it
    app.send("click", [105, 105]);
    app.send("click", [-95, -95]);
    app.send("click", [5, 5]);
    assert.deepEqual(said, ["entered ok", "A", "A"], engine);
  }
});

// ---------- fixing ----------

test("suggestedFix puts a misspelled name or a symbol from another language right, and only where the code has it", () => {
  const fixOf = (source) => {
    let p = check(source).find((q) => q.kind === "error" || q.kind === "fails");
    if (!p) {
      try {
        run(source, () => {});
      } catch (err) {
        p = { line: err.line, col: err.col, message: err.reason };
      }
    }
    return suggestedFix(source, { line: p.line, col: p.col, reason: p.message });
  };
  assert.deepEqual(fixOf("set total to 1\nsay totl"), { line: 2, col: 5, length: 4, text: "total" });
  assert.deepEqual(fixOf("set Total to 1\nsay TOTL"), { line: 2, col: 5, length: 4, text: "total" }); // whatever the capitals
  assert.deepEqual(fixOf('sya "hi"'), { line: 1, col: 1, length: 3, text: "say" });
  assert.deepEqual(fixOf("to greet\n    say 1\nend\ngret()"), { line: 4, col: 1, length: 4, text: "greet" });
  assert.deepEqual(fixOf('set pet to record with name "Rex"\nsay nmae of pet'), { line: 2, col: 5, length: 4, text: "name" }); // found only by running
  assert.deepEqual(fixOf("if 3 > 2\n    say 1\nend"), { line: 1, col: 6, length: 1, text: "is greater than" });
  assert.deepEqual(fixOf("if 3 >= 2\n    say 1\nend"), { line: 1, col: 6, length: 2, text: "is at least" });
  assert.deepEqual(fixOf("if 3 != 2\n    say 1\nend"), { line: 1, col: 6, length: 2, text: "is not" });
  assert.equal(fixOf("set x = 5"), null); // set, or is? Only the person knows
  assert.equal(suggestedFix("say totals", { line: 1, col: 5, reason: "'totl' has no value yet. Did you mean 'total'?" }), null); // not what the code has there
  assert.equal(suggestedFix("say x", { line: 3, col: 1, reason: "'x' has no value yet. Did you mean 'y'?" }), null); // no such line
});

// ---------- pictures from files ----------

// Small PNGs and BMPs made by picture-cases.js: every PNG colour type at every bit depth, interlaced or not,
// with every filter and every kind of compressed block, and transparency where the type has it; BMPs of every
// bit count, header and mask. The pixels each must come out as are worked out there, apart from the decoder.
test("draw picture draws PNGs of every colour type and depth, and BMPs, as they are, on all three engines", () => {
  const cases = [...pngCases(1), ...pngCases(2), ...bmpCases(1)];
  const files = Object.fromEntries(cases.map((c, i) => [`c${i}.${c.bytes[0] === 137 ? "png" : "bmp"}`, c.bytes]));
  const source = Object.keys(files).map((name, i) => `draw picture "${name}" at ${i}, 0 - ${i}\nset b to read bytes "${name}"\ndraw picture b at 0, 0 size 2.5 by 1 / 3`).join("\n");
  for (const engine of ENGINES) {
    const drawn = [];
    run(source, () => {}, { engine, disk: memoryDisk(files), draw: (d) => drawn.push(d) });
    assert.equal(drawn.length, 2 * cases.length, engine);
    cases.forEach((c, i) => {
      const image = { width: c.width, height: c.height, pixels: c.pixels };
      assert.deepEqual(drawn[2 * i], { shape: "picture", x: i, y: 0 - i, width: c.width, height: c.height, image }, `${engine}: case ${i}`);
      assert.deepEqual(drawn[2 * i + 1], { shape: "picture", x: 0, y: 0, width: 2.5, height: 0.33, image }, `${engine}: case ${i}, from its bytes`);
      assert.equal(drawn[2 * i].image, drawn[2 * i + 1].image, "a picture drawn again is the same image"); // so a page draws it from one canvas
    });
  }
});

// Each broken file must stop at the same mistake on every engine: the ones broken by hand at the one each
// names, and the ones cut short or with a byte changed at whatever it is.
test("a broken picture, or a file that isn't one, is a mistake that says what's wrong, the same on all three engines", () => {
  const fails = (source, files, engine) => error(source, { engine, disk: memoryDisk(files) }).message;
  for (const [bytes, says] of handmadeBroken()) {
    for (const engine of ENGINES) {
      assert.equal(fails('draw picture "x.png" at 0, 0', { "x.png": bytes }, engine), `line 1: 'x.png' ${says}`, `${engine}: ${says}`);
      const plural = says.replace(/^is /, "are ").replace(/^isn't /, "aren't ");
      assert.equal(fails('draw picture read bytes "x.png" at 0, 0', { "x.png": bytes }, engine), `line 1: these bytes ${plural}`, `${engine}: ${says}`);
    }
  }
  const broken = brokenPictures(1);
  const reasons = new Set();
  broken.forEach((bytes, i) => {
    const said = ENGINES.map((engine) => {
      try {
        run('draw picture "b" at 0, 0', () => {}, { engine, disk: memoryDisk({ b: bytes }) });
        return "drawn";
      } catch (err) {
        if (!(err instanceof MothError)) throw err;
        return err.message;
      }
    });
    assert.deepEqual(said, [said[0], said[0], said[0]], `broken picture ${i}`);
    reasons.add(said[0].replace(/^line 1: 'b' /, ""));
  });
  assert.ok(reasons.size >= 7, [...reasons].join("\n")); // most ways of being broken, and some that still draw
});

test("draw picture reads a file as read bytes does, and keeps picture a name", () => {
  const png = pngCases(1)[0];
  const disk = { "cat.png": png.bytes };
  const drawn = (source) => {
    const made = [];
    run(source, () => {}, { disk: memoryDisk(disk), draw: (d) => made.push(d) });
    return made.map((d) => (d.shape === "picture" ? `picture ${d.x},${d.y} ${d.width}x${d.height}` : `${d.shape} ${d.text}`));
  };
  assert.deepEqual(drawn('draw picture "cat" + ".png" at 1, 2'), [`picture 1,2 ${png.width}x${png.height}`]);
  assert.deepEqual(drawn('draw picture item 1 of (list of "cat.png") at 1, 2 size 3 by 4'), ["picture 1,2 3x4"]);
  assert.deepEqual(drawn('draw picture (read bytes "cat.png") at 1, 2'), [`picture 1,2 ${png.width}x${png.height}`]); // a bracket with a space before it
  assert.deepEqual(drawn('set picture to "hi"\ndraw picture at 0, 0'), ["text hi"]); // `picture` alone is a name, as it was
  assert.deepEqual(drawn('set sprite to record with picture "cat"\ndraw picture of sprite at 0, 0'), ["text cat"]);
  assert.deepEqual(drawn("to picture with n\n    return n * 2\nend\ndraw picture(4) at 0, 0"), ["text 8"]);
  assert.deepEqual(drawn('set picture to 2\ndraw picture + 1 at 0, 0\ndraw picture is 2 at 0, 0'), ["text 3", "text yes"]);
  // a file that can't be read is the mistake reading it would be
  assert.equal(error('draw picture "dog.png" at 0, 0', { disk: memoryDisk(disk) }).message, "line 1: there is no file called 'dog.png'");
  const refusing = { read: () => { throw new Error("this program isn't allowed to read files (start it with --allow-read)"); } };
  assert.equal(error('draw picture "cat.png" at 0, 0', { disk: refusing }).message, "line 1: can't read 'cat.png': this program isn't allowed to read files (start it with --allow-read)");
  // and tidying and the compiler written in Moth read it as the parser does
  const moth = mothCompiler(COMPILER);
  for (const source of ['draw picture "cat.png" at 1, 2 size 3 by 4', 'draw picture  (read bytes "cat.png")  at 1, 2', "set picture to 2\ndraw picture + 1 at 0, 0"]) {
    assert.deepEqual(compiled(moth, source), compiled(compileToJs, source), source);
    assert.equal(format(source), `${source.replace(/ {2}/g, " ")}\n`, source);
  }
});

// Sending: `send` and `read ... with headers` go through the disk the program is given, on every engine, as
// { address, data, headers }; a run handed over to the VM part way gets the replies it had, and sends nothing twice
test("send and read with headers go through the disk on every engine, and a hand-over to the VM sends nothing twice", () => {
  const source = 'set h to dictionary where "Authorization" is "Bearer t"\nset first to send (record with a 1) to "https://api.test/one"\nto deep with n\n    if n is 0\n        return send "two" to "https://api.test/two" with headers h\n    end\n    return deep(n - 1)\nend\nsay deep(5000)\nsay first\nsay json from read "https://api.test/one" with headers h';
  for (const engine of ENGINES) {
    const disk = memoryDisk({ "https://api.test/one": '{"ok":1}', "https://api.test/two": "fine" });
    const said = [];
    run(source, (line) => said.push(line), { engine, disk });
    assert.deepEqual(said, ["fine", '{"ok":1}', '(dictionary where "ok" is 1)'], engine);
    assert.deepEqual(disk.sent, [
      { address: "https://api.test/one", data: '{"a":1}', headers: [["Content-Type", "application/json"]] },
      { address: "https://api.test/two", data: "two", headers: [["Content-Type", "text/plain; charset=utf-8"], ["Authorization", "Bearer t"]] },
    ], engine);
  }
});

// Checkboxes, text areas and lists (DESIGN §40): a click ticks a checkbox or chooses a list's item and goes to
// their handlers, a text area takes lines, the arrows move a list's choice and keep it in view, a wheel scrolls
// the list under it, and all of it comes through a move to the VM, the same on all three engines
const CONTROLS = "set fruits to list of \"apple\", \"banana\", \"cherry\", \"date\", \"elderberry\", \"fig\", \"grape\", \"kiwi\"\nto show\n    clear\n    draw checkbox \"Dark\" at -200, 200\n    draw text area \"Notes\" at -200, 50 size 250 by 100\n    draw list \"Fruits\" showing fruits at 100, 0 size 150 by 96\n    draw button \"Save\" at -200, 0\n    draw button \"Deep\" at -100, 0\nend\nto deep with n\n    if n is 0\n        return 0\n    end\n    return deep(n - 1)\nend\nshow()\ntick the checkbox \"Dark\"\nsay \"at the start \" the checkbox \"Dark\" is ticked \" \" the choice in the list \"Fruits\"\nwhen the checkbox \"Dark\" is clicked\n    say \"dark \" the checkbox \"Dark\" is ticked \" \" the checkbox \"Dark\" is not ticked\n    show()\nend\nwhen an item is chosen in the list \"Fruits\" with fruit\n    say \"chose \" fruit \" \" the choice in the list \"Fruits\"\n    show()\nend\nwhen the button \"Save\" is clicked\n    say \"notes [\" the text in the text area \"Notes\" \"]\"\n    clear the text area \"Notes\"\nend\nwhen the button \"Deep\" is clicked\n    say \"deep \" deep(5000)\nend\nwhen the mouse is clicked with x and y\n    say \"click \" x \" \" y\nend\nwhen a key is pressed with key\n    say \"key \" key\nend";
const CONTROL_EVENTS = [["click",[-195,205]],["click",[-150,100]],["type",["Hello"]],["key",["enter"]],["type",["world"]],["key",["backspace"]],["click",[110,90]],["key",["down"]],["click",[-95,15]],["key",["down"]],["key",["down"]],["key",["down"]],["scroll",[110,50,10]],["scroll",[0,-200,3]],["key",["up"]],["key",["x"]],["click",[-195,15]],["click",[110,2]],["click",[0,-200]],["key",["y"]],["click",[-150,100]],["key",["enter"]],["key",["enter"]],["type",["z"]]];

test("checkboxes, text areas and lists take their clicks, keys and wheel, through a move to the VM, on all three engines", () => {
  const drawings = [];
  for (const engine of ENGINES) {
    const said = [];
    const drawn = [];
    const app = run(CONTROLS, (line) => said.push(line), { engine, draw: (d) => drawn.push(d) });
    assert.deepEqual(app.waits.slice(0, 2), [{ event: "checkbox", label: "Dark" }, { event: "choice", label: "Fruits" }], engine);
    for (const [event, inputs] of CONTROL_EVENTS) app.send(event, inputs);
    assert.deepEqual(said, ["at the start yes nothing","dark no yes","chose apple apple","chose banana banana","deep 0","chose cherry cherry","chose date date","chose elderberry elderberry","chose date date","notes [Hello\nworl]","chose grape grape","click 0 -200","key y"], engine);
    drawings.push(drawn);
  }
  assert.deepEqual(drawings[1], drawings[0]);
  assert.deepEqual(drawings[2], drawings[0]);
  assert.deepEqual(drawings[0].filter((d) => d.shape === "list" || d.shape === "checkbox" || d.shape === "textarea").slice(0, 3), [
    { shape: "checkbox", label: "Dark", ticked: false, x: -200, y: 200, width: 68, height: 20, color: "#4f8ff7" },
    { shape: "textarea", label: "Notes", text: "", focused: false, cursor: 0, anchor: 0, left: 0, top: 0, x: -200, y: 50, width: 250, height: 100, color: "#4f8ff7" },
    { shape: "list", label: "Fruits", items: ["apple", "banana", "cherry", "date", "elderberry", "fig", "grape", "kiwi"], chosen: -1, top: 0, focused: false,
      x: 100, y: 0, width: 150, height: 96, color: "#4f8ff7" },
  ]);
});

test("a list's and a text area's sizes, and what they need", () => {
  const drawn = [];
  run('draw list "L" showing (list of 1, "two", yes) at 0, 0\ndraw text area "T" at 0, 0', () => {}, { draw: (d) => drawn.push(d) });
  assert.deepEqual(drawn.map((d) => [d.shape, d.items, d.width, d.height]), [["list", ["1", "two", "yes"], 200, 144], ["textarea", undefined, 300, 120]]);
  for (const [source, message] of [
    ['draw list "L" showing 5 at 0, 0', "line 1: 'draw list ... showing' needs a list, not a number"],
    ['draw list "L" showing (list of 1) at 0, 0 size 0 by 10', "line 1: a list's size is a number above 0, not 0"],
    ['draw text area "T" at 0, "x"', "line 1: 'draw text area' needs numbers, not text"],
    ['say the checkbox "x"', "line 1: expected 'is' but found the end of the code"],
  ]) {
    for (const engine of ENGINES) assert.throws(() => run(source, () => {}, { engine }), { message }, `${engine}: ${source}`);
  }
});

// Editing what's typed (DESIGN §41): a click puts the cursor between the letters it's nearest, a letter
// every 10 across from the first in view; the arrows, Home and End move it and select with Shift; what's
// selected is replaced by what's typed, taken off by Backspace, Delete or Ctrl+X, and Ctrl+A selects it all.
// A text area's up and down go between lines, and a drag from a click selects. With nothing focused, a key's
// Shift is dropped and a key with Ctrl goes nowhere. A text box shows from its 9th letter once 26 are typed.
const EDITOR = "draw text box \"Name\" at -200, 100\ndraw text area \"Notes\" at -200, -100 size 200 by 68\ndraw button \"Show\" at 100, 100\ndraw button \"Deep\" at 100, 50\nto deep with n\n    if n is 0\n        return the text in the text area \"Notes\"\n    end\n    return deep(n - 1)\nend\nwhen the button \"Show\" is clicked\n    say \"[\" + the text in the text box \"Name\" + \"] [\" + the text in the text area \"Notes\" + \"]\"\nend\nwhen the button \"Deep\" is clicked\n    say \"deep \" + deep(5000)\nend\nwhen a key is pressed with key\n    say \"key \" + key\nend\nwhen enter is pressed in the text box \"Name\" with words\n    say \"enter \" + words\nend";
const EDIT_EVENTS = ["key shift+left","key ctrl+a","click -150 110","type Hello world","key left","key left","key left","key left","key left","key shift+left","key shift+left","key shift+left","key shift+left","key shift+left","key shift+left","type Big ","click 100 110","key home","key shift+end","key ctrl+x","type abcdefghijklmnopqrstuvwxyz","click -162 110","type _","key delete","click 100 110","key ctrl+a","key backspace","type xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx","key enter","key right","key shift+home","key ctrl+c","key ctrl+v","type ab","click 100 110","click -190 -40","type one\ntwo\nthree\nfour","key up","key up","key shift+up","type !","click 100 110","key enter","key end","key shift+right","key shift+down","type ?","click 100 110","click -170 -60","drag -140 -80","drag -120 -80","type <>","click 100 110","click 105 60","key down","key down","key end","type Z","key up","key up","key up","key up","key home","key delete","click 100 110","click 0 -200","key shift+down","key ctrl+z","key up","click -190 -40","key ctrl+a","type 1\n2\n3\n4\n5","key up","key up","key up","click 100 110"];

test("the cursor moves, selects and edits in text boxes and text areas, through a move to the VM, on all three engines", () => {
  const drawings = [];
  for (const engine of ENGINES) {
    const said = [];
    const drawn = [];
    const app = run(EDITOR, (line) => said.push(line), { engine, draw: (d) => drawn.push(d) });
    for (const event of EDIT_EVENTS) {
      const [what, rest] = [event.slice(0, event.indexOf(" ")), event.slice(event.indexOf(" ") + 1)];
      app.send(what, what === "key" || what === "type" ? [rest] : rest.split(" ").map(Number));
    }
    assert.deepEqual(said, ["key left","[Big world] []","[abcdefghijk_mnopqrstuvwxyz] []","enter xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx","[ab] []","[ab] [one!\nthree\nfour]","[ab] [one!\n?four]","[ab] [one!\n?f<>]","deep one!\n?f<>","[ab] [ne!\n?f<>Z]","key down","key up","[ab] [1\n2\n3\n4\n5]"], engine);
    assert.deepEqual(drawn.filter((d) => d.textbox === "Name" && d.left === 8)[0],
      { textbox: "Name", text: "abcdefghijklmnopqrstuvwxyz", focused: true, cursor: 26, anchor: 26, left: 8, top: 0 }, engine);
    assert.deepEqual(drawn.filter((d) => d.textbox === "Notes").slice(-2).map(({ cursor, anchor, top }) => [cursor, anchor, top]), [[5, 5, 2], [3, 3, 1]], engine);
    drawings.push(drawn);
  }
  assert.deepEqual(drawings[1], drawings[0]);
  assert.deepEqual(drawings[2], drawings[0]);
});

// Dropdowns and sliders (DESIGN §42): a click opens a dropdown, and one on an item below it chooses that item;
// any click while it's open closes it and does nothing else; the arrows choose, Enter and Space open it and
// Escape closes it, and the wheel scrolls its items. A slider moves to a click and a drag from it, and with the
// arrows, Home and End, a whole number in its range, which `set the slider` is kept to as well.
const CONTROLS_MORE = "set sizes to list of \"small\", \"medium\", \"large\", \"huge\", \"giant\", \"titanic\", \"cosmic\"\nto show\n    clear\n    draw dropdown \"Size\" showing sizes at -200, 150\n    draw slider \"Volume\" from 0 to 10 at -200, 50\n    draw button \"Show\" at 100, 150\n    draw button \"Deep\" at 100, 100\nend\nto deep with n\n    if n is 0\n        return the value of the slider \"Volume\"\n    end\n    return deep(n - 1)\nend\nshow()\nset the slider \"Volume\" to 7\nsay \"start \" (the value of the slider \"Volume\") \" \" (the choice in the dropdown \"Size\")\nwhen an item is chosen in the dropdown \"Size\" with size\n    say \"size \" size \" \" the choice in the dropdown \"Size\"\n    show()\nend\nwhen the slider \"Volume\" is moved with v\n    say \"volume \" v \" \" the value of the slider \"Volume\"\n    show()\nend\nwhen the button \"Show\" is clicked\n    say \"show \" (the value of the slider \"Volume\") \" \" (the choice in the dropdown \"Size\")\nend\nwhen the button \"Deep\" is clicked\n    say \"deep \" deep(5000)\n    set the slider \"Volume\" to 99\n    say \"set \" the value of the slider \"Volume\"\nend\nwhen a key is pressed with key\n    say \"key \" key\nend\nwhen the mouse is clicked with x and y\n    say \"click \" x \" \" y\nend";
const CONTROL_MORE_EVENTS = ["click -150 160","click -150 140","key down","key enter","key escape","key space","scroll -150 100 3","click -150 10","click -150 160","click 0 0","click 0 0","click -100 60","drag -10 60","drag 300 60","key left","key home","key end","key right","key x","key shift+left","click 110 160","click 110 110","key left","click 110 160","click -150 160","key up","key up","click -150 175","key down","click 0 -200","key down"];

test("dropdowns and sliders take their clicks, drags, keys and wheel, through a move to the VM, on all three engines", () => {
  const drawings = [];
  for (const engine of ENGINES) {
    const said = [];
    const drawn = [];
    const app = run(CONTROLS_MORE, (line) => said.push(line), { engine, draw: (d) => drawn.push(d) });
    assert.deepEqual(app.waits.slice(0, 2), [{ event: "choice", label: "Size" }, { event: "slider", label: "Volume" }], engine);
    for (const event of CONTROL_MORE_EVENTS) {
      const [what, rest] = [event.slice(0, event.indexOf(" ")), event.slice(event.indexOf(" ") + 1)];
      app.send(what, what === "key" || what === "type" ? [rest] : rest.split(" ").map(Number));
    }
    assert.deepEqual(said, ["start 7 nothing","size small small","size medium medium","size cosmic cosmic","click 0 0","volume 5 5","volume 10 10","volume 9 9","volume 0 0","volume 10 10","volume 9 9","show 9 cosmic","deep 9","set 10","volume 9 9","show 9 cosmic","size titanic titanic","size giant giant","size titanic titanic","click 0 -200","key down"], engine);
    drawings.push(drawn);
  }
  assert.deepEqual(drawings[1], drawings[0]);
  assert.deepEqual(drawings[2], drawings[0]);
  assert.deepEqual(drawings[0].slice(1, 3), [
    { shape: "dropdown", label: "Size", items: ["small", "medium", "large", "huge", "giant", "titanic", "cosmic"], chosen: -1, top: 0, open: false, focused: false,
      x: -200, y: 150, width: 200, height: 30, color: "#4f8ff7" },
    { shape: "slider", label: "Volume", value: 0, from: 0, to: 10, focused: false, x: -200, y: 50, width: 200, height: 20, color: "#4f8ff7" },
  ]);
});

test("choosing a file is asking for one: nothing for no answer, and a slider's and a dropdown's mistakes", () => {
  for (const engine of ENGINES) {
    const asked = [];
    const answers = ["notes.txt", ""];
    const said = [];
    run('set f to choose a file to open\nsay "open: " + f\nset g to choose a file to save\nsay g\nset choose to 3\nsay choose', (line) => said.push(line),
      { engine, ask: (question) => (asked.push(question), answers.shift()) });
    assert.deepEqual([asked, said], [["Which file to open?", "Which file to save?"], ["open: notes.txt", "nothing", "3"]], engine);
    for (const [source, message] of [
      ['draw dropdown "D" showing 5 at 0, 0', "line 1: 'draw dropdown ... showing' needs a list, not a number"],
      ['draw slider "S" from 0 to "x" at 0, 0', "line 1: 'draw slider' needs numbers, not text"],
      ['set the slider "S" to "loud"', "line 1: 'set the slider' needs a number, not text"],
      ['when the slider "S" is moved with a, b\n    say a\nend', "line 1: 'when the slider is moved' gives 1 value, so name one input or none, not 2"],
    ]) {
      assert.throws(() => run(source, () => {}, { engine }), { message }, `${engine}: ${source}`);
    }
  }
  const drawn = [];
  run('set the slider "S" to 70.6\ndraw slider "S" from 10.4 to -5 at 0, 0\nsay the value of the slider "S"\nsay the value of the slider "T"', () => {}, { draw: (d) => drawn.push(d) });
  assert.deepEqual(drawn, [{ shape: "slider", label: "S", value: 10, from: 10, to: -5, focused: false, x: 0, y: 0, width: 200, height: 20, color: "#4f8ff7" }]);
});

