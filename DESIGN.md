# Design notes

Why Moth is built the way it is, what each choice costs, and what I measured.

## 1. A grammar that reads like English but parses like code

- **One statement per line, blocks close with `end`.** Newlines carry meaning, so
  no semicolons or braces are needed, and every block has one obvious ending.
  The parser checks for a new line after each statement, which turns
  `set x to 5 6` into an error instead of two silent statements.
- **Two-word comparisons** (`is at least`, `is divisible by`) live in one table.
  After `is`, the parser looks at the next two words and checks that table. Adding
  a comparison means adding one row.
- **`say` puts its pieces next to each other**: `say "Total: " total`. It reads
  naturally, but it has a catch: `say "a" -1` means subtraction. I accepted that,
  because brackets fix it and the common case stays clean.
- **Reserved words are kept to the ones that start a statement or a value** (22
  of them). Words that only appear in the middle of a statement, like `times`,
  `from`, `with`, and `than`, are still free to use as variable names.
- **Counting starts at 1** (`item 1 of fruits`), because that's what the words
  mean in English.
- **Errors teach.** A symbol from another language gets the Moth word back
  (`>` → "write 'is greater than'"), and `x is 5` on its own line suggests
  `set x to ...`.

## 2. Variables are resolved when the program is read

A name inside a function means:

1. its own input, or a function it made with `to`; otherwise
2. a variable of the outermost enclosing function (or the top level) that also
   `set`s that name; otherwise
3. its own local variable.

This gives closures for free (a counter's inner function can `add 1 to count`)
without a `global` or `nonlocal` keyword. Because it is decided at compile time,
each variable becomes a fixed (depth, slot) pair, and looking it up at run time is
an array index instead of a search by name.

**The one change from v1.** v1 decided this while the program ran, so the result
depended on whether a variable happened to exist yet. In this program, v1 said
`x` had no value, and v2 prints `1`:

```
to f
    set x to 1
end
f
say x
set x to 2
```

v2's rule depends only on the text of the program, which makes it easier to
explain.

## 3. From a tree-walker to a bytecode VM

v1 walked the syntax tree with recursive JavaScript functions. That was simple,
but it had three problems:

- Moth recursion used the JavaScript stack, so it failed at about 1,000 calls deep.
- Every variable read searched a chain of scope objects by name.
- A running program couldn't be stopped, so v1 cut every program off after 10
  million steps.

v2 compiles each function to a flat array of numbers (34 opcodes) and runs it in
one loop with its own value stack and call stack. Best of 5 runs on a Ryzen 5
4600H with Node 24 (`npm run bench`):

| Program | v1 tree-walker | v2 bytecode VM |
|---|---|---|
| fib(25), function calls | 60 ms | 72 ms (1.2× slower) |
| sum 1 to 1,000,000, a loop | 163 ms | 61 ms (2.7× faster) |
| primes up to 5,000, lists | 320 ms | 113 ms (2.8× faster) |
| recursion 10,000 deep | fails | 6 ms |

**Calls are slightly slower.** v1's Moth calls were JavaScript calls, which V8
optimises very well. v2 has to build its own frame and variable array for every
call. That is the price of recursion up to 100,000 calls deep. Things I measured:

- Kept: avoiding `array.length = n` on the stack (calls became 27% faster) and
  a fast path for comparing two numbers (lists became 25% faster).
- Dropped, because they made no difference: storing frames as flat entries
  instead of objects, and building variable arrays with `push` instead of
  `fill` (loops got slower).

The next step for call speed would be reusing variable arrays for calls that
don't create closures.

## 4. Errors point at the exact spot

Every token records its line and column. Every syntax-tree node keeps the token it
came from, and every bytecode instruction keeps its node's token in a parallel
array. When the VM hits an error, it looks up the instruction it was running, and
`excerpt()` draws the line with a `^` under that spot.

## 5. The playground never freezes

Each run starts a fresh Web Worker. Stop calls `worker.terminate()`, which works
however busy the program is, so the playground needs no step limit. The worker
sends output every 50 ms while the program runs and shows at most 10,000 lines.
The step limit is still in `run(source, print, { maxSteps })`, because tests and
fuzzing need to run untrusted programs without a Stop button.

## 6. How it's tested

- **Every playground example** runs with its exact expected output.
- **Behaviour tables**: programs and their output, and broken programs and their
  exact error messages, including where the error points.
- **Fuzzing**: 5,000 programs made by randomly breaking real ones (deleting
  characters, repeating lines, swapping words). Each one must either finish or
  fail with a `MothError` whose position is inside the code. It must never fail
  with a JavaScript error. The seed is fixed, so a failure always reproduces.
  About 15% of them finish, 30% fail while running, and 55% fail while being read.
- **Differential testing during the rewrite**: 19,001 fuzzed programs ran through
  both v1 and v2 and gave identical output and error messages. The only
  difference found was the intended one in section 2.
- **The tests were checked themselves**: I broke the interpreter on purpose
  (a wrong scope rule, a dropped `not`, missing type checks) and looked for a
  failing test each time. One got through: `-"a"` quietly gave `NaN`. That's how
  the `'-' needs a number` test got added.
