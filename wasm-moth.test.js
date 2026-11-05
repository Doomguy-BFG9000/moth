// wasm.moth, Moth's WebAssembly back end written in Moth, against wasm.js and the VM. It must make exactly the
// bytes wasm.js makes, on every program the engines are tested with, and what it makes must say, draw and
// stop at what the VM does: the same output, the same mistakes, at the same spots, with the same trails.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { run, compileToWasmBytes, wasmMothCompiler, MothError } from "./moth.js";
import examples from "./examples.js";
import { generatePrograms } from "./generate.js";
import { PROGRAMS, ERRORS, SAVING, TYPED, brokenPrograms } from "./cases.js";
import { machinePrograms } from "./machine-programs.js";

const here = (file) => readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
const compileWasm = wasmMothCompiler(here("wasm.moth"), here("compiler.moth"));

// every program the engines are tested with: the playground's examples, the hand-written cases, and the
// random programs the fuzzers make, broken on purpose or not
const CORPUS = [...Object.values(examples), ...PROGRAMS.map(([source]) => source), ...ERRORS.map(([source]) => source),
  ...SAVING.map(([source]) => source), ...TYPED, ...generatePrograms(2026, 1500), ...brokenPrograms(42, 5000), ...machinePrograms(7, 500)];

// a program's bytes, or the mistake that stopped it being compiled
function made(compile, source) {
  try {
    return compile(source).bytes;
  } catch (err) {
    if (!(err instanceof MothError)) throw err;
    return `line ${err.line}, column ${err.col}: ${err.message}`;
  }
}

test("wasm.moth makes wasm.js's bytes, byte for byte, on every program the engines are tested with", () => {
  let compiled = 0;
  for (const source of CORPUS) {
    const want = made(compileToWasmBytes, source);
    const got = made(compileWasm, source);
    if (typeof want === "string") assert.equal(got, want, source);
    else {
      assert.ok(got instanceof Uint8Array && Buffer.compare(Buffer.from(got), Buffer.from(want)) === 0, `different bytes for:\n${source}`);
      compiled++;
    }
  }
  assert.ok(compiled > 4000, `only ${compiled} programs compiled`); // most of them, and the rest stop at the same mistake
});

// Everything one engine does with a program, as in moth.test.js: what it said and drew, and the mistake it stopped at.
function outcome(source, engine, options = {}) {
  const said = [];
  const drawn = [];
  try {
    run(source, (line) => said.push(line), { engine, maxSteps: 10_000, draw: (line) => drawn.push(line), ...options });
    return { said, drawn };
  } catch (err) {
    if (!(err instanceof MothError)) assert.fail(`the ${engine} engine crashed with ${err.stack}\non this program:\n${source}`);
    return { said, drawn, error: [err.message, err.line, err.col, err.trail] };
  }
}

const onWasmMoth = (source, options = {}) => outcome(source, "wasm", { ...options, wasm: (text) => compileWasm(text, options.wasmFiles) });

test("what wasm.moth makes does what the VM does: the same output, drawing and mistakes, on every program", () => {
  for (const source of [...Object.values(examples), ...PROGRAMS.map(([s]) => s), ...TYPED, ...generatePrograms(2026, 1500), ...brokenPrograms(42, 5000)]) {
    assert.deepEqual(onWasmMoth(source), outcome(source, "vm"), source);
  }
});

test("the hand-written cases say what they should on wasm.moth's modules, and stop at the mistakes they should", () => {
  for (const [source, want] of PROGRAMS) assert.equal(onWasmMoth(source, { maxSteps: Infinity }).said.join("\n"), want, source);
  for (const [source, want] of ERRORS) assert.equal(onWasmMoth(source, { maxSteps: Infinity }).error?.[0], want, source);
});

// Escape analysis once missed the values inside `ask`, `wait` and `play note`: a function that used an outer
// variable only there kept it in a local of the program's, and found it unset.
test("a function's use of an outer variable inside ask, wait and play keeps it, on every engine", () => {
  const programs = [
    ['set q to "hi"\nto f\n    say ask q\nend\nf()', ["a"]],
    ['set n to 0\nto f\n    wait n seconds\n    say "waited"\nend\nf()', ["waited"]],
    ['set n to "C"\nto f\n    play note n for 1 second\n    say "played"\nend\nf()', ["played"]],
    ['set n to 1\nto f\n    play note "C" for n seconds\n    say "played"\nend\nf()', ["played"]],
  ];
  for (const [source, want] of programs) {
    for (const engine of ["vm", "jit", "wasm"]) assert.deepEqual(outcome(source, engine, { ask: () => "a" }).said, want, `${engine}: ${source}`);
    assert.deepEqual(onWasmMoth(source, { ask: () => "a" }).said, want, source);
  }
});

test("wasm.moth reads the files a program uses, and points at mistakes in them", () => {
  const files = { "shapes.moth": "to area with w, h\n    return w * h\nend\nset unit to 2\n", "broken.moth": "say 1\nsay (2\n" };
  const lookup = (name) => files[name];
  const source = 'use "shapes.moth"\nsay area(3, unit)';
  assert.deepEqual(onWasmMoth(source, { files: lookup, wasmFiles: files }), outcome(source, "vm", { files: lookup }));
  assert.deepEqual(onWasmMoth(source, { files: lookup, wasmFiles: files }).said, ["6"]);
  const named = 'use "shapes.moth" as shapes\nsay shapes\'s area(2, 5)';
  assert.deepEqual(onWasmMoth(named, { files: lookup, wasmFiles: files }).said, ["10"]);
  assert.equal(made((text) => compileWasm(text, files), 'use "broken.moth"'), made((text) => compileToWasmBytes(text, { files: lookup }), 'use "broken.moth"'));
  assert.match(made((text) => compileWasm(text, files), 'use "missing.moth"'), /missing\.moth/);
});

// The step before moth.wasm: wasm.moth, with compiler.moth, is a program like any other, so it compiles itself
// into wasm.js's bytes, and that module, run, compiles a program into the same bytes again.
test("wasm.moth compiles itself into wasm.js's bytes, and the module it makes compiles programs as it does", () => {
  const files = { "compiler.moth": here("compiler.moth"), "wasm.moth": here("wasm.moth") };
  const program = 'to f with n\n    return n * 2\nend\nsay "twice 21 is " f(21)';
  const driver = `use "wasm.moth" as webassembly\nset made to webassembly's wasm_compile(${JSON.stringify(program)}, empty list, empty list)\nsay join code of made with ","\n`;
  const itself = compileWasm(driver, files).bytes;
  assert.ok(Buffer.compare(Buffer.from(itself), Buffer.from(compileToWasmBytes(driver, { files: (name) => files[name] }).bytes)) === 0);
  assert.equal(onWasmMoth(driver, { files: (name) => files[name], wasmFiles: files, maxSteps: Infinity }).said[0], [...compileWasm(program).bytes].join(","));
});
