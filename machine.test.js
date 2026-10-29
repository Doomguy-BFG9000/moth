// machine.moth, Moth's machine-code back end, against the JavaScript engine: every program it can make
// machine code of becomes a program for this system, which runs and must print, write as a mistake and exit
// exactly as `moth run` does. Windows and Linux only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

// What `moth run p.moth` prints, writes as a mistake, and exits with; null for a program too long to wait for.
function onEngine(source, name) {
  let stdout = "";
  try {
    run(source, (line) => (stdout += `${line}\n`), { maxSteps: 3_000_000, file: name });
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
  not('set b to 4 bytes', /^line 1: 'bytes' can't become machine code yet/);
  not("try\n    say 1\nif it fails\n    say 2\nend", /^line 1: 'try' can't become machine code yet/);
  not("to f\n    to g\n        say 1\n    end\nend", /^line 2: a function made inside a function can't become machine code yet/);
  not("to f\n    return 1\nend\nset g to f", /^line 4: a function used as a value \('f'\) can't become machine code yet/);
  not("say 1 +", /^line 1: expected a value but found the end of the code$/); // a mistake in the program, as run says it
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
