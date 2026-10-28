#!/usr/bin/env node
// The `moth` command: run, check or compile a program, show what it compiles to, or start the Moth shell.
import { readFileSync, readSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { run, compile, compileToJs, compileToWasmBytes, mothCompiler, check, disassemble, session, excerpt, MothError } from "./moth.js";

const USAGE = `usage:
  moth                        start the Moth shell
  moth run <file.moth> [arguments...]
                              run a program; if it draws, the drawing goes to <file>.svg; what follows
                              the file is the program's arguments (put --engine wasm or --engine vm
                              first to pick the engine; the JIT is the default)
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
function svg(lines) {
  let [left, right, bottom, top] = [Infinity, -Infinity, Infinity, -Infinity];
  for (const l of lines) {
    const pad = l.width / 2 + 10;
    left = Math.min(left, l.x1 - pad, l.x2 - pad);
    right = Math.max(right, l.x1 + pad, l.x2 + pad);
    bottom = Math.min(bottom, l.y1 - pad, l.y2 - pad);
    top = Math.max(top, l.y1 + pad, l.y2 + pad);
  }
  const attr = (text) => String(text).replace(/[&"<>]/g, (c) => `&#${c.charCodeAt(0)};`); // colors are the program's own text
  const body = lines.map((l) => `  <line x1="${l.x1}" y1="${-l.y1}" x2="${l.x2}" y2="${-l.y2}" stroke="${attr(l.color)}" stroke-width="${l.width}"/>`);
  const box = [left, -top, right - left, top - bottom].map((n) => Math.round(n * 100) / 100);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box.join(" ")}" stroke-linecap="round">\n${body.join("\n")}\n</svg>\n`;
}

// With a file name: file:line:col: reason, the way editors and terminals can jump to. Then the line, with a ^ under the spot.
function report(err, source, file) {
  if (!(err instanceof MothError)) throw err;
  const where = err.file ?? file; // a mistake in a file the program uses is shown in that file
  console.error(`${where ? `${where}:${err.line}:${err.col}: ${err.reason}` : err.message}\n${excerpt(err.file ? sources.get(err.file) ?? "" : source, err)}`);
}

function build(file, source) {
  const out = file.replace(/\.moth$/i, "") + ".mjs";
  // a token is only kept for its position, so the compiled program's errors can still point at the spot
  const program = JSON.stringify(compile(source, reading(file)), (key, v) => (key === "at" ? v.map((t) => t && { line: t.line, col: t.col, file: t.file }) : v));
  const vm = readFileSync(new URL("./vm.js", import.meta.url), "utf8");
  writeFileSync(out, `#!/usr/bin/env node
// Compiled by Moth from ${basename(file)}: the program's bytecode plus the Moth virtual machine.
// Run it with: node ${basename(out)} [arguments...]
import { readFileSync, writeFileSync } from "node:fs";

${vm}
${readDisk}
{
  const source = ${JSON.stringify(source)};
  try {
    execute(${program}, console.log, Infinity, undefined, undefined, { read: readDisk, write: (name, data) => writeFileSync(name, data) }, process.argv.slice(2));
  } catch (err) {
    if (!(err instanceof MothError)) throw err;
    console.error(${JSON.stringify(basename(file))} + ":" + err.line + ":" + err.col + ": " + err.reason + "\\n" + excerpt(source, err));
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

function main([command, file, ...extra]) {
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
