// Times a few Moth programs. Run with `npm run bench`, or `npm run bench -- --big` for bigger ones; pass a path
// to time another copy of moth.js.
import { fileURLToPath, pathToFileURL } from "node:url";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const other = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
const { run, machineCompiler } = await import(other ? pathToFileURL(other).href : "./moth.js");
const big = process.argv.includes("--big");

const PROGRAMS = {
  "a program that only starts": "say 1",

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

// lists, records, dictionaries and text, ten times as big and more
const BIG = {
  "2,000,000 records": `set total to 0
for each i from 1 to 2000000
    set point to record with x i, y i * 2, label "a"
    set total to total + x of point + y of point
end
say total`,
  "list: 3,000,000 adds, then summed by item": `set xs to empty list
for each i from 1 to 3000000
    add i to xs
end
set total to 0
for each i from 1 to length of xs
    set total to total + item i of xs
end
say total`,
  "list: for each over 3,000,000": `set xs to empty list
for each i from 1 to 3000000
    add i * 2 to xs
end
set total to 0
for each x in xs
    set total to total + x
end
say total`,
  "list: set item 5,000,000 times": `set xs to empty list
repeat 1000 times
    add 0 to xs
end
set k to 0
for each i from 1 to 5000000
    add 1 to k
    if k is greater than 1000
        set k to 1
    end
    set item k of xs to item k of xs + 1
end
say item 7 of xs`,
  "dictionary: 2,000,000 counts": `set counts to empty dictionary
set words to list of "apple", "pear", "fig", "kiwi", "plum", "lime", "date"
set k to 0
repeat 2000000 times
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
  "300,000 records in a list": `set people to empty list
set a to 0
for each i from 1 to 300000
    add 1 to a
    if a is greater than 89
        set a to 0
    end
    set person to record with name "p" + i, age a
    add person to people
end
set total to 0
for each p in people
    if age of p is greater than 50
        set total to total + age of p
    end
end
say total`,
  "text: join 200,000 pieces": `set parts to empty list
for each i from 1 to 200000
    add "x" + i to parts
end
set joined to join parts with ","
say length of joined`,
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

// The same programs in machine code, made by machine.moth, each run as a whole program from start to finish,
// the best of 5 after two to warm up, so starting it up is counted too; on Windows and Linux. On Windows the
// virus checker looks through a program the first times it runs, and one in the temporary folder every time,
// so they're made in a folder of the repo's.
const machine = machineCompiler(readFileSync(new URL("./machine.moth", import.meta.url), "utf8"), readFileSync(new URL("./compiler.moth", import.meta.url), "utf8"));
const target = { win32: "windows", linux: "linux" }[process.platform];
function timeMachine(source, dir, name) {
  if (!target) return null;
  const exe = join(dir, target === "windows" ? `${name}.exe` : name);
  try {
    writeFileSync(exe, machine(source, { target, name: `${name}.moth` }));
  } catch {
    return null; // a program it can't make machine code of yet
  }
  if (target === "linux") chmodSync(exe, 0o755);
  let best = Infinity;
  let result;
  for (let i = 0; i < 2; i++) spawnSync(exe, []);
  for (let i = 0; i < 5; i++) {
    const start = performance.now();
    result = spawnSync(exe, [], { encoding: "utf8" }).stdout.trim().split("\n").pop();
    best = Math.min(best, performance.now() - start);
  }
  return { ms: best, result };
}

const ms = (n) => `${n < 10 ? n.toFixed(1) : n.toFixed(0)} ms`.padStart(9);
const dir = mkdtempSync(fileURLToPath(new URL("./.bench-", import.meta.url)));
try {
  if (!big) {
    console.log(`${"".padEnd(36)} ${"VM".padStart(9)} ${"JIT".padStart(9)} ${"Wasm".padStart(9)} ${"Machine".padStart(9)}`);
    for (const [i, [name, source]] of Object.entries(PROGRAMS).entries()) {
      const [vm, jit, wasm] = ["vm", "jit", "wasm"].map((engine) => time(source, engine));
      const exe = timeMachine(source, dir, `p${i}`) ?? { ms: NaN, result: vm.result };
      const same = [jit, wasm, exe].every((t) => t.result === vm.result) ? "" : `   DIFFERENT RESULTS: ${vm.result} / ${jit.result} / ${wasm.result} / ${exe.result}`;
      const shown = (t) => (Number.isNaN(t.ms) ? "(can't yet)".padStart(9) : ms(t.ms));
      console.log(`${name.padEnd(36)} ${ms(vm.ms)} ${ms(jit.ms)} ${ms(wasm.ms)} ${shown(exe)}${same}`);
    }
  } else { // `npm run bench -- --big`: work big enough that starting a program up is a small part of it, which
    // is taken off machine code's times, as an empty program in the same folder takes; the VM sits it out
    const start = timeMachine("say 1", dir, "start")?.ms ?? 0;
    console.log(`${"".padEnd(40)} ${"JIT".padStart(9)} ${"Wasm".padStart(9)} ${"Machine".padStart(9)}   (${start.toFixed(1)} ms to start up taken off)`);
    for (const [i, [name, source]] of Object.entries(BIG).entries()) {
      const [jit, wasm] = ["jit", "wasm"].map((engine) => time(source, engine));
      const exe = timeMachine(source, dir, `b${i}`) ?? { ms: NaN, result: jit.result };
      const same = [wasm, exe].every((t) => t.result === jit.result) ? "" : `   DIFFERENT RESULTS: ${jit.result} / ${wasm.result} / ${exe.result}`;
      console.log(`${name.padEnd(40)} ${ms(jit.ms)} ${ms(wasm.ms)} ${Number.isNaN(exe.ms) ? "(can't yet)".padStart(9) : ms(exe.ms - start)}${same}`);
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
