// The Rust engine (native/) against the JavaScript VM: every program the other tests know, thousands of
// broken and generated ones, the bundled programs, and the command line. For each, the two must say, draw,
// write and fail exactly alike, and compile to the same bytecode. Build it first: cargo build --release in native/.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  return JSON.parse(JSON.stringify({ said, drawn, error, disk: left ?? null, app, bytecode, mothc: null })); // as JSON has it: Infinity is null
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
  const disk = { "file.txt": { text: "hello\nworld" }, "data.bin": { bytes: [1, 2, 3] }, "data.csv": { text: "Name,Price, x\n\"a, b\",1.5,\r\n\nb,-2,\"q\"\"uote\"\nc,3\n" } };
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

// compiler.moth's bytecode back end, run on the Rust engine, against the Rust compiler: the same bytecode file,
// byte for byte, or the same mistake at the same spot
function bothCompilers(sources) {
  const disk = Object.fromEntries(sources.map((source, i) => [`p${i + 1}.moth`, { text: source }]));
  const driver = [
    `for each i from 1 to ${sources.length}`,
    "    try",
    '        say compile_bytecode(read "p" + i + ".moth", empty list)',
    "    if it fails with why",
    "        try",
    '            say "error " + line of at of why + ":" + col of at of why + " " + reason of why',
    "        if it fails",
    '            say "crashed: " + why',
    "        end",
    "    end",
    "end",
  ].join("\n");
  const [moth] = onRust([{ source: `${here("compiler.moth")}\n${driver}`, disk }]);
  assert.equal(moth.error, null);
  const rust = onRust(sources.map((source) => ({ source, mothc: true, maxSteps: 1_000 }))); // some generated programs never end
  sources.forEach((source, i) => {
    const error = rust[i].error && rust[i].error.message.match(/^line (\d+): (.*)$/s);
    const expected = rust[i].mothc ?? `error ${error[1]}:${rust[i].error.col} ${error[2]}`;
    assert.equal(moth.said[i], expected, source.slice(0, 2000));
  });
}

test("Moth's compiler, written in Moth, writes the same bytecode as the Rust compiler, byte for byte", { skip }, () => {
  // numbers past 2^53 written in hex and binary, which have to be rounded, half to even
  const big = "say 0x20000000000001, 0x20000000000003, 0x1FFFFFFFFFFFFFFFF, 0xFFFFFFFFFFFFF800, 0xFFFFFFFFFFFFFC00, 0x8000000000000400\n"
    + `say 0b${"1".repeat(60)}, 0b1${"0".repeat(52)}1, 0x${"F".repeat(300)}, 123456789012345678901234567890, 0.1, 007, 1.50`;
  const sources = [big, ...Object.values(examples), ...PROGRAMS.map(([s]) => s), ...ERRORS.map(([s]) => s), ...generatePrograms(31, 400)];
  bothCompilers(sources.filter((source) => whole({ source })));
});

test("...and on 1,500 randomly broken programs, stops at the same mistakes", { skip }, () => {
  bothCompilers(brokenPrograms(5, 1500).filter((source) => whole({ source })));
});

test("moth-native bootstrap builds the compiler written in Moth with itself, with no JavaScript", { skip }, () => {
  const ran = spawnSync(BINARY, ["bootstrap", fileURLToPath(new URL("./compiler.moth", import.meta.url))], { encoding: "utf8" });
  assert.equal(ran.status, 0, ran.stdout + ran.stderr);
  assert.equal(ran.stdout.match(/the same bytecode/g).length, 3);
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
    // to 15 digits: halves of 15-digit numbers are ties, and tenths add up to almost what they should
    "repeat 2000 times",
    "    set a to (random number from 100000000000000 to 999999999999999) + 0.5",
    "    set b to (random number from 1 to 100000) / 10",
    "    say a \" \" 0 - a \" \" a / 1000000 \" \" b * 3 \" \" b * 3 is b + b + b \" \" b * 3 is less than b + b + b \" \" b * 3 is at least b + b + b \" \" b * 10 is divisible by 1",
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

test("the Rust engine reads tables, works them out and draws charts as JavaScript does", { skip }, () => {
  const tables = [
    'Name,Price,Qty\nApple,1.5,10\nPear,2,3\n"Big, red melon",12.25,1\nKiwi,,\n',
    '﻿City Name,2024,2024, ,Ünïcode Ω,a__b\r\n"x ""quoted"" y",-0.5,7,,é,\r\n\r\n"line\nbreak",1e5, 3 ,x\n',
    "only,a,header",
    "",
    "\n\n",
    'a\n"unclosed, quote\n1,2',
    "n\n1\n2\n3\n4.25\n-7\n",
  ];
  const jobs = tables.map((text) => ({
    source: [
      'set rows to read table "t.csv"',
      "say rows",
      "for each row in rows where row is not nothing",
      "    say row",
      "end",
      "try",
      "    say total of n in rows \" \" average of n in rows \" \" largest of n in rows \" \" smallest of n in rows",
      "    draw chart of n in rows",
      "if it fails with why",
      "    say why",
      "end",
    ].join("\n"),
    disk: { "t.csv": { text } },
  }));
  jobs.push({ source: 'draw chart of (dictionary where "Mon" is 5 km, "Tue" is 300 m, "Wed" is nothing, 4 is 0 m)\ndraw chart of (list of 1, -2.5, 0.1 + 0.2)\ndraw chart of empty list' });
  jobs.push({ source: "say total of (list of 1 hour, 30 minutes, nothing) \" \" average of (list of 2 kg, 500 g) \" \" largest of (list of \"b\", \"a\")" });
  jobs.push({ source: "say total of (list of 1, 2 km)" });
  jobs.push({ source: "draw chart of (list of 1, \"a\")" });
  agree(jobs, "a table");
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

// ---------- WebAssembly ----------

// moth-native built for WASI (cargo build --release --target wasm32-wasip1), run here by Node's own WASI; any
// WebAssembly runtime with WASI runs it the same way, with no JavaScript at all
const WASM = fileURLToPath(new URL("./native/target/wasm32-wasip1/release/moth-native.wasm", import.meta.url));
const noWasm = existsSync(WASM) ? false : "the WebAssembly build isn't made (cargo build --release --target wasm32-wasip1 in native/)";
const WASI_RUNNER = `
import { readFileSync } from "node:fs";
import { WASI } from "node:wasi";
const wasi = new WASI({ version: "preview1", args: ["moth-native", ...process.argv.slice(2)], env: {}, preopens: { ".": "." }, returnOnExit: true });
const module = await WebAssembly.compile(readFileSync(${JSON.stringify(WASM)}));
process.exitCode = wasi.start(await WebAssembly.instantiate(module, wasi.getImportObject()));
`;
const runner = join(mkdtempSync(join(tmpdir(), "moth-wasi-")), "run.mjs");
writeFileSync(runner, WASI_RUNNER);
// With MOTH_WASI=wasmtime (as CI has it) it runs in wasmtime, a WebAssembly runtime with no JavaScript in it;
// otherwise in Node's own WASI
function onWasm(args, options) {
  const ran = process.env.MOTH_WASI === "wasmtime"
    ? spawnSync("wasmtime", ["run", "--dir", ".", WASM, ...args], { encoding: "utf8", maxBuffer: 1 << 30, ...options })
    : spawnSync(process.execPath, ["--no-warnings", runner, ...args], { encoding: "utf8", maxBuffer: 1 << 30, ...options });
  // everything about a run that went wrong, so a failure says why
  ran.why = `status ${ran.status}, signal ${ran.signal}, error ${ran.error?.message}\n${ran.stderr}`;
  return ran;
}

test("moth-native as WebAssembly needs nothing but WASI, and agrees with the JavaScript VM on the test and broken programs", { skip: skip || noWasm }, () => {
  const imports = WebAssembly.Module.imports(new WebAssembly.Module(readFileSync(WASM)));
  assert.deepEqual([...new Set(imports.map((i) => i.module))], ["wasi_snapshot_preview1"]); // no JavaScript to call
  const sources = [...Object.values(examples), ...PROGRAMS.map(([s]) => s), ...ERRORS.map(([s]) => s)];
  const jobs = [...sources.map((source) => ({ source, bytecode: true, answers: ["50", "25", "37"] })), ...brokenPrograms(42, 1000).map((source) => ({ source, maxSteps: 10_000 }))].filter(whole);
  const ran = onWasm(["conform"], { input: jobs.map((job) => JSON.stringify(job)).join("\n") + "\n" });
  assert.equal(ran.status, 0, ran.why);
  const lines = ran.stdout.trim().split("\n");
  assert.equal(lines.length, jobs.length);
  jobs.forEach((job, i) => assert.deepEqual(JSON.parse(lines[i]), onJs(job), job.source.slice(0, 2000)));
});

test("moth-native as WebAssembly runs a program's files, its answers and its mistakes, and builds Moth's compiler with itself", { skip: skip || noWasm }, (t) => {
  const dir = tempDir(t);
  writeFileSync(join(dir, "main.moth"), 'set name to ask "Name?"\nwrite "hi " + name to "out.txt"\nsay read "out.txt"\nsay item 9 of list of 1');
  const ran = onWasm(["run", "main.moth", "--allow-all"], { cwd: dir, input: "Sam\n" });
  assert.equal(ran.stdout, "Name? Sam\nhi Sam\n");
  assert.equal(ran.stderr, "main.moth:4:5: there is no item 9, the list only has 1 item\nsay item 9 of list of 1\n    ^\n");
  assert.equal(ran.status, 1);
  writeFileSync(join(dir, "compiler.moth"), here("compiler.moth"));
  const built = onWasm(["bootstrap", "compiler.moth"], { cwd: dir });
  assert.equal(built.status, 0, built.stdout + built.why);
  assert.equal(built.stdout.match(/the same bytecode/g).length, 3);
});

// ---------- machine code: moth-native build --exe ----------

const rustc = spawnSync("rustc", ["--version"]).status === 0;
const noRustc = !rustc && "rustc, which moth-native build --exe needs, isn't here";
const EXE = process.platform === "win32" ? ".exe" : "";

test("moth-native build --exe makes programs that say, draw, write and fail exactly as the machine does", { skip: skip || noRustc, timeout: 1_800_000 }, (t) => {
  const disk = { "file.txt": { text: "hello\nworld" }, "data.bin": { bytes: [1, 2, 3] }, "data.csv": { text: "Name,Price, x\na,1.5,\nb,-2,q\n" } };
  const jobs = [
    ...[...Object.values(examples), ...PROGRAMS.map(([s]) => s), ...ERRORS.map(([s]) => s)].map((source) => ({ source, answers: ["50", "25", "37"] })),
    ...generatePrograms(7, 150).map((source) => ({ source, disk, args: ["one", "2"], maxSteps: 5_000 })),
    ...brokenPrograms(9, 150).map((source) => ({ source, maxSteps: 10_000 })),
  ].filter(whole);
  // a compiled program has no limit on its steps, so only the ones that end without one are compared
  const machine = onRust(jobs);
  const ending = jobs.map((job, i) => [job, machine[i]]).filter(([, r]) => !(r.error && /stopped after/.test(r.error.message)));
  assert.ok(ending.length > 400);
  const dir = tempDir(t);
  writeFileSync(join(dir, "programs.json"), JSON.stringify(ending.map(([job]) => ({ source: job.source, files: job.files ?? {} }))));
  const built = spawnSync(BINARY, ["build", "--exe-conform", "programs.json", "programs"], { cwd: dir, encoding: "utf8" });
  assert.equal(built.status, 0, built.stderr);
  const ran = spawnSync(join(dir, `programs${EXE}`), [], {
    input: ending.map(([job]) => JSON.stringify({ ...job, maxSteps: undefined })).join("\n") + "\n",
    encoding: "utf8",
    maxBuffer: 1 << 30,
  });
  assert.equal(ran.status, 0, ran.stderr);
  const compiled = ran.stdout.trim().split("\n").map((line) => JSON.parse(line));
  ending.forEach(([job, r], i) => assert.deepEqual(compiled[i], { ...r, bytecode: null, mothc: null }, job.source.slice(0, 2000)));
});

test("a program moth-native build --exe made runs on its own, asks as moth-native run does, and shows its mistakes the same", { skip: skip || noRustc, timeout: 600_000 }, (t) => {
  const dir = tempDir(t);
  writeFileSync(join(dir, "in.txt"), "hello");
  writeFileSync(join(dir, "shapes.moth"), "to area with w as a number, h as a number\n    return w * h\nend\n");
  writeFileSync(join(dir, "tool.moth"), [
    'use "shapes.moth"',
    'say "area " area(3, 4)',
    "for each a in arguments",
    "    say a",
    "end",
    'write uppercase of read "in.txt" to "out.txt"',
    'say read "out.txt"',
    "set total to 0",
    "for each i from 1 to 1000",
    "    add i * i to total",
    "end",
    "say total",
    "move forward 50",
    "to deep with n",
    '    return area(n, "x")',
    "end",
    "say deep(2)",
  ].join("\n"));
  const exe = (args, flags = []) => {
    const built = spawnSync(BINARY, ["build", "--exe", "tool.moth", ...flags], { cwd: dir, encoding: "utf8" });
    assert.equal(built.status, 0, built.stderr);
    return spawnSync(join(dir, `tool${EXE}`), args, { cwd: dir, encoding: "utf8", input: "" });
  };
  const denied = exe(["one"]);
  const run = spawnSync(BINARY, ["run", "tool.moth", "one"], { cwd: dir, encoding: "utf8", input: "" });
  assert.equal(denied.status, 1);
  assert.equal(denied.stdout, run.stdout);
  assert.equal(denied.stderr, run.stderr);
  assert.match(denied.stderr, /can't read 'in\.txt': this program isn't allowed to read files/);
  const allowed = exe(["one", "two"], ["--allow-read", "--allow-write"]);
  const runAllowed = spawnSync(BINARY, ["run", "tool.moth", "--allow-read", "--allow-write", "one", "two"], { cwd: dir, encoding: "utf8", input: "" });
  assert.equal(allowed.stdout, "area 12\none\ntwo\nHELLO\n333833500\n");
  assert.equal(allowed.stdout, runAllowed.stdout);
  assert.equal(allowed.stderr, runAllowed.stderr); // the mistake in deep, through area in shapes.moth, with its trail
  assert.match(allowed.stderr, /^shapes\.moth:2:12: can't use '\*' on a number and text|'area' needs h to be a number, not text/);
  assert.equal(allowed.status, 1);
  const bad = spawnSync(BINARY, ["build", "--exe", "tool.moth", "--allow-everything"], { cwd: dir, encoding: "utf8" });
  assert.equal(bad.status, 2);
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
  const [js, rust] = both(["run", "main.moth", "--allow-all", "one", "two"], { cwd: dir, input: "Sam\n" }, () => {
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

// a site on this computer, for going online: it serves /sales.csv, sends /old on to it, and sends /away on
// to it at another name for this computer (localhost)
async function site(t) {
  const script = [
    "const server = require('node:http').createServer((request, reply) => {",
    "  if (request.url === '/old') return reply.writeHead(302, { location: '/sales.csv' }).end();",
    "  if (request.url === '/away') return reply.writeHead(302, { location: `http://localhost:${server.address().port}/sales.csv` }).end();",
    "  if (request.url !== '/sales.csv') return reply.writeHead(404).end('no');",
    "  reply.writeHead(200, { 'content-type': 'text/csv' }).end('Name,Price\\nTea,2.5\\nCake,4\\n');",
    "});",
    "server.listen(0, '127.0.0.1', () => process.stdout.write(String(server.address().port)));",
  ].join("\n");
  const server = spawn(process.execPath, ["-e", script], { stdio: ["ignore", "pipe", "inherit"] });
  t.after(() => server.kill());
  const port = await new Promise((resolve) => server.stdout.once("data", (d) => resolve(String(d))));
  return `http://127.0.0.1:${port}`;
}

test("moth-native run asks before a program reads, writes or goes online, as moth run does", { skip }, async (t) => {
  const url = await site(t);
  const dir = tempDir(t);
  writeFileSync(join(dir, "in.txt"), "hello");
  writeFileSync(join(dir, "copy.moth"), [
    'write uppercase of read "in.txt" to "out.txt"',
    `set sales to read table "${url}/sales.csv"`,
    "say sales",
    `say read "${url}/missing"`,
  ].join("\n"));
  for (const flags of [[], ["--allow-read"], ["--allow-read", "--allow-write"], ["--allow-all"]]) {
    const [js, rust] = both(["run", "copy.moth", ...flags], { cwd: dir, input: "" });
    assert.equal(rust.status, js.status, flags.join(" "));
    assert.equal(rust.stdout, js.stdout, flags.join(" "));
    assert.equal(rust.stderr, js.stderr, flags.join(" "));
  }
  const [, rust] = both(["run", "copy.moth", "--allow-all"], { cwd: dir, input: "" });
  assert.match(rust.stdout, /\(record with name "Tea", price 2\.5\)/);
  assert.match(rust.stderr, /the site answered 404/);
  // what the flags name, sites that send the program on, `use` outside the folder, and `test`
  mkdirSync(join(dir, "data"));
  writeFileSync(join(dir, "data", "in.txt"), "inside");
  writeFileSync(join(dir, "lists.moth"), [
    `for each name in list of "data/in.txt", "in.txt", "data/../in.txt", "${url}/old", "${url}/away", "${url}/sales.csv"`,
    "    try",
    "        say read name",
    "    if it fails with why",
    "        say why",
    "    end",
    "end",
    "try",
    '    write "x" to "data/out.txt"',
    "if it fails with why",
    "    say why",
    "end",
  ].join("\n"));
  writeFileSync(join(dir, "evil.moth"), 'use "../in.txt"');
  writeFileSync(join(dir, "files.test.moth"), 'to test_reading\n    expect read "in.txt" is "hello"\nend');
  for (const args of [
    ["run", "lists.moth", "--allow-read=data", "--allow-net=127.0.0.1"],
    ["run", "lists.moth", "--allow-read=data,in.txt", "--allow-write=data", "--allow-net=localhost"],
    ["run", "evil.moth"],
    ["test", "files.test.moth"],
    ["test", "--allow-read", "files.test.moth"],
  ]) {
    const [js, native] = both(args, { cwd: dir, input: "" });
    assert.equal(native.status, js.status, args.join(" "));
    assert.equal(native.stdout, js.stdout, args.join(" "));
    assert.equal(native.stderr.replace("moth-native:", "moth:"), js.stderr, args.join(" "));
  }
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
