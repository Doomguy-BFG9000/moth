// Moth against C and Python: the same four programs in each, every one run as a whole process from start to
// finish, the best of three. Moth runs as the machine code machine.moth makes, and on `moth run`. C needs cc,
// gcc or clang, or MSVC's cl in a developer prompt; Python needs python3 or python. Run with `npm run versus`.
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { machineCompiler } from "../moth.js";

const here = (file) => fileURLToPath(new URL(file, import.meta.url));
const PROGRAMS = {
  fib: "fib(32): 7 million calls",
  loop: "adding 1 to 100,000,000",
  primes: "primes up to 300,000",
  float: "30,000,000 steps of decimal maths",
};
const windows = process.platform === "win32";
const dir = mkdtempSync(join(tmpdir(), "moth-versus-"));
const works = (command, args) => {
  const ran = spawnSync(command, args, { cwd: dir, encoding: "utf8" });
  return !ran.error && ran.status === 0;
};

const ways = {};
const cExe = join(dir, windows ? "versus.exe" : "versus");
const source = here("versus.c");
const compilers = [["cc", ["-O2", "-o", cExe, source]], ["gcc", ["-O2", "-o", cExe, source]], ["clang", ["-O2", "-o", cExe, source]],
  ["cl", ["/O2", "/nologo", source, `/Fe:${cExe}`]]];
const compiler = compilers.find(([command, args]) => works(command, args));
if (compiler) ways[`C (${compiler[0]})`] = (p) => [cExe, [p]];
const target = { win32: "windows", linux: "linux" }[process.platform];
if (target) {
  const machine = machineCompiler(readFileSync(here("../machine.moth"), "utf8"), readFileSync(here("../compiler.moth"), "utf8"));
  for (const p of Object.keys(PROGRAMS)) {
    const exe = join(dir, windows ? `${p}.exe` : p);
    writeFileSync(exe, machine(readFileSync(here(`${p}.moth`), "utf8"), { target, name: `${p}.moth` }));
    if (!windows) chmodSync(exe, 0o755);
  }
  ways["Moth, machine code"] = (p) => [join(dir, windows ? `${p}.exe` : p), []];
}
ways["moth run"] = (p) => [process.execPath, [here("../cli.js"), "run", here(`${p}.moth`)]];
const python = ["python3", "python"].find((command) => works(command, ["--version"]));
if (python) ways.Python = (p) => [python, [here(`${p}.py`)]];

const names = Object.keys(ways);
console.log(["".padEnd(36), ...names.map((n) => n.padStart(20))].join(""));
try {
  for (const [p, title] of Object.entries(PROGRAMS)) {
    const times = [];
    const answers = new Set();
    for (const name of names) {
      const [command, args] = ways[name](p);
      let best = Infinity;
      for (let r = 0; r < 3; r++) {
        const start = process.hrtime.bigint();
        const ran = spawnSync(command, args, { encoding: "utf8", maxBuffer: 1 << 26 });
        best = Math.min(best, Number(process.hrtime.bigint() - start) / 1e6);
        if (ran.status !== 0) throw new Error(`${name} failed on ${p}: ${ran.stderr || ran.error}`);
        answers.add(Number(ran.stdout).toPrecision(15)); // Python shows 17 digits, Moth and C 15
      }
      times.push(`${best.toFixed(0)} ms`.padStart(20));
    }
    console.log(title.padEnd(36) + times.join("") + (answers.size > 1 ? `   (different answers: ${[...answers].join(", ")})` : ""));
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
if (!compiler) console.log("(no C compiler found: cc, gcc, clang or cl)");
if (!python) console.log("(no Python found: python3 or python)");
