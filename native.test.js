// The Rust engine (native/) against the JavaScript VM: every program the other tests know, thousands of
// broken and generated ones, the bundled programs, and the command line. For each, the two must say, draw,
// write and fail exactly alike, and compile to the same bytecode. Build it first: cargo build --release in native/.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { run, compile, disassemble, memoryDisk, seeded, MothError } from "./moth.js";
import examples from "./examples.js";
import { generatePrograms } from "./generate.js";
import { PROGRAMS, ERRORS, brokenPrograms } from "./cases.js";

const BINARY = fileURLToPath(new URL(`./native/target/release/moth-native${process.platform === "win32" ? ".exe" : ""}`, import.meta.url));
const skip = existsSync(BINARY) ? false : "the Rust engine isn't built (cargo build --release in native/)";
const here = (file) => readFileSync(new URL(`./${file}`, import.meta.url), "utf8");

// A job is a program and what it gets from outside: { source, files, disk, args, answers, seed, maxSteps, bytecode }.
// What it does, on the JavaScript VM, in the shape `moth-native conform` reports it.
function onJs(job) {
  const said = [];
  const drawn = [];
  const answers = job.answers ? [...job.answers] : null;
  const start = job.disk && Object.fromEntries(Object.entries(job.disk).map(([name, d]) => [name, d.text ?? new Uint8Array(d.bytes)]));
  const disk = start && memoryDisk(start);
  let bytecode = null;
  let app = [];
  let error = null;
  try {
    const files = (name) => job.files?.[name];
    if (job.bytecode) bytecode = disassemble(compile(job.source, { files }));
    const made = run(job.source, (line) => said.push(line), {
      engine: "vm", maxSteps: job.maxSteps ?? Infinity, draw: (d) => drawn.push(d), files, disk, args: job.args ?? [], random: seeded(job.seed ?? 1),
      ask: answers && (() => (answers.length ? answers.shift() : null)),
    });
    app = made?.waits ?? [];
  } catch (err) {
    if (!(err instanceof MothError)) throw err;
    error = { message: err.message, col: err.col, trail: err.trail.map(({ name, line, col, file, times }) => ({ name, line, col, file: file ?? null, times })) };
  }
  const left = disk && Object.fromEntries([...disk.files].map(([name, data]) => [name, typeof data === "string" ? { text: data } : { bytes: [...data] }]));
  return JSON.parse(JSON.stringify({ said, drawn, error, disk: left ?? null, app, bytecode })); // as JSON has it: Infinity is null
}

// Many jobs at once on the Rust engine, one line of JSON each way
function onRust(jobs) {
  const ran = spawnSync(BINARY, ["conform"], { input: jobs.map((job) => JSON.stringify(job)).join("\n") + "\n", encoding: "utf8", maxBuffer: 1 << 30 });
  assert.equal(ran.status, 0, ran.stderr);
  const lines = ran.stdout.trim().split("\n");
  assert.equal(lines.length, jobs.length, ran.stderr);
  return lines.map((line) => JSON.parse(line));
}

// Moth sees text as whole characters, so text holding half an emoji (which no file can hold, but the fuzzer
// makes by cutting one in two) can't reach the Rust engine; those programs are left out.
const HALVES = /[\ud800-\udfff]/u;
const whole = (job) => ![job.source, ...Object.values(job.files ?? {}), ...(job.answers ?? [])].some((text) => HALVES.test(text));

function agree(jobs, label) {
  jobs = jobs.filter(whole);
  const rust = onRust(jobs);
  jobs.forEach((job, i) => assert.deepEqual(rust[i], onJs(job), `${label}:\n${job.source.slice(0, 2000)}`));
  return jobs.length;
}

test("the Rust engine compiles every test program to the same bytecode, and runs it the same", { skip }, () => {
  const sources = [...Object.values(examples), ...PROGRAMS.map(([s]) => s), ...ERRORS.map(([s]) => s)];
  agree(sources.map((source) => ({ source, bytecode: true, answers: ["50", "25", "37"] })), "a test program");
});

test("the Rust engine agrees with the JavaScript VM on 5,000 randomly broken programs", { skip }, () => {
  const ran = agree(brokenPrograms(42, 5000).map((source) => ({ source, maxSteps: 10_000, bytecode: true })), "a broken program");
  assert.ok(ran > 4500);
});

test("the Rust engine agrees with the JavaScript VM on 1,500 generated programs, files and arguments too", { skip }, () => {
  const disk = { "file.txt": { text: "hello\nworld" }, "data.bin": { bytes: [1, 2, 3] } };
  agree(generatePrograms(2026, 1500).map((source) => ({ source, maxSteps: 5_000, disk, args: ["one", "2"], bytecode: true })), "a generated program");
});

test("the Rust engine runs the bundled programs the same: tools, apps, the neural network, the handwriting reader", { skip }, () => {
  const files = Object.fromEntries(["math.moth", "digits.moth", "digits-model.moth", "digit-shapes.moth", "neural.moth"].map((f) => [f, here(f)]));
  const story = here("tools/story.txt");
  const jobs = [
    { source: here("tools/picture.moth"), disk: {}, args: ["60", "40"] },
    { source: here("tools/wordcount.moth"), disk: { "story.txt": { text: story } }, args: ["story.txt"] },
    { source: `${here("tools/json.moth")}\nsay parse("[1, 2.5, \\"a\\", {\\"b\\": [true, null]}]")` },
    { source: here("tools/json.test.moth").replace('use "json.moth"', here("tools/json.moth")) },
    { source: here("apps/snake.moth") },
    { source: here("apps/paint.moth") },
    { source: here("neural.moth"), files },
    { source: here("handwriting.moth"), files, answers: ["22,26 30,12 48,5 66,10 77,24 72,42 52,62 22,94 82,94", "50,5 50,95", ""] },
    { source: here("digits-train.moth").replace(/repeat \d+ times/, "repeat 3 times"), files, disk: {}, maxSteps: 2_000_000 },
  ];
  agree(jobs, "a bundled program");
});

test("the Rust engine runs Moth's compiler written in Moth, which compiles itself to the same JavaScript as the JIT", { skip }, () => {
  const compiler = here("compiler.moth");
  const source = `${compiler}\nset made to compile(read "compiler.moth", empty list)\nsay js of made`;
  const [rust] = onRust([{ source, disk: { "compiler.moth": { text: compiler } } }]);
  assert.equal(rust.error, null);
  assert.equal(rust.said.join("\n"), onJs({ source, disk: { "compiler.moth": { text: compiler } } }).said.join("\n"));
  assert.ok(rust.said.join("\n").length > 100_000);
});

test("the Rust engine shows numbers, rounds and draws exactly as JavaScript does", { skip }, () => {
  const numbers = [
    "set x to 1",
    "repeat 3000 times",
    "    set x to x * 1.0000001 + (random number from 1 to 1000000) / (random number from 1 to 999)",
    "    say x \" \" 1 / x \" \" x * x * x \" \" 0 - x / 7",
    "end",
    "say 1 / 3, 2 / 3, 10 / 3, 0.1 + 0.2, 123456789 * 987654321, 1 / 1000000, 1 / 10000000, 2 * 1000000000000000000000",
    "set n to 1",
    "repeat 60 times",
    "    set n to n * 7",
    "    say n \" \" 1 / n",
    "end",
  ].join("\n");
  const turtle = [
    "repeat 2000 times",
    "    turn left random number from -100000 to 100000",
    "    move forward (random number from 1 to 100000) / 997",
    "end",
  ].join("\n");
  agree([1, 2, 3, 4, 5].flatMap((seed) => [{ source: numbers, seed }, { source: turtle, seed }]), "numbers");
});

test("the Rust engine treats text as JavaScript does: every character's upper and lower case, lengths, bytes", { skip }, () => {
  const chars = [];
  for (let c = 0x20; c <= 0x10ffff; c++) {
    if ((c >= 0xd800 && c <= 0xdfff) || c === 0x22 || c === 0x5c || c === 0x7f) continue;
    chars.push(String.fromCodePoint(c));
  }
  const jobs = [];
  for (let i = 0; i < chars.length; i += 20_000) {
    const text = chars.slice(i, i + 20_000).join("");
    jobs.push({ source: `set t to "${text}"\nsay uppercase of t\nsay lowercase of t\nsay length of t, length of uppercase of t, length of t as bytes` });
  }
  jobs.push({ source: 'say uppercase of "straße ﬁx ǅ" " " lowercase of "ΣΑΣ ΟΔΟΣ Σ" " " length of "😀é" " " position of "😀" in "a😀b"' });
  jobs.push({ source: 'say split "a😀b😀" by "😀" " " split "😀é" by "" " " "b" is less than "😀" " " "！" is less than "😀"' });
  let seed = 3;
  const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) % 256;
  for (let i = 0; i < 40; i++) {
    const bytes = Array.from({ length: 64 }, random);
    if (i % 4 === 0) bytes.unshift(0xef, 0xbb, 0xbf);
    jobs.push({ source: `set b to list of ${bytes.join(", ")}\nsay b as bytes as text\nsay length of (b as bytes as text)` });
  }
  agree(jobs, "text");
});

// ---------- the command line ----------

function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), "moth-native-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const CLI = fileURLToPath(new URL("./cli.js", import.meta.url));
// the same command with moth and with moth-native; `between` runs after the first
function both(args, options, between = () => {}) {
  const js = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", ...options });
  between();
  return [js, spawnSync(BINARY, args, { encoding: "utf8", ...options })];
}

test("moth-native run prints, fails, asks, reads, writes and draws as moth run does", { skip }, (t) => {
  const dir = tempDir(t);
  writeFileSync(join(dir, "shapes.moth"), "to area with w, h\n    return w * h\nend\n");
  writeFileSync(join(dir, "main.moth"), [
    'use "shapes.moth"',
    'set name to ask "Name?"',
    'say "Hi " name ", " area(3, 4)',
    "for each a in arguments",
    "    say a",
    "end",
    'write "made by " + name to "out.txt"',
    'say read "out.txt"',
    'pen color "tomato"',
    "repeat 5 times",
    "    move forward 40",
    "    turn right 144",
    "end",
    "draw box at 0, 0 size 10 by 20",
    'draw "<hi & bye>" at 5, 5',
  ].join("\n"));
  writeFileSync(join(dir, "bad.moth"), 'use "shapes.moth"\nto deep with n\n    return area(n, "x")\nend\nsay deep(2)');
  let picture;
  const [js, rust] = both(["run", "main.moth", "one", "two"], { cwd: dir, input: "Sam\n" }, () => {
    picture = readFileSync(join(dir, "main.svg"), "utf8"); // what moth drew, before moth-native draws it again
    rmSync(join(dir, "main.svg"));
  });
  assert.equal(js.status, 0, js.stderr);
  assert.equal(rust.stdout, js.stdout);
  assert.equal(rust.stderr, js.stderr);
  assert.equal(readFileSync(join(dir, "main.svg"), "utf8"), picture);
  assert.equal(readFileSync(join(dir, "out.txt"), "utf8"), "made by Sam");
  const [jsBad, rustBad] = both(["run", "bad.moth"], { cwd: dir });
  assert.equal(rustBad.status, 1);
  assert.equal(rustBad.stderr, jsBad.stderr);
  assert.match(rustBad.stderr, /^shapes\.moth:2:14: can't use '\*' on a number and text/);
  const [jsMissing, rustMissing] = both(["run", "nowhere.moth"], { cwd: dir });
  assert.equal(rustMissing.status, jsMissing.status);
  assert.equal(rustMissing.stderr.replace("moth-native:", "moth:"), jsMissing.stderr);
});

test("moth-native test and moth-native bytecode say what moth test and moth bytecode say", { skip }, (t) => {
  const dir = tempDir(t);
  writeFileSync(join(dir, "json.moth"), here("tools/json.moth"));
  writeFileSync(join(dir, "json.test.moth"), here("tools/json.test.moth"));
  writeFileSync(join(dir, "fail.test.moth"), 'to test_good\n    expect 1 + 1 is 2\nend\nto test_bad\n    say "checking"\n    expect length of "abc" is 4\nend\n');
  for (const args of [["test"], ["test", "fail.test.moth"], ["bytecode", "json.moth"]]) {
    const [js, rust] = both(args, { cwd: dir });
    assert.equal(rust.stdout, js.stdout, args.join(" "));
    assert.equal(rust.status, js.status, args.join(" "));
  }
});
