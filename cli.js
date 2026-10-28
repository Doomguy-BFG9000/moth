#!/usr/bin/env node
// The `moth` command: run a program, compile it, show its bytecode, or start the Moth shell.
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { createInterface } from "node:readline";
import { run, compile, disassemble, session, excerpt, MothError } from "./moth.js";

const USAGE = `usage:
  moth                        start the Moth shell
  moth run <file.moth>        run a program
  moth build <file.moth>      compile it to <file>.mjs, which runs with plain node
  moth bytecode <file.moth>   show the bytecode the compiler makes`;

// With a file name: file:line:col: reason, the way editors and terminals can jump to. Then the line, with a ^ under the spot.
function report(err, source, file) {
  if (!(err instanceof MothError)) throw err;
  console.error(`${file ? `${file}:${err.line}:${err.col}: ${err.reason}` : err.message}\n${excerpt(source, err)}`);
}

function build(file, source) {
  const out = file.replace(/\.moth$/i, "") + ".mjs";
  // a token is only kept for its position, so the compiled program's errors can still point at the spot
  const program = JSON.stringify(compile(source), (key, v) => (key === "at" ? v.map((t) => t && { line: t.line, col: t.col }) : v));
  const vm = readFileSync(new URL("./vm.js", import.meta.url), "utf8");
  writeFileSync(out, `#!/usr/bin/env node
// Compiled by Moth from ${basename(file)}: the program's bytecode plus the Moth virtual machine.
// Run it with: node ${basename(out)}

${vm}
{
  const source = ${JSON.stringify(source)};
  try {
    execute(${program});
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
  const enter = session();
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

function main([command, file, ...extra]) {
  if (!command) return shell();
  if (["help", "--help", "-h"].includes(command)) return console.log(USAGE);
  if (!["run", "build", "bytecode"].includes(command) || !file || extra.length) {
    console.error(USAGE);
    return 2;
  }
  let source;
  try {
    source = readFileSync(file, "utf8");
  } catch (err) {
    console.error(`moth: can't read ${file} (${err.code === "ENOENT" ? "no such file" : err.message})`);
    return 1;
  }
  try {
    if (command === "run") run(source);
    else if (command === "build") build(file, source);
    else console.log(disassemble(compile(source)));
  } catch (err) {
    report(err, source, file);
    return 1;
  }
}

process.exitCode = main(process.argv.slice(2)) ?? 0;
