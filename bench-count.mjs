// Counts the instructions a program's machine code runs, and where: in each of the program's functions, in
// main, and in each routine of the runtime. Needs Linux and valgrind (callgrind). Timing a short run of
// machine code varies by 10% and more from run to run; the count is the same every time, so it shows what a
// change to machine.moth did, a few thousand instructions at a time.
//
//     node bench-count.mjs program.moth [arguments...]          the top 25 places
//     node bench-count.mjs --top 60 program.moth                   more of them
//     node bench-count.mjs moth.moth build compiler.moth           moth, as bootstrap.mjs makes it, at work
//
// The program is built by machine.moth on Node.js, as bootstrap.mjs builds moth, with two changes that
// don't touch its code: the program keeps a 4 GB heap rather than 64 GB, which valgrind can't give it, and
// machine.moth's assembler is kept, for where each function and routine starts. Instructions in the cold
// code, after the last routine, are counted as "cold code". Runs in the folder it's started in.
import { readFileSync, writeFileSync, chmodSync, mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { compileToJs } from "./moth.js";

const args = process.argv.slice(2);
let top = 25;
if (args[0] === "--top") {
  top = Number(args[1]);
  args.splice(0, 2);
}
const [program, ...rest] = args;
if (!program) throw new Error("usage: node bench-count.mjs [--top n] program.moth [arguments...]");
const here = (file) => readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
const field = (r, k) => (r instanceof Map ? r.get(k) : r[k]);

const heap = "set gc_heap_size to 68719476736";
const before = "\n    emit_runtime(st)\n";
let machine = here("machine.moth");
if (!machine.includes(heap) || !machine.includes(before)) throw new Error("machine.moth has changed: bench-count.mjs needs a look");
machine = "set kept_states to empty list\n" + machine.replace(heap, "set gc_heap_size to 4294967296").replace(before, "\n    add st to kept_states" + before);
const made = compileToJs(machine, { files: (name) => (name === "compiler.moth" ? here("compiler.moth") : undefined), file: "machine.moth" });
const values = made.run(console.log, undefined, Infinity);
const named = (name) => values[made.names.indexOf(name) - 1];

let bytes;
if (basename(program) === "moth.moth") {
  const line = here("bootstrap.mjs").split("\n").find((l) => l.startsWith("const files = {")); // the files bootstrap.mjs gives moth
  const files = [...line.matchAll(/"([^"]+)": here\(/g)].map((m) => m[1]);
  bytes = named("compile_shipping").fn.run(here("moth.moth"), files, files.map(here), "linux", "moth.moth",
    ["--allow-read", "--allow-write", "--allow-run"], null, null, ["moth-debugger.moth"], [Uint8Array.from(readFileSync(new URL("./moth-debugger.moth", import.meta.url)))]);
} else {
  bytes = named("compile_machine").fn.run(readFileSync(program, "utf8"), [], [], "linux", basename(program));
}

// where each function and routine starts: machine.moth's own labels, the program's functions by name
const st = named("kept_states").at(-1); // the state of the last time it wrote the program
const asm = field(st, "a");
const hot = field(asm, "hot");
const fnNames = {};
for (const f of field(st, "all_fns")) fnNames[field(f, "label")] = `${field(f, "name")} (a function)`;
const base = 0x400000 + (field(asm, "libraries") ? 512 : 256);
const starts = [[base + hot.length, "cold code"]];
const labels = field(asm, "labels");
for (const [name, at] of labels instanceof Map ? labels : Object.entries(labels)) {
  if (field(at, "section") !== "hot" || /^L\d+$/.test(name)) continue;
  starts.push([base + field(at, "at"), fnNames[name] ?? name]);
}
starts.sort((x, y) => x[0] - y[0]);
const placeOf = (address) => {
  let lo = 0, hi = starts.length - 1, found = "?";
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (starts[mid][0] <= address) [found, lo] = [starts[mid][1], mid + 1];
    else hi = mid - 1;
  }
  return found;
};

const dir = mkdtempSync(join(tmpdir(), "moth-count-"));
try {
  const exe = join(dir, "program");
  writeFileSync(exe, Uint8Array.from(bytes));
  chmodSync(exe, 0o755);
  const out = join(dir, "callgrind.out");
  const ran = spawnSync("valgrind", ["--tool=callgrind", "--dump-instr=yes", "--compress-pos=no", "--compress-strings=no", `--callgrind-out-file=${out}`, exe, ...rest],
    { encoding: "utf8", maxBuffer: 1 << 28, stdio: ["inherit", "pipe", "pipe"] });
  if (ran.error) throw ran.error;
  process.stdout.write(ran.stdout);
  // each line of the file is "address line count", but a call's line after "calls=" counts the call's whole cost
  const counts = new Map();
  let total = 0;
  let call = false;
  for (const line of readFileSync(out, "utf8").split("\n")) {
    if (line.startsWith("calls=")) call = true;
    else if (/^0x[0-9a-f]+ /.test(line)) {
      if (call) call = false;
      else {
        const [address, , count] = line.split(" ");
        const place = Number.parseInt(address, 16) < 0x10000000 ? placeOf(Number.parseInt(address, 16)) : "outside the program";
        counts.set(place, (counts.get(place) ?? 0) + Number(count));
        total += Number(count);
      }
    } else call = false;
  }
  console.log(`\n${total.toLocaleString("en")} instructions`);
  for (const [place, count] of [...counts].sort((x, y) => y[1] - x[1]).slice(0, top)) {
    console.log(`${(100 * count / total).toFixed(1).padStart(6)}%  ${count.toLocaleString("en").padStart(15)}  ${place}`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
