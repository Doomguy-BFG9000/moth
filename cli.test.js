import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
    const result = inDir([CLI, "run", file, "--engine", engine, "--allow-read", "--allow-write", "in.txt", out]);
    assert.equal(result.stdout, `wrote ${out}\n`, engine);
    assert.equal(readFileSync(join(dir, out), "utf8"), "HELLO", engine);
  }
  assert.equal(moth(["build", file, "--allow-read", "--allow-write"]).status, 0);
  const built = inDir([file.replace(/\.moth$/, ".mjs"), "in.txt", "d.txt"]);
  assert.equal(built.stdout, "wrote d.txt\n");
  assert.equal(readFileSync(join(dir, "d.txt"), "utf8"), "HELLO");
  const missing = inDir([CLI, "run", file, "--allow-read", "nowhere.txt", "e.txt"]);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /shout\.moth:1:13: there is no file called 'nowhere\.txt'/);
});

// a site on this computer, for going online: it serves /sales.csv, sends /old on to it, and sends /away on
// to it at another name for this computer (localhost)
async function site(t) {
  const script = [
    "const server = require('node:http').createServer((request, reply) => {",
    "  if (request.url === '/old') return reply.writeHead(302, { location: '/sales.csv' }).end();",
    "  if (request.url === '/away') return reply.writeHead(302, { location: `http://localhost:${server.address().port}/sales.csv` }).end();",
    "  if (request.url !== '/sales.csv') return reply.writeHead(404).end('no');",
    "  reply.writeHead(200, { 'content-type': 'text/csv' }).end('Name,Price\\nTea,2.5\\nCake,4\\n');",
    "});",
    "server.listen(0, '127.0.0.1', () => process.stdout.write(String(server.address().port)));",
  ].join("\n");
  const server = spawn(process.execPath, ["-e", script], { stdio: ["ignore", "pipe", "inherit"] });
  t.after(() => server.kill());
  const port = await new Promise((resolve) => server.stdout.once("data", (d) => resolve(String(d))));
  return `http://127.0.0.1:${port}`;
}

test("moth run asks before a program reads or writes a file or goes online, and --allow-... let it", async (t) => {
  const url = await site(t);
  const file = tempFile(t, "copy.moth", [
    'write uppercase of read "in.txt" to "out.txt"',
    'say "copied"',
    `set sales to read table "${url}/sales.csv"`,
    "say total of price in sales",
    "try",
    `    say read "${url}/missing"`,
    "if it fails with why",
    "    say why",
    "end",
  ].join("\n"));
  const dir = dirname(file);
  writeFileSync(join(dir, "in.txt"), "hello");
  const inDir = (...flags) => spawnSync(process.execPath, [CLI, "run", file, ...flags], { cwd: dir, encoding: "utf8", input: "" }); // no one to ask
  const none = inDir();
  assert.equal(none.status, 1);
  assert.match(none.stderr, /copy\.moth:1:20: can't read 'in\.txt': this program isn't allowed to read files \(start it with --allow-read\)/);
  assert.match(inDir("--allow-read").stderr, /can't write 'out\.txt': this program isn't allowed to write files \(start it with --allow-write\)/);
  assert.match(inDir("--allow-read", "--allow-write").stderr, /can't read 'http:.*sales\.csv': this program isn't allowed to go online \(start it with --allow-net\)/);
  for (const flags of [["--allow-read", "--allow-write", "--allow-net"], ["--allow-all"], ["--engine", "wasm", "--allow-all"]]) {
    const all = inDir(...flags);
    assert.equal(all.stdout, `copied\n6.5\ncan't read '${url}/missing': the site answered 404\n`, all.stderr);
  }
  assert.equal(readFileSync(join(dir, "out.txt"), "utf8"), "HELLO");
});

test("--allow-read, --allow-write and --allow-net can name the files, folders and sites they allow", async (t) => {
  const url = await site(t);
  const file = tempFile(t, "lists.moth", [
    'say read "data/in.txt"',
    'write "x" to "out/a.txt"',
    `say length of read table "${url}/sales.csv"`,
    `say length of read table "${url}/old"`, // sent on to /sales.csv, at the same site
    'for each name in list of "notes.txt", "data/../notes.txt", "out/../b.txt", "' + url + '/away"',
    "    try",
    '        if name is "out/../b.txt"',
    '            write "y" to name',
    "        else",
    "            say read name",
    "        end",
    "    if it fails with why",
    "        say why",
    "    end",
    "end",
  ].join("\n"));
  const dir = dirname(file);
  mkdirSync(join(dir, "data"));
  mkdirSync(join(dir, "out"));
  writeFileSync(join(dir, "data", "in.txt"), "hello");
  writeFileSync(join(dir, "notes.txt"), "secret");
  const ran = spawnSync(process.execPath, [CLI, "run", file, "--allow-read=data", "--allow-write=out", "--allow-net=127.0.0.1"], { cwd: dir, encoding: "utf8", input: "" });
  assert.equal(ran.stdout, [
    "hello",
    "2",
    "2",
    "can't read 'notes.txt': this program isn't allowed to read files (start it with --allow-read)",
    "can't read 'data/../notes.txt': this program isn't allowed to read files (start it with --allow-read)",
    "can't write 'out/../b.txt': this program isn't allowed to write files (start it with --allow-write)",
    `can't read '${url}/away': it moved to '${url.replace("127.0.0.1", "localhost")}/sales.csv', and this program isn't allowed to go online (start it with --allow-net)`,
    "",
  ].join("\n"), ran.stderr);
  assert.equal(readFileSync(join(dir, "out", "a.txt"), "utf8"), "x");
});

test("use only reads files in the program's folder, or folders inside it, and not through a link out of it", (t) => {
  const top = dirname(tempFile(t, "secret.moth", "password = hunter2"));
  const dir = join(top, "app");
  mkdirSync(dir);
  const file = join(dir, "main.moth");
  writeFileSync(file, 'use "../secret.moth"\nsay "never"');
  const outside = moth(["run", file]);
  assert.equal(outside.status, 1);
  assert.ok(outside.stderr.includes("main.moth:1:5: '../secret.moth' isn't in the program's folder: 'use' only reads files there, or in folders inside it"), outside.stderr);
  assert.doesNotMatch(outside.stderr, /hunter2/);
  mkdirSync(join(dir, "lib"));
  try {
    symlinkSync("..", join(dir, "lib", "up"), "dir");
  } catch {
    return; // this computer won't make links (Windows, without developer mode)
  }
  writeFileSync(file, 'use "lib/up/secret.moth"\nsay "never"');
  const linked = moth(["run", file]);
  assert.match(linked.stderr, /there is no file called 'lib\/up\/secret\.moth'/);
  assert.doesNotMatch(linked.stderr, /hunter2/);
});

test("moth test asks before the tests read, write or go online, as moth run does", (t) => {
  const file = tempFile(t, "files.test.moth", 'to test_reading\n    expect read "in.txt" is "hello"\nend');
  const dir = dirname(file);
  writeFileSync(join(dir, "in.txt"), "hello");
  const denied = spawnSync(process.execPath, [CLI, "test", file], { cwd: dir, encoding: "utf8", input: "" });
  assert.equal(denied.status, 1);
  assert.match(denied.stdout, /can't read 'in\.txt': this program isn't allowed to read files \(start it with --allow-read\)/);
  const allowed = spawnSync(process.execPath, [CLI, "test", "--allow-read", file], { cwd: dir, encoding: "utf8", input: "" });
  assert.equal(allowed.status, 0, allowed.stdout);
  assert.match(allowed.stdout, /1 passed/);
});

test("a program made by moth build asks too, allowing only what it was built with", (t) => {
  const file = tempFile(t, "peek.moth", 'say read "in.txt"\nwrite "x" to "out.txt"');
  const dir = dirname(file);
  writeFileSync(join(dir, "in.txt"), "hello");
  const built = file.replace(/\.moth$/, ".mjs");
  assert.equal(moth(["build", file]).status, 0);
  const none = spawnSync(process.execPath, [built], { cwd: dir, encoding: "utf8", input: "" });
  assert.equal(none.status, 1);
  assert.match(none.stderr, /can't read 'in\.txt': this program isn't allowed to read files \(start it with --allow-read\)/);
  assert.equal(moth(["build", file, "--allow-read"]).status, 0);
  const some = spawnSync(process.execPath, [built], { cwd: dir, encoding: "utf8", input: "" });
  assert.equal(some.stdout, "hello\n");
  assert.match(some.stderr, /can't write 'out\.txt': this program isn't allowed to write files/);
});

// ---------- moth test ----------

test("moth test runs the tests in a file, or every .test.moth file in a folder, and fails if one does", (t) => {
  const file = tempFile(t, "math.test.moth", "to double with n\n    return n * 2\nend\nto test_double\n    expect double(2) is 4\nend\nto test_wrong\n    say \"trying\"\n    expect double(3) is 7\nend");
  const dir = dirname(file);
  const result = moth(["test", file]);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, [
    "✓ test_double",
    "✗ test_wrong",
    `    ${file}:9:5: expected 6 to be 7`,
    "        expect double(3) is 7",
    "        ^",
    "    it said:",
    "      trying",
    "1 passed, 1 failed",
    "",
  ].join("\n"));
  writeFileSync(join(dir, "ok.test.moth"), "to test_fine\n    expect 1 is 1\nend");
  writeFileSync(join(dir, "math.test.moth"), "to test_double\n    expect 2 * 2 is 4\nend");
  const all = spawnSync(process.execPath, [CLI, "test", "--engine", "wasm"], { cwd: dir, encoding: "utf8" });
  assert.equal(all.status, 0);
  assert.equal(all.stdout, "math.test.moth\n✓ test_double\nok.test.moth\n✓ test_fine\n2 passed\n");
  const empty = mkdtempSync(join(tmpdir(), "moth-"));
  t.after(() => rmSync(empty, { recursive: true, force: true }));
  const none = spawnSync(process.execPath, [CLI, "test"], { cwd: empty, encoding: "utf8" });
  assert.match(none.stderr, /no tests found/);
  assert.equal(none.status, 1);
});

// ---------- moth fmt ----------

test("moth fmt tidies files, and with --check only says which aren't tidy", (t) => {
  const file = tempFile(t, "messy.moth", "if yes\nsay  1\nend");
  const checked = moth(["fmt", "--check", file]);
  assert.equal(checked.status, 1);
  assert.equal(checked.stdout, `${file} needs tidying\n`);
  assert.equal(readFileSync(file, "utf8"), "if yes\nsay  1\nend");
  const fixed = moth(["fmt", file]);
  assert.equal(fixed.status, 0);
  assert.equal(fixed.stdout, `tidied ${file}\n`);
  assert.equal(readFileSync(file, "utf8"), "if yes\n    say 1\nend\n");
  assert.equal(moth(["fmt", "--check", file]).stdout, `${file} is tidy\n`);
  const broken = tempFile(t, "broken.moth", "if yes\n");
  const bad = moth(["fmt", broken]);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /missing its 'end'/);
  assert.equal(readFileSync(broken, "utf8"), "if yes\n");
});

// ---------- a built program asks ----------

test("a program built with moth build can ask, like moth run", (t) => {
  const file = tempFile(t, "hi.moth", 'set name to ask "Name?"\nsay "Hi " name');
  assert.equal(moth(["build", file]).status, 0);
  const built = node([file.replace(/\.moth$/, ".mjs")], "Sam\n");
  assert.equal(built.stdout, "Name? Sam\nHi Sam\n");
  assert.equal(built.status, 0);
});

// ---------- a web page ----------

// A built page's script, run on node with a stand-in for the page: its picture, its boxes of text, and the
// browser's frames, timers, keys and `ask` box, which the test works by hand.
const STAND_IN = `
const drawn = [];
const pen = new Proxy({}, { get: (o, k) => (k in o ? o[k] : (...a) => drawn.push(k)), set: (o, k, v) => ((o[k] = v), true) });
const element = () => ({ hidden: true, textContent: "", width: 500, height: 500, append(t) { this.textContent += t; },
  getContext: () => pen, getBoundingClientRect: () => ({ left: 0, top: 0, width: 500, height: 500 }), setPointerCapture() {} });
const page = Object.fromEntries(["canvas", "hint", "output", "error"].map((id) => [id, element()]));
globalThis.document = { getElementById: (id) => page[id] };
const frames = [], timers = [], keys = [];
globalThis.requestAnimationFrame = (f) => frames.push(f);
globalThis.setInterval = (f, ms) => timers.push([f, ms]);
globalThis.addEventListener = (type, f) => keys.push(f);
globalThis.prompt = () => "Ada";
`;
const DRIVE = `
keys.forEach((f) => f({ key: "ArrowUp", preventDefault() {} }));
timers.forEach(([f]) => f());
timers.forEach(([f]) => f());
page.canvas.onpointerdown({ clientX: 260, clientY: 240, pointerId: 1 });
page.canvas.onpointermove({ buttons: 1, clientX: 300, clientY: 200 });
frames.splice(0).forEach((f) => f());
console.log(JSON.stringify({ output: page.output.textContent, hint: page.hint.textContent, error: page.error.textContent, every: timers.map(([, ms]) => ms), boxes: drawn.filter((k) => k === "fillRect").length }));
`;

test("moth build --web makes one page, with nothing outside it, that runs an app: keys, clicks, drags and timers", (t) => {
  const file = tempFile(t, "app.moth", [
    'say "</script> in a string can\'t end the page\'s script"',
    'set name to ask "Who is playing?"',
    'say "hello " name',
    "set ticks to 0",
    "when a key is pressed with key",
    '    say "key " key',
    "end",
    "when the mouse is clicked with x and y",
    '    say "click " x ", " y',
    "end",
    "when the mouse is dragged with x and y",
    '    say "drag " x ", " y',
    "end",
    "every 5 milliseconds",
    "    add 1 to ticks",
    "    clear",
    "    draw box at 0, 0 size ticks by ticks",
    "end",
  ].join("\n"));
  const made = moth(["build", "--web", file]);
  assert.equal(made.status, 0);
  const html = readFileSync(file.replace(/\.moth$/, ".html"), "utf8");
  assert.doesNotMatch(html, /\b(src|href)=/); // everything it needs is in it
  assert.equal(html.match(/<\/script>/g).length, 1);
  const script = html.slice(html.indexOf('<script type="module">') + 22, html.lastIndexOf("</script>"));
  const page = tempFile(t, "page.mjs", STAND_IN + script + DRIVE);
  const ran = node([page]);
  assert.equal(ran.stderr, "");
  assert.deepEqual(JSON.parse(ran.stdout), {
    output: "</script> in a string can't end the page's script\nhello Ada\nkey up\nclick 10, 10\ndrag 50, 50\n",
    hint: "It's waiting for you: press keys or click the picture.",
    error: "",
    every: [10], // 5 milliseconds is faster than a page runs timers well
    boxes: 1, // the last one: what came before the last `clear` is gone
  });
});

test("a page made with moth build --web shows a mistake, with the calls that led there, and the app stops", (t) => {
  const file = tempFile(t, "oops.moth", "to boom with k\n    return 1 / k\nend\nwhen a key is pressed with key\n    say boom(0)\nend\nevery 1 second\n    say \"tick\"\nend");
  assert.equal(moth(["build", "--web", file]).status, 0);
  const html = readFileSync(file.replace(/\.moth$/, ".html"), "utf8");
  const script = html.slice(html.indexOf('<script type="module">') + 22, html.lastIndexOf("</script>"));
  const ran = node([tempFile(t, "page.mjs", STAND_IN + script + DRIVE)]);
  const { output, error, hint } = JSON.parse(ran.stdout);
  assert.equal(error, "oops.moth:2:14: can't divide by zero\n    return 1 / k\n             ^\n  in 'boom', called from line 5");
  assert.equal(output, ""); // the timer stopped with it
  assert.equal(hint, "It's waiting for you: press keys.");
});
