// machine.moth, Moth's machine-code back end, against the JavaScript engine: every program it can make
// machine code of becomes a program for this system, which runs and must print, write as a mistake and exit
// exactly as the JavaScript engine does. Windows and Linux only.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run, test as testMoth, machineCompiler, check, excerpt, describeTrail, format, MothError } from "./moth.js";
import examples from "./examples.js";
import { PROGRAMS, ERRORS, brokenPrograms } from "./cases.js";
import { MACHINE_CASES, machinePrograms } from "./machine-programs.js";

const here = (file) => readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
const target = { win32: "windows", linux: "linux" }[process.platform];
const skip = target ? false : "machine.moth makes programs for Windows and Linux";
const machine = machineCompiler(here("machine.moth"), here("compiler.moth"));
const executable = (dir, name) => join(dir, target === "windows" ? `${name}.exe` : name);

// What the JavaScript engine gives a program started away from a terminal, with no --allow flags and nothing to read:
// every file and site refused, as run refuses them, and each question asked with no answer to it.
const refused = (doing) => () => {
  throw new Error(`this program isn't allowed to ${doing}`);
};
const NOTHING_ALLOWED = {
  read: (name) => refused(/^https?:\/\//i.test(name) ? "go online (start it with --allow-net)" : "read files (start it with --allow-read)")(),
  write: refused("write files (start it with --allow-write)"),
  remove: refused("write files (start it with --allow-write)"),
};

// What the JavaScript engine prints for p.moth, writes to the error output (what it says there, then a
// mistake), and exits with: 1 for a mistake, or what `stop the program` gave; null for a program too long to wait for.
function onEngine(source, name) {
  let [stdout, stderr, status] = ["", "", 0];
  const ask = (question) => {
    stdout += `${question} \n`; // the question, then a line of its own, as the input has ended
    return null;
  };
  try {
    run(source, (line) => (stdout += `${line}\n`), { maxSteps: 3_000_000, file: name, ask, disk: NOTHING_ALLOWED, args: [],
      printError: (line) => (stderr += `${line}\n`), exit: (code) => (status = code) });
    return { stdout, stderr, status };
  } catch (err) {
    if (!(err instanceof MothError)) throw err;
    if (/^stopped after|^can't run programs here/.test(err.reason)) return null; // too long to wait for, or a program it would run
    stderr += `${err.file ?? name}:${err.line}:${err.col}: ${err.reason}\n${excerpt(source, err)}\n`;
    if (err.trail.length) stderr += `${describeTrail(err.trail)}\n`;
    return { stdout, stderr, status: 1 };
  }
}

test("machine code says, fails and exits exactly as the JavaScript engine does", { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), "moth-machine-"));
  const sources = [...MACHINE_CASES, ...Object.values(examples), ...PROGRAMS.map(([s]) => s), ...ERRORS.map(([s]) => s),
    // half an emoji, which the fuzzer can make, can't be in a file: machine code shows it as U+FFFD
    ...brokenPrograms(11, 300).filter((source) => !/[\ud800-\udfff]/u.test(source)), ...machinePrograms(2026, 400)];
  let made = 0;
  try {
    sources.forEach((source, i) => {
      const name = `p${i}.moth`;
      let bytes;
      try {
        bytes = machine(source, { target, name });
      } catch (err) {
        if (err instanceof MothError) return; // not machine code yet, or a mistake in the program
        throw err;
      }
      const want = onEngine(source, name);
      if (!want) return;
      const exe = executable(dir, `p${i}`);
      writeFileSync(exe, bytes);
      if (target === "linux") chmodSync(exe, 0o755);
      // random numbers from the seed the JavaScript engine uses when it isn't given real ones
      const got = spawnSync(exe, [], { cwd: dir, encoding: "utf8", timeout: 30_000, maxBuffer: 256 * 1024 * 1024, env: { ...process.env, MOTH_SEED: "1" } });
      assert.deepEqual({ stdout: got.stdout, stderr: got.stderr, status: got.status }, want, `${name}:\n${source}`);
      made++;
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  assert.ok(made > 300, `only ${made} programs became machine code`);
});

test("what can't become machine code yet stops at a mistake that says so", () => {
  const not = (source, wanted) => assert.throws(() => machine(source, { target: "linux" }), (err) => err instanceof MothError && wanted.test(err.message), source);
  not("say 5 km", /^line 1: 'unit' can't become machine code yet/);
  not("draw chart of (list of 1, 2)", /^line 1: 'draw chart of' can't become machine code yet/);
  not("say 1 +", /^line 1: expected a value but found the end of the code$/); // a mistake in the program, as run says it
});

// Programs that make far more than they keep, so the garbage collector runs many times over: lists, text
// that grows, records kept while others come and go, dictionaries, functions made inside functions, and
// deep recursion while making things.
const GARBAGE = [
  "set total to 0\nfor each i from 1 to 3000000\n    set l to list of i, i + 1, \"x\"\n    add item 2 of l to total\nend\nsay total",
  "set t to \"\"\nrepeat 2000000 times\n    add \"ab\" to t\nend\nsay length of t\nset u to \"\"\nfor each i from 1 to 200000\n    set u to u + i\nend\nsay length of u",
  "set keep to empty list\nfor each i from 1 to 200000\n    add record with n i, name \"r\" + i to keep\nend\nset junk to 0\nfor each i from 1 to 2000000\n    set tmp to list of i, \"y\" + i\n    add length of tmp to junk\nend\nset total to 0\nfor each r in keep\n    add n of r to total\nend\nsay total\nsay name of item 123456 of keep\nsay junk",
  "set d to empty dictionary\nfor each i from 1 to 300000\n    set item (\"k\" + i) of d to list of i\nend\nfor each round from 1 to 5\n    set e to empty dictionary\n    for each i from 1 to 100000\n        set item i of e to \"v\" + i\n    end\nend\nsay length of keys of d\nsay item \"k77777\" of d\nsay item 99999 of e",
  "to make with n\n    set seen to list of n\n    to get\n        return item 1 of seen\n    end\n    return get\nend\nset fs to empty list\nfor each i from 1 to 100000\n    add make(i) to fs\nend\nset total to 0\nfor each round from 1 to 20\n    for each i from 1 to 100000\n        set g to make(i)\n        add g() to total\n    end\nend\nfor each f in fs\n    add f() to total\nend\nsay total",
  "to deep with n, acc\n    if n is 0\n        return length of acc\n    end\n    return deep(n - 1, acc + \"z\")\nend\nset total to 0\nfor each i from 1 to 40\n    add deep(2000, \"\") to total\nend\nsay total\nto tree with n\n    if n is 0\n        return list of \"leaf\"\n    end\n    return list of tree(n - 1), tree(n - 1)\nend\nto count with t\n    if length of t is 1\n        return 1\n    end\n    return count(item 1 of t) + count(item 2 of t)\nend\nfor each i from 1 to 30\n    set t to tree(14)\nend\nsay count(t)",
];

test("garbage: programs that make far more than they keep say what the JavaScript engine says", { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), "moth-machine-"));
  try {
    GARBAGE.forEach((source, i) => {
      let want = "";
      run(source, (line) => (want += `${line}\n`));
      const exe = executable(dir, `g${i}`);
      writeFileSync(exe, machine(source, { target, name: `g${i}.moth` }));
      if (target === "linux") chmodSync(exe, 0o755);
      const got = spawnSync(exe, [], { encoding: "utf8", timeout: 60_000 });
      assert.deepEqual({ stdout: got.stdout, stderr: got.stderr, status: got.status }, { stdout: want, stderr: "", status: 0 }, source);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// A line is kept once for every place on it a mistake can happen, so a long one with thousands of them (a
// trained network's weights, say) stays small, and a mistake at its end still shows it as the JavaScript engine does.
test("a long line with thousands of places a mistake can happen stays small", { skip }, () => {
  const numbers = Array.from({ length: 4000 }, (_, i) => `-${(i % 97) / 10}`).join(", ");
  const source = `set x to list of ${numbers}, -"a"\nsay length of x\n`;
  const bytes = machine(source, { target, name: "long.moth" });
  assert.ok(bytes.length < 1_000_000, `${bytes.length} bytes`);
  const dir = mkdtempSync(join(tmpdir(), "moth-machine-"));
  try {
    const exe = executable(dir, "long");
    writeFileSync(exe, bytes);
    if (target === "linux") chmodSync(exe, 0o755);
    const got = spawnSync(exe, [], { encoding: "utf8", maxBuffer: 1 << 24 });
    assert.deepEqual({ stdout: got.stdout, stderr: got.stderr, status: got.status }, onEngine(source, "long.moth"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// machine.moth, made into machine code, compiling itself: the bytes must be the ones it makes on Node.js. The
// driver counts with `total` and `k`, made before it uses machine.moth, as machine.moth's own functions do: a
// file used `as` a name keeps its own top level, so its functions' variables are theirs, not the driver's.
test("machine.moth in machine code compiles itself into the same bytes", { skip }, () => {
  const sources = { "machine.moth": here("machine.moth").replace(/\r/g, ""), "compiler.moth": here("compiler.moth").replace(/\r/g, "") };
  const want = machine(sources["machine.moth"], { files: { "compiler.moth": sources["compiler.moth"] }, target, name: "machine.moth" });
  let sum = 0, mix = 0;
  want.forEach((x, i) => { sum += x; mix += x * ((i + 1) & 1023); });
  const driver = `set total to 0
set k to 0
use "machine.moth" as m
set made to m's compile_machine(${JSON.stringify(sources["machine.moth"])}, (list of "compiler.moth"), (list of ${JSON.stringify(sources["compiler.moth"])}), "${target}", "machine.moth")
say length of made
set mix to 0
for each k from 1 to length of made
    add item k of made to total
    add item k of made * (k bit and 1023) to mix
end
say total
say mix
`;
  const dir = mkdtempSync(join(tmpdir(), "moth-machine-"));
  try {
    const exe = executable(dir, "self");
    writeFileSync(exe, machine(driver, { files: sources, target, name: "driver.moth" }));
    if (target === "linux") chmodSync(exe, 0o755);
    const got = spawnSync(exe, [], { encoding: "utf8", timeout: 120_000 });
    assert.deepEqual({ stdout: got.stdout, stderr: got.stderr, status: got.status }, { stdout: `${want.length}\n${sum}\n${mix}\n`, stderr: "", status: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// A `set` in a function changes a variable of the same name its top level made above the function, which in
// these two files would only ever be a mistake: none of their functions sets a name its own top level makes.
// (A file used `as` a name keeps its own top level, so names in different files can't clash.)
test("machine.moth's and moth.moth's functions never set a name their own top level makes", () => {
  for (const file of ["machine.moth", "moth.moth"]) {
    const top = new Set([...here(file).matchAll(/^(?:set|to) ([a-z_0-9]+)/gm)].map((m) => m[1]));
    const set = [...new Set([...here(file).matchAll(/^[ \t]+(?:set|for each) ([a-z_0-9]+)/gm)].map((m) => m[1]))];
    assert.deepEqual(set.filter((n) => top.has(n)), [], file);
  }
});

// A file used `as` a name keeps its own top level, and one used as two names is two copies, in machine code as
// on the JavaScript engine: the program's `total` and `k` are made before it uses the file whose function
// counts with names of its own, and each copy of the counter counts for itself.
test("a file used as two names is two copies in machine code, each keeping its own top level", { skip }, () => {
  const files = {
    "counter.moth": "set count to 0\nto bump\n    add 1 to count\n    return count\nend",
    "tally.moth": "to tally with things\n    set total to 0\n    for each k in things\n        add k to total\n    end\n    return total\nend",
  };
  const source = 'set total to 100\nset k to "mine"\nuse "counter.moth" as a\nuse "counter.moth" as b\nuse "tally.moth" as t\nsay a\'s bump() " " a\'s bump() " " b\'s bump()\nsay t\'s tally((list of 1, 2, 3)) " " total " " k\n';
  let want = "";
  run(source, (line) => (want += `${line}\n`), { files: (name) => files[name] });
  assert.equal(want, "1 2 1\n6 100 mine\n");
  const dir = mkdtempSync(join(tmpdir(), "moth-machine-"));
  try {
    const exe = executable(dir, "copies");
    writeFileSync(exe, machine(source, { files, target, name: "copies.moth" }));
    if (target === "linux") chmodSync(exe, 0o755);
    const got = spawnSync(exe, [], { encoding: "utf8" });
    assert.deepEqual({ stdout: got.stdout, stderr: got.stderr, status: got.status }, { stdout: want, stderr: "", status: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a program becomes the same bytes each time, as a PE file for Windows and an ELF file for Linux", () => {
  const source = MACHINE_CASES[2];
  const windows = machine(source, { target: "windows", name: "f.moth" });
  const linux = machine(source, { target: "linux", name: "f.moth" });
  assert.deepEqual([...windows.slice(0, 2)], [0x4d, 0x5a]); // MZ
  assert.deepEqual([...linux.slice(0, 4)], [0x7f, 0x45, 0x4c, 0x46]); // \x7fELF
  assert.deepEqual(machine(source, { target: "windows", name: "f.moth" }), windows);
});

// Standalone Moth: moth.moth and machine.moth, made into machine code, are moth.exe (moth on Linux). Made once
// here from the source, in a folder of its own with the source beside it, for the tests below.
let standalone = null;
function mothExe() {
  if (standalone) return standalone;
  const dir = mkdtempSync(join(tmpdir(), "moth-standalone-"));
  const sources = Object.fromEntries(["moth.moth", "machine.moth", "compiler.moth"].map((f) => [f, here(f)]));
  const made = machine(sources["moth.moth"], { files: { "machine.moth": sources["machine.moth"], "compiler.moth": sources["compiler.moth"] }, target, name: "moth.moth", allow: ["--allow-read", "--allow-write", "--allow-run"] });
  const exe = executable(dir, "moth-first");
  writeFileSync(exe, made);
  if (target === "linux") chmodSync(exe, 0o755);
  for (const [name, text] of Object.entries(sources)) writeFileSync(join(dir, name), text);
  standalone = { dir, exe, made };
  return standalone;
}
after(() => standalone && rmSync(standalone.dir, { recursive: true, force: true }));

test("moth.exe builds a program, and itself into the same bytes", { skip }, () => {
  const { dir, exe, made } = mothExe();
  writeFileSync(join(dir, "lib.moth"), "to twice with t\n    return t + t\nend\n");
  writeFileSync(join(dir, "hi.moth"), 'use "lib.moth" as lib\nsay lib\'s twice("ab")\nsay uppercase of "straße"\n');
  const built = spawnSync(exe, ["build", "hi.moth"], { cwd: dir, encoding: "utf8" });
  assert.equal(built.status, 0, built.stdout + built.stderr);
  assert.match(built.stdout, /^compiled hi\.moth to machine code for (Windows|Linux) -> hi(\.exe)? \(.* bytes\)\n$/);
  assert.equal(spawnSync(executable(dir, "hi"), [], { encoding: "utf8" }).stdout, "abab\nSTRASSE\n");
  const again = spawnSync(exe, ["build", "moth.moth", "--allow-read", "--allow-write", "--allow-run"], { cwd: dir, encoding: "utf8", timeout: 120_000 });
  assert.equal(again.status, 0, again.stdout + again.stderr);
  assert.ok(Buffer.from(made).equals(readFileSync(executable(dir, "moth"))), "moth.exe built itself into different bytes");
});

test("a program moth.exe builds uses files, and shows a mistake in one as moth run did", { skip }, () => {
  const { dir, exe } = mothExe();
  const sub = join(dir, "uses");
  mkdirSync(sub);
  writeFileSync(join(sub, "shapes.moth"), "to square with n\n    return n * n\nend\nto check with n\n    if n is less than 0\n        fail with \"below 0\"\n    end\n    return n\nend\n");
  writeFileSync(join(sub, "main.moth"), 'use "shapes.moth" as shapes\nsay shapes\'s square(12)\nsay shapes\'s check(0 - 1)\n');
  const built = spawnSync(exe, ["build", join("uses", "main.moth")], { cwd: dir, encoding: "utf8" });
  assert.equal(built.status, 0, built.stdout + built.stderr);
  const ran = spawnSync(executable(sub, "main"), [], { cwd: sub, encoding: "utf8" });
  assert.equal(ran.stdout, "144\n");
  assert.equal(ran.stderr, "shapes.moth:6:9: below 0\n        fail with \"below 0\"\n        ^\n  in 'shapes's check', called from line 3\n");
  assert.equal(ran.status, 1);
  const missing = spawnSync(exe, ["build", "nowhere.moth"], { cwd: dir, encoding: "utf8" });
  assert.deepEqual([missing.status, missing.stdout, missing.stderr], [1, "", "moth: there is no file called 'nowhere.moth'\n"]);
  writeFileSync(join(sub, "broken.moth"), 'use "shapes.moth" as shapes\nsay shapes\'s square(1, 2\n');
  const broken = spawnSync(exe, ["build", join("uses", "broken.moth")], { cwd: dir, encoding: "utf8" });
  assert.deepEqual([broken.status, broken.stdout], [1, ""]); // a mistake in the program: on the error output, and 1
  assert.equal(broken.stderr, `${join("uses", "broken.moth")}:3:1: expected ')' but found the end of the code\n\n^\n`);
});

// `run program` and `remove the file`: a program moth.exe builds starts another and waits for it, with the
// same input and output, and gives the number it ended with; and only if it was built with --allow-run.
test("a program moth.exe builds starts another program, waits for it, and removes a file", { skip }, () => {
  const { dir, exe } = mothExe();
  writeFileSync(join(dir, "child.moth"), [
    'say "child out"',
    'say "child err" to the error output',
    "for each a in arguments",
    '    say "[" a "]"',
    "end",
    'set answer to ask "Name?"',
    'say "child heard " answer',
    "stop the program with 7",
  ].join("\n"));
  writeFileSync(join(dir, "parent.moth"), [
    'say "parent before"',
    `set child to "${target === "windows" ? "./child.exe" : "./child"}"`,
    'set code to run program child with (list of "one", "two words", "q\\"uote", "")',
    'say "child ended with " code',
    'write "temporary" to "gone.txt"',
    'say read "gone.txt"',
    'remove the file "gone.txt"',
    "try",
    '    say read "gone.txt"',
    "if it fails with why",
    "    say why",
    "end",
    "try",
    '    remove the file "gone.txt"',
    "if it fails with why",
    "    say why",
    "end",
    'set missing to run program "nowhere-at-all-here"',
  ].join("\n"));
  assert.equal(spawnSync(exe, ["build", "child.moth"], { cwd: dir, encoding: "utf8" }).status, 0);
  // without --allow-run it may not start one, and away from a terminal it isn't asked
  const built = spawnSync(exe, ["build", "parent.moth", "--allow-read", "--allow-write"], { cwd: dir, encoding: "utf8" });
  assert.equal(built.status, 0, built.stdout + built.stderr);
  const refused = spawnSync(executable(dir, "parent"), [], { cwd: dir, encoding: "utf8", input: "Sam\n" });
  assert.equal(refused.stdout, "parent before\n");
  assert.match(refused.stderr, /: can't run '\.\/child(\.exe)?': this program isn't allowed to start programs \(start it with --allow-run\)\n/);
  assert.equal(refused.status, 1);
  // with it, the child says what it says where this program's own words go, and ends with 7
  const again = spawnSync(exe, ["build", "parent.moth", "--allow-read", "--allow-write", "--allow-run"], { cwd: dir, encoding: "utf8" });
  assert.equal(again.status, 0, again.stdout + again.stderr);
  const ran = spawnSync(executable(dir, "parent"), [], { cwd: dir, encoding: "utf8", input: "Sam\n" });
  assert.equal(ran.stdout, ["parent before", "child out", "[one]", "[two words]", 'q"uote'.replace(/^/, "[") + "]", "[]", "Name? Sam",
    "child heard Sam", "child ended with 7", "temporary", "there is no file called 'gone.txt'", "there is no file called 'gone.txt'", ""].join("\n"));
  assert.equal(ran.stderr, `child err\nparent.moth:18:16: there is no program called 'nowhere-at-all-here'\nset missing to run program "nowhere-at-all-here"\n               ^\n`);
  assert.equal(ran.status, 1);
  assert.ok(!existsSync(join(dir, "gone.txt")));
});

// `moth run`: the program built into a file beside it, run with the arguments after it, ending with the
// number it ended with, and the file gone again.
test("moth.exe runs a program, passing its arguments, input, output and exit code through", { skip }, () => {
  const { dir, exe } = mothExe();
  writeFileSync(join(dir, "tool.moth"), [
    "for each a in arguments",
    '    say "[" a "]"',
    "end",
    'say "to the error output" to the error output',
    'set answer to ask "Name?"',
    'say "heard " answer',
    'say read "notes.txt"',
    "stop the program with 5",
  ].join("\n"));
  writeFileSync(join(dir, "notes.txt"), "noted");
  writeFileSync(join(dir, "broken.moth"), "say 1 +\n");
  mkdirSync(join(dir, "deeper"), { recursive: true });
  writeFileSync(join(dir, "deeper", "deep.moth"), 'say "deep"\n');
  const left = () => readdirSync(dir).filter((name) => name.includes("-run"));
  const ran = spawnSync(exe, ["run", "--allow-read", "tool.moth", "one", "two words", "--allow-write"], { cwd: dir, encoding: "utf8", input: "Sam\n" });
  assert.deepEqual({ stdout: ran.stdout, stderr: ran.stderr, status: ran.status }, {
    stdout: "[one]\n[two words]\n[--allow-write]\nName? Sam\nheard Sam\nnoted\n", // what comes after the file is the program's own
    stderr: "to the error output\n",
    status: 5,
  });
  assert.deepEqual(left(), [], "the file it ran was left behind");
  // without the flag the program may not read, as `moth build` builds the flags in
  const unallowed = spawnSync(exe, ["run", "tool.moth"], { cwd: dir, encoding: "utf8", input: "Sam\n" });
  assert.match(unallowed.stderr, /can't read 'notes\.txt': this program isn't allowed to read files/);
  assert.equal(unallowed.status, 1);
  assert.deepEqual(left(), []);
  // a mistake in the program, or no such file: the mistake on the error output, and 1
  const broken = spawnSync(exe, ["run", "broken.moth"], { cwd: dir, encoding: "utf8" });
  assert.deepEqual([broken.status, broken.stdout, broken.stderr], [1, "", "broken.moth:2:1: expected a value but found the end of the code\n\n^\n"]);
  const missing = spawnSync(exe, ["run", "nowhere.moth"], { cwd: dir, encoding: "utf8" });
  assert.deepEqual([missing.status, missing.stdout, missing.stderr], [1, "", "moth: there is no file called 'nowhere.moth'\n"]);
  // a file already where the program would go for a while is left as it is, and nothing runs
  writeFileSync(join(dir, "tool-run.exe"), "mine");
  writeFileSync(join(dir, "tool-run"), "mine");
  const inTheWay = spawnSync(exe, ["run", "--allow-read", "tool.moth"], { cwd: dir, encoding: "utf8", input: "Sam\n" });
  const temp = target === "windows" ? "tool-run.exe" : "tool-run";
  assert.deepEqual([inTheWay.status, inTheWay.stdout, inTheWay.stderr], [1, "", `moth: there's already a file called './${temp}', where the program would go while it runs: move it first\n`]);
  assert.equal(readFileSync(join(dir, temp), "utf8"), "mine");
  rmSync(join(dir, "tool-run.exe"));
  rmSync(join(dir, "tool-run"));
  // a program in a folder of its own, and `run` with no file at all
  const deep = spawnSync(exe, ["run", join("deeper", "deep.moth")], { cwd: dir, encoding: "utf8" });
  assert.deepEqual([deep.status, deep.stdout], [0, "deep\n"]);
  const slashed = spawnSync(exe, ["run", "deeper/deep.moth"], { cwd: dir, encoding: "utf8" }); // a / on Windows too
  assert.deepEqual([slashed.status, slashed.stdout, slashed.stderr], [0, "deep\n", ""]);
  assert.deepEqual(readdirSync(join(dir, "deeper")).filter((name) => name.includes("-run")), []);
  for (const bad of [["run"], ["run", "--target", "linux", "tool.moth"], ["walk", "tool.moth"]]) {
    const said = spawnSync(exe, bad, { cwd: dir, encoding: "utf8" });
    assert.deepEqual([said.status, said.stdout], [2, ""], bad.join(" "));
    assert.match(said.stderr, /^usage: moth /, bad.join(" "));
  }
});

// `moth tidy`: the one way Moth writes code, which is what format() in moth.js writes. Every Moth file
// here is tidy already, so --check must say so; then messy and randomly broken programs, each tidied to
// exactly the bytes format() makes of it.
test("moth.exe tidies code to the same bytes format() does, and --check only says which files need it", { skip }, () => {
  const { dir, exe } = mothExe();
  const sub = join(dir, "tidying");
  mkdirSync(sub, { recursive: true });
  const tidy = (names) => spawnSync(exe, ["tidy", ...names], { cwd: sub, encoding: "utf8", timeout: 120_000 });
  const mine = new Map(); // what every Moth file here holds, by the name it gets in the folder
  for (const folder of [".", "tools", "apps"]) {
    for (const file of readdirSync(new URL(`./${folder}/`, import.meta.url)).filter((f) => f.endsWith(".moth"))) {
      mine.set(file, readFileSync(new URL(`./${folder}/${file}`, import.meta.url), "utf8"));
    }
  }
  for (const [name, text] of mine) writeFileSync(join(sub, name), text);
  const checked = spawnSync(exe, ["tidy", "--check", ...mine.keys()], { cwd: sub, encoding: "utf8", timeout: 120_000 });
  assert.equal(checked.stderr, "");
  assert.equal(checked.stdout, [...mine.keys()].map((name) => `${name} is tidy\n`).join(""));
  assert.equal(checked.status, 0);
  for (const [name, text] of mine) assert.equal(readFileSync(join(sub, name), "utf8"), text, `${name} was changed by --check`);

  // the messy example from moth.test.js, and programs broken on purpose: byte for byte what format() makes
  const messy = ["to   area with w,h", "return w*h", "  end", "", "", "", "if area( 2,3 ) is 6   # check", '        say "six"',
    "# a note before else", "else", 'say  "no"', "end", "set l to list of 1 ,2,", " 3", "say - 5", "try", "say 1/0",
    "if it fails with why", " say why", "end", "set r to record with label -1, x (2 + 3)", "move forward (1 + 2)", "", ""].join("\n");
  const wide = 'say  "é😀"   # a comment with 😀 in it\nsay   item  1  of   "héllo"\n'; // columns counted as JavaScript counts them
  const sources = [messy, wide, ...brokenPrograms(7, 150)];
  const names = [];
  const wanted = [];
  sources.forEach((source, i) => {
    let want;
    try {
      want = format(source);
    } catch (err) {
      if (err instanceof MothError) return; // code that can't be read: below
      throw err;
    }
    const name = `t${i}.moth`;
    writeFileSync(join(sub, name), source);
    names.push(name);
    wanted.push(want);
  });
  assert.ok(names.length > 40, `only ${names.length} could be tidied`);
  const tidied = tidy(names);
  assert.equal(tidied.status, 0, tidied.stdout + tidied.stderr);
  names.forEach((name, i) => assert.equal(readFileSync(join(sub, name), "utf8"), wanted[i], name));
  assert.equal(tidy(names).stdout, names.map((name) => `${name} is tidy\n`).join("")); // and tidy the second time
  // code with a mistake in it can't be tidied: the mistake, where it is, and 1
  writeFileSync(join(sub, "wrong.moth"), "if yes\n    say 1\n");
  const wrong = tidy(["wrong.moth"]);
  assert.deepEqual([wrong.status, wrong.stdout, wrong.stderr], [1, "", "wrong.moth:3:1: 'if' from line 1 is missing its 'end'\n\n^\n"]);
  assert.equal(readFileSync(join(sub, "wrong.moth"), "utf8"), "if yes\n    say 1\n");
  const missing = tidy(["nowhere.moth"]);
  assert.deepEqual([missing.status, missing.stdout, missing.stderr], [1, "", "moth: there is no file called 'nowhere.moth'\n"]);
  for (const bad of [["tidy"], ["tidy", "--check"]]) {
    const said = spawnSync(exe, bad, { cwd: sub, encoding: "utf8" });
    assert.deepEqual([said.status, said.stdout], [2, ""], bad.join(" "));
  }
});

// `moth check`: the problems checker.js finds that don't need the types it works out, in its own words and
// its own order. Every "will fail" here is a name nothing ever sets; the checker's other ones, which come
// from trying an operation on sample values, are left out, so what it says must be what the checker says
// once those are taken away.
const UNDEFINED = /has no value yet|there is no function called|has nothing called/;
const checkedBy = (file, source, files = {}) => { // what `moth check file` must say
  const problems = check(source, { files: (name) => files[name] }).filter((p) => p.kind !== "fails" || UNDEFINED.test(p.message));
  if (!problems.length) return `${file}: no problems found\n`;
  return problems.map((p) => {
    const kind = p.kind === "fails" ? "will fail" : p.kind;
    return `${p.file ?? file}:${p.line}:${p.col}: ${kind}: ${p.message}\n${excerpt(p.file ? files[p.file] : source, p)}\n`;
  }).join("");
};

test("moth.exe finds the problems the checker finds without running the program", { skip }, () => {
  const { dir, exe } = mothExe();
  const sub = join(dir, "checking");
  mkdirSync(sub, { recursive: true });
  const checking = (name) => spawnSync(exe, ["check", name], { cwd: sub, encoding: "utf8", timeout: 60_000 });
  const lib = "set lib_x to 1\nto twice with n\n    return n * 2\nend\n";
  const cases = [
    ["clean.moth", 'set total to 0\nfor each i from 1 to 10\n    add i to total\nend\nsay total\n', 0],
    ["names.moth", 'say "Total: " totl\nset total to 1\nsay totl\n', 1],
    ["after.moth", "to f\n    return 1\n    say 2\nend\nf()\nstop the program\nsay 3\n", 0],
    ["unused.moth", 'set kept to 1\nto helper\n    set inside to 2\nend\nsay kept\n', 0],
    ["calls.moth", 'say helper(2)\nto helper with x\n    return x\nend\nsay helpr(2)\n', 1],
    ["caught.moth", "try\n    say nowhere\nif it fails with why\n    say why\nend\nsay yes or alsonowhere\n", 0],
    ["tests.moth", "to test_one\n    expect 1 is 1\nend\n", 0],
    ["module.moth", `use "lib.moth" as lib\nsay lib's twice(2)\nsay lib's thrice(2)\n`, 1],
    ["plain.moth", 'use "lib.moth"\nsay twice(lib_x)\nsay thrice(1)\n', 1],
  ];
  writeFileSync(join(sub, "lib.moth"), lib);
  for (const [name, source] of cases) writeFileSync(join(sub, name), source);
  for (const [name, source, status] of cases) {
    const said = checking(name);
    assert.equal(said.stdout, checkedBy(name, source, { "lib.moth": lib }), name);
    assert.deepEqual([said.status, said.stderr], [status, ""], name);
  }
  // code that can't be read at all is one problem of its own, and a file that isn't there says so
  writeFileSync(join(sub, "wrong.moth"), "say 1 +\n");
  const wrong = checking("wrong.moth");
  assert.deepEqual([wrong.status, wrong.stdout, wrong.stderr], [1, "wrong.moth:2:1: error: expected a value but found the end of the code\n\n^\n", ""]);
  const missing = checking("nowhere.moth");
  assert.deepEqual([missing.status, missing.stdout, missing.stderr], [1, "", "moth: there is no file called 'nowhere.moth'\n"]);
  // and the same words as the checker on programs broken on purpose
  let checked = 0;
  brokenPrograms(3, 40).forEach((source, i) => {
    const name = `b${i}.moth`;
    writeFileSync(join(sub, name), source);
    let want;
    try {
      want = checkedBy(name, source);
    } catch (err) {
      if (err instanceof MothError) return;
      throw err;
    }
    if (/: error: /.test(want)) return; // code that can't be read: its mistake, checked above
    const said = checking(name);
    assert.equal(said.stdout, want, `${name}:\n${source}`);
    checked++;
  });
  assert.ok(checked > 10, `only ${checked} were checked`);
});

// `moth test`: every test_ function in a file, each in a run of its own, said as test() in moth.js says it.
const TESTS_IN_MOTH = ["set count to 0", "to average with numbers", "    return 10 / length of numbers", "end",
  "to test_one", "    add 1 to count", "    expect count is 1", "end", "to test_two", "    add 1 to count",
  '    say "count is " count', "    expect count is 2", "end", "to test_three", "    expect average(empty list) is 1",
  "end", "to helper", "    expect 1 is 2", "end"].join("\n");

test("moth.exe runs a file's tests, each in a run of its own, and says what test() says", { skip }, () => {
  const { dir, exe } = mothExe();
  const sub = join(dir, "testing");
  mkdirSync(sub, { recursive: true });
  const testing = (names) => spawnSync(exe, ["test", ...names], { cwd: sub, encoding: "utf8", timeout: 120_000 });
  writeFileSync(join(sub, "sample.test.moth"), TESTS_IN_MOTH);
  // what moth.js's test() makes of the same file, said the way the command line says it
  const results = testMoth(TESTS_IN_MOTH);
  const said = results.map(({ name, said: lines, error }) => {
    if (!error) return `✓ ${name}\n`;
    const report = [`sample.test.moth:${error.line}:${error.col}: ${error.reason}`, ...excerpt(TESTS_IN_MOTH, error).split("\n")];
    if (error.trail.length) report.push(...describeTrail(error.trail).split("\n"));
    if (lines.length) report.push("it said:", ...lines.map((line) => `  ${line}`));
    return `✗ ${name}\n${report.map((line) => `    ${line}`).join("\n")}\n`;
  }).join("");
  const ran = testing(["sample.test.moth"]);
  assert.equal(ran.stdout, `${said}1 passed, 2 failed\n`);
  assert.deepEqual([ran.status, ran.stderr], [1, ""]);
  assert.deepEqual(readdirSync(sub).filter((name) => name.includes("-test.") || name.endsWith("-test")), [], "the file it built was left behind");

  // the tools' own tests, which must pass; a file with no tests, which is one test itself; a test that
  // stops the program; a file that can't be read at all; and more than one file at once
  for (const name of ["json.moth", "json.test.moth"]) writeFileSync(join(sub, name), readFileSync(new URL(`./tools/${name}`, import.meta.url), "utf8"));
  const tools = testing(["json.test.moth"]);
  assert.equal(tools.stdout, ["test_values", "test_lists_and_objects", "test_spaces_and_lines", "test_escapes", "test_mistakes"]
    .map((name) => `✓ ${name}\n`).join("") + "5 passed\n");
  assert.deepEqual([tools.status, tools.stderr], [0, ""]);
  writeFileSync(join(sub, "none.test.moth"), 'say 1\nexpect 1 is 2\n');
  const none = testing(["none.test.moth"]);
  assert.equal(none.stdout, "✗ none.test.moth\n    none.test.moth:2:1: expected 1 to be 2\n    expect 1 is 2\n    ^\n    it said:\n      1\n0 passed, 1 failed\n");
  writeFileSync(join(sub, "stops.test.moth"), 'to test_a\n    say "before"\n    stop the program with 4\nend\nto test_b\n    expect yes\nend\n');
  const stops = testing(["stops.test.moth"]);
  assert.equal(stops.stdout, "✗ test_a\n    stopped the program with 4\n    it said:\n      before\n✓ test_b\n1 passed, 1 failed\n");
  writeFileSync(join(sub, "broken.test.moth"), "to test_a\n    say 1\n");
  const broken = testing(["broken.test.moth"]);
  assert.deepEqual([broken.status, broken.stdout, broken.stderr], [1, "0 passed, 1 failed\n", "broken.test.moth:3:1: 'to' from line 1 is missing its 'end'\n\n^\n"]);
  const several = testing(["json.test.moth", "none.test.moth"]); // each file named, then how many in all
  assert.match(several.stdout, /^json\.test\.moth\n✓ test_values\n/);
  assert.match(several.stdout, /none\.test\.moth\n✗ none\.test\.moth\n/);
  assert.equal(several.stdout.split("\n").at(-2), "5 passed, 1 failed");
  const missing = testing(["nowhere.test.moth"]);
  assert.deepEqual([missing.status, missing.stdout, missing.stderr], [1, "0 passed, 1 failed\n", "moth: there is no file called 'nowhere.test.moth'\n"]);
  const nothing = spawnSync(exe, ["test"], { cwd: sub, encoding: "utf8" });
  assert.deepEqual([nothing.status, nothing.stdout], [2, ""]);
});

// `run program ... keeping its output`: what the program said instead of letting it through, however much
// of it there is, from both its outputs at once.
test("a program moth.exe builds keeps what another program said, and its number", { skip }, () => {
  const { dir, exe } = mothExe();
  const sub = join(dir, "keeping");
  mkdirSync(sub, { recursive: true });
  writeFileSync(join(sub, "child.moth"), ['say "out one"', 'say "err one" to the error output', 'say "out two"',
    "for each a in arguments", '    say "[" a "]"', "end", "stop the program with 7"].join("\n"));
  // a program that fills both its outputs: more than a pipe holds, so they must be read as it writes them
  writeFileSync(join(sub, "loud.moth"), ["for each i from 1 to 20000", '    say "line " i " of a great many, to fill a pipe up"',
    '    say "and the same to the other one" to the error output', "end", "stop the program with 3"].join("\n"));
  const child = target === "windows" ? "./child.exe" : "./child";
  writeFileSync(join(sub, "keeps.moth"), [
    `set answer to run program "${child}" with (list of "a b") keeping its output`,
    'say "code " code of answer',
    'say "output: [" output of answer "]"',
    'say "mistakes: [" mistakes of answer "]"',
    `set loud to run program "${target === "windows" ? "./loud.exe" : "./loud"}" keeping its output`,
    'say "loud " code of loud " " length of output of loud " " length of mistakes of loud',
  ].join("\n"));
  for (const name of ["child", "loud"]) assert.equal(spawnSync(exe, ["build", `${name}.moth`], { cwd: sub, encoding: "utf8" }).status, 0);
  assert.equal(spawnSync(exe, ["build", "keeps.moth", "--allow-run"], { cwd: sub, encoding: "utf8" }).status, 0);
  const kept = spawnSync(executable(sub, "keeps"), [], { cwd: sub, encoding: "utf8", timeout: 120_000, maxBuffer: 1 << 26 });
  assert.deepEqual([kept.status, kept.stderr], [0, ""]);
  let loud = 0; // how much the loud one says, in characters, the new line after each line counted
  for (let i = 1; i <= 20_000; i++) loud += `line ${i} of a great many, to fill a pipe up\n`.length;
  assert.equal(kept.stdout, ["code 7", "output: [out one", "out two", "[a b]", "]", "mistakes: [err one", "]",
    `loud 3 ${loud} ${20_000 * "and the same to the other one\n".length}`, ""].join("\n"));
});

// A program that takes arguments, asks, reads and writes, built with each set of --allow flags, each in a
// folder of its own with the same files in it. What it must do is what `moth run tool.moth` with the same flags,
// arguments and input did on Windows, and its machine code on Linux, the same, before the Node.js command line
// was dropped.
const ALLOW_SOURCE = [
  "for each a in arguments",
  '    say "[" a "]"',
  "end",
  'set name to ask "Name?"',
  'say "Hi " name',
  'write "made by " + name to "out.txt"',
  'say read "out.txt"',
  'say read bytes "in.txt"',
  'say length of read "data/big.txt"',
  "try",
  '    say read "data"',
  "if it fails with why",
  "    say why",
  "end",
  'set again to ask "Again?"',
  'say read "missing.txt"',
].join("\n");
const AS_MOTH_RUN_DID = [
  {"flags": [], "stdout": "[one]\n[two words]\n[q\"uote]\n[]\nName? Sam\nHi Sam\n", "stderr": "tool.moth:6:1: can't write 'out.txt': this program isn't allowed to write files (start it with --allow-write)\nwrite \"made by \" + name to \"out.txt\"\n^\n", "status": 1, "out": null},
  {"flags": ["--allow-read"], "stdout": "[one]\n[two words]\n[q\"uote]\n[]\nName? Sam\nHi Sam\n", "stderr": "tool.moth:6:1: can't write 'out.txt': this program isn't allowed to write files (start it with --allow-write)\nwrite \"made by \" + name to \"out.txt\"\n^\n", "status": 1, "out": null},
  {"flags": ["--allow-read", "--allow-write"], "stdout": "[one]\n[two words]\n[q\"uote]\n[]\nName? Sam\nHi Sam\nmade by Sam\n(6 bytes: 104, 101, 108, 108, 111, 10)\n100000\ncan't read 'data': EISDIR: illegal operation on a directory, read\nAgain? again\n", "stderr": "tool.moth:16:5: there is no file called 'missing.txt'\nsay read \"missing.txt\"\n    ^\n", "status": 1, "out": "made by Sam"},
  {"flags": ["--allow-all"], "stdout": "[one]\n[two words]\n[q\"uote]\n[]\nName? Sam\nHi Sam\nmade by Sam\n(6 bytes: 104, 101, 108, 108, 111, 10)\n100000\ncan't read 'data': EISDIR: illegal operation on a directory, read\nAgain? again\n", "stderr": "tool.moth:16:5: there is no file called 'missing.txt'\nsay read \"missing.txt\"\n    ^\n", "status": 1, "out": "made by Sam"},
  {"flags": ["--allow-read=data,in.txt", "--allow-write=."], "stdout": "[one]\n[two words]\n[q\"uote]\n[]\nName? Sam\nHi Sam\n", "stderr": "tool.moth:7:5: can't read 'out.txt': this program isn't allowed to read files (start it with --allow-read)\nsay read \"out.txt\"\n    ^\n", "status": 1, "out": "made by Sam"},
  {"flags": ["--allow-read=data", "--allow-write=data", "--allow-net=example.com"], "stdout": "[one]\n[two words]\n[q\"uote]\n[]\nName? Sam\nHi Sam\n", "stderr": "tool.moth:6:1: can't write 'out.txt': this program isn't allowed to write files (start it with --allow-write)\nwrite \"made by \" + name to \"out.txt\"\n^\n", "status": 1, "out": null}
];

test("moth.exe builds --allow flags in, and its program reads, writes, asks and takes arguments as moth run did", { skip }, () => {
  const { exe } = mothExe();
  const dirs = [];
  const setUp = () => {
    const dir = mkdtempSync(join(tmpdir(), "moth-machine-"));
    dirs.push(dir);
    writeFileSync(join(dir, "tool.moth"), ALLOW_SOURCE);
    writeFileSync(join(dir, "in.txt"), "hello\n");
    mkdirSync(join(dir, "data"));
    writeFileSync(join(dir, "data", "big.txt"), "é".repeat(100_000));
    return dir;
  };
  try {
    for (const want of AS_MOTH_RUN_DID) {
      const dir = setUp();
      const built = spawnSync(exe, ["build", "tool.moth", ...want.flags], { cwd: dir, encoding: "utf8" });
      assert.equal(built.status, 0, built.stdout + built.stderr);
      const got = spawnSync(executable(dir, "tool"), ["one", "two words", 'q"uote', ""], { cwd: dir, encoding: "utf8", input: "Sam\r\nagain" });
      const out = existsSync(join(dir, "out.txt")) ? readFileSync(join(dir, "out.txt"), "utf8") : null;
      assert.deepEqual({ flags: want.flags, stdout: got.stdout, stderr: got.stderr, status: got.status, out }, want, want.flags.join(" "));
    }
    for (const bad of ["--allow-everything", "--allow-all=x"]) { // not a flag moth knows: it says how to use it, ends with 2, and builds nothing
      const dir = setUp();
      const said = spawnSync(exe, ["build", "tool.moth", bad], { cwd: dir, encoding: "utf8" });
      assert.match(said.stderr, /^usage: moth /, bad);
      assert.deepEqual([said.status, said.stdout], [2, ""], bad);
      assert.ok(!existsSync(executable(dir, "tool")), bad);
    }
  } finally {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  }
});

// Going online: a program reads sites from a server of this test's own, on 127.0.0.1 over plain http, so
// nothing here needs the internet. What it must say is what moth-native (Moth's Rust engine, which went
// online with curl) said: the page's text or bytes, a move to another address followed only where the
// program may go, and any other answer from 300 up, a refused connection or an address that can't be one
// a mistake in the same words, on Windows (WinHTTP) and on Linux (curl) alike.
const ONLINE_SOURCE = [
  "set base to item 1 of arguments",
  "set nobody to item 2 of arguments",
  "to show with address, as_bytes",
  "    try",
  "        if as_bytes",
  "            say read bytes address",
  "        else",
  "            set page to read address",
  "            if length of page is greater than 100",
  '                say length of page " characters, ending " item (length of page) of page',
  "            else",
  '                say "[" page "]"',
  "            end",
  "        end",
  "    if it fails with why",
  "        say why",
  "    end",
  "end",
  'for each path in list of "/text", "/moved", "/twice", "/far", "/loop", "/ftp", "/nowhere", "/missing", "/broken", "/empty", "/big"',
  "    show(base + path, no)",
  "end",
  'show(base + "/bytes", yes)',
  "show(nobody, no)",
  'show("http://127.0.0.1:99999/", no)',
  'show("http://127.0.0.1/a page", no)',
].join("\n");
const BIG_PAGE = "0123456789abcdef".repeat(200_000); // 3.2 MB

// a server of the test's own; what it answers is in `routes`, by path
async function siteServer() {
  const server = createServer((req, res) => {
    const port = server.address().port;
    const routes = {
      "/text": [200, {}, Buffer.concat([Buffer.from("héllo\nwörld "), Buffer.from([0xff]), Buffer.from("!")])],
      "/bytes": [200, {}, Buffer.from([0, 1, 2, 254, 255, 10, 13])],
      "/moved": [302, { location: "/text" }, ""],
      "/twice": [307, { location: "moved" }, ""], // in the same folder, then on again
      "/far": [301, { location: `http://localhost:${port}/text` }, ""], // to another host
      "/loop": [302, { location: "/loop" }, ""],
      "/ftp": [302, { location: "ftp://example.com/file" }, ""],
      "/nowhere": [303, {}, "moved, but it doesn't say where"],
      "/missing": [404, {}, "not here"],
      "/broken": [500, {}, "oops"],
      "/empty": [204, {}, ""],
      "/big": [200, {}, BIG_PAGE],
    };
    const [status, headers, body] = routes[req.url] ?? [404, {}, ""];
    res.writeHead(status, headers);
    res.end(body);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server;
}

// a port on 127.0.0.1 nothing listens on
async function unusedPort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

// a program run while this one goes on, so the server above can answer it
function runWhileServing(exe, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    let [stdout, stderr] = ["", ""];
    child.stdout.setEncoding("utf8").on("data", (d) => (stdout += d));
    child.stderr.setEncoding("utf8").on("data", (d) => (stderr += d));
    const timer = setTimeout(() => child.kill(), 120_000);
    child.on("error", reject);
    child.on("close", (status) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, status });
    });
    child.stdin.end(); // away from a terminal, so nothing is asked
  });
}

// what the program says with --allow-net, or with only some sites allowed
function online(base, nobody, { refused = () => false } = {}) {
  const port = new URL(base).port;
  const cant = (path, why) => `can't read '${base}${path}': ${why}`;
  const notAllowed = "this program isn't allowed to go online (start it with --allow-net)";
  const read = (path, page) => (refused(base) ? cant(path, notAllowed) : page);
  return [
    read("/text", "[héllo\nwörld �!]"),
    read("/moved", "[héllo\nwörld �!]"),
    read("/twice", "[héllo\nwörld �!]"),
    read("/far", refused(`http://localhost:${port}/text`) ? cant("/far", `it moved to 'http://localhost:${port}/text', and ${notAllowed}`) : "[héllo\nwörld �!]"),
    read("/loop", cant("/loop", "it moved too many times")),
    read("/ftp", cant("/ftp", "it moved to 'ftp://example.com/file', which isn't a site")),
    read("/nowhere", cant("/nowhere", "the site answered 303")),
    read("/missing", cant("/missing", "the site answered 404")),
    read("/broken", cant("/broken", "the site answered 500")),
    read("/empty", "[]"),
    read("/big", `${BIG_PAGE.length} characters, ending f`),
    read("/bytes", "(7 bytes: 0, 1, 2, 254, 255, 10, 13)"),
    refused(nobody) ? `can't read '${nobody}': ${notAllowed}` : `can't read '${nobody}': couldn't reach it (Failed to connect to 127.0.0.1 port ${new URL(nobody).port}: Couldn't connect to server)`,
    refused("http://127.0.0.1:99999/") ? `can't read 'http://127.0.0.1:99999/': ${notAllowed}` : "can't read 'http://127.0.0.1:99999/': couldn't reach it (URL using bad/illegal format or missing URL)",
    refused("http://127.0.0.1/a page") ? `can't read 'http://127.0.0.1/a page': ${notAllowed}` : "can't read 'http://127.0.0.1/a page': couldn't reach it (URL using bad/illegal format or missing URL)",
    "",
  ].join("\n");
}

test("a program reads sites: their text and bytes, moves to another address, and what can go wrong", { skip }, async () => {
  const server = await siteServer();
  const dir = mkdtempSync(join(tmpdir(), "moth-online-"));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const nobody = `http://127.0.0.1:${await unusedPort()}/`;
    const exe = executable(dir, "online");
    const local = (address) => /^https?:\/\/127\.0\.0\.1[:/]/i.test(address);
    for (const [allow, refused] of [
      [["--allow-net"], () => false],
      [["--allow-all"], () => false],
      [["--allow-net=127.0.0.1"], (address) => !local(address)], // a name allows its host on any port
      [[`--allow-net=127.0.0.1:${server.address().port}`], (address) => !address.startsWith(base)], // or only on that one
      [["--allow-net=localhost"], (address) => local(address)],
      [[], () => true], // away from a terminal no one is asked, so nothing is allowed
      [["--allow-read", "--allow-write"], () => true],
    ]) {
      writeFileSync(exe, machine(ONLINE_SOURCE, { target, name: "online.moth", allow }));
      if (target === "linux") chmodSync(exe, 0o755);
      const got = await runWhileServing(exe, [base, nobody], dir);
      assert.deepEqual({ stdout: got.stdout, stderr: got.stderr, status: got.status }, { stdout: online(base, nobody, { refused }), stderr: "", status: 0 }, allow.join(" "));
    }
    // and `moth run`, which builds the --allow flags in the same way
    const { exe: moth, dir: mothDir } = mothExe();
    writeFileSync(join(mothDir, "online.moth"), ONLINE_SOURCE);
    const ran = await runWhileServing(moth, ["run", "--allow-net=127.0.0.1", "online.moth", base, nobody], mothDir);
    assert.deepEqual({ stdout: ran.stdout, stderr: ran.stderr, status: ran.status }, { stdout: online(base, nobody, { refused: (address) => !local(address) }), stderr: "", status: 0 });
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// A program that never reads is the bytes it was before it could go online: only one that reads has the
// code for it, and on Windows only one that reads imports WinHTTP.
test("only a program that reads can go online, and only it imports WinHTTP", () => {
  const imports = (bytes) => Buffer.from(bytes).includes(Buffer.from("WINHTTP.dll"));
  assert.ok(!imports(machine('say "hello"\nwrite "x" to "out.txt"\n', { target: "windows", name: "w.moth", allow: ["--allow-all"] })));
  assert.ok(imports(machine('say read "notes.txt"\n', { target: "windows", name: "r.moth" })));
  const reads = (source) => machine(source, { target: "linux", name: "r.moth" });
  assert.ok(!Buffer.from(reads('say "hello"\n')).includes(Buffer.from("%{http_code}")));
  assert.ok(Buffer.from(reads('say read bytes "notes.txt"\n')).includes(Buffer.from("%{http_code}")));
});

// A program's picture as its window shows it, drawn into a file instead (MOTH_PICTURE) after the events
// MOTH_EVENTS lists, and what it printed; and the colour, as "#rrggbb", at a place in the picture's own
// numbers: (0, 0) in the middle, y going up, unless it stopped at a mistake. Windows only, where the window is.
const onWindows = target === "windows" ? false : "the window is Windows only";
function picture(source, events = "") {
  const dir = mkdtempSync(join(tmpdir(), "moth-picture-"));
  try {
    const exe = join(dir, "p.exe");
    writeFileSync(exe, machine(source, { target, name: "p.moth" }));
    const file = join(dir, "p.bmp");
    const ran = spawnSync(exe, [], { cwd: dir, encoding: "utf8", env: { ...process.env, MOTH_PICTURE: file, MOTH_EVENTS: events } });
    if (!existsSync(file)) return { at: null, stdout: ran.stdout, stderr: ran.stderr, status: ran.status }; // it stopped at a mistake
    const bmp = readFileSync(file);
    assert.deepEqual([bmp.toString("latin1", 0, 2), bmp.readInt32LE(18), bmp.readInt32LE(22), bmp.length], ["BM", 500, -500, 54 + 500 * 500 * 4]);
    const at = (x, y) => {
      const p = 54 + ((250 - y) * 500 + 250 + x) * 4;
      return "#" + [bmp[p + 2], bmp[p + 1], bmp[p]].map((b) => b.toString(16).padStart(2, "0")).join("");
    };
    return { at, stdout: ran.stdout, stderr: ran.stderr, status: ran.status };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const BACKGROUND = "#0b1122";

test("a drawing becomes a picture as the playground draws it: lines, boxes, circles, text and colours", { skip: onWindows }, () => {
  const { at, stdout } = picture(`pen color "red"
draw box at -100, -100 size 50 by 50
pen color "#00F"
draw circle at 100, 100 size 30
pen color "no such colour"
draw box at 100, -100 size 20 by -20
pen color "Lime"
pen width 10
move forward 200
pen color "white"
draw "Moth" at -200, 150 size 40
say "drawn"`);
  assert.equal(stdout, "drawn\n");
  assert.equal(at(-75, -75), "#ff0000"); // the box
  assert.equal(at(-110, -110), BACKGROUND);
  assert.equal(at(100, 100), "#0000ff"); // the circle
  assert.equal(at(100, 125), "#0000ff");
  assert.equal(at(100, 135), BACKGROUND);
  assert.equal(at(110, -110), "#0000ff"); // a colour it doesn't know keeps the one before
  assert.equal(at(0, 100), "#00ff00"); // the line, 10 wide
  assert.equal(at(3, 100), "#00ff00");
  assert.equal(at(8, 100), BACKGROUND);
  let white = 0;
  for (let x = -200; x < -100; x++) for (let y = 150; y < 190; y++) if (at(x, y) === "#ffffff") white++;
  assert.ok(white > 100, `the text has ${white} white pixels`); // above its baseline
  assert.equal(at(-150, 140), BACKGROUND);
  assert.equal(at(-240, 240), BACKGROUND);
});

test("a picture shows what was drawn since the last clear, made smaller to fit if it reaches past the edge", { skip: onWindows }, () => {
  const { at } = picture(`pen color "red"
draw box at -50, -50 size 100 by 100
clear
pen color "gold"
draw box at 400, 400 size 80 by 80
pen color "blue"
draw box at -20, -20 size 40 by 40`);
  assert.equal(at(0, 0), "#0000ff"); // made half the size: 480 from the middle fits in 240
  assert.equal(at(15, 15), BACKGROUND);
  assert.equal(at(220, 220), "#ffd700");
  assert.equal(at(-40, -40), BACKGROUND); // the red box was cleared
});

// Apps: keys, clicks, drags and timers (by their place among the timers) sent to the handlers in order
const APP_EVENTS = [
  [`set n to 0
to helper with v
    return v / "x"
end
when a key is pressed with k
    add 1 to n
    say "key " + k + " " + n
    if k is "z"
        say helper(1)
    end
end
when the mouse is clicked with x and y
    say "clicked " + x + " " + y
end
when the mouse is clicked
    say "clicked, no numbers"
end
when the mouse is dragged with x and y
    say "dragged " + x + ", " + y
end
every 2 seconds
    say "tick " + n
end
every 5 milliseconds
    say "fast"
end
say "set up"`, "key a;click 3 -4;tick 0;drag -250 250;tick 1;key space;key z;key b"],
  [`set total to 0
set seen to empty list
when a key is pressed with key
    add key to seen
    say seen
end
every 1 second
    set total to total + 1
    move forward total * 10
    turn left 90
    say "at " + total
end
when the mouse is clicked with x and y
    draw circle at x, y size total
    say "circle " + x + " " + y + " " + total
end`, "tick 0;tick 0;key left;key enter;click 0 0;key escape;tick 0;click -10 20"],
  [`set n to 0
when a key is pressed with key
    add 1 to n
    say "key " + key + " " + n
    if key is "q"
        stop the program with 3
    end
end`, "key a;key q;key b"], // the program ends there, as in the playground
];

test("an app's handlers get keys, clicks, drags and timers, and say and fail as on the JavaScript engine", { skip: onWindows }, () => {
  for (const [source, events] of APP_EVENTS) {
    let stdout = "";
    let stderr = "";
    let status = 0;
    try {
      const app = run(source, (line) => (stdout += `${line}\n`), { file: "p.moth" });
      const timers = app.waits.flatMap((wait, i) => (wait.event === "every" ? [i] : []));
      for (const event of events.split(";")) {
        const [what, ...rest] = event.split(" ");
        if (what === "key") app.send("key", [rest.join(" ")]);
        else if (what === "tick") app.handle(timers[Number(rest[0])]);
        else app.send(what, rest.map(Number));
      }
      status = app.stopped ?? 0;
    } catch (err) {
      if (!(err instanceof MothError)) throw err;
      stderr = `p.moth:${err.line}:${err.col}: ${err.reason}\n${excerpt(source, err)}\n${err.trail.length ? `${describeTrail(err.trail)}\n` : ""}`;
      status = 1;
    }
    const got = picture(source, events);
    assert.deepEqual({ stdout: got.stdout, stderr: got.stderr, status: got.status }, { stdout, stderr, status }, events);
  }
  const { at } = picture(APP_EVENTS[1][0], APP_EVENTS[1][1]); // and what they drew
  assert.equal(at(0, 0), "#4f8ff7");
  assert.equal(at(-10, 22), "#4f8ff7");
  assert.equal(at(-10, 25), BACKGROUND);
});

test("a question that asks for a drawing, asked away from a terminal, is answered as any question is", { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), "moth-machine-"));
  try {
    const exe = executable(dir, "pad");
    writeFileSync(exe, machine(`set answer to ask "Draw a digit"\nsay "got " + answer\nmove forward 5`, { target, name: "pad.moth" }));
    if (target === "linux") chmodSync(exe, 0o755);
    const got = spawnSync(exe, [], { cwd: dir, encoding: "utf8", input: "10,20 30,40;50,60\n" });
    assert.deepEqual({ stdout: got.stdout, status: got.status }, { stdout: "Draw a digit 10,20 30,40;50,60\ngot 10,20 30,40;50,60\n", status: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
