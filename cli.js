#!/usr/bin/env node
// The `moth` command: run, check or compile a program, show what it compiles to, or start the Moth shell.
import { chmodSync, readFileSync, readSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { addAllow, permissions, guardedDisk, within } from "./disk.js";
import { run, test, format, compile, compileToJs, compileToWasmBytes, mothCompiler, machineCompiler, check, disassemble, session, excerpt, describeTrail, MothError } from "./moth.js";

const USAGE = `usage:
  moth                        start the Moth shell
  moth run <file.moth> [arguments...]
                              run a program; if it draws, the drawing goes to <file>.svg; what follows
                              the file is the program's arguments (put --engine wasm or --engine vm
                              first to pick the engine; the JIT is the default). It asks before the
                              program reads or writes a file or goes online; --allow-read,
                              --allow-write, --allow-net or --allow-all, first, let it without asking,
                              and --allow-read=data,notes.txt, --allow-write=out or
                              --allow-net=example.com only those files, folders or sites
  moth test [files...]        run the tests: each function named test_..., on its own; with no file,
                              every file ending in .test.moth here and in the folders inside
                              (--engine wasm or --engine vm picks the engine); it asks as run does,
                              and takes the same --allow flags
  moth fmt <files...>         tidy them: indents, spaces and blank lines, the one way Moth writes them
                              (--check only says which aren't tidy, and fails if any aren't)
  moth check <file.moth>      find mistakes without running it
  moth build <file.moth>      compile it to <file>.mjs, which runs with plain node and asks as run
                              does; --allow flags after the file are built into it
  moth build --web <file.moth>
                              make it into <file>.html: one web page, with nothing else needed, that
                              runs it in any browser; an app there gets keys, clicks and its timers
  moth build --exe <file.moth> [--target windows|linux] [--allow-...]
                              compile it to machine code with machine.moth, Moth's own compiler, and
                              nothing else: <file>.exe for Windows, or <file> for Linux, which asks
                              as run does, allowing what --allow flags after the file allow; so far
                              it takes numbers, yes, no and nothing, text, lists, records,
                              dictionaries, bytes, variables, say, if, loops, functions, try, files,
                              ask, arguments and most helpers
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
      const file = join(dirname(program), name);
      if (!within(dirname(program), file)) throw new Error("outside the program's folder"); // a link out of it
      sources.set(name, readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
    } catch {
      sources.set(name, undefined);
    }
  }
  return sources.get(name);
};
const reading = (file) => ({ files: besides(file), file: basename(file) });


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

// The program as machine code, made by machine.moth, Moth's machine-code back end written in Moth: a file of
// its own, which runs with nothing else installed.
function buildExe(file, source, target, allow) {
  compile(source, reading(file)); // reads the files it uses, and stops at a mistake in them as run would
  const files = Object.fromEntries([...sources].filter(([, text]) => text !== undefined));
  const here = (name) => readFileSync(new URL(`./${name}`, import.meta.url), "utf8");
  const bytes = machineCompiler(here("machine.moth"), here("compiler.moth"))(source, { files, target, name: basename(file), allow });
  const out = file.replace(/\.moth$/i, "") + (target === "windows" ? ".exe" : "");
  writeFileSync(out, bytes);
  if (target === "linux") chmodSync(out, 0o755);
  console.log(`compiled ${file} to machine code for ${target === "windows" ? "Windows" : "Linux"} -> ${out} (${bytes.length.toLocaleString("en")} bytes)`);
}

// The program compiled to bytecode, as JavaScript. A token is only kept for its position, so the compiled
// program's errors can still point at the spot.
const bytecode = (file, source) => JSON.stringify(compile(source, reading(file)), (key, v) => (key === "at" ? v.map((t) => t && { line: t.line, col: t.col, file: t.file }) : v));
const usedSources = () => JSON.stringify(Object.fromEntries([...sources].filter(([, text]) => text !== undefined)));

function build(file, source, allowed) {
  const out = file.replace(/\.moth$/i, "") + ".mjs";
  const program = bytecode(file, source);
  const vm = readFileSync(new URL("./vm.js", import.meta.url), "utf8");
  const files = readFileSync(new URL("./disk.js", import.meta.url), "utf8");
  writeFileSync(out, `#!/usr/bin/env node
// Compiled by Moth from ${basename(file)}: the program's bytecode plus the Moth virtual machine.
// Run it with: node ${basename(out)} [arguments...]
import { readFileSync, readSync, writeFileSync } from "node:fs";

${vm}
${files}
let pending = Buffer.alloc(0);
${readLine}
${askAtTerminal}
{
  const source = ${JSON.stringify(source)};
  const used = ${usedSources()}; // for a mistake in a file it uses
  const allowed = new Map(${JSON.stringify([...allowed])}); // what it may do without asking, as it was built
  try {
    execute(${program}, console.log, Infinity, undefined, askAtTerminal, guardedDisk(permissions(allowed, readLine)), process.argv.slice(2), Math.random);
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

// The script of a page made by `moth build --web`, where it comes after vm.js. It runs the program, shows
// what it says and draws, and if it's an app, gives it the keys pressed, clicks and drags on the picture,
// and its timers. `ask` asks with the browser's own box, and `write` makes files that last while it's open.
function webPage(program, source, used, name) {
  const $ = (id) => document.getElementById(id);
  const canvas = $("canvas");
  const output = $("output");
  let drawing = []; // what it has drawn since its last `clear`
  let app = false; // set up, and waiting for keys, clicks or time
  const reachOf = (d) => (d.shape === "box" ? Math.max(Math.abs(d.x), Math.abs(d.y), Math.abs(d.x + d.width), Math.abs(d.y + d.height))
    : d.shape === "circle" ? Math.max(Math.abs(d.x), Math.abs(d.y)) + d.radius
    : d.shape === "text" ? Math.max(Math.abs(d.x), Math.abs(d.y) + d.size)
    : Math.max(Math.abs(d.x1), Math.abs(d.y1), Math.abs(d.x2), Math.abs(d.y2)));
  // (0, 0) in the middle and y going up; a picture that reaches past the edge is zoomed out, but an app's
  // never moves, since it's where its clicks land
  function render() {
    const pen = canvas.getContext("2d");
    const half = canvas.width / 2;
    const scale = app ? 1 : Math.min(1, (half - 10) / Math.max(0, ...drawing.map(reachOf)));
    pen.setTransform(1, 0, 0, 1, 0, 0);
    pen.clearRect(0, 0, canvas.width, canvas.height);
    pen.setTransform(scale, 0, 0, -scale, half, half);
    pen.lineCap = "round";
    for (const d of drawing) {
      pen.strokeStyle = pen.fillStyle = d.color;
      if (d.shape === "box") pen.fillRect(d.x, d.y, d.width, d.height);
      else if (d.shape === "circle") {
        pen.beginPath();
        pen.arc(d.x, d.y, d.radius, 0, 2 * Math.PI);
        pen.fill();
      } else if (d.shape === "text") { // the right way up, in a picture whose y goes up
        pen.save();
        pen.translate(d.x, d.y);
        pen.scale(1, -1);
        pen.font = `${d.size}px system-ui, sans-serif`;
        pen.fillText(d.text, 0, 0);
        pen.restore();
      } else {
        pen.beginPath();
        pen.lineWidth = d.width;
        pen.moveTo(d.x1, d.y1);
        pen.lineTo(d.x2, d.y2);
        pen.stroke();
      }
    }
  }
  let painting = false;
  const paintSoon = () => { // at most once a frame, however fast it draws
    if (painting) return;
    painting = true;
    requestAnimationFrame(() => {
      painting = false;
      render();
    });
  };
  const draw = (d) => {
    canvas.hidden = false;
    if (d.clear) drawing = [];
    else drawing.push(d);
    paintSoon();
  };
  const say = (line) => {
    output.hidden = false;
    output.append(`${line}\n`);
  };
  const files = new Map();
  const disk = {
    read: (file, asBytes) => {
      if (!files.has(file)) return null;
      const data = files.get(file);
      if (asBytes) return typeof data === "string" ? new TextEncoder().encode(data) : data.slice();
      return typeof data === "string" ? data : new TextDecoder().decode(data);
    },
    write: (file, data) => void files.set(file, data),
  };
  const options = { ask: (question) => prompt(question), disk, random: Math.random, listeners: [], turtle: new Turtle(draw) };
  const timers = [];
  function failed(err) {
    app = false;
    timers.forEach(clearInterval);
    $("hint").hidden = true;
    const trail = err.trail?.length ? `\n${describeTrail(err.trail)}` : ""; // the calls that led there
    $("error").textContent = err instanceof MothError
      ? `${err.file ?? name}:${err.line}:${err.col}: ${err.reason}\n${excerpt(err.file ? used[err.file] ?? "" : source, err)}${trail}`
      : `Moth itself crashed: ${err.message}`;
    $("error").hidden = false;
  }
  try {
    new Machine(program, say, options).run();
  } catch (err) {
    return failed(err);
  }
  const waits = options.listeners;
  if (!waits.length) return;
  app = true;
  canvas.hidden = false;
  render();
  const handle = (wait, inputs = []) => {
    if (!app) return;
    try {
      callFunction(wait.closure, inputs, say, options);
    } catch (err) {
      failed(err);
    }
  };
  const send = (event, inputs) => waits.forEach((wait) => wait.event === event && handle(wait, inputs));
  for (const wait of waits) if (wait.event === "every") timers.push(setInterval(() => handle(wait), Math.max(10, wait.interval)));
  const wants = [waits.some((w) => w.event === "key") && "press keys", waits.some((w) => w.event === "click" || w.event === "drag") && "click the picture"].filter(Boolean);
  $("hint").textContent = wants.length ? `It's waiting for you: ${wants.join(" or ")}.` : "";
  $("hint").hidden = !wants.length;
  const KEYS = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down", " ": "space", Enter: "enter", Escape: "escape", Backspace: "backspace" };
  addEventListener("keydown", (e) => {
    if (!app || e.ctrlKey || e.metaKey || e.altKey || e.key === "Tab") return;
    e.preventDefault(); // arrows and space would scroll the page
    send("key", [KEYS[e.key] ?? e.key.toLowerCase()]);
  });
  // where the pointer is, in the picture's own numbers
  const spot = (e) => {
    const box = canvas.getBoundingClientRect();
    return [Math.round(((e.clientX - box.left) / box.width) * canvas.width - canvas.width / 2), Math.round(canvas.height / 2 - ((e.clientY - box.top) / box.height) * canvas.height)];
  };
  canvas.onpointerdown = (e) => {
    if (!app) return;
    canvas.setPointerCapture(e.pointerId); // a drag keeps going past the edge
    send("click", spot(e));
  };
  canvas.onpointermove = (e) => e.buttons && send("drag", spot(e));
}

// `moth build --web`: one HTML file with everything in it, which runs the program in any browser
function buildWeb(file, source) {
  const out = file.replace(/\.moth$/i, "") + ".html";
  const name = basename(file);
  const vm = readFileSync(new URL("./vm.js", import.meta.url), "utf8");
  // "</script" or "<!--" inside the script (in a string, say) would end it early; "<\/" is the same in JavaScript
  const script = `${vm}\n${webPage}\nwebPage(${bytecode(file, source)}, ${JSON.stringify(source)}, ${usedSources()}, ${JSON.stringify(name)});`.replace(/<(\/script|!--)/gi, "<\\$1");
  const title = name.replace(/\.moth$/i, "").replace(/[&<>]/g, (c) => `&#${c.charCodeAt(0)};`);
  writeFileSync(out, `<!doctype html>
<!-- Made by Moth from ${title}.moth: the program's bytecode plus the Moth virtual machine. Open it in a browser. -->
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  [hidden] { display: none !important; }
  body { margin: 0; min-height: 100vh; box-sizing: border-box; padding: 16px; display: grid; place-content: center; gap: 12px; background: #0f0f0f; color: #e6e6e6; font: 15px/1.5 system-ui, sans-serif; }
  canvas { display: block; width: min(100vw - 32px, 500px); aspect-ratio: 1; background: #161616; border: 1px solid #333; border-radius: 6px; touch-action: none; }
  pre { margin: 0; max-width: min(100vw - 32px, 500px); max-height: 40vh; overflow: auto; white-space: pre-wrap; font: 14px/1.5 ui-monospace, Consolas, monospace; }
  p { margin: 0; color: #9a9a9a; font-size: 14px; }
  #error { color: #ff7b72; }
</style>
</head>
<body>
<canvas id="canvas" width="500" height="500" hidden></canvas>
<p id="hint" hidden></p>
<pre id="output" hidden></pre>
<pre id="error" hidden></pre>
<script type="module">
${script}
</script>
</body>
</html>
`);
  console.log(`made ${file} into a web page -> ${out}`);
}

function shell() {
  const enter = session(console.log, { files: besides(join(process.cwd(), "shell")), disk: guardedDisk(permissions(new Map(), readLine)) }); // `use` reads from the folder it runs in
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
  const results = test(source, { engine, disk, ...reading(file) }); // one disk for every test, so each file or site is asked about once
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
let disk; // what `moth test` gives the tests: see main()
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
  const allowed = new Map(); // what `run`, `test` and a built program may do without asking
  if (command === "test") {
    const rest = [file, ...extra].filter((a) => a !== undefined && !addAllow(allowed, a));
    disk = guardedDisk(permissions(allowed, readLine));
    const at = rest.indexOf("--engine");
    const engine = at >= 0 ? rest.splice(at, 2)[1] : "jit";
    if (!["jit", "wasm", "vm"].includes(engine)) {
      console.error(USAGE);
      return 2;
    }
    return tests(rest, engine);
  }
  const web = command === "build" && file === "--web";
  const exe = command === "build" && file === "--exe";
  if (web || exe) file = extra.shift();
  let target = process.platform === "win32" ? "windows" : "linux";
  const flags = []; // the --allow flags `build --exe` builds into the program, as moth-native's does
  while (exe && extra.length) {
    if (extra[0] === "--target" && ["windows", "linux"].includes(extra[1])) [target, extra] = [extra[1], extra.slice(2)];
    else if (addAllow(allowed, extra[0])) flags.push(extra.shift());
    else break;
  }
  let engine = "jit";
  while (command === "run" && extra.length) {
    if (extra[0] === "--engine" && ["jit", "wasm", "vm"].includes(extra[1])) [engine, extra] = [extra[1], extra.slice(2)];
    else if (addAllow(allowed, extra[0])) extra = extra.slice(1);
    else break;
  }
  if (command === "build" && !web && !exe) extra = extra.filter((a) => !addAllow(allowed, a));
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
      const app = run(source, console.log, { draw: (line) => drawn.push(line), ask: askAtTerminal, engine, disk: guardedDisk(permissions(allowed, readLine)), args, random: Math.random, ...reading(file) });
      if (app) console.error(`${basename(file)} is an app: it waits for keys, clicks or time, which a terminal can't give it. Open it in the playground, or make a web page of it with: moth build --web ${file}`);
      if (drawn.length) {
        const out = file.replace(/\.moth$/i, "") + ".svg";
        writeFileSync(out, svg(drawn));
        console.error(`drew ${drawn.length} ${drawn.every((d) => d.x1 !== undefined) ? "lines" : "lines and shapes"} -> ${out}`); // stderr, so the program's own output stays clean
      }
    }
    else if (command === "check") return checkFile(file, source) ? 1 : 0;
    else if (exe) buildExe(file, source, target, flags);
    else if (command === "build") (web ? buildWeb : build)(file, source, allowed);
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
