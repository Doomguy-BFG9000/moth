import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import examples from "./examples.js";

const CLI = fileURLToPath(new URL("./cli.js", import.meta.url));
const node = (args, input) => spawnSync(process.execPath, args, { input, encoding: "utf8" });
const moth = (args, input) => node([CLI, ...args], input);

function tempFile(t, name, text) {
  const dir = mkdtempSync(join(tmpdir(), "moth-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, name);
  writeFileSync(file, text);
  return file;
}

test("moth run prints what the program says", (t) => {
  const result = moth(["run", tempFile(t, "fizzbuzz.moth", examples["FizzBuzz"])]);
  assert.equal(result.status, 0);
  assert.equal(result.stdout.split("\n").slice(0, 5).join(" "), "1 2 Fizz 4 Buzz");
});

test("moth run saves a drawing as an SVG next to the program", (t) => {
  const file = tempFile(t, "square.moth", 'pen color "red"\nrepeat 4 times\n    move forward 10\n    turn right 90\nend');
  const result = moth(["run", file]);
  assert.equal(result.status, 0);
  assert.equal(result.stderr.trim(), `drew 4 lines -> ${file.replace(/\.moth$/, ".svg")}`);
  const picture = readFileSync(file.replace(/\.moth$/, ".svg"), "utf8");
  assert.match(picture, /viewBox="-11 -21 32 32"/); // the 10 by 10 square, 11 units of padding around it
  assert.equal(picture.match(/<line x1="0" y1="0" x2="0" y2="-10" stroke="red" stroke-width="2"\/>/g).length, 1); // y flipped for SVG
  assert.equal(picture.match(/<line /g).length, 4);
});

test("moth build makes a file that runs on plain node and prints the same", (t) => {
  const file = tempFile(t, "counter.moth", examples["Counter"]);
  assert.equal(moth(["build", file]).status, 0);
  const compiled = node([file.replace(/\.moth$/, ".mjs")]);
  assert.equal(compiled.status, 0);
  assert.equal(compiled.stdout, moth(["run", file]).stdout);
});

test("errors name the file, line and column, compiled or not", (t) => {
  const file = tempFile(t, "errors.moth", examples["Errors"]);
  const expected = "errors.moth:3:5: there is no item 5, the list only has 2 items\nsay item 5 of fruits\n    ^";
  const ran = moth(["run", file]);
  assert.equal(ran.status, 1);
  assert.equal(ran.stderr.trim(), `${file}${expected.slice("errors.moth".length)}`);
  moth(["build", file]);
  const compiled = node([file.replace(/\.moth$/, ".mjs")]);
  assert.equal(compiled.status, 1);
  assert.equal(compiled.stderr.trim(), expected);
});

test("moth bytecode shows the compiled instructions", (t) => {
  const result = moth(["bytecode", tempFile(t, "hello.moth", 'say "hi"')]);
  assert.equal(result.stdout, 'main:\n     0  CONST         0        ; "hi"\n     2  SAY           1\n     4  HALT\n');
});

test("the shell remembers earlier entries, waits for 'end', and survives mistakes", () => {
  const result = moth([], 'set x to 21\nto double with n\n    return n * 2\nend\nsay double(x)\nsay nope\nsay "still here: " x\n');
  assert.equal(result.status, 0);
  assert.match(result.stdout, /42/);
  assert.match(result.stdout, /\.\.\.\.> /); // asked for the rest of the block
  assert.match(result.stderr, /line 1: 'nope' has no value yet/);
  assert.match(result.stdout, /still here: 21/);
});

test("moth check lists problems without running, and fails only on real mistakes", (t) => {
  const bad = moth(["check", tempFile(t, "bad.moth", 'set name to "Moth"\nsay name * 2\nset spare to 1')]);
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /bad\.moth:2:10: will fail: can't use '\*' on text and a number\nsay name \* 2\n {9}\^/);
  assert.match(bad.stdout, /bad\.moth:3:1: unused: 'spare' is set but never used/);
  const fine = moth(["check", tempFile(t, "fine.moth", examples["Counter"])]);
  assert.equal(fine.status, 0);
  assert.match(fine.stdout, /no problems found/);
});

test("moth js shows the JavaScript the JIT makes", (t) => {
  const result = moth(["js", tempFile(t, "hello.moth", 'say "hi"')]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /"use strict";[\s\S]*say\(\["hi"\]\);/);
});

test("moth wasm shows the WebAssembly module the third engine makes", (t) => {
  const result = moth(["wasm", tempFile(t, "hello.moth", 'say "hi"')]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^;; \d+ bytes\n\(func \$init[\s\S]*\(func \$main[\s\S]*call \$moth\.say/);
});

test("moth run finds a used file next to the program, and points into it when it fails, with the calls that led there", (t) => {
  const file = tempFile(t, "main.moth", 'use "lib.moth"\nsay double(21)\nbreak_it');
  writeFileSync(join(file, "..", "lib.moth"), "to double with n\n    return n * 2\nend\nto break_it\n    say 1 / 0\nend");
  const result = moth(["run", file]);
  assert.equal(result.stdout, "42\n");
  assert.equal(result.stderr, "lib.moth:5:11: can't divide by zero\n    say 1 / 0\n          ^\n  in 'break_it', called from line 3\n");
  // a built program shows the trail too
  assert.equal(moth(["build", file]).status, 0);
  const built = node([file.replace(/\.moth$/, ".mjs")]);
  assert.equal(built.stderr, "lib.moth:5:11: can't divide by zero\n    say 1 / 0\n          ^\n  in 'break_it', called from line 3\n");
});

test("moth run answers ask from what's typed in", (t) => {
  const result = moth(["run", tempFile(t, "ask.moth", 'set name to ask "Name?"\nsay "Hi " name')], "Sam\n");
  assert.equal(result.stdout, "Name? Sam\nHi Sam\n");
});

// The playground's script isn't run by any test, so at least it must parse: node --check on a copy of it.
test("the playground's script has no syntax errors", (t) => {
  const page = readFileSync(new URL("./index.html", import.meta.url), "utf8");
  const script = page.slice(page.indexOf('<script type="module">') + '<script type="module">'.length, page.lastIndexOf("</script>"));
  const result = node(["--check", tempFile(t, "playground.mjs", script)]);
  assert.equal(result.status, 0, result.stderr);
});

test("moth bootstrap compiles the compiler written in Moth with itself", () => {
  const result = moth(["bootstrap"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.match(/the same JavaScript/g).length, 3);
  assert.match(result.stdout, /^fixed point: /m);
});

test("bad usage and missing files get a clear message", () => {
  const usage = moth(["frobnicate"]);
  assert.equal(usage.status, 2);
  assert.match(usage.stderr, /^usage:/);
  const missing = moth(["run", "no-such-file.moth"]);
  assert.equal(missing.status, 1);
  assert.equal(missing.stderr.trim(), "moth: can't read no-such-file.moth (no such file)");
});

// ---------- files and arguments ----------

test("moth run passes on arguments, and the program reads and writes files where it runs; so does a built one", (t) => {
  const file = tempFile(t, "shout.moth", 'set text to read item 1 of arguments\nwrite uppercase of text to item 2 of arguments\nsay "wrote " item 2 of arguments');
  const dir = dirname(file);
  writeFileSync(join(dir, "in.txt"), "hello");
  const inDir = (args) => spawnSync(process.execPath, args, { cwd: dir, encoding: "utf8" });
  for (const [engine, out] of [["jit", "a.txt"], ["wasm", "b.txt"], ["vm", "c.txt"]]) {
    const result = inDir([CLI, "run", file, "--engine", engine, "in.txt", out]);
    assert.equal(result.stdout, `wrote ${out}\n`, engine);
    assert.equal(readFileSync(join(dir, out), "utf8"), "HELLO", engine);
  }
  assert.equal(moth(["build", file]).status, 0);
  const built = inDir([file.replace(/\.moth$/, ".mjs"), "in.txt", "d.txt"]);
  assert.equal(built.stdout, "wrote d.txt\n");
  assert.equal(readFileSync(join(dir, "d.txt"), "utf8"), "HELLO");
  const missing = inDir([CLI, "run", file, "nowhere.txt", "e.txt"]);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /shout\.moth:1:13: there is no file called 'nowhere\.txt'/);
});
