// machine.moth, Moth's machine-code back end, against the JavaScript engine: every program it can make
// machine code of becomes a program for this system, which runs and must print, write as a mistake and exit
// exactly as `moth run` does. Windows and Linux only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { run, machineCompiler, excerpt, describeTrail, MothError } from "./moth.js";
import examples from "./examples.js";
import { PROGRAMS, ERRORS, brokenPrograms } from "./cases.js";
import { MACHINE_CASES, machinePrograms } from "./machine-programs.js";

const here = (file) => readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
const target = { win32: "windows", linux: "linux" }[process.platform];
const skip = target ? false : "machine.moth makes programs for Windows and Linux";
const machine = machineCompiler(here("machine.moth"), here("compiler.moth"));
const executable = (dir, name) => join(dir, target === "windows" ? `${name}.exe` : name);

// What `moth run` gives a program started away from a terminal, with no --allow flags and nothing to read:
// every file and site refused, as run refuses them, and each question asked with no answer to it.
const refused = (doing) => () => {
  throw new Error(`this program isn't allowed to ${doing}`);
};
const NOTHING_ALLOWED = {
  read: (name) => refused(/^https?:\/\//i.test(name) ? "go online (start it with --allow-net)" : "read files (start it with --allow-read)")(),
  write: refused("write files (start it with --allow-write)"),
};

// What `moth run p.moth` prints, writes as a mistake, and exits with; null for a program too long to wait for.
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

test("machine code says, fails and exits exactly as moth run does", { skip }, () => {
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
  not('say uppercase of "a"', /^line 1: 'uppercase' can't become machine code yet/);
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

test("garbage: programs that make far more than they keep say what moth run says", { skip }, () => {
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
// trained network's weights, say) stays small, and a mistake at its end still shows it as moth run does.
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
});

test("a program becomes the same bytes each time, as a PE file for Windows and an ELF file for Linux", () => {
  const source = MACHINE_CASES[2];
  const windows = machine(source, { target: "windows", name: "f.moth" });
  const linux = machine(source, { target: "linux", name: "f.moth" });
  assert.deepEqual([...windows.slice(0, 2)], [0x4d, 0x5a]); // MZ
  assert.deepEqual([...linux.slice(0, 4)], [0x7f, 0x45, 0x4c, 0x46]); // \x7fELF
  assert.deepEqual(machine(source, { target: "windows", name: "f.moth" }), windows);
});

test("moth build --exe writes a program of its own, which uses files as moth run does", { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), "moth-machine-"));
  try {
    writeFileSync(join(dir, "shapes.moth"), "to square with n\n    return n * n\nend\nto check with n\n    if n is less than 0\n        fail with \"below 0\"\n    end\n    return n\nend\n");
    writeFileSync(join(dir, "main.moth"), 'use "shapes.moth" as shapes\nsay shapes\'s square(12)\nsay shapes\'s check(0 - 1)\n');
    const built = spawnSync(process.execPath, [fileURLToPath(new URL("./cli.js", import.meta.url)), "build", "--exe", "main.moth"], { cwd: dir, encoding: "utf8" });
    assert.equal(built.status, 0, built.stderr);
    assert.match(built.stdout, /^compiled main\.moth to machine code for (Windows|Linux) -> main(\.exe)? \(.* bytes\)\n$/);
    const ran = spawnSync(executable(dir, "main"), [], { cwd: dir, encoding: "utf8" });
    assert.equal(ran.stdout, "144\n");
    assert.equal(ran.stderr, "shapes.moth:6:9: below 0\n        fail with \"below 0\"\n        ^\n  in 'shapes's check', called from line 3\n");
    assert.equal(ran.status, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// A program that takes arguments, asks, reads and writes, built with and without --allow flags, against `moth
// run` given the same flags, arguments and input, each in a folder of its own with the same files in it.
test("moth build --exe builds --allow flags in, and its program reads, writes, asks and takes arguments as moth run does", { skip }, () => {
  const cli = fileURLToPath(new URL("./cli.js", import.meta.url));
  const source = [
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
  const setUp = () => {
    const dir = mkdtempSync(join(tmpdir(), "moth-machine-"));
    writeFileSync(join(dir, "tool.moth"), source);
    writeFileSync(join(dir, "in.txt"), "hello\n");
    mkdirSync(join(dir, "data"));
    writeFileSync(join(dir, "data", "big.txt"), "é".repeat(100_000));
    return dir;
  };
  const outFile = (dir) => (existsSync(join(dir, "out.txt")) ? readFileSync(join(dir, "out.txt"), "utf8") : null);
  const dirs = [];
  try {
    for (const flags of [[], ["--allow-read"], ["--allow-read", "--allow-write"], ["--allow-all"], ["--allow-read=data,in.txt", "--allow-write=."],
      ["--allow-read=data", "--allow-write=data", "--allow-net=example.com"]]) {
      const [made, ran] = [setUp(), setUp()];
      dirs.push(made, ran);
      const built = spawnSync(process.execPath, [cli, "build", "--exe", "tool.moth", ...flags], { cwd: made, encoding: "utf8" });
      assert.equal(built.status, 0, built.stderr);
      const args = ["one", "two words", 'q"uote', ""];
      const input = "Sam\r\nagain";
      const got = spawnSync(executable(made, "tool"), args, { cwd: made, encoding: "utf8", input });
      const want = spawnSync(process.execPath, [cli, "run", "tool.moth", ...flags, ...args], { cwd: ran, encoding: "utf8", input });
      assert.deepEqual({ stdout: got.stdout, stderr: got.stderr, status: got.status, out: outFile(made) },
        { stdout: want.stdout, stderr: want.stderr, status: want.status, out: outFile(ran) }, flags.join(" "));
    }
    const bad = spawnSync(process.execPath, [cli, "build", "--exe", "tool.moth", "--allow-everything"], { cwd: dirs[0], encoding: "utf8" });
    assert.equal(bad.status, 2);
    assert.equal(spawnSync(process.execPath, [cli, "build", "--exe", "tool.moth", "--allow-all=x"], { cwd: dirs[0], encoding: "utf8" }).status, 2);
  } finally {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  }
});
