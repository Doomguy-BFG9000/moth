// machine.moth, Moth's machine-code back end, against the JavaScript engine: every program it can make
// machine code of becomes a program for this system, which runs and must print, write as a mistake and exit
// exactly as the JavaScript engine does. Windows and Linux only.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import https from "node:https";
import net from "node:net";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { availableParallelism, networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { run, runWasm, compileToWasmBytes, test as testMoth, machineCompiler, check, excerpt, describeTrail, format, MothError, memoryDisk, soundWav } from "./moth.js";
import examples from "./examples.js";
import { PROGRAMS, ERRORS, SAVING, TYPED, brokenPrograms } from "./cases.js";
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
  const sources = Object.fromEntries(["moth.moth", "machine.moth", "compiler.moth", "wasm.moth", "stdlib.moth", "webpage.moth", "checker-rules.moth", "moth-debugger.moth", "tools/hash.moth", "package.json"].map((f) => [f, here(f)]));
  const made = machine(sources["moth.moth"], { files: { "machine.moth": sources["machine.moth"], "compiler.moth": sources["compiler.moth"], "wasm.moth": sources["wasm.moth"], "stdlib.moth": sources["stdlib.moth"], "webpage.moth": sources["webpage.moth"], "checker-rules.moth": sources["checker-rules.moth"], "tools/hash.moth": sources["tools/hash.moth"] }, target, name: "moth.moth", allow: ["--allow-read", "--allow-write", "--allow-run"],
    include: Object.fromEntries(["moth-debugger.moth", "package.json"].map((file) => [file, Buffer.from(sources[file])])) });
  const exe = executable(dir, "moth-first");
  writeFileSync(exe, made);
  if (target === "linux") chmodSync(exe, 0o755);
  mkdirSync(join(dir, "tools"));
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
    "lib.moth:1: set calls_made to 0\n(moth) break lib.moth 4\nbreakpoint at lib.moth:4\n(moth) go\ncaught none left\nName? Bo\nlib.moth:4, in 'lib's twice': return t + t\n(moth) show t\nt is \"Bo\"\n(moth) where\n  lib.moth:4, in 'lib's twice'\n  prog.moth:25\n(moth) frobnicate\nI don't know 'frobnicate': help says what I do\n(moth) help\nstep (s)        run this line, and stop at the next one, in a call it makes too\nnext (n)        run this line, and stop at the next one here or after\nout (o)         run on, and stop once this call is over\ngo (g)          run on, and stop only at a breakpoint\nbreak 12 (b)    stop at line 12 of this file; break math.moth 12 for another\nclear 12        take that breakpoint away; breaks lists them\nshow x (p)      what x holds, or a sum of what they hold: show x + 1, show item 2 of xs, show rex's age\nvars (v)        every variable, and what it holds\nwhere (w)       this line, and the calls in progress\nlist (l)        the lines around this one\nquit (q)        end the program here\n(moth) \nBoBo (record with name \"Sam\", pets [\"cat\"])\ndone\n"],
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
      const stopped = got.stdout.replace(/stopped at the mistake, at [^\n]*\n\(moth\) \n?$/, ""); // and where it stopped at a mistake (DESIGN §93)
      assert.deepEqual({ stdout: first ? stopped.slice(first[0].length) : stopped, stderr: got.stderr, status: got.status },
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

// a package asked for at a version (DESIGN §93): at a tag, which update leaves there, and on a branch, which
// update follows; and a version that isn't there
test("moth add takes a package at a tag, a branch or a commit, and update keeps to it", { skip: skip || (gitHere ? false : "there's no git") }, () => {
  const { dir, exe } = mothExe();
  const root = join(dir, "versions");
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
  const lib = join(root, "kind");
  mkdirSync(lib);
  writeFileSync(join(lib, "kind.moth"), 'set word to "one"\n');
  git(lib, "init", "-q");
  git(lib, "add", ".");
  git(lib, "commit", "-qm", "one");
  git(lib, "tag", "v1");
  const one = git(lib, "rev-parse", "HEAD");
  git(lib, "checkout", "-qb", "next");
  writeFileSync(join(lib, "kind.moth"), 'set word to "two"\n');
  git(lib, "commit", "-qam", "two");
  const two = git(lib, "rev-parse", "HEAD");
  const pinned = join(root, "pinned");
  const following = join(root, "following");
  for (const at of [pinned, following]) {
    mkdirSync(at);
    writeFileSync(join(at, "app.moth"), 'use the package "kind" as kind\nsay kind\'s word\n');
  }
  assert.deepEqual(moth(pinned, "add", "../kind@v1"), [`added kind at ${one.slice(0, 7)} (v1), from ../kind\n`, "", 0]);
  assert.deepEqual(moth(pinned, "run", "app.moth"), ["one\n", "", 0]);
  assert.deepEqual(moth(following, "add", "../kind@next"), [`added kind at ${two.slice(0, 7)} (next), from ../kind\n`, "", 0]);
  assert.deepEqual(moth(following, "run", "app.moth"), ["two\n", "", 0]);
  writeFileSync(join(lib, "kind.moth"), 'set word to "three"\n');
  git(lib, "commit", "-qam", "three");
  const three = git(lib, "rev-parse", "HEAD");
  assert.deepEqual(moth(pinned, "update"), [`kind stays at v1, ${one.slice(0, 7)}\n`, "", 0]);
  assert.deepEqual(moth(following, "update"), [`kind: ${two.slice(0, 7)} -> ${three.slice(0, 7)}\n`, "", 0]);
  assert.deepEqual(moth(following, "run", "app.moth"), ["three\n", "", 0]);
  assert.match(readFileSync(join(following, "moth.packages"), "utf8"), new RegExp(`\\nkind \\.\\./kind@next ${three}\\n$`));
  const nowhere = join(root, "nowhere");
  mkdirSync(nowhere);
  const missing = moth(nowhere, "add", "../kind@v9");
  assert.deepEqual([missing[0], missing[2]], ["", 1]);
  assert.match(missing[1], /^moth: \.\.\/kind has no tag, branch or commit called v9: /);
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

// The sum moth.sums keeps for a package's files (DESIGN §103), made here as sha256sum would: for each file but
// Git's own, in the order of its path's bytes, its SHA-256, two spaces, its path and a line end; then the
// SHA-256 of that
function filesSum(root) {
  const paths = [];
  const walk = (at, inside) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      if (entry.name === ".git") continue;
      if (entry.isDirectory()) walk(join(at, entry.name), `${inside}${entry.name}/`);
      else paths.push(`${inside}${entry.name}`);
    }
  };
  walk(root, "");
  paths.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  const lines = paths.map((path) => `${createHash("sha256").update(readFileSync(join(root, path))).digest("hex")}  ${path}\n`).join("");
  return `sha256:${createHash("sha256").update(lines).digest("hex")}`;
}

// moth.sums (DESIGN §103): add and update write the sum of each package's files and get checks it, so a package
// changed in packages/, or where it comes from, is found; a moth.packages from before sums gets them from get;
// and a package's own moth.sums is checked for the packages it brings
test("moth.sums keeps the sum of each package's files, and moth get finds a package that has changed", { skip: skip || (gitHere ? false : "there's no git") }, () => {
  const { dir, exe } = mothExe();
  const root = join(dir, "summing");
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
  const lib = join(root, "lib");
  mkdirSync(join(lib, "data"), { recursive: true });
  writeFileSync(join(lib, "lib.moth"), 'use "data/words.moth" as words\nto hello with n\n    return words\'s hi + ", " + n\nend\n');
  writeFileSync(join(lib, "data", "words.moth"), 'set hi to "Hello"\n');
  writeFileSync(join(lib, ".gitattributes"), "* text=auto\n"); // line ends the system's own, but for moth's checkouts
  git(lib, "init", "-q");
  git(lib, "add", ".");
  git(lib, "commit", "-qm", "one");
  const one = git(lib, "rev-parse", "HEAD");
  const app = join(root, "app");
  mkdirSync(app);
  writeFileSync(join(app, "app.moth"), 'use the package "lib" as lib\nsay lib\'s hello("Sam")\n');
  const sums = () => readFileSync(join(app, "moth.sums"), "utf8");
  const packaged = join(app, "packages", "lib");
  assert.deepEqual(moth(app, "add", "../lib"), [`added lib at ${one.slice(0, 7)}, from ../lib\n`, "", 0]);
  assert.equal(readFileSync(join(packaged, "lib.moth"), "utf8").includes("\r"), false);
  const sum = filesSum(packaged);
  assert.match(sums(), new RegExp(`^# .*\\n# .*\\nlib ${one} ${sum}\\n$`));
  assert.deepEqual(moth(app, "get"), [`lib at ${one.slice(0, 7)}\n`, "", 0]);

  // a file changed, or one added, in packages/: get and update say which, and leave them
  const changed = (file) => ["", `moth: packages/lib has changed since it was fetched (${file}): remove that folder, and moth get fetches it again\n`, 1];
  writeFileSync(join(packaged, "data", "words.moth"), 'set hi to "Gotcha"\n');
  assert.deepEqual(moth(app, "get"), changed("data/words.moth"));
  assert.deepEqual(moth(app, "update"), changed("data/words.moth"));
  assert.equal(readFileSync(join(packaged, "data", "words.moth"), "utf8"), 'set hi to "Gotcha"\n');
  git(packaged, "checkout", "-q", "--", ".");
  writeFileSync(join(packaged, "extra.moth"), "say 1\n");
  assert.deepEqual(moth(app, "get"), changed("extra.moth"));
  rmSync(join(app, "packages"), { recursive: true, force: true });
  assert.deepEqual(moth(app, "get"), [`lib at ${one.slice(0, 7)}\n`, "", 0]);
  assert.deepEqual(moth(app, "run", "app.moth"), ["Hello, Sam\n", "", 0]);

  // where it comes from, it isn't what it was: what's fetched isn't kept
  const zeros = `sha256:${"0".repeat(64)}`;
  writeFileSync(join(app, "moth.sums"), sums().replace(sum, zeros));
  rmSync(join(app, "packages"), { recursive: true, force: true });
  assert.deepEqual(moth(app, "get"), ["", `moth: lib at ${one.slice(0, 7)}, from ../lib, isn't what moth.sums says: its files' sum is ${sum}, not ${zeros}, so it wasn't kept\n`, 1]);
  assert.equal(existsSync(packaged), false);

  // a moth.packages from before sums: get fetches each package again, as moth fetches now, and writes its sum down
  rmSync(join(app, "moth.sums"));
  assert.deepEqual(moth(app, "get"), [`lib at ${one.slice(0, 7)}, its sum now in moth.sums\n`, "", 0]);
  assert.match(sums(), new RegExp(`\\nlib ${one} ${sum}\\n$`));
  rmSync(join(app, "moth.sums"));
  writeFileSync(join(packaged, "lib.moth"), readFileSync(join(packaged, "lib.moth"), "utf8").replace(/\n/g, "\r\n")); // as an older moth could leave it
  assert.deepEqual(moth(app, "get"), [`lib at ${one.slice(0, 7)}, its sum now in moth.sums\n`, "", 0]);
  assert.match(sums(), new RegExp(`\\nlib ${one} ${sum}\\n$`));

  // update: the new commit, and its sum
  writeFileSync(join(lib, "data", "words.moth"), 'set hi to "Hi"\n');
  git(lib, "commit", "-qam", "two");
  const two = git(lib, "rev-parse", "HEAD");
  assert.deepEqual(moth(app, "update"), [`lib: ${one.slice(0, 7)} -> ${two.slice(0, 7)}\n`, "", 0]);
  const newer = filesSum(packaged);
  assert.notEqual(newer, sum);
  assert.match(sums(), new RegExp(`\\nlib ${two} ${newer}\\n$`));
  assert.deepEqual(moth(app, "run", "app.moth"), ["Hi, Sam\n", "", 0]);

  // a package's own moth.sums, for the packages it brings: a sum that fits, and one that doesn't
  const user = join(root, "user");
  mkdirSync(user);
  writeFileSync(join(user, "user.moth"), 'use the package "lib" as lib\nto shout with n\n    return uppercase of lib\'s hello(n)\nend\n');
  writeFileSync(join(user, "moth.packages"), `lib ../lib ${one}\n`);
  writeFileSync(join(user, "moth.sums"), `lib ${one} ${sum}\n`);
  git(user, "init", "-q");
  git(user, "add", ".");
  git(user, "commit", "-qm", "one");
  const using = git(user, "rev-parse", "HEAD");
  const other = join(root, "other");
  mkdirSync(other);
  assert.deepEqual(moth(other, "add", "../user"), [`added user at ${using.slice(0, 7)}, from ../user\nadded lib at ${one.slice(0, 7)}, which user uses\n`, "", 0]);
  assert.match(readFileSync(join(other, "moth.sums"), "utf8"), new RegExp(`\\nuser ${using} ${filesSum(join(other, "packages", "user"))}\\nlib ${one} ${sum}\\n$`));
  const ones = `sha256:${"1".repeat(64)}`;
  writeFileSync(join(user, "moth.sums"), `lib ${one} ${ones}\n`);
  git(user, "commit", "-qam", "wrong");
  const wrong = git(user, "rev-parse", "HEAD");
  const third = join(root, "third");
  mkdirSync(third);
  assert.deepEqual(moth(third, "add", "../user"), [`added user at ${wrong.slice(0, 7)}, from ../user\n`,
    `moth: lib at ${one.slice(0, 7)}, from ../lib, isn't what user's moth.sums says: its files' sum is ${sum}, not ${ones}, so it wasn't kept\n`, 1]);
  assert.deepEqual(readdirSync(join(third, "packages")), ["user"]);

  // remove: its sum goes with it
  assert.deepEqual(moth(other, "remove", "lib"), ["removed lib\n", "", 0]);
  assert.doesNotMatch(readFileSync(join(other, "moth.sums"), "utf8"), /\nlib /);
});

// --signed (DESIGN §104): a package's commit, or the tag it was asked for at, must have a signature git trusts;
// here SSH signatures, checked against a file of the keys allowed to sign
const sshKeygen = gitHere && spawnSync("ssh-keygen", ["-?"], { encoding: "utf8" }).error === undefined;
test("moth add, get and update --signed take only packages signed by a key git trusts", { skip: skip || (sshKeygen ? false : "there's no git or no ssh-keygen") }, () => {
  const { dir, exe } = mothExe();
  const root = join(dir, "signing");
  mkdirSync(root, { recursive: true });
  for (const key of ["trusted", "stranger"]) {
    assert.equal(spawnSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-C", key, "-f", join(root, key)]).status, 0);
  }
  writeFileSync(join(root, "allowed"), `moth@example.com ${readFileSync(join(root, "trusted.pub"), "utf8").trim()}\n`);
  const env = { ...process.env, GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "gpg.ssh.allowedSignersFile", GIT_CONFIG_VALUE_0: join(root, "allowed") };
  const git = (cwd, ...args) => {
    const done = spawnSync("git", ["-c", "user.name=moth", "-c", "user.email=moth@example.com", "-c", "core.autocrlf=false", "-c", "gpg.format=ssh", ...args], { cwd, encoding: "utf8" });
    assert.equal(done.status, 0, done.stderr);
    return done.stdout.trim();
  };
  const by = (key) => ["-c", `user.signingkey=${join(root, key)}`];
  const moth = (cwd, ...args) => {
    const done = spawnSync(exe, args, { cwd, env, encoding: "utf8", timeout: 120_000 });
    return [done.stdout, done.stderr, done.status];
  };
  const lib = join(root, "lib");
  mkdirSync(lib);
  const commit = (word, key) => {
    writeFileSync(join(lib, "lib.moth"), `set word to "${word}"\n`);
    git(lib, "add", ".");
    git(lib, ...(key ? by(key) : []), "commit", "-q", ...(key ? ["-S"] : []), "-m", word);
    return git(lib, "rev-parse", "HEAD");
  };
  git(lib, "init", "-q");
  const plain = commit("plain");
  git(lib, "tag", "v1"); // a tag that's only a name, which can't be signed
  const signed = commit("signed", "trusted");
  const tagged = commit("tagged");
  git(lib, ...by("trusted"), "tag", "-s", "v3", "-m", "v3");
  const strange = commit("strange", "stranger");
  const folder = (name) => {
    const at = join(root, name);
    mkdirSync(at);
    return at;
  };

  let app = folder("plain");
  assert.deepEqual(moth(app, "add", "../lib@v1", "--signed"), ["", `moth: lib at ${plain.slice(0, 7)} isn't signed\n`, 1]);
  assert.deepEqual(readdirSync(app), ["packages"]);
  assert.deepEqual(readdirSync(join(app, "packages")), []);
  app = folder("signed");
  assert.deepEqual(moth(app, "add", `../lib@${signed}`, "--signed"), [`added lib at ${signed.slice(0, 7)} (${signed}), from ../lib\n`, "", 0]);
  assert.deepEqual(moth(app, "get", "--signed"), [`lib at ${signed.slice(0, 7)}\n`, "", 0]);
  app = folder("tagged");
  assert.deepEqual(moth(app, "add", "../lib@v3", "--signed"), [`added lib at ${tagged.slice(0, 7)} (v3), from ../lib\n`, "", 0]);
  assert.deepEqual(moth(app, "get", "--signed"), [`lib at ${tagged.slice(0, 7)}\n`, "", 0]);

  // signed, by a key that isn't trusted; taken without --signed, after which get --signed says so
  app = folder("strange");
  let got = moth(app, "add", "../lib", "--signed");
  assert.deepEqual([got[0], got[2]], ["", 1]);
  assert.match(got[1], new RegExp(`^moth: lib at ${strange.slice(0, 7)} has no signature git trusts: .+\\n$`));
  assert.deepEqual(moth(app, "add", "../lib"), [`added lib at ${strange.slice(0, 7)}, from ../lib\n`, "", 0]);
  got = moth(app, "get", "--signed");
  assert.deepEqual([got[0], got[2]], ["", 1]);
  assert.match(got[1], /^moth: lib at [0-9a-f]{7} has no signature git trusts: /);

  // update --signed on a branch: a newest commit that isn't signed isn't taken, and a signed one is
  git(lib, "checkout", "-qb", "next", signed);
  app = folder("following");
  assert.deepEqual(moth(app, "add", "../lib@next", "--signed"), [`added lib at ${signed.slice(0, 7)} (next), from ../lib\n`, "", 0]);
  const unsigned = commit("unsigned");
  assert.deepEqual(moth(app, "update", "--signed"), ["", `moth: lib at ${unsigned.slice(0, 7)} isn't signed\nmoth: so lib stays at ${signed.slice(0, 7)}\n`, 1]);
  assert.match(readFileSync(join(app, "moth.packages"), "utf8"), new RegExp(`\\nlib \\.\\./lib@next ${signed}\\n$`));
  assert.equal(git(join(app, "packages", "lib"), "rev-parse", "HEAD"), signed);
  const later = commit("later", "trusted");
  assert.deepEqual(moth(app, "update", "--signed"), [`lib: ${signed.slice(0, 7)} -> ${later.slice(0, 7)}\n`, "", 0]);
  assert.equal(moth(app, "search", "--signed")[2], 2);
});

// moth audit (DESIGN §105): each package checked against the package index's advisories, by the commits one
// names, or from the commit a problem came in with to the one that fixed it; a package not fetched, an index
// with no advisories, one whose advisories aren't, and a folder with no packages
test("moth audit says which advisories in the package index are about the commits a program's packages are at", { skip: skip || (gitHere ? false : "there's no git") }, () => {
  const { dir, exe } = mothExe();
  const root = join(dir, "auditing");
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
  const lib = join(root, "lib");
  mkdirSync(lib);
  git(lib, "init", "-q");
  const commit = (word) => {
    writeFileSync(join(lib, "lib.moth"), `set word to "${word}"\n`);
    git(lib, "add", ".");
    git(lib, "commit", "-qm", word);
    return git(lib, "rev-parse", "HEAD");
  };
  const first = commit("first");
  const broken = commit("broken");
  const fixed = commit("fixed");
  const zipCommit = "0123456789abcdef0123456789abcdef01234567";
  const where = lib.replace(/\\/g, "/");
  writeFileSync(join(root, "index.json"), JSON.stringify({
    packages: { lib: { repository: where, about: "Words" }, zipper: { repository: "github.com/example/zipper", about: "Squeezes files" } },
    advisories: [
      { id: "MOTH-2026-1", package: "lib", introduced: broken, fixed, severity: "high", about: "hello() runs what it's given", link: "https://example.com/1" },
      { id: "MOTH-2026-2", repository: `${where.toUpperCase()}.git/`, commits: [first.slice(0, 7)], about: "the first commit leaks" },
      { id: "MOTH-2026-3", package: "zipper", commits: [zipCommit], about: "zipper eats files" },
    ],
  }));
  const at = (name, commit) => {
    const app = join(root, name);
    mkdirSync(app);
    assert.equal(moth(app, "add", `${lib}@${commit}`)[2], 0);
    return app;
  };
  const index = ["--index", "../index.json"];
  assert.deepEqual(moth(at("first", first), "audit", ...index), [`lib at ${first.slice(0, 7)}: MOTH-2026-2: the first commit leaks\n  not fixed yet\n1 advisory is about these packages\n`, "", 1]);
  const brokenApp = at("broken", broken);
  assert.deepEqual(moth(brokenApp, "audit", ...index), [`lib at ${broken.slice(0, 7)}: MOTH-2026-1 (high): hello() runs what it's given\n  fixed at ${fixed.slice(0, 7)}: moth update lib takes its newest\n  https://example.com/1\n1 advisory is about these packages\n`, "", 1]);
  const fixedApp = at("fixed", fixed);
  assert.deepEqual(moth(fixedApp, "audit", ...index), [`no advisories about lib at ${fixed.slice(0, 7)}\n`, "", 0]);

  // a package from a site, written another way than the index has it, and named by the commits it's at
  writeFileSync(join(fixedApp, "moth.packages"), `${readFileSync(join(fixedApp, "moth.packages"), "utf8")}zip https://GitHub.com/example/zipper.git ${zipCommit}\n`);
  assert.deepEqual(moth(fixedApp, "audit", ...index), [`zip at 0123456: MOTH-2026-3: zipper eats files\n  not fixed yet\n1 advisory is about these packages\n`, "", 1]);

  // the history it needs isn't fetched; an index with no advisories; advisories that aren't; no packages
  rmSync(join(brokenApp, "packages"), { recursive: true, force: true });
  assert.deepEqual(moth(brokenApp, "audit", ...index), ["", "moth: lib isn't fetched, so it couldn't be checked: moth get fetches it\n", 1]);
  writeFileSync(join(root, "quiet.json"), JSON.stringify({ packages: {} }));
  assert.deepEqual(moth(brokenApp, "audit", "--index", "../quiet.json"), [`no advisories about lib at ${broken.slice(0, 7)}\n`, "", 0]);
  writeFileSync(join(root, "bad.json"), JSON.stringify({ packages: { lib: { repository: where } }, advisories: [5] }));
  const bad = moth(brokenApp, "audit", "--index", "../bad.json");
  assert.deepEqual([bad[0], bad[2]], ["", 1]);
  assert.match(bad[1], /^moth: an advisory in the package index at \.\.\/bad\.json isn't one: /);
  assert.deepEqual(moth(root, "audit", ...index), ["", "moth: there's no moth.packages here: moth add <git repository> adds a package\n", 1]);
  assert.equal(moth(root, "audit", "extra")[2], 2);
});

// moth build --web: a page holding the program and the files it uses (math.moth from the standard library),
// as JSON nothing in which ends its script; and a program with a mistake says it, and makes no page
// `moth build --installer` (DESIGN §99): app-setup, which puts the program in a folder (--into, so no menu entry
// is made here) with what takes it away, which --uninstall runs; and --sign, a command run on each program made
test("moth.exe build --installer makes a setup program that installs and takes away the program, and --sign signs each", { skip }, () => {
  const { dir, exe } = mothExe();
  const sub = join(dir, "installing");
  mkdirSync(sub);
  writeFileSync(join(sub, "app.moth"), 'say "installed and running"\n');
  const signer = target === "windows" ? "cmd /c echo" : "echo";
  const built = spawnSync(exe, ["build", "app.moth", "--installer", "--name", "Moth Test App", "--version", "2.1.0", "--sign", signer], { cwd: sub, encoding: "utf8" });
  const [app, setup, remover] = target === "windows" ? ["app.exe", "app-setup.exe", "uninstall.cmd"] : ["app", "app-setup", "uninstall.sh"];
  const lines = built.stdout.split("\n");
  assert.deepEqual([lines[1], lines[3], lines[4], built.stderr, built.status], [`signed ${app}`, `signed ${setup}`, "", "", 0], built.stdout);
  assert.match(lines[2], new RegExp(`^made its installer -> ${setup.replace(".", "\\.")} \\([\\d,]+ bytes\\): run, it installs Moth Test App 2\\.1\\.0$`));
  if (target === "linux") chmodSync(join(sub, setup), 0o755);
  const into = join(sub, "portable");
  const installed = spawnSync(join(sub, setup), ["--quiet", "--into", into], { encoding: "utf8" });
  assert.deepEqual([installed.stdout, installed.stderr, installed.status], ["", "", 0]);
  assert.deepEqual(readdirSync(into).sort(), [app, remover].sort());
  const ran = spawnSync(join(into, app), [], { encoding: "utf8" });
  assert.equal(ran.stdout, "installed and running\n");
  const removed = spawnSync(join(sub, setup), ["--quiet", "--uninstall", "--into", into], { encoding: "utf8" });
  assert.deepEqual([removed.stderr, removed.status, existsSync(into)], ["", 0, false]);
  const wrong = spawnSync(join(sub, setup), ["--frobnicate"], { encoding: "utf8" });
  assert.equal(wrong.status, 1);
  assert.match(wrong.stderr, /the installer takes --uninstall, --quiet and --into <folder>, not --frobnicate/);
  const unsigned = spawnSync(exe, ["build", "app.moth", "--sign", "no-such-signer"], { cwd: sub, encoding: "utf8" });
  assert.deepEqual([unsigned.stderr, unsigned.status], ["moth: --sign couldn't start no-such-signer: there is no program called 'no-such-signer'\n", 1]);
});

test("moth.exe build --web makes a page that holds the program and the files it uses", { skip }, () => {
  const { dir, exe } = mothExe();
  const sub = join(dir, "web");
  mkdirSync(sub);
  const source = 'use "math.moth"\nsay sqrt(2)\nsay "</script> stays in its text"\n';
  writeFileSync(join(sub, "app.moth"), source);
  const built = spawnSync(exe, ["build", "--web", "app.moth"], { cwd: sub, encoding: "utf8" });
  assert.match(built.stdout, /^made app\.html, a page that runs app\.moth in a browser \([\d,]+ bytes\)\n$/);
  assert.deepEqual([built.stderr, built.status], ["", 0]);
  const html = readFileSync(join(sub, "app.html"), "utf8");
  const json = /window\.MOTH_APP = (.*);\n/.exec(html)[1];
  assert.ok(!/<\/script/i.test(json), "the program's text would end the page's script");
  const app = JSON.parse(json);
  assert.deepEqual([app.name, app.source, Object.keys(app.files)], ["app.moth", source, ["math.moth"]]);
  assert.equal(app.files["math.moth"], here("math.moth"));
  writeFileSync(join(sub, "bad.moth"), "say 1 +\n");
  const bad = spawnSync(exe, ["build", "--web", "bad.moth"], { cwd: sub, encoding: "utf8" });
  assert.deepEqual([bad.stdout, bad.status], ["", 1]);
  assert.match(bad.stderr, /^bad\.moth:2:1: expected a value but found the end of the code\n/);
  assert.ok(!existsSync(join(sub, "bad.html")));
});

// moth build --target wasm (DESIGN §125): app.wasm, the module wasm.moth makes, here made by wasm.moth as machine
// code, which must be wasm.js's bytes; what running it needs follows in a section of its own, and runWasm runs it
// as the VM runs the program. A program with a mistake says it, and makes no module.
test("moth.exe build --target wasm makes wasm.js's module, which runs as the VM runs the program", { skip }, () => {
  const { dir, exe } = mothExe();
  const sub = join(dir, "wasm");
  mkdirSync(sub);
  const source = 'use "math.moth"\nto fib with n\n    if n is less than 2\n        return n\n    end\n    return fib(n - 1) + fib(n - 2)\nend\nsay "fib(15) is " fib(15) " and " sqrt(2)\nset d to dictionary where "é" is list of 1, "x"\nsay d\nsay item 3 of item "é" of d\n';
  writeFileSync(join(sub, "app.moth"), source);
  const built = spawnSync(exe, ["build", "app.moth", "--target", "wasm"], { cwd: sub, encoding: "utf8" });
  assert.match(built.stdout, /^compiled app\.moth to WebAssembly -> app\.wasm \([\d,]+ bytes\)\n$/);
  assert.deepEqual([built.stderr, built.status], ["", 0]);
  const bytes = readFileSync(join(sub, "app.wasm"));
  const files = { "math.moth": here("math.moth") };
  const module = compileToWasmBytes(source, { files: (name) => files[name] }).bytes;
  assert.deepEqual([...bytes.subarray(0, module.length)], [...module]);
  const outcome = (go) => {
    const said = [];
    try {
      go((line) => said.push(line));
    } catch (err) {
      said.push(`${err.message} ${JSON.stringify(err.trail)}`);
    }
    return said;
  };
  const vm = outcome((print) => run(source, print, { engine: "vm", files: (name) => files[name] }));
  assert.deepEqual(vm.slice(0, 2), ["fib(15) is 610 and 1.41421356237309", '(dictionary where "é" is [1, "x"])']);
  assert.deepEqual(outcome((print) => runWasm(bytes, print)), vm);
  writeFileSync(join(sub, "bad.moth"), "say 1 +\n");
  const bad = spawnSync(exe, ["build", "bad.moth", "--target", "wasm"], { cwd: sub, encoding: "utf8" });
  assert.deepEqual([bad.stdout, bad.status], ["", 1]);
  assert.match(bad.stderr, /^bad\.moth:2:1: expected a value but found the end of the code\n/);
  assert.ok(!existsSync(join(sub, "bad.wasm")));
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

// `moth kernel` (DESIGN §122), as editors/jupyter's kernel talks to it: each line names a file of a cell's code,
// which runs as a notebook's block does, with its output and mistakes going out as they come, between a line of
// byte 1 and "moth-cell" and one of byte 1 and "moth-done ok" or "moth-done failed", and one of byte 1 and
// "moth-done" on the error output; a number before the file's name numbers the cell, unless that would go back;
// a question is answered from the input. Each line is written once what it waits for has come, as the kernel
// writes them, and what the kernel built and kept is gone at the end.
test("moth.exe kernel runs cells for Jupyter, each with what the ones before made", { skip }, async () => {
  const { dir, exe } = mothExe();
  const sub = join(dir, "kernel");
  mkdirSync(sub);
  const cells = { "1.moth": 'set xs to list of 1, 2, 3\nsay "made " + length of xs\n', "2.moth": "xs\n\n", "3.moth": "set xs to list of 9\nsay item 9 of xs\n",
    "4.moth": "to double with n\n    return n * 2\nend\ndouble(item 3 of xs)\n", "5.moth": "\n  \n", "6.moth": 'say "to the error output" to the error output\nsay nope\n',
    "7.moth": 'set name to ask "Name?"\nsay "hi " + name\n' };
  for (const [name, code] of Object.entries(cells)) writeFileSync(join(sub, name), code);
  const child = spawn(exe, ["kernel", "--allow-read"], { cwd: sub, stdio: ["pipe", "pipe", "pipe"] });
  let [stdout, stderr] = ["", ""];
  child.stdout.setEncoding("utf8").on("data", (d) => (stdout += d));
  child.stderr.setEncoding("utf8").on("data", (d) => (stderr += d));
  const ended = new Promise((resolve) => child.on("close", resolve));
  const until = async (ready, what) => {
    for (const start = Date.now(); !ready(); await new Promise((r) => setTimeout(r, 20)))
      if (Date.now() - start > 120_000) throw new Error(`waited for ${what}: ${JSON.stringify(stdout)} ${JSON.stringify(stderr)}`);
  };
  const done = () => (stdout.match(/\x01moth-done (ok|failed)\n/g) ?? []).length;
  for (const line of ["1.moth", "2.moth", "3.moth", "4.moth", "5.moth", "9 6.moth", "missing.moth", "7.moth", "Ana", "8 3.moth"]) {
    const before = done();
    child.stdin.write(line + "\n");
    if (line === "7.moth") await until(() => stdout.endsWith("Name? "), "the question");
    else await until(() => done() > before, line);
  }
  child.stdin.write("\n");
  const status = await ended;
  const mistake = (cell, line, why, code, at) => `cell ${cell}:${line}:${at}: ${why}\n${code}\n${" ".repeat(at - 1)}^\n`;
  assert.deepEqual([stdout, stderr, status], [" 1.moth\n\x01moth-cell\nmade 3\n\x01moth-done ok\n 2.moth\n\x01moth-cell\n[1, 2, 3]\n\x01moth-done ok\n"
    + " 3.moth\n\x01moth-cell\n\x01moth-done failed\n 4.moth\n\x01moth-cell\n6\n\x01moth-done ok\n 5.moth\n\x01moth-cell\n\x01moth-done ok\n"
    + " 9 6.moth\n\x01moth-cell\n\x01moth-done failed\n missing.moth\n\x01moth-cell\n\x01moth-done failed\n"
    + " 7.moth\n\x01moth-cell\nName? Ana\nhi Ana\n\x01moth-done ok\n 8 3.moth\n\x01moth-cell\n\x01moth-done failed\n \n",
  "\x01moth-done\n\x01moth-done\n" + mistake(3, 2, "there is no item 9, the list only has 1 item", "say item 9 of xs", 5) + "\x01moth-done\n\x01moth-done\n\x01moth-done\n"
    + "to the error output\n" + mistake(9, 2, "'nope' has no value yet (give it one with 'set nope to ...')", "say nope", 5) + "\x01moth-done\n"
    + "moth: there is no file called 'missing.moth'\n\x01moth-done\n\x01moth-done\n"
    + mistake(11, 2, "there is no item 9, the list only has 1 item", "say item 9 of xs", 5) + "\x01moth-done\n", 0]);
  assert.deepEqual(readdirSync(sub).sort(), Object.keys(cells).sort(), "what the kernel built or kept was left behind");
});

// editors/jupyter's kernel (DESIGN §122): its own tests, in Python, against a stand-in for moth kernel and against
// the moth built here; and, where ipykernel and jupyter_client are installed, as Jupyter runs it
function pythonCommand() {
  for (const command of ["python3", "python"]) {
    const asked = spawnSync(command, ["-c", "import sys; print(sys.version_info >= (3, 8))"], { encoding: "utf8", cwd: tmpdir() });
    if (!asked.error && asked.stdout.trim() === "True") return command;
  }
  return null;
}
const jupyterPython = target ? pythonCommand() : null;
test("editors/jupyter's kernel runs cells through moth kernel, as Jupyter runs them", { skip: skip || (!jupyterPython && "there's no Python 3.8 or later here") }, () => {
  const { exe } = mothExe();
  const ran = spawnSync(jupyterPython, ["-B", fileURLToPath(new URL("./editors/jupyter/test_moth_kernel.py", import.meta.url))],
    { cwd: tmpdir(), env: { ...process.env, MOTH: exe }, encoding: "utf8", timeout: 600_000 });
  assert.equal(ran.status, 0, ran.stdout + ran.stderr);
  assert.match(ran.stderr, /\nOK( \(skipped=\d+\))?\n$/);
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
  // after a mistake: its report, then the profile up to it
  writeFileSync(join(sub, "oops.moth"), "to f with n\n    return item n of list of 1\nend\nsay f(1)\nsay f(2)\nsay \"never\"\n");
  const oops = spawnSync(exe, ["profile", "oops.moth"], { cwd: sub, encoding: "utf8" });
  assert.deepEqual([oops.stdout, oops.status], ["1\n", 1]);
  assert.match(oops.stderr, /^oops\.moth:2:12: there is no item 2, the list only has 1 item\n[^]*\nmoth profile: \d+\.\d{3} s in all, 5 lines run\n[^]* 2  f\n/);
  // an app: its handlers' calls and lines, and the time it waited for them on a line of its own
  writeFileSync(join(sub, "keys.moth"), "set count to 0\nwhen a key is pressed with key\n    set count to count + 1\n    say \"key \" + key\nend\n");
  const keys = spawnSync(exe, ["profile", "keys.moth"], { cwd: sub, encoding: "utf8", env: { ...process.env, MOTH_PICTURE: join(sub, "keys.bmp"), MOTH_EVENTS: "key left;key right;tick 0" } });
  assert.deepEqual([keys.stdout, keys.status], ["key left\nkey right\n", 0], keys.stderr);
  assert.match(keys.stderr, /^moth profile: \d+\.\d{3} s in all, 6 lines run\n/);
  assert.match(keys.stderr, /\n +\d+\.\d{3} s +\d+\.\d% {10}\(waiting for events\)\n/);
  assert.match(keys.stderr, /\n +\d+\.\d{3} s +\d+\.\d% +2  when a key is pressed\n/);
  assert.match(keys.stderr, /\n +\d+\.\d{3} s +\d+\.\d% +2  keys\.moth:4  say "key " \+ key\n/);
  rmSync(join(sub, "keys.bmp"), { force: true });
  assert.deepEqual(readdirSync(sub).sort(), ["keys.moth", "oops.moth", "stops.moth", "work.moth"], "the program built to profile was left behind");
});

// `moth coverage` (DESIGN §93): the program runs, then the error output says how many lines with a statement
// on them ran, and which didn't, in the program's file and in a file it uses
test("moth.exe coverage says which lines of a program and the files it uses ran", { skip }, () => {
  const { dir, exe } = mothExe();
  const sub = join(dir, "covering");
  mkdirSync(sub);
  writeFileSync(join(sub, "half.moth"), "to half with n\n    if n is divisible by 2\n        return n / 2\n    end\n    return nothing\nend\n");
  writeFileSync(join(sub, "cov.moth"), 'use "half.moth"\nsay half(4)\nif no\n    say "never"\nend\nset x to 1\n');
  const ran = spawnSync(exe, ["coverage", "cov.moth"], { cwd: sub, encoding: "utf8", timeout: 120_000 });
  assert.deepEqual([ran.stdout, ran.stderr, ran.status], ["2\n", "moth coverage: 6 of 8 lines run (75.0%)\n  cov.moth: 3 of 4 (75.0%), not run: 4\n"
    + "  half.moth: 3 of 4 (75.0%), not run: 5\n", 0]);
  assert.deepEqual(readdirSync(sub).sort(), ["cov.moth", "half.moth"], "the program built for coverage was left behind");
});

// `show` works out a sum of the variables the line can see (DESIGN §98): items, fields, comparisons, brackets
test("a program built to be debugged shows sums of its variables, and says why one can't be worked out", { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), "moth-debug-"));
  try {
    const exe = executable(dir, "d");
    writeFileSync(exe, machine("set xs to list of 10, 20, 30\nset sam to record with name \"Sam\", age 20, pet (record with name \"Rex\")\nset total to 7\nsay total\n", { target, name: "p.moth", debug: true, files: { "moth-debugger.moth": here("moth-debugger.moth") } }));
    if (target === "linux") chmodSync(exe, 0o755);
    const ran = spawnSync(exe, [], { input: "step\nstep\nstep\nshow total + 1\nshow item 2 of xs + total\nshow sam's pet's name\nshow age of sam\nshow total is greater than 5 and not (total is 9)\nshow 2 * (3 + 4)\nshow -total\nshow nope + 1\nshow item 9 of xs\nquit\n", encoding: "utf8", timeout: 60_000 });
    assert.deepEqual([ran.stdout, ran.stderr, ran.status], ["p.moth:1: set xs to list of 10, 20, 30\n(moth) step\np.moth:2: set sam to record with name \"Sam\", age 20, pet (record with name \"Rex\")\n(moth) step\np.moth:3: set total to 7\n(moth) step\np.moth:4: say total\n(moth) show total + 1\ntotal + 1 is 8\n(moth) show item 2 of xs + total\nitem 2 of xs + total is 27\n(moth) show sam's pet's name\nsam's pet's name is \"Rex\"\n(moth) show age of sam\nage of sam is 20\n(moth) show total is greater than 5 and not (total is 9)\ntotal is greater than 5 and not (total is 9) is yes\n(moth) show 2 * (3 + 4)\n2 * (3 + 4) is 14\n(moth) show -total\n-total is -7\n(moth) show nope + 1\ncan't work out nope + 1: there's no 'nope' here\n(moth) show item 9 of xs\ncan't work out item 9 of xs: there is no item 9, the list only has 3 items\n(moth) quit\n", "", 0]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// a program built to be debugged stops at its mistake, after the report, with the variables the line could see
test("a program built to be debugged stops at a mistake, to look at what went wrong", { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), "moth-debug-"));
  try {
    const exe = executable(dir, "d");
    writeFileSync(exe, machine("to divide with a, b\n    set half to a / 2\n    return a / b\nend\nset total to 10\nsay divide(total, 2)\nsay divide(total, 0)\nsay \"never\"\n",
      { target, name: "p.moth", debug: true, files: { "moth-debugger.moth": here("moth-debugger.moth") } }));
    if (target === "linux") chmodSync(exe, 0o755);
    const ran = spawnSync(exe, [], { input: "go\nvars\nshow b\nwhere\nlist\nquit\n", encoding: "utf8", timeout: 60_000 });
    assert.deepEqual([ran.stdout, ran.stderr, ran.status], ["p.moth:1: to divide with a, b\n(moth) go\n5\nstopped at the mistake, at p.moth:3, in 'divide': return a / b\n"
      + "(moth) vars\na is 10\nb is 0\nhalf is 5\ntotal is 10\n(moth) show b\nb is 0\n(moth) where\n  p.moth:3, in 'divide'\n  p.moth:7\n(moth) list\n"
      + "   1  to divide with a, b\n   2      set half to a / 2\n-> 3      return a / b\n   4  end\n   5  set total to 10\n   6  say divide(total, 2)\n(moth) quit\n",
      "p.moth:3:14: can't divide by zero\n    return a / b\n             ^\n  in 'divide', called from line 7\n", 1]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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
  assert.deepEqual([tested.stdout.split("\n").at(-2), tested.status], ["8 passed", 0], tested.stdout);
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
  const again = spawnSync(exe, ["build", "moth.moth", "--allow-read", "--allow-write", "--allow-run", "--include", "moth-debugger.moth", "--include", "package.json"], { cwd: dir, encoding: "utf8", timeout: 120_000 });
  assert.equal(again.status, 0, again.stdout + again.stderr);
  assert.ok(Buffer.from(made).equals(readFileSync(executable(dir, "moth"))), "moth.exe built itself into different bytes");
  const version = spawnSync(executable(dir, "moth"), ["--version"], { cwd: tmpdir(), encoding: "utf8" });
  assert.deepEqual([version.status, version.stdout, version.stderr], [0, `moth ${JSON.parse(here("package.json")).version}\n`, ""]);
});

test("moth.exe --version and version say the release version away from its source", { skip }, () => {
  const { dir, exe } = mothExe();
  const away = join(dir, "version away");
  mkdirSync(away);
  const moved = executable(away, "renamed-moth");
  copyFileSync(exe, moved);
  if (target === "linux") chmodSync(moved, 0o755);
  const want = `moth ${JSON.parse(here("package.json")).version}\n`;
  for (const manifest of [null, '{"version":"0.0.0"}', "not JSON"]) {
    if (manifest !== null) writeFileSync(join(away, "package.json"), manifest);
    for (const command of ["--version", "version"]) {
      const said = spawnSync(moved, [command], { cwd: away, encoding: "utf8", input: "", timeout: 5_000 });
      assert.deepEqual([said.status, said.stdout, said.stderr], [0, want, ""], `${command}, package.json: ${manifest}`);
    }
  }
});

test("moth.exe version commands reject extra arguments", { skip }, () => {
  const { dir, exe } = mothExe();
  for (const args of [["--version", "extra"], ["version", "extra"], ["version", "--allow-all"]]) {
    const said = spawnSync(exe, args, { cwd: dir, encoding: "utf8", input: "", timeout: 5_000 });
    assert.deepEqual([said.status, said.stdout], [2, ""], args.join(" "));
    assert.match(said.stderr, /^usage: moth /);
    assert.match(said.stderr, /moth --version \| moth version/);
  }
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

// `moth check`: the problems checker.js finds, in its own words and its own order (DESIGN §107), types and
// all: it works them out as checker.js does, and looks up what each rule does in checker-rules.moth. What it
// leaves out are the problems checker.js marks `valued`, which rest on a value written out, not on types.
const checkedBy = (file, source, files = {}) => { // what `moth check file` must say
  const problems = check(source, { files: (name) => files[name] }).filter((p) => !p.valued);
  if (!problems.length) return `${file}: no problems found\n`;
  return problems.map((p) => {
    const kind = p.kind === "fails" ? "will fail" : p.kind;
    return `${p.file ?? file}:${p.line}:${p.col}: ${kind}: ${p.message}\n${excerpt(p.file ? files[p.file] : source, p)}\n`;
  }).join("");
};
const wrongIn = (said) => (/: (will fail|doesn't fit): /.test(said) ? 1 : 0); // what moth check ends with


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
    ["sums.moth", 'set name to "Moth"\nsay name * 2\nsay 1 / 0\nsay length of 5\nrepeat "x" times\nend\nset l to list of 1\nsay item 0 of l\n', 1],
    // what each ends with is the checker's: TYPED[4] and TYPED[6] are right as they are (see moth.test.js)
    ...TYPED.map((source, i) => [`typed${i}.moth`, source, wrongIn(checkedBy(`typed${i}.moth`, source))]),
  ];
  writeFileSync(join(sub, "lib.moth"), lib);
  for (const [name, source] of cases) writeFileSync(join(sub, name), source);
  for (const [name, source, status] of cases) {
    const said = checking(name);
    assert.equal(said.stdout, checkedBy(name, source, { "lib.moth": lib }), name);
    assert.deepEqual([said.status, said.stderr], [status, ""], name);
  }
  // what rests on a value written out is left to the playground's checker: dividing by zero, item 0, repeat "x" times
  assert.equal(check(cases.find(([name]) => name === "sums.moth")[1]).filter((p) => p.valued).length, 3);
  // code that can't be read at all is one problem of its own, and a file that isn't there says so
  writeFileSync(join(sub, "wrong.moth"), "say 1 +\n");
  const wrong = checking("wrong.moth");
  assert.deepEqual([wrong.status, wrong.stdout, wrong.stderr], [1, "wrong.moth:2:1: error: expected a value but found the end of the code\n\n^\n", ""]);
  const missing = checking("nowhere.moth");
  assert.deepEqual([missing.status, missing.stdout, missing.stderr], [1, "", "moth: there is no file called 'nowhere.moth'\n"]);
  // and the same words as the checker on working programs, and on programs broken on purpose
  let checked = 0;
  const programs = [...Object.values(examples), ...PROGRAMS.map(([source]) => source), ...brokenPrograms(3, 120)];
  programs.forEach((source, i) => {
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
    assert.equal(said.status, wrongIn(want), `${name}:\n${source}`);
    checked++;
  });
  assert.ok(checked > 100, `only ${checked} were checked`);
});

// `moth lsp` (DESIGN §108), spoken to as an editor speaks to it: each message written as the Language Server
// Protocol frames it, and each it says read so, its Content-Length the bytes after the empty line exactly.
// What isn't framed so goes in `framing`, which must stay empty.
function lspSession(exe, cwd) {
  const child = spawn(exe, ["lsp"], { cwd });
  const session = { framing: [], stderr: "", said: [] };
  const waiters = [];
  let buffer = Buffer.alloc(0);
  child.stderr.on("data", (data) => (session.stderr += data));
  child.stdout.on("data", (data) => {
    buffer = Buffer.concat([buffer, data]);
    for (;;) {
      const head = buffer.indexOf("\r\n\r\n");
      if (head < 0) return;
      const header = buffer.subarray(0, head).toString("latin1");
      const length = /^Content-Length: (\d+)$/.exec(header);
      if (!length) {
        session.framing.push(header);
        buffer = buffer.subarray(head + 4);
        continue;
      }
      const end = head + 4 + Number(length[1]);
      if (buffer.length < end) return;
      const body = buffer.subarray(head + 4, end).toString("utf8");
      buffer = buffer.subarray(end);
      let message;
      try {
        message = JSON.parse(body);
      } catch {
        session.framing.push(body);
        continue;
      }
      const k = waiters.findIndex((w) => w.fits(message));
      if (k >= 0) waiters.splice(k, 1)[0].done(message);
      else session.said.push(message);
    }
  });
  session.exited = new Promise((done) => child.on("exit", done));
  session.kill = () => child.kill();
  session.raw = (bytes) => child.stdin.write(bytes);
  session.framed = (message) => {
    const body = Buffer.from(JSON.stringify(message), "utf8");
    return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "latin1"), body]);
  };
  // the next message that fits, said already or yet to be
  session.next = (fits) => new Promise((done, fail) => {
    const k = session.said.findIndex(fits);
    if (k >= 0) return done(session.said.splice(k, 1)[0]);
    const timer = setTimeout(() => fail(new Error(`moth lsp said nothing that fits: ${JSON.stringify(session.said)} ${session.stderr}`)), 60_000);
    waiters.push({ fits, done: (m) => (clearTimeout(timer), done(m)) });
  });
  let id = 0;
  session.ask = async (method, params) => {
    const n = ++id;
    session.raw(session.framed({ jsonrpc: "2.0", id: n, method, params }));
    const answer = await session.next((m) => m.id === n && m.method === undefined);
    return answer.error ? { error: answer.error } : answer.result;
  };
  session.tell = (method, params) => session.raw(session.framed({ jsonrpc: "2.0", method, params }));
  session.problems = (uri) => session.next((m) => m.method === "textDocument/publishDiagnostics" && m.params.uri === uri).then((m) => m.params.diagnostics);
  return session;
}

test("moth lsp answers an editor: problems as it's typed, tidying, the outline, definitions across files, hovers and completion", { skip }, async () => {
  const { dir, exe } = mothExe();
  const sub = join(dir, "lsp work"); // a space, which a file's address writes as %20
  mkdirSync(sub, { recursive: true });
  const lib = "# twice the number, for café prices\nto twice with n as a number gives a number\n    return n * 2\nend\n";
  const shapes = "# Shapes: the areas of squares and the rest.\n\n# a square's area\nto square with side\n    return side * side\nend\n";
  writeFileSync(join(sub, "lib.moth"), lib);
  writeFileSync(join(sub, "shapes.moth"), shapes);
  const uri = (name) => pathToFileURL(join(sub, name)).href;
  const main = [
    'use "lib.moth"', // 0
    'use "shapes.moth" as shapes',
    "",
    "# the area of a box",
    "to area with w as a number, h as a number gives a number",
    "    return w * h", // 5
    "end",
    "",
    "kind dog with name as text",
    "    to speak with self",
    '        return self\'s name + " says woof"', // 10
    "    end",
    "end",
    "",
    "set size to area(2, 3)",
    'set rex to dog("Rex")', // 15
    "say rex's speak() + twice(size) + shapes's square(2)",
    'say area("wide", 2)',
    "set unused to 1",
    "",
  ].join("\n");
  // what moth check, and checker.js, find in a document, as the protocol has a problem: its line and column
  // from 0, 1 for what makes moth check end with 1 and 2 for the rest, and the checker's words
  const want = (source, files) => check(source, { files: (name) => files[name] }).filter((p) => !p.valued && !p.file)
    .map((p) => [p.line - 1, p.col - 1, ["fails", "error", "doesn't fit"].includes(p.kind) ? 1 : 2, p.message]);
  const got = (found) => found.map((d) => [d.range.start.line, d.range.start.character, d.severity, d.message]);
  const at = (line, character, name = "main.moth") => ({ textDocument: { uri: uri(name) }, position: { line, character } });
  const s = lspSession(exe, sub);
  try {
    const hello = await s.ask("initialize", { processId: null, rootUri: pathToFileURL(sub).href, capabilities: {} });
    assert.deepEqual(hello, { capabilities: { textDocumentSync: { openClose: true, change: 1, save: true }, documentFormattingProvider: true,
      documentSymbolProvider: true, definitionProvider: true, hoverProvider: true, completionProvider: { triggerCharacters: ["'"] } }, serverInfo: { name: "moth" } });
    s.tell("initialized", {});

    // the problems as a document opens: moth check's, the types' among them, with what's never used faded
    s.tell("textDocument/didOpen", { textDocument: { uri: uri("main.moth"), languageId: "moth", version: 1, text: main } });
    const opened = await s.problems(uri("main.moth"));
    assert.deepEqual(got(opened), want(main, { "lib.moth": lib, "shapes.moth": shapes }));
    assert.ok(opened.some((d) => d.message === "'area' needs w to be a number, not text" && d.severity === 1), JSON.stringify(opened));
    assert.deepEqual(opened.find((d) => d.message === "'unused' is set but never used").tags, [1]);

    // the outline: functions, kinds with their own functions in them, and variables, each to its end
    const shown = (x) => [x.name, x.kind, x.detail, x.range.start.line, x.range.end.line, x.selectionRange.start.character, x.children.map(shown)];
    assert.deepEqual((await s.ask("textDocument/documentSymbol", { textDocument: { uri: uri("main.moth") } })).map(shown), [
      ["area", 12, "with w as a number, h as a number gives a number", 4, 6, 3, []],
      ["dog", 5, "with name as text", 8, 12, 5, [["speak", 6, "with self", 9, 11, 7, []]]],
      ["size", 13, "", 14, 14, 4, []],
      ["rex", 13, "", 15, 15, 4, []],
      ["unused", 13, "", 18, 18, 4, []],
    ]);

    // where a name is made: here, in a file it uses, a kind's own function, a file a use line names
    const where = async (...p) => {
      const l = await s.ask("textDocument/definition", at(...p));
      return l && [l.uri, l.range.start.line, l.range.start.character, l.range.end.character];
    };
    assert.deepEqual(await where(14, 13), [uri("main.moth"), 4, 3, 7]); // area
    assert.deepEqual(await where(5, 11), [uri("main.moth"), 4, 13, 14]); // w, an input of area
    assert.deepEqual(await where(16, 27), [uri("main.moth"), 14, 4, 8]); // size
    assert.deepEqual(await where(16, 22), [uri("lib.moth"), 1, 3, 8]); // twice, lib.moth's
    assert.deepEqual(await where(16, 45), [uri("shapes.moth"), 3, 3, 9]); // shapes's square
    assert.deepEqual(await where(16, 12), [uri("main.moth"), 9, 7, 12]); // rex's speak, dog's
    assert.deepEqual(await where(16, 36), [uri("shapes.moth"), 0, 0, 0]); // shapes, the file
    assert.deepEqual(await where(0, 7), [uri("lib.moth"), 0, 0, 0]); // "lib.moth"
    assert.equal(await where(16, 1), null); // say, a Moth word

    // what a name is: a function with what it takes and gives and the comment above it, a variable with
    // what it holds, an input, a kind, a kind's own function with what it gives, and a file it uses
    const hover = async (...p) => (await s.ask("textDocument/hover", at(...p)))?.contents ?? null;
    assert.deepEqual(await hover(14, 13), { kind: "markdown", value: "```moth\nto area with w as a number, h as a number gives a number\n```\n\nthe area of a box" });
    assert.equal((await hover(16, 22)).value, "```moth\nto twice with n as a number gives a number\n```\n\ntwice the number, for café prices\n\nIn lib.moth, line 2.");
    assert.equal((await hover(14, 5)).value, "`size`, a variable: a number\n\nFirst set on line 15.");
    assert.equal((await hover(15, 5)).value, "`rex`, a variable: a dog\n\nFirst set on line 16.");
    assert.equal((await hover(5, 11)).value, "`w`, an input of `area`: a number");
    assert.equal((await hover(8, 6)).value, "```moth\nkind dog with name as text\n```");
    assert.equal((await hover(16, 12)).value, "```moth\nto speak with self\n```\n\nGives text.");
    assert.equal((await hover(1, 22)).value, '```moth\nuse "shapes.moth" as shapes\n```\n\nShapes: the areas of squares and the rest.');
    assert.equal(await hover(16, 1), null);

    // what can come next: what the program makes that the line can see, and Moth's words
    const all = await s.ask("textDocument/completion", at(17, 0));
    assert.deepEqual(all.filter((c) => c.kind !== 14).map((c) => [c.label, c.kind, c.detail]), [["twice", 3, "with n as a number gives a number"],
      ["area", 3, "with w as a number, h as a number gives a number"], ["dog", 7, "with name as text"], ["size", 6, undefined], ["rex", 6, undefined], ["unused", 6, undefined]]);
    assert.ok(["say", "set", "for each", "if it fails"].every((w) => all.some((c) => c.label === w && c.kind === 14)));

    // As it's typed: an unfinished line and a function not yet ended are the one mistake moth check says, and
    // the rest is still known; after `rex's`, what a dog has, and after `shapes's`, what shapes.moth makes
    const typing = main + "set half to\nto later with x\n    say rex's \n    say shapes's ";
    s.tell("textDocument/didChange", { textDocument: { uri: uri("main.moth"), version: 2 }, contentChanges: [{ text: typing }] });
    const typed = await s.problems(uri("main.moth"));
    assert.deepEqual(got(typed), want(typing, { "lib.moth": lib, "shapes.moth": shapes }));
    assert.equal(typed.length, 1);
    assert.deepEqual((await s.ask("textDocument/documentSymbol", { textDocument: { uri: uri("main.moth") } })).map((x) => x.name), ["area", "dog", "size", "rex", "unused", "later"]);
    const labels = async (...p) => (await s.ask("textDocument/completion", at(...p))).map((c) => c.label);
    assert.ok((await labels(19, 11)).includes("later"));
    assert.deepEqual(await labels(21, 14), ["name", "speak"]);
    assert.deepEqual(await labels(22, 17), ["square"]);
    assert.equal((await hover(15, 5)).value, "`rex`, a variable: a dog\n\nFirst set on line 16.");

    // An unsaved change to a file it uses counts: lib.moth, opened with twice taking text, has its problems
    // said, and main.moth, which uses it, has its own said again
    s.tell("textDocument/didChange", { textDocument: { uri: uri("main.moth"), version: 3 }, contentChanges: [{ text: main }] });
    await s.problems(uri("main.moth"));
    const changed = lib.replace("with n as a number gives a number", "with n as text gives text").replace("n * 2", "n + n");
    s.tell("textDocument/didOpen", { textDocument: { uri: uri("lib.moth"), languageId: "moth", version: 1, text: changed } });
    assert.deepEqual(got(await s.problems(uri("lib.moth"))), want(changed, {}));
    const again = await s.problems(uri("main.moth"));
    assert.deepEqual(got(again), want(main, { "lib.moth": changed, "shapes.moth": shapes }));
    assert.ok(again.some((d) => d.message === "'twice' needs n to be text, not a number"), JSON.stringify(again));
    assert.equal((await hover(16, 22)).value, "```moth\nto twice with n as text gives text\n```\n\ntwice the number, for café prices\n\nIn lib.moth, line 2.");
    // closed, it's the file on the disk again
    s.tell("textDocument/didClose", { textDocument: { uri: uri("lib.moth") } });
    assert.deepEqual(await s.problems(uri("lib.moth")), []);
    assert.deepEqual(got(await s.problems(uri("main.moth"))), got(opened));

    // tidying is moth tidy's, which is format()'s; tidy code needs nothing; code with a mistake is left as it is
    const messy = "to   area with w,h\nreturn w*h\n  end\nsay area(2,3)\n";
    s.tell("textDocument/didOpen", { textDocument: { uri: uri("messy.moth"), languageId: "moth", version: 1, text: messy } });
    await s.problems(uri("messy.moth"));
    const tidy = (name) => s.ask("textDocument/formatting", { textDocument: { uri: uri(name) }, options: { tabSize: 4, insertSpaces: true } });
    assert.deepEqual(await tidy("messy.moth"), [{ range: { start: { line: 0, character: 0 }, end: { line: 4, character: 0 } }, newText: format(messy) }]);
    s.tell("textDocument/didChange", { textDocument: { uri: uri("messy.moth"), version: 2 }, contentChanges: [{ text: format(messy) }] });
    await s.problems(uri("messy.moth"));
    assert.deepEqual(await tidy("messy.moth"), []);
    s.tell("textDocument/didChange", { textDocument: { uri: uri("messy.moth"), version: 3 }, contentChanges: [{ text: "say (1\n" }] });
    await s.problems(uri("messy.moth"));
    assert.deepEqual(await tidy("messy.moth"), []);
    assert.deepEqual((await s.next((m) => m.method === "window/showMessage")).params,
      { type: 2, message: "Moth can't tidy this until its mistake is put right: expected ')' but found the end of the code" });
    // a file not open is read from the disk
    assert.deepEqual((await s.ask("textDocument/documentSymbol", { textDocument: { uri: uri("shapes.moth") } })).map((x) => x.name), ["square"]);

    // what it doesn't do it says so, and a note it doesn't know it lets be
    assert.deepEqual(await s.ask("textDocument/references", at(14, 13)), { error: { code: -32601, message: "moth lsp doesn't do textDocument/references" } });
    s.tell("$/setTrace", { value: "off" });
    // a message that comes in pieces, and two that come in one, are each read as they are
    const piece = s.framed({ jsonrpc: "2.0", id: 900, method: "textDocument/hover", params: at(14, 5) });
    s.raw(piece.subarray(0, 10));
    await new Promise((r) => setTimeout(r, 100));
    s.raw(piece.subarray(10, piece.length - 5));
    await new Promise((r) => setTimeout(r, 100));
    s.raw(piece.subarray(piece.length - 5));
    assert.equal((await s.next((m) => m.id === 900)).result.contents.value, "`size`, a variable: a number\n\nFirst set on line 15.");
    s.raw(Buffer.concat([s.framed({ jsonrpc: "2.0", id: 901, method: "textDocument/hover", params: at(14, 13) }), s.framed({ jsonrpc: "2.0", id: 902, method: "textDocument/hover", params: at(15, 5) })]));
    assert.match((await s.next((m) => m.id === 901)).result.contents.value, /^```moth\nto area/);
    assert.match((await s.next((m) => m.id === 902)).result.contents.value, /^`rex`/);

    // shutdown, then exit: it ends with 0
    assert.equal(await s.ask("shutdown", null), null);
    s.tell("exit", null);
    assert.equal(await s.exited, 0);
    assert.deepEqual([s.framing, s.stderr], [[], ""]);
  } finally {
    s.kill(); // if it hasn't ended, as when something above didn't hold
  }

  // An editor that finds the problems itself asks for none; and exit with no shutdown first ends with 1
  const quiet = lspSession(exe, sub);
  try {
    await quiet.ask("initialize", { processId: null, capabilities: {}, initializationOptions: { diagnostics: false } });
    quiet.tell("textDocument/didOpen", { textDocument: { uri: uri("main.moth"), languageId: "moth", version: 1, text: main } });
    assert.deepEqual((await quiet.ask("textDocument/documentSymbol", { textDocument: { uri: uri("main.moth") } })).map((x) => x.name), ["area", "dog", "size", "rex", "unused"]);
    assert.deepEqual(quiet.said, []);
    quiet.tell("exit", null);
    assert.equal(await quiet.exited, 1);
  } finally {
    quiet.kill();
  }

  // the VS Code extension's client.js, spoken to it: started, asked, and stopped, which ends it with 0
  const { startServer } = createRequire(import.meta.url)("./editors/vscode/client.js");
  const server = await startServer(exe, { cwd: sub, initializationOptions: { diagnostics: false } });
  assert.equal(server.capabilities.hoverProvider, true);
  server.notify("textDocument/didOpen", { textDocument: { uri: uri("main.moth"), languageId: "moth", version: 1, text: main } });
  assert.equal((await server.request("textDocument/hover", at(16, 22))).contents.value.split("\n")[1], "to twice with n as a number gives a number");
  await assert.rejects(server.request("textDocument/references", at(14, 13)), { code: -32601 });
  const ended = new Promise((done) => server.onExit(done));
  await server.stop();
  assert.equal(await ended, "it ended with 0");
  // and a moth that isn't there, or that ends before it answers, as one from before moth lsp would
  await assert.rejects(startServer(join(sub, "no-moth-here")), /moth lsp couldn't start: there's no /);
  await assert.rejects(startServer(exe, { args: ["lsp-not"] }), /moth lsp couldn't start: it ended with 2/);
});

// `ask for 5 bytes` (DESIGN §108), what moth lsp reads messages with: the next 5 bytes of the input, waited for
// but not to a line's end, or as many as come before it ends, and then none; from the same input `ask` reads
// lines from. Only machine code reads the input so: the playground's engines say so.
test("ask for ... bytes reads the input as it comes, in machine code", { skip }, () => {
  const source = ['set name to ask "Name? "', 'say "hi " name', "set got to ask for 5 bytes", "repeat while length of got is greater than 0",
    '    say length of got ": " (got as text)', "    set got to ask for 5 bytes", "end", "say length of (ask for 3 bytes)", "try",
    "    say ask for -1 bytes", "if it fails with why", "    say why", "end"].join("\n");
  const dir = mkdtempSync(join(tmpdir(), "moth-machine-"));
  try {
    const exe = executable(dir, "ask");
    writeFileSync(exe, machine(source, { target, name: "ask.moth" }));
    if (target === "linux") chmodSync(exe, 0o755);
    const ran = spawnSync(exe, [], { input: "Sam\nhello world é", encoding: "utf8", timeout: 60_000 });
    assert.deepEqual([ran.stdout, ran.stderr, ran.status],
      ["Name?  Sam\nhi Sam\n5: hello\n5:  worl\n4: d é\n0\n'bytes' needs a whole number in front of it, not -1\n", "", 0]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  for (const engine of ["vm", "jit", "wasm"]) {
    assert.throws(() => run("say length of (ask for 5 bytes)", () => {}, { engine }), { reason: "'ask for ... bytes' reads the input as it comes, which only a program moth builds can do" });
  }
  assert.throws(() => run('say ask for "x"', () => {}), { reason: "say how many bytes, as in 'ask for 64 bytes'" });
});

// The debug adapter (editors/vscode/debug-adapter.js, DESIGN §109) as an editor other than VS Code starts it, a
// program of its own speaking the Debug Adapter Protocol, on moth debug: breakpoints in the program and a file it
// uses, the calls in progress, variables, hovers and the debug console, stepping, the program's question
// answered, the mistake it stops at, and how it ended; and a program stopped while it runs, cleanly.
function dapSession(cwd) {
  const child = spawn(process.execPath, [new URL("./editors/vscode/debug-adapter.js", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")], { cwd });
  const session = { said: [], output: "" };
  const waiters = [];
  let buffer = Buffer.alloc(0);
  child.stdout.on("data", (data) => {
    buffer = Buffer.concat([buffer, data]);
    for (;;) {
      const head = buffer.indexOf("\r\n\r\n");
      if (head < 0) return;
      const end = head + 4 + Number(/Content-Length: (\d+)/.exec(buffer.subarray(0, head).toString("latin1"))[1]);
      if (buffer.length < end) return;
      const message = JSON.parse(buffer.subarray(head + 4, end).toString("utf8"));
      buffer = buffer.subarray(end);
      if (message.event === "output") session.output += message.body.category === "stdout" ? message.body.output : "";
      const k = waiters.findIndex((w) => w.fits(message));
      if (k >= 0) waiters.splice(k, 1)[0].done(message);
      else session.said.push(message);
    }
  });
  session.next = (fits) => new Promise((done, fail) => {
    const k = session.said.findIndex(fits);
    if (k >= 0) return done(session.said.splice(k, 1)[0]);
    const timer = setTimeout(() => fail(new Error(`the adapter said nothing that fits: ${JSON.stringify(session.said)}`)), 60_000);
    waiters.push({ fits, done: (m) => (clearTimeout(timer), done(m)) });
  });
  let seq = 0;
  session.ask = async (command, args = {}) => {
    const n = ++seq;
    const body = Buffer.from(JSON.stringify({ seq: n, type: "request", command, arguments: args }), "utf8");
    child.stdin.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]));
    const answer = await session.next((m) => m.type === "response" && m.request_seq === n);
    return answer.success ? answer.body ?? null : { failed: answer.message };
  };
  session.stopped = () => session.next((m) => m.event === "stopped").then((m) => m.body);
  session.exited = new Promise((done) => child.on("exit", done));
  session.kill = () => child.kill();
  return session;
}

test("the debug adapter debugs a program through moth debug, over the Debug Adapter Protocol", { skip }, async () => {
  const { dir, exe } = mothExe();
  const sub = join(dir, "dap work");
  mkdirSync(sub, { recursive: true });
  writeFileSync(join(sub, "lib.moth"), DEBUG_LIB);
  writeFileSync(join(sub, "prog.moth"), DEBUG_PROGRAM);
  const file = (name) => join(sub, name);
  const s = dapSession(sub);
  try {
    const can = await s.ask("initialize", { adapterID: "moth", linesStartAt1: true, columnsStartAt1: true });
    assert.equal(can.supportsConfigurationDoneRequest, true);
    await s.next((m) => m.event === "initialized");
    assert.equal(await s.ask("launch", { program: file("prog.moth"), mothPath: exe }), null);
    assert.deepEqual(await s.ask("setBreakpoints", { source: { path: file("lib.moth") }, breakpoints: [{ line: 4 }] }), { breakpoints: [{ verified: true, line: 4 }] });
    await s.ask("setBreakpoints", { source: { path: file("prog.moth") }, breakpoints: [{ line: 5 }] });
    await s.ask("setExceptionBreakpoints", { filters: [] });
    await s.ask("configurationDone");

    // at the breakpoint in bump: where it is, the calls in progress, what the line can see
    assert.deepEqual(await s.stopped(), { reason: "breakpoint", threadId: 1, allThreadsStopped: true });
    const frames = (await s.ask("stackTrace", { threadId: 1 })).stackFrames.map((f) => [f.name, f.source.path, f.line]);
    assert.deepEqual(frames, [["bump", file("prog.moth"), 5], ["the program", file("prog.moth"), 17]]);
    assert.deepEqual(await s.ask("scopes", { frameId: 0 }), { scopes: [{ name: "Variables", variablesReference: 1, expensive: false }] });
    const shown = async () => (await s.ask("variables", { variablesReference: 1 })).variables.map((v) => [v.name, v.value]);
    assert.deepEqual((await shown()).slice(0, 3), [["bump", "<function bump>"], ["count", "0"], ["tick", "<function bump>"]]);
    assert.deepEqual(await s.ask("evaluate", { expression: "count + 1", context: "hover" }), { result: "1", variablesReference: 0 });
    assert.deepEqual(await s.ask("evaluate", { expression: "nope", context: "watch" }), { failed: "there's no 'nope' here" });
    assert.deepEqual(await s.ask("evaluate", { expression: "where", context: "repl" }), { result: "  prog.moth:5, in 'bump'\n  prog.moth:17", variablesReference: 0 });
    // stepping: out of bump, then over a line
    await s.ask("setBreakpoints", { source: { path: file("prog.moth") }, breakpoints: [] }); // taken away, at the next command
    await s.ask("stepOut", { threadId: 1 });
    assert.equal((await s.stopped()).reason, "step");
    assert.deepEqual((await s.ask("stackTrace", { threadId: 1 })).stackFrames.map((f) => f.line), [18]);
    await s.ask("next", { threadId: 1 });
    await s.stopped();
    assert.deepEqual((await s.ask("stackTrace", { threadId: 1 })).stackFrames.map((f) => f.line), [19]);
    assert.deepEqual(await s.ask("pause", { threadId: 1 }), { failed: "moth debug stops only at a line it's told to: set a breakpoint there" });
    // on to the program's question, answered in the debug console, and the breakpoint in lib.moth
    await s.ask("continue", { threadId: 1 });
    await s.next((m) => m.event === "output" && /Name\? $/.test(s.output));
    await s.ask("evaluate", { expression: "Ana", context: "repl" });
    assert.equal((await s.stopped()).reason, "breakpoint");
    assert.deepEqual((await s.ask("stackTrace", { threadId: 1 })).stackFrames.map((f) => [f.name, f.source.path, f.line]), [["lib's twice", file("lib.moth"), 4], ["the program", file("prog.moth"), 25]]);
    assert.deepEqual((await shown()).find(([name]) => name === "t"), ["t", '"Ana"']);
    // on to the end: what it said, and that it ended with 0
    await s.ask("continue", { threadId: 1 });
    assert.deepEqual((await s.next((m) => m.event === "exited")).body, { exitCode: 0 });
    await s.next((m) => m.event === "terminated");
    assert.equal(s.output, 'caught none left\nName? Ana\nAnaAna (record with name "Sam", pets ["cat"])\ndone\n');
    assert.equal(await s.ask("disconnect"), null);
  } finally {
    s.kill();
  }
  assert.ok(!existsSync(join(sub, `prog-debug${target === "windows" ? ".exe" : ""}`)), "moth debug left the program it built");

  // A mistake that ends the program: stopped there, with what it could see, and then ended with 1
  writeFileSync(join(sub, "broken.moth"), "to risky with n\n    if n is 0\n        fail with \"none left\"\n    end\n    return risky(n - 1)\nend\nsay risky(2)\n");
  const m = dapSession(sub);
  try {
    await m.ask("initialize", { adapterID: "moth" });
    await m.ask("launch", { program: file("broken.moth"), mothPath: exe });
    await m.ask("configurationDone");
    const stop = await m.stopped();
    assert.deepEqual([stop.reason, stop.description, stop.text], ["exception", "Stopped at the mistake", 'fail with "none left"']);
    assert.deepEqual((await m.ask("stackTrace", { threadId: 1 })).stackFrames.map((f) => f.line), [3, 5, 5, 7]);
    assert.deepEqual((await m.ask("variables", { variablesReference: 1 })).variables.map((v) => [v.name, v.value]), [["n", "0"]]);
    await m.ask("continue", { threadId: 1 });
    assert.deepEqual((await m.next((x) => x.event === "exited")).body, { exitCode: 1 });
  } finally {
    m.kill();
  }

  // stopped on entry, and a program stopped while it runs: ended, and the program moth built taken away
  writeFileSync(join(sub, "forever.moth"), "set n to 0\nrepeat while yes\n    add 1 to n\n    wait 10 milliseconds\nend\n");
  const f = dapSession(sub);
  try {
    await f.ask("initialize", { adapterID: "moth" });
    await f.ask("launch", { program: file("forever.moth"), mothPath: exe, stopOnEntry: true });
    await f.ask("configurationDone");
    assert.equal((await f.stopped()).reason, "entry");
    assert.deepEqual((await f.ask("stackTrace", { threadId: 1 })).stackFrames.map((x) => x.line), [1]);
    await f.ask("continue", { threadId: 1 });
    await new Promise((r) => setTimeout(r, 500));
    assert.deepEqual(await f.ask("variables", { variablesReference: 1 }), { failed: "the program isn't stopped" });
    await f.ask("disconnect");
    await f.next((x) => x.event === "terminated");
    await new Promise((r) => setTimeout(r, 1000));
    assert.ok(!existsSync(join(sub, `forever-debug${target === "windows" ? ".exe" : ""}`)), "the program moth debug built is still there");
  } finally {
    f.kill();
  }
  // and a moth that isn't there
  const n = dapSession(sub);
  try {
    await n.ask("initialize", { adapterID: "moth" });
    assert.match((await n.ask("launch", { program: file("prog.moth"), mothPath: join(sub, "no-moth-here") })).failed, /^there's no .*no-moth-here: install moth/);
  } finally {
    n.kill();
  }
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
    for (const name of ["sqlite.moth", "windows.moth", "linux.moth", "ui.moth", "tasks.moth", "system.moth", "game.moth", "sockets.moth", "cores.moth",
      "secrets.moth", "crypto.moth", "base64.moth", "http.moth", "server.moth", "zip.moth", "websocket.moth", "hash.moth", "email.moth", "dates.moth", "log.moth", "zones.moth"]) files[name] = readFileSync(new URL(`./tools/${name}`, import.meta.url), "utf8");
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
test("text.moth, dates.moth, hash.moth, base64.moth, toml.moth, options.moth, collections.moth, lists.moth, stats.moth, sync.moth, big.moth, fractions.moth, sets.moth, images.moth, crypto.moth, charts.moth, xml.moth, zip.moth and math.moth pass their own tests in machine code", { skip }, () => {
  const { dir, exe } = mothExe();
  const sub = join(dir, "text-and-dates");
  mkdirSync(sub);
  for (const name of ["text.moth", "text.test.moth", "dates.moth", "dates.test.moth", "hash.moth", "hash.test.moth", "big.moth", "big.test.moth",
    "xml.moth", "xml.test.moth", "zip.moth", "zip.test.moth", "base64.moth", "base64.test.moth", "toml.moth", "toml.test.moth", "options.moth",
    "options.test.moth", "collections.moth", "collections.test.moth", "lists.moth", "lists.test.moth", "stats.moth", "stats.test.moth", "sync.moth", "sync.test.moth", "fractions.moth", "fractions.test.moth", "sets.moth", "sets.test.moth", "images.moth", "images.test.moth", "crypto.moth", "crypto.test.moth", "charts.moth", "charts.test.moth",
    "secrets.moth"]) {
    writeFileSync(join(sub, name), readFileSync(new URL(`./tools/${name}`, import.meta.url), "utf8"));
  }
  for (const name of ["math.moth", "math.test.moth"]) writeFileSync(join(sub, name), readFileSync(new URL(`./${name}`, import.meta.url), "utf8"));
  const ran = spawnSync(exe, ["test", "text.test.moth", "dates.test.moth", "hash.test.moth", "big.test.moth", "xml.test.moth", "zip.test.moth", "math.test.moth",
    "base64.test.moth", "toml.test.moth", "options.test.moth", "collections.test.moth", "lists.test.moth", "stats.test.moth", "sync.test.moth", "fractions.test.moth", "sets.test.moth", "images.test.moth", "crypto.test.moth", "charts.test.moth"], { cwd: sub, encoding: "utf8", timeout: 300_000 });
  assert.deepEqual([ran.status, ran.stderr, ran.stdout.includes("✗")], [0, "", false], ran.stdout);
  assert.equal(ran.stdout.split("\n").at(-2), "93 passed");
});

// tools/arrays.moth (DESIGN §118): its own tests, in machine code, where machine code's own loops do the work and
// must give what Moth gives to the last bit
test("arrays.moth and ai.moth pass their own tests in machine code, where machine code's own loops do the work", { skip }, () => {
  const { dir, exe } = mothExe();
  const sub = join(dir, "arrays");
  mkdirSync(sub);
  for (const name of ["arrays.moth", "arrays.test.moth", "ai.moth", "ai.test.moth", "http.moth", "sockets.moth", "system.moth", "zip.moth"]) {
    writeFileSync(join(sub, name), readFileSync(new URL(`./tools/${name}`, import.meta.url), "utf8"));
  }
  writeFileSync(join(sub, "math.moth"), readFileSync(new URL("./math.moth", import.meta.url), "utf8"));
  const ran = spawnSync(exe, ["test", "arrays.test.moth", "ai.test.moth", "--allow-libraries"], { cwd: sub, encoding: "utf8", timeout: 300_000 });
  assert.deepEqual([ran.status, ran.stderr, ran.stdout.includes("✗")], [0, "", false], ran.stdout);
  assert.equal(ran.stdout.split("\n").at(-2), "13 passed");
});

// Moth's own library, which needs no --allow-libraries and isn't a library the program loads, and a list of
// numbers given to C as where its numbers are
test("a program uses Moth's own library without --allow-libraries, and gives C a list of numbers where they are", { skip }, () => {
  const own = libraryRun(`use the library "moth"
    numbers_reduce(a long whole number, a list of numbers, a list of numbers, a long whole number, a long whole number, a long whole number, a long whole number) gives a long whole number
end
set out to list of 0, 0
say numbers_reduce(1, out, (list of 1, 2, 3, 4, 5, 6), 2, 3, 1, 0) " " out
say numbers_reduce(1, out, (list of 1, 2, 3), 2, 3, 1, 0) " " out
say numbers_reduce(2, out, (list of 1, "x", 3), 1, 3, 1, 0)`, []);
  assert.deepEqual([own.stdout, own.stderr, own.status], ["0 [6, 15]\n1 [6, 15]\n1\n", "", 0]);
  if (target === "linux") assert.equal(own.bytes.includes(Buffer.from("libdl.so.2")), false, "Moth's own library isn't linked");
  const unknown = () => machine(`use the library "moth"
    numbers_nowhere(a list of numbers) gives a whole number
end
numbers_nowhere(list of 1)`, { target, name: "p.moth" });
  assert.throws(unknown, /the library 'moth' has no function called 'numbers_nowhere'/);
  const c = libraryRun(`use the library "msvcrt" or "c"
    memcpy(a list of numbers, a list of numbers, a long whole number) gives a pointer
    memset(a list of numbers, a whole number, a long whole number) gives a pointer
end
set to_here to list of 0, 0, 0
memcpy(to_here, (list of 1.5, -2, 1000000), 24)
say to_here
memset(to_here, 255, 16)
say (item 1 of to_here is not item 1 of to_here) " " (item 2 of to_here is not item 2 of to_here) " " item 3 of to_here
say item 1 of to_here + 1
memcpy(to_here, (list of 1, "two"), 16)`);
  assert.deepEqual([c.stdout, c.stderr.split("\n")[0], c.status], ["[1.5, -2, 1000000]\nyes yes 1000000\nNaN\n",
    "p.moth:2:5: 'memcpy' needs input 2 to be a list of numbers, not a list with text in it", 1]);
  assert.throws(() => machine('use the library "msvcrt"\n    f(a whole number) gives a list of numbers\nend\n', { target, name: "p.moth" }),
    (err) => err.reason === "a library's function can't give a list of numbers: only a function's input can be one");
});

// A library's function "at an address" (DESIGN §119): the first input is where the function is, a pointer C
// gave, as ONNX Runtime's C API gives a table of them
test("a library's function at an address is called where a pointer says it is", { skip }, () => {
  const finding = target === "windows" ? `use the library "kernel32"
    LoadLibraryW(wide text) gives a pointer
    GetProcAddress(a pointer, text) gives a pointer
end
to found with name
    return GetProcAddress(LoadLibraryW("msvcrt.dll"), name)
end` : `use the library "c"
    dlsym(a pointer, text) gives a pointer
end
to found with name
    return dlsym(nothing, name)
end`;
  const ran = libraryRun(`${finding}
use the library "msvcrt" or "c"
    "at an address" as call_abs(a pointer, a whole number) gives a whole number
    "at an address" as call_strlen(a pointer, text) gives a long whole number
end
say call_abs(found("abs"), -5) " " call_strlen(found("strlen"), "héllo")
call_abs(nothing, 1)`);
  assert.deepEqual([ran.stdout, ran.stderr.split("\n")[0], ran.status], ["5 6\n", `p.moth:${target === "windows" ? 9 : 8}:5: 'call_abs' needs input 1 to be where a function is, not nothing`, 1]);
  assert.throws(() => machine('use the library "c"\n    "at an address" as f(a whole number) gives a whole number\nend\nf(1)\n', { target, name: "p.moth" }),
    (err) => err.reason === "a function at an address takes where it is first, as a pointer");
  const refused = libraryRun(`${finding}
say found("abs")`, []);
  assert.match(refused.stderr, /this program isn't allowed to use libraries \(start it with --allow-libraries\)/);
});

// A small ONNX model, written byte by byte as protobuf: Y = Relu(X · W + B), X [batch, 3], W [3, 2], B [2], in
// floats (1) or doubles (11)
function onnxModel(type) {
  const varint = (n) => {
    const out = [];
    let v = BigInt(n);
    do {
      let b = Number(v & 0x7fn);
      v >>= 7n;
      if (v) b |= 0x80;
      out.push(b);
    } while (v);
    return out;
  };
  const int = (field, n) => [...varint(field << 3), ...varint(n)];
  const bytes = (field, b) => [...varint((field << 3) | 2), ...varint(b.length), ...b];
  const str = (field, s) => bytes(field, [...Buffer.from(s, "utf8")]);
  const raw = (values) => {
    const buf = Buffer.alloc(values.length * (type === 1 ? 4 : 8));
    values.forEach((v, i) => (type === 1 ? buf.writeFloatLE(v, i * 4) : buf.writeDoubleLE(v, i * 8)));
    return [...buf];
  };
  const tensor = (name, dims, values) => [...dims.flatMap((d) => int(1, d)), ...int(2, type), ...str(8, name), ...bytes(9, raw(values))];
  const dim = (d) => bytes(1, typeof d === "number" ? int(1, d) : str(2, d));
  const valueInfo = (name, dims) => [...str(1, name), ...bytes(2, bytes(1, [...int(1, type), ...bytes(2, dims.flatMap(dim))]))];
  const node = (inputs, outputs, op) => [...inputs.flatMap((i) => str(1, i)), ...outputs.flatMap((o) => str(2, o)), ...str(4, op)];
  const graph = [...bytes(1, node(["X", "W"], ["XW"], "MatMul")), ...bytes(1, node(["XW", "B"], ["Z"], "Add")), ...bytes(1, node(["Z"], ["Y"], "Relu")),
    ...str(2, "dense"), ...bytes(5, tensor("W", [3, 2], [1, -1, 0.5, 2, 2, 0.25])), ...bytes(5, tensor("B", [2], [0.5, 1])),
    ...bytes(11, valueInfo("X", ["batch", 3])), ...bytes(12, valueInfo("Y", ["batch", 2]))];
  return Buffer.from([...int(1, 7), ...str(2, "moth"), ...bytes(7, graph), ...bytes(8, [...str(1, ""), ...int(2, 13)])]);
}

// ONNX Runtime comes with Windows 11; on Linux, from its release, where the test looks for it
const onnxHere = target === "windows" ? existsSync(join(process.env.SystemRoot ?? "C:\\Windows", "System32", "onnxruntime.dll"))
  : ["/usr/lib/x86_64-linux-gnu", "/usr/lib64", "/usr/lib", "/usr/local/lib"].some((d) => existsSync(join(d, "libonnxruntime.so")) || existsSync(join(d, "libonnxruntime.so.1")));
test("tools/onnx.moth runs an ONNX model through ONNX Runtime's C API, in floats and in doubles", { skip: skip || (!onnxHere && "ONNX Runtime isn't installed") }, () => {
  const dir = mkdtempSync(join(tmpdir(), "moth-onnx-"));
  try {
    writeFileSync(join(dir, "dense.onnx"), onnxModel(1));
    writeFileSync(join(dir, "dense64.onnx"), onnxModel(11));
    const files = {};
    for (const name of ["onnx.moth", "arrays.moth"]) files[name] = readFileSync(new URL(`./tools/${name}`, import.meta.url), "utf8");
    files["math.moth"] = readFileSync(new URL("./math.moth", import.meta.url), "utf8");
    const exe = executable(dir, "p");
    writeFileSync(exe, machine(`use "onnx.moth" as onnx
use "arrays.moth" as arrays
say length of split onnx's version() by "."
for each file in list of "dense.onnx", "dense64.onnx"
    set model to onnx's load(file)
    say model
    for each put in onnx's inputs(model)
        say put's name " " put's type " " put's shape
    end
    for each put in onnx's outputs(model)
        say put's name " " put's type " " put's shape
    end
    set x to arrays's array(list of (list of 1, 2, 3), (list of 4, 5, 6), (list of -1, -1, -1))
    say item "Y" of onnx's run(model, dictionary where "X" is x)
    onnx's close(model)
end
set model to onnx's load("dense.onnx")
for each wrong in list of (dictionary where "Z" is 1), (dictionary where "X" is arrays's zeros(list of 2, 4))
    try
        onnx's run(model, wrong)
    if it fails with why
        say item 1 of split why by "\\n"
    end
end
try
    onnx's load("nowhere.onnx")
if it fails with why
    say "fails: " position of "nowhere.onnx" in why is greater than 0
end
`, { target, name: "p.moth", files, allow: ["--allow-libraries"] }));
    if (target === "linux") chmodSync(exe, 0o755);
    const ran = spawnSync(exe, [], { cwd: dir, encoding: "utf8" });
    assert.deepEqual([ran.stdout, ran.stderr, ran.status], [`3
an ONNX model (dense.onnx)
X float [-1, 3]
Y float [-1, 2]
[[8.5, 4.75], [19, 8.5], [0, 0]]
an ONNX model (dense64.onnx)
X double [-1, 3]
Y double [-1, 2]
[[8.5, 4.75], [19, 8.5], [0, 0]]
the model needs an input called 'X'
ONNX Runtime: Got invalid dimensions for input: X for the following indices
fails: yes
`, "", 0]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// BLAS for matmul: OpenBLAS as Linux has it, or NumPy's copy of it, which the test puts beside the program
function numpyBlas() {
  const asked = spawnSync("python", ["-E", "-c", "import numpy, os; print(os.path.dirname(numpy.__file__) + '.libs')"], { encoding: "utf8", cwd: tmpdir() });
  if (asked.error || asked.status !== 0) return null;
  const folder = asked.stdout.trim();
  const found = existsSync(folder) && readdirSync(folder).find((f) => /^libscipy_openblas64_.*\.dll$/.test(f));
  return found ? join(folder, found) : null;
}
const blasHere = target === "windows" ? numpyBlas()
  : ["/usr/lib/x86_64-linux-gnu", "/usr/lib64", "/usr/lib"].some((d) => existsSync(join(d, "libopenblas.so.0")) || existsSync(join(d, "libopenblas.so"))) && "system";
test("arrays.moth's matmul goes through BLAS once use_blas finds it, and gives what its own loops give", { skip: skip || (!blasHere && "OpenBLAS isn't installed (nor NumPy, which has a copy)") }, () => {
  const dir = mkdtempSync(join(tmpdir(), "moth-blas-"));
  try {
    if (target === "windows") copyFileSync(blasHere, join(dir, "libscipy_openblas64_.dll"));
    const files = { "arrays.moth": readFileSync(new URL("./tools/arrays.moth", import.meta.url), "utf8"), "math.moth": readFileSync(new URL("./math.moth", import.meta.url), "utf8") };
    const exe = executable(dir, "p");
    writeFileSync(exe, machine(`use "arrays.moth" as arrays
set p to arrays's random(list of 70, 50)
set q to arrays's random(list of 50, 30)
set own to arrays's matmul(p, q)
set found to arrays's use_blas()
say found is "openblas" or found is "openblas64"
set blas to arrays's matmul(p, q)
say arrays's close(own, blas, 0.000000001) " " blas's shape
say arrays's to_list(arrays's matmul(arrays's array(list of (list of 1, 2)), arrays's array(list of (list of 3), (list of 4))))
arrays's stop_using_blas()
say arrays's same(arrays's matmul(p, q), own)
`, { target, name: "p.moth", files, allow: ["--allow-libraries"] }));
    if (target === "linux") chmodSync(exe, 0o755);
    const ran = spawnSync(exe, [], { cwd: dir, encoding: "utf8" });
    assert.deepEqual([ran.stdout, ran.stderr, ran.status], ["yes\nyes [70, 30]\n[[11]]\nyes\n", "", 0]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// tools/python.moth: CPython inside the program, through its C API, from the Python this computer has
function pythonHere() {
  for (const command of ["python3", "python"]) {
    const asked = spawnSync(command, ["-E", "-c", "import sys, os, sysconfig\n" +
      "v = sys.version_info\n" +
      "if os.name == 'nt': print(os.path.join(sys.base_prefix, 'python%d%d.dll' % (v[0], v[1])))\n" +
      "else: print(os.path.join(sysconfig.get_config_var('LIBDIR') or '', sysconfig.get_config_var('INSTSONAME') or ''))\n" +
      "import importlib.util; print(importlib.util.find_spec('numpy') is not None)"], { encoding: "utf8", cwd: tmpdir() });
    if (asked.error || asked.status !== 0) continue;
    const [library, numpy] = asked.stdout.trim().split(/\r?\n/);
    if (existsSync(library)) return { library, numpy: numpy === "True" };
  }
  return null;
}
const python = target ? pythonHere() : null;
test("tools/python.moth runs Python inside the program: code, modules, values both ways, and Python's mistakes", { skip: skip || (!python && "Python's library isn't installed") }, () => {
  const dir = mkdtempSync(join(tmpdir(), "moth-python-"));
  try {
    const files = {};
    for (const name of ["python.moth", "arrays.moth"]) files[name] = readFileSync(new URL(`./tools/${name}`, import.meta.url), "utf8");
    files["math.moth"] = readFileSync(new URL("./math.moth", import.meta.url), "utf8");
    const exe = executable(dir, "p");
    writeFileSync(exe, machine(`use "python.moth" as python
use "arrays.moth" as arrays
say python's start() is not nothing
python's run("import math\\nx = math.factorial(10)")
say python's evaluate("x // 3")
set math to python's import_module("math")
say math
say python's call(math, "sqrt", list of 2) " " python's call_object(python's attribute(math, "hypot"), list of 3, 4)
say python's evaluate("[1, 'two', None, True, False, 2.5, (3, 4), {'a': [1]}, 2 ** 70]")
python's set_variable("given", list of 3, "x", nothing, yes, 1.5, (dictionary where "k" is list of 1, 2))
say python's evaluate("repr(given)")
say python's evaluate("given[5]['k'][1] * 10")
say python's variable("x")
say python's evaluate("'héllo ' + chr(0x1F600)")
set held to python's to_python(list of 1, 2)
say python's call(held, "count", list of 2) " " python's from_python(held)
python's release(held)
for each code in list of "1 / 0", "undefined_name", "int('x')"
    try
        python's evaluate(code)
    if it fails with why
        say why
    end
end
try
    python's run("raise ValueError('bad thing')")
if it fails with why
    say why
end
try
    python's import_module("no_such_module_here")
if it fails with why
    say why
end
try
    python's call(5, "x")
if it fails with why
    say why
end
if python's evaluate("__import__('importlib.util').util.find_spec('numpy') is not None")
    set np to python's import_module("numpy")
    say python's call(np, "linspace", list of 0, 1, 5)
    say python's call(np, "round", (list of 2.567), dictionary where "decimals" is 1)
    python's set_variable("a", arrays's array(list of (list of 1, 2), (list of 3, 4)))
    say python's evaluate("a.T @ a") " " python's evaluate("str(a.dtype)")
    say python's evaluate("__import__('numpy').array(['a', 'b'])")
end
`, { target, name: "p.moth", files, allow: ["--allow-libraries"] }));
    if (target === "linux") chmodSync(exe, 0o755);
    const ran = spawnSync(exe, [], { cwd: dir, encoding: "utf8", env: { ...process.env, PYTHON_LIBRARY: python.library } });
    const numpy = python.numpy ? "[0, 0.25, 0.5, 0.75, 1]\n2.6\n[[10, 14], [14, 20]] float64\n[\"a\", \"b\"]\n" : "";
    assert.deepEqual([ran.stdout, ran.stderr, ran.status], [`yes
1209600
<python <module 'math' (built-in)>>
1.4142135623731 5
[1, "two", nothing, yes, no, 2.5, [3, 4], (dictionary where "a" is [1]), 1.1805916207174113e+21]
[3, 'x', None, True, 1.5, {'k': [1, 2]}]
20
3628800
héllo 😀
1 [1, 2]
Python: ZeroDivisionError: division by zero
Python: NameError: name 'undefined_name' is not defined
Python: ValueError: invalid literal for int() with base 10: 'x'
Python: ValueError: bad thing
Python: ModuleNotFoundError: No module named 'no_such_module_here'
'call' needs a Python object (as import_module gives), not a number
${numpy}`, "", 0]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// tools/ai.moth (DESIGN §121), against a server of the test's own that answers as Anthropic's Messages API and
// OpenAI's chat completions and embeddings do: plain and streamed answers (server-sent events, in chunks),
// tools, JSON, embeddings, and the APIs' mistakes. The keys are made up, and only ever in the environment.
async function aiMock() {
  const seen = [];
  const vocabulary = ["moth", "night", "bee", "day", "fly"];
  const embedding = (text) => vocabulary.map((w) => text.toLowerCase().split(w).length - 1);
  const lastUser = (messages) => [...messages].reverse().find((m) => m.role === "user" || m.role === "tool");
  const pieces = (text) => text.match(/.{1,5}/gsu);
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const sent = body ? JSON.parse(body) : {};
      seen.push({ url: req.url, headers: req.headers, body: sent });
      const json = (status, value) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(value));
      };
      const events = (list, openai) => {
        res.writeHead(200, { "content-type": "text/event-stream" });
        for (const [name, data] of list) res.write(openai ? `data: ${JSON.stringify(data)}\n\n` : `event: ${name}\ndata: ${JSON.stringify(data)}\r\n\r\n`);
        if (openai) res.write("data: [DONE]\n\n");
        res.end();
      };
      if (req.url === "/v1/messages") {
        if (req.headers["x-api-key"] !== "test-key-not-real" || req.headers["anthropic-version"] !== "2026-10-21")
          return json(401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } });
        const last = lastUser(sent.messages);
        const result = Array.isArray(last.content) && last.content.find((b) => b.type === "tool_result");
        let content;
        let stop = "end_turn";
        if (sent.tools && !result) {
          content = [{ type: "text", text: "Let me check." }, { type: "tool_use", id: "toolu_1", name: sent.tools[0].name, input: { city: "Paris" } }];
          stop = "tool_use";
        } else if (result) content = [{ type: "text", text: `The tool said: ${result.content}${result.is_error ? " (an error)" : ""}` }];
        else if (sent.output_config?.format) content = [{ type: "text", text: '{"name": "Luna moth", "wingspan": 114}' }];
        else content = [{ type: "text", text: `You said: ${typeof last.content === "string" ? last.content : last.content[0].text}${sent.system ? ` [${sent.system}]` : ""}` }];
        if (!sent.stream) return json(200, { id: "msg_1", type: "message", role: "assistant", model: sent.model, content, stop_reason: stop, usage: { input_tokens: 11, output_tokens: 7 } });
        const list = [["message_start", { type: "message_start", message: { id: "msg_1", model: sent.model, content: [], usage: { input_tokens: 11, output_tokens: 1 } } }]];
        content.forEach((block, index) => {
          if (block.type === "text") {
            list.push(["content_block_start", { type: "content_block_start", index, content_block: { type: "text", text: "" } }]);
            for (const piece of pieces(block.text)) list.push(["content_block_delta", { type: "content_block_delta", index, delta: { type: "text_delta", text: piece } }]);
          } else {
            list.push(["content_block_start", { type: "content_block_start", index, content_block: { type: "tool_use", id: block.id, name: block.name, input: {} } }]);
            const written = JSON.stringify(block.input);
            list.push(["content_block_delta", { type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: written.slice(0, 4) } }]);
            list.push(["content_block_delta", { type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: written.slice(4) } }]);
          }
          list.push(["content_block_stop", { type: "content_block_stop", index }]);
        });
        list.push(["ping", { type: "ping" }], ["message_delta", { type: "message_delta", delta: { stop_reason: stop }, usage: { output_tokens: 7 } }], ["message_stop", { type: "message_stop" }]);
        return events(list, false);
      }
      if (req.url === "/v1/chat/completions" || req.url === "/v1/embeddings") {
        const keyless = sent.model === "local-model" && !("authorization" in req.headers); // a local server, which wants none
        if (!keyless && req.headers.authorization !== "Bearer test-openai-key") return json(401, { error: { message: "Incorrect API key provided", type: "invalid_request_error" } });
        if (req.url === "/v1/embeddings") return json(200, { data: sent.input.map((t, index) => ({ index, embedding: embedding(t) })).reverse(), model: sent.model });
        const last = lastUser(sent.messages);
        const system = sent.messages[0].role === "system" ? ` [${sent.messages[0].content}]` : "";
        let message;
        let finish = "stop";
        if (sent.tools && last.role !== "tool") {
          message = { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: sent.tools[0].function.name, arguments: '{"city": "Paris"}' } }] };
          finish = "tool_calls";
        } else if (last.role === "tool") message = { role: "assistant", content: `The tool said: ${last.content}` };
        else if (sent.response_format) message = { role: "assistant", content: '{"name": "Luna moth", "wingspan": 114}' };
        else message = { role: "assistant", content: `You said: ${last.content}${system}` };
        if (!sent.stream) return json(200, { model: sent.model, choices: [{ index: 0, message, finish_reason: finish }], usage: { prompt_tokens: 5, completion_tokens: 3 } });
        const list = [];
        if (message.content) for (const piece of pieces(message.content)) list.push(["", { choices: [{ index: 0, delta: { content: piece }, finish_reason: null }] }]);
        if (message.tool_calls) {
          const call = message.tool_calls[0];
          list.push(["", { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: call.id, type: "function", function: { name: call.function.name, arguments: "" } }] } }] }]);
          list.push(["", { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: call.function.arguments.slice(0, 6) } }] } }] }]);
          list.push(["", { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: call.function.arguments.slice(6) } }] } }] }]);
        }
        list.push(["", { choices: [{ index: 0, delta: {}, finish_reason: finish }] }], ["", { choices: [], usage: { prompt_tokens: 5, completion_tokens: 3 } }]);
        return events(list, true);
      }
      json(404, { error: { message: "no such page" } });
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, seen, base: `http://127.0.0.1:${server.address().port}` };
}

const AI_PROGRAM = `use "ai.moth" as ai
use "system.moth" as system
set base to system's environment("MOCK_BASE")
set claude to ai's anthropic("claude-opus-5-5", dictionary where "base_url" is base)
say claude
say ai's answer(claude, "Name a moth.")
set reply to ai's chat(claude, (list of (record with role "user", content "Hi")), dictionary where "system" is "Be brief.")
say reply's text " | " reply's stop_reason " | " reply's usage's input_tokens " " reply's usage's output_tokens " | " reply's model
set pieces to empty list
to keep_piece with piece
    add piece to pieces
end
set streamed to ai's stream(claude, "Write a haiku.", keep_piece)
say length of pieces " pieces: " join pieces with "|"
say streamed's text " | " streamed's stop_reason " | " streamed's usage's output_tokens
to weather_in with input
    return "sunny in " + item "city" of input
end
set weather to ai's tool("get_weather", "The weather in a city", (dictionary where "type" is "object", "properties" is (dictionary where "city" is dictionary where "type" is "string")), weather_in)
say ai's chat_with_tools(claude, "Is it sunny in Paris?", list of weather)'s text
to broken with input
    fail with "no weather today"
end
say ai's chat_with_tools(claude, "Is it sunny in Paris?", list of ai's tool("get_weather", "The weather", empty dictionary, broken))'s text
set first_turn to ai's stream(claude, "Is it sunny?", keep_piece, dictionary where "tools" is list of weather)
say first_turn's stop_reason " " first_turn's tool_calls
say ai's answer_json(claude, "A moth", dictionary where "type" is "object")
set gpt to ai's openai("gpt-test", dictionary where "base_url" is base + "/v1")
say gpt " " ai's answer(gpt, "Hello there", "Be kind.")
set pieces to empty list
set streamed to ai's stream(gpt, "Stream this", keep_piece)
say join pieces with "|"
say streamed's text " | " streamed's stop_reason " | " streamed's usage's input_tokens
say ai's chat_with_tools(gpt, "Is it sunny in Paris?", list of weather)'s text
set gpt_turn to ai's stream(gpt, "Is it sunny?", keep_piece, dictionary where "tools" is list of weather)
say gpt_turn's stop_reason " " gpt_turn's tool_calls
say ai's answer_json(gpt, "A moth", dictionary where "type" is "object")
set texts to list of "moths fly at night", "bees fly by day", "a moth at night, a moth"
set embedded to ai's embed(gpt, texts)
say embedded
set index to ai's vectors()
ai's add_vector(index, texts, embedded)
for each found in ai's search(index, ai's embed(gpt, "night moth"), 2)
    say found's key " " found's score with 3 decimals
end
say ai's answer(ai's openai_compatible(base + "/v1", "local-model"), "Hi, with no key")
say ai's answer(ai's openai_compatible(base + "/v1", "gpt-test", yes), "Hi, with a key")
try
    ai's embed(claude, "x")
if it fails with why
    say why
end
`;

// the keys: a wrong one, as the API says, or none, as ai.moth says, for each client
const AI_KEYS_PROGRAM = `use "ai.moth" as ai
use "system.moth" as system
set base to system's environment("MOCK_BASE")
to ignore with piece
end
set claude to ai's anthropic("claude-opus-5-5", dictionary where "base_url" is base)
for each attempt in list of 1, 2
    try
        if attempt is 1
            ai's answer(claude, "x")
        else
            ai's stream(claude, "x", ignore)
        end
    if it fails with why
        say why
    end
end
for each gpt in list of (ai's openai("gpt-test", dictionary where "base_url" is base + "/v1")), (ai's openai_compatible(base + "/v1", "gpt-test", yes))
    try
        ai's answer(gpt, "x")
    if it fails with why
        say why
    end
end
say ai's answer(ai's openai_compatible(base + "/v1", "local-model"), "no key needed")
`;

function runAi(exe, cwd, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, [], { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let [stdout, stderr] = ["", ""];
    child.stdout.setEncoding("utf8").on("data", (d) => (stdout += d));
    child.stderr.setEncoding("utf8").on("data", (d) => (stderr += d));
    const timer = setTimeout(() => child.kill(), 120_000);
    child.on("error", reject);
    child.on("close", (status) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, status });
    });
  });
}

test("tools/ai.moth talks to Anthropic's and OpenAI's APIs: answers, streams, tools, JSON and embeddings", { skip }, async () => {
  const { server, seen, base } = await aiMock();
  const dir = mkdtempSync(join(tmpdir(), "moth-ai-"));
  try {
    const files = {};
    for (const name of ["ai.moth", "http.moth", "sockets.moth", "system.moth", "zip.moth", "arrays.moth"]) files[name] = readFileSync(new URL(`./tools/${name}`, import.meta.url), "utf8");
    files["math.moth"] = readFileSync(new URL("./math.moth", import.meta.url), "utf8");
    const exe = executable(dir, "p");
    writeFileSync(exe, machine(AI_PROGRAM, { target, name: "p.moth", files, allow: ["--allow-libraries", "--allow-net"] }));
    if (target === "linux") chmodSync(exe, 0o755);
    const ran = await runAi(exe, dir, { ...process.env, MOCK_BASE: base, ANTHROPIC_API_KEY: "test-key-not-real", OPENAI_API_KEY: "test-openai-key" });
    assert.deepEqual([ran.stdout, ran.stderr, ran.status], [`an Anthropic client (claude-opus-5-5)
You said: Name a moth.
You said: Hi [Be brief.] | end_turn | 11 7 | claude-opus-5-5
5 pieces: You s|aid: |Write| a ha|iku.
You said: Write a haiku. | end_turn | 7
The tool said: sunny in Paris
The tool said: no weather today (an error)
tool_use [(record with id "toolu_1", name "get_weather", input (dictionary where "city" is "Paris"))]
(dictionary where "name" is "Luna moth", "wingspan" is 114)
an OpenAI client (gpt-test) You said: Hello there [Be kind.]
You s|aid: |Strea|m thi|s
You said: Stream this | stop | 5
The tool said: sunny in Paris
tool_calls [(record with id "call_1", name "get_weather", input (dictionary where "city" is "Paris"))]
(dictionary where "name" is "Luna moth", "wingspan" is 114)
[[1, 1, 0, 0, 1], [0, 0, 1, 1, 1], [2, 1, 0, 0, 0]]
a moth at night, a moth 0.949
moths fly at night 0.816
You said: Hi, with no key
You said: Hi, with a key
Anthropic's API has no embeddings: use openai_compatible() with a server that has them, as Voyage AI, OpenAI or Ollama
`, "", 0]);
    // what was sent: the first request as the Messages API wants it (no fallbacks to a server that isn't
    // Anthropic's), a stream's tools streamed eagerly, and a tool's result sent back after the model's turn
    const first = seen[0];
    assert.deepEqual([first.url, first.headers["content-type"], first.body], ["/v1/messages", "application/json",
      { model: "claude-opus-5-5", max_tokens: 16000, messages: [{ role: "user", content: "Name a moth." }] }]);
    const streamedTools = seen.find((s) => s.body.stream && s.body.tools && s.url === "/v1/messages");
    assert.deepEqual([streamedTools.body.max_tokens, streamedTools.body.tools[0].eager_input_streaming, streamedTools.headers.accept], [64000, true, "text/event-stream"]);
    const toolRound = seen.find((s) => s.url === "/v1/messages" && s.body.messages.length === 3);
    assert.deepEqual(toolRound.body.messages.map((m) => m.role), ["user", "assistant", "user"]);
    assert.deepEqual(toolRound.body.messages[2].content, [{ type: "tool_result", tool_use_id: "toolu_1", content: "sunny in Paris" }]);
    const openaiRound = seen.find((s) => s.url === "/v1/chat/completions" && s.body.messages.some((m) => m.role === "tool"));
    assert.deepEqual(openaiRound.body.messages.at(-1), { role: "tool", tool_call_id: "call_1", content: "sunny in Paris" });
    assert.ok(seen.every((s) => !/test-key-not-real|test-openai-key/.test(JSON.stringify(s.body))), "no key in a request's body");
    // each key goes only to its own API, and none to a server that wants none
    assert.ok(seen.every((s) => (s.url === "/v1/messages" ? !("authorization" in s.headers) : !("x-api-key" in s.headers))), "a key went to the other API");
    assert.equal(seen.find((s) => s.body.model === "local-model").headers.authorization, undefined);
    assert.equal(seen.filter((s) => s.body.model === "gpt-test").at(-1).headers.authorization, "Bearer test-openai-key");
    // a wrong key, and none
    const keys = executable(dir, "keys");
    writeFileSync(keys, machine(AI_KEYS_PROGRAM, { target, name: "keys.moth", files, allow: ["--allow-libraries", "--allow-net"] }));
    if (target === "linux") chmodSync(keys, 0o755);
    const without = { ...process.env, MOCK_BASE: base };
    delete without.ANTHROPIC_API_KEY;
    delete without.OPENAI_API_KEY;
    const wrong = await runAi(keys, dir, { ...without, ANTHROPIC_API_KEY: "not-the-key" });
    assert.deepEqual([wrong.stdout, wrong.stderr, wrong.status], [`Anthropic said 401: authentication_error: invalid x-api-key
Anthropic said 401: authentication_error: invalid x-api-key
set OPENAI_API_KEY to your API key for OpenAI
set OPENAI_API_KEY to your API key for OpenAI
You said: no key needed
`, "", 0]);
    const none = await runAi(keys, dir, { ...without, ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "not-the-key" });
    assert.deepEqual([none.stdout, none.stderr, none.status], [`set ANTHROPIC_API_KEY to your API key for Anthropic
set ANTHROPIC_API_KEY to your API key for Anthropic
OpenAI said 401: invalid_request_error: Incorrect API key provided
OpenAI said 401: invalid_request_error: Incorrect API key provided
You said: no key needed
`, "", 0]);
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// The company libraries (DESIGN §110-§117): yaml.moth, jwt.moth, s3.moth, oauth.moth, redis.moth, postgres.moth,
// mysql.moth and wire.moth: their own tests, run by moth.exe's test runner, in machine code; --allow-libraries for
// those that ask the system for randomness or the time
const COMPANY_TESTS = ["yaml", "jwt", "s3", "oauth", "redis", "postgres", "mysql", "wire"].map((name) => `${name}.test.moth`);
test("yaml.moth, jwt.moth, s3.moth, oauth.moth, redis.moth, postgres.moth, mysql.moth and wire.moth pass their own tests in machine code", { skip }, () => {
  const { dir, exe } = mothExe();
  const sub = join(dir, "company");
  mkdirSync(sub);
  for (const name of readdirSync(new URL("./tools/", import.meta.url)).filter((f) => f.endsWith(".moth"))) writeFileSync(join(sub, name), readFileSync(new URL(`./tools/${name}`, import.meta.url)));
  const ran = spawnSync(exe, ["test", ...COMPANY_TESTS, "--allow-libraries"], { cwd: sub, encoding: "utf8", timeout: 300_000 });
  assert.deepEqual([ran.status, ran.stderr, ran.stdout.includes("✗")], [0, "", false], ran.stdout);
  assert.equal(ran.stdout.split("\n").at(-2), "44 passed");
});

// A program of the company libraries' built with --allow-libraries, every file in tools/ there for it to use,
// and run with these arguments: what it said, as lines, and the rest of what spawnSync says
function companyRun(source, args) {
  const dir = mkdtempSync(join(tmpdir(), "moth-company-"));
  try {
    const files = {};
    for (const name of readdirSync(new URL("./tools/", import.meta.url)).filter((f) => f.endsWith(".moth"))) files[name] = readFileSync(new URL(`./tools/${name}`, import.meta.url), "utf8");
    const exe = executable(dir, "p");
    writeFileSync(exe, machine(source, { target, name: "p.moth", allow: ["--allow-libraries"], files }));
    if (target === "linux") chmodSync(exe, 0o755);
    const ran = spawnSync(exe, args, { cwd: dir, encoding: "utf8", timeout: 180_000 });
    return { ...ran, lines: ran.stdout.split("\n").slice(0, -1) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// The live tests: a real server, where the environment says where one is (CI starts each in a container, as
// .github/workflows/test.yml has them; on another computer, docker run them and set these), else skipped:
// MOTH_POSTGRES_URL postgres://moth:moth-test@127.0.0.1:5432/moth (a superuser, its host's logins md5 or scram)
// MOTH_MYSQL_URL mysql://root:moth-root@127.0.0.1:3306/moth (MySQL 8.4, started with --mysql-native-password=ON)
// MOTH_REDIS_URL redis://127.0.0.1:6379 (Redis 6 or later, for its ACL users)
// MOTH_S3_URL http://moth-test-key:moth-test-secret@127.0.0.1:9000 (MinIO, its root user's key and secret)
const live = (name) => skip || (!process.env[name] && `no server here: set ${name} to test against one`);

// tools/postgres.moth against PostgreSQL: SCRAM-SHA-256, then a user whose password is kept as MD5; every kind of
// value both ways, a name that would be SQL if it were pasted in, 5000 rows, a transaction rolled back and one
// committed, the server's errors, a password it won't take, and TLS required of a server that hasn't it
test("tools/postgres.moth queries a real PostgreSQL, with parameters, types and transactions", { skip: live("MOTH_POSTGRES_URL") }, () => {
  const ran = companyRun(String.raw`use "postgres.moth" as pg

set url to item 1 of arguments
set db to pg's connect_url(url)
say pg's transaction_status(db)
pg's run_script(db, "drop table if exists moth_people; create table moth_people (id serial primary key, name text not null, age int, score double precision, ok boolean, data bytea, doc jsonb, tags text[], born date, price numeric(10, 2))")
set sql to "insert into moth_people (name, age, score, ok, data, doc, tags, born, price) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)"
say pg's execute(db, sql, list of "Sam", 20, 1.5, yes, (list of 0, 255, 10) as bytes, (dictionary where "pets" is (list of "cat")), "\{a,\"b c\"}", "2006-01-02", 12.5)
say pg's execute(db, sql, list of "Robert'); drop table moth_people; --", nothing, nothing, no, nothing, nothing, nothing, nothing, nothing)
say pg's execute(db, sql, list of "Zoë 😀", -7, -0.25, nothing, 0 bytes, (list of 1, "two"), "\{}", nothing, 99999999.99)
for each row in pg's query(db, "select name, age, score, ok, data, doc, tags, born, price from moth_people order by id")
    say row
end
say pg's query_one(db, "select count(*) as n, sum(age) as total from moth_people where name like $1", list of "%o%")
say pg's query_one(db, "select 1 where false")
set many to pg's query(db, "select g, g * 2 as twice from generate_series(1, 5000) as g")
set total to 0
for each row in many
    set total to total + item "twice" of row
end
say length of many " " total
# a transaction that fails: rolled back, and its mistake said again
to failing with db
    pg's execute(db, "delete from moth_people")
    pg's execute(db, "insert into nowhere values (1)")
end
try
    pg's in_transaction(db, failing)
if it fails with why
    say why
end
say pg's query_one(db, "select count(*) as n from moth_people") " " pg's transaction_status(db)
to adding with db
    pg's execute(db, "insert into moth_people (name) values ($1)", list of "Ana")
    return "added"
end
say pg's in_transaction(db, adding)
say pg's query_one(db, "select count(*) as n from moth_people")
try
    pg's execute(db, "insert into moth_people (id, name) values ($1, $2)", list of 1, "again")
if it fails with why
    say why
end
say pg's query_one(db, "select $1::int + 1 as n, $2::text as t, $3::float8 as f, $4::bool as b, $5::numeric as big", list of 41, "x", 0.1, no, 12345678901234)
pg's run_script(db, "drop table moth_people")
# a user whose password is kept as MD5, which logs in the MD5 way
pg's run_script(db, "drop role if exists moth_md5; set password_encryption = 'md5'; create role moth_md5 login password 'md5-test'")
set parts to pg's pg_url_options(url)
set item "user" of parts to "moth_md5"
set item "password" of parts to "md5-test"
set md5_db to pg's connect(parts)
say pg's query_one(md5_db, "select current_user as who")
pg's close(md5_db)
set item "password" of parts to "wrong"
try
    pg's connect(parts)
if it fails with why
    say why
end
pg's run_script(db, "drop role moth_md5")
set item "tls" of parts to "require"
try
    pg's connect(parts)
if it fails with why
    say why
end
pg's close(db)
say "done"
`, [process.env.MOTH_POSTGRES_URL]);
  assert.deepEqual([ran.stderr, ran.status], ["", 0], ran.stdout);
  assert.deepEqual(ran.lines, [
    "I",
    "1",
    "1",
    "1",
    "(dictionary where \"name\" is \"Sam\", \"age\" is 20, \"score\" is 1.5, \"ok\" is yes, \"data\" is (3 bytes: 0, 255, 10), \"doc\" is (dictionary where \"pets\" is [\"cat\"]), \"tags\" is [\"a\", \"b c\"], \"born\" is \"2006-01-02\", \"price\" is 12.5)",
    "(dictionary where \"name\" is \"Robert'); drop table moth_people; --\", \"age\" is nothing, \"score\" is nothing, \"ok\" is no, \"data\" is nothing, \"doc\" is nothing, \"tags\" is nothing, \"born\" is nothing, \"price\" is nothing)",
    "(dictionary where \"name\" is \"Zoë 😀\", \"age\" is -7, \"score\" is -0.25, \"ok\" is nothing, \"data\" is (0 bytes), \"doc\" is [1, \"two\"], \"tags\" is [], \"born\" is nothing, \"price\" is 99999999.99)",
    "(dictionary where \"n\" is 2, \"total\" is -7)",
    "nothing",
    "5000 25005000",
    "PostgreSQL said: relation \"nowhere\" does not exist (42P01)",
    "(dictionary where \"n\" is 3) I",
    "added",
    "(dictionary where \"n\" is 4)",
    "PostgreSQL said: duplicate key value violates unique constraint \"moth_people_pkey\" (23505). Key (id)=(1) already exists.",
    "(dictionary where \"n\" is 42, \"t\" is \"x\", \"f\" is 0.1, \"b\" is no, \"big\" is 12345678901234)",
    "(dictionary where \"who\" is \"moth_md5\")",
    "PostgreSQL said: password authentication failed for user \"moth_md5\" (28P01)",
    "the PostgreSQL server at 127.0.0.1 has no TLS, and tls is \"require\"",
    "done",
  ]);
});

// tools/mysql.moth against MySQL 8.4: caching_sha2_password the full way, its password sent RSA-encrypted (TLS
// is "prefer", and the server's certificate is its own, which can't be checked), then the fast way; every kind
// of value both ways, by prepared statements and as text; errors; a mysql_native_password user and a
// sha256_password user (a server without the plugin skips it); users that aren't there, whom the server gives a
// plugin at random, refused all the same; and TLS required of a certificate it can't check
test("tools/mysql.moth queries a real MySQL, with prepared statements, types and transactions", { skip: live("MOTH_MYSQL_URL") }, () => {
  const ran = companyRun(String.raw`use "mysql.moth" as mysql

set url to item 1 of arguments
set db to mysql's connect_url(url)
say "connected, secure: " secure of db
mysql's run_script(db, "drop table if exists moth_people; create table moth_people (id int auto_increment primary key, name varchar(100) not null, age int, score double, small float, ok boolean, data blob, doc json, born date, at datetime(6), dur time, price decimal(10, 2), big bigint unsigned) character set utf8mb4")
set sql to "insert into moth_people (name, age, score, small, ok, data, doc, born, at, dur, price, big) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
set done to mysql's run(db, sql, list of "Sam", 20, 1.5, 0.5, yes, (list of 0, 255, 10) as bytes, (dictionary where "pets" is (list of "cat")), "2006-01-02", "2026-11-04 10:15:00.25", "-26:03:04", 12.5, 9007199254740991)
say count of done " " last_id of done
say mysql's execute(db, sql, list of "Robert'); drop table moth_people; --", nothing, nothing, nothing, no, nothing, nothing, nothing, nothing, nothing, nothing, nothing)
say mysql's execute(db, sql, list of "Zoë 😀", -7, -0.25, nothing, nothing, 0 bytes, (list of 1, "two"), nothing, nothing, "12:30:00", 99999999.99, 0)
for each row in mysql's query(db, "select name, age, score, small, ok, data, doc, born, at, dur, price, big from moth_people order by id")
    say row
end
say mysql's query_one(db, "select count(*) as n, sum(age) as total from moth_people where name like ?", list of "%o%")
say mysql's query_one(db, "select 1 from dual where false")
say mysql's run_script(db, "select id, name from moth_people where id = 1")
mysql's run_script(db, "drop table if exists moth_many; create table moth_many (n int)")
mysql's run_script(db, "insert into moth_many (n) with recursive seq (n) as (select 1 union all select n + 1 from seq where n < 1000) select n from seq")
set many to mysql's query(db, "select n, n * 2 as twice from moth_many")
set total to 0
for each row in many
    set total to total + item "twice" of row
end
say length of many " " total
to failing with db
    mysql's execute(db, "delete from moth_people")
    mysql's execute(db, "insert into nowhere values (1)")
end
try
    mysql's in_transaction(db, failing)
if it fails with why
    say why
end
say mysql's query_one(db, "select count(*) as n from moth_people")
try
    mysql's execute(db, "insert into moth_people (id, name) values (?, ?)", list of 1, "again")
if it fails with why
    say why
end
try
    mysql's execute(db, "select ? + ?", list of 1)
if it fails with why
    say why
end
mysql's run_script(db, "drop table moth_people; drop table moth_many")
# a user of mysql_native_password, where the server has it
set native to yes
try
    mysql's run_script(db, "drop user if exists 'moth_native'@'%'; create user 'moth_native'@'%' identified with mysql_native_password by 'native-test'")
if it fails
    set native to no
end
set parts to mysql's my_url_options(url)
if native
    set item "user" of parts to "moth_native"
    set item "password" of parts to "native-test"
    set item "database" of parts to nothing
    set native_db to mysql's connect(parts)
    say mysql's query_one(native_db, "select current_user() as who")
    mysql's close(native_db)
    mysql's run_script(db, "drop user 'moth_native'@'%'")
else
    say "mysql_native_password: not on this server"
end
# a user of sha256_password, where the server has it: its password RSA-encrypted, as there's no TLS
set sha256 to yes
try
    mysql's run_script(db, "drop user if exists 'moth_sha256'@'%'; create user 'moth_sha256'@'%' identified with sha256_password by 'sha256-test'")
if it fails
    set sha256 to no
end
if sha256
    set item "user" of parts to "moth_sha256"
    set item "password" of parts to "sha256-test"
    set item "database" of parts to nothing
    set sha256_db to mysql's connect(parts)
    say mysql's query_one(sha256_db, "select current_user() as who")
    mysql's close(sha256_db)
    mysql's run_script(db, "drop user 'moth_sha256'@'%'")
else
    say "sha256_password: not on this server"
end
# users that aren't there: the server gives each a plugin at random, so it can't be told from one that is
for each k from 1 to 6
    set item "user" of parts to "nobody" + k
    set item "password" of parts to "wrong"
    try
        mysql's connect(parts)
    if it fails with why
        say item 1 of split why by "@"
    end
end
set item "user" of parts to "root"
set item "tls" of parts to "require"
try
    mysql's connect(parts)
if it fails
    say "TLS required, and the server's certificate can't be checked: refused"
end
mysql's close(db)
say "done"
`, [process.env.MOTH_MYSQL_URL]);
  assert.deepEqual([ran.stderr, ran.status], ["", 0], ran.stdout);
  const native = '(dictionary where "who" is "moth_native@%")';
  const sha256 = '(dictionary where "who" is "moth_sha256@%")';
  const missing = { "mysql_native_password: not on this server": native, "sha256_password: not on this server": sha256 };
  assert.deepEqual(ran.lines.map((line) => missing[line] ?? line), [
    "connected, secure: no",
    "1 1",
    "1",
    "1",
    "(dictionary where \"name\" is \"Sam\", \"age\" is 20, \"score\" is 1.5, \"small\" is 0.5, \"ok\" is 1, \"data\" is (3 bytes: 0, 255, 10), \"doc\" is (dictionary where \"pets\" is [\"cat\"]), \"born\" is \"2006-01-02\", \"at\" is \"2026-11-04 10:15:00.250000\", \"dur\" is \"-26:03:04\", \"price\" is 12.5, \"big\" is 9007199254740991)",
    "(dictionary where \"name\" is \"Robert'); drop table moth_people; --\", \"age\" is nothing, \"score\" is nothing, \"small\" is nothing, \"ok\" is 0, \"data\" is nothing, \"doc\" is nothing, \"born\" is nothing, \"at\" is nothing, \"dur\" is nothing, \"price\" is nothing, \"big\" is nothing)",
    "(dictionary where \"name\" is \"Zoë 😀\", \"age\" is -7, \"score\" is -0.25, \"small\" is nothing, \"ok\" is nothing, \"data\" is (0 bytes), \"doc\" is [1, \"two\"], \"born\" is nothing, \"at\" is nothing, \"dur\" is \"12:30:00\", \"price\" is 99999999.99, \"big\" is 0)",
    "(dictionary where \"n\" is 2, \"total\" is -7)",
    "nothing",
    "(record with rows [(dictionary where \"id\" is 1, \"name\" is \"Sam\")], count 1, columns [\"id\", \"name\"], last_id 0)",
    "1000 1001000",
    "MySQL said: Table 'moth.nowhere' doesn't exist (1146, 42S02)",
    "(dictionary where \"n\" is 3)",
    "MySQL said: Duplicate entry '1' for key 'moth_people.PRIMARY' (1062, 23000)",
    "the SQL has 2 ?s, and 1 values were given",
    "(dictionary where \"who\" is \"moth_native@%\")",
    "(dictionary where \"who\" is \"moth_sha256@%\")",
    ...[1, 2, 3, 4, 5, 6].map((k) => `MySQL said: Access denied for user 'nobody${k}'`),
    "TLS required, and the server's certificate can't be checked: refused",
    "done",
  ]);
});

// tools/redis.moth against Redis: an ACL user of its own logging in, values that end, numbers, lists, hashes,
// bytes, 100 commands pipelined, MULTI and EXEC, SCAN, errors, publishing to a subscriber (by channel and by
// pattern, and waiting for none in time), RESP3, and a password it won't take
test("tools/redis.moth runs commands on a real Redis, pipelined, subscribed, and in RESP3", { skip: live("MOTH_REDIS_URL") }, () => {
  const ran = companyRun(String.raw`use "redis.moth" as redis

set url to item 1 of arguments
set admin to redis's connect_url(url)
redis's command(admin, list of "ACL", "SETUSER", "moth_test", "on", ">moth-test", "~*", "&*", "+@all")
set parts to redis's redis_url(url)
set r to redis's connect_url("redis://moth_test:moth-test@" + host of parts + ":" + port of parts + "/1")
redis's delete(r, list of "moth:greeting", "moth:count", "moth:jobs", "moth:user", "moth:bin", "moth:temp", "moth:n")
redis's put(r, "moth:greeting", "héllo 😀")
say redis's get(r, "moth:greeting")
say redis's get(r, "moth:missing")
say redis's exists(r, "moth:greeting") " " redis's exists(r, "moth:missing")
redis's put_for(r, "moth:temp", "x", 100)
set left to redis's time_left(r, "moth:temp")
say left is at least 90 and left is at most 100
say redis's time_left(r, "moth:greeting") " " redis's time_left(r, "moth:missing")
say redis's expire(r, "moth:greeting", 1000) " " redis's expire(r, "moth:missing", 10)
say redis's increment(r, "moth:count") " " redis's increment(r, "moth:count") " " redis's increment(r, "moth:count", 10)
say redis's push(r, "moth:jobs", "b") " " redis's push(r, "moth:jobs", list of "c", "d") " " redis's push_front(r, "moth:jobs", "a")
say redis's list_items(r, "moth:jobs") " " redis's list_length(r, "moth:jobs")
say redis's pop(r, "moth:jobs") " " redis's pop_back(r, "moth:jobs") " " redis's list_items(r, "moth:jobs")
say redis's pop_waiting(r, (list of "moth:empty", "moth:jobs"), 1)
say redis's hash_put(r, "moth:user", "name", "Sam") " " redis's hash_put(r, "moth:user", "age", 20)
say redis's hash_get(r, "moth:user", "name") " " redis's hash_get(r, "moth:user", "nothing")
say redis's hash_all(r, "moth:user")
say redis's hash_remove(r, "moth:user", "age") " " redis's hash_all(r, "moth:user")
set block to 256 bytes
for each k from 1 to 256
    set byte k of block to k - 1
end
redis's put(r, "moth:bin", block)
say redis's get_bytes(r, "moth:bin") is block
set incrs to empty list
for each k from 1 to 100
    add (list of "INCR", "moth:n") to incrs
end
set replies to redis's pipeline(r, incrs)
say length of replies " " item 100 of replies
say redis's transaction(r, list of (list of "INCR", "moth:n"), (list of "GET", "moth:n"), (list of "DEL", "moth:n"))
say (redis's keys_like(r, "moth:*") in order)
try
    redis's increment(r, "moth:greeting")
if it fails with why
    say why
end
try
    redis's command(r, list of "NOSUCHCOMMAND")
if it fails with why
    say item 1 of split why by ","
end
# publishing and subscribing, on a connection of its own
set listener to redis's connect_url("redis://moth_test:moth-test@" + host of parts + ":" + port of parts)
redis's subscribe(listener, list of "moth:news", "moth:other")
say redis's publish(r, "moth:news", "hello") " " redis's publish(r, "moth:nobody", "x")
say redis's next_message(listener)
say redis's next_message(listener, 200)
redis's subscribe_like(listener, "moth:p.*")
redis's publish(r, "moth:p.one", "patterned")
say redis's next_message(listener, 5000)
redis's unsubscribe(listener)
say redis's command(listener, list of "PING")
redis's close(listener)
# RESP3: maps as dictionaries
set three to redis's connect_url("redis://moth_test:moth-test@" + host of parts + ":" + port of parts + "/1")
set hello to redis's use_resp3(three)
say item "proto" of hello
say redis's command(three, list of "HGETALL", "moth:user")
say redis's command(three, list of "EXISTS", "moth:user")
redis's close(three)
try
    redis's connect_url("redis://moth_test:wrong@" + host of parts + ":" + port of parts)
if it fails with why
    say why
end
redis's delete(r, list of "moth:greeting", "moth:count", "moth:jobs", "moth:user", "moth:bin", "moth:temp")
redis's close(r)
redis's command(admin, list of "ACL", "DELUSER", "moth_test")
redis's close(admin)
say "done"
`, [process.env.MOTH_REDIS_URL]);
  assert.deepEqual([ran.stderr, ran.status], ["", 0], ran.stdout);
  assert.deepEqual(ran.lines, [
    "héllo 😀",
    "nothing",
    "yes no",
    "yes",
    "-1 -2",
    "yes no",
    "1 2 12",
    "1 3 4",
    "[\"a\", \"b\", \"c\", \"d\"] 4",
    "a d [\"b\", \"c\"]",
    "(record with key \"moth:jobs\", value \"b\")",
    "1 1",
    "Sam nothing",
    "(dictionary where \"name\" is \"Sam\", \"age\" is \"20\")",
    "1 (dictionary where \"name\" is \"Sam\")",
    "yes",
    "100 100",
    "[101, \"101\", 1]",
    "[\"moth:bin\", \"moth:count\", \"moth:greeting\", \"moth:jobs\", \"moth:temp\", \"moth:user\"]",
    "Redis said ERR value is not an integer or out of range",
    "Redis said ERR unknown command 'NOSUCHCOMMAND'",
    "1 0",
    "(record with channel \"moth:news\", message \"hello\", pattern nothing)",
    "nothing",
    "(record with channel \"moth:p.one\", message \"patterned\", pattern \"moth:p.*\")",
    "PONG",
    "3",
    "(dictionary where \"name\" is \"Sam\")",
    "1",
    "Redis said WRONGPASS invalid username-password pair or user is disabled.",
    "done",
  ]);
});

// tools/s3.moth against MinIO: a bucket made, objects of text, 300 KB of bytes and a key with spaces, a + and a
// ü put, got, listed and looked at, presigned URLs to GET and PUT (and one changed, which MinIO turns down),
// deleted, a wrong secret, and the bucket removed
test("tools/s3.moth puts, gets, lists and deletes on a real MinIO, and makes presigned URLs", { skip: live("MOTH_S3_URL") }, () => {
  const where = new URL(process.env.MOTH_S3_URL);
  const ran = companyRun(String.raw`use "s3.moth" as s3
use "http.moth" as http

set store to s3's client(item 1 of arguments, "us-east-1", item 2 of arguments, item 3 of arguments)
set bucket to "moth-test"
try
    s3's create_bucket(store, bucket)
if it fails with why
    say "made before: " why
end
for each found in s3's list_objects(store, bucket)
    s3's delete_object(store, bucket, key of found)
end
say bucket is in s3's list_buckets(store)
s3's put_object(store, bucket, "notes/hello.txt", "Hello, S3 ✓", "text/plain; charset=utf-8")
set big to 300000 bytes
for each k from 1 to 300000
    set byte k of big to remainder of (k * 7) divided by 256
end
s3's put_object(store, bucket, "data/big.bin", big)
s3's put_object(store, bucket, "notes/a b+c/ü.txt", "odd key")
say s3's get_object(store, bucket, "notes/hello.txt") as text
say s3's get_object(store, bucket, "data/big.bin") is big
say s3's get_object(store, bucket, "notes/a b+c/ü.txt") as text
set info to s3's head_object(store, bucket, "notes/hello.txt")
say size of info " " type of info " " length of etag of info
say s3's head_object(store, bucket, "notes/nothing.txt")
for each found in s3's list_objects(store, bucket, "notes/")
    say key of found " " size of found
end
say length of s3's list_objects(store, bucket)
set got to http's get(s3's presigned_url(store, "GET", bucket, "notes/hello.txt", 60))
say status of got " " text of got
set put_url to s3's presigned_url(store, "PUT", bucket, "notes/uploaded.txt", 60)
say status of http's put(put_url, "put through a presigned URL" as bytes)
say s3's get_object(store, bucket, "notes/uploaded.txt") as text
say status of http's get(s3's presigned_url(store, "GET", bucket, "notes/hello.txt", 60) + "x")
s3's delete_object(store, bucket, "notes/hello.txt")
try
    s3's get_object(store, bucket, "notes/hello.txt")
if it fails with why
    say why
end
set wrong to s3's client(item 1 of arguments, "us-east-1", item 2 of arguments, "not the secret")
try
    s3's list_buckets(wrong)
if it fails with why
    say item 1 of split why by ":"
end
for each found in s3's list_objects(store, bucket)
    s3's delete_object(store, bucket, key of found)
end
s3's delete_bucket(store, bucket)
say bucket is in s3's list_buckets(store)
say "done"
`, [`${where.protocol}//${where.host}`, decodeURIComponent(where.username), decodeURIComponent(where.password)]);
  assert.deepEqual([ran.stderr, ran.status], ["", 0], ran.stdout);
  assert.deepEqual(ran.lines.filter((line) => !line.startsWith("made before")), [
    "yes",
    "Hello, S3 ✓",
    "yes",
    "odd key",
    "13 text/plain; charset=utf-8 32",
    "nothing",
    "notes/a b+c/ü.txt 7",
    "notes/hello.txt 13",
    "3",
    "200 Hello, S3 ✓",
    "200",
    "put through a presigned URL",
    "403",
    "S3 said NoSuchKey (404): The specified key does not exist.",
    "S3 said SignatureDoesNotMatch (403)",
    "no",
    "done",
  ]);
});

// tools/oauth.moth signing in for real: a provider of the test's own (Node's), which checks PKCE's verifier
// against the challenge in the address the program gave, and the test as the browser, going back to the
// program's own server on 127.0.0.1: first with a state it never sent, which the program turns down and waits
// on, then with the code; tokens refreshed (one refresh token revoked); the program's own tokens with its
// secret in HTTP Basic and in the form; and a sign-in the person said no to
test("tools/oauth.moth signs a person in with PKCE and a server of its own, and gets and refreshes tokens", { skip }, async () => {
  const challenges = [];
  const strict = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  const provider = createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      const form = Object.fromEntries(new URLSearchParams(body));
      const reply = (status, value) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(value));
      };
      if (req.url !== "/token" || req.method !== "POST" || req.headers["content-type"] !== "application/x-www-form-urlencoded") return reply(404, {});
      if (form.grant_type === "authorization_code") {
        const challenge = createHash("sha256").update(form.code_verifier ?? "").digest("base64url");
        if (form.code === "the-code" && form.client_id === "moth-app" && challenge === challenges.at(-1) && /^http:\/\/127\.0\.0\.1:\d+\/callback$/.test(form.redirect_uri)) {
          return reply(200, { access_token: "at1", token_type: "Bearer", expires_in: 3600, refresh_token: "rt1", scope: "openid email" });
        }
        return reply(400, { error: "invalid_grant", error_description: "PKCE didn't match" });
      }
      if (form.grant_type === "refresh_token") {
        return form.refresh_token === "rt1" && form.client_id === "moth-app" ? reply(200, { access_token: "at2", expires_in: 30 }) : reply(400, { error: "invalid_grant", error_description: "that refresh token was revoked" });
      }
      if (form.grant_type === "client_credentials") {
        if (req.headers.authorization === `Basic ${Buffer.from(`svc:${strict("shh: it's a secret")}`).toString("base64")}` && form.scope === "reports.read") return reply(200, { access_token: "svc-basic", token_type: "Bearer" });
        if (!req.headers.authorization && form.client_id === "svc" && form.client_secret === "shh: it's a secret") return reply(200, { access_token: "svc-body" });
        return reply(401, { error: "invalid_client" });
      }
      return reply(400, { error: "unsupported_grant_type" });
    });
  });
  await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve));
  const dir = mkdtempSync(join(tmpdir(), "moth-oauth-"));
  try {
    const files = {};
    for (const name of readdirSync(new URL("./tools/", import.meta.url)).filter((f) => f.endsWith(".moth"))) files[name] = readFileSync(new URL(`./tools/${name}`, import.meta.url), "utf8");
    const exe = executable(dir, "p");
    writeFileSync(exe, machine(String.raw`use "oauth.moth" as oauth

set base to item 1 of arguments
set app to oauth's provider(base + "/authorize", base + "/token", "moth-app")
set open_browser of app to no
set port of app to number of item 2 of arguments
set item "access_type" of extra of app to "offline"
set tokens to oauth's sign_in(app, list of "openid", "email")
say access_token of tokens " " refresh_token of tokens " " scope of tokens " " token_type of tokens
say expires_at of tokens is not nothing and not oauth's expired(tokens)
set tokens to oauth's refresh(app, tokens)
say access_token of tokens " " refresh_token of tokens " " oauth's expired(tokens)
set service to oauth's provider("", base + "/token", "svc")
set client_secret of service to "shh: it's a secret"
say access_token of oauth's client_credentials(service, list of "reports.read")
set secret_in of service to "body"
say access_token of oauth's client_credentials(service)
set gone to record with access_token "x", refresh_token "revoked", expires_at nothing
try
    oauth's refresh(app, gone)
if it fails with why
    say why
end
try
    oauth's sign_in(app)
if it fails with why
    say why
end
say "done"
`, { target, name: "p.moth", allow: ["--allow-libraries"], files }));
    if (target === "linux") chmodSync(exe, 0o755);
    const running = spawn(exe, [`http://127.0.0.1:${provider.address().port}`, String(25000 + (process.pid % 2000))], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    running.stdout.on("data", (d) => (out += d));
    running.stderr.on("data", (d) => (err += d));
    const ended = new Promise((resolve) => running.on("exit", resolve));
    // the address the program said to open, the nth time, once its server is listening
    const nth = async (n) => {
      for (let waited = 0; waited < 30000; waited += 20) {
        const said = [...err.matchAll(/open this address in a browser:\n(\S+)\n/g)];
        if (said.length >= n && err.split("listening on").length > n) return new URL(said[n - 1][1]);
        await new Promise((r) => setTimeout(r, 20));
      }
      throw new Error(`no address to sign in at, ${n}: ${err}`);
    };
    const first = await nth(1);
    const q = Object.fromEntries(first.searchParams);
    assert.deepEqual([first.pathname, q.response_type, q.client_id, q.scope, q.code_challenge_method, q.access_type, q.state.length, q.code_challenge.length], ["/authorize", "code", "moth-app", "openid email", "S256", "offline", 22, 43]);
    challenges.push(q.code_challenge);
    const back = (url, fields) => fetch(`${url}?${new URLSearchParams(fields)}`).then(async (r) => [r.status, await r.text()]);
    assert.deepEqual(await back(q.redirect_uri, { state: "not the one", code: "stolen" }), [400, "This sign-in wasn't asked for here: its state isn't the one sent."]);
    const [status, page] = await back(q.redirect_uri, { state: q.state, code: "the-code" });
    assert.deepEqual([status, page.includes("<h1>Signed in</h1>")], [200, true]);
    const second = Object.fromEntries((await nth(2)).searchParams);
    challenges.push(second.code_challenge);
    assert.equal(second.scope, undefined);
    const [refused, said] = await back(second.redirect_uri, { state: second.state, error: "access_denied", error_description: "the person said <no>" });
    assert.deepEqual([refused, said.includes("the person said &lt;no&gt;")], [400, true]);
    assert.equal(await ended, 0, err);
    assert.deepEqual(out.split("\n"), [
      "at1 rt1 openid email Bearer",
      "yes",
      "at2 rt1 yes",
      "svc-basic",
      "svc-body",
      "the provider said invalid_grant: that refresh token was revoked",
      "the provider said access_denied: the person said <no>",
      "done",
      "",
    ]);
  } finally {
    provider.close();
    rmSync(dir, { recursive: true, force: true });
  }
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

// tools/sockets.moth over IPv6: a listener on ::1 and a connection to it, one on :: that takes IPv4 too, and
// ready(): nothing yet, a connection waiting on the second of two listeners, bytes to receive, and an end; and a
// name with two addresses, the one that answers found soon
const HAS_IPV6 = Object.values(networkInterfaces()).flat().some((i) => i.address === "::1");
test("tools/sockets.moth listens and connects over IPv6, and says which of many have something", { skip: skip || (!HAS_IPV6 && "this computer has no ::1") }, () => {
  const ran = libraryRun(String.raw`use "sockets.moth" as net

# IPv6, this computer's own address
set six to net's listen_on("::1", 0)
say host of peer of six
to six_client with port
    set mine to net's connect("::1", port)
    net's send(mine, "over six")
    net's finish_sending(mine)
    set back to net's receive_all(mine) as text
    net's close(mine)
    return back
end
set job to start six_client(net's port_of(six))
set c to net's accept(six)
say host of peer of c
say net's receive_all(c) as text
net's send(c, "six back")
net's close(c)
say wait for job
net's close(six)

# "::": IPv6 and IPv4 both
set both to net's listen_on("::", 0)
to four_client with port
    set mine to net's connect("127.0.0.1", port)
    net's send(mine, "four")
    net's close(mine)
    return "sent"
end
set job to start four_client(net's port_of(both))
set c to net's accept(both)
say host of peer of c
say net's receive_all(c) as text
net's close(c)
say wait for job
net's close(both)

# many at once
set l1 to net's listen(0)
set l2 to net's listen(0)
say length of net's ready((list of l1, l2), 50)
to knock with port
    set mine to net's connect("127.0.0.1", port)
    net's send(mine, "knock")
    return mine
end
set job to start knock(net's port_of(l2))
set c2 to wait for job
set got to net's ready((list of l1, l2), 5000)
say length of got
say net's port_of(item 1 of got) is net's port_of(l2)
set s to net's accept(l2)
say length of net's ready((list of s), 5000)
say net's receive(s, 100) as text
net's close(c2)
say length of net's ready((list of s), 5000)
say length of net's receive(s, 100)
net's close(s)

# a name with two addresses, ::1 first on Windows, its IPv4 one listening: the second tried a quarter of a
# second after the first, not after the first gives up
to timed_client with port
    set began to the clock
    set mine to net's connect("localhost", port)
    set took to the clock - began
    net's close(mine)
    return took
end
set l3 to net's listen(0)
set job to start timed_client(net's port_of(l3))
set s to net's accept(l3)
say host of peer of s
say (wait for job) is less than 1.5
`);
  assert.deepEqual([ran.stdout, ran.stderr, ran.status], ["::1\n::1\nover six\nsix back\n::ffff:127.0.0.1\nfour\nsent\n0\n1\nyes\n1\nknock\n1\n0\n127.0.0.1\nyes\n", "", 0]);
});

// tools/secrets.moth: the system's random bytes, two draws of which differ, and as many as asked for; tokens in
// hex and for addresses; numbers below n, each seen often in 600; a choice, a shuffle, secrets compared; and
// each mistake
// tools/crypto.moth (DESIGN §100): encrypt and decrypt with a key from the system's randomness, a fresh nonce
// each time, a wrong key found out, and a key from a password
test("tools/crypto.moth encrypts with AES-GCM and a fresh nonce, and finds out a wrong key", { skip }, () => {
  const ran = libraryRun(`use "crypto.moth" as crypto
set key to crypto's new_key()
say length of key
set sealed to crypto's encrypt(key, "meet at noon é")
say length of sealed
say crypto's decrypt(key, sealed) as text
say crypto's encrypt(key, "same") is crypto's encrypt(key, "same")
try
    crypto's decrypt(crypto's new_key(), sealed)
if it fails with why
    say why
end
say length of crypto's key_from_password("pw", crypto's new_salt(), 10)`);
  assert.deepEqual([ran.stdout, ran.stderr, ran.status], ["32\n43\nmeet at noon é\nno\nthe message was changed, or the key is wrong\n32\n", "", 0]);
});

test("tools/secrets.moth gives random bytes, tokens and numbers no one can guess, on Windows and Linux", { skip }, () => {
  const ran = libraryRun(String.raw`use "secrets.moth" as secrets
set a to secrets's random_bytes(16)
set b to secrets's random_bytes(16)
say length of a
say a is b
say length of secrets's random_bytes(0)
say length of secrets's random_bytes(100000)
set h to secrets's token_hex(8)
say length of h
set fine to yes
for each c in h
    if not (c is in "0123456789abcdef")
        set fine to no
    end
end
say fine
set u to secrets's token_url(16)
say length of u
set fine to yes
for each c in u
    if not (c is in "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_")
        set fine to no
    end
end
say fine
set seen to list of 0, 0, 0, 0, 0, 0
repeat 600 times
    set r to secrets's below(6)
    set item (r + 1) of seen to item (r + 1) of seen + 1
end
set every_one to yes
for each count in seen
    if count is less than 50
        set every_one to no
    end
end
say every_one
say secrets's below(1)
say secrets's below(281474976710656) is less than 281474976710656
say secrets's choice(list of "only")
say secrets's shuffled(list of 1, 2, 3, 4, 5) in order
say secrets's same_secret("token", "token")
say secrets's same_secret("token", "tokeN")
say secrets's same_secret("token", "tok")
for each bad in list of 0, 2.5, 281474976710657
    try
        secrets's below(bad)
    if it fails with why
        say why
    end
end
try
    secrets's choice(empty list)
if it fails with why
    say why
end
try
    secrets's random_bytes(-1)
if it fails with why
    say why
end
`);
  assert.deepEqual([ran.stdout, ran.stderr, ran.status], ["16\nno\n0\n100000\n16\nyes\n22\nyes\nyes\n0\nyes\nonly\n[1, 2, 3, 4, 5]\nyes\nno\nno\nbelow needs a whole number from 1 to 2^48, not 0\nbelow needs a whole number from 1 to 2^48, not 2.5\nbelow needs a whole number from 1 to 2^48, not 281474976710657\nchoice needs something to choose from: the list is empty\nrandom_bytes needs a whole number of bytes from 0 up, not -1\n", "", 0]);
});

// tools/http.moth, asking server.moth, which a task of the program's runs: GET, PUT with a header of its own,
// POST of a record as JSON, PATCH of bytes, DELETE and HEAD; JSON read; redirects after 302, 303 and 307, and
// to another host, which isn't told the Authorization; a body squeezed with gzip; a 404, and checking it;
// redirects that never end; encoding and forms; a body in chunks; and each mistake
test("tools/http.moth asks servers with any method, follows redirects, and reads chunked and gzipped bodies", { skip }, () => {
  const port = 21000 + (process.pid % 2000);
  const ran = libraryRun(`use "http.moth" as http
use "server.moth" as web
use "zip.moth" as zip

set port to ${port}
set base to "http://127.0.0.1:" + port

to answer with request
    set p to path of request
    if p is "/"
        return "<h1>Hello</h1>"
    else if p is "/echo"
        set seen to "nothing"
        if "x-custom" is in headers of request
            set seen to item "x-custom" of headers of request
        end
        set kind to "none"
        if "content-type" is in headers of request
            set kind to item "content-type" of headers of request
        end
        set said to "nobody"
        if "authorization" is in headers of request
            set said to item "authorization" of headers of request
        end
        return method of request + " " + body of request + " | " + kind + " | " + seen + " | " + said + " | " + item "q" of query of request
    else if p is "/json"
        return dictionary where "name" is "Sam", "scores" is (list of 1, 2, 3)
    else if p is "/move"
        return record with status 302, body "moved", headers (dictionary where "location" is "/echo?q=after302")
    else if p is "/see"
        return record with status 303, body "", headers (dictionary where "location" is "/echo?q=after303")
    else if p is "/keep"
        return record with status 307, body "", headers (dictionary where "location" is "echo?q=after307")
    else if p is "/far"
        return record with status 302, body "", headers (dictionary where "location" is "http://localhost:" + port + "/echo?q=far")
    else if p is "/loop"
        return record with status 302, body "", headers (dictionary where "location" is "/loop")
    else if p is "/gz"
        return record with status 200, body zip's gzip("squeezed é, squeezed é, squeezed é"), headers (dictionary where "content-encoding" is "gzip")
    else if p is "/stop"
        web's stop_serving()
        return "bye"
    end
    return record with status 404, body "nothing at " + p
end

set job to start web's serve(port, answer)
wait 200 milliseconds
set r to http's get(base + "/")
say status of r + " " + reason of r + " " + text of r + " " + item "content-type" of headers of r
set r to http's request("put", base + "/echo?q=one%20two", "a body é", dictionary where "X-Custom" is "mine")
say text of r
set r to http's post(base + "/echo?q=json", record with name "Sam")
say text of r
set r to http's patch(base + "/echo?q=bytes", (list of 104, 105) as bytes)
say text of r
set r to http's delete(base + "/echo?q=gone")
say text of r
set r to http's head(base + "/")
say status of r + " " + length of body of r
say http's get_json(base + "/json")
set r to http's get(base + "/move")
say text of r + " at " + url of r
set r to http's post(base + "/see", "posted")
say text of r
set r to http's post(base + "/keep", "kept")
say text of r
set r to http's request("GET", base + "/far", nothing, dictionary where "Authorization" is "Bearer secret")
say text of r
set r to http's get(base + "/gz")
say text of r + " " + length of body of r
set r to http's get(base + "/missing")
say status of r + " " + text of r
try
    http's check(r)
if it fails with why
    say why
end
try
    http's get(base + "/loop")
if it fails with why
    say why
end
say http's encoded("a b&c=d/é") + " " + http's decoded("a+b%26c%3Dd%2F%C3%A9")
say http's form_of(dictionary where "q" is "moth lang", "n" is 2)
say http's http_unchunked(("5" + http's http_line_end + "hello" + http's http_line_end + "6;x=y" + http's http_line_end + " world" + http's http_line_end + "0" + http's http_line_end + http's http_line_end) as bytes, "x") as text
for each bad in list of "ftp://example.com/", "http:///nohost", "http://[::1/x"
    try
        http's get(bad)
    if it fails with why
        say why
    end
end
try
    http's get("http://127.0.0.1:1/")
if it fails with why
    say why
end
http's get(base + "/stop")
wait for job
say "done"
`);
  assert.deepEqual([ran.stdout, ran.stderr, ran.status], [`200 OK <h1>Hello</h1> text/html; charset=utf-8\nPUT a body é | text/plain; charset=utf-8 | mine | nobody | one two\nPOST {\"name\":\"Sam\"} | application/json | nothing | nobody | json\nPATCH hi | none | nothing | nobody | bytes\nDELETE  | none | nothing | nobody | gone\n200 0\n(dictionary where \"name\" is \"Sam\", \"scores\" is [1, 2, 3])\nGET  | none | nothing | nobody | after302 at http://127.0.0.1:${port}/echo?q=after302\nGET  | none | nothing | nobody | after303\nPOST kept | text/plain; charset=utf-8 | nothing | nobody | after307\nGET  | none | nothing | nobody | far\nsqueezed é, squeezed é, squeezed é 37\n404 nothing at /missing\nthe server said 404 Not Found to http://127.0.0.1:${port}/missing\ntoo many redirects, from http://127.0.0.1:${port}/loop\na%20b%26c%3Dd%2F%C3%A9 a b&c=d/é\nq=moth%20lang&n=2\nhello world\nhttp.moth asks http:// and https:// addresses, not ftp://example.com/\n'http:///nohost' has no host\n'http://[::1/x' has a [ with no ]\ncan't connect to 127.0.0.1 port 1: nothing answered there\ndone\n`, `listening on http://127.0.0.1:${port}/
`, 0]);
});

// tools/websocket.moth: an echo server in a task of the program's, and the program connecting to it: text, a
// ping, 70,000 bytes (a 64-bit length), 300 letters (a 16-bit one), and closing, which the server sees with its
// code; sending after it's closed, and an address that isn't ws://
test("tools/websocket.moth carries messages both ways, as client and server", { skip }, () => {
  const ran = libraryRun(String.raw`use "websocket.moth" as ws

set listener to ws's listen(0)
set port to ws's port_of(listener)
to echo_server with listener
    set c to ws's accept(listener)
    set heard to empty list
    add path of c to heard
    repeat while yes
        set m to ws's receive(c)
        if kind of m is "close"
            add "closed " + code of m to heard
            return heard
        end
        if kind of m is "text"
            add "text " + data of m to heard
            ws's send(c, uppercase of data of m)
        else
            add "bytes " + length of data of m to heard
            ws's send(c, data of m)
        end
    end
end
set job to start echo_server(listener)
set c to ws's connect("ws://127.0.0.1:" + port + "/chat?room=1")
ws's send(c, "hello é")
say ws's receive(c)
ws's ping(c)
set big to 70000 bytes
for each k from 1 to 70000
    set byte k of big to remainder of k divided by 251
end
ws's send(c, big)
set back to ws's receive(c)
say kind of back + " " + (data of back is big)
set mid to ""
repeat 300 times
    add "x" to mid
end
ws's send(c, mid)
say length of data of ws's receive(c)
ws's close(c)
for each line in wait for job
    say line
end
try
    ws's send(c, "after")
if it fails with why
    say why
end
try
    ws's connect("http://127.0.0.1:1")
if it fails with why
    say why
end
`);
  assert.deepEqual([ran.stdout, ran.stderr, ran.status], ["(record with kind \"text\", data \"HELLO É\")\nbinary yes\n300\n/chat?room=1\ntext hello é\nbytes 70000\ntext xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\nclosed 1000\ncan't send on a WebSocket that's closed\na WebSocket's address starts with ws:// or wss://, not http://127.0.0.1:1\n", "", 0]);
});

// and Node's own WebSocket client, as a browser's, asking a server of Moth's: text, bytes, 200,000 letters, a close
test("a WebSocket server of Moth's talks to Node's WebSocket client, as a browser's", { skip: skip || (typeof WebSocket !== "function" && "this Node has no WebSocket") }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "moth-ws-"));
  const port = 22000 + (process.pid % 2000);
  try {
    const files = {};
    for (const name of ["websocket.moth", "sockets.moth", "hash.moth", "base64.moth", "secrets.moth"]) files[name] = readFileSync(new URL(`./tools/${name}`, import.meta.url), "utf8");
    const exe = executable(dir, "ws");
    writeFileSync(exe, machine(`use "websocket.moth" as ws
set listener to ws's listen(${port})
say "listening" to the error output
set c to ws's accept(listener)
say path of c
say item "sec-websocket-version" of headers of c
repeat while yes
    set m to ws's receive(c)
    if kind of m is "close"
        say "closed " + code of m + " " + reason of m
        stop the program
    end
    if kind of m is "text"
        say "text " + length of data of m
        ws's send(c, uppercase of data of m)
    else
        say "bytes " + length of data of m
        ws's send(c, data of m)
    end
end
`, { target, name: "ws.moth", files, allow: ["--allow-libraries"] }));
    if (target === "linux") chmodSync(exe, 0o755);
    const running = spawn(exe, [], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    running.stdout.on("data", (d) => (out += d));
    const ended = new Promise((resolve) => running.on("exit", resolve));
    await new Promise((resolve) => running.stderr.on("data", (d) => String(d).includes("listening") && resolve()));
    const s = new WebSocket(`ws://127.0.0.1:${port}/room?x=1`);
    s.binaryType = "arraybuffer";
    await new Promise((resolve, failed) => { s.onopen = resolve; s.onerror = failed; });
    const next = () => new Promise((resolve) => (s.onmessage = (e) => resolve(e.data)));
    const got = [];
    s.send("hello é");
    got.push(await next());
    s.send(new Uint8Array([1, 2, 3, 250]));
    got.push([...new Uint8Array(await next())].join(","));
    s.send("y".repeat(200000));
    got.push((await next()).length);
    s.close(1000, "done here");
    assert.equal(await ended, 0);
    assert.deepEqual(got, ["HELLO É", "1,2,3,250", 200000]);
    assert.equal(out, "/room?x=1\n13\ntext 7\nbytes 4\ntext 200000\nclosed 1000 done here\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// tools/email.moth reading mail: a message it made, read back, with its encoded words, a name in quotes, HTML and
// files; one another program wrote, in quoted-printable and Latin-1 with Q words and folded headers; a POP3
// server and an IMAP server of the test's own, in tasks: counting, getting, searching, marking, removing, and
// a password each won't take
test("tools/email.moth reads messages in MIME, and mailboxes over POP3 and IMAP", { skip }, () => {
  const ran = libraryRun(String.raw`use "email.moth" as mail
use "sockets.moth" as net

set crlf to (list of 13, 10) as bytes as text

# a message made, then read back
set m to mail's message("Sam Pudke <sam@example.com>", (list of "you@example.com", "\"Them, Two\" <them@example.com>"), "Héllo from Moth, a subject long enough for two encoded words ✓", "Line one\n.dot line\nLine three, é")
set cc of m to list of "cc@example.com"
set html of m to "<p>Hi <b>there</b></p>"
mail's attach_bytes(m, "notes é.txt", "some notes\n", "text/plain")
mail's attach_bytes(m, "data.bin", (list of 0, 1, 2, 250, 255) as bytes, "application/octet-stream")
set back to mail's read_message(mail's message_text(m))
say sender of back
say recipients of back
say cc of back
say subject of back
say text of back
say html of back
for each a in attachments of back
    say name of a + " " + type of a + " " + length of data of a
end
say data of item 1 of attachments of back as text
say length of message_id of back is greater than 10

# one written by another program: quoted-printable, Latin-1, Q words, folded headers, bare line ends
set other to "From: =?ISO-8859-1?Q?Andr=E9?= <andre@example.com>\nTo: a@example.com,\n b@example.com\nSubject: =?utf-8?q?caf=C3=A9_au_lait?= =?utf-8?b?IOKckw==?=\nContent-Type: text/plain; charset=\"iso-8859-1\"\nContent-Transfer-Encoding: quoted-printable\n\nCaf=E9 cr=E8me, a line that goes on =\nand on.\n"
set read_other to mail's read_message(other)
say sender of read_other
say recipients of read_other
say subject of read_other
say text of read_other

# a fake POP3 server: two messages, a wrong password, a removal
to pop_serve with listener, raw_messages
    set conn to net's accept(listener)
    set heard to empty list
    net's send(conn, "+OK ready" + crlf)
    repeat while yes
        set line to net's receive_line(conn)
        if line is nothing
            return heard
        end
        add line to heard
        set word to uppercase of item 1 of split line by " "
        if word is "USER"
            net's send(conn, "+OK go on" + crlf)
        else if word is "PASS"
            if line is "PASS secret"
                net's send(conn, "+OK in" + crlf)
            else
                net's send(conn, "-ERR wrong password" + crlf)
            end
        else if word is "STAT"
            net's send(conn, "+OK " + length of raw_messages + " 1000" + crlf)
        else if word is "RETR"
            set n to number of item 2 of split line by " "
            set stuffed to empty list
            for each l in split item n of raw_messages by crlf
                if length of l is greater than 0 and item 1 of l is "."
                    add "." + l to stuffed
                else
                    add l to stuffed
                end
            end
            net's send(conn, "+OK message follows" + crlf + (join stuffed with crlf) + crlf + "." + crlf)
        else if word is "DELE"
            net's send(conn, "+OK marked" + crlf)
        else if word is "QUIT"
            net's send(conn, "+OK bye" + crlf)
            net's close(conn)
            return heard
        else
            net's send(conn, "-ERR what" + crlf)
        end
    end
end

set listener to net's listen(0)
set port to net's port_of(listener)
set first_raw to mail's message_text(mail's message("a@example.com", "b@example.com", "First", "one\n.two"))
set second_raw to mail's message_text(m)
set job to start pop_serve(listener, list of first_raw, second_raw)
set s to mail's server("127.0.0.1", port)
set security of s to "none"
mail's log_in(s, "sam", "secret")
set box to mail's pop_open(s)
say mail's pop_count(box)
set got to mail's pop_get(box, 1)
say subject of got + " | " + text of got
say subject of mail's pop_get(box, 2)
mail's pop_delete(box, 1)
mail's pop_close(box)
say wait for job
set job to start pop_serve(listener, list of first_raw)
mail's log_in(s, "sam", "wrong")
try
    mail's pop_open(s)
if it fails with why
    say why
end
say item 2 of wait for job

# a fake IMAP server: folders, a folder chosen, a search, a message by its UID, a mark
to imap_serve with listener, raw
    set conn to net's accept(listener)
    set heard to empty list
    net's send(conn, "* OK IMAP ready" + crlf)
    repeat while yes
        set line to net's receive_line(conn)
        if line is nothing
            return heard
        end
        add line to heard
        set words to split line by " "
        set tag to item 1 of words
        set command to uppercase of item 2 of words
        if command is "LOGIN"
            if line is tag + " LOGIN \"sam\" \"se\\\"cret\""
                net's send(conn, tag + " OK logged in" + crlf)
            else
                net's send(conn, tag + " NO wrong password" + crlf)
            end
        else if command is "LIST"
            net's send(conn, "* LIST (\\HasNoChildren) \"/\" \"INBOX\"" + crlf + "* LIST (\\HasNoChildren) \"/\" Archive" + crlf + tag + " OK done" + crlf)
        else if command is "SELECT"
            net's send(conn, "* 3 EXISTS" + crlf + "* 0 RECENT" + crlf + tag + " OK [READ-WRITE] selected" + crlf)
        else if command is "UID" and uppercase of item 3 of words is "SEARCH"
            net's send(conn, "* SEARCH 4 9 12" + crlf + tag + " OK done" + crlf)
        else if command is "UID" and uppercase of item 3 of words is "FETCH"
            set b to raw as bytes
            net's send(conn, "* 2 FETCH (UID " + item 4 of words + " BODY[] {" + length of b + "}" + crlf)
            net's send(conn, b)
            net's send(conn, ")" + crlf + tag + " OK done" + crlf)
        else if command is "UID" and uppercase of item 3 of words is "STORE"
            net's send(conn, "* 2 FETCH (FLAGS (\\Seen))" + crlf + tag + " OK done" + crlf)
        else if command is "LOGOUT"
            net's send(conn, "* BYE" + crlf + tag + " OK bye" + crlf)
            net's close(conn)
            return heard
        else
            net's send(conn, tag + " BAD what" + crlf)
        end
    end
end

set job to start imap_serve(listener, second_raw)
mail's log_in(s, "sam", "se\"cret")
set box to mail's imap_open(s)
say mail's imap_folders(box)
say mail's imap_select(box, "INBOX")
say mail's imap_search(box, "UNSEEN")
set got to mail's imap_get(box, 9)
say subject of got
say length of attachments of got
mail's imap_mark(box, 9, "\\Seen")
mail's imap_close(box)
for each line in wait for job
    say line
end
set job to start imap_serve(listener, second_raw)
mail's log_in(s, "sam", "nope")
try
    mail's imap_open(s)
if it fails with why
    say why
end
wait for job
say "done"
`);
  assert.deepEqual([ran.stdout, ran.stderr, ran.status], ["Sam Pudke <sam@example.com>\n[\"you@example.com\", \"\\\"Them, Two\\\" <them@example.com>\"]\n[\"cc@example.com\"]\nHéllo from Moth, a subject long enough for two encoded words ✓\nLine one\n.dot line\nLine three, é\n<p>Hi <b>there</b></p>\nnotes é.txt text/plain 11\ndata.bin application/octet-stream 5\nsome notes\n\nyes\nAndré <andre@example.com>\n[\"a@example.com\", \"b@example.com\"]\ncafé au lait ✓\nCafé crème, a line that goes on and on.\n\n2\nFirst | one\n.two\nHéllo from Moth, a subject long enough for two encoded words ✓\n[\"USER sam\", \"PASS secret\", \"STAT\", \"RETR 1\", \"RETR 2\", \"DELE 1\", \"QUIT\"]\nthe mail server said no to logging in: -ERR wrong password\nPASS wrong\n[\"INBOX\", \"Archive\"]\n3\n[4, 9, 12]\nHéllo from Moth, a subject long enough for two encoded words ✓\n2\nm8 LOGIN \"sam\" \"se\\\"cret\"\nm9 LIST \"\" \"*\"\nm10 SELECT \"INBOX\"\nm11 UID SEARCH UNSEEN\nm12 UID FETCH 9 BODY.PEEK[]\nm13 UID STORE 9 +FLAGS (\\Seen)\nm14 LOGOUT\nthe mail server said no to logging in: NO wrong password\ndone\n", "", 0]);
});

// tools/log.moth: levels, a name, a format of its own, lines added to a file, and on the error output, with the
// time where it's asked for; and system.moth adding to the end of a file
test("tools/log.moth writes what happened, at the levels asked for, to the error output or a file", { skip }, () => {
  const ran = libraryRun(String.raw`use "log.moth" as log
use "system.moth" as system

log's set_format("%level% %name%%message%")
log's debug("not shown: below the level")
log's info("started")
log's set_level("debug")
log's debug("now shown")
log's set_name("db")
log's warning("slow")
if system's exists("app.log")
    system's remove_file("app.log")
end
log's to_file("app.log")
log's error("to the file")
log's critical("and another, é")
log's to_error_output()
log's set_name("")
log's set_level("WARNING")
log's info("not shown either")
log's warning("back on the error output")
say read "app.log"
say log's lines()
log's set_format("%time%|%level%|%message%")
log's error("timed")
set parts to split item (length of log's lines()) of log's lines() by "|"
say length of item 1 of parts
say item 2 of parts + " " + item 3 of parts
try
    log's set_level("loud")
if it fails with why
    say why
end
system's append_to_file("app.log", "more" + "\n")
say length of split read "app.log" by "\n"
system's remove_file("app.log")
`, ["--allow-libraries", "--allow-read"]);
  assert.deepEqual([ran.stdout, ran.stderr.replace(/\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\|/, "(now)|"), ran.status], ["ERROR db: to the file\nCRITICAL db: and another, é\n\n[\"INFO started\", \"DEBUG now shown\", \"WARNING db: slow\", \"ERROR db: to the file\", \"CRITICAL db: and another, é\", \"WARNING back on the error output\"]\n19\nERROR timed\nthere's no level called 'loud': debug, info, warning, error and critical are\n4\n", "INFO started\nDEBUG now shown\nWARNING db: slow\nWARNING back on the error output\n(now)|ERROR|timed\n", 0]);
});

// tools/zones.moth: offsets in nine zones at nine moments, around summer time's edges, south of the equator,
// at :45 past, far ahead (from the zone's rule, on Linux) and in 1900, as Node's own zones (ICU's) have them;
// times in a zone, a time summer time skips and one it has twice, and a zone that isn't there
test("tools/zones.moth knows the world's time zones, as Node's own do", { skip }, () => {
  const zones = ["Asia/Kolkata", "America/New_York", "Europe/London", "Australia/Sydney", "America/Sao_Paulo", "Asia/Kathmandu", "Pacific/Chatham", "Europe/Berlin", "UTC"];
  const moments = [946684800, 1277942400, 1772953199, 1772953200, 1793512799, 1793512800, 2224713600, 1790000000, -2174428800];
  const offset = (zone, m) => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(new Date(m * 1000)).map((p) => [p.type, p.value]));
    return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) / 1000 - m;
  };
  let source = 'use "zones.moth" as zones\n';
  const want = [];
  for (const z of zones) for (const m of moments) {
    source += `say zones's offset_at("${z}", ${m})\n`;
    want.push(String(offset(z, m)));
  }
  source += `say zones's zone_text(zones's in_zone(1772953200, "America/New_York"))
say zones's utc_text(1772953200)
say zones's moment_of(2026, 7, 4, 9, 0, 0, "America/New_York")
say zones's moment_of(2026, 3, 8, 2, 30, 0, "America/New_York")
say zones's moment_of(2026, 11, 1, 1, 30, 0, "America/New_York")
say zones's zone_text(zones's in_zone(1772953200, "Asia/Kathmandu"))
try
    zones's offset_at("Mars/Olympus", 0)
if it fails with why
    say why
end
say length of zones's local_zone() is greater than 0
say zones's now() is greater than 1700000000
`;
  want.push("2026-03-08T03:00:00-04:00", "2026-03-08T07:00:00Z", String(Date.UTC(2026, 6, 4, 13) / 1000), String(Date.UTC(2026, 2, 8, 7, 30) / 1000),
    String(Date.UTC(2026, 10, 1, 5, 30) / 1000), "2026-03-08T12:45:00+05:45", "there's no time zone called 'Mars/Olympus'", "yes", "yes");
  const ran = libraryRun(source, ["--allow-libraries", "--allow-read"]);
  assert.deepEqual([ran.stdout, ran.stderr, ran.status], [want.join("\n") + "\n", "", 0]);
});

// Libraries' other whole numbers (DESIGN §92): bytes, shorts and the unsigned ones, given and given back, in a
// structure whose layout is C's, and each mistake of one that won't fit
test("a library's function takes and gives bytes, shorts and unsigned whole numbers, as C has them", { skip }, () => {
  const ran = libraryRun(String.raw`use the library "msvcrt" or "c"
    "strtoul" as unsigned_of(text, a pointer, a whole number) gives an unsigned whole number
    "strtoul" as signed_of(text, a pointer, a whole number) gives a whole number
    "toupper" as upper_byte(a byte) gives a byte
    "abs" as abs_short(a short whole number) gives a short whole number
    "memset" as fill(bytes, a byte, a long whole number) gives a pointer
    structure mixed with a as a byte, b as a signed byte, c as a short whole number, d as an unsigned short whole number,
        e as an unsigned whole number, f as an unsigned long whole number
    "memcpy" as from_mixed(bytes, a mixed, a long whole number) gives a pointer
    "memcpy" as to_mixed(a mixed, bytes, a long whole number) gives a pointer
end
use the library "c"
    "strtoull" as big_unsigned(text, a pointer, a whole number) gives an unsigned long whole number
end
use the library "msvcrt"
    "_strtoui64" as big_unsigned_windows(text, a pointer, a whole number) gives an unsigned long whole number
end

say unsigned_of("4294967295", nothing, 10)
say signed_of("4294967295", nothing, 10)
say upper_byte(97)
say abs_short(-1234)
set b to 4 bytes
fill(b, 255, 4)
say b
set m to record with a 200, b -100, c -30000, d 60000, e 4000000000, f 12345678901234
set raw to 24 bytes
from_mixed(raw, m, 24)
say raw
set back to record with a 0, b 0, c 0, d 0, e 0, f 0
set raw2 to 24 bytes
for each k from 1 to 24
    set byte k of raw2 to 255
end
to_mixed(back, raw2, 24)
say back
set big to 0
try
    set big to big_unsigned("18446744073709551615", nothing, 10)
if it fails
    set big to big_unsigned_windows("18446744073709551615", nothing, 10)
end
say big is 18446744073709551616
for each bad in list of 256, -1, 2.5
    try
        upper_byte(bad)
    if it fails with why
        say why
    end
end
try
    abs_short(40000)
if it fails with why
    say why
end
try
    from_mixed(raw, (record with a 1, b 1, c 1, d 1, e -1, f 1), 24)
if it fails with why
    say why
end
`);
  assert.deepEqual([ran.stdout, ran.stderr, ran.status], ["4294967295\n-1\n65\n1234\n(4 bytes: 255, 255, 255, 255)\n(24 bytes: 200, 156, 208, 138, 96, 234, 0, 0, 0, 40, 107, 238, 0, 0, 0, 0, 242, 47, 206, 115, 58, 11, 0, 0)\n(record with a 255, b -1, c -1, d 65535, e 4294967295, f 18446744073709552000)\nyes\n'upper_byte' needs input 1 to be a whole number from 0 to 255, not 256\n'upper_byte' needs input 1 to be a whole number from 0 to 255, not -1\n'upper_byte' needs input 1 to be a whole number from 0 to 255, not 2.5\n'abs_short' needs input 1 to be a whole number from -32768 to 32767, not 40000\n'from_mixed' needs input 2's e to be a whole number from 0 to 4294967295, not -1\n", "", 0]);
});

// Structures by value: C's div gives one; and where there's a C compiler, a library of the test's own, built
// with it, with each shape the calling conventions sort differently: two numbers, a whole number and a number,
// 24 bytes, 4 bytes, two floats, and more inputs than there are registers for them
const C_SOURCE = String.raw`/* structures by value, each shape the calling conventions sort differently */
#ifdef _WIN32
#define OUT __declspec(dllexport)
#else
#define OUT
#endif
typedef struct { double x, y; } vec2;           /* 16 bytes: two numbers */
typedef struct { int a; double b; } mixed;      /* 16 bytes: a whole number, then a number */
typedef struct { long long a, b, c; } big3;     /* 24 bytes: memory */
typedef struct { char c; short s; } small;      /* 4 bytes */
typedef struct { float f, g; } pairf;           /* 8 bytes of floats */

OUT vec2 vadd(vec2 p, vec2 q) { vec2 r = { p.x + q.x, p.y + q.y }; return r; }
OUT double vlen2(vec2 p) { return p.x * p.x + p.y * p.y; }
OUT mixed mk(int a, double b) { mixed m = { a * 2, b / 2 }; return m; }
OUT double mixed_sum(mixed m) { return m.a + m.b; }
OUT long long sum3(big3 v) { return v.a + v.b + v.c; }
OUT big3 make3(long long a, long long b, long long c) { big3 v = { a, b * 10, c * 100 }; return v; }
OUT small sm(small s) { small r = { (char)(s.c + 1), (short)(s.s * 2) }; return r; }
OUT pairf swapf(pairf p) { pairf r = { p.g, p.f }; return r; }
/* enough before the structures that they don't fit in registers on Linux, and go past Windows' four */
OUT long long many(int a, int b, int c, int d, int e, vec2 v, big3 w, int f) {
  return a + b + c + d + e + (long long)(v.x + v.y) + w.a + w.b + w.c + f;
}
`;
const C_COMPILER = target === "linux" ? ["gcc", "cc"].find((c) => spawnSync(c, ["--version"], { encoding: "utf8" }).status === 0) : null;
test("a library's function takes and gives structures by value, as each system's convention has them", { skip }, () => {
  const division = libraryRun(String.raw`use the library "msvcrt" or "c"
    structure division with quotient as a whole number, rest as a whole number
    "div" as divided(a whole number, a whole number) gives a division by value
end

say divided(17, 5)
say divided(-7, 2)
`);
  assert.deepEqual([division.stdout, division.stderr, division.status], ["(record with quotient 3, rest 2)\n(record with quotient -3, rest -1)\n", "", 0]);
  if (!C_COMPILER) return;
  const dir = mkdtempSync(join(tmpdir(), "moth-byvalue-"));
  try {
    writeFileSync(join(dir, "bv.c"), C_SOURCE);
    const built = spawnSync(C_COMPILER, ["-shared", "-fPIC", "-O2", "-o", join(dir, "libbv.so"), join(dir, "bv.c")], { encoding: "utf8" });
    assert.equal(built.status, 0, built.stderr);
    const exe = executable(dir, "p");
    writeFileSync(exe, machine(String.raw`use the library "./bv.dll" or "./libbv.so"
    structure vec2 with x as a number, y as a number
    structure mixed with a as a whole number, b as a number
    structure big3 with a as a long whole number, b as a long whole number, c as a long whole number
    structure small with c as a signed byte, s as a short whole number
    structure pairf with f as a float, g as a float
    vadd(a vec2 by value, a vec2 by value) gives a vec2 by value
    vlen2(a vec2 by value) gives a number
    mk(a whole number, a number) gives a mixed by value
    mixed_sum(a mixed by value) gives a number
    sum3(a big3 by value) gives a long whole number
    make3(a long whole number, a long whole number, a long whole number) gives a big3 by value
    sm(a small by value) gives a small by value
    swapf(a pairf by value) gives a pairf by value
    many(a whole number, a whole number, a whole number, a whole number, a whole number, a vec2 by value, a big3 by value, a whole number) gives a long whole number
end
use the library "msvcrt" or "c"
    structure division with quotient as a whole number, rest as a whole number
    "div" as divided(a whole number, a whole number) gives a division by value
end

say vadd((record with x 1.5, y 2), record with x 10, y 20)
say vlen2(record with x 3, y 4)
say mk(21, 5)
say mixed_sum(record with a 7, b 0.5)
say sum3(record with a 1, b 2, c 3)
say make3(1, 2, 3)
say sm(record with c 9, s -300)
say swapf(record with f 1.5, g -2.25)
say many(1, 2, 3, 4, 5, (record with x 0.5, y 0.5), (record with a 100, b 200, c 300), 7)
say divided(17, 5)
set p to record with x 1, y 2
say vadd(p, p)
say p
try
    vlen2(nothing)
if it fails with why
    say why
end
try
    vlen2(record with x 1)
if it fails with why
    say why
end
`, { target, name: "p.moth", allow: ["--allow-libraries"] }));
    chmodSync(exe, 0o755);
    const ran = spawnSync(exe, [], { cwd: dir, encoding: "utf8", input: "" });
    assert.deepEqual([ran.stdout, ran.stderr, ran.status], ["(record with x 11.5, y 22)\n25\n(record with a 42, b 2.5)\n7.5\n6\n(record with a 1, b 20, c 300)\n(record with c 10, s -600)\n(record with f -2.25, g 1.5)\n623\n(record with quotient 3, rest 2)\n(record with x 2, y 4)\n(record with x 1, y 2)\n'vlen2' needs input 1 to be a record (a vec2), not nothing\n", "", 0]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Callbacks on threads C made, three at once, while the program waits for them in C
test("a callback runs on a thread C made, as many at once as C makes", { skip }, () => {
  const ran = libraryRun(String.raw`use the library "kernel32"
    callback win_worker(a pointer) gives a whole number
    CreateThread(a pointer, a long whole number, a win_worker, a pointer, a whole number, bytes) gives a pointer
    WaitForSingleObject(a pointer, a whole number) gives a whole number
    CloseHandle(a pointer) gives yes or no
    GetTickCount() gives a whole number
end
use the library "c"
    callback unix_worker(a pointer) gives a pointer
    pthread_create(bytes, a pointer, a unix_worker, a pointer) gives a whole number
    pthread_join(a long whole number, a pointer) gives a whole number
end

set seen to empty list

to work with n
    set total to 0
    for each k from 1 to 200000
        set total to total + k
    end
    add "thread " + n + ": " + total to seen
    return n * 10
end

set on_windows to yes
try
    GetTickCount()
if it fails
    set on_windows to no
end

set handles to empty list
for each n from 1 to 3
    if on_windows
        add CreateThread(nothing, 0, work, n, 0, 4 bytes) to handles
    else
        set made to 8 bytes
        pthread_create(made, nothing, work, n)
        set id to 0
        set k to 8
        repeat while k is at least 1
            set id to id * 256 + byte k of made
            set k to k - 1
        end
        add id to handles
    end
end
for each h in handles
    if on_windows
        WaitForSingleObject(h, -1)
        CloseHandle(h)
    else
        pthread_join(h, nothing)
    end
end
say seen in order
say work(4)
say "done"
`);
  assert.deepEqual([ran.stdout, ran.stderr, ran.status], ["[\"thread 1: 20000100000\", \"thread 2: 20000100000\", \"thread 3: 20000100000\"]\n40\ndone\n", "", 0]);
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
  assert.match(lines.slice(5).join("\n"), /^part 1 of 2 failed: p\.moth:21:18: can't divide by zero\n[^]*in 'falls_over'[^]*\nyes\n$/);
  assert.deepEqual([ran.stderr, ran.status], ["", 0]);
});

// tools/cores.moth with no work_here line (DESIGN §101): each copy runs the program to its own each_at_once,
// told what the ones before gave: two in a row, one in a loop, records, calls inside a part and inside one done
// here, a part's mistake inside the program's own try, one that failed with calls inside it, a copy that came to
// another each_at_once, and no files left
test("tools/cores.moth needs no work_here: a copy runs the program to its own each_at_once", { skip }, () => {
  const ran = libraryRun(String.raw`use "cores.moth" as cores
to doubled with n
    return n * 2
end
to pair_of with n
    return record with n n, words ("x" + n)
end
to inner_sum with n
    return total of cores's each_at_once_on(2, doubled, list of n, n + 1)
end
to falls_over with n
    if n is 3
        return 1 / 0
    end
    return n
end
to nested_fails with n
    if n is 2
        return 1 / 0
    end
    return length of cores's each_at_once_on(2, pair_of, list of n, n)
end
say "said once"
set first to cores's each_at_once_on(3, doubled, list of 1, 2, 3, 4, 5, 6, 7)
say first
say cores's each_at_once_on(2, doubled, first)
for each round from 1 to 2
    say cores's each_at_once_on(2, pair_of, list of round, round + 10)
end
say cores's each_at_once_on(1, inner_sum, list of 1, 2)
say cores's each_at_once_on(2, inner_sum, list of 1, 2)
try
    cores's each_at_once_on(2, falls_over, list of 1, 2, 3, 4)
if it fails with why
    say why
end
say cores's each_at_once_on(2, doubled, list of 5, 6)
try
    cores's each_at_once_on(2, nested_fails, list of 1, 2)
if it fails with why
    say why
end
say cores's each_at_once_on(2, doubled, list of 8, 9)
try
    if length of arguments is 0
        say cores's each_at_once_on(2, doubled, list of 1, 2)
    else
        say cores's each_at_once_on(2, pair_of, list of 1, 2)
    end
if it fails with why
    say why
end
set left to 0
for each name in read the folder "."
    if ".moth-cores" is in name
        set left to left + 1
    end
end
say left`, ["--allow-libraries", "--allow-read", "--allow-write"]);
  assert.deepEqual([ran.stdout, ran.stderr, ran.status], [`said once
[2, 4, 6, 8, 10, 12, 14]
[4, 8, 12, 16, 20, 24, 28]
[(record with n 1, words "x1"), (record with n 11, words "x11")]
[(record with n 2, words "x2"), (record with n 12, words "x12")]
[6, 10]
[6, 10]
part 1 of 2 failed: falls_over failed on item 3: can't divide by zero
[10, 12]
part 2 of 2 failed: nested_fails failed on item 2: can't divide by zero
[16, 18]
part 1 of 2 failed: its copy of the program came to this each_at_once with pair_of, not doubled: what comes before it must come to the same each_at_once in each copy
0
`, "", 0]);
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

// tools/server.moth's connections (DESIGN §123), on raw sockets, so what's checked is what goes over the wire:
// each says something, in pieces with pauses if it likes, and gets back everything until the server closes it,
// or until it has waited `patience` ms for more; reading nothing for `readLate` ms, and then, with `stalls`,
// stopping for each in turn after each 2 MB it reads
function exchange(port, pieces, { pause = 0, patience = 3000, readLate = 0, stalls = [] } = {}) {
  return new Promise((resolve) => {
    const socket = net.connect(port, "127.0.0.1");
    const got = [];
    let timer;
    const done = (closed) => {
      clearTimeout(timer);
      socket.destroy();
      resolve({ said: Buffer.concat(got).toString("latin1"), closed });
    };
    const wait = () => {
      clearTimeout(timer);
      timer = setTimeout(() => done(false), patience);
    };
    let read = 0;
    let stalled = 0;
    socket.on("data", (d) => {
      got.push(d);
      read += d.length;
      wait();
      if (stalled < stalls.length && read >= (stalled + 1) * 2_000_000) {
        socket.pause();
        setTimeout(() => socket.resume(), stalls[stalled++]);
      }
    });
    socket.on("end", () => done(true));
    socket.on("error", () => done(true));
    socket.on("close", () => done(true));
    if (readLate) {
      socket.pause();
      setTimeout(() => socket.resume(), readLate);
    }
    socket.on("connect", async () => {
      for (const piece of pieces) {
        socket.write(piece);
        if (pause) await new Promise((r) => setTimeout(r, pause));
      }
      wait();
    });
  });
}

// what each answer in what came back says: its status line, its Connection header, its length and its body
function answers(text) {
  const made = [];
  let rest = Buffer.from(text, "latin1");
  while (rest.length) {
    const end = rest.indexOf("\r\n\r\n");
    if (end < 0) break;
    const [status, ...lines] = rest.subarray(0, end).toString("latin1").split("\r\n");
    const headers = Object.fromEntries(lines.map((l) => [l.slice(0, l.indexOf(":")).toLowerCase(), l.slice(l.indexOf(":") + 1).trim()]));
    const length = Number(headers["content-length"] ?? 0);
    const body = rest.subarray(end + 4, end + 4 + (status.includes(" 204 ") ? 0 : length));
    made.push({ status, connection: headers.connection, length, body: body.toString("utf8") });
    rest = rest.subarray(end + 4 + body.length);
  }
  return made;
}

test("tools/server.moth keeps connections open, answers requests sent together in order, and keeps its time and size limits", { skip }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "moth-server-"));
  const port = 22000 + (process.pid % 2000);
  let running;
  try {
    const exe = executable(dir, "site");
    writeFileSync(exe, machine(`use "server.moth" as web
set lines to empty list
for each i from 1 to 400000
    add "0123456789abcdefghijklmnopqrstu" to lines
end
set big to (join lines with "\\n") + "\\n"
to answer with request
    set p to path of request
    if p is "/echo"
        return method of request + " " + version of request + " " + length of body_bytes of request + " [" + body of request + "] " + item "x-thing" of headers of request
    else if p is "/big"
        return big
    else if p is "/nothing"
        return nothing
    else if p is "/query"
        return query of request
    else if p is "/stop"
        web's stop_serving()
        return "bye"
    end
    return "page " + p
end
web's set_timeout(400)
web's set_idle_timeout(400)
web's set_most_bytes(100000)
web's set_most_requests(3)
web's serve(${port}, answer)
say "stopped"`, { target, name: "site.moth", allow: ["--allow-libraries"], files: { "server.moth": here("tools/server.moth") } }));
    if (target === "linux") chmodSync(exe, 0o755);
    running = spawn(exe, [], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    running.stdout.on("data", (d) => (out += d));
    running.stderr.on("data", (d) => (err += d));
    const ended = new Promise((resolve) => running.on("exit", resolve));
    for (let waited = 0; !err.includes("listening") && waited < 10000; waited += 20) await new Promise((r) => setTimeout(r, 20));
    const get = (path, more = "") => `GET ${path} HTTP/1.1\r\nHost: x\r\n${more}\r\n`;
    const brief = (r) => answers(r.said).map((a) => `${a.status} ${a.connection} ${a.body.length > 200 ? `${a.body.length} bytes` : a.body}`);

    // three on one connection, one after another, the last told it's the last; two sent together, then HEAD
    // and an answer of nothing on the same connection; HTTP/1.0, which keeps it only if asked
    assert.deepEqual(brief(await exchange(port, [get("/a"), get("/b"), get("/c")], { pause: 100 })),
      ["HTTP/1.1 200 OK keep-alive page /a", "HTTP/1.1 200 OK keep-alive page /b", "HTTP/1.1 200 OK close page /c"]);
    const together = await exchange(port, [get("/one") + get("/two") + `HEAD /three HTTP/1.1\r\n\r\n`]);
    assert.deepEqual(brief(together).slice(0, 2), ["HTTP/1.1 200 OK keep-alive page /one", "HTTP/1.1 200 OK keep-alive page /two"]);
    assert.match(together.said, /page \/twoHTTP\/1\.1 200 OK\r\nContent-Type: text\/plain; charset=utf-8\r\nContent-Length: 11\r\nConnection: close\r\n\r\n$/);
    assert.deepEqual(brief(await exchange(port, [get("/nothing", "Connection: close\r\n")])), ["HTTP/1.1 204 No Content close "]);
    assert.deepEqual(brief(await exchange(port, ["GET /old HTTP/1.0\r\n\r\n"])), ["HTTP/1.1 200 OK close page /old"]);
    assert.deepEqual(brief(await exchange(port, ["GET /old HTTP/1.0\r\nConnection: Keep-Alive\r\n\r\n"], { patience: 1000 })),
      ["HTTP/1.1 200 OK keep-alive page /old"]);

    // a body with its length, in pieces; one in chunks, a byte at a time, with an extension and a trailer
    const body = "name=Sam&note=hi ✓";
    assert.deepEqual(brief(await exchange(port, [`POST /echo HTTP/1.1\r\nContent-Length: ${Buffer.byteLength(body)}\r\nX-Thing:  spaced \r\n\r\n`, body.slice(0, 5), body.slice(5)], { pause: 50 })),
      ["HTTP/1.1 200 OK keep-alive POST HTTP/1.1 20 [name=Sam&note=hi ✓] spaced"]);
    const chunked = "PUT /echo HTTP/1.1\r\nTransfer-Encoding: chunked\r\nX-Thing: c\r\n\r\n5;ext=1\r\nhello\r\n7\r\n, world\r\n0\r\nTrailer: x\r\n\r\n" + get("/after");
    assert.deepEqual(brief(await exchange(port, chunked.match(/[^]{1,3}/g), { pause: 1 })),
      ["HTTP/1.1 200 OK keep-alive PUT HTTP/1.1 12 [hello, world] c", "HTTP/1.1 200 OK keep-alive page /after"]);

    // an answer far bigger than a socket holds, to a client that waits before it reads any of it, then stops
    // five times as it reads: far longer than the time limit in all, so the limit is from the last it took
    const huge = answers((await exchange(port, [get("/big", "Connection: close\r\n")], { readLate: 150, stalls: [150, 150, 150, 150, 150] })).said);
    assert.deepEqual([huge.length, huge[0].length, huge[0].body.length, huge[0].body.slice(0, 33)], [1, 12800000, 12800000, "0123456789abcdefghijklmnopqrstu\n0"]);

    // a query, with a % that isn't one
    assert.deepEqual(answers((await exchange(port, [get("/query?a=1&b=two%20words&c=100%zz&d", "Connection: close\r\n")])).said)[0].body,
      '{"a":"1","b":"two words","c":"100%zz","d":""}');

    // too big, headers too long, what isn't a request, chunks that can't be read; too slow to arrive, and a
    // kept connection with nothing more on it, closed with no answer
    assert.deepEqual(brief(await exchange(port, ["POST /echo HTTP/1.1\r\nContent-Length: 200000\r\n\r\n"])), ["HTTP/1.1 413 Content Too Large close The request is too big"]);
    assert.deepEqual(brief(await exchange(port, [`GET / HTTP/1.1\r\nX-Long: ${"a".repeat(70000)}\r\n\r\n`])),
      ["HTTP/1.1 431 Request Header Fields Too Large close The request's headers are too long"]);
    assert.deepEqual(brief(await exchange(port, ["NONSENSE\r\n\r\n"])), ["HTTP/1.1 400 Bad Request close The request can't be read"]);
    assert.deepEqual(brief(await exchange(port, ["POST /echo HTTP/1.1\r\nContent-Length: 12x\r\n\r\n"])), ["HTTP/1.1 400 Bad Request close The request's length can't be read"]);
    assert.deepEqual(brief(await exchange(port, ["POST /echo HTTP/1.1\r\nContent-Length: 1\r\nContent-Length: 2\r\n\r\nab"])), ["HTTP/1.1 400 Bad Request close The request's length can't be read"]);
    assert.deepEqual(brief(await exchange(port, ["POST /echo HTTP/1.1\r\nTransfer-Encoding: chunked\r\n\r\nzz\r\n"])), ["HTTP/1.1 400 Bad Request close The request's chunks can't be read"]);
    const slow = await exchange(port, ["GET /slow HTTP/1.1\r\nHo"]);
    assert.deepEqual([brief(slow), slow.closed], [["HTTP/1.1 408 Request Timeout close The request took too long to arrive"], true]);
    const idle = await exchange(port, [get("/idle")]);
    assert.deepEqual([brief(idle), idle.closed], [["HTTP/1.1 200 OK keep-alive page /idle"], true]);

    // one client that sends a byte at a time holds up nobody else: another's answer comes first
    const finished = [];
    const dribbling = exchange(port, get("/dribble", "Connection: close\r\n").split(""), { pause: 6 }).then((r) => (finished.push("dribble"), r));
    await new Promise((r) => setTimeout(r, 30));
    const quick = await exchange(port, [get("/quick", "Connection: close\r\n")]);
    finished.push("quick");
    assert.deepEqual([brief(quick), brief(await dribbling), finished], [["HTTP/1.1 200 OK close page /quick"], ["HTTP/1.1 200 OK close page /dribble"], ["quick", "dribble"]]);

    assert.deepEqual(brief(await exchange(port, [get("/stop")])), ["HTTP/1.1 200 OK keep-alive bye"]);
    assert.deepEqual([await ended, out, err], [0, "stopped\n", `listening on http://127.0.0.1:${port}/\n`]);
  } finally {
    running?.kill(); // once it has stopped, nothing; if a check failed, it's still serving
    rmSync(dir, { recursive: true, force: true });
  }
});

// tools/server.moth on workers (DESIGN §124): a handler that works for a second and a half holds up only its own
// worker, while the others answer
test("tools/server.moth answers on workers, so a slow handler holds up only its own", { skip }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "moth-server-"));
  const port = 22000 + ((process.pid + 900) % 2000);
  try {
    const exe = executable(dir, "site");
    writeFileSync(exe, machine(`use "server.moth" as web
set seen to 0
to answer with request
    add 1 to seen
    if path of request is "/slow"
        set t0 to the clock
        repeat while the clock - t0 is less than 1.5
            set n to 0
        end
        return "slow"
    end
    return "seen " + seen
end
web's serve_on_workers(${port}, answer, 3)`, { target, name: "site.moth", allow: ["--allow-libraries"], files: { "server.moth": here("tools/server.moth") } }));
    if (target === "linux") chmodSync(exe, 0o755);
    const running = spawn(exe, [], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    running.stderr.on("data", (d) => (err += d));
    try {
      for (let waited = 0; !err.includes("listening") && waited < 10000; waited += 20) await new Promise((r) => setTimeout(r, 20));
      assert.equal(err, `listening on http://127.0.0.1:${port}/, on 3 workers\n`);
      const ask = async (path) => answers((await exchange(port, [`GET ${path} HTTP/1.1\r\nConnection: close\r\n\r\n`])).said)[0]?.body;
      const slow = ask("/slow");
      await new Promise((r) => setTimeout(r, 200));
      const begun = Date.now();
      const quick = await Promise.all(Array.from({ length: 20 }, () => ask("/")));
      assert.ok(Date.now() - begun < 1000, `the quick requests took ${Date.now() - begun} ms`);
      assert.ok(quick.every((said) => /^seen \d+$/.test(said)), quick.join(", "));
      assert.equal(await slow, "slow");
    } finally {
      running.kill();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// apps/guestbook (docs/guestbook.md): a web app with a SQLite database, built by moth.exe from its own folder with
// the standard library's server, SQLite, HTTP, dates and text: its own tests, then signed and read over HTTP, a
// script given as a name shown as text, an entry with no name refused, the entries as JSON, a 404, and its file
test("apps/guestbook: a web app with a database, built by moth.exe, tested, then signed and read over HTTP", { skip: skip || (!sqliteHere && "SQLite isn't installed") }, async () => {
  const { dir, exe } = mothExe();
  const sub = join(dir, "guestbook");
  mkdirSync(sub);
  for (const name of ["guestbook.moth", "book.moth", "book.test.moth"]) writeFileSync(join(sub, name), here(`apps/guestbook/${name}`));
  const allow = ["--allow-libraries", "--allow-read", "--allow-write"];
  const tested = spawnSync(exe, ["test", "book.test.moth", ...allow], { cwd: sub, encoding: "utf8", timeout: 300_000 });
  assert.deepEqual([tested.stdout.split("\n").at(-2), tested.status], ["4 passed", 0], tested.stdout + tested.stderr);
  const built = spawnSync(exe, ["build", "guestbook.moth", ...allow], { cwd: sub, encoding: "utf8", timeout: 300_000 });
  assert.equal(built.status, 0, built.stdout + built.stderr);
  const port = 23000 + (process.pid % 2000);
  const running = spawn(executable(sub, "guestbook"), [String(port)], { cwd: sub, stdio: ["ignore", "pipe", "pipe"] });
  let out = "", err = "";
  running.stdout.on("data", (d) => (out += d));
  running.stderr.on("data", (d) => (err += d));
  try {
    for (let waited = 0; !err.includes("listening") && waited < 10000; waited += 20) await new Promise((r) => setTimeout(r, 20));
    const site = `http://127.0.0.1:${port}`;
    const form = (fields) => ({ method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields).toString(), redirect: "manual" });
    assert.match(await (await fetch(`${site}/`)).text(), /0 signatures so far/);
    const signed = await fetch(`${site}/sign`, form({ name: "Ada Lovelace", message: "Hello!" }));
    assert.deepEqual([signed.status, signed.headers.get("location")], [303, "/"]);
    assert.equal((await fetch(`${site}/sign`, form({ name: "<script>x</script>", message: "Tom & Jerry" }))).status, 303);
    const refused = await fetch(`${site}/sign`, form({ name: " ", message: "hi" }));
    assert.equal(refused.status, 400);
    assert.match(await refused.text(), /Please write your name\./);
    const page = await (await fetch(`${site}/`)).text();
    assert.match(page, /2 signatures so far/);
    assert.ok(page.includes("&lt;script&gt;x&lt;/script&gt;") && !page.includes("<script>x"), page);
    const entries = await (await fetch(`${site}/api/entries`)).json();
    assert.deepEqual(entries.map((e) => [e.id, e.name, e.message]), [[2, "<script>x</script>", "Tom & Jerry"], [1, "Ada Lovelace", "Hello!"]]);
    assert.match(entries[0].signed, /^\d{1,2} [A-Z][a-z]{2} \d{4}, \d\d:\d\d$/);
    assert.equal((await fetch(`${site}/nowhere`)).status, 404);
    assert.ok(existsSync(join(sub, "guestbook.db")));
  } finally {
    running.kill();
  }
  assert.match(out, /^The guestbook is at http:\/\/localhost:\d+\/ \(Ctrl\+C stops it\)\n/);
});

// tools/server.moth with HTTPS: a certificate made for the test by the openssl command, OpenSSL 3's libraries
// (Linux's own; on Windows, each beside the program in turn: Python's, built with Visual C++, and Git's, built with
// MinGW, which once found no randomness when its libraries were looked for only in the program's folder), and
// Node's https, which trusts that certificate alone, asking: a page, a body in chunks and one with its length, a
// page that isn't there, and a client that doesn't trust it, which the server says couldn't agree on TLS; then a
// certificate or key it can't use
const OPENSSL = ["openssl", "C:/Program Files/Git/usr/bin/openssl.exe", "C:/Program Files/Git/mingw64/bin/openssl.exe"]
  .find((c) => spawnSync(c, ["version"], { encoding: "utf8" }).status === 0);
const SSL_SETS = target !== "windows" ? [null] : (() => {
  const found = spawnSync("python", ["-c", "import sys, os; print(os.path.join(sys.base_prefix, 'DLLs'))"], { encoding: "utf8" });
  return [{ dir: found.status === 0 ? found.stdout.trim() : "", names: ["libssl-3.dll", "libcrypto-3.dll"] },
    { dir: "C:/Program Files/Git/mingw64/bin", names: ["libssl-3-x64.dll", "libcrypto-3-x64.dll"] }]
    .filter((set) => set.dir && set.names.every((n) => existsSync(join(set.dir, n))));
})();
const httpsSkip = skip || (!OPENSSL ? "there's no openssl command" : SSL_SETS.length === 0 ? "there's no OpenSSL 3 here" : false);
test("tools/server.moth answers with HTTPS through OpenSSL, and reads bodies in chunks", { skip: httpsSkip }, async () => {
  for (const [k, set] of SSL_SETS.entries()) await servesHttps(set, 23000 + ((process.pid + 700 * k) % 2000));
});
async function servesHttps(set, port) {
  const dir = mkdtempSync(join(tmpdir(), "moth-https-"));
  try {
    const made = spawnSync(OPENSSL, ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(dir, "key.pem"), "-out", join(dir, "cert.pem"),
      "-days", "2", "-subj", "/CN=localhost", "-addext", "subjectAltName=IP:127.0.0.1,DNS:localhost"], { encoding: "utf8" });
    assert.equal(made.status, 0, made.stderr);
    if (set) for (const n of set.names) writeFileSync(join(dir, n), readFileSync(join(set.dir, n)));
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
}

// tools/sockets.moth's secure connections, with OpenSSL as server.moth's HTTPS test has it: a task of the
// program's connects to it by name, not trusting the certificate, then trusting it, by name and by address; a
// connection made secure after it began, as STARTTLS does, and one for the wrong name; a secure connection's
// bytes OpenSSL has already read count as ready; and each mistake
test("tools/sockets.moth makes connections secure, as client and server, through OpenSSL", { skip: httpsSkip }, () => {
  for (const set of SSL_SETS) {
    const dir = mkdtempSync(join(tmpdir(), "moth-tls-"));
    try {
      const made = spawnSync(OPENSSL, ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(dir, "key.pem"), "-out", join(dir, "cert.pem"),
        "-days", "2", "-subj", "/CN=localhost", "-addext", "subjectAltName=IP:127.0.0.1,DNS:localhost"], { encoding: "utf8" });
      assert.equal(made.status, 0, made.stderr);
      if (set) for (const n of set.names) writeFileSync(join(dir, n), readFileSync(join(set.dir, n)));
      const exe = executable(dir, "p");
      writeFileSync(exe, machine(String.raw`use "sockets.moth" as net

# secure: not trusted yet, then trusted, by name and by address
set tl to net's listen(0)
to secure_client with host, port
    try
        set mine to net's connect_secure(host, port)
        net's send(mine, "hello securely é")
        set back to net's receive_line(mine)
        net's close(mine)
        return back
    if it fails with why
        return why
    end
end
to serve_one with listener
    set mine to net's accept(listener)
    try
        net's secure_as_server(mine, "cert.pem", "key.pem")
        set heard to net's receive(mine, 100) as text
        net's send(mine, uppercase of heard + "\n")
        net's close(mine)
        return heard
    if it fails with why
        net's close(mine)
        return why
    end
end
set job to start secure_client("localhost", net's port_of(tl))
say serve_one(tl)
say wait for job
net's trust("cert.pem")
for each host in list of "localhost", "127.0.0.1"
    set job to start secure_client(host, net's port_of(tl))
    say serve_one(tl)
    say wait for job
end

# made secure after it began, as STARTTLS does; the wrong name
to upgrading_client with port, name
    set mine to net's connect("127.0.0.1", port)
    net's send(mine, "STARTTLS\n")
    set first to net's receive_line(mine)
    try
        net's secure(mine, name)
    if it fails with why
        net's close(mine)
        return first + ", then " + why
    end
    net's send(mine, "now secret\n")
    set back to net's receive_line(mine)
    net's close(mine)
    return first + ", then " + back
end
for each name in list of "localhost", "wrong.example"
    set job to start upgrading_client(net's port_of(tl), name)
    set c to net's accept(tl)
    say net's receive_line(c)
    net's send(c, "220 go ahead\n")
    try
        net's secure_as_server(c, "cert.pem", "key.pem")
        say net's receive_line(c)
        set ready_now to net's ready((list of c), 0)
        net's send(c, "250 secret kept\n")
    if it fails with why
        say why
    end
    net's close(c)
    say wait for job
end
net's close(tl)

# a secure connection's bytes it has already read count as ready
set tl to net's listen(0)
to two_lines with port
    set mine to net's connect_secure("localhost", port)
    net's send(mine, "one\ntwo\n")
    set reply to net's receive_line(mine)
    net's close(mine)
    return reply
end
set job to start two_lines(net's port_of(tl))
set c to net's accept(tl)
net's secure_as_server(c, "cert.pem", "key.pem")
say net's receive_line(c)
say length of net's ready((list of c), 0)
say net's receive_line(c)
net's send(c, "done\n")
say wait for job
net's close(c)
net's close(tl)

# mistakes
try
    net's trust("nowhere.pem")
if it fails with why
    say why
end
set tl to net's listen(0)
try
    net's secure_as_server(net's connect("127.0.0.1", net's port_of(tl)), "nowhere.pem", "key.pem")
if it fails with why
    say why
end
net's close(tl)
try
    net's listen_on("::1", 70000)
if it fails with why
    say why
end
say "done"
`, { target, name: "p.moth", allow: ["--allow-libraries", "--allow-read"], files: { "sockets.moth": readFileSync(new URL("./tools/sockets.moth", import.meta.url), "utf8") } }));
      if (target === "linux") chmodSync(exe, 0o755);
      // on Linux, on one core too, where a task's thread once went back to the next task's stack (DESIGN §85)
      const runs = [[exe, []]];
      if (target === "linux" && spawnSync("taskset", ["-c", "0", "true"]).status === 0) runs.push(["taskset", ["-c", "0", "./p"]]);
      for (const [command, args] of runs) {
        const ran = spawnSync(command, args, { cwd: dir, encoding: "utf8", input: "", timeout: 60000 });
        assert.deepEqual([ran.stdout, ran.stderr, ran.status], ["can't make this connection secure: the other end didn't agree on TLS\ncan't connect securely to localhost: self-signed certificate\nhello securely é\nHELLO SECURELY É\nhello securely é\nHELLO SECURELY É\nSTARTTLS\nnow secret\n220 go ahead, then 250 secret kept\nSTARTTLS\ncan't make this connection secure: the other end didn't agree on TLS\n220 go ahead, then can't connect securely to wrong.example: hostname mismatch\none\n1\ntwo\ndone\ncan't trust the certificates in nowhere.pem: it isn't there, or isn't PEM\ncan't use the certificate in nowhere.pem: it isn't there, or isn't one in PEM\na port is a whole number from 0 to 65535, not 70000\ndone\n", "", 0], `${set?.dir ?? ""} ${command}`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

// tools/email.moth: a message sent through a mail server of the program's own, in a task, over sockets.moth:
// after STARTTLS, logged in with PLAIN, to three addresses (one bcc'd), with a subject in encoded words, a name
// in quotes, text with a line that starts with a dot, a page of HTML and three files; then secure from the
// start, logged in with LOGIN; a password it won't take, a server with no STARTTLS, and messages it can't
// write. Python's email module reads the message back as it was made, where there's a Python
const PYTHON = ["python3", "python"].find((c) => spawnSync(c, ["--version"], { encoding: "utf8" }).status === 0);
test("tools/email.moth sends mail over SMTP, secure and logged in, with HTML and files", { skip: httpsSkip }, () => {
  const set = SSL_SETS[0];
  const dir = mkdtempSync(join(tmpdir(), "moth-mail-"));
  try {
    const made = spawnSync(OPENSSL, ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(dir, "key.pem"), "-out", join(dir, "cert.pem"),
      "-days", "2", "-subj", "/CN=localhost", "-addext", "subjectAltName=IP:127.0.0.1,DNS:localhost"], { encoding: "utf8" });
    assert.equal(made.status, 0, made.stderr);
    if (set) for (const n of set.names) writeFileSync(join(dir, n), readFileSync(join(set.dir, n)));
    const files = {};
    for (const name of ["email.moth", "sockets.moth", "dates.moth", "hash.moth", "base64.moth"]) files[name] = readFileSync(new URL(`./tools/${name}`, import.meta.url), "utf8");
    const exe = executable(dir, "p");
    writeFileSync(exe, machine(String.raw`use "email.moth" as mail
use "sockets.moth" as net

set crlf to (list of 13, 10) as bytes as text

# a mail server of the test's own, for one message: secure at once ("tls"), after STARTTLS ("starttls") or not
# ("plain"), logging in these ways; what it was told, then the message, after a line "--"
to smtp_serve with listener, mode, ways
    set conn to net's accept(listener)
    if mode is "tls"
        net's secure_as_server(conn, "cert.pem", "key.pem")
    end
    set heard to empty list
    set message_lines to empty list
    net's send(conn, "220 test.example ESMTP ready" + crlf)
    set in_data to no
    repeat while yes
        set line to net's receive_line(conn)
        if line is nothing
            net's close(conn)
            return heard
        end
        if in_data
            if line is "."
                set in_data to no
                net's send(conn, "250 2.0.0 queued" + crlf)
            else
                add line to message_lines
            end
        else
            add line to heard
            set word to uppercase of item 1 of split line by " "
            if word is "EHLO"
                set offered to "250-test.example" + crlf
                if mode is "starttls"
                    set offered to offered + "250-STARTTLS" + crlf
                end
                net's send(conn, offered + "250-AUTH " + ways + crlf + "250 8BITMIME" + crlf)
            else if word is "STARTTLS"
                net's send(conn, "220 2.0.0 go ahead" + crlf)
                net's secure_as_server(conn, "cert.pem", "key.pem")
            else if line is "AUTH PLAIN " + mail's base64_of((list of 0) as bytes as text + "sam" + (list of 0) as bytes as text + "secret")
                net's send(conn, "235 2.7.0 welcome" + crlf)
            else if line is "AUTH LOGIN"
                net's send(conn, "334 VXNlcm5hbWU6" + crlf)
                set who to mail's bytes_of_base64(net's receive_line(conn)) as text
                net's send(conn, "334 UGFzc3dvcmQ6" + crlf)
                set secret to mail's bytes_of_base64(net's receive_line(conn)) as text
                add "(logged in as " + who + " with " + secret + ")" to heard
                if who is "sam" and secret is "secret"
                    net's send(conn, "235 2.7.0 welcome" + crlf)
                else
                    net's send(conn, "535 5.7.8 bad credentials" + crlf)
                end
            else if word is "AUTH"
                net's send(conn, "535 5.7.8 bad credentials" + crlf)
            else if word is "MAIL" or word is "RCPT"
                net's send(conn, "250 2.1.0 ok" + crlf)
            else if word is "DATA"
                net's send(conn, "354 go on" + crlf)
                set in_data to yes
            else if word is "QUIT"
                net's send(conn, "221 2.0.0 bye" + crlf)
                net's close(conn)
                add "--" to heard
                for each l in message_lines
                    add l to heard
                end
                return heard
            else
                net's send(conn, "500 what?" + crlf)
            end
        end
    end
end

set listener to net's listen(0)
set port to net's port_of(listener)
set s to mail's server("localhost", port)
set trust of s to "cert.pem"
mail's log_in(s, "sam", "secret")
set m to mail's message("Sam Pudke <sam@example.com>", "you@example.com", "Héllo from Moth, with a subject long enough to go over two encoded words ✓", "Line one\n.a line with a dot first\nLine three, é")
set cc of m to list of "\"Them, Two\" <them@example.com>"
set bcc of m to list of "hidden@example.com"
set html of m to "<p>Hi <b>there</b></p>"
mail's attach_bytes(m, "notes é.txt", "some notes\n", "text/plain")
mail's attach_bytes(m, "data.bin", (list of 0, 1, 2, 250, 255) as bytes, "application/octet-stream")
mail's attach(m, "cert.pem")
set job to start smtp_serve(listener, "starttls", "PLAIN LOGIN")
mail's send(s, m)
for each line in wait for job
    say line
end

# secure from the start, logged in with LOGIN
say "=="
set s2 to mail's server("localhost", port)
set security of s2 to "tls"
set trust of s2 to "cert.pem"
mail's log_in(s2, "sam", "secret")
set job to start smtp_serve(listener, "tls", "LOGIN")
mail's send(s2, mail's message("sam@example.com", (list of "a@example.com", "b@example.com"), "Plain", "Just text."))
set heard to wait for job
for each line in items 1 to 7 of heard
    say line
end

# a password it won't take, a server with no STARTTLS, and messages it can't send
say "=="
set job to start smtp_serve(listener, "starttls", "PLAIN")
mail's log_in(s, "sam", "wrong")
try
    mail's send(s, mail's message("sam@example.com", "you@example.com", "Hi", "x"))
if it fails with why
    say why
end
say item 1 of wait for job
set job to start smtp_serve(listener, "plain", "PLAIN")
set s3 to mail's server("127.0.0.1", port)
try
    mail's send(s3, mail's message("sam@example.com", "you@example.com", "Hi", "x"))
if it fails with why
    say why
end
say item 1 of wait for job
try
    mail's message_text(mail's message("sam@example.com", "you@example.com", "Hi" + crlf + "Bcc: everyone@example.com", "x"))
if it fails with why
    say why
end
try
    mail's message_text(mail's message("sam", "you@example.com", "Hi", "x"))
if it fails with why
    say why
end
try
    mail's message_text(mail's message("sam@example.com", empty list, "Hi", "x"))
if it fails with why
    say why
end
say mail's base64_of("")
say mail's base64_of("M") + " " + mail's base64_of("Mo") + " " + mail's base64_of("Mot") + " " + mail's base64_of("Moth ✓")
say mail's bytes_of_base64(mail's base64_of("Moth ✓")) as text
`, { target, name: "p.moth", allow: ["--allow-libraries", "--allow-read"], files }));
    if (target === "linux") chmodSync(exe, 0o755);
    const ran = spawnSync(exe, [], { cwd: dir, encoding: "utf8", input: "", timeout: 60000 });
    assert.equal(ran.stderr, "");
    assert.match(ran.stdout, /\nDate: (Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d\d (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d\d:\d\d:\d\d \+0000\n/);
    const seen = new Map();
    let said = ran.stdout.replace(/^Date: .*$/m, "Date: (now)").replace(/<[0-9a-f]{24}@example\.com>/g, "<(id)@example.com>")
      .replace(/=_moth_[0-9a-f]{24}/g, (b) => (seen.has(b) || seen.set(b, `=_moth_(${seen.size + 1})`), seen.get(b)));
    said = said.replace(/(filename="cert\.pem"\nContent-Transfer-Encoding: base64\n\n)[A-Za-z0-9+/=\n]+?(\n--=_moth_)/, "$1(the certificate)$2");
    assert.equal(said, "EHLO localhost\nSTARTTLS\nEHLO localhost\nAUTH PLAIN AHNhbQBzZWNyZXQ=\nMAIL FROM:<sam@example.com>\nRCPT TO:<you@example.com>\nRCPT TO:<them@example.com>\nRCPT TO:<hidden@example.com>\nDATA\nQUIT\n--\nFrom: Sam Pudke <sam@example.com>\nTo: you@example.com\nCc: \"Them, Two\" <them@example.com>\nSubject: =?UTF-8?B?SMOpbGxvIGZyb20gTW90aCwgd2l0aCBhIHN1YmplY3QgbG9uZyBlbm91Z2gg?=\n =?UTF-8?B?dG8gZ28gb3ZlciB0d28gZW5jb2RlZCB3b3JkcyDinJM=?=\nDate: (now)\nMessage-ID: <(id)@example.com>\nMIME-Version: 1.0\nContent-Type: multipart/mixed; boundary=\"=_moth_(1)\"\n\n--=_moth_(1)\nContent-Type: multipart/alternative; boundary=\"=_moth_(2)\"\n\n--=_moth_(2)\nContent-Type: text/plain; charset=UTF-8\nContent-Transfer-Encoding: base64\n\nTGluZSBvbmUNCi5hIGxpbmUgd2l0aCBhIGRvdCBmaXJzdA0KTGluZSB0aHJlZSwgw6k=\n--=_moth_(2)\nContent-Type: text/html; charset=UTF-8\nContent-Transfer-Encoding: 7bit\n\n<p>Hi <b>there</b></p>\n--=_moth_(2)--\n--=_moth_(1)\nContent-Type: text/plain\nContent-Disposition: attachment; filename*=UTF-8''notes%20%C3%A9.txt\nContent-Transfer-Encoding: base64\n\nc29tZSBub3Rlcwo=\n--=_moth_(1)\nContent-Type: application/octet-stream\nContent-Disposition: attachment; filename=\"data.bin\"\nContent-Transfer-Encoding: base64\n\nAAEC+v8=\n--=_moth_(1)\nContent-Type: application/octet-stream\nContent-Disposition: attachment; filename=\"cert.pem\"\nContent-Transfer-Encoding: base64\n\n(the certificate)\n--=_moth_(1)--\n==\nEHLO localhost\nAUTH LOGIN\n(logged in as sam with secret)\nMAIL FROM:<sam@example.com>\nRCPT TO:<a@example.com>\nRCPT TO:<b@example.com>\nDATA\n==\nthe mail server said no to logging in: 535 5.7.8 bad credentials\nEHLO localhost\nthe mail server 127.0.0.1 doesn't offer STARTTLS: set security of the server to \"tls\" for one that's secure from the start, or \"none\" to send in the clear\nEHLO localhost\na message's addresses, subject and headers can't have a line end in them\n'sam' isn't an email address\na message needs an address to go to\n\nTQ== TW8= TW90 TW90aCDinJM=\nMoth ✓\n");
    assert.equal(ran.status, 0);
    if (PYTHON) {
      const message = ran.stdout.split("\n--\n")[1].split("\n==\n")[0].split("\n").join("\r\n");
      const read = spawnSync(PYTHON, ["-c", [
        "import email, email.policy, sys",
        "m = email.message_from_bytes(sys.stdin.buffer.read(), policy=email.policy.default)",
        "parts = [m['subject'], m['from'], m['to'], m['cc'], str(m['bcc']), str(m.defects), str([p.defects for p in m.walk() if p.defects])]",
        "parts += [m.get_body(preferencelist=('plain',)).get_content(), m.get_body(preferencelist=('html',)).get_content()]",
        "parts += [a.get_filename() + ' ' + a.get_content_type() + ' ' + a.get_payload(decode=True).hex() for a in m.iter_attachments()]",
        "sys.stdout.buffer.write('\\n'.join(parts).encode('utf8'))"].join("\n")], { input: message, encoding: "utf8" });
      assert.equal(read.status, 0, read.stderr);
      assert.deepEqual(read.stdout.split("\n"), ["Héllo from Moth, with a subject long enough to go over two encoded words ✓", "Sam Pudke <sam@example.com>",
        "you@example.com", "\"Them, Two\" <them@example.com>", "None", "[]", "[]", "Line one\r", ".a line with a dot first\r", "Line three, é",
        "<p>Hi <b>there</b></p>", `notes é.txt text/plain ${Buffer.from("some notes\n").toString("hex")}`, "data.bin application/octet-stream 000102faff",
        `cert.pem application/octet-stream ${readFileSync(join(dir, "cert.pem")).toString("hex")}`]);
    }
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

// `has ended` (DESIGN §94), and sync.moth's lock, queue and flag with tasks that really wait: three tasks each
// adding 20 to a total they read, wait and write back, which without the lock loses most of them
test("a task can be asked whether it has ended, and sync.moth's locks, queues and flags keep tasks in step", { skip }, () => {
  const ran = taskRun(`use "sync.moth" as sync
to nap with ms
    wait ms milliseconds
    return ms
end
set job to start nap(300)
say job has ended
say wait for job
say job has ended
set guard to sync's lock()
set total to 0
to bump with n
    for each k from 1 to n
        sync's take(guard)
        set seen to total
        wait 1 millisecond
        set total to seen + 1
        sync's let_go(guard)
    end
    return n
end
set jobs to list of (start bump(20)), (start bump(20)), (start bump(20))
say sync's wait_for_all(jobs) " " total
set q to sync's queue_holding(3)
to producer
    for each k from 1 to 50
        sync's send(q, k)
    end
    sync's send(q, nothing)
end
to consumer
    set sum to 0
    repeat while yes
        set x to sync's receive(q)
        if x is nothing
            return sum
        end
        set sum to sum + x
    end
end
set c to start consumer()
set p to start producer()
say wait for c
set ready to sync's flag()
to waiter
    sync's wait_for_flag(ready)
    return "saw it"
end
set w to start waiter()
wait 30 milliseconds
say w has ended
sync's raise_flag(ready)
say sync's wait_for_any(list of job, w) is job
say wait for w
try
    say sync's receive_within(sync's queue(), 40)
if it fails with why
    say why
end
say 5 has ended`, { files: { "sync.moth": readFileSync(new URL("./tools/sync.moth", import.meta.url), "utf8") } });
  assert.deepEqual(ran, { stdout: "no\n300\nyes\n[20, 20, 20] 60\n1275\nno\nyes\nsaw it\nnothing came in 40 milliseconds\n",
    stderr: "p.moth:60:7: 'has ended' needs a task, as 'start' gives, not a number\nsay 5 has ended\n      ^\n", status: 1 });
});

// Workers (DESIGN §124): calls on threads of their own, each with a copy of the program's memory, so they run
// Moth at the same moment. What a program with workers says must be what the JavaScript engine says, which runs
// each worker when it's started, on copies all the same.
const WORKER_PROGRAMS = [
  // eight at once, each making far more than it keeps, so each collector runs while the others work; records,
  // made in the worker, whose fields the program then reads; and texts the worker makes and the program's own
  "to churn with tag, rounds\n    set kept to empty list\n    for each r from 1 to rounds\n        set garbage to empty list\n        for each i from 1 to 2000\n            add (record with at i, word tag + i) to garbage\n        end\n        add item r of garbage to kept\n    end\n    set sum to 0\n    for each k in kept\n        add at of k to sum\n    end\n    return record with tag tag, sum sum, last word of item rounds of kept, made \"by a worker\"\nend\nset jobs to empty list\nfor each k from 1 to 8\n    add (start churn(\"w\" + k, 150) on another core) to jobs\nend\nfor each j in jobs\n    set got to wait for j\n    say tag of got \" \" sum of got \" \" last of got \" \" made of got\nend",
  // workers that start workers, and a worker's own tasks, which take turns with it alone
  "to fib with n\n    if n is less than 2\n        return n\n    end\n    return fib(n - 1) + fib(n - 2)\nend\nto split_fib with n\n    if n is less than 18\n        return fib(n)\n    end\n    set a to start split_fib(n - 1) on another core\n    set b to start split_fib(n - 2) on another core\n    return (wait for a) + (wait for b)\nend\nto tasks_inside with n\n    set jobs to empty list\n    for each i from 1 to n\n        add (start fib(i)) to jobs\n    end\n    set sum to 0\n    for each j in jobs\n        set sum to sum + wait for j\n    end\n    return sum\nend\nsay wait for (start split_fib(24) on another core)\nsay wait for (start tasks_inside(20) on another core)",
  // the program's tasks, working while worker after worker, each in the memory of the one before it, starts tasks of its own
  "to fib with n\n    if n is less than 2\n        return n\n    end\n    return fib(n - 1) + fib(n - 2)\nend\nto tasks_inside with n\n    set jobs to empty list\n    for each i from 1 to n\n        add (start fib(i)) to jobs\n    end\n    set sum to 0\n    for each j in jobs\n        set sum to sum + wait for j\n    end\n    return sum\nend\nset main_jobs to empty list\nfor each k from 1 to 8\n    add (start fib(20 + k)) to main_jobs\nend\nset sums to empty list\nfor each k from 1 to 30\n    add (wait for (start tasks_inside(k) on another core)) to sums\nend\nsay sums\nset got to empty list\nfor each j in main_jobs\n    add (wait for j) to got\nend\nsay got",
  // three thousand, one after another, each in the memory the one before it had; and sixty-four at once
  "to sq with n\n    return n * n\nend\nset sum to 0\nfor each i from 1 to 3000\n    add wait for (start sq(i) on another core) to sum\nend\nsay sum\nset jobs to empty list\nfor each i from 1 to 64\n    add (start sq(i) on another core) to jobs\nend\nset sum to 0\nfor each j in jobs\n    add wait for j to sum\nend\nsay sum",
  // a big list given and given back, with the program's variables, which a worker changes only for itself
  "set table to dictionary where \"a\" is list of 1, 2\nset count to 0\nto grow with xs\n    set made to empty list\n    for each x in xs\n        add (list of x, \"n\" + x) to made\n    end\n    set inner to item \"a\" of table\n    add 3 to inner\n    set count to count + length of xs\n    return record with made made, table table, count count\nend\nset xs to empty list\nfor each i from 1 to 100000\n    add i to xs\nend\nset got to wait for (start grow(xs) on another core)\nsay length of made of got \" \" item 100000 of made of got \" \" table of got \" \" count of got\nsay table \" \" count",
  // what a worker says comes before the program's next words, and one the program never waits for still ends
  "to note with word\n    say \"a worker says \" + word\n    return word\nend\nsay \"before\"\nsay wait for (start note(\"hi\") on another core)\nstart note(\"bye\") on another core\nsay \"the program goes on\"",
  // a mistake a worker ends with, which the program fails with when it waits for it, saying where it waited
  "to risky with n\n    if n is 0\n        return 1 / 0\n    end\n    return risky(n - 1)\nend\nset j to start risky(2) on another core\nsay \"started\"\nsay wait for j\nsay \"never\"",
];

test("workers run on threads of their own, with copies, and say, fail and give back what the JavaScript engine has them do", { skip }, () => {
  for (const source of WORKER_PROGRAMS) assert.deepEqual(taskRun(source), tasksOnEngine(source, "p.moth"), source);
});

// What only threads show: two workers that each wait for the other to write a file, which they can do only at
// the same moment; one that's still working when it's asked; and a worker's tasks, with sync.moth's lock,
// which keeps them in step inside it
test("workers run at the same moment as the program and each other", { skip }, () => {
  const ran = taskRun(`use "sync.moth" as sync
to meet with mine, theirs
    write "here" to mine
    set waited to 0
    repeat while waited is less than 500
        try
            set said to read theirs
            return mine + " met " + theirs
        if it fails
            wait 10 milliseconds
            add 1 to waited
        end
    end
    return mine + " waited alone"
end
set a to start meet("a.txt", "b.txt") on another core
set b to start meet("b.txt", "a.txt") on another core
say wait for a
say wait for b
to nap with ms
    wait ms milliseconds
    return ms
end
set n to start nap(300) on another core
say n has ended
say wait for n
say n has ended
set lock_of_mine to sync's lock()
set shared to 0
to add_up with times
    for each k from 1 to times
        sync's take(lock_of_mine)
        set seen to shared
        wait 1 millisecond
        set shared to seen + 1
        sync's let_go(lock_of_mine)
    end
    return shared
end
to three_tasks with times
    set jobs to list of (start add_up(times)), (start add_up(times)), (start add_up(times))
    sync's wait_for_all(jobs)
    return shared
end
say wait for (start three_tasks(15) on another core) " " shared
say sync's wait_for_all(list of (start nap(20) on another core), (start nap(10) on another core))`,
  { files: { "sync.moth": readFileSync(new URL("./tools/sync.moth", import.meta.url), "utf8") } });
  assert.deepEqual(ran, { stdout: "a.txt met b.txt\nb.txt met a.txt\nno\n300\nyes\n45 0\n[20, 10]\n", stderr: "", status: 0 });
});

// Four workers, each doing what four calls one after another do a quarter of, take far less time, where there are cores
test("workers use every core", { skip: skip || (availableParallelism() < 2 && "this computer has one core") }, () => {
  const ran = taskRun(`to busy with n
    set sum to 0
    for each i from 1 to n
        set sum to sum + (remainder of i divided by 7)
    end
    return sum
end
set n to 40000000
set t0 to the clock
for each k from 1 to 4
    set r to busy(n)
end
set alone to the clock - t0
set t0 to the clock
set jobs to empty list
for each k from 1 to 4
    add (start busy(n) on another core) to jobs
end
for each j in jobs
    set r to wait for j
end
set together to the clock - t0
say together / alone`);
  assert.equal(ran.status, 0, ran.stderr);
  const ratio = Number(ran.stdout);
  assert.ok(ratio < (availableParallelism() >= 4 ? 0.6 : 0.8), `four workers took ${ratio} of the time four calls one after another did`);
});

test("a program with workers takes its threads and its workers' memory from the system, on Windows as on Linux", () => {
  const source = "to f\n    return 1\nend\nsay wait for (start f() on another core)";
  const windows = Buffer.from(machine(source, { target: "windows", name: "p.moth" })).toString("latin1");
  const plain = Buffer.from(machine("to f\n    return 1\nend\nsay wait for (start f())", { target: "windows", name: "p.moth" })).toString("latin1");
  for (const name of ["CreateThread", "VirtualAlloc", "CreateEventW", "SetEvent", "ResetEvent", "WaitForSingleObject", "ExitThread", "SwitchToThread"]) {
    assert.ok(windows.includes(name), name);
  }
  assert.ok(!plain.includes("SwitchToThread"));
  assert.ok(machine(source, { target: "linux", name: "p.moth" }).length > 0);
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
