// Times a few Moth programs. Run with `npm run bench`; pass a path to time another copy of moth.js.
import { pathToFileURL } from "node:url";

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

const ms = (n) => `${n < 10 ? n.toFixed(1) : n.toFixed(0)} ms`.padStart(9);
console.log(`${"".padEnd(32)} ${"VM".padStart(9)} ${"JIT".padStart(9)} ${"Wasm".padStart(9)}`);
for (const [name, source] of Object.entries(PROGRAMS)) {
  const [vm, jit, wasm] = ["vm", "jit", "wasm"].map((engine) => time(source, engine));
  const same = vm.result === jit.result && vm.result === wasm.result ? "" : `   DIFFERENT RESULTS: ${vm.result} / ${jit.result} / ${wasm.result}`;
  console.log(`${name.padEnd(32)} ${ms(vm.ms)} ${ms(jit.ms)} ${ms(wasm.ms)}${same}`);
}
