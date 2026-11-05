// Times a few Moth programs. Run with `npm run bench`, or `npm run bench -- --big` for bigger ones; pass a path
// to time another copy of moth.js.
import { fileURLToPath, pathToFileURL } from "node:url";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  // calls the compiler can't put in line, and a function with a loop of its own
  "calls: 4 inputs, 3,000,000 times": `to distance with x1, y1, x2, y2
    set dx to x2 - x1
    set dy to y2 - y1
    return dx * dx + dy * dy
end
set total to 0
for each i from 1 to 3000000
    add distance(i, 0, 0, i bit and 1023) to total
end
say total`,
  "calls: a loop in each, 300,000 times": `to steps with n
    set count to 0
    repeat while n is not 1
        if n is divisible by 2
            set n to n / 2
        else
            set n to 3 * n + 1
        end
        add 1 to count
    end
    return count
end
set longest to 0
for each i from 1 to 300000
    set s to steps(i)
    if s is greater than longest
        set longest to s
    end
end
say longest`,
  "records: 2 calls make 2, 1,000,000 times": `to make_point with x, y
    return record with x x, y y
end
to moved with p, dx
    return record with x (x of p) + dx, y y of p
end
set total to 0
for each i from 1 to 1000000
    set p to moved(make_point(i, 2 * i), 3)
    set total to total + x of p + y of p
end
say total`,
  "text: 2 letters added, 1,000,000 times": `set made to ""
for each i from 1 to 1000000
    set made to made + "ab"
end
say length of made`,
  "text: 2,000,000 letters, each compared": `set made to ""
for each i from 1 to 100000
    set made to made + "the quick brown fox "
end
set vowels to 0
for each c in made
    if c is "a" or c is "e" or c is "i" or c is "o" or c is "u"
        add 1 to vowels
    end
end
say vowels`,
  "list: a grid, item of item, 4,000,000": `set grid to empty list
for each r from 1 to 1000
    set row to empty list
    for each c from 1 to 1000
        add r + c to row
    end
    add row to grid
end
set total to 0
repeat 4 times
    for each r from 1 to 1000
        for each c from 1 to 1000
            set total to total + item c of item r of grid
        end
    end
end
say total`,
  "dictionary: 300,000 keys made, set, read": `set d to empty dictionary
for each i from 1 to 300000
    set item ("key" + i) of d to i
end
set total to 0
for each i from 1 to 300000
    set total to total + item ("key" + i) of d
end
say total`,
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
    // A real program: moth, made by `node bootstrap.mjs`, building compiler.moth (2,400 lines), the best of 3
    const moth = fileURLToPath(new URL(target === "windows" ? "./moth.exe" : "./moth", import.meta.url));
    if (target && existsSync(moth)) {
      writeFileSync(join(dir, "compiler.moth"), readFileSync(new URL("./compiler.moth", import.meta.url)));
      let best = Infinity;
      for (let i = 0; i < 3; i++) {
        const begun = performance.now();
        const built = spawnSync(moth, ["build", "compiler.moth"], { cwd: dir, encoding: "utf8" });
        best = Math.min(best, performance.now() - begun);
        if (built.status !== 0) throw new Error(built.stdout + built.stderr);
      }
      console.log(`${"moth building compiler.moth".padEnd(40)} ${"".padStart(9)} ${"".padStart(9)} ${ms(best)}`);
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
