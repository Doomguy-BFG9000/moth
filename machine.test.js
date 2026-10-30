// machine.moth, Moth's machine-code back end, against the JavaScript engine: every program it can make
// machine code of becomes a program for this system, which runs and must print, write as a mistake and exit
// exactly as the JavaScript engine does. Windows and Linux only.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run, machineCompiler, excerpt, describeTrail, MothError } from "./moth.js";
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
};

// What the JavaScript engine prints for p.moth, writes as a mistake, and exits with; null for a program too long to wait for.
function onEngine(source, name) {
  let stdout = "";
  const ask = (question) => {
    stdout += `${question} \n`; // the question, then a line of its own, as the input has ended
    return null;
  };
  try {
    run(source, (line) => (stdout += `${line}\n`), { maxSteps: 3_000_000, file: name, ask, disk: NOTHING_ALLOWED, args: [] });
    return { stdout, stderr: "", status: 0 };
  } catch (err) {
    if (!(err instanceof MothError)) throw err;
    if (/^stopped after/.test(err.reason)) return null;
    let stderr = `${err.file ?? name}:${err.line}:${err.col}: ${err.reason}\n${excerpt(source, err)}\n`;
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
  const made = machine(sources["moth.moth"], { files: { "machine.moth": sources["machine.moth"], "compiler.moth": sources["compiler.moth"] }, target, name: "moth.moth", allow: ["--allow-read", "--allow-write"] });
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
  const again = spawnSync(exe, ["build", "moth.moth", "--allow-read", "--allow-write"], { cwd: dir, encoding: "utf8", timeout: 120_000 });
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
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /there is no file called 'nowhere\.moth'/);
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
    for (const bad of ["--allow-everything", "--allow-all=x"]) { // not a flag moth knows: it says how to use it, and builds nothing
      const dir = setUp();
      const said = spawnSync(exe, ["build", "tool.moth", bad], { cwd: dir, encoding: "utf8" });
      assert.match(said.stdout, /^usage: moth build/, bad);
      assert.ok(!existsSync(executable(dir, "tool")), bad);
    }
  } finally {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  }
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
