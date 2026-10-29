// Times a few Moth programs. Run with `npm run bench`; pass a path to time another copy of moth.js.
import { pathToFileURL, fileURLToPath } from "node:url";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const { run } = await import(process.argv[2] ? pathToFileURL(process.argv[2]).href : "./moth.js");

const PROGRAMS = {
  "fib(25), function calls": `to fib with n
    if n is less than 2
        return n
    end
    return fib(n - 1) + fib(n - 2)
end
say fib(25)`,

  "sum 1 to 1,000,000, a loop": `set total to 0
for each i from 1 to 1000000
    add i to total
end
say total`,

  "primes up to 5,000, lists": `set primes to empty list
for each n from 2 to 5000
    set prime to yes
    for each p in primes
        if n is divisible by p
            set prime to no
        end
    end
    if prime
        add n to primes
    end
end
say length of primes`,

  "200,000 records, made and read": `set total to 0
for each i from 1 to 200000
    set point to record with x i, y i * 2, label "a"
    set total to total + x of point + y of point
end
say total`,

  "1,000,000 bytes, filled and summed": `set block to 1000000 bytes
for each i from 1 to 1000000
    set byte i of block to i bit and 255
end
set total to 0
for each i from 1 to 1000000
    add byte i of block to total
end
say total`,

  "200,000 words counted, dictionary": `set counts to empty dictionary
set words to list of "apple", "pear", "fig", "kiwi", "plum", "lime", "date"
set k to 0
repeat 200000 times
    add 1 to k
    if k is greater than 7
        set k to 1
    end
    set w to item k of words
    if w is in counts
        set item w of counts to item w of counts + 1
    else
        set item w of counts to 1
    end
end
say item "fig" of counts`,

  "recursion 10,000 deep": `to sum with n
    if n is 0
        return 0
    end
    return n + sum(n - 1)
end
say sum(10000)`,
};

// best of 5 runs on one engine
function time(source, engine) {
  let best = Infinity;
  let result;
  for (let i = 0; i < 5; i++) {
    const start = performance.now();
    try {
      run(source, (line) => (result = line), { engine });
    } catch (err) {
      result = `error: ${err.message}`;
    }
    best = Math.min(best, performance.now() - start);
  }
  return { ms: best, result };
}

// the Rust engine, if it's built: it times itself, so starting it up isn't counted
const NATIVE = new URL(`./native/target/release/moth-native${process.platform === "win32" ? ".exe" : ""}`, import.meta.url);
function timeNative(source) {
  if (!existsSync(NATIVE)) return null;
  const [best, result] = spawnSync(fileURLToPath(NATIVE), ["bench"], { input: source, encoding: "utf8" }).stdout.split("\n");
  return { ms: Number(best), result };
}

// The same programs compiled to machine code by moth-native build --exe, if rustc is here to finish the job:
// one program holding them all, which times each as `moth-native bench` does
function compiledTimes() {
  if (!existsSync(NATIVE) || spawnSync("rustc", ["--version"]).status !== 0) return null;
  const dir = mkdtempSync(join(tmpdir(), "moth-bench-"));
  try {
    writeFileSync(join(dir, "programs.json"), JSON.stringify(Object.values(PROGRAMS).map((source) => ({ source }))));
    const built = spawnSync(fileURLToPath(NATIVE), ["build", "--exe-conform", "programs.json", "programs"], { cwd: dir, encoding: "utf8" });
    if (built.status !== 0) return null;
    const harness = join(dir, `programs${process.platform === "win32" ? ".exe" : ""}`);
    const input = Object.values(PROGRAMS).map((source) => JSON.stringify(source)).join("\n") + "\n";
    const lines = spawnSync(harness, [], { input, encoding: "utf8", env: { ...process.env, MOTH_BENCH: "1" } }).stdout.split("\n");
    return Object.values(PROGRAMS).map((_, i) => ({ ms: Number(lines[2 * i]), result: lines[2 * i + 1] }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const ms = (n) => `${n < 10 ? n.toFixed(1) : n.toFixed(0)} ms`.padStart(9);
const compiled = compiledTimes();
console.log(`${"".padEnd(32)} ${"VM".padStart(9)} ${"JIT".padStart(9)} ${"Wasm".padStart(9)} ${"Rust".padStart(9)} ${"Compiled".padStart(9)}`);
for (const [i, [name, source]] of Object.entries(PROGRAMS).entries()) {
  const [vm, jit, wasm] = ["vm", "jit", "wasm"].map((engine) => time(source, engine));
  const native = timeNative(source) ?? { ms: NaN, result: vm.result };
  const exe = compiled?.[i] ?? { ms: NaN, result: vm.result };
  const same = [jit, wasm, native, exe].every((t) => t.result === vm.result) ? "" : `   DIFFERENT RESULTS: ${vm.result} / ${jit.result} / ${wasm.result} / ${native.result} / ${exe.result}`;
  const shown = (t) => (Number.isNaN(t.ms) ? "(not built)".padStart(9) : ms(t.ms));
  console.log(`${name.padEnd(32)} ${ms(vm.ms)} ${ms(jit.ms)} ${ms(wasm.ms)} ${shown(native)} ${shown(exe)}${same}`);
}
