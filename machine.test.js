// machine.moth, Moth's machine-code back end, against the JavaScript engine: every program it can make
// machine code of becomes a program for this system, which runs and must print, write as a mistake and exit
// exactly as the JavaScript engine does. Windows and Linux only.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import https from "node:https";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run, test as testMoth, machineCompiler, check, excerpt, describeTrail, format, MothError, memoryDisk, soundWav } from "./moth.js";
import examples from "./examples.js";
import { PROGRAMS, ERRORS, SAVING, brokenPrograms } from "./cases.js";
import { FAKE_NOW } from "./vm.js";
import { pngCases, bmpCases, brokenPictures, handmadeBroken } from "./picture-cases.js";
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
  folder: refused("read files (start it with --allow-read)"),
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
    if (/^stopped after|^can't run programs here|^can't use the library/.test(err.reason)) return null; // too long to wait for, or a program or library it would run
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
      // random numbers from the seed, and the clock from the moment, the JavaScript engine uses when it isn't given real ones
      const got = spawnSync(exe, [], { cwd: dir, encoding: "utf8", timeout: 30_000, maxBuffer: 256 * 1024 * 1024, env: { ...process.env, MOTH_SEED: "1", MOTH_NOW: String(FAKE_NOW) } });
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
  not("say 0x20000000000000", /^line 1: a hex or binary number this big can't become machine code yet/);
  not("say 1 +", /^line 1: expected a value but found the end of the code$/); // a mistake in the program, as run says it
});

// `read table`, which needs a file: each program built with --allow-read and run in a folder with its files,
// against the JavaScript engine reading the same files from memory. Headers made into field names, cells in
// quotes, blank lines, missing cells, a table read twice, and the mistakes.
const SALES = 'Name,Price,Qty\nApple,1.5,10\nPear,2,3\n"Big, red melon",12.25,1\nKiwi,,\n';
const TABLES = [
  [['set sales to read table "sales.csv"', 'say length of sales " rows: " item 1 of sales',
    "for each row in sales where price of row is not nothing and price of row is greater than 1.6", "    say name of row", "end",
    'say total of price in sales " " average of price in sales " " largest of qty in sales " " smallest of name in sales',
    "say sales", 'say (read table "sales.csv") is sales', "draw chart of price in sales", 'say "charted"'].join("\n"),
    { "sales.csv": SALES }],
  ['set t to read table "x.csv"\nfor each r in t\n    say r\nend', { "x.csv": 'A b,"q""uote",a b,,1x,_x_,\u00c9\u00c0,a-b-c,a b\r\n1,2,3,4,5,6,7,8,9\r\n\r\n"multi\nline",-3.5, 07 ,0x10,1e3,,"",x"y,\n\n' }],
  ['say read table "a.csv"\nsay read table "b.csv"\nsay read table "c.csv"', { "a.csv": "", "b.csv": "\n\n\r\n", "c.csv": "only,header" }],
  ['say read table "a.csv"\nsay read table "b.csv"\nsay read table "c.csv"\nsay read table "d.csv"', { "a.csv": "a,a,a,a_2\n1,2,3,4\n5",
    "b.csv": 'x\n"unclosed,1\n2', "c.csv": '"""",b\n"""""",""x', "d.csv": "1,2,3\n4,5,6\n,,\n7\n" }],
  ['set t to read table "e.csv"\nsay name of item 1 of t\nsay (record with name "Ana", age 3) is item 2 of t\nsay total of age in t\nsay total of ages in t', { "e.csv": "Name,Age\nSam,20\nAna,3\n" }],
  ['set t to read table "e.csv"\nsay total of age in t', { "e.csv": "Name,Age\nSam,old\n" }],
  ['say read table "missing.csv"', {}],
];

// Each program, built with --allow-read, run in a folder of its own with its files, against the JavaScript
// engine with the same files in memory
function withFiles(cases) {
  const dirs = [];
  try {
    cases.forEach(([source, files], i) => {
      const dir = mkdtempSync(join(tmpdir(), "moth-files-"));
      dirs.push(dir);
      for (const [name, text] of Object.entries(files)) {
        mkdirSync(join(dir, ...name.split("/").slice(0, -1)), { recursive: true });
        writeFileSync(join(dir, ...name.split("/")), text);
      }
      let [stdout, stderr, status] = ["", "", 0];
      try {
        run(source, (line) => (stdout += `${line}\n`), { file: "t.moth", disk: memoryDisk(files) });
      } catch (err) {
        if (!(err instanceof MothError)) throw err;
        stderr = `t.moth:${err.line}:${err.col}: ${err.reason}\n${excerpt(source, err)}\n`;
        status = 1;
      }
      const exe = executable(dir, "t");
      writeFileSync(exe, machine(source, { target, name: "t.moth", allow: ["--allow-read"] }));
      if (target === "linux") chmodSync(exe, 0o755);
      const got = spawnSync(exe, [], { cwd: dir, encoding: "utf8" });
      assert.deepEqual({ stdout: got.stdout, stderr: got.stderr, status: got.status }, { stdout, stderr, status }, `${i}: ${source}`);
    });
  } finally {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  }
}

test("a table read from a file is the list of records the JavaScript engine makes of it", { skip }, () => withFiles(TABLES));

// `read the folder`: what is in a folder and the folders inside it, in Moth's order for text, a folder's name
// with / after it; and what goes wrong. (The folder the program runs in also holds the program, so only the
// folders inside it are compared.)
const FOLDER_FILES = { "data/z.txt": "1", "data/a b.txt": "2", "data/sub/deep.txt": "3", "data/\u00c9.txt": "4", "data/B.txt": "5",
  "data/sub/more/x.txt": "6", "data/.hidden": "7", "data/\ud83d\ude00.txt": "8", "data/\uff21.txt": "9", "data/_.txt": "0" };
const FOLDERS = [
  ['say read the folder "data"\nfor each n in read the folder "data/"\n    say n\nend\nsay read the folder "data/sub"\nsay read the folder "data/sub/more/"', FOLDER_FILES],
  ['to walk with folder\n    for each n in read the folder folder\n        if "/" is in n\n            walk(folder + "/" + n)\n        else\n            say folder + "/" + n\n        end\n    end\nend\nwalk("data")', FOLDER_FILES],
  ['for each name in list of "nowhere", 5, list of "data"\n    try\n        say read the folder name\n    if it fails with why\n        say why\n    end\nend\nsay read the folder "data/nowhere"', FOLDER_FILES],
];

test("a folder read in machine code holds what the JavaScript engine finds in it", { skip }, () => withFiles(FOLDERS));

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
  "set trip to 0 km\nset legs to empty list\nfor each i from 1 to 3000000\n    add 1 m to trip\n    if i is divisible by 1000\n        add trip in m to legs\n    end\nend\nsay trip\nsay length of legs\nsay item 1000 of legs\nsay total of legs\nsay largest of legs\nset rows to empty list\nfor each i from 1 to 200000\n    add record with n i, d i * 1 km to rows\nend\nsay total of d in rows\nsay average of n in rows",
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
  const text = (code) => JSON.stringify(code).replaceAll("{", "\\{"); // as Moth text: a { is itself
  want.forEach((x, i) => { sum += x; mix += x * ((i + 1) & 1023); });
  const driver = `set total to 0
set k to 0
use "machine.moth" as m
set made to m's compile_machine(${text(sources["machine.moth"])}, (list of "compiler.moth"), (list of ${text(sources["compiler.moth"])}), "${target}", "machine.moth")
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
  const sources = Object.fromEntries(["moth.moth", "machine.moth", "compiler.moth", "stdlib.moth", "moth-debugger.moth"].map((f) => [f, here(f)]));
  const made = machine(sources["moth.moth"], { files: { "machine.moth": sources["machine.moth"], "compiler.moth": sources["compiler.moth"], "stdlib.moth": sources["stdlib.moth"] }, target, name: "moth.moth", allow: ["--allow-read", "--allow-write", "--allow-run"],
    include: { "moth-debugger.moth": Buffer.from(sources["moth-debugger.moth"]) } });
  const exe = executable(dir, "moth-first");
  writeFileSync(exe, made);
  if (target === "linux") chmodSync(exe, 0o755);
  for (const [name, text] of Object.entries(sources)) writeFileSync(join(dir, name), text);
  standalone = { dir, exe, made };
  return standalone;
}
after(() => standalone && rmSync(standalone.dir, { recursive: true, force: true }));

// moth debug (DESIGN §59): a program built to be debugged stops before its first line, and before each line
// it's told to, and says where it is, what each variable holds and which calls are in progress, from
// commands on its input; and, told to go, does all the rest just as the program built the usual way does.
const DEBUG_LIB = "set calls_made to 0\nto twice with t\n    add 1 to calls_made\n    return t + t\nend\n";
const DEBUG_PROGRAM = "use \"lib.moth\" as lib\nto counter\n    set count to 0\n    to bump\n        add 1 to count\n        return count\n    end\n    return bump\nend\nto risky with n\n    if n is 0\n        fail with \"none left\"\n    end\n    return risky(n - 1)\nend\nset tick to counter()\ntick()\nset sam to record with name \"Sam\", pets (list of \"cat\")\ntry\n    risky(2)\nif it fails with why\n    say \"caught \" why\nend\nset name to ask \"Name?\"\nsay lib's twice(name) \" \" sam\nsay \"done\"";
const DEBUG_RUNS = [
  ["step\nstep\nwhere\nlist\nbreak prog.moth 5\ngo\nvars\nwhere\nout\nnext\nshow tick\nshow sam\nshow nope\nbreak prog.moth 12\nbreaks\ngo\nwhere\nout\nshow why\nclear prog.moth 12\nclear prog.moth 12\ngo\nAna\n\n",
    "lib.moth:1: set calls_made to 0\n(moth) step\nlib.moth:2: to twice with t\n(moth) step\nprog.moth:2: to counter\n(moth) where\n  prog.moth:2\n(moth) list\n   1  use \"lib.moth\" as lib\n-> 2  to counter\n   3      set count to 0\n   4      to bump\n   5          add 1 to count\n(moth) break prog.moth 5\nbreakpoint at prog.moth:5\n(moth) go\nprog.moth:5, in 'bump': add 1 to count\n(moth) vars\nbump is <function bump>\ncount is 0\ntick is <function bump>\nsam has no value yet\nwhy has no value yet\nname has no value yet\n(moth) where\n  prog.moth:5, in 'bump'\n  prog.moth:17\n(moth) out\nprog.moth:18: set sam to record with name \"Sam\", pets (list of \"cat\")\n(moth) next\nprog.moth:19: try\n(moth) show tick\ntick is <function bump>\n(moth) show sam\nsam is (record with name \"Sam\", pets [\"cat\"])\n(moth) show nope\nthere's no 'nope' here\n(moth) break prog.moth 12\nbreakpoint at prog.moth:12\n(moth) breaks\nbreakpoint at prog.moth:5\nbreakpoint at prog.moth:12\n(moth) go\nprog.moth:12, in 'risky': fail with \"none left\"\n(moth) where\n  prog.moth:12, in 'risky'\n  prog.moth:14, in 'risky'\n  prog.moth:14, in 'risky'\n  prog.moth:20\n(moth) out\nprog.moth:22: say \"caught \" why\n(moth) show why\nwhy is \"none left\"\n(moth) clear prog.moth 12\nbreakpoint at prog.moth:12 taken away\n(moth) clear prog.moth 12\nthere's no breakpoint there: breaks lists them\n(moth) go\ncaught none left\nName? Ana\nAnaAna (record with name \"Sam\", pets [\"cat\"])\ndone\n"],
  ["break lib.moth 4\ngo\nBo\nshow t\nwhere\nfrobnicate\nhelp\n",
    "lib.moth:1: set calls_made to 0\n(moth) break lib.moth 4\nbreakpoint at lib.moth:4\n(moth) go\ncaught none left\nName? Bo\nlib.moth:4, in 'lib's twice': return t + t\n(moth) show t\nt is \"Bo\"\n(moth) where\n  lib.moth:4, in 'lib's twice'\n  prog.moth:25\n(moth) frobnicate\nI don't know 'frobnicate': help says what I do\n(moth) help\nstep (s)        run this line, and stop at the next one, in a call it makes too\nnext (n)        run this line, and stop at the next one here or after\nout (o)         run on, and stop once this call is over\ngo (g)          run on, and stop only at a breakpoint\nbreak 12 (b)    stop at line 12 of this file; break math.moth 12 for another\nclear 12        take that breakpoint away; breaks lists them\nshow x (p)      what x holds; vars (v) shows every variable\nwhere (w)       this line, and the calls in progress\nlist (l)        the lines around this one\nquit (q)        end the program here\n(moth) \nBoBo (record with name \"Sam\", pets [\"cat\"])\ndone\n"],
  ["next\nnext\nquit\n",
    "lib.moth:1: set calls_made to 0\n(moth) next\nlib.moth:2: to twice with t\n(moth) next\nprog.moth:2: to counter\n(moth) quit\n"],
];

test("a program built to be debugged steps, stops at breakpoints, and shows its variables and calls", { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), "moth-debug-"));
  try {
    const exe = executable(dir, "prog");
    writeFileSync(exe, machine(DEBUG_PROGRAM, { target, name: "prog.moth", debug: true, files: { "lib.moth": DEBUG_LIB, "moth-debugger.moth": here("moth-debugger.moth") } }));
    if (target === "linux") chmodSync(exe, 0o755);
    for (const [input, want] of DEBUG_RUNS) {
      const got = spawnSync(exe, [], { input, encoding: "utf8", timeout: 60_000 });
      assert.deepEqual({ stdout: got.stdout, stderr: got.stderr, status: got.status }, { stdout: want, stderr: "", status: 0 }, input);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a program built to be debugged, told to go, says and fails just as its usual build does", { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), "moth-debug-"));
  const files = { "moth-debugger.moth": here("moth-debugger.moth") };
  // not those that ask, whose questions would take the commands, nor those that use the clock or chance
  const sources = [...PROGRAMS.map(([s]) => s), ...ERRORS.map(([s]) => s), ...Object.values(examples)]
    .filter((source) => !/\b(ask|random|clock|wait|the time)\b/.test(source));
  let compared = 0;
  try {
    sources.forEach((source, i) => {
      let usual;
      try {
        usual = machine(source, { target, name: "p.moth" });
      } catch (err) {
        if (err instanceof MothError) return; // not machine code yet, or a mistake in the program
        throw err;
      }
      const debugged = machine(source, { target, name: "p.moth", debug: true, files });
      const ran = (bytes, name) => {
        const exe = executable(dir, name);
        writeFileSync(exe, bytes);
        if (target === "linux") chmodSync(exe, 0o755);
        return spawnSync(exe, [], { input: "go\n", encoding: "utf8", timeout: 60_000 });
      };
      const want = ran(usual, `u${i}`);
      const got = ran(debugged, `d${i}`);
      const first = /^[^\n]*\n\(moth\) go\n/.exec(got.stdout); // where it stopped first, and the command
      assert.deepEqual({ stdout: first ? got.stdout.slice(first[0].length) : got.stdout, stderr: got.stderr, status: got.status },
        { stdout: want.stdout, stderr: want.stderr, status: want.status }, source);
      compared++;
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  assert.ok(compared > 200, `only ${compared} compared`);
});

test("moth.exe debug runs a program with the debugger it was built with, passing its arguments on", { skip }, () => {
  const { dir, exe } = mothExe();
  const sub = join(dir, "debugging");
  mkdirSync(sub, { recursive: true });
  writeFileSync(join(sub, "area.moth"), "to area with w, h\n    return w * h\nend\nset total to 0\nfor each i from 1 to 3\n    add area(i, 2) to total\nend\nsay \"total \" total \" from \" arguments\n");
  const got = spawnSync(exe, ["debug", "area.moth", "a", "b"], { cwd: sub, input: "break 2\ngo\nwhere\nvars\nclear 2\ngo\n", encoding: "utf8", timeout: 120_000 });
  assert.equal(got.stderr, "");
  assert.equal(got.stdout, [
    "area.moth:1: to area with w, h", "(moth) break 2", "breakpoint at area.moth:2", "(moth) go", "area.moth:2, in 'area': return w * h",
    "(moth) where", "  area.moth:2, in 'area'", "  area.moth:6", "(moth) vars", "w is 1", "h is 2", "total is 0", "i is 1",
    "(moth) clear 2", "breakpoint at area.moth:2 taken away", "(moth) go", 'total 12 from ["a", "b"]', ""].join("\n"));
  assert.equal(got.status, 0);
  assert.deepEqual(readdirSync(sub), ["area.moth"]); // the program it built, gone
  const wrong = spawnSync(exe, ["debug"], { cwd: sub, encoding: "utf8" });
  assert.equal(wrong.status, 2);
  assert.match(wrong.stderr, /moth debug \[--allow-\.\.\.\] <file\.moth> \[arguments\.\.\.\]/);
});

// Packages (DESIGN §60): Git repositories made here, a package that uses a file of its own and another that
// uses it, fetched, run, updated to a new commit, fetched again at theirs, and taken away, by moth.exe
const gitHere = spawnSync("git", ["--version"], { encoding: "utf8" }).status === 0;
// The package index: moth search lists an index's packages, or those with every word asked for, and moth add
// takes one by its name there; a name the index hasn't, an index that isn't there and one that isn't JSON say so
test("moth search lists a package index, and moth add takes a package by its name there", { skip: skip || (gitHere ? false : "there's no git") }, () => {
  const { dir, exe } = mothExe();
  const root = join(dir, "indexing");
  mkdirSync(root, { recursive: true });
  const moth = (cwd, ...args) => {
    const done = spawnSync(exe, args, { cwd, encoding: "utf8", timeout: 120_000 });
    return [done.stdout, done.stderr, done.status];
  };
  const source = join(root, "greeter");
  mkdirSync(source);
  writeFileSync(join(source, "greeter.moth"), 'to greet with who\n    return "Hello, " + who + "!"\nend\n');
  for (const args of [["init", "-q"], ["add", "."], ["commit", "-qm", "one"]]) {
    assert.equal(spawnSync("git", ["-c", "user.name=moth", "-c", "user.email=moth@example.com", ...args], { cwd: source }).status, 0);
  }
  const app = join(root, "app");
  mkdirSync(app);
  writeFileSync(join(app, "index.json"), JSON.stringify({ packages: { greeter: { repository: source.replace(/\\/g, "/"), about: "Says hello to anyone" },
    zipper: { repository: "github.com/example/zipper", about: "Squeezes files" } } }));
  assert.deepEqual(moth(app, "search", "--index", "index.json"), ["greeter  Says hello to anyone\nzipper   Squeezes files\n", "", 0]);
  assert.deepEqual(moth(app, "search", "HELLO", "anyone", "--index", "index.json"), ["greeter  Says hello to anyone\n", "", 0]);
  assert.deepEqual(moth(app, "search", "nothing", "--index", "index.json"), ["no package in the index has nothing\n", "", 0]);
  const added = moth(app, "add", "greeter", "--index", "index.json");
  assert.match(added[0], /^added greeter at [0-9a-f]{7}, from .*greeter\n$/);
  writeFileSync(join(app, "p.moth"), 'use the package "greeter"\nsay greet("Sam")\n');
  assert.deepEqual(moth(app, "run", "p.moth"), ["Hello, Sam!\n", "", 0]);
  assert.deepEqual(moth(app, "add", "nope", "--index", "index.json"), ["", "moth: the package index has no package called nope: moth search lists them\n", 1]);
  assert.deepEqual(moth(app, "search", "--index", "nowhere.json"), ["", "moth: can't read the package index at nowhere.json: there is no file called 'nowhere.json'\n", 1]);
  writeFileSync(join(app, "bad.json"), "{ not json");
  const bad = moth(app, "search", "--index", "bad.json");
  assert.deepEqual([bad[0], bad[2]], ["", 1]);
  assert.match(bad[1], /^moth: the package index at bad\.json isn't one: /);
});

test("moth add, update, get and remove keep packages/ and moth.packages, and use the package finds them", { skip: skip || (gitHere ? false : "there's no git") }, () => {
  const { dir, exe } = mothExe();
  const root = join(dir, "packaging");
  mkdirSync(root, { recursive: true });
  const git = (cwd, ...args) => {
    const done = spawnSync("git", ["-c", "user.name=moth", "-c", "user.email=moth@example.com", "-c", "core.autocrlf=false", ...args], { cwd, encoding: "utf8" });
    assert.equal(done.status, 0, done.stderr);
    return done.stdout.trim();
  };
  const moth = (cwd, ...args) => {
    const done = spawnSync(exe, args, { cwd, encoding: "utf8", timeout: 120_000 });
    return [done.stdout, done.stderr, done.status];
  };
  const repo = (name, files) => {
    const at = join(root, name);
    mkdirSync(at, { recursive: true });
    for (const [file, text] of Object.entries(files)) writeFileSync(join(at, file), text);
    git(at, "init", "-q");
    git(at, "add", ".");
    git(at, "commit", "-qm", "one");
    return at;
  };
  const greet = repo("greet", { "greet.moth": 'use "words.moth" as words\nto hello with n\n    return words\'s hi + ", " + n\nend\n', "words.moth": 'set hi to "Hello"\n' });
  const first = git(greet, "rev-parse", "HEAD");
  const app = join(root, "app");
  mkdirSync(app);
  writeFileSync(join(app, "app.moth"), 'use the package "greet" as greet\nsay greet\'s hello("Sam")\n');
  assert.deepEqual(moth(app, "packages"), ["no packages: moth add <git repository> adds one\n", "", 0]);
  assert.deepEqual(moth(app, "add", "../greet"), [`added greet at ${first.slice(0, 7)}, from ../greet\n`, "", 0]);
  assert.match(readFileSync(join(app, "moth.packages"), "utf8"), new RegExp(`\\ngreet \\.\\./greet ${first}\\n$`));
  assert.deepEqual(moth(app, "run", "app.moth"), ["Hello, Sam\n", "", 0]);

  // a new commit: update moves to it, and a second says it's at its newest
  writeFileSync(join(greet, "words.moth"), 'set hi to "Hi"\n');
  git(greet, "commit", "-qam", "two");
  const second = git(greet, "rev-parse", "HEAD");
  assert.deepEqual(moth(app, "update"), [`greet: ${first.slice(0, 7)} -> ${second.slice(0, 7)}\n`, "", 0]);
  assert.deepEqual(moth(app, "run", "app.moth"), ["Hi, Sam\n", "", 0]);
  assert.deepEqual(moth(app, "update", "greet"), [`greet is at its newest, ${second.slice(0, 7)}\n`, "", 0]);
  assert.deepEqual(moth(app, "packages"), [`greet at ${second.slice(0, 7)}, from ../greet\n`, "", 0]);

  // packages/ gone, as on another computer: get brings each back, at its commit
  rmSync(join(app, "packages"), { recursive: true, force: true });
  assert.deepEqual(moth(app, "packages"), [`greet at ${second.slice(0, 7)}, from ../greet (not fetched: moth get fetches it)\n`, "", 0]);
  assert.deepEqual(moth(app, "get"), [`greet at ${second.slice(0, 7)}\n`, "", 0]);
  assert.deepEqual(moth(app, "run", "app.moth"), ["Hi, Sam\n", "", 0]);

  // a package that uses another comes with it, at the commit its own moth.packages lists
  const shout = repo("shout", { "shout.moth": 'use the package "greet" as greet\nto shout with n\n    return uppercase of greet\'s hello(n)\nend\n',
    "moth.packages": `greet ../greet ${first}\n` });
  const shouting = git(shout, "rev-parse", "HEAD");
  const other = join(root, "other");
  mkdirSync(other);
  writeFileSync(join(other, "app.moth"), 'use the package "shout" as shout\nsay shout\'s shout("Bo")\n');
  assert.deepEqual(moth(other, "add", "../shout"),
    [`added shout at ${shouting.slice(0, 7)}, from ../shout\nadded greet at ${first.slice(0, 7)}, which shout uses\n`, "", 0]);
  assert.deepEqual(moth(other, "run", "app.moth"), ["HELLO, BO\n", "", 0]);

  // mistakes
  assert.deepEqual(moth(other, "add", "../shout"), ["", "moth: there's a package called shout here already: moth update shout moves it to its newest\n", 1]);
  assert.deepEqual(moth(other, "add", "../shout", "bad/name"),
    ["", "moth: 'bad/name' can't be a package's name (letters, digits, '-', '_' and '.' make one): give it one, as in moth add ../shout thing\n", 1]);
  const nowhere = moth(other, "add", "../nowhere");
  assert.equal(nowhere[2], 1);
  assert.match(nowhere[1], /^moth: git couldn't fetch \.\.\/nowhere: /);
  assert.deepEqual(moth(other, "remove", "nope"), ["", "moth: there's no package called nope here: moth packages lists them\n", 1]);
  assert.equal(moth(other, "add")[2], 2);
  assert.deepEqual(moth(root, "get"), ["", "moth: there's no moth.packages here: moth add <git repository> adds a package\n", 1]);

  // remove: its folder and its line gone
  assert.deepEqual(moth(other, "remove", "greet"), ["removed greet\n", "", 0]);
  assert.deepEqual(readdirSync(join(other, "packages")), ["shout"]);
  assert.deepEqual(moth(other, "packages"), [`shout at ${shouting.slice(0, 7)}, from ../shout\n`, "", 0]);
});

// `moth notebook`: each ```moth block run in turn, as the shell's entries, and what it said written under it,
// in place of the ```output block there was; a block that ends in a value shows it; a mistake is written there
// too, and the next block still has what came before. Run again, the file stays the same.
test("moth.exe notebook runs a Markdown file's blocks, and writes what each said under it", { skip }, () => {
  const { dir, exe } = mothExe();
  const sub = join(dir, "notebook");
  mkdirSync(sub);
  writeFileSync(join(sub, "notes.md"), "# Squares\n\nSome numbers first.\n\n```moth\nset xs to list of 1, 2, 3, 4\nsay \"made \" + length of xs\n```\n\nTheir squares, with a function:\n\n```moth\nto square with n\n    return n * n\nend\nlist of square(x) for each x in xs\n```\n\n```output\nan old output, which goes\n```\n\nA mistake:\n\n```moth\nsay 1 / 0\n```\n\nAnd the names from before are still there:\n\n```moth\nsay xs\nsay square(12)\n```\n");
  const after = "# Squares\n\nSome numbers first.\n\n```moth\nset xs to list of 1, 2, 3, 4\nsay \"made \" + length of xs\n```\n\n```output\nmade 4\n```\n\nTheir squares, with a function:\n\n```moth\nto square with n\n    return n * n\nend\nlist of square(x) for each x in xs\n```\n\n```output\n[1, 4, 9, 16]\n```\n\nA mistake:\n\n```moth\nsay 1 / 0\n```\n\n```output\nblock 3:1:7: can't divide by zero\nsay 1 / 0\n      ^\n```\n\nAnd the names from before are still there:\n\n```moth\nsay xs\nsay square(12)\n```\n\n```output\n[1, 2, 3, 4]\n144\n```\n";
  for (const time of [1, 2]) {
    const ran = spawnSync(exe, ["notebook", "notes.md"], { cwd: sub, encoding: "utf8", timeout: 120_000 });
    assert.deepEqual([ran.stdout, ran.stderr, ran.status], ["notes.md: 4 blocks run, 1 of them with a mistake\n", "", 1], `run ${time}`);
    assert.equal(readFileSync(join(sub, "notes.md"), "utf8"), after, `run ${time}`);
  }
  assert.deepEqual(readdirSync(sub), ["notes.md"], "what it built to run the blocks was left behind");
});

// The shell: a line whose value makes functions of its own (a list built from a list) runs once, not again in
// every entry after it
test("moth.exe shell runs an entry that builds a list once", { skip }, () => {
  const { dir, exe } = mothExe();
  const sub = join(dir, "shell-lists");
  mkdirSync(sub);
  const ran = spawnSync(exe, ["shell"], { cwd: sub, encoding: "utf8", input: "set xs to list of 1, 2\nsay list of x * 2 for each x in xs\nsay 5\nxs\n", timeout: 120_000 });
  assert.equal(ran.stdout.split("\n").filter((l) => !l.startsWith("Moth shell")).join("\n"),
    "moth> set xs to list of 1, 2\nmoth> say list of x * 2 for each x in xs\n[2, 4]\nmoth> say 5\n5\nmoth> xs\n[1, 2]\nmoth> \n\n");
});

// `moth profile`: the program runs as moth run runs it, and then the error output says each function's own time
// and calls, and the lines that took longest, with how often each ran; also when it stops itself
test("moth.exe profile runs a program, then says where its time went", { skip }, () => {
  const { dir, exe } = mothExe();
  const sub = join(dir, "profiling");
  mkdirSync(sub);
  writeFileSync(join(sub, "work.moth"), "to slow_sum with n\n    set total to 0\n    for each k from 1 to n\n        set total to total + k * k\n    end\n    return total\nend\n"
    + "to quick with x\n    return x + 1\nend\nset grand to 0\nfor each i from 1 to 40\n    set grand to grand + slow_sum(20000)\n    set grand to quick(grand)\nend\nsay grand\nsay arguments\n");
  const ran = spawnSync(exe, ["profile", "work.moth", "a", "b"], { cwd: sub, encoding: "utf8", timeout: 120_000 });
  assert.deepEqual([ran.stdout, ran.status], ["106674666800040\n[\"a\", \"b\"]\n", 0], ran.stderr);
  const lines = ran.stderr.split("\n");
  assert.match(lines[0], /^moth profile: \d+\.\d{3} s in all, 800246 lines run$/);
  assert.equal(lines[2], "  own time        calls  function");
  assert.match(lines[3], /^ +\d+\.\d{3} s +\d+\.\d% +40  slow_sum$/);
  assert.ok(lines.some((l) => / 40  quick$/.test(l)) && lines.some((l) => / 1  \(the program\)$/.test(l)), ran.stderr);
  const top = lines.indexOf("  time                 runs  line");
  assert.match(lines[top + 1], /^ +\d+\.\d{3} s +\d+\.\d% +800000  work\.moth:4  set total to total \+ k \* k$/);
  writeFileSync(join(sub, "stops.moth"), 'say "before"\nstop the program with 3\n');
  const stops = spawnSync(exe, ["profile", "stops.moth"], { cwd: sub, encoding: "utf8" });
  assert.deepEqual([stops.stdout, stops.status], ["before\n", 3]);
  assert.match(stops.stderr, /^moth profile: 0\.\d{3} s in all, 2 lines run\n[^]*stops\.moth:2  stop the program with 3\n$/);
  assert.deepEqual(readdirSync(sub).sort(), ["stops.moth", "work.moth"], "the program built to profile was left behind");
});

// The standard library: in a folder with nothing else in it, a program uses json.moth, math.moth and big.moth,
// and big.moth's tests run, from moth's own copies; a file of a standard name beside the program is used instead
test("moth.exe has the standard library, so a program anywhere can use it, and a file beside it comes first", { skip }, () => {
  const { dir, exe } = mothExe();
  const sub = join(dir, "anywhere");
  mkdirSync(sub);
  writeFileSync(join(sub, "p.moth"), 'use "json.moth" as json\nuse "math.moth"\nuse "big.moth" as big\nsay item "a" of json\'s parse("\\{\\"a\\": [1, 2]}")\nsay sqrt(16)\nsay big\'s power(2, 70)\n');
  const ran = spawnSync(exe, ["run", "p.moth"], { cwd: sub, encoding: "utf8" });
  assert.deepEqual([ran.stdout, ran.stderr, ran.status], ["[1, 2]\n4\n1180591620717411303424\n", "", 0]);
  writeFileSync(join(sub, "big.test.moth"), here("tools/big.test.moth"));
  const tested = spawnSync(exe, ["test", "big.test.moth"], { cwd: sub, encoding: "utf8", timeout: 120_000 });
  assert.deepEqual([tested.stdout.split("\n").at(-2), tested.status], ["6 passed", 0], tested.stdout);
  writeFileSync(join(sub, "math.moth"), "to sqrt with x\n    return \"my own\"\nend\n");
  const own = spawnSync(exe, ["run", "p.moth"], { cwd: sub, encoding: "utf8" });
  assert.deepEqual([own.stdout, own.status], ["[1, 2]\nmy own\n1180591620717411303424\n", 0]);
  writeFileSync(join(sub, "q.moth"), 'use "nowhere.moth"\n');
  const missing = spawnSync(exe, ["run", "q.moth"], { cwd: sub, encoding: "utf8" });
  assert.match(missing.stderr, /there is no file called 'nowhere\.moth'/);
});

test("moth.exe builds a program, and itself into the same bytes", { skip }, () => {
  const { dir, exe, made } = mothExe();
  writeFileSync(join(dir, "lib.moth"), "to twice with t\n    return t + t\nend\n");
  writeFileSync(join(dir, "hi.moth"), 'use "lib.moth" as lib\nsay lib\'s twice("ab")\nsay uppercase of "straße"\n');
  const built = spawnSync(exe, ["build", "hi.moth"], { cwd: dir, encoding: "utf8" });
  assert.equal(built.status, 0, built.stdout + built.stderr);
  assert.match(built.stdout, /^compiled hi\.moth to machine code for (Windows|Linux) -> hi(\.exe)? \(.* bytes\)\n$/);
  assert.equal(spawnSync(executable(dir, "hi"), [], { encoding: "utf8" }).stdout, "abab\nSTRASSE\n");
  const again = spawnSync(exe, ["build", "moth.moth", "--allow-read", "--allow-write", "--allow-run", "--include", "moth-debugger.moth"], { cwd: dir, encoding: "utf8", timeout: 120_000 });
  assert.equal(again.status, 0, again.stdout + again.stderr);
  assert.ok(Buffer.from(made).equals(readFileSync(executable(dir, "moth"))), "moth.exe built itself into different bytes");
});

// --icon, --version and --include: a program shipped as one file, its files built in and found where they
// aren't on the disk, and on Windows its icon and version where Windows' resources keep them
function resourceTypes(exe) {
  const b = readFileSync(exe);
  const pe = b.readUInt32LE(60);
  const sections = b.readUInt16LE(pe + 6);
  const headers = pe + 24 + b.readUInt16LE(pe + 20);
  for (let k = 0; k < sections; k++) {
    const at = headers + 40 * k;
    if (b.toString("latin1", at, at + 5) !== ".rsrc") continue;
    const raw = b.readUInt32LE(at + 20);
    const count = b.readUInt16LE(raw + 12) + b.readUInt16LE(raw + 14);
    return Array.from({ length: count }, (_, i) => b.readUInt32LE(raw + 16 + 8 * i));
  }
  return [];
}
test("moth build ships a program with an icon, its version, and files built into it", { skip }, () => {
  const { dir, exe } = mothExe();
  mkdirSync(join(dir, "data", "more"), { recursive: true });
  writeFileSync(join(dir, "data", "hello.txt"), "Hello from inside the program");
  writeFileSync(join(dir, "data", "more", "deep.txt"), "deeper");
  writeFileSync(join(dir, "logo.png"), readFileSync(new URL("./docs/mandelbrot.png", import.meta.url)));
  writeFileSync(join(dir, "app.moth"), 'say read "data/hello.txt"\nsay read "data/more/deep.txt"\nsay length of read bytes "logo.png"\n'
    + 'try\n    say read "not built in.txt"\nif it fails with why\n    say why\nend\n');
  const built = spawnSync(exe, ["build", "app.moth", "--include", "data", "--include", "./logo.png", "--icon", "logo.png", "--version", "2.5.1"],
    { cwd: dir, encoding: "utf8" });
  assert.equal(built.status, 0, built.stdout + built.stderr);
  const away = join(dir, "away");
  mkdirSync(away);
  const moved = executable(away, "app");
  writeFileSync(moved, readFileSync(executable(dir, "app")));
  if (target === "linux") chmodSync(moved, 0o755);
  const ran = spawnSync(moved, [], { cwd: away, encoding: "utf8" });
  assert.deepEqual([ran.stdout, ran.stderr, ran.status], [`Hello from inside the program\ndeeper\n${readFileSync(join(dir, "logo.png")).length}\n`
    + "can't read 'not built in.txt': this program isn't allowed to read files (start it with --allow-read)\n", "", 0]);
  if (target === "windows") {
    assert.deepEqual(resourceTypes(moved), [3, 14, 16]); // RT_ICON, RT_GROUP_ICON, RT_VERSION
    assert.ok(readFileSync(moved).includes(Buffer.from("2.5.1\0", "utf16le")));
  }
  for (const [flag, value, said] of [["--icon", "app.moth", "the icon isn't an .ico or a .png file"],
    ["--version", "1.x", "a version is up to four numbers with dots between, as 1.2.3, not '1.x'"],
    ["--include", "nowhere.txt", "there is no file called 'nowhere.txt'"]]) {
    const wrong = spawnSync(exe, ["build", "app.moth", flag, value], { cwd: dir, encoding: "utf8" });
    assert.equal(wrong.status, 1, wrong.stdout + wrong.stderr);
    assert.ok(wrong.stderr.includes(said), wrong.stderr);
  }
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
  // values in text, with text in them, which a piece of text ends after
  const values = 'set   words to list of "a","b"\nsay  "{join words with ", "}!"\nto f with x\nreturn x+"!"\nend\nsay "{f("{x} {f("{(1+2)}")}")}"+"x"\n';
  const sources = [messy, wide, values, ...brokenPrograms(7, 150)];
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
});

// `moth test` with no file named finds them as the Node.js command line did (cli.js at 1.5.1, findTests below):
// every file ending in .test.moth here and in the folders inside, but not hidden ones or node_modules, sorted
// by localeCompare and joined with the system's separator. A failing test's mistake names its file's path.
test("moth.exe test with no file named finds every .test.moth file, as the Node.js command line did", { skip }, () => {
  const { dir, exe } = mothExe();
  const tree = join(dir, "finding");
  const pass = "to test_one\n    expect 1 is 1\nend\n";
  const files = { "b.test.moth": pass, "A.test.moth": pass, "1.test.moth": pass, "_u.test.moth": "expect yes\n", "x.moth": "say 1\n",
    "sub/c.test.moth": pass, "sub/a_b.test.moth": "to test_wrong\n    expect 1 is 2\nend\n", "sub/deeper/d-1.test.moth": pass,
    "sub/deeper/d.test.moth": pass, "Zeta/z.test.moth": pass, ".hidden/x.test.moth": pass, "node_modules/y.test.moth": pass };
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(tree, ...name.split("/").slice(0, -1)), { recursive: true });
    writeFileSync(join(tree, ...name.split("/")), text);
  }
  const findTests = (folder) => {
    const found = [];
    for (const entry of readdirSync(join(tree, folder), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const path = join(folder, entry.name);
      if (entry.isDirectory()) found.push(...findTests(path));
      else if (entry.name.endsWith(".test.moth")) found.push(path);
    }
    return found;
  };
  const wanted = findTests(".");
  assert.equal(wanted.length, 9);
  const ran = spawnSync(exe, ["test"], { cwd: tree, encoding: "utf8", timeout: 300_000 });
  assert.deepEqual(ran.stdout.split("\n").filter((line) => line.endsWith(".test.moth") && !/^[✓✗ ]/.test(line)), wanted); // each file's name, then its tests
  const wrong = join("sub", "a_b.test.moth");
  assert.ok(ran.stdout.includes(`${wrong}\n✗ test_wrong\n    ${wrong}:2:5: expected 1 to be 2\n`), ran.stdout);
  assert.deepEqual([ran.status, ran.stderr, ran.stdout.split("\n").at(-2)], [1, "", "8 passed, 1 failed"]);
  const empty = join(dir, "no-tests");
  mkdirSync(join(empty, "sub"), { recursive: true });
  writeFileSync(join(empty, "sub", "plain.moth"), "say 1\n");
  const none = spawnSync(exe, ["test"], { cwd: empty, encoding: "utf8" });
  assert.deepEqual([none.status, none.stdout, none.stderr], [1, "", "moth: no tests found: name a file, or put tests in files ending in .test.moth\n"]);
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
// Libraries (DESIGN §45): a program built with --allow-libraries calls the C library every system has, as C
// would: whole numbers, numbers, text and wide text both ways, bytes C writes into, pointers, nothing, yes
// or no, more inputs than there are registers for, and a function of the library's as a value
function libraryRun(source, allow = ["--allow-libraries"], env = {}) {
  const dir = mkdtempSync(join(tmpdir(), "moth-library-"));
  try {
    const files = {};
    for (const name of ["sqlite.moth", "windows.moth", "linux.moth", "ui.moth", "tasks.moth", "system.moth", "game.moth", "sockets.moth", "cores.moth"]) files[name] = readFileSync(new URL(`./tools/${name}`, import.meta.url), "utf8");
    if (source.includes("mandelbrot.png")) writeFileSync(join(dir, "mandelbrot.png"), readFileSync(new URL("./docs/mandelbrot.png", import.meta.url)));
    if (source.includes("beep.wav")) writeFileSync(join(dir, "beep.wav"), silentWav());
    const exe = executable(dir, "p");
    const bytes = machine(source, { target, name: "p.moth", allow, files });
    writeFileSync(exe, bytes);
    if (target === "linux") chmodSync(exe, 0o755);
    const ran = spawnSync(exe, [], { cwd: dir, encoding: "utf8", input: "", env: { ...process.env, ...env } });
    return { ...ran, bytes };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const C_LIBRARY = `use the library "msvcrt" or "c"
    strlen(text) gives a long whole number
    abs(a whole number) gives a whole number
    atof(text) gives a number
    getenv(text) gives text
    wcslen(wide text) gives a long whole number
    strchr(text, a whole number) gives text
    memset(bytes, a whole number, a long whole number) gives a pointer
    isdigit(a whole number) gives yes or no
    sprintf(bytes, text, a whole number, a number, text, a whole number, a whole number, a number, a number, a number,
        a number, a number, a number, a number, a whole number) gives a whole number
end
use the library "msvcrt" or "m"
    sqrt(a number) gives a number
    pow(a number, a number) gives a number
end
to c_text with b
    set k to 1
    repeat while item k of b is not 0
        add 1 to k
    end
    set kept to empty list
    for each i from 1 to k - 1
        add item i of b to kept
    end
    return (kept as bytes) as text
end
`;

test("a program calls a C library's functions as C does, on Windows and on Linux", { skip }, () => {
  const ran = libraryRun(`${C_LIBRARY}say strlen("héllo") " " abs(0 - 5) " " atof("2.5") " " sqrt(2) " " pow(2, 10)
say getenv("MOTH_LIBRARY_TEST") " " getenv("MOTH_NO_SUCH_VARIABLE")
say wcslen("héllo") " " strchr("hello", 108) " " strchr("hello", 122)
set b to 4 bytes
say (memset(b, 7, 3) is greater than 0) " " b
say isdigit(55) " " isdigit(97)
set out to 200 bytes
sprintf(out, "%d %.1f %s %d %d %.0f %.0f %.0f %.0f %.0f %.0f %.0f %d", 1, 2.5, "x", 3, 4, 5, 6, 7, 8, 9, 10, 11, 12)
say c_text(out)
set f to abs
say f(0 - 8)`, ["--allow-libraries"], { MOTH_LIBRARY_TEST: "on" });
  assert.deepEqual([ran.stdout, ran.stderr, ran.status], [
    "6 5 2.5 1.4142135623731 1024\non nothing\n5 llo nothing\nyes (4 bytes: 7, 7, 7, 0)\nyes no\n1 2.5 x 3 4 5 6 7 8 9 10 11 12\n8\n", "", 0]);
  // a mistake in what it's given, a library that isn't there, a function that isn't in it, and no --allow-libraries
  const wrong = (call, allow) => libraryRun(`${C_LIBRARY}use the library "no_such_library_here"
    nowhere() gives a whole number
end
use the library "msvcrt" or "c" as c
    no_such_function_here() gives a whole number
end
say ${call}`, allow).stderr.split("\n")[0];
  const lib = target === "windows" ? "msvcrt" : "c";
  assert.equal(wrong("abs(2.5)"), "p.moth:3:5: 'abs' needs input 1 to be a whole number from -2147483648 to 4294967295, not 2.5");
  assert.equal(wrong("memset(\"x\", 0, 1)"), "p.moth:34:5: 'memset' needs input 1 to be bytes, not text");
  assert.equal(wrong("nowhere()"), "p.moth:29:5: there is no library called 'no_such_library_here'");
  assert.equal(wrong("c's no_such_function_here()"), `p.moth:32:5: the library '${lib}' has no function called 'no_such_function_here'`);
  assert.equal(wrong("abs(1)", []), "p.moth:3:5: can't use the library 'msvcrt' or 'c': this program isn't allowed to use libraries (start it with --allow-libraries)");
});

test("a library's structures are records, its callbacks the program's functions, and a float is a float", { skip }, () => {
  const ran = libraryRun(`use the library "msvcrt" or "c"
    structure cell with v as a whole number
    callback compare(a cell, a cell) gives a whole number
    qsort(bytes, a long whole number, a long whole number, a compare)
    structure tm with second as a whole number, minute as a whole number, hour as a whole number,
        day as a whole number, month as a whole number, year as a whole number, weekday as a whole number,
        yearday as a whole number, dst as a whole number
    mktime(a tm) gives a long whole number
    "_mktime64" as mktime64(a tm) gives a long whole number
    structure named with label as text, code as 4 bytes, at as a cell, size as a number
    memcpy(a named, a named, a long whole number) gives a pointer
end
use the library "ucrtbase" or "m"
    sinf(a float) gives a float
    sqrtf(a float) gives a float
end
to by_size with x, y
    return v of x - v of y
end
set b to (list of 5, 0, 0, 0, 1, 0, 0, 0, 3, 0, 0, 0, 2, 0, 0, 0) as bytes
qsort(b, 4, 4, by_size)
say b
set noon to record with second 0, minute 0, hour 12, day 32, month 0, year 126, dst -1
set t to 0
try
    set t to mktime64(noon)
if it fails
    set t to mktime(noon)
end
say (t is greater than 0) " " day of noon " " month of noon " " year of noon " " weekday of noon " " yearday of noon
say sqrtf(2) " " sinf(0) " " sqrtf(16)
set from to record with label "héllo", code (list of 1, 2, 3, 4, 5) as bytes, at (record with v 7), size 2.5
set copied to record with label nothing
memcpy(copied, from, 24)
say label of copied " " code of copied " " v of at of copied " " size of copied
try
    qsort(b, 4, 4, sqrtf)
if it fails with why
    say why
end
try
    memcpy((record with size "big"), from, 24)
if it fails with why
    say why
end`);
  assert.deepEqual([ran.stdout, ran.stderr, ran.status], [
    "(16 bytes: 1, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0, 5, 0, 0, 0)\nyes 1 1 126 0 31\n1.41421353816986 0 4\n"
    + "héllo (4 bytes: 1, 2, 3, 4) 7 2.5\n'qsort' needs input 4 to be a function that takes 2 inputs, not one that takes 1\n"
    + "'memcpy' needs input 1's size to be a number, not text\n", "", 0]);
});

test("on Windows a window's procedure is a function of the program's, which Windows calls back", { skip: target === "windows" ? skip : "Windows only" }, () => {
  const ran = libraryRun(`use the library "user32"
    callback window_proc(a pointer, a whole number, a pointer, a pointer) gives a pointer
    structure window_class with size as a whole number, style as a whole number, procedure as a window_proc,
        class_extra as a whole number, window_extra as a whole number, instance as a pointer, icon as a pointer,
        cursor as a pointer, background as a pointer, menu_name as a pointer, class_name as wide text,
        small_icon as a pointer
    RegisterClassExW(a window_class) gives a whole number
    CreateWindowExW(a whole number, wide text, wide text, a whole number, a whole number, a whole number,
        a whole number, a whole number, a pointer, a pointer, a pointer, a pointer) gives a pointer
    DefWindowProcW(a pointer, a whole number, a pointer, a pointer) gives a pointer
    DestroyWindow(a pointer) gives yes or no
    callback enumer(a pointer, a pointer) gives yes or no
    EnumWindows(a enumer, a pointer) gives yes or no
end
use the library "kernel32"
    GetModuleHandleW(a pointer) gives a pointer
end
set messages to empty list
set seen to 0
to on_message with window, message, w, l
    add message to messages
    return DefWindowProcW(window, message, w, l)
end
to count_window with window, extra
    add 1 to seen
    return yes
end
set instance to GetModuleHandleW(nothing)
say RegisterClassExW(record with size 80, procedure on_message, instance instance, class_name "MothTest") is not 0
set window to CreateWindowExW(0, "MothTest", "Moth", 0, 0, 0, 200, 100, nothing, nothing, instance, nothing)
say DestroyWindow(window) " " (1 is in messages) " " (2 is in messages)
say EnumWindows(count_window, nothing) " " (seen is greater than 0)`);
  assert.deepEqual([ran.stdout, ran.stderr, ran.status], ["yes\nyes yes yes\nyes yes\n", "", 0]);
});

test("only a program that uses a library is linked by Linux's dynamic linker, or imports what loads one on Windows", { skip }, () => {
  for (const t of ["windows", "linux"]) {
    const plain = Buffer.from(machine('say "hello"', { target: t, name: "p.moth" }));
    const using = Buffer.from(machine('use the library "c"\n    abs(a whole number) gives a whole number\nend\nsay "hello"', { target: t, name: "p.moth" }));
    const marks = t === "linux" ? "/lib64/ld-linux-x86-64.so.2" : "LoadLibraryExW";
    assert.deepEqual([plain.includes(marks), using.includes(marks)], [false, true], t);
  }
});

// tools/sqlite.moth, a library of Moth's on SQLite: Windows' own winsqlite3.dll, or Linux's libsqlite3.so.0
const sqliteHere = target === "windows" ? existsSync(join(process.env.SystemRoot ?? "C:\\Windows", "System32", "winsqlite3.dll"))
  : ["/usr/lib/x86_64-linux-gnu/libsqlite3.so.0", "/usr/lib64/libsqlite3.so.0", "/usr/lib/libsqlite3.so.0"].some((f) => existsSync(f));
test("tools/sqlite.moth keeps a database in a file, through SQLite", { skip: skip || (!sqliteHere && "SQLite isn't installed") }, () => {
  const ran = libraryRun(`use "sqlite.moth" as sqlite
set people to sqlite's open("people.db")
sqlite's run(people, "create table people (name text, age integer, height real, note text)")
say sqlite's run_with(people, "insert into people values (?, ?, ?, ?)", list of "Sam", 20, 1.8, nothing)
say sqlite's run_with(people, "insert into people values (?, ?, ?, ?)", list of "Ana Lee 😀", 31, 1.65, "hé")
for each row in sqlite's query(people, "select name, age, height, note from people order by age")
    say item "name" of row " is " item "age" of row ", " item "height" of row " m, " item "note" of row
end
say sqlite's query_with(people, "select count(*) as n from people where age > ?", list of 25)
try
    sqlite's run(people, "select * from nowhere")
if it fails with why
    say why
end
sqlite's close(people)
set again to sqlite's open("people.db")
say length of sqlite's query(again, "select * from people")`);
  assert.deepEqual([ran.stdout, ran.stderr, ran.status], ['1\n1\nSam is 20, 1.8 m, nothing\nAna Lee 😀 is 31, 1.65 m, hé\n[(dictionary where "n" is 1)]\nSQLite: no such table: nowhere\n2\n', "", 0]);
});

// text.moth and dates.moth, in Moth alone: their own tests, run by moth.exe's test runner, in machine code
test("text.moth, dates.moth, hash.moth, big.moth, xml.moth, zip.moth and math.moth pass their own tests in machine code", { skip }, () => {
  const { dir, exe } = mothExe();
  const sub = join(dir, "text-and-dates");
  mkdirSync(sub);
  for (const name of ["text.moth", "text.test.moth", "dates.moth", "dates.test.moth", "hash.moth", "hash.test.moth", "big.moth", "big.test.moth",
    "xml.moth", "xml.test.moth", "zip.moth", "zip.test.moth"]) {
    writeFileSync(join(sub, name), readFileSync(new URL(`./tools/${name}`, import.meta.url), "utf8"));
  }
  for (const name of ["math.moth", "math.test.moth"]) writeFileSync(join(sub, name), readFileSync(new URL(`./${name}`, import.meta.url), "utf8"));
  const ran = spawnSync(exe, ["test", "text.test.moth", "dates.test.moth", "hash.test.moth", "big.test.moth", "xml.test.moth", "zip.test.moth", "math.test.moth"], { cwd: sub, encoding: "utf8", timeout: 300_000 });
  assert.deepEqual([ran.status, ran.stderr, ran.stdout.includes("✗")], [0, "", false], ran.stdout);
  assert.equal(ran.stdout.split("\n").at(-2), "39 passed");
});

// tools/system.moth: files, folders and the environment, the same on Windows and Linux
test("tools/system.moth copies, moves and removes files and folders, and reads the environment", { skip }, () => {
  const ran = libraryRun(String.raw`use "system.moth" as system
write "hello" to "a.txt"
say system's is_file("a.txt") " " system's is_folder("a.txt") " " system's exists("nope")
say system's file_size("a.txt")
say system's modified("a.txt") is greater than 1700000000
system's make_folder("x/y/z")
system's make_folder("x/y")
say system's is_folder("x/y/z") " " system's is_file("x/y/z")
system's copy_file("a.txt", "x/y/z/b.txt")
say read "x/y/z/b.txt"
system's move_file("x/y/z/b.txt", "x/c.txt")
say system's exists("x/y/z/b.txt") " " read "x/c.txt"
system's remove_file("x/c.txt")
system's remove_folder("x/y/z")
try
    system's remove_folder("x")
if it fails with why
    say why
end
system's remove_folder("x/y")
system's remove_folder("x")
say system's exists("x")
system's set_environment("MOTH_TRY", "é value")
say system's environment("MOTH_TRY")
system's set_environment("MOTH_TRY", nothing)
say system's environment("MOTH_TRY")
set here to system's current_folder()
system's make_folder("inner")
system's change_folder("inner")
set inside to system's current_folder()
say length of inside is length of here + 6
system's change_folder("..")
say system's current_folder() is here
system's remove_folder("inner")
say system's home_folder() is not nothing and system's temporary_folder() is not ""
for each wrong in list of "size", "move", "folder"
    try
        if wrong is "size"
            say system's file_size("nope")
        else if wrong is "move"
            system's move_file("nope", "nowhere")
        else
            system's change_folder("nope")
        end
    if it fails with why
        say why
    end
end
remove the file "a.txt"`, ["--allow-libraries", "--allow-read", "--allow-write"]);
  assert.deepEqual([ran.stdout, ran.stderr, ran.status], ["yes no no\n5\nyes\nyes no\nhello\nno hello\n"
    + "can't remove the folder 'x': it isn't there, or it isn't empty\nno\né value\nnothing\nyes\nyes\nyes\n"
    + "there is no file called 'nope'\ncan't move 'nope' to 'nowhere'\ncan't go into the folder 'nope'\n", "", 0]);
});

// tools/sockets.moth: a connection from a task of the program's own to it, by name, lines with and without \r,
// a reply after the task says it has no more to send, a message, waiting too long, each mistake, and 300 KB
test("tools/sockets.moth connects, listens, and sends lines, bytes and messages, on Windows and Linux", { skip }, () => {
  const ran = libraryRun(String.raw`use "sockets.moth" as net
set listener to net's listen(0)
set port to net's port_of(listener)
say port is greater than 0
to client with port
    set c to net's connect("localhost", port)
    net's send(c, "hello moth" + (list of 13) as bytes as text + "\nsecond line\nlast, without an end")
    net's finish_sending(c)
    set reply to net's receive_all(c)
    net's close(c)
    return reply as text
end
set job to start client(port)
set c to net's accept(listener)
say host of peer of c
say net's receive_line(c)
say net's receive_line(c)
say net's receive_line(c)
say net's receive_line(c)
net's send(c, "HELLO BACK é")
net's close(c)
say wait for job
net's close(listener)
set a to net's open_messages(0)
set b to net's open_messages(0)
net's send_message(a, "127.0.0.1", net's port_of(b), "ping é")
set m to net's receive_message(b, 100)
say data of m as text
say host of m
say port of m is net's port_of(a)
net's wait_at_most(b, 200)
try
    net's receive_message(b, 100)
if it fails with why
    say why
end
try
    net's connect("127.0.0.1", 1)
if it fails with why
    say why
end
try
    net's connect("no-such-host.invalid", 80)
if it fails with why
    say why
end
try
    net's listen(70000)
if it fails with why
    say why
end
set wide to net's listen_everywhere(0)
to sender with port
    set out to net's connect("127.0.0.1", port) # not c: the program made one above
    set block to 300000 bytes
    for each k from 1 to 300000
        set byte k of block to remainder of k * 31 divided by 251
    end
    net's send(out, block)
    net's close(out)
    return block
end
set job to start sender(net's port_of(wide))
set c to net's accept(wide)
net's wait_at_most(c, 5000)
set got to net's receive_all(c)
say length of got
say got is wait for job
net's close(c)
net's close(wide)`);
  assert.deepEqual([ran.stdout, ran.stderr, ran.status], ["yes\n127.0.0.1\nhello moth\nsecond line\nlast, without an end\nnothing\nHELLO BACK é\nping é\n127.0.0.1\nyes\ncan't receive a message: nothing came in time, or it was bigger than 100 bytes\ncan't connect to 127.0.0.1 port 1: nothing answered there\ncan't find no-such-host.invalid on the network\na port is a whole number from 0 to 65535, not 70000\n300000\nyes\n", "", 0]);
});

// tools/cores.moth: a list's items done by copies of the program, as one part and as one part a core, the same;
// more parts than items; none; a part that fails, which says what its copy said; and no files left behind
test("tools/cores.moth does a list's items on every core at once, in copies of the program", { skip }, () => {
  const ran = libraryRun(String.raw`use "cores.moth" as cores
to primes_below with n
    set found to 0
    for each k from 2 to n - 1
        set prime to yes
        set d to 2
        repeat while d * d is at most k and prime
            if k is divisible by d
                set prime to no
            end
            set d to d + 1
        end
        if prime
            set found to found + 1
        end
    end
    return found
end
to falls_over with n
    if n is 3
        return 1 / 0
    end
    return n
end
cores's work_here(primes_below)
cores's work_here(falls_over)
set sizes to list of 300000, 310000, 320000, 330000, 340000, 350000, 360000, 370000
set t to the clock
set alone to cores's each_at_once_on(1, primes_below, sizes)
set one_way to the clock - t
set t to the clock
set together to cores's each_at_once(primes_below, sizes)
set every_way to the clock - t
say alone
say together is alone
say cores's count_of_cores() is at least 1
say cores's each_at_once_on(3, primes_below, list of 10, 20)
say cores's each_at_once(primes_below, empty list)
try
    cores's each_at_once_on(2, falls_over, list of 1, 2, 3, 4)
if it fails with why
    say why
end
say every_way is less than one_way * 4 # not a test of speed: the parts ran, and gave back`, ["--allow-libraries", "--allow-read", "--allow-write"]);
  const lines = ran.stdout.split("\n");
  assert.equal(lines.slice(0, 5).join("\n") + "\n", "[25997, 26800, 27608, 28404, 29182, 29977, 30757, 31522]\nyes\nyes\n[4, 8]\n[]\n", ran.stdout + ran.stderr);
  assert.match(lines.slice(5).join("\n"), /^part 2 of 2 failed: p\.moth:21:18: can't divide by zero\n[^]*in 'falls_over'[^]*\nyes\n$/);
  assert.deepEqual([ran.stderr, ran.status], ["", 0]);
});

// tools/tasks.moth: the program started again in the background, with inputs Windows' command line must quote
// and Linux's must not, asked while it runs, waited for, stopped, and a program that isn't there
test("tools/tasks.moth runs programs in the background, and says what they said and ended with", { skip }, () => {
  const ran = libraryRun(String.raw`use "tasks.moth" as tasks
if length of arguments is at least 1
    set what to item 1 of arguments
    if what is "count"
        set total to 0
        for each i from 1 to 1000000
            add i to total
        end
        say "total " + total
        stop the program with 3
    else if what is "echo"
        set at to 0
        for each word in arguments
            add 1 to at
            if at is greater than 1
                say "[" + word + "]"
            end
        end
        stop the program with 0
    else if what is "forever"
        repeat while yes
            tasks's pause(50)
        end
    end
end
set job to tasks's start_self(list of "count")
set checks to 0
repeat while not tasks's done(job)
    add 1 to checks
    tasks's pause(5)
end
say tasks's output_of(job) + "ended with " + tasks's code_of(job) + ", checked " + (checks is greater than 0)
set echoed to tasks's start_self(list of "echo", "a b", "say \"hi\"", "back\\slash\\", "", "é😀", "\\\"")
tasks's wait_for(echoed)
say tasks's output_of(echoed) + "ended with " + tasks's code_of(echoed)
set endless to tasks's start_self(list of "forever")
say "done yet: " + tasks's done(endless)
tasks's stop_task(endless)
say "stopped: " + tasks's done(endless) + ", " + tasks's code_of(endless)
try
    set missing to tasks's start("no-such-program-here", empty list)
    tasks's wait_for(missing)
    say "missing ended with " + tasks's code_of(missing)
if it fails with why
    say why
end`);
  const stopped = target === "windows" ? 1 : 137; // TerminateProcess's 1, or SIGKILL's 128 + 9
  const missing = target === "windows" ? "couldn't start 'no-such-program-here': there's no such program, or it can't be run"
    : "missing ended with 127"; // as a shell says for a program it can't find
  assert.deepEqual([ran.stdout, ran.stderr, ran.status], ["total 500000500000\nended with 3, checked yes\n"
    + '[a b]\n[say "hi"]\n[back\\slash\\]\n[]\n[é😀]\n[\\"]\nended with 0\n'
    + `done yet: no\nstopped: yes, ${stopped}\n${missing}\n`, "", 0]);
});

// tools/server.moth: a web server of the program's, on Windows' and Linux's own sockets, asked by another program
// of Moth's, which reads and sends to it as it would to any site
test("tools/server.moth answers a program's requests with what its handler gives", { skip }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "moth-server-"));
  const port = 21000 + (process.pid % 2000);
  const files = { "server.moth": readFileSync(new URL("./tools/server.moth", import.meta.url), "utf8") };
  const build = (name, source, allow) => {
    const exe = executable(dir, name);
    writeFileSync(exe, machine(source, { target, name: `${name}.moth`, allow, files }));
    if (target === "linux") chmodSync(exe, 0o755);
    return exe;
  };
  writeFileSync(join(dir, "page.txt"), "a file's words");
  const server = build("site", `use "server.moth" as web
set visits to 0
to answer with request
    add 1 to visits
    set p to path of request
    if p is "/"
        return "<h1>Hello from Moth</h1>"
    else if p is "/hello"
        return "Hello, " + item "name" of query of request + "! " + length of keys of query of request
    else if p is "/json"
        return dictionary where "visits" is visits, "method" is method of request, "agent" is ("user-agent" is in headers of request)
    else if p is "/echo"
        return record with status 201, body uppercase of body of request
    else if p is "/file"
        return record with file "page.txt"
    else if p is "/missing"
        return record with file "nowhere.txt"
    else if p is "/broken"
        return item 5 of list of 1
    else if p is "/stop"
        web's stop_serving()
        return "bye"
    end
    return record with status 404, body "There's nothing at " + p
end
web's serve(${port}, answer)
say "served " + visits`, ["--allow-libraries", "--allow-read"]);
  const client = build("asker", `set site to "http://127.0.0.1:${port}"
say read site + "/"
say read site + "/hello?name=Sam%20Lee&x=1"
say json from read site + "/json"
say send "shout this ✓" to site + "/echo"
say read site + "/file"
for each p in list of "/missing", "/broken", "/nowhere"
    try
        say read site + p
    if it fails with why
        say why
    end
end
say read site + "/stop"`, ["--allow-net"]);
  try {
    const running = spawn(server, [], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    running.stdout.on("data", (d) => (out += d));
    running.stderr.on("data", (d) => (err += d));
    const ended = new Promise((resolve) => running.on("exit", resolve));
    for (let waited = 0; !err.includes("listening") && waited < 10000; waited += 20) await new Promise((r) => setTimeout(r, 20));
    const asked = spawnSync(client, [], { cwd: dir, encoding: "utf8", input: "" });
    const code = await ended;
    assert.deepEqual([asked.stdout, asked.stderr, asked.status], [
      "<h1>Hello from Moth</h1>\nHello, Sam Lee! 2\n" + '(dictionary where "visits" is 3, "method" is "GET", "agent" is yes)\n'
      + "SHOUT THIS ✓\na file's words\n"
      + `can't read 'http://127.0.0.1:${port}/missing': the site answered 404\n`
      + `can't read 'http://127.0.0.1:${port}/broken': the site answered 500\n`
      + `can't read 'http://127.0.0.1:${port}/nowhere': the site answered 404\nbye\n`, "", 0]);
    assert.deepEqual([out, err, code], ["served 9\n", `listening on http://127.0.0.1:${port}/\n`
      + "a mistake answering GET /broken: there is no item 5, the list only has 1 item\n", 0]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// tools/server.moth with HTTPS: a certificate made for the test by the openssl command, OpenSSL 3's libraries
// (Linux's own; on Windows, Python's, put beside the program), and Node's https, which trusts that certificate
// alone, asking: a page, a body in chunks and one with its length, a page that isn't there, and a client that
// doesn't trust it, which the server says couldn't agree on TLS; then a certificate or key it can't use
const OPENSSL = ["openssl", "C:/Program Files/Git/usr/bin/openssl.exe", "C:/Program Files/Git/mingw64/bin/openssl.exe"]
  .find((c) => spawnSync(c, ["version"], { encoding: "utf8" }).status === 0);
const SSL_DLLS = target !== "windows" ? null : (() => {
  const found = spawnSync("python", ["-c", "import sys, os; print(os.path.join(sys.base_prefix, 'DLLs'))"], { encoding: "utf8" });
  const dir = found.status === 0 ? found.stdout.trim() : "";
  return ["libssl-3.dll", "libcrypto-3.dll"].every((n) => existsSync(join(dir, n))) ? dir : null;
})();
const httpsSkip = skip || (!OPENSSL ? "there's no openssl command" : target === "windows" && !SSL_DLLS ? "there's no OpenSSL 3 of Python's" : false);
test("tools/server.moth answers with HTTPS through OpenSSL, and reads bodies in chunks", { skip: httpsSkip }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "moth-https-"));
  const port = 23000 + (process.pid % 2000);
  try {
    const made = spawnSync(OPENSSL, ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(dir, "key.pem"), "-out", join(dir, "cert.pem"),
      "-days", "2", "-subj", "/CN=localhost", "-addext", "subjectAltName=IP:127.0.0.1,DNS:localhost"], { encoding: "utf8" });
    assert.equal(made.status, 0, made.stderr);
    if (SSL_DLLS) for (const n of ["libssl-3.dll", "libcrypto-3.dll"]) writeFileSync(join(dir, n), readFileSync(join(SSL_DLLS, n)));
    const exe = executable(dir, "site");
    writeFileSync(exe, machine(`use "server.moth" as web
to answer with request
    set p to path of request
    if p is "/"
        return "<h1>Hello over TLS</h1>"
    else if p is "/echo"
        return record with status 201, body uppercase of body of request
    else if p is "/stop"
        web's stop_serving()
        return "bye"
    end
    return record with status 404, body "nothing at " + p
end
for each pair in list of (list of "nowhere.pem", "key.pem"), (list of "cert.pem", "cert.pem")
    try
        web's serve_secure(${port}, answer, item 1 of pair, item 2 of pair)
    if it fails with why
        say why
    end
end
web's serve_secure(${port}, answer, "cert.pem", "key.pem")
say "stopped"`, { target, name: "site.moth", allow: ["--allow-libraries", "--allow-read"], files: { "server.moth": readFileSync(new URL("./tools/server.moth", import.meta.url), "utf8") } }));
    if (target === "linux") chmodSync(exe, 0o755);
    const running = spawn(exe, [], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    running.stdout.on("data", (d) => (out += d));
    running.stderr.on("data", (d) => (err += d));
    const ended = new Promise((resolve) => running.on("exit", resolve));
    for (let waited = 0; !err.includes("listening") && waited < 10000; waited += 20) await new Promise((r) => setTimeout(r, 20));
    const ca = readFileSync(join(dir, "cert.pem"));
    const ask = (path, body, length) => new Promise((done, failed) => {
      const headers = length ? { "Content-Length": Buffer.byteLength(body) } : {};
      const req = https.request({ host: "127.0.0.1", port, path, method: body ? "POST" : "GET", ca, headers }, (res) => {
        let text = "";
        res.on("data", (d) => (text += d));
        res.on("end", () => done(`${res.statusCode} ${text}`));
      });
      req.on("error", failed);
      if (body) for (const piece of body.match(/.{1,5}/gu)) req.write(piece); // in chunks of their own, unless it has a length
      req.end();
    });
    const untrusted = () => new Promise((done) => https.get({ host: "127.0.0.1", port, path: "/" }, () => done("trusted")).on("error", (e) => done(e.code)));
    const answers = [await ask("/"), await ask("/echo", "shout this, in pieces ✓"), await ask("/echo", "with a length", true), await ask("/missing"),
      await untrusted(), await ask("/stop")];
    const code = await ended;
    assert.deepEqual(answers, ["200 <h1>Hello over TLS</h1>", "201 SHOUT THIS, IN PIECES ✓", "201 WITH A LENGTH", "404 nothing at /missing",
      "DEPTH_ZERO_SELF_SIGNED_CERT", "200 bye"]);
    assert.deepEqual([out, err, code], ["can't use the certificate in nowhere.pem: it isn't there, or isn't one in PEM\n"
      + "can't use the key in cert.pem: it isn't there, isn't one in PEM, or isn't the certificate's\nstopped\n",
      `listening on https://127.0.0.1:${port}/\na connection that couldn't agree on TLS with the server\n`, 0]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// tools/windows.moth, Windows' own controls for a program of Moth's: a window, hidden here, that drives itself
// from a timer, sending its controls what a click or typing sends them, and pressing its menu's keys with Ctrl
// held as this thread sees it
test("tools/windows.moth makes Windows' own controls, menus and keys call a program's functions", { skip: target === "windows" ? skip : "Windows only" }, () => {
  const ran = libraryRun(`use "windows.moth" as ui
use the library "user32"
    SetKeyboardState(bytes) gives yes or no
end
set log to empty list
set step to 0
to greet
    add "greet " + ui's text_of(name) to log
end
to ticked_it with on
    add "ticked " + on to log
end
to chose_it with fruit
    add "chose " + fruit to log
end
to changed with t
    add "changed " + t to log
end
to opened
    add "open" to log
end
to saved
    add "saved" to log
end
to reloaded
    add "reloaded" to log
end
to resized with width, height
    add "resized " + width + " " + height to log
end
to closing
    add "closing" to log
    return yes
end
to hold with ctrl, shifted
    set state to 256 bytes
    if ctrl
        set byte 18 of state to 128
    end
    if shifted
        set byte 17 of state to 128
    end
    SetKeyboardState(state)
end
to drive
    add 1 to step
    if step is 1
        ui's set_text(name, "set, not typed")
        ui's sendmessagew(handle of name, 177, 0, -1)
        ui's send_text(handle of name, 194, 1, "Sam")
        ui's sendmessagew(handle of go, 245, 0, 0)
        ui's sendmessagew(handle of tick, 245, 0, 0)
        add "is ticked " + ui's ticked(tick) to log
    else if step is 2
        ui's choose(fruits, 2)
        add ui's chosen(fruits) + " at " + ui's chosen_place(fruits) + " of " + ui's count_of(fruits) to log
        ui's choose(sizes, 3)
        add "size " + ui's chosen(sizes) to log
        ui's remove_item(fruits, 1)
        add "now " + ui's count_of(fruits) + ", " + ui's chosen_place(fruits) to log
        ui's postmessagew(handle of w, 273, 106, 0)
    else if step is 3
        ui's set_text(notes, "one\\ntwo")
        add (split ui's text_of(notes) by "\\n") to log
        ui's movewindow(handle of w, 0, 0, 500, 400, no)
    else if step is 4
        hold(yes, no)
        ui's postmessagew(handle of name, 256, 83, 0)
    else if step is 5
        hold(yes, yes)
        ui's postmessagew(handle of name, 256, 116, 0)
    else if step is 6
        hold(no, no)
        ui's postmessagew(handle of name, 256, 83, 0)
    else
        ui's close(w)
    end
end
set w to ui's window("Driven", 400, 300)
ui's showwindow(handle of w, 0)
set name to ui's text_box(w, 10, 10, 200, 26)
ui's on_change(name, changed)
set go to ui's button(w, "Go", 220, 10, 80, 28, greet)
set tick to ui's checkbox(w, "Dark", 10, 50, 100, 24, ticked_it)
set fruits to ui's list_box(w, 10, 80, 150, 100, chose_it)
for each fruit in list of "apple", "banana", "cherry"
    ui's add_item(fruits, fruit)
end
set sizes to ui's dropdown(w, 170, 80, 120, 200, nothing)
for each s in list of "small", "medium", "large"
    ui's add_item(sizes, s)
end
set notes to ui's text_area(w, 10, 190, 380, 100)
ui's menu_item(w, "File", "Open", opened)
ui's menu_item(w, "File", "-", nothing)
ui's menu_item(w, "File", "Save\\tCtrl+S", saved)
ui's menu_item(w, "File", "Reload\\tCtrl+Shift+F5", reloaded)
for each bad in list of "Ctrl+Bogus", "Ctrl+Shift"
    try
        ui's menu_item(w, "File", "Bad\\t" + bad, nothing)
    if it fails with why
        add why to log
    end
end
ui's on_resize(w, resized)
ui's on_close(w, closing)
ui's timer(w, 50, drive)
ui's run()
for each line in log
    say line
end`);
  const [, width, height] = /resized (\d+) (\d+)/.exec(ran.stdout) ?? [];
  assert.deepEqual([ran.stdout.replace(/resized \d+ \d+/, "resized"), ran.stderr, ran.status], [
    "windows.moth doesn't know the key 'Bogus' in 'Ctrl+Bogus'\n'Ctrl+Shift' has no key to press, only ones to hold\n"
    + "changed Sam\ngreet Sam\nticked yes\nis ticked yes\nbanana at 2 of 3\nsize large\nnow 2, 1\nopen\n"
    + '["one", "two"]\nresized\nsaved\nreloaded\nchanged Sams\nclosing\n', "", 0]);
  assert.ok(width > 400 && height > 250, `${width} by ${height}`);
});

// tools/linux.moth, GTK's own controls, with windows.moth's functions: the same window, driven by its own timer
// through GTK's functions for a click, typing and choosing, its menu's keys pressed through its accelerators.
// It needs GTK 3 and a display (CI's comes from Xvfb).
const gtkHere = ["/usr/lib/x86_64-linux-gnu/libgtk-3.so.0", "/usr/lib64/libgtk-3.so.0", "/usr/lib/libgtk-3.so.0"].some((f) => existsSync(f));
const onGtk = target !== "linux" ? "Linux only" : !gtkHere ? "GTK 3 isn't installed" : !process.env.DISPLAY ? "there's no display" : skip;
test("tools/linux.moth makes GTK's own controls, menus and keys call a program's functions", { skip: onGtk }, () => {
  const ran = libraryRun(`use "linux.moth" as ui
set log to empty list
set step to 0
set resizes to 0
to greet
    add "greet " + ui's text_of(name) to log
end
to ticked_it with on
    add "ticked " + on to log
end
to chose_it with fruit
    add "chose " + fruit to log
end
to changed with t
    add "changed " + t to log
end
to opened
    add "open" to log
end
to saved
    add "saved" to log
end
to reloaded
    add "reloaded" to log
end
to resized with width, height
    add 1 to resizes
end
to closing
    add "closing" to log
    return yes
end
to drive
    add 1 to step
    if step is 1
        ui's set_text(name, "set, not typed")
        ui's gtk_entry_set_text(handle of name, "Sam")
        ui's gtk_button_clicked(handle of go)
        ui's gtk_button_clicked(handle of tick)
        add "is ticked " + ui's ticked(tick) to log
    else if step is 2
        ui's choose(fruits, 2)
        add ui's chosen(fruits) + " at " + ui's chosen_place(fruits) + " of " + ui's count_of(fruits) to log
        ui's choose(sizes, 3)
        add "size " + ui's chosen(sizes) to log
        ui's remove_item(fruits, 1)
        add "now " + ui's count_of(fruits) + ", " + ui's chosen_place(fruits) to log
        ui's gtk_list_box_select_row(handle of fruits, ui's gtk_list_box_get_row_at_index(handle of fruits, 1))
        ui's gtk_menu_item_activate(handle of open_item)
    else if step is 3
        ui's set_text(notes, "one\\ntwo")
        add (split ui's text_of(notes) by "\\n") to log
        ui's set_text(w, "Driven again")
        add ui's text_of(w) to log
    else if step is 4
        add "keys " + ui's gtk_accel_groups_activate(handle of w, 115, 4) to log
    else if step is 5
        ui's gtk_accel_groups_activate(handle of w, 65474, 5)
    else
        ui's close(w)
    end
end
set w to ui's window("Driven", 400, 300)
set name to ui's text_box(w, 10, 10, 200, 26)
ui's on_change(name, changed)
set go to ui's button(w, "Go", 220, 10, 80, 28, greet)
set tick to ui's checkbox(w, "Dark", 10, 50, 100, 24, ticked_it)
set fruits to ui's list_box(w, 10, 80, 150, 100, chose_it)
for each fruit in list of "apple", "banana", "cherry"
    ui's add_item(fruits, fruit)
end
set sizes to ui's dropdown(w, 170, 80, 120, 200, nothing)
for each s in list of "small", "medium", "large"
    ui's add_item(sizes, s)
end
set notes to ui's text_area(w, 10, 190, 380, 100)
set open_item to ui's menu_item(w, "File", "Open", opened)
ui's menu_item(w, "File", "-", nothing)
ui's menu_item(w, "File", "Save\\tCtrl+S", saved)
ui's menu_item(w, "File", "Reload\\tCtrl+Shift+F5", reloaded)
for each bad in list of "Ctrl+Bogus", "Ctrl+Shift"
    try
        ui's menu_item(w, "File", "Bad\\t" + bad, nothing)
    if it fails with why
        add why to log
    end
end
ui's on_resize(w, resized)
ui's on_close(w, closing)
ui's timer(w, 50, drive)
ui's run()
for each line in log
    say line
end
say "resized " + (resizes is greater than 0)`, ["--allow-libraries"], { NO_AT_BRIDGE: "1" });
  assert.deepEqual([ran.stdout, ran.status], [
    "linux.moth doesn't know the key 'Bogus' in 'Ctrl+Bogus'\n'Ctrl+Shift' has no key to press, only ones to hold\n"
    + "changed Sam\ngreet Sam\nticked yes\nis ticked yes\nbanana at 2 of 3\nsize large\nnow 2, 1\nchose cherry\nopen\n"
    + '["one", "two"]\nDriven again\nsaved\nkeys yes\nreloaded\nclosing\nresized yes\n', 0], ran.stderr);
});

// tools/ui.moth: windows.moth on Windows and linux.moth on Linux, through the same functions
const onUi = target === "windows" ? skip : onGtk;
test("tools/ui.moth uses the system's own controls, on Windows and on Linux", { skip: onUi }, () => {
  const ran = libraryRun(`use "ui.moth" as ui
set w to ui's window("Both", 300, 200)
set name to ui's text_box(w, 10, 10, 200, 26)
set tick to ui's checkbox(w, "Dark", 10, 40, 100, 24, nothing)
set fruits to ui's list_box(w, 10, 70, 120, 80, nothing)
set sizes to ui's dropdown(w, 140, 70, 100, 120, nothing)
for each fruit in list of "apple", "banana"
    ui's add_item(fruits, fruit)
    ui's add_item(sizes, fruit)
end
to finish
    ui's set_text(name, "Sam")
    ui's set_ticked(tick, yes)
    ui's choose(fruits, 2)
    ui's choose(sizes, 1)
    say ui's text_of(name) " " ui's ticked(tick) " " ui's chosen(fruits) " " ui's chosen(sizes) " " ui's count_of(fruits)
    ui's close(w)
end
ui's timer(w, 50, finish)
ui's run()
say "done"`, ["--allow-libraries"], { NO_AT_BRIDGE: "1" });
  assert.deepEqual([ran.stdout, ran.status], ["Sam yes banana apple 2\ndone\n", 0], ran.stderr);
});

// Progress bars, pictures, tabs, tables and drawings, the same in windows.moth and linux.moth: a window of each
// kind, driven by its own timer, with what a person does done through the system's own calls (on Windows, a
// tab chosen with TCM_SETCURFOCUS, a row with LVM_SETITEMSTATE, a click and a paint as their messages; on Linux,
// GTK's own calls for a tab and a row, and a paint as GTK asks for it)
const moreControls = (module, person) => `use "${module}" as ui
set log to empty list
set step to 0
set painted to 0
to paint with canvas
    add 1 to painted
    ui's colour(canvas, 240, 248, 255)
    ui's rectangle(canvas, 0, 0, 200, 120)
    ui's colour(canvas, 220, 60, 60)
    ui's circle(canvas, 50, 60, 30)
    ui's colour(canvas, 30, 90, 200)
    ui's line(canvas, 100, 20, 190, 100)
    ui's colour(canvas, 0, 0, 0)
    ui's words(canvas, "Drawn by Moth", 95, 100)
end
to clicked_at with x, y
    add "clicked " + x + " " + y to log
end
to tab_chosen with title
    add "tab " + title to log
end
to row_chosen with values
    add "row " + values to log
end
to drive
    add 1 to step
    if step is 1
        ui's set_progress(bar, 40)
        ui's set_progress(bar, 140)
        ${person.click}
    else if step is 2
        ${person.paint}
        add "painted " + (painted is greater than 0) to log
        ${person.tab}
        add "now tab " + ui's chosen_tab(pages) to log
    else if step is 3
        ui's choose_row(people, 2)
        add "chosen " + ui's chosen_row(people) + " of " + ui's count_of(people) to log
        ${person.row}
    else if step is 4
        ui's clear_rows(people)
        add "rows " + ui's count_of(people) + " " + ui's chosen_row(people) to log
        ui's choose_tab(pages, 1)
        add "back to tab " + ui's chosen_tab(pages) to log
        try
            ui's set_picture(art, "no such picture.png")
        if it fails with why
            add why to log
        end
    else
        ui's close(w)
    end
end
set w to ui's window("More", 460, 360)
set pages to ui's tabs(w, 10, 10, 440, 340, tab_chosen)
set first to ui's tab(pages, "Things")
set second to ui's tab(pages, "People")
ui's label(first, "Working:", 10, 12, 70, 20)
set bar to ui's progress(first, 80, 10, 200, 20)
set art to ui's picture(first, "mandelbrot.png", 10, 50, 180, 120)
set board to ui's drawing(first, 200, 50, 200, 120, paint)
ui's on_click(board, clicked_at)
set people to ui's table(second, (list of "Name", "Age", "Town"), 10, 10, 400, 200, row_chosen)
ui's add_row(people, (list of "Sam", 20, "Pune"))
ui's add_row(people, (list of "Ana", 31, "Lisbon"))
ui's add_row(people, (list of "Bo", 7, "Oslo"))
ui's timer(w, ${person.every}, drive)
${person.hide}
ui's run()
for each line in log
    say line
end`;
const moreSaid = (click) => `${click}painted yes\ntab People\nnow tab 2\nchosen ["Ana", 31, "Lisbon"] of 3\nrow ["Bo", 7, "Oslo"]\n`
  + "rows 0 nothing\nback to tab 1\ncan't show 'no such picture.png': it isn't there, or isn't a picture\n";

test("tools/windows.moth makes progress bars, pictures, tabs, tables and drawings", { skip: target === "windows" ? skip : "Windows only" }, () => {
  const ran = libraryRun(moreControls("windows.moth", {
    click: "ui's postmessagew(handle of board, 513, 0, 20 + 30 * 65536)",
    paint: "ui's sendmessagew(handle of board, 15, 0, 0)",
    tab: "ui's sendmessagew(handle of pages, 4912, 1, 0)",
    row: "ui's send_item(handle of people, 4139, 2, record with state 3, state_mask 3)",
    every: 50,
    hide: "ui's showwindow(handle of w, 0)",
  }));
  assert.deepEqual([ran.stdout, ran.stderr, ran.status], [moreSaid("clicked 20 30\n"), "", 0]);
});

test("tools/linux.moth makes progress bars, pictures, tabs, tables and drawings", { skip: onGtk }, () => {
  const ran = libraryRun(moreControls("linux.moth", {
    click: "set clicks to 0",
    paint: "ui's redraw(board)",
    tab: "ui's gtk_notebook_set_current_page(handle of pages, 1)",
    row: "ui's gtk_tree_selection_select_path(chosen_rows of people, ui's gtk_tree_path_new_from_string(\"2\"))",
    every: 400,
    hide: "",
  }), ["--allow-libraries"], { NO_AT_BRIDGE: "1" });
  assert.deepEqual([ran.stdout, ran.status], [moreSaid(""), 0], ran.stderr);
});

// tools/game.moth: a game that plays itself, its frames driven by its own timer, a key pressed and let go and
// the mouse moved and clicked as the system's own messages would (on Linux, GTK's own call for a key), a
// picture drawn, a sound played, and how many frames a second
const gameSource = (system, press, release, mouse) => `use "game.moth" as game
use "${system}" as direct
set log to empty list
set x to 0
set x_after to 0
set frame to 0
set start_clock to 0
set painted to 0
to pressed with key
    add "pressed " + key to log
end
to clicked with px, py
    add "clicked " + px + " " + py to log
end
to update with seconds
    add 1 to frame
    if game's key_down("Right")
        set x to x + 100 * seconds
    end
    set b to handle of game's board()
    if frame is 2
        set start_clock to the clock
        game's sound("beep.wav")
    else if frame is 3
        ${press}
    else if frame is 20
        ${release}
    else if frame is 21
        add "held " + game's key_down("right") to log
        set x_after to x
    else if frame is 25
        add "stopped " + (x is x_after) to log
        ${mouse}
    else if frame is 62
        add "frames a second at least 30: " + (60 / (the clock - start_clock) is at least 30) to log
        ${system === "windows.moth" ? "direct's sendmessagew(b, 15, 0, 0)" : "add 0 to painted"}
    else if frame is 64
        game's stop_game()
    end
end
to show with canvas
    add 1 to painted
    game's colour(canvas, 10, 10, 30)
    game's rectangle(canvas, 0, 0, 320, 240)
    game's draw_image(canvas, picture, x, 40)
    game's draw_image_sized(canvas, picture, 10, 160, 60, 40)
    game's words(canvas, "frame " + frame, 10, 10)
end
set w to game's window("Game", 320, 240)
${system === "windows.moth" ? "direct's showwindow(handle of w, 0)" : ""}
set picture to game's image("mandelbrot.png")
add "picture " + width of picture + " by " + height of picture to log
game's on_key(pressed)
game's on_click(clicked)
try
    game's run_game(update, show)
if it fails with why
    add why to log
end
for each line in log
    say line
end
say "painted " + (painted is greater than 0) + ", " + (game's frames() is at least 62) + " frames"`;
// a WAV file of a 20th of a second of silence: 8 bits, one channel, 8000 a second
function silentWav() {
  const data = Buffer.alloc(400, 128);
  const head = Buffer.alloc(44);
  head.write("RIFF", 0); head.writeUInt32LE(36 + data.length, 4); head.write("WAVEfmt ", 8); head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22); head.writeUInt32LE(8000, 24); head.writeUInt32LE(8000, 28);
  head.writeUInt16LE(1, 32); head.writeUInt16LE(8, 34); head.write("data", 36); head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}
test("tools/game.moth plays a game: frames, keys held, the mouse, pictures and sounds, on Windows", { skip: target === "windows" ? skip : "Windows only" }, () => {
  const ran = libraryRun(gameSource("windows.moth", "direct's postmessagew(b, 256, 39, 0)", "direct's postmessagew(b, 257, 39, 0)",
    "direct's postmessagew(b, 512, 0, 30 + 40 * 65536)\n        direct's postmessagew(b, 513, 1, 30 + 40 * 65536)\n        direct's postmessagew(b, 514, 0, 30 + 40 * 65536)"),
    ["--allow-libraries", "--allow-read"]);
  assert.deepEqual([ran.stdout, ran.stderr, ran.status], ["picture 720 by 480\npressed Right\nheld no\nstopped yes\nclicked 30 40\n"
    + "frames a second at least 30: yes\npainted yes, yes frames\n", "", 0]);
});
test("tools/game.moth plays a game: frames, keys held, pictures and sounds, on Linux", { skip: onGtk }, () => {
  const ran = libraryRun(gameSource("linux.moth", "direct's gtk_test_widget_send_key(b, 65363, 0)", "add 0 to x_after", "add 0 to x_after"),
    ["--allow-libraries", "--allow-read"], { NO_AT_BRIDGE: "1", GDK_BACKEND: "x11", GDK_CORE_DEVICE_EVENTS: "1" }); // GTK's test keys: X11's core events
  assert.deepEqual([ran.stdout, ran.status], ["picture 720 by 480\npressed Right\nheld no\nstopped yes\n"
    + "frames a second at least 30: yes\npainted yes, yes frames\n", 0], ran.stderr);
});

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
// numbers: (0, 0) in the middle, y going up, unless it stopped at a mistake.
const onlyWindows = target === "windows" ? false : "Windows only";
function picture(source, events = "") {
  const dir = mkdtempSync(join(tmpdir(), "moth-picture-"));
  try {
    const exe = join(dir, "p.exe");
    writeFileSync(exe, machine(source, { target, name: "p.moth" }));
    if (target === "linux") chmodSync(exe, 0o755);
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

test("a drawing becomes a picture as the playground draws it: lines, boxes, circles, text and colours", { skip }, () => {
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

test("a picture shows what was drawn since the last clear, made smaller to fit if it reaches past the edge", { skip }, () => {
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

// rgb(), rgba(), hsl() and hsla(), as a canvas reads them: each drawn as a box over one of #123456, so a colour
// it doesn't read keeps that one, and one that's partly see-through shows it under. [colour, red, green, blue,
// alpha], or [colour] for one it doesn't read.
const FUNCTION_COLOURS = [
  ["rgb(255, 0, 0)", 255, 0, 0], ["RGB(0,128,0)", 0, 128, 0], ["rgb(100%, 50%, 0%)", 255, 128, 0], ["rgb(10% 20 none)", 26, 20, 0],
  ["rgb(300, -20, 127.6)", 255, 0, 128], ["  rgb(1e2, 0.5e2, .5)  ", 100, 50, 1], ["hsl(120, 100%, 50%)", 0, 255, 0],
  ["hsl(240deg, 100%, 25%)", 0, 0, 128], ["hsl(0.5turn 100% 50%)", 0, 255, 255], ["HSL(-120, 100%, 50%)", 0, 0, 255],
  ["hsl(210, 60%, 70%)", 133, 179, 224], ["hsl(30 50 50)", 191, 128, 64], ["rgba(255, 0, 0, 0.5)", 255, 0, 0, 0.5],
  ["hsla(240 100% 50% / 25%)", 0, 0, 255, 0.25], ["rgb(255, 0, 0"], ["rgb(255 0, 0)"], ["rgb(100%, 0, 0)"], ["hsl(120, 100, 50)"],
  ["rgb(1px 2 3)"], ["rgb(none, 0, 0)"], ["rgb(1 2 3) x"], ["rgba(1 2 3 / 4deg)"],
];

test("colours as rgb(), rgba(), hsl() and hsla() are read as a canvas reads them", { skip }, () => {
  const place = (i) => [-240 + (i % 10) * 45, 200 - Math.floor(i / 10) * 45];
  const { at } = picture(FUNCTION_COLOURS.map(([colour], i) => {
    const [x, y] = place(i);
    return `pen color "#123456"\ndraw box at ${x}, ${y} size 30 by 30\npen color ${JSON.stringify(colour)}\ndraw box at ${x}, ${y} size 30 by 30`;
  }).join("\n"));
  const under = [0x12, 0x34, 0x56];
  FUNCTION_COLOURS.forEach(([colour, ...rgba], i) => {
    const [x, y] = place(i);
    const want = rgba.length ? rgba.slice(0, 3).map((c, k) => c * (rgba[3] ?? 1) + under[k] * (1 - (rgba[3] ?? 1))) : under;
    const got = at(x + 15, y + 15).slice(1).match(/../g).map((h) => parseInt(h, 16));
    assert.ok(got.every((c, k) => Math.abs(c - want[k]) <= 1), `${colour}: ${got} rather than ${want}`);
  });
});

test("a chart is the bars, values and labels the playground draws", { skip }, () => {
  const { at, stdout } = picture(`pen color "red"
draw chart of (list of 1, 2, nothing, -1)
say "charted"`);
  assert.equal(stdout, "charted\n");
  assert.equal(at(15, 50), "#ff0000"); // the first bar, 100 high
  assert.equal(at(15, 105), BACKGROUND);
  assert.equal(at(55, 150), "#ff0000"); // the second, 200 high
  assert.equal(at(35, 50), BACKGROUND); // 10 between them
  assert.equal(at(95, 50), BACKGROUND); // nothing: no bar
  assert.equal(at(135, -50), "#ff0000"); // below 0, downwards
  assert.equal(at(135, 10), BACKGROUND);
  let labels = 0;
  for (let x = 0; x < 30; x++) for (let y = -18; y < -6; y++) if (at(x, y) !== BACKGROUND) labels++;
  assert.ok(labels > 5, `the label under the first bar has ${labels} pixels`);
  const amounts = picture(`draw chart of (dictionary where "a" is 3 km, "b" is 1500 m)`).at;
  assert.equal(amounts(15, 190), "#4f8ff7"); // 3 km is the longest, 200
  assert.equal(amounts(55, 90), "#4f8ff7"); // 1500 m is half of it
  assert.equal(amounts(55, 103), BACKGROUND); // and not past it, below its label
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

test("an app's handlers get keys, clicks, drags and timers, and say and fail as on the JavaScript engine", { skip }, () => {
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

// Saving and loading, the clock and waiting, and putting things in order, with files allowed: machine code, with
// the JavaScript engine's moment as MOTH_NOW (so a wait takes no time), says and fails as that engine does
test("machine code saves, loads, waits and puts things in order as the JavaScript engine does", { skip }, () => {
  for (const [source] of SAVING) {
    let stdout = "";
    let stderr = "";
    let status = 0;
    try {
      run(source, (line) => (stdout += `${line}\n`), { file: "p.moth", disk: memoryDisk() });
    } catch (err) {
      if (!(err instanceof MothError)) throw err;
      stderr = `p.moth:${err.line}:${err.col}: ${err.reason}\n${excerpt(source, err)}\n${err.trail.length ? `${describeTrail(err.trail)}\n` : ""}`;
      status = 1;
    }
    const dir = mkdtempSync(join(tmpdir(), "moth-machine-"));
    try {
      const exe = executable(dir, "p");
      writeFileSync(exe, machine(source, { target, name: "p.moth", allow: ["--allow-read", "--allow-write"] }));
      if (target === "linux") chmodSync(exe, 0o755);
      const got = spawnSync(exe, [], { cwd: dir, encoding: "utf8", env: { ...process.env, MOTH_NOW: String(FAKE_NOW), MOTH_SEED: "1" } });
      assert.deepEqual({ stdout: got.stdout, stderr: got.stderr, status: got.status }, { stdout, stderr, status }, source);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

// The real clock: the time of day, as the system says it, and a wait that really waits
test("machine code reads the real clock, and really waits", { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), "moth-machine-"));
  try {
    const exe = executable(dir, "clock");
    writeFileSync(exe, machine('say the date " " the time\nsay the clock\nwait 300 milliseconds\nsay the clock', { target, name: "clock.moth" }));
    if (target === "linux") chmodSync(exe, 0o755);
    const before = Date.now();
    const got = spawnSync(exe, [], { encoding: "utf8" });
    const took = Date.now() - before;
    const [when, start, after] = got.stdout.trim().split("\n");
    const local = (ms) => new Date(ms - new Date(ms).getTimezoneOffset() * 60_000).toISOString().slice(0, 19).replace("T", " ");
    assert.ok(when >= local(before - 1000) && when <= local(Date.now() + 1000), `${when} isn't now`);
    assert.ok(Number(start) < 0.1, start);
    assert.ok(Number(after) >= 0.29 && Number(after) < 5, after);
    assert.ok(took >= 290, `it took ${took} ms`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Pictures from files: machine code reads every PNG and BMP the JavaScript engine reads, and stops at the same
// mistake at a broken one; each program is built once and run on each file in turn
test("machine code reads pictures, and stops at a broken one as the JavaScript engine does", { skip }, () => {
  const files = [...handmadeBroken().map(([bytes]) => bytes), ...brokenPictures(1).slice(0, 60), ...pngCases(1).map((c) => c.bytes), ...bmpCases(1).map((c) => c.bytes)];
  for (const source of ['draw picture "x.png" at 0, 0\nsay "drawn"', 'draw picture read bytes "x.png" at 0, 0 size 3 by 4\nsay "drawn"']) {
    const dir = mkdtempSync(join(tmpdir(), "moth-machine-"));
    try {
      const exe = executable(dir, "p");
      writeFileSync(exe, machine(source, { target, name: "p.moth", allow: ["--allow-read"] }));
      if (target === "linux") chmodSync(exe, 0o755);
      files.forEach((bytes, i) => {
        let stdout = "";
        let stderr = "";
        let status = 0;
        try {
          run(source, (line) => (stdout += `${line}\n`), { file: "p.moth", disk: memoryDisk({ "x.png": bytes }) });
        } catch (err) {
          if (!(err instanceof MothError)) throw err;
          stderr = `p.moth:${err.line}:${err.col}: ${err.reason}\n${excerpt(source, err)}\n`;
          status = 1;
        }
        writeFileSync(join(dir, "x.png"), bytes);
        const got = spawnSync(exe, [], { cwd: dir, encoding: "utf8" });
        assert.deepEqual({ stdout: got.stdout, stderr: got.stderr, status: got.status }, { stdout, stderr, status }, `file ${i}: ${source}`);
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

// and the window draws each one's pixels as they are, over the background where they can be seen through
test("a picture from a file is drawn pixel for pixel, blended where it's see-through", { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), "moth-picture-"));
  try {
    const exe = join(dir, "p.exe");
    writeFileSync(exe, machine('draw picture "c" at -100, -100', { target, name: "p.moth", allow: ["--allow-read"] }));
    if (target === "linux") chmodSync(exe, 0o755);
    const back = [0x0b, 0x11, 0x22];
    for (const [i, c] of [...pngCases(1), ...bmpCases(1)].entries()) {
      writeFileSync(join(dir, "c"), c.bytes);
      const file = join(dir, "p.bmp");
      spawnSync(exe, [], { cwd: dir, env: { ...process.env, MOTH_PICTURE: file } });
      const bmp = readFileSync(file);
      for (let y = 0; y < c.height; y++) {
        for (let x = 0; x < c.width; x++) {
          const [r, g, b, alpha] = c.pixels.slice((y * c.width + x) * 4, (y * c.width + x) * 4 + 4);
          const want = [r, g, b].map((v, k) => Math.round((v * alpha + back[k] * (255 - alpha)) / 255));
          const at = 54 + ((350 - c.height + y) * 500 + 150 + x) * 4;
          const have = [bmp[at + 2], bmp[at + 1], bmp[at]];
          assert.ok(have.every((v, k) => Math.abs(v - want[k]) <= 2), `case ${i} at (${x}, ${y}): ${have} for ${want}`);
        }
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------- buttons and text boxes ----------

// What an app says, fails and exits with on the JavaScript engine, given events as MOTH_EVENTS lists them:
// "type hello" types into a text box, as app.send("type", ["hello"]) does.
function appOnEngine(source, events) {
  let [stdout, stderr, status] = ["", "", 0];
  try {
    const app = run(source, (line) => (stdout += `${line}\n`), { file: "p.moth" });
    const timers = app.waits.flatMap((wait, i) => (wait.event === "every" ? [i] : []));
    for (const event of events.split(";")) {
      const [what, ...rest] = event.split(" ");
      if (what === "key" || what === "type") app.send(what, [rest.join(" ")]);
      else if (what === "tick") app.handle(timers[Number(rest[0])]);
      else app.send(what, rest.map(Number));
    }
    status = app.stopped ?? 0;
  } catch (err) {
    if (!(err instanceof MothError)) throw err;
    stderr = `p.moth:${err.line}:${err.col}: ${err.reason}\n${excerpt(source, err)}\n${err.trail.length ? `${describeTrail(err.trail)}\n` : ""}`;
    status = 1;
  }
  return { stdout, stderr, status };
}

const GREETER = `draw text box "Name" at -100, 50
draw button "Greet" at 110, 50
draw button "Quit" at 110, 0
to greet with who
    if who is "z"
        say who / 2
    end
    say "Hello, " + who + "!"
end
when the button "Greet" is clicked
    greet(the text in the text box "Name")
end
when enter is pressed in the text box "Name" with words
    say "enter: " + words
    clear the text box "Name"
end
when the mouse is clicked with x and y
    say "clicked " + x + " " + y
end
when a key is pressed with key
    say "key " + key
end
when the button "Quit" is clicked
    stop the program with 4
end`;
const WIDGET_EVENTS = [
  [GREETER, "key a;type ignored;click 0 60;type Sam;key s;key enter;type Ana Lee;key backspace;click 120 60;click 160 80;type !;click 0 0;key b;click 110 30;key x"],
  [GREETER, "click 0 60;type z;click 120 60;key q"], // a mistake in a function a button's handler calls, and the trail to it
  [`draw button "A" at 0, 0
draw text box 7 at 0, 0
when the button "A" is clicked
    say "A"
end
when enter is pressed in the text box 3 + 4
    say "entered " + the text in the text box "7"
    clear
    draw button "A" at 100, 100
    draw button "A" at -100, -100
end
when the button "z" is clicked
    say 1 / 0
end`, "click 5 5;type ok;key enter;type more;click 105 105;click -95 -95;click 5 5"],
  [`draw button "z" at 0, 0
when the button "z" is clicked
    say 1 / 0
end`, "click 1 1;click 2 2"], // a mistake in a button's handler ends the app, as on the JavaScript engine
  [`draw button "Go" at 0, 0
when the button "Go" is clicked
    say "clicked"
end
every 1 second
    say "tick"
end
when the button "Stop" is clicked
    say "stopped"
end
every 2 seconds
    say "tock"
end`, "tick 0;click 5 5;tick 1;tick 0"], // each tick its own timer's, never a button's
  [here("apps/todo.moth"), "click -100 210;type Buy milk;key enter;type Call Sam;click 20 210;type x;key backspace;click 0 0;type nope;click 100 210;click -100 210;type Walk;key enter;key enter"],
];

test("buttons and text boxes in the window take clicks and typing as app.send does on the JavaScript engine", { skip }, () => {
  for (const [source, events] of WIDGET_EVENTS) {
    const got = picture(source, events);
    assert.deepEqual({ stdout: got.stdout, stderr: got.stderr, status: got.status }, appOnEngine(source, events), events);
  }
});

test("buttons and text boxes are drawn as the playground draws them", { skip }, () => {
  const { at } = picture(`pen color "red"
draw button "Go" at -100, 100
pen color "lime"
draw text box "Name" at -100, 0
draw text box "Empty" at -100, -60
when the button "Go" is clicked
    say "go"
end`, "click 0 10;type WWWW;click 0 -50");
  const count = (x0, x1, y0, y1, test) => {
    let n = 0;
    for (let x = x0; x < x1; x++) for (let y = y0; y < y1; y++) if (test(at(x, y))) n++;
    return n;
  };
  const rgb = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  assert.equal(at(-97, 103), "#ff0000"); // the button, 40 wide for its 2 letters
  assert.equal(at(-62, 127), "#ff0000");
  assert.equal(at(-58, 115), BACKGROUND);
  assert.ok(count(-100, -60, 100, 130, (c) => c === "#ffffff") > 10, "the button's label is white");
  assert.equal(at(-99, 15), "#00ff00"); // a text box's border, 2 wide
  assert.equal(at(99, 29), "#00ff00");
  assert.equal(at(95, 25), "#ffffff"); // and white inside
  assert.equal(at(101, 15), BACKGROUND);
  assert.ok(count(-92, 20, 4, 26, (c) => rgb(c).every((v) => v < 64)) > 20, "the text typed into it is black");
  assert.ok(count(-92, 20, -56, -34, (c) => rgb(c).every((v) => v > 100 && v < 200)) > 10, "an empty one shows its label in grey");
  assert.equal(at(-92, -45), "#000000"); // and the cursor, just before where its first letter goes, while it has the focus
  assert.equal(count(-32, -20, 6, 24, (c) => c !== "#ffffff"), 0); // the box that lost it has none after its text
});

test("apps/todo.moth builds, adds what's typed to its list, and draws it", { skip }, () => {
  const events = "click -100 210;type Buy milk;key enter;type Call Sam;click 20 210";
  const { at, stdout } = picture(here("apps/todo.moth"), events);
  assert.equal(stdout, "To do: Buy milk\nTo do: Call Sam\n");
  const blue = (y0, y1) => {
    let n = 0;
    for (let x = -200; x < -100; x++) for (let y = y0; y < y1; y++) if (at(x, y) === "#4f8ff7") n++;
    return n;
  };
  assert.ok(blue(155, 172) > 20, "the first thing to do is drawn");
  assert.ok(blue(130, 147) > 20, "and the second");
  assert.equal(blue(105, 122), 0);
  assert.equal(at(-5, 225), "#ffffff"); // the box, empty again
  assert.equal(at(12, 202), "#4f8ff7"); // and the Add button
});

// ---------- checkboxes, text areas and lists ----------

// moth.test.js's program with each of them (DESIGN §40), and another whose list's items change after it's
// drawn and whose picture is drawn again; "scroll x y rows" is a wheel, as app.send("scroll", ...) has it
const CONTROLS = "set fruits to list of \"apple\", \"banana\", \"cherry\", \"date\", \"elderberry\", \"fig\", \"grape\", \"kiwi\"\nto show\n    clear\n    draw checkbox \"Dark\" at -200, 200\n    draw text area \"Notes\" at -200, 50 size 250 by 100\n    draw list \"Fruits\" showing fruits at 100, 0 size 150 by 96\n    draw button \"Save\" at -200, 0\n    draw button \"Deep\" at -100, 0\nend\nto deep with n\n    if n is 0\n        return 0\n    end\n    return deep(n - 1)\nend\nshow()\ntick the checkbox \"Dark\"\nsay \"at the start \" the checkbox \"Dark\" is ticked \" \" the choice in the list \"Fruits\"\nwhen the checkbox \"Dark\" is clicked\n    say \"dark \" the checkbox \"Dark\" is ticked \" \" the checkbox \"Dark\" is not ticked\n    show()\nend\nwhen an item is chosen in the list \"Fruits\" with fruit\n    say \"chose \" fruit \" \" the choice in the list \"Fruits\"\n    show()\nend\nwhen the button \"Save\" is clicked\n    say \"notes [\" the text in the text area \"Notes\" \"]\"\n    clear the text area \"Notes\"\nend\nwhen the button \"Deep\" is clicked\n    say \"deep \" deep(5000)\nend\nwhen the mouse is clicked with x and y\n    say \"click \" x \" \" y\nend\nwhen a key is pressed with key\n    say \"key \" key\nend";
// dropdowns and sliders (DESIGN §42), as moth.test.js has them
const CONTROLS_MORE = "set sizes to list of \"small\", \"medium\", \"large\", \"huge\", \"giant\", \"titanic\", \"cosmic\"\nto show\n    clear\n    draw dropdown \"Size\" showing sizes at -200, 150\n    draw slider \"Volume\" from 0 to 10 at -200, 50\n    draw button \"Show\" at 100, 150\n    draw button \"Deep\" at 100, 100\nend\nto deep with n\n    if n is 0\n        return the value of the slider \"Volume\"\n    end\n    return deep(n - 1)\nend\nshow()\nset the slider \"Volume\" to 7\nsay \"start \" (the value of the slider \"Volume\") \" \" (the choice in the dropdown \"Size\")\nwhen an item is chosen in the dropdown \"Size\" with size\n    say \"size \" size \" \" the choice in the dropdown \"Size\"\n    show()\nend\nwhen the slider \"Volume\" is moved with v\n    say \"volume \" v \" \" the value of the slider \"Volume\"\n    show()\nend\nwhen the button \"Show\" is clicked\n    say \"show \" (the value of the slider \"Volume\") \" \" (the choice in the dropdown \"Size\")\nend\nwhen the button \"Deep\" is clicked\n    say \"deep \" deep(5000)\n    set the slider \"Volume\" to 99\n    say \"set \" the value of the slider \"Volume\"\nend\nwhen a key is pressed with key\n    say \"key \" key\nend\nwhen the mouse is clicked with x and y\n    say \"click \" x \" \" y\nend";
const CONTROL_EVENTS = [
  [CONTROLS, "click -195 205;click -150 100;type Hello;key enter;type world;key backspace;click 110 90;key down;click -95 15;key down;key down;key down;scroll 110 50 10;scroll 0 -200 3;key up;key x;click -195 15;click 110 2;click 0 -200;key y;click -150 100;key enter;key enter;type z"],
  ["set things to list of \"a\", \"b\"\ndraw list 5 showing things at 0, 0 size 100 by 48\nadd \"c\" to things\nwhen an item is chosen in the list \"5\" with it\n    say \"chose \" + it + \" \" + (the choice in the list 5)\nend\nwhen the checkbox 2 is clicked\n    say \"ticked \" + (the checkbox 2 is ticked)\nend\ndraw checkbox 2 at -100, -100\ndraw text area \"A\" at -200, 100 size 150 by 30\nwhen a key is pressed with key\n    say \"key \" + key\nend\nwhen the mouse is clicked with x and y\n    say \"click \" + x + \" \" + y\n    if x is greater than 200\n        clear\n        draw list 5 showing things at 0, 0 size 100 by 24\n        draw text box \"A\" at -200, -200\n    end\nend\nwhen enter is pressed in the text box \"A\" with words\n    say \"enter [\" + words + \"]\"\nend", "click 10 5;click 10 40;key up;key up;key down;key down;key down;click -95 -95;click -95 -95;scroll 10 10 -5;scroll 10 10 5;click 220 0;key down;key down;key up;scroll 10 10 -1;click -190 110;type one two;key enter;type three;key enter;key enter;type four;click 210 0;key enter;click -190 -190;key enter;type x;key enter"],
  [CONTROLS, "click 110 90;key up;key up;scroll 110 50 -2;scroll 110 50 100;key down;click 110 1;click -150 60;type aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa;key enter;key enter;key enter;type bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb;click -95 15"],
  [CONTROLS_MORE, "click -150 160;click -150 140;key down;key enter;key escape;key space;scroll -150 100 3;click -150 10;click -150 160;click 0 0;click 0 0;click -100 60;drag -10 60;drag 300 60;key left;key home;key end;key right;key x;key shift+left;click 110 160;click 110 110;key left;click 110 160;click -150 160;key up;key up;click -150 175;key down;click 0 -200;key down"],
];

test("checkboxes, text areas and lists in the window take clicks, keys and the wheel as app.send does on the JavaScript engine", { skip }, () => {
  for (const [source, events] of CONTROL_EVENTS) {
    const got = picture(source, events);
    assert.deepEqual({ stdout: got.stdout, stderr: got.stderr, status: got.status }, appOnEngine(source, events), events);
  }
});

test("checkboxes, text areas and lists are drawn as the playground draws them", { skip }, () => {
  const BLUE = "#4f8ff7";
  const rgb = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  const dark = (c) => rgb(c).every((v) => v < 64);
  const count = (at, x0, x1, y0, y1, test) => {
    let n = 0;
    for (let x = x0; x < x1; x++) for (let y = y0; y < y1; y++) if (test(at(x, y))) n++;
    return n;
  };
  const start = picture(CONTROLS).at;
  assert.deepEqual([start(-199, 201), start(-197, 203), start(-190, 210), start(-181, 201)], [BLUE, "#ffffff", BLUE, BLUE]); // ticked
  assert.ok(count(start, -172, -130, 202, 222, (c) => c === BLUE) > 10, "the checkbox's label, in the pen's colour");
  assert.deepEqual([start(-199, 51), start(49, 149), start(-190, 60), start(51, 100)], [BLUE, BLUE, "#ffffff", BACKGROUND]); // the text area
  assert.ok(count(start, -192, -140, 126, 146, (c) => rgb(c).every((v) => v > 100 && v < 200)) > 10, "its label in grey while it's empty");
  assert.deepEqual([start(101, 1), start(103, 50), start(245, 90), start(245, 30)], [BLUE, "#ffffff", BLUE, "#ffffff"]); // the list, and where its rows are
  assert.ok(count(start, 108, 160, 74, 92, dark) > 10, "its first item, in black");

  const after = picture(CONTROLS, "click -195 205;click -150 100;type Hello;key enter;type world;click 110 90;key down;key down;key down;key down;key down;key down;key down").at;
  assert.equal(after(-190, 210), "#ffffff"); // unticked
  assert.ok(count(after, -192, -140, 126, 146, dark) > 10, "the first line typed");
  assert.ok(count(after, -192, -140, 106, 126, dark) > 10, "and the second, below it");
  assert.equal(after(102, 50), BLUE); // the list has the focus: a border 3 wide
  assert.deepEqual([after(200, 10), after(200, 30), after(245, 40), after(245, 60)], [BLUE, "#ffffff", BLUE, "#ffffff"]); // kiwi, chosen, in the last row; the bar lower down
  assert.ok(count(after, 108, 160, 4, 20, (c) => c === "#ffffff") > 10, "the chosen item's text, in white");
});

// moth.test.js's editing app (DESIGN §41): the cursor, Shift's selecting, Ctrl+A and Ctrl+X, a drag, a text
// area's lines, and keys with Shift or Ctrl with nothing focused. The clipboard is the window's, and isn't
// touched while the events come from MOTH_EVENTS.
const EDITOR = "draw text box \"Name\" at -200, 100\ndraw text area \"Notes\" at -200, -100 size 200 by 68\ndraw button \"Show\" at 100, 100\ndraw button \"Deep\" at 100, 50\nto deep with n\n    if n is 0\n        return the text in the text area \"Notes\"\n    end\n    return deep(n - 1)\nend\nwhen the button \"Show\" is clicked\n    say \"[\" + the text in the text box \"Name\" + \"] [\" + the text in the text area \"Notes\" + \"]\"\nend\nwhen the button \"Deep\" is clicked\n    say \"deep \" + deep(5000)\nend\nwhen a key is pressed with key\n    say \"key \" + key\nend\nwhen enter is pressed in the text box \"Name\" with words\n    say \"enter \" + words\nend";
const EDIT_EVENTS = "key shift+left;key ctrl+a;click -150 110;type Hello world;key left;key left;key left;key left;key left;key shift+left;key shift+left;key shift+left;key shift+left;key shift+left;key shift+left;type Big ;click 100 110;key home;key shift+end;key ctrl+x;type abcdefghijklmnopqrstuvwxyz;click -162 110;type _;key delete;click 100 110;key ctrl+a;key backspace;type xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx;key enter;key right;key shift+home;key ctrl+c;key ctrl+v;type ab;click 100 110;click -190 -40;type one\ntwo\nthree\nfour;key up;key up;key shift+up;type !;click 100 110;key enter;key end;key shift+right;key shift+down;type ?;click 100 110;click -170 -60;drag -140 -80;drag -120 -80;type <>;click 100 110;click 105 60;key down;key down;key end;type Z;key up;key up;key up;key up;key home;key delete;click 100 110;click 0 -200;key shift+down;key ctrl+z;key up;click -190 -40;key ctrl+a;type 1\n2\n3\n4\n5;key up;key up;key up;click 100 110";

test("the cursor, selecting and editing in the window are as app.send has them on the JavaScript engine", { skip }, () => {
  const got = picture(EDITOR, EDIT_EVENTS);
  assert.deepEqual({ stdout: got.stdout, stderr: got.stderr, status: got.status }, appOnEngine(EDITOR, EDIT_EVENTS));
  // a letter every 10 from 8 in, what's selected behind its letters in light blue, and the cursor between two
  const { at } = picture(EDITOR, "click -150 110;type Hello wide world;key home;" + "key right;".repeat(6) + "key shift+right;".repeat(4));
  assert.deepEqual([at(-130, 124), at(-95, 124), at(-170, 124), at(-88, 124)], ["#b4d5fe", "#b4d5fe", "#ffffff", "#ffffff"]);
  assert.equal(at(-92, 112), "#000000");
  const ink = (x0) => { let n = 0; for (let x = x0; x < x0 + 10; x++) for (let y = 106; y < 124; y++) if (at(x, y) !== "#ffffff" && at(x, y) !== "#b4d5fe") n++; return n; };
  assert.ok(ink(-192) > 5 && ink(-142) === 0 && ink(-132) > 5, "H, then a space, then w");
});

// ---------- sound ----------
// With MOTH_SOUND=file.wav, a program's sounds go into that file instead of to the speakers: byte for byte the
// WAV soundWav makes of the sounds the JavaScript engine played, and whole up to a mistake. Away from a
// terminal, with no MOTH_SOUND, a program is silent, and says and fails just the same.
const SOUND_PROGRAMS = [
  'say "start"\nplay note "C" for 0.5 seconds\nplay a beep\nplay note 440 for 100 milliseconds\nsay "end"',
  'for each n in list of "C", "C#", "Db", "D4", "d#3", "Eb5", "E", "F", "f#", "G", "G#", "Ab", "A", "A#", "Bb", "B", "Cb4", "B#4", "c0", "B9", "rest", "REST", "a", "bb", "Cb0", "B#9"\n    play note n for 10 milliseconds\nend',
  'play note 20 for 1 second\nplay note 20000 for 0.1 seconds\nplay note 1000.5 for 1 minute\nplay note "rest" for 0 seconds\nplay note 30 for 1 millisecond',
  'play note "C" for 0.25 seconds\nplay note "H" for 1 second',
  'play note "C" for 0.25 seconds\nplay note "" for 1 second',
  'play note "Cb" + "b" for 1 second',
  'play note "é" for 1 second',
  'play note 19.99 for 1 second',
  'play note -5 for 1 second',
  'play note yes for 1 second',
  'play note list of 1 for 1 second',
  'play note "C" for -5 milliseconds',
  'play note "C" for 2 minutes',
  'play note "C" for nothing seconds',
  'play note "H" for "x" seconds',
  'try\n    play note "Q" for 1 second\nif it fails with why\n    say why\nend\nplay a beep',
  'to tone with n\n    play note n for 50 milliseconds\nend\nfor each i from 1 to 5\n    tone(200 * i)\nend\ntone("Z")',
  'set t to 3\nplay note "A" for t * 100 milliseconds\nplay note "A" for -t seconds',
  'say "a"\nplay note "E" for 0.2 seconds\nstop the program with 4',
];

function soundsOnEngine(source, name) {
  let [stdout, stderr, status] = ["", "", 0];
  const played = [];
  try {
    run(source, (line) => (stdout += `${line}\n`), { file: name, printError: (line) => (stderr += `${line}\n`), exit: (code) => (status = code), play: (sound) => played.push(sound) });
  } catch (err) {
    if (!(err instanceof MothError)) throw err;
    stderr += `${name}:${err.line}:${err.col}: ${err.reason}\n${excerpt(source, err)}\n${err.trail.length ? `${describeTrail(err.trail)}\n` : ""}`;
    status = 1;
  }
  return { stdout, stderr, status, played };
}

// how many times a second the samples go up through 0, between the first `from` and the last `from`
function pitchOf(samples, from = 441) {
  let [first, last, ups] = [-1, -1, 0];
  for (let k = from + 1; k < samples.length - from; k++) {
    if (samples[k - 1] < 0 && samples[k] >= 0) {
      const at = k - 1 - samples[k - 1] / (samples[k] - samples[k - 1]);
      if (first < 0) first = at;
      else ups++;
      last = at;
    }
  }
  return (ups * 44100) / (last - first);
}

test("machine code makes the sounds the JavaScript engine makes: MOTH_SOUND gets the same WAV, up to the same mistakes", { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), "moth-sound-"));
  try {
    SOUND_PROGRAMS.forEach((source, i) => {
      const name = `s${i}.moth`;
      const want = soundsOnEngine(source, name);
      const exe = executable(dir, `s${i}`);
      writeFileSync(exe, machine(source, { target, name }));
      if (target === "linux") chmodSync(exe, 0o755);
      const ran = spawnSync(exe, [], { cwd: dir, encoding: "utf8", env: { ...process.env, MOTH_SOUND: `s${i}.wav` } });
      assert.deepEqual({ stdout: ran.stdout, stderr: ran.stderr, status: ran.status }, { stdout: want.stdout, stderr: want.stderr, status: want.status }, source);
      assert.ok(Buffer.from(soundWav(want.played)).equals(readFileSync(join(dir, `s${i}.wav`))), `the WAV of ${source}`);
      const silent = spawnSync(exe, [], { cwd: dir, encoding: "utf8" }); // away from a terminal: no sound, and the same words
      assert.deepEqual({ stdout: silent.stdout, stderr: silent.stderr, status: silent.status }, { stdout: want.stdout, stderr: want.stderr, status: want.status }, source);
    });
    // and what's in a file is as any program reads a WAV: its header, then each note at its pitch, fading in and out
    const wav = readFileSync(join(dir, "s0.wav"));
    assert.deepEqual([wav.toString("latin1", 0, 4), wav.readUInt32LE(4), wav.toString("latin1", 8, 16), wav.readUInt16LE(20), wav.readUInt16LE(22),
      wav.readUInt32LE(24), wav.readUInt32LE(28), wav.readUInt16LE(32), wav.readUInt16LE(34), wav.toString("latin1", 36, 40), wav.readUInt32LE(40)],
    ["RIFF", wav.length - 8, "WAVEfmt ", 1, 1, 44100, 88200, 2, 16, "data", wav.length - 44]);
    const samples = new Int16Array(wav.buffer.slice(wav.byteOffset + 44, wav.byteOffset + wav.length));
    assert.equal(samples.length, 22050 + 8820 + 4410);
    const pieces = [samples.subarray(0, 22050), samples.subarray(22050, 30870), samples.subarray(30870)];
    for (const [piece, hertz] of [[pieces[0], 261.6255653005986], [pieces[1], 880], [pieces[2], 440]]) {
      assert.ok(Math.abs(pitchOf(piece) - hertz) < 0.01, `${pitchOf(piece)} hertz, not ${hertz}`);
      assert.deepEqual([piece[0], piece.at(-1), Math.max(...piece.map(Math.abs))], [0, 0, 8192]);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// An app's handlers, sent MOTH_EVENTS with MOTH_PICTURE as the picture tests do, make their sounds as each
// event comes, into MOTH_SOUND's file; one that stops the program ends its sounds there too.
test("an app's handlers make their sounds as its events come, and only a program that makes a sound has it in it", { skip }, () => {
  const source = 'set n to 0\nwhen a key is pressed with key\n    add 1 to n\n    play note key for n * 100 milliseconds\n    if key is "c"\n        stop the program with 2\n    end\nend\nevery 1 second\n    play a beep\nend\nplay note "rest" for 1 second';
  const events = "key e;tick 0;key g;key c;key d";
  const played = [];
  const app = run(source, () => {}, { play: (sound) => played.push(sound) });
  for (const event of events.split(";")) {
    const [what, key] = event.split(" ");
    if (what === "key") app.send("key", [key]);
    else app.handle(1);
  }
  assert.equal(played.length, 5);
  const dir = mkdtempSync(join(tmpdir(), "moth-sound-"));
  try {
    const exe = join(dir, "app.exe");
    const bytes = machine(source, { target, name: "app.moth" });
    writeFileSync(exe, bytes);
    if (target === "linux") chmodSync(exe, 0o755);
    const ran = spawnSync(exe, [], { cwd: dir, encoding: "utf8", env: { ...process.env, MOTH_PICTURE: join(dir, "app.bmp"), MOTH_EVENTS: events, MOTH_SOUND: "app.wav" } });
    assert.deepEqual([ran.stdout, ran.stderr, ran.status], ["", "", 2]);
    assert.ok(Buffer.from(soundWav(played)).equals(readFileSync(join(dir, "app.wav"))));
    if (target === "windows") { // winmm.dll, which plays sounds, only goes into a program that makes one
      const imports = (b) => Buffer.from(b).includes("WINMM.dll");
      assert.ok(imports(bytes));
      assert.ok(!imports(machine('say "quiet"\nmove forward 10', { target, name: "q.moth" })));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Where a program on Windows looks: its DLLs and the programs it starts come only from the system's folders
// and PATH, never from beside the program, where a file of the same name could be put to run in their place;
// an empty folder in PATH isn't the one the program runs in; and a .bat or .cmd file, which cmd.exe runs, gets
// no argument that cmd.exe would read as part of a command
test("on Windows a program takes its DLLs and the programs it starts only from where the system keeps them", { skip: onlyWindows }, () => {
  const dir = mkdtempSync(join(tmpdir(), "moth-places-"));
  try {
    writeFileSync(join(dir, "whoami.exe"), machine('say "not the real whoami"', { target, name: "w.moth" }));
    writeFileSync(join(dir, "elsewhere.exe"), machine('say "only here"', { target, name: "e.moth" }));
    for (const dll of ["winmm.dll", "winhttp.dll", "gdiplus.dll"]) { // any DLL that isn't the real one stops a program that loads it
      writeFileSync(join(dir, dll), readFileSync(join(process.env.SystemRoot, "System32", "version.dll")));
    }
    writeFileSync(join(dir, "show.bat"), "@echo off\r\necho got %1\r\n");
    const source = `move forward 10
play a beep
try
    say read "https://127.0.0.1:1/"
if it fails with why
    say "not online"
end
say "whoami: " output of (run program "whoami" with (empty list) keeping its output)
for each name in list of "elsewhere", "./show.bat", "show.bat"
    try
        set answer to run program name with (list of "it") keeping its output
        say name ": " output of answer
    if it fails with why
        say name ": " why
    end
end
for each argument in list of "a & echo INJECTED", "50%", "x\\"y"
    try
        set answer to run program "./SHOW.BAT. " with (list of argument) keeping its output
        say output of answer
    if it fails with why
        say why
    end
end
say output of (run program "./SHOW.BAT" with (list of "fine") keeping its output)`;
    const exe = join(dir, "p.exe");
    writeFileSync(exe, machine(source, { target, name: "p.moth", allow: ["--allow-run", "--allow-net"] }));
    const whoami = spawnSync(join(process.env.SystemRoot, "System32", "whoami.exe"), [], { encoding: "utf8" }).stdout.replaceAll("\r", "");
    const PATH = `${process.env.SystemRoot}\\System32;;${process.env.PATH}`;
    const got = spawnSync(exe, [], { cwd: dir, encoding: "utf8", env: { ...process.env, PATH } });
    const why = "can't run './SHOW.BAT. ': an argument to a .bat or .cmd file can't hold \" % ^ & | < > ! or a line break, which cmd.exe would read as part of a command";
    const want = ["not online", `whoami: ${whoami}`, "elsewhere: there is no program called 'elsewhere'", "./show.bat: got it\n",
      "show.bat: there is no program called 'show.bat'", why, why, why, "got fine\n"];
    assert.deepEqual([got.stdout.replaceAll("\r", ""), got.stderr, got.status], [`${want.join("\n")}\n`, "", 0]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Sending, and reading with headers: machine code against a site of the test's own on 127.0.0.1, which says back
// what it was sent; what's sent as JSON or as text, the headers, a reply's bytes, a move to another address and a
// failing site as mistakes, and every mistake in what's asked, in vm.js's words, on Windows and Linux alike
const SEND_SOURCE = "set base to item 1 of arguments\nset h to dictionary where \"Authorization\" is \"Bearer abc\", \"X-Thing\" is \"\"\nsay send (record with name \"Sam\", n 3, ok yes) to base + \"/echo\"\nsay send \"hello é\" to base + \"/echo\" with headers h\nsay send \"x\" to base + \"/echo\" with headers (dictionary where \"content-type\" is \"text/csv\")\nsay read base + \"/headers\" with headers h\nsay read bytes base + \"/bytes\" with headers (empty dictionary)\nsay json from (send (list of 1, 2) to base + \"/echo\")\nfor each path in list of \"/moved\", \"/fail\"\n    try\n        say send \"a\" to base + path\n    if it fails with why\n        say why\n    end\n    try\n        say read base + path with headers h\n    if it fails with why\n        say why\n    end\nend\nto f\n    return 1\nend\nfor each attempt in list of 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11\n    try\n        if attempt is 1\n            say send \"a\" to \"http://127.0.0.1:1/\"\n        else if attempt is 2\n            say send \"a\" to \"notes.txt\"\n        else if attempt is 3\n            say send \"a\" to base with headers (list of 1)\n        else if attempt is 4\n            say send \"a\" to base with headers (dictionary where \"Bad Name\" is \"v\")\n        else if attempt is 5\n            say send \"a\" to base with headers (dictionary where \"A\" is \"x\\ny\")\n        else if attempt is 6\n            say send \"a\" to 5\n        else if attempt is 7\n            say send (list of f) to base\n        else if attempt is 8\n            say send (list of 1 / 0) to \"notes.txt\"\n        else if attempt is 9\n            say read \"notes.txt\" with headers (empty dictionary)\n        else if attempt is 10\n            say send \"a\" to base with headers (dictionary where 1 is \"v\")\n        else\n            say read base + \"/echo\" with headers (dictionary where \"A\" is 5)\n        end\n    if it fails with why\n        say attempt \": \" why\n    end\nend\n";
const SEND_SAYS = [
  '{"method":"POST","type":"application/json","auth":null,"thing":null,"body":"{\\"name\\":\\"Sam\\",\\"n\\":3,\\"ok\\":true}"}',
  '{"method":"POST","type":"text/plain; charset=utf-8","auth":"Bearer abc","thing":"","body":"hello é"}',
  '{"method":"POST","type":"text/csv","auth":null,"thing":null,"body":"x"}',
  "GET Bearer abc []",
  "(3 bytes: 0, 1, 255)",
  '(dictionary where "method" is "POST", "type" is "application/json", "auth" is nothing, "thing" is nothing, "body" is "[1,2]")',
  "can't send to 'BASE/moved': the site answered 302",
  "can't read 'BASE/moved': the site answered 302",
  "can't send to 'BASE/fail': the site answered 500",
  "can't read 'BASE/fail': the site answered 500",
  "1: can't send to 'http://127.0.0.1:1/': couldn't reach it (Failed to connect to 127.0.0.1 port 1: Couldn't connect to server)",
  "2: 'send' sends to a site, and 'notes.txt' isn't one (its address starts http:// or https://)",
  "3: 'with headers' needs a dictionary, not a list",
  "4: 'Bad Name' can't be a header's name: it's letters, digits and - (and !#$%&'*+.^_`|~)",
  "5: the header 'A' can't hold a line break",
  "6: 'send ... to' needs a site's address, not a number",
  "7: 'send' can't send a function",
  "8: can't divide by zero",
  "9: only a site is read with headers, and 'notes.txt' isn't one (its address starts http:// or https://)",
  "10: a header's name is text, not a number",
  "11: the header 'A' needs text, not a number",
];

test("machine code sends to sites and reads them with headers, as vm.js says", { skip }, async () => {
  const server = createServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      const routes = {
        "/echo": () => [200, {}, JSON.stringify({ method: req.method, type: req.headers["content-type"] ?? null, auth: req.headers.authorization ?? null, thing: req.headers["x-thing"] ?? null, body })],
        "/headers": () => [200, {}, `${req.method} ${req.headers.authorization} [${req.headers["x-thing"]}]`],
        "/bytes": () => [200, {}, Buffer.from([0, 1, 255])],
        "/moved": () => [302, { location: "/echo" }, ""],
        "/fail": () => [500, {}, "oops"],
      };
      const [status, headers, out] = (routes[req.url] ?? (() => [404, {}, ""]))();
      res.writeHead(status, headers);
      res.end(out);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const dir = mkdtempSync(join(tmpdir(), "moth-send-"));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const exe = executable(dir, "send");
    for (const [allow, want] of [
      [["--allow-net"], { stdout: `${SEND_SAYS.join("\n").replaceAll("BASE", base)}\n`, stderr: "", status: 0 }],
      [[], { stdout: "", stderr: `send.moth:3:5: can't send to '${base}/echo': this program isn't allowed to go online (start it with --allow-net)\nsay send (record with name "Sam", n 3, ok yes) to base + "/echo"\n    ^\n`, status: 1 }],
    ]) {
      writeFileSync(exe, machine(SEND_SOURCE, { target, name: "send.moth", allow }));
      if (target === "linux") chmodSync(exe, 0o755);
      const got = await runWhileServing(exe, [base], dir);
      assert.deepEqual({ stdout: got.stdout, stderr: got.stderr, status: got.status }, want, allow.join(" "));
    }
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// Tasks: functions a program starts, each run on a thread of its own, taking turns with the program at running
// Moth (DESIGN §62). What a program with tasks says must be what the JavaScript engine says, which runs each
// task when it's started; what only threads show, a task working while the program waits, is said as yes or
// no, and is yes on both.
const TASK_PROGRAMS = [
  // results, the names a task shares with the program, and a name that's only called start
  "to count_to with n\n    set total to 0\n    for each i from 1 to n\n        add i to total\n    end\n    return total\nend\nset made to empty list\nto note with word\n    add word to made\nend\nset job to start count_to(100)\nset noted to start note(\"background\")\nset second to start count_to(10)\nsay \"started \" job \" \" second\nsay wait for job\nsay (wait for second) + 1\nwait for job\nsay wait for noted\nsay made\nset start to 5\nsay start",
  // two tasks and the program adding to one name, a turn at a time
  "set total to 0\nto adder with n\n    repeat n times\n        add 1 to total\n    end\n    return n\nend\nset a to start adder(300000)\nset b to start adder(300000)\nrepeat 300000 times\n    add 1 to total\nend\nsay (wait for a) + (wait for b)\nsay total",
  // tasks that start tasks, more than there are threads for, and two thousand started before any is waited for,
  // then each waited for, and the first again; and numbers that are no task's
  "to fib with n\n    if n is less than 2\n        return n\n    end\n    return fib(n - 1) + fib(n - 2)\nend\nset started to 0\nto pfib with n\n    if n is less than 15\n        return fib(n)\n    end\n    add 1 to started\n    set a to start pfib(n - 1)\n    set b to pfib(n - 2)\n    return (wait for a) + b\nend\nsay pfib(27)\nsay started",
  "to sq with n\n    return n * n\nend\nset jobs to empty list\nfor each i from 1 to 2000\n    add start sq(i) to jobs\nend\nset total to 0\nfor each j in jobs\n    add wait for j to total\nend\nsay total\nsay wait for (item 1 of jobs)\nfor each t in list of 0, 1.5, 2001, \"1\", -1\n    try\n        say wait for (record with task t)\n    if it fails with why\n        say why\n    end\nend",
  // a thousand tasks, one after another
  "to sq with n\n    return n * n\nend\nset total to 0\nfor each i from 1 to 1000\n    add wait for (start sq(i)) to total\nend\nsay total",
  // a task works while the program waits
  "set progress to empty list\nto busy with n\n    for each i from 1 to n\n        if i is divisible by 100000\n            add i to progress\n        end\n    end\n    return n\nend\nset job to start busy(3000000)\nset seen to empty list\nrepeat 5 times\n    wait 0.02 seconds\n    add length of progress to seen\nend\nsay \"ran while the program waited: \" (item 5 of seen is greater than item 1 of seen or length of progress is 30)\nsay wait for job\nsay length of progress",
  // the collector, with five threads making far more than they keep, and waiting now and then
  "to churn with tag, rounds\n    set kept to empty list\n    for each r from 1 to rounds\n        set garbage to empty list\n        for each i from 1 to 2000\n            add (list of tag, i, tag + i) to garbage\n        end\n        add item 1 of garbage to kept\n        if r is divisible by 25\n            wait 0.001 seconds\n        end\n    end\n    set sum to 0\n    for each k in kept\n        add item 2 of k to sum\n    end\n    return tag + \" \" + length of kept + \" \" + sum + \" \" + item 3 of item 1 of kept\nend\nset jobs to empty list\nfor each k from 1 to 4\n    add start churn(\"t\" + k, 100) to jobs\nend\nsay churn(\"main\", 100)\nfor each j in jobs\n    say wait for j\nend",
  // waiting for what isn't a task
  "for each thing in list of 5, (record with task \"x\"), (record with name 1), nothing\n    try\n        say wait for thing\n    if it fails with why\n        say why\n    end\nend",
  // a task's mistake ends the program, saying where the task was started
  "to risky with n\n    if n is 0\n        return 1 / 0\n    end\n    return risky(n - 1)\nend\nset j to start risky(2)\nwait 0.2 seconds\nsay \"never\"",
  // a task's mistake caught in the task, and files read and written by tasks at once
  "to save_and_read with k\n    set name to \"f\" + k + \".txt\"\n    write \"file \" + k to name\n    try\n        set nothing_here to read \"missing\" + k + \".txt\"\n    if it fails with why\n        return (read name) + \", \" + why\n    end\nend\nset jobs to empty list\nfor each k from 1 to 4\n    add start save_and_read(k) to jobs\nend\nsay save_and_read(0)\nfor each j in jobs\n    say wait for j\nend",
];

// What the JavaScript engine says for a program, with a disk of its own, as onEngine but with no step limit
function tasksOnEngine(source, name) {
  let [stdout, stderr, status] = ["", "", 0];
  try {
    run(source, (line) => (stdout += `${line}\n`), { file: name, disk: memoryDisk(), printError: (line) => (stderr += `${line}\n`), exit: (code) => (status = code) });
  } catch (err) {
    if (!(err instanceof MothError)) throw err;
    stderr += `${name}:${err.line}:${err.col}: ${err.reason}\n${excerpt(source, err)}\n${err.trail.length ? `${describeTrail(err.trail)}\n` : ""}`;
    status = 1;
  }
  return { stdout, stderr, status };
}

// A program with tasks, built and run in a folder of its own
function taskRun(source, { allow = ["--allow-read", "--allow-write"], files, env = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "moth-tasks-"));
  try {
    const exe = executable(dir, "p");
    writeFileSync(exe, machine(source, { target, name: "p.moth", allow, files }));
    if (target === "linux") chmodSync(exe, 0o755);
    const got = spawnSync(exe, [], { cwd: dir, encoding: "utf8", input: "", timeout: 60_000, env: { ...process.env, ...env } });
    return { stdout: got.stdout, stderr: got.stderr, status: got.status };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("tasks run alongside the program, share its names, and say, fail and give back what the JavaScript engine has them do", { skip }, () => {
  for (const source of TASK_PROGRAMS) assert.deepEqual(taskRun(source), tasksOnEngine(source, "p.moth"), source);
});

test("a program with no tasks has no threads in it, and one with tasks takes its turns from the system", () => {
  const plain = Buffer.from(machine("say 1", { target: "windows", name: "p.moth" })).toString("latin1");
  const tasks = Buffer.from(machine("to f\n    return 1\nend\nsay wait for (start f())", { target: "windows", name: "p.moth" })).toString("latin1");
  assert.ok(!plain.includes("CreateThread") && tasks.includes("CreateThread") && tasks.includes("CreateSemaphoreW"));
});

// What a task waits on, a line typed, a program it runs, a library's function: the turn goes to the others meanwhile
test("a task works while the program waits for a line typed", { skip }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "moth-tasks-"));
  try {
    const exe = executable(dir, "p");
    const source = "set ticks to 0\nto count_on\n    repeat 2000000 times\n        add 1 to ticks\n    end\n    return ticks\nend\nset job to start count_on()\nset name to ask \"Name?\"\nsay \"when \" name \" answered, the task had counted to \" ticks\nsay wait for job";
    writeFileSync(exe, machine(source, { target, name: "p.moth" }));
    if (target === "linux") chmodSync(exe, 0o755);
    const said = await new Promise((resolve, reject) => {
      const child = spawn(exe, [], { cwd: dir });
      let out = "";
      child.stdout.on("data", (d) => (out += d));
      child.on("error", reject);
      child.on("close", (status) => resolve({ out, status }));
      setTimeout(() => child.stdin.end("Sam\n"), 500);
    });
    assert.deepEqual(said, { out: "Name? Sam\nwhen Sam answered, the task had counted to 2000000\n2000000\n", status: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a task runs a program, and calls a library's functions, which C calls back, while the program goes on", { skip }, () => {
  const ran = taskRun("to run_it\n    return run program \"" + (target === "windows" ? "cmd\" with (list of \"/c\", \"echo hi\")" : "echo\" with (list of \"hi\")") + " keeping its output\nend\nset job to start run_it()\nset n to 0\nrepeat 100000 times\n    add 1 to n\nend\nset got to wait for job\nsay n \" \" code of got \" \" output of got", { allow: ["--allow-run"] });
  assert.deepEqual(ran, { stdout: target === "windows" ? "100000 0 hi\r\n\n" : "100000 0 hi\n\n", stderr: "", status: 0 });
  const nap = target === "windows" ? ["kernel32", "Sleep", 300] : ["c", "usleep", 300_000];
  const library = taskRun(`use the library "msvcrt" or "c"
    structure cell with v as a whole number
    callback compare(a cell, a cell) gives a whole number
    qsort(bytes, a long whole number, a long whole number, a compare)
end
use the library "${nap[0]}"
    ${nap[1]}(a whole number) gives a whole number
end
to by_size with x, y
    return v of x - v of y
end
to sleeper
    ${nap[1]}(${nap[2]})
    return "slept in C"
end
to sorter
    set b to (list of 5, 0, 0, 0, 1, 0, 0, 0, 3, 0, 0, 0, 2, 0, 0, 0) as bytes
    qsort(b, 4, 4, by_size)
    return b
end
set ticks to 0
set s to start sleeper()
set q to start sorter()
set t0 to the clock
repeat 3000000 times
    add 1 to ticks
end
say "main counted to " ticks " while C slept: " (the clock - t0 is less than 0.25)
say wait for s
say wait for q`, { allow: ["--allow-libraries"] });
  assert.deepEqual(library, { stdout: "main counted to 3000000 while C slept: yes\nslept in C\n(16 bytes: 1, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0, 5, 0, 0, 0)\n", stderr: "", status: 0 });
});

test("a window's timer ticks while a task works", { skip: onUi }, () => {
  const ran = libraryRun(`use "ui.moth" as ui
set finished to no
set ticks_while_working to 0
to work
    set total to 0
    for each i from 1 to 50000000
        add i to total
    end
    set finished to yes
    return total
end
set w to ui's window("Working", 300, 120)
to tick
    if finished
        ui's close(w)
    else
        add 1 to ticks_while_working
    end
end
ui's timer(w, 10, tick)
set job to start work()
ui's run()
say "the window's timer ran while the task worked: " (ticks_while_working is greater than 3)
say wait for job`, ["--allow-libraries"], { NO_AT_BRIDGE: "1" });
  assert.deepEqual([ran.stdout, ran.status], ["the window's timer ran while the task worked: yes\n1250000025000000\n", 0], ran.stderr);
});

// The Moth shell (DESIGN §65): `moth` with nothing after it reads Moth an entry at a time, a block once its `end`
// is typed, each entry built and run as a program of its own with what the entries before it left: names'
// values, functions as they were made (so a function's own names stay its own), files used, a value shown,
// a mistake's trail naming the entries, and what can't be kept said; and it leaves no file behind.
const SHELL_TYPED = "set x to 5\nx + 1\nto twice with n\n    return n * 2\nend\ntwice(x)\nto local_count\n    set count to 1\n    return count\nend\nset count to 5\nlocal_count()\ncount\nset xs to list of 1, 2\nadd twice(10) to xs\nxs\nfor each i from 1 to 3\n    set last to i * 10\nend\nlast\nuse \"helpers.moth\"\ntriple(last)\nto risky with n\n    return n / 0\nend\nrisky(2)\nx\nset f to twice\nf\n\"é😀\" + x\nif x is 5\n\n\nquit\n";
test("moth.exe with nothing after it is the Moth shell, each entry a program with what the ones before it left", { skip }, () => {
  const { exe } = mothExe();
  const dir = mkdtempSync(join(tmpdir(), "moth-shell-"));
  try {
    writeFileSync(join(dir, "helpers.moth"), "to triple with n\n    return n * 3\nend\n");
    const ran = spawnSync(exe, [], { cwd: dir, encoding: "utf8", input: SHELL_TYPED, timeout: 120_000 });
    const echoed = SHELL_TYPED.split("\n").slice(0, -1); // as each question is asked away from a terminal, the answer after it
    const prompts = ["moth", "moth", "moth", "....", "....", "moth", "moth", "....", "....", "....", "moth", "moth", "moth", "moth",
      "moth", "moth", "moth", "....", "....", "moth", "moth", "moth", "moth", "....", "....", "moth", "moth", "moth", "moth",
      "moth", "moth", "....", "....", "moth"];
    const shown = { 2: "6", 6: "10", 12: "1", 13: "5", 16: "[1, 2, 20]", 20: "30", 22: "90", 27: "5", 29: "nothing", 30: "é😀5",
      33: "(dropped what wasn't finished)" };
    let stdout = "Moth shell. Type Moth code: a block runs once its 'end' is typed, and a value shows itself. 'quit' ends it.\n";
    echoed.forEach((line, i) => {
      stdout += `${prompts[i]}> ${line}\n`;
      if (shown[i + 1]) stdout += `${shown[i + 1]}\n`;
    });
    assert.equal(ran.stdout, stdout);
    assert.equal(ran.stderr, "[16]:2:14: can't divide by zero\n    return n / 0\n             ^\n  in 'risky', called from [17], line 1\n" +
      "(f can't be kept for the next entry: 'save' can't save a function)\n");
    assert.equal(ran.status, 0);
    assert.deepEqual(readdirSync(dir).sort(), ["helpers.moth"]);
    const wrong = spawnSync(exe, ["shell", "--allow-everything"], { cwd: dir, encoding: "utf8", input: "" });
    assert.deepEqual([wrong.status, wrong.stdout], [2, ""]);
    assert.match(wrong.stderr, /^usage: moth /);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
