// machine.moth, Moth's machine-code back end, against the JavaScript engine: every program it can make
// machine code of becomes a program for this system, which runs and must print, write as a mistake and exit
// exactly as the JavaScript engine does. Windows and Linux only.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run, machineCompiler, check, excerpt, describeTrail, format, MothError } from "./moth.js";
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
    ...brokenPrograms(11, 300), ...machinePrograms(2026, 400)];
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
      const got = spawnSync(exe, [], { cwd: dir, encoding: "utf8", timeout: 30_000, maxBuffer: 256 * 1024 * 1024 });
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
  not("move forward 10", /^line 1: drawing can't become machine code yet/);
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
// driver's own names start with zz_, as a file used `as` a name shares its functions' variables with the
// program's top level.
test("machine.moth in machine code compiles itself into the same bytes", { skip }, () => {
  const sources = { "machine.moth": here("machine.moth").replace(/\r/g, ""), "compiler.moth": here("compiler.moth").replace(/\r/g, "") };
  const want = machine(sources["machine.moth"], { files: { "compiler.moth": sources["compiler.moth"] }, target, name: "machine.moth" });
  let sum = 0, mix = 0;
  want.forEach((x, i) => { sum += x; mix += x * ((i + 1) & 1023); });
  const driver = `use "machine.moth" as m
set zz_bytes to m's compile_machine(${JSON.stringify(sources["machine.moth"])}, (list of "compiler.moth"), (list of ${JSON.stringify(sources["compiler.moth"])}), "${target}", "machine.moth")
say length of zz_bytes
set zz_sum to 0
set zz_mix to 0
for each zz_i from 1 to length of zz_bytes
    add item zz_i of zz_bytes to zz_sum
    add item zz_i of zz_bytes * (zz_i bit and 1023) to zz_mix
end
say zz_sum
say zz_mix
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

// A `set` in a function changes a variable of the same name at the top level, and a file used `as` a name
// shares its functions' variables with the program's top level: names that clash there change each other.
test("machine.moth's functions never set a name its top level or compiler.moth's functions use", () => {
  const top = new Set([...here("machine.moth").matchAll(/^(?:set|to) ([a-z_0-9]+)/gm)].map((m) => m[1]));
  const set = (source) => [...source.matchAll(/^[ \t]+(?:set|for each) ([a-z_0-9]+)/gm)].map((m) => m[1]);
  assert.deepEqual(set(here("machine.moth")).filter((n) => top.has(n)), []);
  assert.deepEqual([...new Set(set(here("compiler.moth")))].filter((n) => top.has(n)), []);
  // moth.moth uses machine.moth as a name, so no function in any of the three may set what its top level makes
  const mothTop = new Set([...here("moth.moth").matchAll(/^(?:set|to) ([a-z_0-9]+)/gm)].map((m) => m[1]));
  for (const file of ["moth.moth", "machine.moth", "compiler.moth"]) assert.deepEqual([...new Set(set(here(file)))].filter((n) => mothTop.has(n)), [], file);
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
  // a program in a folder of its own, and `run` with no file at all
  const deep = spawnSync(exe, ["run", join("deeper", "deep.moth")], { cwd: dir, encoding: "utf8" });
  assert.deepEqual([deep.status, deep.stdout], [0, "deep\n"]);
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
