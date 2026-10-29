#!/usr/bin/env node
// The `moth` command: run, check or compile a program, show what it compiles to, or start the Moth shell.
import { readFileSync, readSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { run, test, format, compile, compileToJs, compileToWasmBytes, mothCompiler, check, disassemble, session, excerpt, describeTrail, MothError } from "./moth.js";

const USAGE = `usage:
  moth                        start the Moth shell
  moth run <file.moth> [arguments...]
                              run a program; if it draws, the drawing goes to <file>.svg; what follows
                              the file is the program's arguments (put --engine wasm or --engine vm
                              first to pick the engine; the JIT is the default)
  moth test [files...]        run the tests: each function named test_..., on its own; with no file,
                              every file ending in .test.moth here and in the folders inside
                              (--engine wasm or --engine vm picks the engine)
  moth fmt <files...>         tidy them: indents, spaces and blank lines, the one way Moth writes them
                              (--check only says which aren't tidy, and fails if any aren't)
  moth check <file.moth>      find mistakes without running it
  moth build <file.moth>      compile it to <file>.mjs, which runs with plain node
  moth bytecode <file.moth>   show the bytecode the compiler makes for the VM
  moth js <file.moth>         show the JavaScript the JIT makes
  moth wasm <file.moth>       show the WebAssembly module the third engine makes
  moth bootstrap              compile Moth's compiler written in Moth with itself, three times over`;

// A line of standard input, read without waiting for an event (a program's `ask` can't wait): from a terminal it
// waits for Enter, from a pipe it takes the next line. null at the end of the input.
let pending = Buffer.alloc(0);
function readLine() {
  for (;;) {
    const end = pending.indexOf(10);
    if (end >= 0) {
      const line = pending.subarray(0, end).toString("utf8").replace(/\r$/, "");
      pending = pending.subarray(end + 1);
      return line;
    }
    const chunk = Buffer.alloc(4096);
    let n;
    try {
      n = readSync(0, chunk, 0, chunk.length, null);
    } catch (err) {
      if (err.code === "EAGAIN") continue; // a pipe with nothing in it yet
      if (err.code !== "EOF") throw err; // EOF: Windows, at the end of the input
      n = 0;
    }
    if (n === 0) {
      if (!pending.length) return null;
      const line = pending.toString("utf8");
      pending = Buffer.alloc(0);
      return line;
    }
    pending = Buffer.concat([pending, chunk.subarray(0, n)]);
  }
}

// `ask` in `moth run`: the question, then what's typed; piped answers are shown, as if typed
function askAtTerminal(question) {
  process.stdout.write(`${question} `);
  const answer = readLine();
  if (answer === null) process.stdout.write("\n"); // so a mistake starts on its own line
  else if (!process.stdin.isTTY) process.stdout.write(`${answer}\n`);
  return answer;
}

// What `use "x.moth"` reads: a file next to the program. Each one is kept, so a mistake in it can show its line.
const sources = new Map();
const besides = (program) => (name) => {
  if (!sources.has(name)) {
    try {
      sources.set(name, readFileSync(join(dirname(program), name), "utf8").replace(/^\uFEFF/, ""));
    } catch {
      sources.set(name, undefined);
    }
  }
  return sources.get(name);
};
const reading = (file) => ({ files: besides(file), file: basename(file) });

// What `read` and `write` use: the files in the folder moth runs in. A built program has this function too.
function readDisk(name, asBytes) {
  try {
    const data = readFileSync(name);
    return asBytes ? new Uint8Array(data) : data.toString("utf8"); // a copy: a Buffer's slice() wouldn't copy
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}
const disk = { read: readDisk, write: (name, data) => writeFileSync(name, data) };

// file:line:col: kind: message, then the line with the spot marked. Returns whether anything will fail.
function checkFile(file, source) {
  const problems = check(source, reading(file));
  for (const p of problems) {
    const kind = p.kind === "fails" ? "will fail" : p.kind;
    console.log(`${p.file ?? file}:${p.line}:${p.col}: ${kind}: ${p.message}\n${excerpt(p.file ? sources.get(p.file) : source, p)}`);
  }
  if (!problems.length) console.log(`${file}: no problems found`);
  return problems.some((p) => p.kind === "fails" || p.kind === "error");
}

// The turtle's lines as an SVG picture, framed to fit them. Moth's y goes up and SVG's goes down, so y is flipped.
// What's left after the last `clear` is the picture; boxes, circles and text go in it too.
function svg(drawn) {
  const items = drawn.slice(drawn.findLastIndex((d) => d.clear) + 1);
  let [left, right, bottom, top] = [Infinity, -Infinity, Infinity, -Infinity];
  const reach = (x1, y1, x2, y2, pad) => {
    [left, right] = [Math.min(left, x1 - pad, x2 - pad), Math.max(right, x1 + pad, x2 + pad)];
    [bottom, top] = [Math.min(bottom, y1 - pad, y2 - pad), Math.max(top, y1 + pad, y2 + pad)];
  };
  for (const d of items) {
    if (d.shape === "box") reach(d.x, d.y, d.x + d.width, d.y + d.height, 10);
    else if (d.shape === "circle") reach(d.x, d.y, d.x, d.y, d.radius + 10);
    else if (d.shape === "text") reach(d.x, d.y, d.x + d.text.length * d.size * 0.6, d.y + d.size, 10); // about how wide text is
    else reach(d.x1, d.y1, d.x2, d.y2, d.width / 2 + 10);
  }
  if (!items.length) [left, right, bottom, top] = [-10, 10, -10, 10];
  const attr = (text) => String(text).replace(/[&"<>]/g, (c) => `&#${c.charCodeAt(0)};`); // colors and text are the program's own
  const body = items.map((d) => {
    if (d.shape === "box") return `  <rect x="${Math.min(d.x, d.x + d.width)}" y="${-Math.max(d.y, d.y + d.height)}" width="${Math.abs(d.width)}" height="${Math.abs(d.height)}" fill="${attr(d.color)}"/>`;
    if (d.shape === "circle") return `  <circle cx="${d.x}" cy="${-d.y}" r="${d.radius}" fill="${attr(d.color)}"/>`;
    if (d.shape === "text") return `  <text x="${d.x}" y="${-d.y}" font-size="${d.size}" font-family="sans-serif" fill="${attr(d.color)}">${attr(d.text)}</text>`;
    return `  <line x1="${d.x1}" y1="${-d.y1}" x2="${d.x2}" y2="${-d.y2}" stroke="${attr(d.color)}" stroke-width="${d.width}"/>`;
  });
  const box = [left, -top, right - left, top - bottom].map((n) => Math.round(n * 100) / 100);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box.join(" ")}" stroke-linecap="round">\n${body.join("\n")}\n</svg>\n`;
}

// With a file name: file:line:col: reason, the way editors and terminals can jump to. Then the line, with a ^ under the spot.
function report(err, source, file) {
  if (!(err instanceof MothError)) throw err;
  const where = err.file ?? file; // a mistake in a file the program uses is shown in that file
  console.error(`${where ? `${where}:${err.line}:${err.col}: ${err.reason}` : err.message}\n${excerpt(err.file ? sources.get(err.file) ?? "" : source, err)}`);
  if (err.trail.length) console.error(describeTrail(err.trail)); // the calls that led there
}

function build(file, source) {
  const out = file.replace(/\.moth$/i, "") + ".mjs";
  // a token is only kept for its position, so the compiled program's errors can still point at the spot
  const program = JSON.stringify(compile(source, reading(file)), (key, v) => (key === "at" ? v.map((t) => t && { line: t.line, col: t.col, file: t.file }) : v));
  const vm = readFileSync(new URL("./vm.js", import.meta.url), "utf8");
  writeFileSync(out, `#!/usr/bin/env node
// Compiled by Moth from ${basename(file)}: the program's bytecode plus the Moth virtual machine.
// Run it with: node ${basename(out)} [arguments...]
import { readFileSync, readSync, writeFileSync } from "node:fs";

${vm}
${readDisk}
let pending = Buffer.alloc(0);
${readLine}
${askAtTerminal}
{
  const source = ${JSON.stringify(source)};
  const used = ${JSON.stringify(Object.fromEntries([...sources].filter(([, text]) => text !== undefined)))}; // for a mistake in a file it uses
  try {
    execute(${program}, console.log, Infinity, undefined, askAtTerminal, { read: readDisk, write: (name, data) => writeFileSync(name, data) }, process.argv.slice(2));
  } catch (err) {
    if (!(err instanceof MothError)) throw err;
    console.error((err.file ?? ${JSON.stringify(basename(file))}) + ":" + err.line + ":" + err.col + ": " + err.reason + "\\n" + excerpt(err.file ? used[err.file] ?? "" : source, err));
    if (err.trail.length) console.error(describeTrail(err.trail));
    process.exitCode = 1;
  }
}
`);
  console.log(`compiled ${file} -> ${out}`);
}

function shell() {
  const enter = session(console.log, { files: besides(join(process.cwd(), "shell")), disk }); // `use` reads from the folder it runs in
  const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: "moth> " });
  const rawMode = (on) => process.stdin.isTTY && process.stdin.setRawMode(on);
  let pending = ""; // the lines of a block that hasn't reached its `end` yet
  console.log("Moth shell. Type Moth code; a block runs once you type its 'end'. Ctrl+D quits.");
  rl.prompt();
  rl.on("line", (line) => {
    const source = pending + line + "\n";
    pending = "";
    // shortcut: in normal terminal mode Ctrl+C can end a program that never stops, but it ends the shell too;
    // running each entry in a worker thread would stop just the program
    rawMode(false);
    try {
      enter(source);
    } catch (err) {
      if (err instanceof MothError && err.incomplete) pending = source;
      else report(err, source);
    } finally {
      rawMode(true);
    }
    rl.setPrompt(pending ? "....> " : "moth> ");
    rl.prompt();
  });
  rl.on("SIGINT", () => { // Ctrl+C while typing: drop an unfinished block, or quit
    if (!pending) return rl.close();
    pending = "";
    process.stdout.write("\n");
    rl.setPrompt("moth> ");
    rl.prompt();
  });
  rl.on("close", () => process.stdout.write("\n"));
}

// compiler.moth compiled by the JIT compiles itself; that compiler compiles it again, and so on. Every
// stage must write exactly the JavaScript the JIT does.
function bootstrap() {
  const source = readFileSync(new URL("./compiler.moth", import.meta.url), "utf8");
  const js = compileToJs(source).source;
  const lines = source.trimEnd().split(/\r?\n/).length;
  console.log(`compiler.moth: ${lines} lines of Moth, which the JIT compiles to ${js.length} characters of JavaScript`);
  let compiler = compileToJs;
  for (let stage = 1; stage <= 3; stage++) {
    compiler = mothCompiler(source, compiler);
    const start = performance.now();
    const same = compiler(source).source === js;
    const ms = Math.round(performance.now() - start);
    console.log(`stage ${stage}, made by ${stage === 1 ? "the JIT" : `stage ${stage - 1}`}, compiles compiler.moth: ${same ? "the same JavaScript" : "DIFFERENT JavaScript"} (${ms} ms)`);
    if (!same) return 1;
  }
  console.log("fixed point: the compiler written in Moth compiles itself to exactly what the JIT makes of it");
}

// One file's tests: a tick or a cross for each, and for one that failed, its mistake, the calls that led
// there, and what it said before. Returns how many passed and failed.
function testFile(file, source, engine) {
  let failed = 0;
  const results = test(source, { engine, disk, ...reading(file) });
  for (const { name, said, error } of results) {
    const label = name ?? basename(file);
    if (!error) {
      console.log(`✓ ${label}`);
      continue;
    }
    failed++;
    console.log(`✗ ${label}`);
    const where = error.file ?? file;
    const lines = [`${where}:${error.line}:${error.col}: ${error.reason}`, ...excerpt(error.file ? sources.get(error.file) ?? "" : source, error).split("\n")];
    if (error.trail.length) lines.push(...describeTrail(error.trail).split("\n"));
    if (said.length) lines.push("it said:", ...said.map((line) => `  ${line}`));
    console.log(lines.map((line) => `    ${line}`).join("\n"));
  }
  return { passed: results.length - failed, failed };
}

// Every file ending in .test.moth in a folder and the folders inside it, but not node_modules or hidden ones.
function findTests(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...findTests(path));
    else if (entry.name.endsWith(".test.moth")) found.push(path);
  }
  return found;
}

// `moth test`: the files' tests, then how many passed. Fails if any test, or any file, did.
function tests(files, engine) {
  if (!files.length) files = findTests(".");
  if (!files.length) {
    console.error("moth: no tests found: name a file, or put tests in files ending in .test.moth");
    return 1;
  }
  let [passed, failed] = [0, 0];
  for (const file of files) {
    if (files.length > 1) console.log(file);
    let source;
    try {
      source = readFileSync(file, "utf8").replace(/^\uFEFF/, "");
      const counts = testFile(file, source, engine);
      passed += counts.passed;
      failed += counts.failed;
    } catch (err) {
      if (source === undefined) console.error(`moth: can't read ${file} (${err.code === "ENOENT" ? "no such file" : err.message})`);
      else report(err, source, file); // a mistake that stops the file from being read at all
      failed++;
    }
  }
  console.log(`${passed} passed${failed ? `, ${failed} failed` : ""}`);
  return failed ? 1 : 0;
}

// `moth fmt`: tidies each file in place, or with --check only says which ones need it. Code with a mistake
// that stops it from being read is left alone.
function tidy(files, checkOnly) {
  let failed = 0;
  for (const file of files) {
    let source;
    try {
      source = readFileSync(file, "utf8").replace(/^\uFEFF/, "");
    } catch (err) {
      console.error(`moth: can't read ${file} (${err.code === "ENOENT" ? "no such file" : err.message})`);
      failed++;
      continue;
    }
    let tidied;
    try {
      tidied = format(source);
    } catch (err) {
      if (err instanceof MothError) report(err, source, file);
      else console.error(`moth: ${file}: ${err.message}`);
      failed++;
      continue;
    }
    if (tidied === source) console.log(`${file} is tidy`);
    else if (checkOnly) {
      console.log(`${file} needs tidying`);
      failed++;
    } else {
      writeFileSync(file, tidied);
      console.log(`tidied ${file}`);
    }
  }
  return failed ? 1 : 0;
}

function main([command, file, ...extra]) {
  if (command === "fmt") {
    const files = [file, ...extra].filter((a) => a !== undefined && a !== "--check");
    if (!files.length) {
      console.error(USAGE);
      return 2;
    }
    return tidy(files, [file, ...extra].includes("--check"));
  }
  if (command === "test") {
    const rest = [file, ...extra].filter((a) => a !== undefined);
    const at = rest.indexOf("--engine");
    const engine = at >= 0 ? rest.splice(at, 2)[1] : "jit";
    if (!["jit", "wasm", "vm"].includes(engine)) {
      console.error(USAGE);
      return 2;
    }
    return tests(rest, engine);
  }
  let engine = "jit";
  if (command === "run" && extra[0] === "--engine" && ["jit", "wasm", "vm"].includes(extra[1])) [engine, extra] = [extra[1], extra.slice(2)];
  const args = command === "run" ? extra.splice(0) : []; // what's left after the file is the program's own
  if (!command) return shell();
  if (command === "bootstrap" && !file) return bootstrap();
  if (["help", "--help", "-h"].includes(command)) return console.log(USAGE);
  if (!["run", "check", "build", "bytecode", "js", "wasm"].includes(command) || !file || extra.length) {
    console.error(USAGE);
    return 2;
  }
  let source;
  try {
    source = readFileSync(file, "utf8").replace(/^\uFEFF/, ""); // a byte-order mark belongs to the file, not the code
  } catch (err) {
    console.error(`moth: can't read ${file} (${err.code === "ENOENT" ? "no such file" : err.message})`);
    return 1;
  }
  try {
    if (command === "run") {
      const drawn = [];
      run(source, console.log, { draw: (line) => drawn.push(line), ask: askAtTerminal, engine, disk, args, ...reading(file) });
      if (drawn.length) {
        const out = file.replace(/\.moth$/i, "") + ".svg";
        writeFileSync(out, svg(drawn));
        console.error(`drew ${drawn.length} lines -> ${out}`); // stderr, so the program's own output stays clean
      }
    }
    else if (command === "check") return checkFile(file, source) ? 1 : 0;
    else if (command === "build") build(file, source);
    else if (command === "js") console.log(compileToJs(source, reading(file)).source);
    else if (command === "wasm") {
      const { bytes, listing } = compileToWasmBytes(source, reading(file));
      console.log(`;; ${bytes.length} bytes\n${listing}`);
    }
    else console.log(disassemble(compile(source, reading(file))));
  } catch (err) {
    report(err, source, file);
    return 1;
  }
}

process.exitCode = main(process.argv.slice(2)) ?? 0;
