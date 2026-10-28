import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

test("bad usage and missing files get a clear message", () => {
  const usage = moth(["frobnicate"]);
  assert.equal(usage.status, 2);
  assert.match(usage.stderr, /^usage:/);
  const missing = moth(["run", "no-such-file.moth"]);
  assert.equal(missing.status, 1);
  assert.equal(missing.stderr.trim(), "moth: can't read no-such-file.moth (no such file)");
});
