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
  `set x to ...`. A misspelled name gets the closest real one ("Did you mean
  'total'?"). The compiler already knows every name a line can see, so it works
  this out once, using edit distance where swapping two letters counts as one
  edit. A line that starts with an unknown name also checks Moth's own words, so
  `sya "hi"` suggests `say`.

## 2. Variables are resolved when the program is read

A name inside a function means:

1. its own input, or a function it made with `to`; otherwise
2. for a name it sets, the variable of that name around it (in an enclosing
   function, or the top level) if that one is made above the function's `to`
   line, and otherwise its own local variable;
3. for a name it only reads, the variable of that name around it, wherever
   that one is set.

This gives closures for free (a counter's inner function can `add 1 to count`)
without a `global` or `nonlocal` keyword. Because it is decided at compile time,
each variable becomes a fixed (depth, slot) pair, and looking it up at run time is
an array index instead of a search by name. Until section 27, rule 2 didn't ask
where the variable was made, which was a trap.

**The one change from v1.** v1 decided this while the program ran, so the result
depended on whether a variable happened to exist yet. In this program, v1 said
`x` had no value, and v2 printed `1`; since section 27 it stops at `say x`
again, but now because f's `x` is f's own:

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

v2 compiles each function to a flat array of numbers (36 opcodes, one of them only in debug builds) and runs it in
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

Share links keep the code in the URL's `#fragment`, which browsers never send to
a server. The page sets all output as text, never as HTML, so a shared program
can't inject anything into the page.

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

## 7. The command line and the compiler

- **`vm.js` imports nothing.** The compiler (`moth.js`) and the machine
  (`vm.js`) only share the bytecode format. That's what makes `moth build`
  simple: it writes `vm.js`, the program's bytecode as JSON, and the source text
  into one `.mjs` file. The compiled program never tokenizes or parses
  anything, and it runs on any Node with no Moth installed. Tokens are reduced
  to their line and column, so a compiled program's errors still point at the
  right spot. The Counter example compiles to 16 KB.
- **The shell is a compiler session.** It keeps two things between entries: the
  compiler's map of top-level names to slots, and the machine's array of
  top-level values. Each entry is compiled as a continuation of the ones before
  it, and functions from earlier entries keep working because they hold that
  same array. An entry only changes the name map after it parses, so a typo
  leaves the session as it was.
- **"Is this block finished?"** If an error lands on the end-of-code token (a
  missing `end`, or `say 1 +` with nothing after it), the code stopped too
  early rather than being wrong. The shell then shows `....>` and waits for more
  lines, so the parser decides without a separate bracket counter.
- **Trade-off: Ctrl+C.** A Moth program runs on Node's main thread, so the shell
  can't catch Ctrl+C while a program runs. It puts the terminal back in normal
  mode during each run, so Ctrl+C ends a stuck program by ending the shell.
  Running each entry in a worker thread, like the playground does, would stop
  just the program. That isn't built yet.

## 8. The debugger

- **Pausing costs nothing when you're not debugging.** `compile(source, { debug:
  true })` adds a `LINE` instruction before each statement and at the top of
  each loop round. Normal builds don't contain it at all.
- **A machine that can stop and carry on.** The run loop lives in a `Machine`
  that keeps its state (stacks, current function, instruction pointer) between
  `run()` calls. `run()` stops when the program ends, or at a `LINE` when asked.
- **Time travel by recording, not by undoing.** Running backwards would mean
  undoing every change a program made. Instead, `timeline()` runs the debug
  build once and takes a snapshot at every `LINE`: the line, the calls, every
  variable in view, and how many lines had been said and drawn by then. Going
  back to any step just shows its snapshot, with the output and the drawing cut
  to those counts, so Back costs the same as Step, and the slider can jump
  anywhere. Recording stops at 10,000 steps, so a loop that never ends is cut
  short instead of hanging the page. The 7,673 steps of the Tree example take
  about 20 ms to record. The cost is memory: each snapshot keeps its variables
  as text.
- **Showing what a closure remembers.** Each compiled function keeps a link to
  the function it was made inside, and each variable array keeps a link to the
  array of the scope it was made in. The two chains nest the same way, so
  `inspect()` walks them together: the running function's variables, then those
  of each function around it, then the top level's. In the Counter example,
  stepping into `next` shows `count`, which lives in `counter`.
- **A slowdown, bisected.** Moving the loop's state onto an object made loops
  1.4× slower (61 → 86 ms). I tested each change on its own: closures over the
  hot variables, the slice check, the extra `LINE` case, a class method instead
  of a function, and saving state on exit. None of them mattered. What did was
  where the value stack was created. V8 makes `push` and `pop` fastest on an
  array it saw created in the same function. Each `run()` now creates a fresh
  local stack and copies in whatever a paused run left, and loops are back to
  60 ms.

## 9. Drawing

- **The turtle lives in the VM.** One `TURTLE` instruction covers `move`,
  `turn` and `pen`. The machine keeps the turtle's position, heading, pen color
  and width, and for each line it draws calls a `draw` callback with the two
  ends, the color and the width. The VM never touches a canvas, so the same
  program can draw in the browser, write an SVG from `moth run`, or be counted
  in a test.
- **Ends are rounded to hundredths.** Otherwise `cos(90°)` leaves lines ending
  at 6.1e-17, or even `-0`, which a test caught, instead of 0.
- **The canvas zooms out, never in.** A drawing that reaches past the edge is
  scaled to fit, and one that fits is drawn at actual size. During time travel
  the scale comes from the whole recording, so the picture doesn't jump while
  the slider moves.
- **Colors are the program's own text.** The canvas ignores a name it doesn't
  know and keeps the previous color. The SVG writer escapes the text before
  putting it in an attribute, so a "color" can't break the file.

## 10. The JIT: compiling Moth to JavaScript

- **Why it's fast.** The VM decodes every instruction and keeps every value on
  an array stack. The JIT turns each Moth function into a JavaScript function
  and each variable into a JavaScript variable named after its slot (`v1_2`), so
  V8 compiles the program to machine code and keeps its numbers in registers.
  Functions made inside functions become JavaScript closures, which behave the
  same way as the VM's chained scope arrays. Best of 5 on the same machine:
  fib(25) 67 → 7.2 ms, a million-round loop 56 → 7.5 ms, primes 106 → 17 ms.
- **One set of rules, two engines.** Every check and error message lives in
  `vm.js` as a small function that takes an `error` callback. The VM passes one
  that marks the instruction it was running; the JIT passes one per spot in the
  source. Both back ends build on `scope.js`, so they agree on what every name
  means. The JIT's helpers handle the two-numbers case inline and hand
  everything else to the shared checks.
- **Deep recursion.** The JIT's Moth calls are JavaScript calls, and JavaScript's
  stack runs out a few thousand calls deep. Moth programs can't read input or
  the clock, so running one twice says and draws exactly the same things. When
  calls go past 2,000 deep, the JIT stops and `run()` runs the program again on
  the VM (100,000 calls deep), passing on only the output the first run hadn't
  shown yet.
- **Why stop at 2,000, not when JavaScript runs out.** The fuzzer found that when
  JavaScript's stack ran out *inside* the callback that passes on a drawn line,
  the line had been counted but not shown, and the hand-over skipped it. A fixed
  depth of our own means the hand-over always happens at a known point. Output
  is also counted only after it has been passed on.
- **How it's kept honest.** Every table test runs on both engines, and 5,000
  fuzzed programs must give identical output, drawings and errors on both. Of
  three bugs planted in the JIT, one (a `repeat` loop not counting its steps)
  was caught only by that comparison.

## 11. The checker: mistakes found without running

- **Types for the whole program.** Each variable gets one type (number, text,
  yes/no, nothing, list or function) from every place that sets it. The
  types depend on each other, so the checker repeats until none change. If
  places disagree, the variable becomes "could be several" and the checker stays
  quiet about it. A type only ever moves from unknown, to one type, to
  "several", so this always settles. An `add` that is going to fail doesn't
  count towards the type, because the program stops there.
- **The real error, before it happens.** For each operation whose operand
  types are known, the checker calls the same shared check the engines use, on
  a sample value of each type, so a warning is word for word the error that
  line would stop with. Checks that depend on a value (dividing by zero, an item
  number below 1) only run when that value is written in the code.
- **Only what's certain.** Nothing inside the right side of `and` or `or` is
  treated as certain, since it might never run. Other warnings: names nothing
  sets (with "did you mean"), a function given the wrong number of inputs (only
  when the name is one function, made once), lines after a `return`, and
  variables and functions made but never used.
- **Tested against reality.** On 3,000 randomly broken programs, the test
  records which lines really run. A line the checker says will fail must never
  run in a program that finishes, a "never runs" line must never run, and when
  a program does fail where the checker said, the messages must match. The
  checker predicts 44% of runtime errors with no false alarms. The one known
  gap: it doesn't follow the order code runs in, so a name used before its line
  of `set` fails with "has no value yet" instead of what the checker said.

## 12. Records, `fail with`, and `load()`

- **Records are the smallest thing a compiler needs.** A syntax tree needs nodes
  with named parts, so Moth got `record with kind "set", name n`, `name of
  node` and `set name of node to ...`. A record is a JavaScript object with no
  prototype, so a field can be called anything, even `constructor`, and a
  misspelled field gets "did you mean". Both engines share the checks, and `is`
  compares records field by field, as it does lists.
- **Records with shapes.** At first a record was `Object.create(null)`, which
  V8 keeps as a slow dictionary. Profiling the neural network below showed
  records taking 40% of its time. Now a record is made by `new Record()`, whose
  prototype is an empty object with no prototype of its own: any field name
  still works, and records with the same fields share a shape, so V8 reads them
  fast. Reading a field skips the "is it really there" check, since no Moth value
  is `undefined` and nothing is inherited. Records got 2× faster on the JIT and
  the network went from 1.18 s to 0.62 s. Only the runtime changed, so the
  generated JavaScript, and the compiler written in Moth that matches it,
  stayed the same.
- **`fail with value`** stops the program with the value as its message and
  keeps the value on the error. The compiler written in Moth uses it to report
  a mistake in the code it compiles: `fail with record with at token, reason
  "..."`, which JavaScript turns back into a normal Moth error at that spot.
- **`load(source)`** runs a program and hands its top-level variables to
  JavaScript, with Moth functions as JavaScript functions. A failed call deep
  inside used to leave the JIT's call depth raised, so after a few thousand
  failed calls a short one was taken for runaway recursion. An error now resets
  the depth, since it ends every call in progress anyway.

## 13. Self-hosting: Moth's compiler, in Moth

[`compiler.moth`](compiler.moth) is a second compiler for the language,
written in the language: a tokenizer, a recursive-descent parser that builds
records, the scope rules, and a JavaScript writer. It writes exactly the
JavaScript `jit.js` writes, and stops at the same mistakes with the same
messages and positions.

- **Byte for byte, not "close enough".** Matching output means every decision
  has to be the same: the order positions are numbered in, when a temporary is
  made for `and`, how "did you mean" breaks a tie. That makes the JIT a precise
  spec, and the tests can compare whole programs with `===` instead of
  guessing what counts as the same.
- **Bootstrapping.** `compiler.moth` compiled by the JIT compiles itself. The
  compiler that makes compiles it again, and the one after that. All three
  stages write the same 94 KB of JavaScript, so the compiler has reached a
  fixed point. `moth bootstrap` runs it; each stage takes about 60 ms.
- **The language changed to make this possible, not the compiler.** Moth has no
  character codes, so the rules for reading text had to be ones Moth can
  follow with comparisons alone. Every control character now counts as a space
  (as in Wirth's Pascal compilers), comments run to the end of the line, and
  text can't hold a control character other than tab. Before, `\s` and `.` in
  the tokenizer's regular expression brought in Unicode spaces and line ends
  that Moth couldn't name. A character's width in columns (JavaScript counts
  an emoji as 2) is one comparison against the first and last characters past
  the 65,536 that fit in one unit.
- **Numbers go out as written.** The JIT used to print a number literal with
  `JSON.stringify`, so matching it would have meant writing JavaScript's float
  formatting in Moth. Now both compilers write the number as it appears in the
  source, without leading zeros (JavaScript reads `07` as octal). That turned up
  a real bug: `JSON.stringify` prints a number too big for a float as `null`,
  so a 400-digit literal was `nothing` on the JIT and `Infinity` on the VM.
- **One rule to watch.** A name a function sets belongs to the top level when
  the top level sets it too. So in `compiler.moth`, a name set at the top
  (`ats`, the tables) is never set inside a function, and the parser's helpers
  live inside `parse`, sharing its position the way the JavaScript parser's
  closures do.
- **How it's kept honest.** The tests run it beside the JIT on every example,
  every table program and 3,000 fuzzed programs. Of two bugs planted in it,
  one (the "did you mean" distance for short names) was caught only by the
  fuzzed programs. Writing it also found a crash in the real parser: a line
  starting with `constructor` looked up the turtle's words in a plain object
  and found `Object.prototype.constructor`.
- **Known gaps.** Moth sees text as whole characters, so it can't tell half of
  an emoji (a lone surrogate, which no file can hold) from a whole one. Its
  parser is 8 Moth calls deep per bracket and the JIT stops at 2,000 calls, so
  it gives up at about 245 levels of brackets, where the JIT goes past 1,000.

## 14. A neural network, written in Moth

[`neural.moth`](neural.moth) is a test of the language as much as a demo: a
real program, with recursion, records that point at each other, and thousands
of numbers, written the way a beginner would read it.

- **Autograd with records.** As in Karpathy's micrograd, every number the
  network works out is a record holding its value, how it was made (`op`,
  `a`, `b`) and its gradient. Backpropagation sorts the records so each comes
  after the ones it was made from (a recursive walk that marks what it has
  seen), then goes through them backwards, applying the chain rule for `+`,
  `*` and ReLU. The loss is micrograd's max-margin loss plus a little weight
  decay, so it needs no `exp`.
- **Its own maths.** Moth has no random numbers, no sine and no rounding. The
  program makes them: Park and Miller's random numbers (16807 × seed, mod
  2³¹−1, exact in a float because the product stays under 2⁵³), a whole-number
  part found one power of two at a time, and sine from 12 terms of its Taylor
  series. Because the random numbers come from a fixed seed, every run is the
  same, so both engines can be required to say and draw exactly the same things.
- **Two forward passes.** Training builds records so it can learn. Drawing what
  the network believes takes 1,440 guesses per picture, so a second forward pass
  works on plain numbers and makes nothing to learn from.
- **Pictures with a turtle.** The turtle only moves and turns, so the program
  keeps track of where it is and steers to each point. Each row of a picture is
  a few thick lines, one per run of cells with the same colour, which keeps four
  pictures to about 1,200 lines. The playground draws them as training goes.
- **Tested like the rest.** The test trains it on both engines and requires the
  same output and drawing, line for line, every dot on the right side at the
  end, and nothing for the checker to complain about. A bug planted in the
  chain rule for `*` left the network stuck at 50% and failed the test.

## 15. The WebAssembly engine

[`wasm.js`](wasm.js) compiles Moth to WebAssembly, the third engine. Nothing in
between: [`wasm-binary.js`](wasm-binary.js) writes the binary format itself
(LEB128 numbers, sections, the GC proposal's struct and array types), and keeps
a readable listing as it goes, which `moth wasm` and the playground show.

- **Moth's values, inside the module.** A number is a struct holding an f64,
  yes and no are `i31` values, nothing is null, and lists, records and
  functions are GC structs, so V8's garbage collector looks after them. A
  variable's slot starts as a shared `unset` struct, so "has no value yet"
  works as in the other engines.
- **One set of rules, three engines.** The common cases run in WebAssembly:
  arithmetic on numbers, comparisons, list items, fields, calls, loops. The
  rare ones and every mistake call out to the same checks in `vm.js` the VM
  and the JIT use, with the values copied out to JavaScript. So the error
  messages match by construction, and the fuzzer checks everything else.
- **Text stays a JavaScript string.** At first, text was an array of UTF-16
  units, and each trip to JavaScript copied it one letter at a time. The
  fuzzer found a program that doubles its text every round: JavaScript joins
  long text without copying, so the other engines reach its length limit in
  milliseconds, while this one slowed down exponentially. Now text is a struct
  holding the JavaScript string itself. Joining it costs what it costs in
  JavaScript, and it fails at exactly the same length.
- **Escape analysis.** A variable no inner function uses can't outlive its
  call, so it becomes a WebAssembly local, which the machine keeps in a
  register. Only captured variables go in a heap scope struct, and a function
  that captures nothing and makes no functions allocates no scope at all.
- **Unboxed numbers.** A variable that can only ever hold a number (every
  `set` gives it one, it counts in `for each ... from`, or `add` adds to it)
  lives in an f64 local, so `add i to total` allocates nothing. The set of
  such variables is a fixed point, as in the checker: assume all candidates are
  numbers, drop any that something else could reach, repeat. A box is made only
  when the number is used as a general value, and kept until the number
  changes. The box local starts as `unset`, which doubles as "has no value yet".
- **Divisibility, exactly.** WebAssembly has no floating-point remainder. For
  whole numbers below 2^52, a is divisible by b exactly when a equals
  trunc(a / b) × b: a quotient that is a whole number comes out of the division
  exactly, and every product here is a whole number that a float holds exactly.
  Fractions and bigger numbers call JavaScript's `%`. That took primes from 33 ms
  to 13 ms.
- **The validator as a second checker.** V8 rejects a module that breaks
  WebAssembly's type rules and names the function and the offset. It found a
  missing `ref.as_non_null` on the first run. The fuzzer found the rest: a
  loop counter in a local kept its value into the next run of the loop, since
  locals are zeroed only once per call.
- **Speed.** Best of 5 (VM / JIT / WebAssembly): fib(25) 67 / 6.8 / 4.7 ms, a
  million-round loop 55 / 7.1 / 2.6 ms, primes 104 / 17 / 13 ms, 200,000 records
  86 / 14 / 7.7 ms, the neural network 3.1 / 0.58 / 0.33 s. It is the fastest
  engine on everything that doesn't recurse past 2,000 calls, which it hands to
  the VM, as the JIT does.
- **Limits.** Browsers won't compile a module over 4 KB on the page's main
  thread without waiting, so runs compile it in the Web Worker, and the
  Compiled view only builds the bytes and the listing. It needs WebAssembly GC
  (Node 22, Chrome 119, Firefox 120, Safari 18.2).

## 16. stop, text helpers, ask and use

- **`stop`** leaves the innermost loop. The VM pops the loop's own values off
  its stack (one for `repeat`, two for `for each ... from`) and jumps to its
  end, the JIT writes `break` (every Moth loop is a JavaScript loop, and
  nothing else is), and WebAssembly branches out of the loop's block, counting
  how many blocks are open to know how far. A `stop` outside a loop, or in a
  function inside one, is a mistake the parser points at.
- **One table of built-in operations.** `uppercase of`, `lowercase of`,
  `split ... by`, `join ... with`, `number of` and `position of ... in` are
  rows in `BUILTINS` in vm.js: a name, what each input must be, and what to
  do. Each checks its inputs' kinds before anything depends on their values,
  and every engine runs the same table (the VM with one instruction, the JIT
  with one helper, WebAssembly with one import), so results and mistakes match
  by construction. The checker reads the same `needs` to warn about an input
  of the wrong kind before the program runs, and stays quiet about values,
  like `number of "abc"`, which only running can tell.
- **`ask` without giving up replay.** The JIT and WebAssembly hand deep
  recursion to the VM by running the program again, which only works if a
  second run does the same things. `ask` is the one way a program can learn
  something new, so `run()` keeps every answer, and a second run gets them
  again instead of asking. The playground uses the same idea: a Web Worker
  can't stop and wait for the page, so a question ends the run, and once it's
  answered the program runs again from the start with every answer so far,
  and the page shows only what's new. The debugger replays the last run's
  answers.
- **`use` is splicing, not modules.** A used file's statements join the
  program's top level, once, however many files use it. That keeps every back
  end unchanged: they still see one program. Tokens remember their file, so a
  mistake in one says `math.moth, line 40`, and the CLI shows that file's
  line. Files that use each other in a circle are a mistake, found by keeping
  the files being read on a stack. The cost of splicing is a shared top level:
  a library's helper variables can collide with a program's, which `use ...
  as` (section 18) fixes without giving splicing up.
- **The compiler written in Moth keeps up.** Each feature went into
  `compiler.moth` too (with `stop`, `join`, `lowercase` and `position` now
  Moth words, its own names for them changed), and it still compiles itself to
  exactly the JIT's JavaScript.

## 17. Reading handwriting

- **No dataset.** The network learns from digits Moth draws: each digit as
  pen strokes, in a few of the ways people write it, bent at random each time
  (tilted, slanted, stretched, shaky, strokes not quite meeting). Mouse
  drawings are strokes too, which is why this works at all.
- **One road to a picture.** A drawing travels as text (`"x,y x,y;x,y"`), the
  same format the shapes are written in, and both become a 16×16 picture the
  same way: scaled to fill the middle 12×12 pixels keeping their shape (so a 1
  stays thin), then drawn with a pen whose ink fades over its last pixel.
- **Speed where it counts.** Only inked pixels take part, forwards and
  backwards, which is most of the speed: 3,000 pictures, 10 rounds, about 7
  seconds on WebAssembly. Training starts from a fixed seed, so running it
  again writes the same model file.
- **Train once, read instantly.** The trained weights are printed as Moth
  (`set model_hidden_weights to list of ...`), with the training progress as
  comments, so the model is a file the reader can `use`, and each guess is
  just one pass through the network.
- **Honest limits.** It reads 99% of new drawings of the shapes it knows. The
  test draws ten digits differently (other proportions, a sloppy 8, off to one
  side) and it reads all ten, but it has never seen a person's handwriting, so
  unusual ways of writing a digit can fool it.

## 18. For real programs: try, dictionaries, bytes, files and modules

- **`try` in three engines.** The VM keeps a stack of handlers: where each
  `if it fails` starts, and how deep the calls and the value stack were, so a
  mistake deep inside calls unwinds to the right place. The JIT writes a
  JavaScript `try`/`catch` and puts its call-depth counter back. WebAssembly
  uses its own exception handling, but only JavaScript can tell a Moth mistake
  from going too deep, so a `catch_all` asks it, and passes on what isn't
  ours. Running past `maxSteps` is never caught: a loop that never ends must
  stop, `try` or not.
- **Dictionaries are JavaScript Maps,** with text or numbers for keys, so
  `"1"` and `1` are different keys and the order things were added is kept.
  In WebAssembly, a dictionary is a struct holding the Map, and the Map holds
  the module's own values, so a list put in a dictionary and changed later is
  the same list. A missing key gets a "did you mean" from the keys there.
- **Bytes are a Uint8Array,** checked on every write: a byte is a whole
  number from 0 to 255, or a mistake. Bits work on whole numbers up to 2^53 −
  1, the most a double holds exactly: JavaScript's own bit operators only take
  32 bits, so the high and low parts go through them separately, and `shift`
  is multiplying or dividing by a power of two. Nothing wraps around or rounds
  without saying so.
- **Files without losing replay.** The JIT and WebAssembly hand a program
  that goes too deep to the VM by running it again from the start, which only
  works if the second run sees the same world. `run()` already kept every
  answer to `ask`; now it keeps a log of everything from outside, in order:
  each answer, each file read, and how each write went. The second run is
  served from the log until it catches up, so it reads what the first run
  read, even if a write changed the file since, and writes nothing twice. Where
  the files are is the caller's choice: the folder `moth run` runs in, or files
  in memory that last one run in the playground.
- **Modules are renaming.** `use "math.moth" as math` still splices the file
  in, so no engine changed. But first, every name the file's top level makes
  becomes `math's sine`, which no name in a program can be. Renaming is
  careful about scope: inside the file, a function's inputs and the functions
  it makes itself hide the top level's names, so those are left alone. Using
  the same file as two names gives two separate copies. The JavaScript
  version walks the syntax tree generically; the compiler written in Moth,
  which can't list a record's fields, walks it kind by kind, and the tests
  check both rename alike.
- **One rule for messages.** The checker warns by running the real checks on
  sample values, so a message may only depend on what the checker knows: the
  kind of a value, not the value. The fuzzer found a message that showed a
  wrong value (`'bytes' needs a whole number in front of it, not (5 bytes:
  ...)`) and the checker's sample showed a different one, so wrong kinds are
  now named by kind (`not bytes`), and only a number that's wrong as itself
  is shown.

## 19. Trails, speed, tests and tidying

- **Error trails.** A mistake inside functions lists the calls that led to it,
  innermost first. Each engine already knew its calls in its own way, so each
  reads them its own way: the VM walks its frames (a frame is saved by a CALL
  with two operands, so the call it made is three instructions before where it
  returns to), the JIT keeps two arrays beside its depth counter (the function
  and the call's position, one store each per call), and WebAssembly keeps both
  in an i32 array inside the module, read through three exports when JavaScript
  builds the error. A function that called itself from one spot is one line
  with a count, so even the VM's 100,000-deep recursion is two lines. The
  fuzzer now compares trails too: the same message at the same spot isn't
  enough, the same calls must have led there. The cost is about 10% on fib.
- **WebAssembly, without the trips.** Bytes and dictionaries went to
  JavaScript for every read and write, which made a million-byte loop 20 times
  slower than the JIT. Bytes now live in the module as an array of 8-bit
  numbers, so a byte is one instruction. A dictionary is still a JavaScript Map
  (text keys can only be hashed in JavaScript), but the module hands over the
  Map and the key as a plain string or number, with nothing to convert, which
  makes it as fast as the JIT. Bit operations on numbers below 2^31 are single
  instructions, with a shift left only up to 21 places and right up to 31, so
  the answer is always exact; anything outside those edges goes to the shared
  code, and a test checks the engines agree right at each edge.
- **`expect` and `moth test`.** `expect` keeps both sides of its comparison, so
  a failure can say what they were: `expected 6 to be 5`. A test is a function
  named `test_...`, and each runs in a fresh run of the whole file, so one
  can't spoil another: the simplest isolation, which costs a run of the file's
  top level per test. The call that starts a test is left out of its trail.
- **`moth fmt` asks the parser.** Indenting by keywords goes wrong in a
  language where `to` starts a function and also ends `set x to`, and where
  `label -1` in a record is a negative number while `x - 1` is a subtraction.
  So the parser records how deep each statement starts, which bracket opens a
  call and which minus makes a number negative, and the formatter only lays
  out what it is told. It checks its own work: the tidied code must read
  exactly the same, piece for piece, or nothing is written. Every `.moth` file
  here was already tidy, the 1,500-line compiler included, which says the
  rules match how Moth was already being written.
- **Tools as tests of the language.** Writing `picture.moth`,
  `wordcount.moth` and `json.moth` found two precedence surprises in my own
  code (`read` and `shift ... by` take everything up to the next comparison),
  and the trail pointed straight at the second one. They also show a gap: Moth
  has no word for asking what kind a value is, which is why the JSON tool
  reads JSON but doesn't write it.

## 20. Hunting bugs

- **Programs from the grammar.** The fuzzer breaks programs that already
  exist, so it rarely builds anything new. `generate.js` makes new ones from
  the grammar, every feature mixed in, with a sensible value in each variable
  to start and some lines wrapped in `try`, so they get further before a
  mistake. Each must run the same on all three engines, compile to the same
  JavaScript in the compiler written in Moth, run the same once tidied, and
  get no false alarms from the checker. 12,000 of them found one bug, which
  every engine shared, so only tidying caught it: an `if` on the line after
  an `else` was read as `else if`, so ordinary nested code failed.
- **Gaps found by looking.** A list that holds itself stopped the program
  with "a value got too big" when shown (now `[1, [...]]`, and comparing two
  of them doesn't go round for ever); a file used plainly inside a module was
  read once for everyone, so the program's own use of it was skipped; and a
  built program couldn't `ask`.
- **Measure, then fix.** Typing in the playground's longest example felt
  slow, and the checker, which runs on every key, looked to blame. Measuring
  said otherwise: it took 8 ms of 120. The rest was rebuilding all 4,355
  coloured spans and Chrome laying out all 1,592 lines again, because they
  were one block of text. Now each line is its own block and only changed
  lines are redrawn: 30 ms. Tidy's freeze was the same lesson: tidying took
  50 ms, putting the result in with the browser's undoable insert took 17 s.

## 21. Apps

- **Handlers, set up once.** `when a key is pressed` and `every 100
  milliseconds` only work at the top level, so an app's handlers are a fixed
  list, made while the program sets up. Each is a function over the program's
  own variables, which is how a timer and a key share a game's state. `run()`
  hands back the app: what it waits for, and a way to send it an event. Each
  event gets its own step limit, since a game left running for an hour would
  run out of any shared one.
- **The same app on every engine.** The JIT and WebAssembly hand a program
  that goes too deep to the VM by running it again from the start. An app can
  be deep in an event when that happens, so the VM runs the set-up again, then
  every event sent so far, with the same answers, files and random numbers
  (everything from outside is logged for exactly this), and only then the event
  that went too deep.
- **Randomness comes from outside.** `random number from 1 to 6` asks whoever
  runs the program for a number: `moth run` and a built page give real ones,
  tests give a fixed sequence, and the playground picks a new start for each
  Run but keeps it while the program waits for an answer, so running it again
  up to the question gives the same numbers.
- **A picture that can be redrawn for ever.** `clear` wipes the picture, and
  the playground only keeps what came after the last one, so a game that
  redraws every frame never grows. An app's picture never zooms out the way a
  drawing does, because a click has to land where the thing was drawn.
- **The playground keeps an app running** in its worker, timers and all, no
  more often than every 10 ms, and sends it keys only while the picture has
  the focus, so typing in the editor never reaches the game. Trying it found a
  bug the tests couldn't: the picture took the focus before it was shown, so
  it never had it, and no key arrived.
- **`moth build --web`** makes one HTML file, about 70 KB for Snake: the VM,
  the bytecode, and a short script that draws and sends events. Only the VM,
  because it's the smallest of the three and never too deep. `ask` uses the
  browser's own box. Text in the program can hold `</script>`, which would end
  the page's script early, so every one is written `<\/script>`, which reads
  the same to JavaScript.

## 22. Moth without JavaScript: the Rust engine

- **Why another engine.** Every engine so far runs inside a JavaScript engine,
  so a bug in JavaScript could reach any Moth program. [`native/`](native/) is
  Moth again, from the first character to the last instruction, in Rust with no
  libraries: about 3,000 lines for the lexer, parser, compiler, virtual machine,
  turtle and command line.
- **The same bytecode, so it can be checked.** The compiler makes exactly what
  moth.js's does, instruction for instruction and constant for constant, so
  `moth-native bytecode` and `moth bytecode` print the same text. That splits
  every disagreement in two: different bytecode is a front-end bug, the same
  bytecode with a different result is a machine bug.
- **Numbers, bit for bit.** Rust's shortest float printing picks the same digits
  as JavaScript's except in a tie, where Rust rounds up and JavaScript picks the
  even digit (`-2.6916885375976562`, not `...563`): 2,719 of a million random
  numbers. Ties only happen at 16 or 17 digits, so only those are checked.
  Sine and cosine are fdlibm's, as V8 has them, ported line by line: a library
  sine can differ in the last bit, which moves a drawing's rounding. Both were
  checked against V8 on a million numbers, with no difference.
- **Text as JavaScript sees it.** Columns count UTF-16 units, so mistakes point
  at the same spot after an emoji; text compares by UTF-16 units too
  (`"！" is less than "😀"` is no in JavaScript, though its code point is
  smaller); and every character's upper and lower case is checked against V8.
- **Checked on 80,000 programs.** `native.test.js` sends programs to
  `moth-native conform`, which runs each and reports what it said, drew,
  wrote and failed with, and its bytecode, for the test to hold up against the
  JavaScript VM. On every push: the tables, the examples, 5,000 broken and
  1,500 generated programs, the bundled programs, and the compiler written in
  Moth compiling itself. Once, by hand: 80,000 more from other seeds, with no
  difference. A one-character bug planted in an error message failed two tests.
- **One bug found by timing.** Dictionaries first used a fast hash that only
  mixed the high bits, and a whole number's float has all its low bits zero, so
  300,000 number keys all landed in the same few places: 22 seconds instead of
  0.14. A final mixing step fixed it.
- **Where the engines can differ.** JavaScript stops code nested more deeply
  than its stack allows (about 900 brackets) and values held more deeply (a
  list 2,000 deep), and those limits change with the stack's size, so they
  already differed between the command line and the playground. The Rust
  engine goes further, then stops with the same message.
- **WebAssembly with no JavaScript.** The same Rust code builds for WASI, the
  standard system interface of WebAssembly, into one 750 KB file whose only
  imports are 17 WASI calls (files, the clock, standard input and output,
  random numbers, arguments), so a WebAssembly runtime runs it with no
  JavaScript anywhere. The one change is the stack: a runtime may give
  WebAssembly as little as half a megabyte, so that build stops code nested
  past 500 levels and values past 1,000 with Moth's own message, where the
  stack would have run out with a crash. CI runs it in wasmtime, a runtime with
  no JavaScript in it. Node 24's own WASI runs it too, so the tests use that
  when wasmtime isn't there, but Node 22's crashed on it with a segfault inside
  Node, even for a two-line program: a reason to test in a real runtime.
- **Moth builds itself without JavaScript.** compiler.moth gained a second back
  end, about 500 lines of Moth, that writes the bytecode moth.js's compiler
  makes, in a text format both it and the Rust engine read and write
  (`moth-native build`, `moth-native run x.mothc`). Its first run matched the
  Rust compiler byte for byte on compiler.moth's own 283,823 bytes, and the
  tests hold it to that on 630 programs and 1,500 broken ones. Then `moth-native
  bootstrap` runs compiler.moth on the Rust engine to compile itself, runs what
  that made to do it again, and again: Moth's compiler, written in Moth, run by
  Rust, building itself, with JavaScript nowhere in the loop.
- **Numbers as written.** compiler.moth keeps number tokens as text, and the
  bytecode keeps each number constant as it was written (`const number 0x1F`),
  which both compilers have, so neither has to print a float the other can
  match: Moth itself shows numbers to 15 digits (section 23), which would lose
  the rest. The reader makes the number from the text, `0x` and `0b` included,
  as JavaScript's `Number()` would.
- **The old trap, once more.** In Moth a `set` inside a function changes a
  variable of the top level with the same name, and defining a function counts.
  The new back end's helper `here` would have been overwritten by `resolve`'s
  own `set here to scope`, as `place` was before: it's `code_length` instead.

## 23. Everyday numbers and data

Seven features meant to make Moth better than Python at the things people
first program for: sums of money, trips, recipes, spreadsheets. Each runs on
all four engines, the checker and the compiler written in Moth, and the tests
hold them to agreeing.

- **Fix buttons.** A misspelled name or a symbol from another language already
  got a message saying what was meant; `suggestedFix` turns that into an edit
  (the spot, what's there, what goes there), checked against the code so it only
  replaces what the message names, and the playground puts a **Fix** button on
  the problem.
- **Inputs that say what they are.** `to area with width as a number` stores a
  kind for each input; a call checks them after it checks how many there are,
  so the message names the input: `'area' needs width to be a number, not
  text`. A function whose inputs say nothing carries no list at all, so calls
  to it cost nothing more. The checker starts each such input with that type,
  which lets it see more mistakes inside the function.
- **Numbers like a spreadsheet.** Arithmetic stays the computer's own: binary
  floats, fast. What changed is what a number counts as. `canon(x)` is x to 15
  significant digits (`Number(x.toPrecision(15))`), and a number is shown,
  compared, used as a key, an item's place or a count of times by its canon:
  `0.1 + 0.2` shows as `0.3`, is `0.3`, and finds the key `0.3`. Most
  comparisons never call it: two equal numbers, two whole numbers, or two
  further apart than 15 digits can tell are answered at once, so loops of whole
  numbers run as fast as before. The Rust engine rounds to 15 digits with
  `{:.14e}`, which breaks a tie to the even digit where `toPrecision` goes up;
  a tie only happens when the number is exactly 16 digits long ending in 5, so
  that one case is rounded by hand from all of the float's digits.
- **Units.** `5 km` is an amount: a number and a unit's place in one table,
  which every engine has in the same order. Amounts of one measure add,
  subtract and compare in the left one's unit (`5 km + 300 m` is `5.3 km`),
  `in` converts, and anything else is the same mistake as any other wrong
  kind: `can't use '+' on a distance and a time`. A unit's word only counts as
  a unit straight after a number written out (or after `in`), so `say "Day " day` still means
  the variable. In WebAssembly an amount is its own struct of an f64 and an
  i32, so it never touches the dictionary code that `T.host` values go through.
  One optimisation had to give: WebAssembly kept a variable unboxed when every
  value it got was "a number or a mistake", and `-`, `*` and `/` counted as
  that. Now `2 * x` can be an amount, so a product only counts when both sides
  are numbers; a difference or a quotient still counts when its left side is,
  since a number less (or over) an amount is a mistake.
- **Tables.** `read table "sales.csv"` is the builtin `table` around a `read`,
  so files, sites and the permissions below come for free. Each row is a
  record named by the header, folded to lower case with `_` for anything else
  (`Unit Price` is `unit_price`); headers starting with a digit get `column_`
  in front, because JavaScript puts number-like keys of an object first and
  the Rust engine keeps the order it was given. Empty cells are nothing, and
  `total of`, `average of`, `largest of` and `smallest of` skip them, as a
  spreadsheet does. `for each row in sales where ...` is only parsing: the body
  becomes an `if`, so no engine needed a change. After `total of`, `price in
  sales` is always a column, even when the second word is also a unit's (`steps
  in week`): that clash came up in the first example written with it. A row reaching WebAssembly
  from JavaScript needs ids for its field names, which only exist for names in
  the program, so a new name gets the next id when it arrives.
- **Charts.** `draw chart of` is a turtle action like `draw box`: one function
  in vm.js and one in Rust work out the bars (the longest 200 long, each 30 wide)
  and draw boxes and text, rounded as every drawing is, so the pictures match
  byte for byte.
- **Asking first.** `moth run` and `moth-native run` give a program a disk that
  asks before each file it reads or writes and each site it reads, the way
  Deno does: a person at a terminal is asked; a script gets no, unless moth was
  started with `--allow-read`, `--allow-write`, `--allow-net` or `--allow-all`.
  A refusal is an ordinary mistake, so `try` catches it. Reading a site has to
  wait for it, since `read` gives its answer at once: Node fetches it in a
  second Node and waits for that to finish, the Rust engine runs `curl`, and the
  playground's worker uses a request that waits, which only workers may do.
- **Closing the gaps.** A look at the first version found five ways round it.
  `use` read any file without asking, and a mistake in it printed its lines, a
  secret's included: now every parser refuses a name that starts at the top of
  a disk or goes up out of a folder, and the command lines refuse a link that
  leads out of the program's folder. `moth test`, and programs made by `moth
  build`, didn't ask at all: now they do, sharing one set of answers for every
  test, and `moth build` builds in the flags it's given (`disk.js`, which holds
  all of this, is copied into the program it makes). `--allow-write` was
  everywhere or nowhere: now it can name folders, checked where each file
  really is, links followed, so `data/../notes.txt` or a link inside `data` that
  leads out isn't in `data`; `--allow-net` names sites, and an address written in
  any odd way (`a.com@b.com`, a backslash) matches nothing. And a site could send
  the program on to any other: neither Node nor `curl` follows a site now; each
  new address is asked about again, ten at most. The question shows a file's
  name with anything that moves the cursor or turns text around made `?`.

## 24. Speed: a faster engine, and machine code

- **A faster Rust engine.** Built as one unit with link-time optimisation, which
  alone took 30% off. Each function's code is read out once into instructions
  that hold their operands (`Ins`), instead of each operand being looked up as
  it runs. A function that makes no functions (`is_flat`) keeps its variables
  on the machine's own list, so a call makes no environment. And a few pairs and
  triples that come up all the time run as one instruction (`fuse`): a count
  loop's next number and its variable, `n is less than 2`, `n - 1`, `a + b`, a
  `get` then an `add`. Those leave the instructions after them where they are,
  so a jump into the middle still works, and each fails exactly where its part
  would. Calls got 1.9 times faster, loops 1.7, lists and bytes 1.4 to 1.6; the
  bytecode itself didn't change, so it still matches compiler.moth's.
- **Machine code by way of Rust.** `moth-native build --exe` (exe.rs) writes the
  program as Rust and has rustc finish the job. It starts from the bytecode, not
  the program's text, so every name is already resolved and every instruction
  knows its place for a mistake. Each function's bytecode becomes a Rust
  function: the stack becomes local variables (its depth at each instruction is
  worked out first), each block of straight-line code a branch of a `match` in a
  loop, a jump a change of state, and a `try` a list of the blocks its `if it
  fails` starts. LLVM's DFA jump threading, which is off unless asked for, turns
  that loop back into jumps straight from block to block: twice as fast.
- **One set of checks.** Every instruction's work, with its checks and its
  messages, moved out of the machine's loop into functions the machine and the
  compiled code both call (`got`, `compare_values`, `add_to_value`, `said` and
  thirty more), so the two can't say different things. The machine got no slower.
- **Numbers as numbers.** What a stack place holds is worked out for each
  instruction: a number, yes or no, an iterator, or anything. A number lives in
  an `f64` and yes or no in a `bool`, made into a value only where one is
  needed. A variable is a number for good if no inner function sees it, every
  `set` gives it a number (an `add` to a number gives one or fails), and it isn't
  an input, unless it says it's a number, which every call checks. A million-round
  loop then takes 2.5 ms, faster than WebAssembly's 6.5. A `for each` keeps its
  own copy of the items and a place in them, as the machine's iterator does but
  with nothing shared to borrow at each step, and moves each item out instead
  of copying it: lists got twice as fast.
- **Checked as everything else is.** A test builds one program holding 700
  compiled programs, which answers `conform`'s jobs as the engine does, and holds
  each to the engine's output, drawings and mistakes, trail and all; Moth's own
  compiler, compiled to machine code, compiles itself to the same bytecode.
- **What's still slow.** A call checks its inputs and finds its function by name
  each time, and lists, records and dictionaries are the engine's own values
  behind reference counts and borrow checks: about twice the Rust engine's speed,
  but behind V8, which inlines, guesses types and keeps objects in shapes. A big
  program is slow to build: compiler.moth is 1.3 MB of Rust, and rustc takes
  minutes over it.

## 25. Machine code from Moth alone: machine.moth

- **Why.** Every engine so far stands on JavaScript or on Rust, and the machine
  code from §24 needs rustc. machine.moth is a compiler written in Moth that
  writes the machine code itself, so once it takes the parts of Moth its own
  code uses, it can compile itself and Moth needs neither.
- **The same front.** It starts with `use "compiler.moth" as front`: the same
  tokenizer, parser and scope rules, so a name means what it means in every
  other engine, and a mistake in the program is reported as `moth run` would.
- **Its own assembler.** An encoder for the x86-64 instructions it needs (one
  function for the ModRM byte, one for each instruction), labels, and 32-bit
  distances filled in once everything has its place. Code that only runs when
  something goes wrong goes into a separate `cold` list, placed after the rest,
  so the code that runs stays together.
- **Values.** Every value is 8 bytes: a number is itself, and nothing, no and
  yes are NaNs that arithmetic never makes. `a + b` is one `addsd`, then one
  check of whether the answer is NaN; only then does it look closer, and either
  stop with "can't use '+' on nothing and a number" or carry on with the NaN. A
  variable with no value yet holds another NaN, so reading one is one compare.
- **Frames and trails.** Main's variables live in the data, a function's in its
  frame. Every call puts its number just under where the new frame's rbp points,
  so a mistake walks the frames and turns each into "in 'f', called from line 3",
  a run of the same call into one line. r15 counts the calls in progress, which
  stop at 100,000 as every engine's do.
- **Showing numbers** as JavaScript does after rounding to 15 digits, which took
  four ways: a whole number below 2^53 as its digits; any other number from its
  first 16 digits, worked out exactly with a 128-bit fraction and rounded half
  up as `toPrecision` rounds; a whole number from 2^53 up with the fewest digits
  that read back as it (Steele and White's method, as Burger and Dybvig put it),
  with 1,280-bit whole numbers; and a number below 2^-1021, which has fewer
  digits than 15, as the shortest digits of the double nearest its 15 digits.
  That last one was found by testing against the engine: the first version gave
  4.94065645841247e-324 where Moth says 5e-324.
- **Comparing numbers** to 15 digits: two numbers far apart compare as they are;
  two close ones as 17-digit decimals, which is exact, since different 15-digit
  numbers are always different doubles; and two below 2^-1021 as their doubles.
- **The files.** For Windows a PE32+ file whose imports are six kernel32
  functions: `WriteFile`, or `WriteConsoleW` after `MultiByteToWideChar` for a
  console, so every character shows. For Linux an ELF file with two segments, a
  256 MB stack of its own, and the `write` and `exit_group` system calls. Output
  waits in a buffer, and goes out after every line at a terminal.
- **A trap.** A function in a file used `as front` that sets a name the program
  also sets at the top level changes the program's: compiler.moth's `resolve`
  has `set here to scope`, which replaced machine.moth's function `here`. It's
  named `mark` now.
- **Speed, and what's next.** Values wait on the stack and a comparison is a call
  into the runtime, so there's room left, but fib(30) takes 0.08 s from start to
  finish, against 0.21 s with `moth run` and 0.42 s with `moth-native run`, and
  30 million rounds of a loop 0.16 s against 0.33 s and 1.05 s. Next it needs
  text, lists and records, which need memory that grows.
- **Memory, text and lists.** A value that lives in memory is a pointer whose top
  16 bits say what it is, which makes it a NaN arithmetic never makes, so a sum
  of two numbers still costs no more than before. A text is its length in
  bytes and in characters, and where its UTF-8 bytes are, which have a block of
  their own, after how many of its bytes are used and how many it has room
  for: a text that ends where its block's used bytes end grows in place, so
  `add c to text` in a loop copies each character a few times at most, not the
  whole text each time. A character of a text is a text that shares its bytes.
  What `say` says, what `+` joins and a mistake's message are all put together
  in one builder that grows as it needs to. Text sorts by its UTF-16, as
  JavaScript's does, and stops at JavaScript's longest text with the engines'
  mistake.
- **Records and dictionaries.** A record keeps its fields in order, each named
  by one of the program's own texts, so finding a field compares pointers. A
  dictionary keeps its entries in the order keys came, with an index beside
  them to find one by its hash; a removed entry keeps its place, marked. A
  number key is the number to 15 digits, as the engines' are, which needs the
  double nearest a 15-digit decimal: one exact division when the power of ten
  is 10^22 or less, and big whole numbers below that. A misspelled field or key
  gets the engines' "Did you mean ...?", from the same edit distance over
  UTF-16.
- **`try`.** A `try` puts a record on the stack: the calls in progress, the
  frame, where its `if it fails` starts, and the try further out. A mistake
  checks for one before it writes anything: the message without its place, or
  what `fail with` gave, becomes the caught value, and the stack and frame go
  back to the try's. A `stop` or `return` inside one takes it off first.
- **The helpers, and bytes.** `number of` reads text as JavaScript's `Number()`
  reads Moth's numbers: up to 2^53 times or over a power of ten up to 10^22 is
  one exact step, and anything else is a first guess on the x87, at its 64-bit
  precision, then moved a step at a time with big whole numbers until it's the
  nearest double. Bytes read as text the way TextDecoder reads UTF-8, each
  broken part a U+FFFD.
- **Functions as values.** A function is a value like any other: where its
  code is, the variables it was made among, and a description of its inputs.
  A function that makes functions keeps its variables in memory, not in its
  frame, with a link to the variables further out, so the functions it makes
  can still use them after it returns; one that makes none keeps them in its
  frame as before. A function made once at the top level, whose name nothing
  else sets, is still called straight; any other call checks the value is a
  function, then its description checks the inputs, with the engines'
  mistakes. Every frame now holds the function's number as well as the call's,
  so a trail names the function that ran, not the name it was called by.
- **A garbage collector.** At first memory came from the system 64 MB at a time
  and was never given back, which was enough for programs that run and end,
  but machine.moth compiling itself took 9 GB and ran out. Now blocks come in
  38 sizes, from 16 bytes to 32 KB, a 64 KB page holding blocks of one size and
  anything bigger getting whole pages; a bitmap beside them, a bit for each 16
  bytes, says where a block that's been handed out starts. After 64 MB of new
  pages, or as much again as was live after the last collection, it marks
  everything it can reach from the stack, the registers, the program's
  variables and the runtime's own, looking through every word of every block
  that can hold values, and gives the rest back. It's conservative: any word
  that could be where a block is counts, a tagged value or a plain address, so
  the runtime's code needs no maps of where its pointers are, and nothing
  moves. Blocks that never hold values (a text's bytes, a dictionary's index)
  aren't looked through. machine.moth now compiles itself in machine code in
  1.9 s and 535 MB, into exactly the bytes it makes on Node.js.
- **The trap, a third time.** The first try at that ran out of memory even with
  the collector, which looked like the collector keeping what it shouldn't. It
  was the test: the program that used machine.moth had top-level variables
  called `total` and `k`, and since a file used `as` a name shares its
  functions' variables with the program's top level, machine.moth's own loops
  counted with them and never ended.
- **Long lines.** Each place a mistake can happen kept its own copy of its line,
  for the excerpt under the message, so the trained handwriting network, whose
  weights are lines of 8,000 numbers, each `-` a place, made hundreds of
  megabytes and broke the compiler. Now a line and its marker are kept once,
  and each place keeps only how many of the marker's bytes go before the `^`:
  4,000 negative numbers on a line went from 53 MB of program to 419 KB. The
  digit reader then runs as a program of its own, 3.5 times as fast as `moth
  run`, and training it 2.3 times.
- **Upper and lower case.** JavaScript's toUpperCase and toLowerCase know all of
  Unicode, and machine code has nothing of the kind, so tools/case-tables.mjs
  asks Node.js what each character past ASCII becomes and writes the answers
  into machine.moth as runs (a first character, a last, a step of 1 or 2 and
  what to add): 197 for upper case and 184 for lower, the 102 that become more
  than one character (ß becomes SS), and the ranges of cased and
  case-ignorable characters. ASCII changes on the spot, anything else is found
  by halving. A Σ in lower case is ς at the end of a word, when a cased
  character comes before it and none after, skipping case-ignorable ones, as
  ICU decides it. Tested on every character there is, both ways, against the
  JavaScript engine; only a program that changes case carries the tables. The
  Rust engine's tables are a Unicode version behind, so it differs on 56.
- **Files, questions and arguments.** `read`, `write`, `ask` and `arguments`
  do what they do in a program `moth-native build --exe` makes, which `moth
  run` matches. A file is read or written, or a site read, only once the
  program may: the `--allow` flags it was built with, kept in its data, say
  what it may do without asking; otherwise a person at a terminal is asked,
  once for each file or site (or for all of them, with `a`), and anywhere else
  the answer is no. A flag that names files or folders allows them and what's
  in them, once each is where it really is: on Windows from
  `GetFinalPathNameByHandleW`, on Linux from the link `/proc/self/fd/N` the
  system keeps for a file opened with `O_PATH`. On Windows a file's name
  becomes the path Rust's own library opens (`GetFullPathNameW`, then `\\?\`),
  so a name ending in `/` or `.` means the same as there. A file that can't be
  read or written says what moth-native says: Node's words for a folder, a
  missing file and one the program may not have, and the system's own for the
  rest (`FormatMessageW`, or glibc's words on Linux). Input comes a line at a
  time through a buffer that keeps what came after the line, for `ask` and
  for a question alike, and from a Windows console as UTF-16, through
  `ReadConsoleW`, as Rust reads it. Linux's arguments come from the stack the
  program starts on, Windows' from `GetCommandLineW`, split as Rust's
  `std::env::args` splits it. File bytes come from `rt_alloc_raw`, and the
  values the runtime keeps (the file's name, why it failed, and what a person
  answered) sit among the collector's roots. It couldn't go online at first,
  so a site the program might read said it couldn't be reached; §33 is how it
  goes online now.
- **moth.exe.** moth.moth is the command line, in Moth: `moth build file.moth`,
  with `--target` and the `--allow` flags. It reads the program, then every
  file a `use` line names, and the files those use, gives them all to
  machine.moth's `compile_allowing`, and writes what comes back; a mistake is
  shown as `moth run` shows it. Made into machine code with `--allow-read
  --allow-write`, it builds itself into the bytes Node.js made it, in 2.8 s,
  and so does what that builds; a Linux one and a Windows one build each other
  byte for byte. It finds which system it's on by whether it can read
  /proc/version. On Linux, bytes that start like a Linux program are written
  so they can run, as `moth build --exe` makes them.
- **The trap, a fourth time.** The first moth.exe stopped after reading
  machine.moth, sure compiler.moth wasn't there. Its top level counted through
  the arguments with `cli_k`, so every function's `cli_k` was that one, and
  the function that reads a file's `use` lines counted with it too, up to
  400,000. Everything moth.moth does is in functions now, and the test for
  such names covers moth.moth.
- **A trap, twice.** In Moth a `set` inside a function changes a top-level
  variable of the same name, and a file used `as` a name shares its functions'
  variables with the program's top level. A label called `here` in machine.moth
  was overwritten by compiler.moth's `resolve`, and a label called `bits_made`
  overwrote machine.moth's own marker, which showed only when one compiler made
  two programs. A test now checks that no function sets such a name.
- **Checked.** 400 random programs made from what it takes, 120 written for what's
  easy to get wrong, and every test program and 300 broken ones it can take, on
  the system the tests run on, against the JavaScript engine's output, mistakes,
  trails and exit codes; and programs that read, write, ask and take arguments,
  built with and without `--allow` flags, against `moth run` and `moth-native
  run`, each in a folder of its own, down to the files they leave there.

## 26. Standalone, and what was dropped

- **Why.** Once moth.exe built itself, the Rust engine and the Node.js command
  line were two more copies of Moth to keep in step, and neither was needed to
  make or run a program any more. Both went in one change; the JavaScript
  engine stayed, because the playground, its debugger, drawing, apps and the
  handwriting demo run on it.
- **What went.** `native/` (the Rust engine, its WebAssembly build and its
  machine code through `rustc`), `cli.js` (`moth run`, `test`, `fmt`, `check`,
  the shell, and builds to JavaScript and web pages), `disk.js` (its files and
  permissions) and their tests. They're all at v1.5.1 for anyone who wants them.
- **What the tests lean on now.** Machine code is held to the JavaScript
  engine, as before. The two tests that ran `moth build --exe` and `moth run` as
  processes now build moth.exe from the source, once, and have it build the
  programs; for the program that reads, writes, asks and takes arguments under
  six sets of `--allow` flags, what `moth run` did was written down first, on
  Windows from `moth run` itself and on Linux from its machine code, which CI
  had held to `moth run` there: the two were the same, so the test checks both
  systems against one record. Tidying and Moth's own tests, which CI ran with
  `moth fmt --check` and `moth test`, are in moth.test.js through `format()` and
  `test()`, for every Moth file here, tools/ and apps/ included.
- **The first moth.exe.** `node bootstrap.mjs` makes it from the source with
  the JavaScript engine, the same bytes moth.exe makes of itself; the release
  starter-1 has one for Windows and one for Linux.

## 27. The naming trap, fixed

- **The trap.** A `set` in a function changed a top-level variable of the same
  name, even one the top level only set further down the file, and a file used
  `as` a name shared its functions' variables with the program's top level. It
  bit four times (sections 22 and 25): machine.moth's `here`, overwritten by
  compiler.moth's `set here to scope`; a test driver whose `total` and `k` made
  machine.moth's loops count forever; and moth.moth's `cli_k`, which a function
  that reads files counted up to 400,000. Each time the fix was a new name, and
  a test that looked for clashes.
- **A function changes only what's made above it.** When a function sets a name,
  adds to it, loops over it or catches a mistake with it, the name means a
  variable outside the function only if that variable is made above the
  function's `to` line: by the top level earlier in the file, or by an enclosing
  function earlier in its code, or as one of its inputs. Otherwise the function
  gets a variable of its own. Names it only reads are found as before, wherever
  they're set, so a function at the top can still read a setting made at the
  bottom; calls are reads. A counter (`set total to 0`, then `to bump` with `add
  5 to total`) still counts, and so does a closure's `add 1 to count`.
- **A file used `as` a name keeps its own top level.** Every name in it becomes
  `math's x`, not only the ones its top level makes. A function's inputs, and the
  functions a function makes, stay as they are, since nothing outside the
  function can reach them. So the file's names work out as if it ran alone: a
  variable only its functions set is theirs, and a name it never makes isn't the
  program's, which reaches the file only through `math's ...`. The same file
  used as two names is still two copies, and `use` without `as` still puts a
  file in with the program, on purpose.
- **Still decided when the program is read.** "Above" is a matter of the text.
  Each function's code is walked once, in order, counting the functions it
  makes: a name is made above a function when fewer functions come before it
  than before the function. A function's own name counts from its `to` line,
  and a try's `with` name from its `if it fails`. The JavaScript side finds a
  function by its code; compiler.moth, which can't tell two equal lists apart,
  numbers each function as it parses it. Both give every variable the same slot,
  and the tests hold compiler.moth to the JIT, byte for byte, as before.
- **Two copies in machine code.** machine.moth found each top-level function by
  the line and column of its `to`, which two copies of one file share, so a file
  used as two names lost one copy's functions and the build stopped. It goes by
  the parser's number for each function now, and a test builds two copies.
- **What changed.** One test program said `1` and now stops: f sets `x`, the top
  level calls f, says `x`, and only then sets it. f's `x` is its own, so `say x`
  finds the top level's, which has no value yet. Of everything written in Moth
  here, only tools/picture.moth had functions (`whole` and `escape`) that set a
  name the top level makes below them, its loop's `n`; nothing relied on it, and
  the picture is the same. Of the 1,500 programs the tests generate, 255 now
  give a function a variable of its own where it used to change the top
  level's, as their functions come before most of the top level's code; the
  engines and compiler.moth agree on every one, and machine code on the 10 of
  its own 400 that changed. The self-compiling test's driver counts with `total`
  and `k` again, made before it uses machine.moth, and the test that looked for
  clashes between files now only looks inside machine.moth and moth.moth, where
  a function setting a top-level name would still be a mistake.
- **What it costs.** A variable of a function in a file used as `math` shows as
  `math's x` in a mistake, as the file's own top-level names already did. A hint
  in the checker for each function that changes a top-level variable was weighed
  and left out: snake.moth alone would get 16, for game state that's meant to
  change, and neural.moth and json.moth 8 each.

## 28. Drawing, apps and the pad in machine code: a window on Windows

- **The same picture as the playground's.** The turtle and its shapes run in
  machine code as Turtle in vm.js runs them, numbers to hundredths and mistakes
  word for word, so the list of things drawn is the same on every engine. At
  the end of a program that drew something, the window draws that list as the
  playground's canvas does: 500 by 500, (0, 0) in the middle and y going up,
  made smaller when a drawing reaches past 240 from the middle but never for an
  app, lines with round ends, text with its baseline on the point. GDI+ draws
  it, smoothed, because it ships with every Windows and needs no font or image
  code of Moth's own; text is Segoe UI, which is what the playground's
  system-ui is on Windows.
- **Colours as a canvas reads them.** The CSS names, all 148, are a table in
  the program, and `#rgb`, `#rgba`, `#rrggbb` and `#rrggbbaa` are read in the
  runtime. A colour a canvas wouldn't know keeps the one before, as the canvas
  does. `rgb(...)` and `hsl(...)` weren't read yet; §31 reads them.
- **Apps call their handlers from the window.** Windows calls the window's
  procedure with each key, click, drag and timer, and the procedure calls the
  handlers waiting for it, in the order the program set them up. A handler's
  call is the first in progress, so a mistake in it lists only the calls under
  it, as on the JavaScript engine. Keys get the playground's names: arrows,
  space, enter and the rest by key code, other keys as the character typed, in
  lower case, and none while Ctrl or Alt is down. Timers go off every so many
  milliseconds, 10 at the fastest, as the playground's do. A handler that
  says `stop the program` ends it there: the window goes, and the number
  is the one the program ends with. The end of a program comes back to the
  window's code once more when that happens, so it remembers it has already
  begun: without that, the first try opened a second window inside the first,
  and with `MOTH_EVENTS` it went through the events again, for ever.
- **The pad.** `ask` with a question that starts with "Draw", as the
  playground decides it, opens a 440 by 440 pad at a terminal. Each stroke
  comes back as the playground's pad gives it: points from 0 to 100, y going
  down, none closer than 1.5 to the one before, so handwriting.moth reads the
  same text from both. Enter answers, Escape wipes the pad, and closing it ends
  the program. Away from a terminal, the question is asked as any other is.
  Only a program that may ask for a drawing gets the pad: one whose questions
  are all texts that don't start with "Draw" doesn't.
- **Only a program that needs it pays.** The window's code, GDI+ and the
  colour table go into a Windows program that draws, sets up an app, or may
  ask for a drawing. Any other is the same bytes as before.
- **How it's tested.** With `MOTH_PICTURE=file.bmp`, the window isn't opened:
  the program draws into that file instead, after the events `MOTH_EVENTS`
  lists (`key left;click 10 20;drag 11 21;tick 0`). The tests check the colour
  of the picture at chosen points, and that an app given the same events says
  and fails exactly as the JavaScript engine's `app.send` makes it. The window
  itself was tried by sending it Windows' own mouse and key messages and
  reading back what it showed: the paint app, a timer, and handwriting.moth,
  which read a drawn 1 and a drawn 2.
- **Linux has no window yet.** A program there draws into the list and shows
  nothing, and an app sets up and ends.

## 29. The moth command, complete

- **What it was missing.** moth.exe could only `moth build`: a program's
  mistakes went to the normal output, it couldn't end with a code of its own,
  and running, tidying and checking a program had gone with the Node.js command
  line in 1.6. All four needed something Moth itself couldn't do, so the
  language grew first.
- **Two ways to end, in words Moth already has.** A new reserved word breaks
  every program that used it as a name, so both phrases are built from words
  Moth already keeps: `say "oops" to the error output` is `say` with a target,
  the way `write ... to` has one, and `stop the program with 2` is `stop`
  followed by words that could never have meant anything else (`stop` alone
  still only leaves a loop, and `the` and `program` are still names). The
  number is a whole number from 0 to 255, which is all Linux keeps of it, so a
  program ends the same way on both systems. Nothing catches it: a `stop the
  program` inside a `try` ends the program, as running out of steps does.
- **Starting a program.** `run program "git" with (list of "status")` gives
  back the number it ended with. `run program` reads like the two words it is,
  and `run` on its own is still a name, so only `run program` together starts
  one; it gives a value, so a line of its own that starts with it says to write
  `set code to run program ...` instead. `remove the file "old.txt"` is
  `remove`, which already removes a dictionary's keys, with `the file` after
  it. Every phrase works the same in all three JavaScript engines, in the
  compiler written in Moth (whose JavaScript and bytecode are still byte for
  byte what moth.js makes), and in machine code; in the playground and the
  tests the error output is shown the way a mistake is, an exit code just ends
  the run, and starting a program is a mistake that says only a program
  `moth build` makes can.
- **In machine code.** The error output goes out at once, after whatever the
  normal output has waiting, so the two stay in the order they were said.
  `stop the program` flushes and ends through one ending the runtime shares
  with a program that just finishes, so what was drawn still gets its window.
  A program is started with `CreateProcessW` and waited for with
  `WaitForSingleObject` and `GetExitCodeProcess` on Windows, where the command
  line is put together and quoted as Rust's `std::process` does it; on Linux
  with `fork`, `execve` and `wait4`, where a name with no `/` in it is looked
  for in each folder of PATH first, as `execvp` does, since a bare `execve`
  searches nothing. A signal that ends it gives 128 and the signal's number, as
  a shell does. The program it starts gets this program's own input and output,
  so what it says goes where this program's words go.
- **Asked for, like a file.** Starting a program is a fourth thing a program
  may do, beside reading a file, writing one and going online: `--allow-run`
  (Deno's name) lets it without asking, `--allow-all` covers it, and otherwise
  a person at a terminal is asked "moth: let this program run 'git'?" once for
  each program, or for all of them with `a`. Away from a terminal the answer is
  no, and the refusal is a mistake a `try` can catch. `--allow-run` names
  nothing: a program may start programs, or it may not. moth.exe itself is
  built with it, since `moth run` starts what it built.
- **`moth run`.** It builds the program into a file beside its source
  (`hello-run.exe`, or `hello-run` on Linux, with `./` in front when the source
  has no folder, so the system looks for it there and nowhere else), starts it
  with whatever was written after the file, waits, removes the file, and ends
  with the program's number. A number no system can end with (Windows gives a
  crash a huge one) becomes 1.
- **`moth tidy`.** `format()` in moth.js, in Moth. It needed two things from
  the parser, which only the parser knows: how deep in blocks each statement
  starts, and which pieces are written with no space after them (a negating
  minus, a call's bracket). compiler.moth's parser now writes both into the
  `reading` record when it's asked to, as moth.js's does, and machine.moth
  hands them to the command line. The rest is in moth.moth: one line's pieces
  as they were written, counted in the columns the parser counts, then the
  lines joined the one way Moth writes them. After tidying, the pieces are
  read again and must be the same pieces in the same order, as moth.js checks;
  a mistake in the code is a mistake, and the file is left alone.
- **`moth check`.** checker.js finds two kinds of problem: what the scope rules
  know (a name nothing ever sets, a line that can never run, a name set or made
  and never used), and what its types know, which it gets by trying an
  operation on sample values of the types it worked out — every one of Moth's
  operations, through the same code the VM runs. The first kind is the scope
  rules compiler.moth already has, so `moth check` does those, in the checker's
  words (the same `undefined_message`, with the same "Did you mean") and in the
  checker's order. The second kind would mean writing all of vm.js in Moth
  again; the playground's Problems pane has it. A call to a name nothing sets
  doesn't look at what it was given, as the checker doesn't, so the same
  "never used" warnings come out.
- **`expect` in machine code.** It was the last thing `moth build` turned away.
  It is the comparison the engines make, and when it doesn't hold, their
  message, which says what each side was: both values wait on the stack, so the
  message can show them after the comparison has used them, and the mistake
  points at the `expect`, as the engines' does. `expect done` on its own asks
  only whether the value counts as yes.
- **Keeping what a program says.** `run program ... keeping its output` gives a
  record of the number it ended with, what it said, and what it said went
  wrong, which is what a test runner needs. Each of the program's two outputs
  gets a pipe, and neither read waits: on Windows `PeekNamedPipe` says how much
  is there before `ReadFile` takes it, and on Linux the read ends are
  `O_NONBLOCK`, with a millisecond's sleep when nothing came. So a program that
  fills one pipe while this one reads the other is never stopped by a pipe
  nobody is emptying: 1.2 MB on one output and 600 KB on the other come back
  whole, the same bytes on both systems. What came goes into a block of its own
  for each output, which doubles as it fills, and both blocks are among the
  collector's roots, since nothing else holds them.
- **`moth test`.** The file is built once, with lines at its end that call the
  test whose name the program is started with, and then started once for each
  test: a run of its own, so one test can't spoil another, which is what
  moth.js's `test()` gives by running the file again for each test. What it
  says is kept, so a test that failed can show the mistake, the calls that led
  there and its own output under it, indented, exactly as the Node.js command
  line showed them. The call the runner adds comes after the file's own lines,
  so the one trail line pointing past them is dropped, as `test()` drops it. A
  file with no `test_` functions is one test itself, named after the file.
- **Checked.** Every command runs as a process against what moth.js does:
  `moth tidy` on every Moth file here and on programs broken on purpose, each
  tidied to exactly the bytes `format()` makes and tidy again the second time;
  `moth check` against `check()` with its type warnings taken away, word for
  word and in order; `moth run` passing arguments, input, output and the number
  a program ended with through, and leaving nothing behind; `moth test` against
  `test()`, tick for tick and line for line, with tools/json.test.moth passing
  under moth.exe; and a program that starts another, with and without
  `--allow-run`. The phrases themselves are held to the three JavaScript
  engines, the compiler written in Moth, and machine code, on Windows and on
  Linux.
- **What's left.** `moth test` needs its files named: machine code can't look
  through a folder yet, so it doesn't find every `.test.moth` file itself.
  `moth check` leaves out the checker's type warnings. And `moth build` still
  turns away units, tables, `random number` and `draw chart of` (random numbers
  came next, §30, and the rest after them, §31, with `moth test` finding its
  files).

### Asking which Moth this is

- **Why.** A bug report or an install check needs the release version of the
  program actually running. `moth --version` and `moth version` each say one
  line, `moth MAJOR.MINOR.PATCH`, on standard output and end with 0.
- **One source, carried along.** `package.json` already has the release
  version. bootstrap.mjs includes that file in the executable, and cli_main
  reads it only for a version command. Built-in files are read before disk
  files, so an installed moth needs no manifest beside it, and another
  project's package.json cannot change its answer. Building moth with itself
  includes package.json too, just as it includes moth-debugger.moth.
- **Arguments.** Only a version command on its own takes this path. Extra
  arguments use the usual wrong-usage message and exit code 2. The existing
  `moth build --version` flag still sets the built program's version.
- **Tested.** machine.test.js runs both commands from a renamed copy in a
  folder without the source or manifest, then with a different manifest and
  invalid JSON. It checks exact output, empty standard error and exit code 0,
  rejects extra arguments, and checks that moth built by itself has the same
  bytes and reports the release version away from the source folder.

## 30. Random numbers in machine code

- **The same numbers as the engines.** `random number from 1 to 6` in machine
  code picks as `randomWhole` in vm.js does: both ends made whole to 15 digits
  first, the same mistakes in the same words, and the number is
  `low + floor(r * (high - low + 1))`. `r` comes from the same small generator
  the engines use when they aren't given real randomness (mulberry32), worked
  out in 32-bit steps, so a seed gives exactly the same numbers everywhere.
- **Where they start.** If `MOTH_SEED` is set to a whole number, they start
  there, which is how the tests compare machine code with the JavaScript
  engine: both start from 1. Otherwise they start from the processor's cycle
  count, so each run of a game is different. That's random enough for games
  and dice, not for secrets.
- **Only a program that uses it pays.** The generator, and on Windows the
  import it needs to read `MOTH_SEED`, go only into programs with a
  `random number`. With it, apps/snake.moth builds into a program of its own
  and plays in the window.

## 31. The rest of Moth in machine code

- **What was left.** `moth build` turned away amounts with units, tables and
  `draw chart of`; the window didn't read `rgb(...)` or `hsl(...)`; and
  `moth test` needed its files named, because a program in machine code
  couldn't look in a folder. Now machine code takes every phrase Moth had
  before `the time`, `wait`, `in order`, `save` and `load` came, and each of
  these says, fails and ends exactly as the JavaScript engine does.
- **An amount is a value of its own.** `5 km` is 16 bytes, the number and which
  of vm.js's units it is, and its kind is a seventh one beside text, lists and
  the rest, so the collector keeps it and `say`, `is`, the comparisons, `+`,
  `-`, `*`, `/`, `add ... to`, `number of` and `in` all know it. A unit's
  factor is the same double the engines use, and a conversion multiplies and
  then divides, as theirs does, so `1 mile in km` is the same number, digit for
  digit. An amount the program writes is kept with the program's own texts and
  numbers, so `5 km` costs nothing when it runs.
- **Only a program with amounts pays.** The arithmetic is quick because a sum
  of two numbers is one instruction, and only a result that isn't a number
  goes the slow way. The slow way has to look for amounts, but code is written
  before the compiler has seen every line, so it can't know yet whether the
  program has any. So it writes the program once, and if it found an amount,
  writes it again, knowing. A program with none is the same bytes as before,
  and so is everything else that doesn't use what's new: tables, charts and
  folders each bring their code only into the programs that use them.
- **Tables.** `read table` parses the CSV text as vm.js's `tableOf` does, cell
  by cell: quotes, `""` for a quote, line breaks in quotes, blank lines, `\r\n`,
  and the header made into field names the same way, `column_` and `_2` and
  all. One thing was harder in machine code: a record finds a field by its
  name's text being the very same text, not text with the same letters, which
  is what makes `price of row` one comparison. A table's names come from a
  file, so each is looked up among the program's own texts first, and if the
  program never wrote it, it is made once and kept, so two tables read from
  the same file have the same fields, and `is` says they're the same.
  `total of`, `average of`, `largest of`, `smallest of` and `price in sales`
  work on any list, amounts and text included, as the engines' do.
- **Charts.** `draw chart of` draws what vm.js's Turtle draws for it: a bar and
  its value for each number or amount, a label for each, the longest bar 200
  long. It was checked by drawing the same things one by one, with
  `draw box` and `draw ... at`, and comparing the two pictures byte for byte.
- **Colours.** The window reads `rgb()`, `rgba()`, `hsl()` and `hsla()` as a
  browser's canvas does: the old way with commas, the new way with spaces,
  `none` and an alpha after a slash, percentages, exponents and the angle
  units, each part held to its range and rounded, and `hsl` worked out as
  Chrome works it out. White space either side of any colour is let go, as CSS
  lets it go.
- **Looking in a folder, in words Moth already has.** `read the folder "tests"`
  gives the names of what's in a folder, in Moth's order for text, a folder's
  name with `/` after it, so `folder + name` is the path either way, and a
  program can tell what to go into. It is `read`, followed by words that could
  never have meant anything else after it, as `remove the file` is: `the` and
  `folder` are still names. It works in every engine, through whatever holds
  the files (in memory, the files' names are the folders), in the compiler
  written in Moth, the checker and the moth command's checking, and in machine
  code with `FindFirstFileW` on Windows and `getdents64` on Linux, the names
  sorted by a merge sort. It is reading, so it needs `--allow-read` or a yes,
  as reading a file does.
- **`moth test` on its own.** It finds the tests as the Node.js command line
  did: every file ending in `.test.moth` here and in the folders inside, but
  not hidden ones or `node_modules`, each folder's in turn, sorted as
  JavaScript's `localeCompare` sorts them (case after the letters themselves,
  marks before digits before letters), with `\` between folders on Windows.
  A failing test's mistake names its file's path, as that command line did.
- **Checked.** Every new phrase and helper is in the programs machine.test.js
  holds to the JavaScript engine, mistakes included, on Windows and on Linux;
  tables and folders are read from real files in a folder of their own;
  colours and charts are checked pixel by pixel in pictures drawn through
  `MOTH_PICTURE`; and `moth test` with no files is held to the old command
  line's own way of finding them.

## 32. Faster machine code

- **Where the time went.** Before, every variable lived in memory, every value
  went through the value stack, and every `+` checked both sides were numbers.
  On the counting loop that made Moth 8 times as slow as C.
- **What the compiler knows.** As machine.moth writes a function's code, it
  keeps what each variable is sure to hold: a whole number, a number, or at
  least a value. It works this out in the order the code runs: a branch keeps
  what both sides agree on, a loop or a `try` only what stays true all through
  it, and a call forgets main's variables. A check that can't fail is left out:
  a variable sure to have a value, a sum of two numbers, a number negated.
- **Loops in registers.** A loop that calls no function and has no `try` keeps
  the variables it uses most in xmm8 to xmm15 as well as in memory, and its
  count and limit in registers alone. Two numbers compare right there, as the
  runtime would (it still settles two so close that 15 digits can't tell them
  apart), and `is divisible by` on two whole numbers is one division.
- **Whole numbers as whole numbers.** A loop whose body only works out whole
  numbers (`set`, `add`, `if` and `stop`, with `+`, `-`, `*`, comparisons and
  `is divisible by`) also runs as 64-bit whole numbers in rsi, rdi and r8 to
  r11, scaled by 1024 so that a sum past 2^53 sets the processor's overflow
  flag. Every variable must be a whole number from -2^53 to 2^53 on the way in;
  a sum that goes past, or dividing by 0, puts the registers back in their
  variables and carries on in the loop's ordinary code from the start of that
  statement, so the answer and any mistake are what they always were.
- **Calls.** `return` goes straight back, and a function whose frame holds
  nothing needs no room made for it.
- **What it gave.** About as fast as C on the counting loop, primes and decimal
  maths, and 1.4 times as slow on function calls (see the README). The tests
  hold it to the JavaScript engine on programs written to break it: a variable
  that is a number and then isn't, sums past 2^53, dividing by 0 inside a fast
  loop, more variables than registers, close numbers, infinities, NaN and -0.

## 33. Going online in machine code

- **What was missing.** A program built with `--allow-net` got past the
  question, then said it couldn't reach the site: machine.moth had no way to
  connect. Now `read "https://..."` and `read bytes` fetch the page, on Windows
  and on Linux, over http and https.
- **The same as before.** Both old command lines went online: disk.js fetched
  the page in a second Node, and the Rust engine ran `curl`. Where they
  differ, machine code does what the Rust engine did, since `moth run` is
  machine code now and keeps moth-native's words:
  - the page as the site sent it. Its text is read as a file's is, as UTF-8
    with U+FFFD for what isn't; its bytes as they came.
  - no move made by itself. An answer from 300 to 399 that says where to go is
    a new address, asked about again as any site is, by its `--allow-net`
    names or a person at a terminal. Ten moves at most, then "it moved too
    many times". A move to something that isn't http or https: "it moved to
    'ftp://...', which isn't a site". A move the program may not make: "it
    moved to '...', and this program isn't allowed to go online (start it with
    --allow-net)". The mistake names the address the program read.
  - any other answer from 300 up is a mistake: "can't read
    'https://example.com/nothing': the site answered 404". So is a 3xx that
    says nowhere to go.
  - 60 seconds for a site, in all, as `--max-time 60` gave curl. disk.js left
    it to Node's fetch, which waits minutes.
  - `--allow-net=example.com` allows that host exactly, with any port or only
    the one named, as the Rust engine had it. disk.js allowed any host with the
    name inside it, `example.com.evil.net` too. machine.moth already did this.
  - what went wrong: "couldn't reach it (...)", with curl's words inside. The
    Rust engine passed on whatever curl printed, which changes with curl's
    version and holds times ("after 3 ms"), and for a bad certificate ran to
    five lines. Now each kind of failure has one fixed phrase in curl's words,
    the same on both systems: "Could not resolve host: nosuch.invalid",
    "Failed to connect to 127.0.0.1 port 1: Couldn't connect to server",
    "Operation timed out after 60000 milliseconds", "SSL connect error",
    "Failure when receiving data from the peer", and "URL using bad/illegal
    format or missing URL". Anything else is curl's own first line on Linux,
    without its "curl: (N) ", and "WinHTTP error N" on Windows.
- **Windows: WinHTTP.** It comes with Windows, does https with the system's
  certificates and proxy, and is a DLL like any other, imported through
  `more_imports` as the window's DLLs are. The request makes no move by itself;
  the program reads the answer's number and its Location, then the page, into
  memory that doubles as it fills. Before each step the request gets what's
  left of its 60 seconds. The address goes out as curl sends it: in the path a
  byte above 127 becomes `%xx`, the query goes as it is, and nothing else is
  changed. A Location that isn't a whole address is made one from the address
  it came from (`//host...`, `/path`, `?query`, or a name in the same folder),
  as curl makes `%{redirect_url}`.
- **Linux: curl.** A program machine.moth makes is static: it calls no
  library, so there is no TLS library to call, and TLS written by hand is not
  worth the risk. So it starts the system's `curl` the way `run program`
  starts a program: found in PATH, then `fork` and `execve`, its arguments
  given straight to it with no shell between, the page and curl's mistakes
  read through two pipes as `keeping its output` reads them. curl gets `-q`, so
  a `.curlrc` can't make it follow moves itself, past the questions; `-sS`;
  `-g`, so `[` and `{` in an address are only characters; `-A moth`;
  `--max-time 60`; `--proto =http,https`; and `-w`, which writes the answer's
  number and where it moves to after the page. Its exit code says what went
  wrong. With no curl: "couldn't reach it (on Linux a Moth program goes online
  through curl, and there is no program called 'curl')".
- **One address, read one way.** A `\` before any `?` or `#` is a `/`, as a
  browser reads it, so the host the `--allow-net` names were checked against is
  the host gone to. curl alone reads `http://example.com\@evil.com/` as a visit
  to evil.com. An address with a space or a control character in it isn't one.
  Both systems split the address the same way, for their words.
- **Only a program that reads.** Any name a program reads might be a site's
  address, so a program with `read` or `read bytes` in it has all of this, and
  on Windows imports WINHTTP.dll. A program that never reads has none of it,
  and is the same bytes as before. moth.exe reads files, so it has it too.
- **Checked.** A test starts a server of its own on 127.0.0.1, over plain
  http, so nothing needs the internet: text with a broken UTF-8 byte in it,
  bytes, moves (to a path, to a name in the same folder, to another host, in a
  loop, to ftp:), a 3xx that says nowhere, 404, 500, an empty 204, a 3.2 MB
  page, a port nobody listens on, and two addresses that can't be, with seven
  sets of `--allow` flags, and through `moth run`. Another test checks that a
  program that never reads is the same bytes, and imports no WinHTTP. The same
  program built for Linux said the same, against the same answers, in WSL. By
  hand, on both systems: https://example.com, a 404, http://github.com moving
  to https, a host that doesn't exist, expired and self-signed certificates,
  Wikipedia and a Gutenberg book (about 700 KB each), an image's bytes, a site
  that never answers, an IPv6 address, and Linux with no curl.
- **What's left.** On Windows a site that stops answering can take a few
  seconds more than its 60 (64 in a test), since WinHTTP's own timer runs
  late; curl stops at 60. A name and password in an address (`user:pw@host`)
  go with curl, not with WinHTTP. A move with `../` in it is followed as it is
  on Windows, while curl works the `..` out first. A program can only fetch a
  page, with no headers of its own.

## 34. The time, waiting, putting things in order, saving and loading

- **Words that were names stay names.** `the time`, `wait 2 seconds`,
  `scores in order`, `save x to "f"` and `load "f"` are each a phrase only in
  the one shape they have: `the` followed by `time`, `date`, `year`, `month`,
  `day`, `hour`, `minute`, `second`, `weekday` or `clock`; `wait` followed by an
  amount of time; `in order` after a value; `save` with a `to` after its
  value; `load` followed by a file's name. Anywhere else each word is a name as
  it was, and a line that only looks like a phrase (`wait 5`, `save 5`) is a
  call again. With no function of that name, its mistake says what the phrase
  needs (`to wait, say how long: 'wait 2 seconds'`), instead of guessing at a
  Moth word that's spelled alike.
- **The clock comes from outside, like random numbers.** A run is given a
  clock: what time it is where the program runs, the milliseconds since it
  started, and a way to wait. Unless it's given a real one, a run gets one that
  starts at Friday 2 January 2026, 03:04:05.678, whose waits take no time but
  move it on, so every engine and every test says the same times. The
  playground gives the real one, and shows what was said and drawn before each
  wait; run() keeps what the clock said, so a run handed over to the VM gets
  the same times and doesn't wait again. In machine code, MOTH_NOW (milliseconds
  since 1970, as the local time) does what the made-up clock does, and is how
  the tests hold machine code to the engines.
- **The time where it runs.** The JavaScript engines take the local time from
  the browser or Node.js. On Windows, machine code asks the system for the time
  and turns it into local time with FileTimeToLocalFileTime. On Linux a program
  has no library to ask, so it reads /etc/localtime (a TZif file) once when it
  starts, and takes the offset in force then; checked against `date` in six
  zones, summer time and quarter-hour zones included. The date comes from the
  days since 1970 with Howard Hinnant's civil_from_days, in whole numbers.
- **In order is a new list.** Sorting the list in place would make `say scores
  in order` change `scores`, which a beginner wouldn't expect. Numbers go by
  size, as `is less than` compares them (equal to 15 digits is equal), and text
  by each character's number in turn: the same on every engine and in machine
  code, where it's the order of the text's bytes, and the same whatever the
  computer's language is, unlike `localeCompare`. Equal ones keep their order,
  which machine code gets with a merge sort; `in reverse order` keeps it too.
  A list that mixes numbers and text is a mistake, not a guess.
- **Saving writes a value as Moth shows it.** `save` writes what `say` would
  show for the value inside a list (text in quotes, records as `(record with
  ...)`), and `load` reads exactly that back, with spaces and new lines allowed
  between parts. So a saved file is readable, the format needs no explaining,
  and `save` is `write` of that text: the same permissions and the same
  mistakes when the file can't be written. Functions, bytes, amounts with units
  and a list that holds itself can't be saved, and say so. A record read back
  uses the program's own text for each field's name, since machine code finds a
  field by which text its name is, so `name of person` works on a record that
  `load` made.

## 35. Sound

- **Three phrases, no new reserved words.** `play note "C4" for 0.5 seconds`,
  `play note 440 for 200 milliseconds` and `play a beep`. `play` starts a
  phrase only when `note`, or `a beep`, follows it on the same line, so `play`,
  `note`, `a` and `beep` stay names. `play beep` or `beep` alone, with no
  function of that name, says how a sound is made, instead of guessing at a
  name that's spelled alike.
- **A note is a name or a pitch.** A to G in either case, maybe `#` or `b`,
  maybe an octave from 0 to 9 (4 if none, so `"C"` is middle C), or `"rest"`
  for silence; a number is a pitch in hertz, from 20 to 20,000. The twelve
  notes from middle C up are written out in hertz rather than worked out with a
  power of 2, so every engine and machine code have exactly the same numbers;
  another octave is those doubled or halved, which is exact. A sound lasts
  from 0 to 60 seconds, given as `wait` and `every` take a time.
- **Sounds take turns, and the program goes on.** Each sound starts when the
  one before it ends, and `play` returns at once, as `draw` does: a tune is
  `play` after `play`, and `wait` is how a program waits for one to finish. So
  a sound in an app's handler never holds up its picture.
- **Sounds come out of a run, as drawings do.** An engine hands each sound, as
  { hertz, seconds }, to whatever runs the program, in order, and never touches
  a speaker itself. run() counts them, so a run handed over to the VM plays
  nothing twice.
- **One wave, worked out the same everywhere.** A sound's samples, 44,100 a
  second and 16 bits each, are worked out by soundSamples with only + − × ÷ and
  floor: close to a sine wave (two parabolas, refined), a quarter as loud as
  it could be, and fading in and out over 10 ms so it starts and stops without
  a click. JavaScript's Math.sin isn't the same to the last bit everywhere, and
  machine code would need one of its own; this way machine code works out the
  same numbers by the same steps, so a test can compare its sounds byte for
  byte, and the playground and a built program sound alike.
- **In the playground** the browser's Web Audio plays them, each made into
  samples only shortly before its turn, so a long tune doesn't fill the page.
  Stop and Run silence them.
- **In machine code** a Windows program at a terminal plays them through
  winmm.dll's waveOut, and waits for them before it ends, unless it showed its
  window, whose closing ends them too. Only a program that makes a sound
  imports winmm.dll. Away from a terminal it's silent, as it opens no window
  there, and Linux has no sound a program of its own can count on, so there it
  makes none. MOTH_SOUND=file.wav writes every sound into that WAV file
  instead, with its sizes put right after each sound, so the file is whole
  even when the program stops with a mistake.
- **Tested.** Every way of writing a note, and every mistake, the same on all
  three engines, in the checker and in the compiler written in Moth; a hand-over
  to the VM; and 19 programs whose sounds machine code writes with MOTH_SOUND,
  byte for byte the WAV of the sounds the JavaScript engine played, up to the
  same mistakes, on Windows and on Linux, with each note's pitch measured where
  its samples cross zero, and an app's handlers making theirs as its events
  come.

## 36. Buttons and text boxes

- **Six phrases, no new reserved words.** `draw button "Start" at 0, 0` and
  `when the button "Start" is clicked` are the owner's own. A text box follows
  them: `draw text box "Name" at 0, 50`, `when enter is pressed in the text box
  "Name" with words`, `the text in the text box "Name"`, and `clear the text box
  "Name"`, which empties it. Every one starts with a word Moth already keeps
  (`draw`, `when`, `clear`) or is a run of words that meant nothing before:
  `draw button "Start"` was a mistake (a value can't follow `button`), and so
  were `draw text box`, `clear the` and `the text in the text box`. So `button`,
  `text`, `box`, `the` and `enter` are still names, and `draw button at 0, 0`
  still draws what a variable called `button` holds.
- **A button or a box is its label.** The label is shown as `say` shows it, and
  two with the same label are one: a click on either runs the same handlers,
  and two boxes called "Name" hold the same text. A handler's label is worked
  out once, when the program sets it up, as `every`'s time is.
- **Sizes come from the label, not the font.** A button is 30 high and 20 wide
  plus 10 for each letter of its label; a text box is 200 by 30. A click has to
  land in the same place on every engine and in machine code, and the
  playground's font and Windows' measure text a little differently, so neither
  is asked. `at x, y` is the bottom left corner, as for `draw box`.
- **Clicks.** A click inside a button runs that button's handlers and nothing
  else: `when the mouse is clicked` doesn't get it, so a paint program's
  "Clear" button doesn't also paint a dot. A click inside a text box gives it
  the focus, and doesn't reach `when the mouse is clicked` either. Where they
  overlap, the one drawn last wins, as it's the one on top. A click anywhere
  else takes the focus away and goes to `when the mouse is clicked`, as before.
  A click on a button leaves the focus where it was, so you can type, click
  "Add", and go on typing. Drags are as before.
- **Typing.** While a box has the focus, every key goes to it, and none to
  `when a key is pressed`. Backspace takes off the last letter, Enter runs the
  box's `when enter is pressed` handlers with its text, and other keys do
  nothing more. The letters themselves come from a new kind of event, `type`,
  which hosts send for each character typed, as it was typed (`A`, not `a`),
  after the key's own event: `app.send("type", ["A"])` in JavaScript, WM_CHAR
  in the window, `type hello` in MOTH_EVENTS. A box holds up to 40 letters;
  more are dropped, and so are control characters. The cursor is always at the
  end: there are no arrow keys inside a box, which keeps it to one rule.
- **The text outlives the picture.** Apps draw their picture again after each
  event, starting with `clear`. If `clear` emptied the boxes, nothing typed
  would survive the next key, so a box's text is kept by its label, and a box
  drawn again shows it again. The focus goes when its box isn't on the picture
  any more. `clear the text box "Name"` empties one on purpose.
- **Where the rules live.** One place for the JavaScript engines: the Turtle in
  vm.js, which already sees everything drawn, keeps the buttons and boxes since
  the last `clear`, the texts and the focus, and `route()` decides where each
  event goes; moth.js's `app.send` asks it first. machine.moth does the same
  in its runtime. A JavaScript run handed over to the VM in the middle of an
  app replays the events, not only the handlers they ran, so the VM's turtle
  gets the same texts.
- **What's drawn.** A button is a box in the pen's colour with its label in
  white, in the middle. A text box is white with a border in the pen's colour,
  its text in black, its label in grey while it's empty, and a cursor while it
  has the focus; a text too long to fit shows its end. Typing changes a box
  without the program drawing anything, so the turtle tells the host with an
  item of its own in the list of things drawn: `{ textbox: "Name", text,
  focused }`. The playground draws each box with the last of those for its
  label; machine code draws from the texts themselves.
- **Linux.** There's no window, so buttons and text boxes are only drawn
  things, nothing types into a box, and handlers don't run, as for any app.

## 37. Pictures from files

- **The phrase.** `draw picture "cat.png" at x, y` draws a PNG or BMP with its
  bottom left corner at x, y, as `draw box` puts a box, and `size w by h`
  stretches it. It can draw bytes the program already has, too:
  `draw picture read bytes "cat.png" at 0, 0`. `picture` is still a name:
  `draw picture at 0, 0` draws the text a variable called `picture` holds.
  A picture is drawn with its pixels sharp, however big, which suits sprites.
- **One decoder of Moth's own.** pictures.js reads PNGs (zlib, every filter,
  every colour type and bit depth, palettes, transparency and interlacing) and
  BMPs (1 to 32 bits, with masks), so the playground, every engine and the tests
  get the same pixels whatever the browser is. machine.moth has the same decoder
  in machine code, written step for step as the JavaScript one, so a broken file
  stops at the same mistake in the same words: "'x.png' is a broken PNG: a
  chunk's checksum is wrong". Windows' GDI+ could have read the files, but then
  Linux, the tests and the playground would each read them their own way.
- **Reading is reading.** A picture is read as `read bytes` reads a file, with
  the same `--allow-read` rules, questions and refusals.
- **In the window.** A picture is drawn with its see-through pixels blended over
  what's under it, and made smaller with the rest of a drawing that doesn't fit.
- **The playground's files.** Files picks pictures (or any file) for a program
  to read by name, and they can be dropped on the playground too; a picture gets
  a button that puts a line drawing it in the code. They stay on the page.
- **Tested.** Small PNGs and BMPs are made in the tests, in every colour type,
  depth and kind of BMP, with the pixels each must come out as worked out apart
  from the decoder: every engine draws exactly those, machine code draws them
  pixel for pixel (blended where they can be seen through), and 350 broken
  files stop at the same mistake everywhere, on Windows and on Linux.

## 38. A security check, and what it changed

- **What was checked.** The playground, for any way a program or a shared link
  could reach the page; the JIT, for any way text in a program could become
  JavaScript; the `--allow` flags, against look-alike folder names, `..`,
  junctions and symlinks, for reading and for writing; going online on Linux;
  how programs and DLLs are found on Windows; how built programs are laid out
  in memory; and 3,000 broken pictures and saved files, on Windows and Linux,
  looking for a crash. The page escapes all it shows, the JIT writes every text
  as a JSON string, the flags held, refused writes left files as they were, and
  nothing crashed.
- **DLLs only from System32.** Windows looks for a program's DLLs beside the
  program first, and winhttp.dll, winmm.dll and gdiplus.dll aren't among the
  ones it always takes from its own folder. So a file called winhttp.dll in
  Downloads, beside moth.exe, would have run inside it. A program now carries a
  load configuration whose DependentLoadFlags say LOAD_LIBRARY_SEARCH_SYSTEM32,
  so its DLLs come only from System32 (Windows 10 1607 and later).
- **Programs from the system's folders and PATH.** `run program "git"` let
  CreateProcessW look, and it looks beside the running program first, so a
  git.exe put there would run. Now a name with no folder in it is looked for
  with SearchPathW in System32, then Windows' folder, then PATH with its empty
  entries left out (SearchPathW takes an empty one as the current folder), and
  CreateProcessW is given what it found. A name with a folder is followed as it
  is.
- **Batch files.** Windows runs a .bat or .cmd file in cmd.exe, which reads `&`,
  `|`, `%` and the rest in its arguments as commands whatever the quoting: an
  argument of `x" & echo INJECTED` ran `echo INJECTED`. Rust had the same hole
  (CVE-2024-24576). Moth now refuses an argument to a batch file that holds any
  of `" % ^ & | < > !` or a line break, rather than trying to quote for cmd.exe,
  which has no quoting that holds for all of them; and since cmd.exe looks for
  the batch file again by its name, starting in the folder the program runs
  in, one that was found on PATH is named by its whole path.
- **Not changed.** Programs still load at a fixed address (no ASLR): they never
  run their data or write their code, and Moth checks every index and every
  kind, so it would only matter with a bug in the runtime. A shared playground
  link still runs its code as it opens, in the page's worker, which can't reach
  the page.
- **A bug found on the way.** The fuzzing found that machine code couldn't
  `load` a number with an exponent, like `1e-7`, which `save` writes for very
  small and very large numbers. `load` now writes such a number out in full
  (`0.0000001`) and reads that, which is exact; past 10^310 it's Infinity and
  below 10^-330 zero, so a huge exponent costs nothing.

## 39. Sending, and JSON

- **The phrases.** `set reply to send data to "https://..."` POSTs data to a site
  and gives back the reply as text; `with headers h` adds headers, a dictionary
  of text, to a `send` or a `read`. `x as json` writes a value as JSON, and
  `json from text` reads JSON back. `send`, `json` and `from` stay names, as
  `wait` and `save` do: `send` is the phrase only with a value and `to` after it
  on its line, and `json` only with `from` after it. A `send` alone on a line is
  a mistake that says where it goes, as `run program` is: what it gives back is
  the point of it.
- **What is sent.** Text goes as it is (text/plain), anything else as JSON
  (application/json), unless a Content-Type header says otherwise. JSON is what
  sites and the programs behind them take, so it needed no choosing; writing it
  is `save`'s own walk over a value, with JSON's brackets, and `save`'s checks:
  functions, bytes, amounts with units, a list that holds itself, and Infinity
  and NaN, which JSON has no way to write, are mistakes that say so. Numbers go
  to 15 digits, as Moth shows them.
- **What comes back.** `json from` reads with `load`'s own reader, set to JSON:
  `{...}`, `true`, `false`, `null` and JSON's exponents, `1e5` and `1E5`
  included. An object becomes a dictionary, not a record: its keys are text that
  needn't be a name (`"first-name"`, `"1"`), and a field is found by its name in
  lower case. Half a pair of surrogates becomes U+FFFD, as machine code's text
  can only hold.
- **Headers are checked before anything goes.** A name is HTTP's token
  characters, and a value can't hold a line break, which would start a header
  of its own: a header can't be used to slip another into a request.
- **Nothing goes on by itself.** A `send`, and a `read` with headers, don't
  follow a move to another address: an answer from 300 up is a mistake. So data,
  and a header like Authorization, only ever go to the address the program names.
- **The engines.** A builtin that goes online gets the program's disk, whose
  `send(address, data, headers)` does it: the playground's with
  XMLHttpRequest, the tests' memoryDisk by keeping what was sent. A run handed
  over to the VM part way gets the replies it had, and sends nothing twice.
- **Machine code.** WinHTTP sends on Windows, with the headers as one block and
  the data as the request's body. On Linux curl does, with `-H` for each header
  and `--data-binary @-`, the data written into its input, which it reads to the
  end before it goes online, so a large one can't leave both waiting; and with
  SIGPIPE ignored, so a curl that stops early can't end the program.
- **A bug the tests found on the way.** After a hand-over to the VM, each call
  outside (a read, an answer, a random number, now a send) made fresh is kept
  too, but the count of what had been got again didn't move past it, so the next
  call got the one before's answer: two random numbers in a row came out the
  same. The count now moves past each one.
- **Tested.** JSON's every corner on all three engines and in machine code, on
  Windows and Linux, against vm.js; sending through the disk on every engine,
  and through a hand-over; and machine code against a site of the test's own,
  which says back what it was sent: JSON and text, the headers, a reply's bytes,
  a move and a failing site as mistakes, a megabyte sent and 20,000 records sent
  as JSON and read back, and every mistake in what's asked.

## 40. Checkboxes, text areas and lists

- **The phrases.** `draw checkbox "Dark" at x, y`, `tick the checkbox "Dark"`
  and `untick` it, `the checkbox "Dark" is ticked` (or `is not ticked`) and
  `when the checkbox "Dark" is clicked`; `draw text area "Notes" at x, y size w
  by h`, read and emptied as a text box is, with `the text in the text area` and
  `clear the text area`; `draw list "Fruits" showing fruits at x, y size w by
  h`, `the choice in the list "Fruits"` and `when an item is chosen in the list
  "Fruits" with fruit`. As with buttons, each is a run of words that meant
  nothing before, so `checkbox`, `tick`, `area`, `showing` and `choice` are
  still names: `set tick to 3` still works.
- **Sizes.** A checkbox is a box 20 by 20 with its label after it, and for
  clicks it's 28 wide and 10 more for each letter, as a button's size comes from
  its label. A text area is 300 by 120 and a list 200 by 144, six rows, unless
  they're given a size, which must be above 0.
- **Checkboxes.** A click ticks or unticks one, then runs its handlers, which
  see it as it is now; the focus stays where it was, as for a button. Ticks are
  kept by label through `clear`, as what's typed is, so an app that draws its
  picture again shows the same ticks, and `tick` works before it's drawn.
- **Text areas.** A text box with lines: Enter starts a new line instead of
  running handlers, it holds up to 2,000 letters, and it shows as many of its
  last lines as fit, a line every 20, so what's being typed is always in view.
  Long lines aren't wrapped. A text box and a text area with the same label
  share their text, as two boxes do.
- **Lists.** A list shows its items as `say` shows them, a row every 24 from its
  top. They're copied when it's drawn, so changing the program's list changes
  what's shown when it's drawn again, which an app does after each event, and a
  list never shows something half changed. A click on a row chooses that item,
  gives the list the focus and runs `when an item is chosen` with the item
  itself, not its text: a number stays a number. While a list has the focus,
  up and down choose the item before or after (down from none chosen is the
  first) and scroll to keep it in view; every other key is the list's, and goes
  nowhere. The mouse wheel scrolls the list under it without choosing. What's
  chosen and what's first in view are kept by label through `clear`; `the
  choice in the list` is nothing until something's chosen, and when the items
  drawn no longer reach it.
- **A new event, `scroll`.** Hosts send it with x, y and a number of rows,
  down: the playground for a turn of the wheel (a row for each 24 pixels it
  would have scrolled the page), the window for each 40 of a turn (3 rows a
  notch, as Windows scrolls), and MOTH_EVENTS as `scroll x y rows`. Like `type`,
  it's only ever for the picture's controls: no handler waits for it.
- **Where the rules live.** The Turtle in vm.js again: `route()` decides, and
  it tells the host what changed without the program drawing anything with
  items of their own, `{ checkbox, ticked }` and `{ list, chosen, top, focused
  }`, as a text box's `{ textbox, ... }`. machine.moth keeps an entry by label
  for each, 16 bytes for a checkbox and 64 for a list (its items, them as
  shown, what's chosen and what's first in view), a text area's being a text
  box's, and decides the same way.
- **What's drawn.** A checkbox in the pen's colour, white inside, with a box of
  the pen's colour in the middle while it's ticked. A text area as a text box,
  its lines 16 pixels high, the size the window's font is everywhere, so that
  machine code and the playground line up. A list white in a border of the
  pen's colour, 3 wide while it has the focus, the chosen row in the pen's
  colour with its text in white, and while its items don't all fit, a bar at
  its right for where the rows in view are among them.
- **Linux.** As for buttons: drawn and read, never clicked.
- **Tested.** The phrases and their near misses on all three engines, through a
  hand-over to the VM, and in compiler.moth against the JIT; machine code's
  window against the JavaScript engine on three runs of events, clicks, keys,
  the wheel and lines typed, and its pixels; and on Windows and Linux, ticks and
  choices read before anything's clicked, and every mistake in what's drawn.

## 41. Editing what's typed

- **What it does.** A click in a text box or a text area puts the cursor between
  the two letters nearest it, and a drag from there selects. The arrows, Home
  and End move the cursor (up and down between a text area's lines, Home and
  End to the ends of a line), and with Shift they select. What's typed takes the
  place of what's selected; Backspace and Delete take it off, or the letter
  before or after the cursor. Ctrl+A selects everything, and Ctrl+C, Ctrl+X and
  Ctrl+V copy, cut and paste with the computer's clipboard. A box shows the part
  of its text the cursor is in, moving across as it goes, and a text area moves
  down too; long lines aren't wrapped. There's no undo yet.
- **A letter every 10 pixels.** For a click to land between the same two letters
  everywhere, every engine has to agree on where each letter is, and the
  playground's fonts and Windows' measure text differently. So what's typed is
  drawn a letter at a time, one every 10 pixels from 8 in, in a font whose
  letters all take the same room (Consolas in the window, the browser's
  monospace font in the playground), and where the cursor goes is worked out
  from those numbers alone, as a button's size comes from its letters (§36). A
  text box shows 18 letters at a time.
- **Keys with Shift and Ctrl.** Hosts send them as `shift+left` and `ctrl+a`:
  Shift only with a key that moves the cursor, Ctrl only with a letter. A box
  with the focus uses them. With nothing focused, a key with Shift goes to the
  program without it, so `when a key is pressed` still gets `left`, and a key
  with Ctrl goes nowhere, as before; a list with the focus ignores Shift.
- **The clipboard is the host's.** The Turtle never sees it. Copying is the host
  reading what's selected (the playground from what the turtle last drew, the
  window from the box's entry); cutting is that, then `ctrl+x`, for the box to
  take it off; pasting is the host typing what's on the clipboard, which follows
  typing's rules: a text box drops new lines, and a text area keeps them. The
  window turns Windows' CR LF into new lines and back. While the events come
  from MOTH_EVENTS it leaves the clipboard alone, so the tests never touch the
  clipboard of the person running them.
- **What's kept.** Where the cursor is, the other end of what's selected, and
  the first column and line in view are kept by the box's label with its text,
  through `clear`, and `clear the text box` puts the cursor back at the start.
  The turtle reports them with the rest: `{ textbox, text, focused, cursor,
  anchor, left, top }`. A place is counted in letters, as JavaScript's
  `[...text]` counts them; machine code finds a letter in the UTF-8 bytes by
  walking them, and a box's entry there grew from 16 bytes to 64.
- **Tested.** A run of 76 events on all three engines, through a hand-over to the
  VM, and in the window against the JavaScript engine: moves, Shift's selecting,
  Ctrl+A, Ctrl+X, a drag, a 40-letter limit, a text area's lines and moving down
  it, and keys with Shift and Ctrl with nothing focused; the window's pixels (the
  selection's light blue, the cursor, a letter every 10); and the clipboard in a
  real window, by hand: a copy, a cut of two lines (CR LF on the clipboard), and
  a paste into a box.

## 42. Dropdowns, sliders, and choosing a file

- **The phrases.** `draw dropdown "Size" showing sizes at x, y`, with `when an
  item is chosen in the dropdown "Size" with size` and `the choice in the
  dropdown "Size"`, which are a list's: `list` and `dropdown` mean the same there.
  `draw slider "Volume" from 0 to 100 at x, y`, `set the slider "Volume" to 50`,
  `the value of the slider "Volume"` and `when the slider "Volume" is moved with
  volume`. `choose a file to open`, and `choose a file to save`. Each is a run of
  words that meant nothing before, so `dropdown`, `slider`, `moved` and `choose`
  are still names, and `set the slider` was a mistake (`set the` wants `to`).
- **A dropdown is a list that's closed.** It's 200 by 30, showing what's chosen,
  or its label in grey, and an arrow. A click opens it: its items in a list
  below it, up to 6 rows, on top of everything else, which the wheel scrolls.
  While it's open, any click closes it, and one on an item chooses that item;
  a click anywhere else does nothing more, so closing a dropdown never presses
  the button under it. While it has the focus, open or not, up and down choose,
  Enter and Space open and close it, and Escape closes it. Its items, what's
  chosen and what's first in view are kept by its label, as a list's are.
- **A slider** is 200 by 20, its value a whole number from its `from` to its `to`
  (either way round), starting at `from`. A click moves it there, and so does a
  drag from it; the arrows move it a step, and Home and End to its ends. Its
  handlers run when its value changes, with the value; `set the slider` changes
  it without running them, kept to its range while it's drawn. Whole numbers keep
  every engine and machine code on the same value for the same click, as a
  letter every 10 pixels keeps them on the same place in a text box (§41).
- **Choosing a file is asking.** `choose a file to open` asks "Which file to
  open?" and gives the answer, or nothing for an empty one. A host that can do
  better does: the playground shows a file picker for a question that starts
  that way, as it shows a pad for one that starts "Draw", and the file picked
  joins the page's files, so `read` finds it by its name; the window shows
  Windows' own Open or Save box, titled with the question, and gives the file's
  whole name. Anywhere else (Linux, or a program reading its answers from a
  file) it's a question like any other. In the playground, as with `ask`, an app
  can't choose a file once it's running; machine code's apps can, from a button.
- **Where the rules live.** Turtle.route in vm.js again, which reports what
  changed with `{ dropdown: label, chosen, top, focused, open }` and `{ slider:
  label, value, focused }`. Machine code keeps a slider's value, and the range it
  was last drawn with, in an entry of 32 bytes by its label, and gives a dropdown
  a list's entry.
- **Tested.** A run of 31 events on all three engines, through a hand-over to the
  VM, and the same events in the window against the JavaScript engine; values,
  choices and every mistake in what's drawn, on Windows and Linux; the
  playground's picker; and Windows' Open and Save boxes in a real window: a file
  chosen, a name to save with an é in it, and both cancelled.

## 43. Faster records, and timing machine code fairly

- **What was slow.** The README said machine code was slower than the
  JavaScript engines at lists, records and dictionaries, from `npm run bench`,
  whose runs are short. Made ten times as big and more, with starting up taken
  off, they say otherwise: machine code is two to five times as fast as the JIT
  and WebAssembly at lists, dictionaries and text. Only making records was
  slower than WebAssembly, which, seeing that a record made in a loop doesn't
  outlive it, never makes it at all.
- **Records in one block.** A record made in the program's own words, `record
  with x 1, y 2`, whose fields' names all differ (as they do but in `record with
  a 1, a 2`), is now one block: the record, then room for its fields and one
  more, which go straight in, not looked for one by one first as a field set
  later is. A record given more fields than that moves them to a block of their
  own, as before. Two million records made and read went from 99 ms to 64 ms,
  WebAssembly's 61. The collector finds a block from a pointer into its middle,
  so fields inside their record's block need nothing new from it.
- **Tried, and left out.** Finding a field in line, where it's read, rather than
  in the runtime: 2% quicker, for code that's bigger at every `x of point`.
- **Timing fairly.** On Windows the virus checker looks through a program the
  first times it runs, and one in the temporary folder every time: a program
  that only says 1 took 23 ms to start from there, and 6 to 15 ms from anywhere
  else. `npm run bench` and `npm run versus` built their programs in the
  temporary folder, and timed their first runs; they now build them in a folder
  of the repo's and run each once or twice first, and the bench has a row for a
  program that only starts, to read the rest against. Every compiled language
  in `versus` got quicker for it, Moth's machine code with them.

## 44. A window on Linux

- **What it lacked.** On Linux a program that drew showed nothing, and an app
  set up and ended: the window was GDI+ and Windows' own, and Linux has neither
  in every program's reach. Its X server is in reach, by a socket, and nothing
  else is needed to speak to it, so the program speaks X11 itself, as it speaks
  HTTP and WAV: no Xlib, no library at all, and still nothing to install.
- **Drawing.** What's drawn is drawn by the runtime, into 500 by 500 pixels in
  memory, as a canvas draws it: a pixel's middle half a pixel in, and each
  shape's edge smoothed by how much of each pixel it covers. A line is every
  pixel within half its width of the line between its ends, so its ends are
  round; a circle, a disc smoothed at its edge; a dropdown's arrow, a triangle,
  16 points tried in each pixel; a picture, the nearest of its pixels, as a
  canvas with smoothing off. GDI+ puts a pixel's middle on the corner, so the
  two systems' edges can differ by half a pixel; the tests ask about places
  away from edges.
- **Letters.** There's no font to ask for either, so the letters come with the
  program: DejaVu Sans, drawn by FreeType at 16 pixels to the em and at 24, and
  DejaVu Sans Mono at 16, 4 bits of ink a pixel, made into machine.moth's
  tables by `tools/glyph-tables.py`. Text 16 high, which is every button's,
  box's and list's, is drawn from the table at 16 with each letter on a whole
  pixel, as hinting puts it, which keeps its lines sharp; any other size is
  read from the one at 24 between its pixels. Latin-1 is there, and any other
  character is U+FFFD. The tables make a Linux program that draws 45 KB
  bigger, 59 KB with boxes to type in, and carry the fonts' licence, as it
  asks ([`LICENSE-DejaVu`](LICENSE-DejaVu)).
- **The window.** `DISPLAY` names the server: `:0` is its socket in
  /tmp/.X11-unix, or the same name in the abstract namespace, and `localhost:0`
  is TCP. A cookie from `XAUTHORITY`, or ~/.Xauthority, goes with the hello if
  there's one for that display. The window is 500 by 500, a size its window
  manager is asked to keep, named as on Windows, and closes as a message, not
  by the connection going. What's drawn goes to it 100 rows to a request, its
  pixels as they are, so a server whose pixels aren't 32 bits, the low byte
  first, gets no window, as one that isn't there doesn't.
- **What happens to it** is what Windows' window does, event for event: a key
  with a name by its name, a letter in lower case and then, for a box, as
  typed; Shift with the keys that move the cursor; Ctrl with a letter, for a
  box; the wheel, 3 rows a notch; Escape closing a picture. Keys come as X's
  keysyms, read from the server once, the keypad's digits with Num Lock
  included. Timers are the program's own, waited for between the server's
  messages, and the window is drawn again once nothing's left to do.
- **Timers aren't buttons.** Building it found that a timer and a button's
  handler had the same number for what they wait for, 3, so a button's handler
  was taken for a timer: in Windows' window it ran every 10 milliseconds, and
  `tick 0` in `MOTH_EVENTS` could reach it. A timer has a number of its own
  now, after the events', on both systems.
- **Tested.** The thirteen tests of the window's, on Linux as on Windows,
  through `MOTH_PICTURE` and `MOTH_EVENTS`, which go through the same drawing
  and the same handling; and a real window, on WSLg's X server, sent the
  tests' clicks, keys, drags and turns of the wheel by another X client, and
  read back by it: for the to-do app, the checkboxes and lists, the dropdown
  and slider, and editing, it said and showed, pixel for pixel, what the same
  events did through `MOTH_EVENTS`. And DISPLAY by TCP, a cookie sent for its
  display and not another's, no server, no terminal, Escape, stopping from a
  handler, and a title cut at 200 bytes between characters.
- **Not yet.** The clipboard, which X keeps by messages between programs; the
  pad; boxes for choosing a file; keysyms of the old kinds past Latin-1, such
  as Cyrillic's, which give nothing; and a Mac's window.

## 45. Libraries: calling C

- **Why.** A large program needs what's already written: a database, the
  system's own functions, compression, a window toolkit. Writing each of them
  into the runtime, as the Linux window was, doesn't scale. So a program can
  call any C library's functions itself, as a C program would.
- **Declaring them.** `use the library "sqlite3"`, then a line for each function
  the program calls and `end`: its name as the library has it, what it takes,
  and what it `gives`, in Moth's words for C's types. `a number` is a double,
  `a whole number` an int (a uint fits too), `a long whole number` 64 bits,
  `a pointer` a whole number, nothing or bytes, `text` UTF-8 and `wide text`
  wchar_t's, both ending in a 0 C sees and Moth doesn't, `bytes` the program's
  own memory, which C can fill (a pointer it gives back, say), and `yes or no`
  an int. Each line makes a function of the program's, called like any other,
  whose inputs say what they are, so a call with text for a number stops where
  it's made. Names are the library's, in their case; Moth's own words go in
  quotes with a name for them: `"remove" as remove_file(text)`. Libraries
  named with `or` are tried in turn, so `"winsqlite3" or "sqlite3"` is SQLite
  on Windows and Linux; `as` keeps a library's functions apart, as for a file.
- **Calling one.** The first call loads the library and finds the function:
  LoadLibraryExW and GetProcAddress on Windows, from System32 and then the
  program's folder, never the current one or PATH; dlopen and dlsym on Linux,
  where `"sqlite3"` is libsqlite3.so, or .so.0 to .so.9, as packages install
  it. Each input is made what C wants, with text copied into memory of its own,
  and put where the system's convention wants it: Windows' four registers,
  each a number's xmm register too, for a function that takes any number of
  inputs, and the stack; or Linux's six registers for whole numbers and eight
  for numbers, and how many of those in al. Then what it gives is made a
  value: a pointer of 0 and a text of none are nothing.
- **Linux, dynamically linked.** A Linux program had no linker: the kernel ran
  it as it was. One that uses a library is now linked by glibc's, which loads
  libc and gives it dlopen and dlsym; it's otherwise the same program, still
  speaking to the kernel itself. Every other program stays as it was.
- **Asked first.** A library can do anything the program can, beyond the
  reach of the --allow flags, so using one is asked for, as starting a program
  is: at a terminal, once for each library; anywhere else, only with
  `--allow-libraries` (or `--allow-all`).
- **Only in machine code.** The playground and the JavaScript engines can't load
  a library, so a call there is a mistake that says so, as `run program` is.
- **A library of Moth's on one.** `tools/sqlite.moth` keeps a database in a file
  through SQLite, which comes with Windows (winsqlite3.dll) and most Linux
  systems: `open`, `run` and `query`, each row a dictionary, values bound to
  `?`s, and SQLite's mistakes as `fail with`. An `out` pointer is 8 bytes C
  fills, read back in Moth.
- **Tested.** On Windows and Linux: the C library's own functions with each
  kind of input and what they give, 15 inputs to `sprintf`, past the registers
  on both systems, a function of a library's as a value, each mistake (a
  number that isn't whole, a library or function that isn't there, no
  --allow-libraries), and only a program with a library being linked; and
  sqlite.moth's database, written, read back and opened again.
- **Then structs, floats and callbacks** (§46).

## 46. Structures, callbacks and floats

- **Why.** Most of a system's own functions take a struct, and much of what
  makes a program a program, a window above all, needs C to call back into
  it: Windows calls a window's procedure for everything that happens to it.
- **Structures.** `structure point with x as a whole number, y as a whole
  number`, in a library's block, makes `a point` a type its functions can take
  and give, and its other structures and callbacks hold. A field is any of
  the types an input can be, but bytes, which are `16 bytes` or as many as the
  struct has in a row, another structure, held in it, or a callback. They're
  laid out as C lays them out: each on the boundary its size wants, and the
  whole rounded up to its largest. A function given one takes where it is, as
  C passes nearly every struct: the record is made a struct in memory of its
  own, a field it hasn't made 0, nothing a pointer of 0; and once the function
  is done, each field is made a value again and set in the record, so what C
  fills in, the program reads, as `GetCursorPos` and `mktime` want. A
  structure it gives, from where it is, is a new record, or nothing for none.
  A mistake in a field says which: "'memcpy' needs input 1's size to be a
  number, not text".
- **Callbacks.** `callback compare(a cell, a cell) gives a whole number` makes
  `a compare` a type an input or a field can be, given a function of the
  program's that takes as many inputs. C can't call a Moth function, so each
  kind of callback has 64 entries in the program, small pieces of code C can
  call, each with a slot that holds the function it calls: a function given
  for one takes the slot it had, or the first that's empty, and C is given
  its entry. The entry keeps the registers C wants kept, makes what C gave
  values, calls the function as an app's handler is called, the first call in
  progress, and makes what it gives what C wants. The slots are where the
  collector looks for values, so a function C holds on to stays. A mistake in
  one ends the program then and there: going on past C's own code, which is
  in the middle of calling it, would leave the library half done.
- **Floats.** `a float` is C's float, 4 bytes, for the functions, OpenGL's and
  the like, that take one; it's a number to Moth.
- **Tested.** On Windows and Linux: `qsort` sorting with a Moth function as
  its comparison, given records of structures; `mktime` filling in a struct it
  was given; a structure of text, bytes, another structure and a number,
  copied by `memcpy`; floats both ways; and each mistake. On Windows, a window
  class registered with a structure that holds a callback, its window made
  and destroyed, its procedure a Moth function Windows calls with each of its
  messages, and `EnumWindows` calling one for every window.
- **Not yet.** A struct passed or given by its value, whole numbers of 8 or 16
  bits, a callback called from another thread, and a Mac.

## 47. Windows' own controls, in Moth

- **Why.** An app's window draws its own buttons and boxes, the same on every
  system and in the playground, but they're Moth's and not Windows': no
  menus, no Tab between them, nothing a screen reader knows. With libraries,
  structures and callbacks, a program can use Windows' own, so
  [`tools/windows.moth`](tools/windows.moth) does, in Moth and nothing else:
  a module on user32.dll, kernel32.dll, gdi32.dll and comdlg32.dll, about 540
  lines, and a program that uses it is built with `--allow-libraries`.
- **What it makes.** `window`, then `button`, `label`, `text_box`,
  `text_area`, `checkbox`, `list_box` and `dropdown` in it, at places and
  sizes in pixels as at 100%; `menu_item`, `timer`, `message`, `ask_yes_no`,
  `choose_file_to_open` and `choose_file_to_save`; and `run`, which handles
  what happens until the first window closes. Each control is a record with
  its handle, so the module's own declarations, `ui's sendmessagew` among
  them, can be given it for anything it doesn't wrap.
- **What happens.** One window class, whose procedure is a Moth function:
  Windows' WM_COMMAND, from a control or a menu item, finds the control by
  its number and calls its handler, a button's with nothing, a checkbox's with
  whether it's ticked, a list's with what's chosen, a box's with its text;
  WM_TIMER a timer's; WM_SIZE the window's, with its size as at 100%; and
  WM_CLOSE asks the window's, which can say no. `IsDialogMessageW` in `run`
  gives Tab and Shift+Tab between the controls.
- **The look.** Windows draws controls as Windows 95 did unless a program asks
  for version 6 of its common controls, by a manifest. Moth's programs have
  none, so the module makes an activation context from the one shell32.dll
  has, resource 124, and keeps it active: buttons, checkboxes, boxes and
  lists are drawn as Windows 11 draws them. It says it knows about screens set
  larger than 100% (`SetProcessDPIAware`), makes every place and size bigger
  by the screen's dots per inch, and uses Segoe UI at 9 points, as Windows'
  own programs do.
- **Text.** A box's text goes in and out as UTF-16 (`wide text`); its line
  ends are Windows' CR LF, so `text_of` gives `\n` and `set_text` takes either.
  `lstrcatW` onto an empty string reads a UTF-16 buffer back as text, which
  Moth's types have no other way to. A box holds as much as Windows will, not
  the 32,767 characters it starts with. `on_change` is for what's typed: a
  one-line box tells its window when `set_text` changes it and a text area
  doesn't, so the module ignores the first while it's setting the text, and
  neither calls the handler.
- **Keys.** A menu item's text can end with a tab and its keys,
  `"Save\tCtrl+S"`, as Windows shows them. Windows' own way, an accelerator
  table, needs a handle made from a struct per key; instead `run` looks at
  each key pressed before it's handled, as `GetKeyState` says Ctrl, Shift and
  Alt are, and gives a menu item's handler the keys that are its. Keys it
  doesn't know are a mistake when the item is made, not when they're pressed.
- **A demo.** [`tools/notes.moth`](tools/notes.moth), a notepad in under 120
  lines: New, Open, Save and Save as with their keys, the file's name in the
  title with a `*` while it isn't saved, and a question before what's written
  is lost.
- **Tested.** A program of the test's, in a hidden window, driven by its own
  timer: typing, a click on a button and a checkbox, choosing in a list and a
  dropdown and removing from one, a menu item, a text area's lines, a resize,
  Ctrl+S and Ctrl+Shift+F5 pressed with the thread's keys set to show them
  held, a key without them typed as a key, keys that aren't keys, and closing.
  And notes.exe, driven by another program's window messages: typed into,
  saved through the Save box, saved again without it, closed with changes
  (No kept it, Yes closed it), a file opened through the Open box, one with CR
  LF opened as it was, and New.
- **Not yet.** Linux's own controls (see §49); pictures and drawing in a
  window of its own; more than one window's Tab order; and windows.moth on the
  JavaScript engines, which can't call a library.

## 48. Faster calls

- **Where the time went.** fib(32) took 33 ms against C's 20. In each call, a
  function knew nothing about what it was given, so `n is less than 2` first
  checked that n was a whole number (three instructions and two jumps), and a
  call knew nothing about what came back, so `fib(n - 1) + fib(n - 2)` checked
  the sum for a NaN that might mean text. The frame kept the number of the
  call that made it, for a mistake's trail, which took an instruction at the
  call and another in the function. And a number the program wrote, `n - 1`,
  was loaded into a register before it was used.
- **What each function is given and gives.** For a function only ever called
  by its name, and never used as a value, machine.moth works out what kind of
  value each input always gets and what it always gives back: a whole number,
  a number, or anything (the kinds of §32). Each input is first taken to be a
  whole number and the function to give one, then each guess is made less
  wherever the program says otherwise, until nothing does: so fib, given 32
  and then n - 1 and n - 2 of a whole n, is given whole numbers and gives
  them, which only a guess that holds up against its own calls finds. Going
  through the program for this is quick: each finding changes the guess there
  and then, and only the functions whose inputs changed, or that call one
  whose result did, are gone through again.
- **Checked as it's written.** That's a guess, made by going through the
  program as writing its code does, but not by writing it. So writing it
  checks it: every call notes the kinds it gives each input, every return
  the kind it gives, and every use of a function as a value. If any of it is
  less than the guess, the program is written again with what was found, and
  if that doesn't hold either, with no guess at all, which can't be wrong. So
  the code relies only on what's true: each call gives what was assumed, and
  each function, written assuming it, gives what was assumed.
- **Smaller pieces.** A number the program wrote on the right of `+`, `-`,
  `*`, `/` or a comparison of two whole numbers is used where it is in
  memory, and so is a variable sure to be a number, and `a + b` and `a * b`
  of two numbers add or multiply from the stack when the left side had to
  wait there. A frame no longer keeps its call's number: the call is followed
  by `test eax, number`, which changes nothing that's used, and the trail
  reads the number from where the frame goes back to; the runtime's own calls
  into a handler or a callback, and main's, are followed by -1, where the
  trail stops. A table of every call's return place did it first, but cost
  16 bytes a call, 589 KB of moth.exe.
- **The JavaScript engine's `is`** made a new Map every time it compared two
  values, for lists that hold themselves, even for two texts. It makes one
  only for lists, dictionaries and records now, which took a third off
  compiling moth.moth with Node.js (21 s to 14.5 s), more than going through
  the program costs.
- **What it gave.** fib(32) in 27 ms, against C's 20 and Rust's 18; the
  other three are as they were. Each of fib's calls is about 25 instructions,
  from about 35. moth.exe is 0.9% bigger.
- **Tested.** Programs written to break it, which machine code must say,
  fail and exit on exactly as the JavaScript engine does: a function given a
  whole number in one call, a fraction in another and text in a third, one
  used as a value and called with text, fib given 10.5 and text, a function
  that gives a number, text or nothing by the path it takes, infinities and
  sums past 2^53, two functions that call each other, a loop's variable
  passed on, an input changed to text, and `is divisible by` of inputs.
- **Not yet.** Inputs in registers instead of on the stack, a function's
  variables kept in registers through the calls it makes, and functions put
  in line where they're called. (The first and the last are §63.)

## 49. Linux's own controls, and one module for both

- **Why.** windows.moth gave a program Windows' own controls, and only
  Windows'. Linux has no one set of its own, but GTK 3 comes with nearly every
  desktop, GNOME's and the rest, and libgtk-3.so.0 is a library like any other,
  so [`tools/linux.moth`](tools/linux.moth) is windows.moth's functions again,
  on it, in Moth, about 600 lines.
- **How it's made.** A window is a GtkWindow holding a box: the menu bar, when
  there is one, on top, and under it a GtkFixed, which puts each control where
  it's asked, as Windows does. A text area and a list are in a scrolled window
  with a border; a list is a GtkListBox of labels, and a dropdown a
  GtkComboBoxText, each keeping its items' text in Moth as well, which GTK makes
  hard to read back. Places and sizes are as at 100%, which GTK makes bigger
  itself for a screen set larger, and it makes nothing smaller than it can be
  drawn.
- **What happens.** GTK calls a C function for each signal. Every one is
  connected with the control's number as its data, to one of four Moth
  functions, by what the signal gives: a click, a tick, a change of text, a
  menu item chosen and a window gone; a list's choice and a new size; a window
  being closed, which says whether it may; and a timer, which keeps going. So
  four callback entries are all a program uses, however many controls it has.
  A control the program changes itself doesn't tell it: as in windows.moth,
  `set_text`, `choose` and the rest are kept quiet, where GTK would signal
  them. A new size is told on Linux as the window first opens, too.
- **Keys.** A menu item's keys, `"Save\tCtrl+S"`, become an accelerator of the
  window's, which GTK shows beside the item and handles itself.
- **GTK's own text.** What GTK makes and the program must free, as a text
  view's text and a file box's name, comes back as a pointer: `strstr(p, "")`,
  which gives p, reads it as text, and `g_free` frees it.
- **One module for both.** [`tools/ui.moth`](tools/ui.moth) uses both, and as
  it starts asks Windows' kernel32 for the time: on Linux there's no library
  called that, which is a mistake it catches. Each of its functions then calls
  windows.moth's or linux.moth's. A library is only loaded when it's first
  called, so the other system's is never looked for.
  [`tools/notes.moth`](tools/notes.moth) uses it, so the notepad is one
  program for both.
- **Tested.** On Linux, linux.moth's own test, the same window as
  windows.moth's, driven by its own timer through GTK's functions for a click
  and typing, a list's choice made as a person would make it, and its menu's
  keys pressed through `gtk_accel_groups_activate`; ui.moth's, on Windows and
  on Linux; on WSLg's display here, and on CI's from Xvfb. And notes, on
  Linux, typed into by another program's X events, its Save box answered,
  saving what was typed, and closed.
- **Not yet.** A Mac's controls, which are Objective-C's and need more than
  calling C; and GTK 4.

## 50. Tabs, tables, progress bars, pictures and drawings

- **What an app was missing.** Real programs show more than buttons and boxes:
  settings on tabs, rows of data, a bar while something's being done, a
  picture, and something they draw themselves. Each is now in windows.moth
  and linux.moth, with the same functions, and in ui.moth.
- **Tabs.** `tabs` makes them, and `tab(tabs, "People")` a page, which is a
  parent like a window: controls put on it show while its tab is chosen. GTK's
  notebook has a page of its own for each; Windows' tab control is only the
  tabs, so a page's controls are the window's, put inside the tabs (where
  TCM_ADJUSTRECT says), shown and hidden as its tab is chosen, and the tabs
  kept under them for clicks to reach them. The handler is given the tab's
  title when the person chooses one, from WM_NOTIFY's TCN_SELCHANGE, or GTK's
  switch-page.
- **Tables.** `table(parent, columns, ...)` and `add_row(table, values)`, each
  value shown as `say` shows it; `chosen_row` gives the chosen row's values,
  and the handler is given them when the person chooses one. Windows' list
  view, in report view, a whole row chosen at a time, with grid lines; GTK's
  tree view on a list store of texts.
- **Progress bars** from 0 to 100, Windows' with the green of version 6 of its
  common controls, which InitCommonControlsEx makes ready under the activation
  context from §47.
- **Pictures.** `picture(parent, file, ...)`, made the size it's put at: on
  Windows by GDI+, which reads PNG, JPEG, GIF and BMP and gives a bitmap for a
  static control, the window's own colour under what's see-through; on Linux
  by GdkPixbuf. A file that isn't there, or isn't a picture, is a mistake.
- **Drawings.** `drawing(parent, ..., painter)` calls the painter whenever it
  must be drawn, and after `redraw`, with a canvas: `colour`, then `rectangle`,
  `circle`, `line` and `words`, at places as at 100%, and `on_click` gives
  where it was clicked. Windows paints it with GDI on WM_PAINT, in a window
  class of its own that shares the windows' procedure, with the DC's own brush
  and pen, whose colours change without making any; GTK with cairo, on its
  draw signal.
- **Names.** Moth's names don't mind capitals, so a function called
  `rectangle` and Windows' `Rectangle` are the same name: windows.moth calls
  GDI's `"Rectangle" as fill_box` and `"Ellipse" as fill_ellipse`, and cairo's
  is `cairo_box`.
- **What GDI gives.** A GDI handle is 32 bits, sign-extended to 64, so read
  from memory as 8 bytes it would be a number past what a pointer can be; it's
  read as 4, with its sign.
- **Tested.** On Windows and on Linux, the same window: a progress bar set,
  and set past 100; a picture shown, and a mistake for one that isn't there; a
  drawing painted (and on Windows clicked, by its message); a tab chosen as a
  person would choose it, with its handler, and one chosen by the program,
  without; a table's rows added, one chosen by the program and one by a
  person, and cleared. Each system's own look was checked by eye, from
  screenshots. And a click on GTK's drawing, sent by another program's X
  events, landed where it was sent.

## 51. A web server

- **Why.** A program could read sites and send to them, but not be one, and a
  backend, an API or a page for a phone on the same network is a site.
  [`tools/server.moth`](tools/server.moth) is one, in Moth, on the system's own
  sockets: Winsock's on Windows, libc's on Linux, the same functions declared
  in two libraries and the right one called, as ui.moth chooses.
- **What a program writes.** `web's serve(8080, answer)`, where `answer` is
  given a request, a record of its method, path, query, headers and body, and
  gives back text (a page if it starts with `<`), a list or dictionary (sent as
  JSON), or a record with any of status, body, type, headers and file, a file
  whose bytes are sent with the type its name says. `serve` answers this
  computer alone, at 127.0.0.1; `serve_everywhere` every network, which is the
  program's choice to make. `stop_serving` ends it.
- **How it reads a request.** Into a block that doubles when it must, until the
  blank line after the headers, then as many more bytes as Content-Length says,
  16 MB at most (413) and 64 KB of headers (431). The query is decoded, `%20`
  and `+` included, by hand: `number of` doesn't read hex. Every answer says
  `Connection: close`, and requests are answered one at a time.
- **When the handler fails.** The mistake goes to the error output, the request
  gets a 500 that says it, and the server goes on to the next. A connection that
  goes before it's answered is a mistake too, said the same way; on Linux it's
  sent with MSG_NOSIGNAL, so it isn't the end of the program, as SIGPIPE would
  make it.
- **Tested.** A server built from the test's program, answering another Moth
  program, which `read`s and `send`s to it as to any site: a page, a query
  decoded, JSON with a header seen, a POST's body given back with its status, a
  file, a missing file's 404, the handler's mistake as a 500 with the server
  going on, and `stop_serving`, on Windows and on Linux.
- **Not yet.** More than one request at a time, keeping a connection open for
  the next, HTTPS (a proxy in front can do it), and WebSockets.

## 52. Work in the background

- **Why.** A window whose program is busy can't be drawn or clicked: a slow
  download or a long sum freezes it. Moth's runtime has one stack, one
  collector and one set of registers it keeps things in, so it can't run two
  of its functions at once. Two programs can, so
  [`tools/tasks.moth`](tools/tasks.moth) runs the slow part as another one.
- **What a program writes.** `tasks's start(program, inputs)` starts another
  program and gives back at once; `start_self(inputs)` starts this same program
  again, which looks at its `arguments` to know it's to do the job, and says
  what it found. `done(task)` takes what the task has said so far and says
  whether it has ended, without waiting, so a window's timer can ask it;
  `wait_for` waits; `output_of` is all it said, to its output and its error
  output; `code_of` the number it ended with; `stop_task` ends it.
- **On Windows.** CreateProcessW, with an inheritable pipe for the task's
  output and error output, its reading end kept back, and no console window.
  Its inputs are made one command line by the rules CommandLineToArgvW
  undoes: one with a space, a tab or a `"` in it, or none at all, in quotes,
  with a `"` and the backslashes before it escaped. PeekNamedPipe says what's
  there without waiting for it.
- **On Linux.** fork, then in the new process dup2 of the pipe to its output
  and error output, and execvp, which finds the program on the PATH and keeps
  the environment; `poll` with no wait says what's there, `waitpid` with
  WNOHANG whether it has ended. A program that isn't there ends with 127, as
  the shell's does; on Windows it's a mistake when it's started. The inputs
  are C's strings from strdup, and argv is built from their addresses.
- **Tested.** On Windows and Linux: the program started again to sum to a
  million, asked while it ran, ending with 3; inputs with a space, quotes,
  backslashes, an empty one, é and an emoji, as they were; a task that never
  ends, stopped (1 on Windows, 137 for SIGKILL on Linux); and a program that
  isn't there.
- **Not yet.** Sending a task its input, and telling its output from its
  error output. Threads of the program's own are §62.

## 53. Shipping a program: its icon, its version and its files

- **Why.** A program to give someone is one file, and on Windows it looks like
  one of theirs: an icon in Explorer and the taskbar, and a version in its
  properties. Its pictures and data shouldn't be files lying beside it.
- **`--include`.** `moth build app.moth --include data --include logo.png`
  builds the files, and every file in a folder and the folders inside it,
  into the program's read-only data, each with its name as it was given, `/`
  between folders and no `./` at the start. `read` and `read bytes`, and what
  reads through them (a picture's file, say), look for the name there first,
  byte for byte, and then on the disk: a file that's built in is the
  program's own, so it needs no `--allow-read`.
- **`--icon` and `--version`**, on Windows, make a resource section, `.rsrc`,
  after the data: the directories Windows reads resources by (type, then
  number, then language, US English), the icon's pictures as RT_ICON, the icon
  made of them as RT_GROUP_ICON, number 1, and RT_VERSION, the fixed numbers
  and the text Explorer shows: the version, and the program's name as its
  description, product and file name. An .ico file's pictures are taken as
  they are; a .png is one picture, which Windows shows from inside an icon
  since Vista. windows.moth's windows use icon number 1 for theirs, so a
  program built with an icon has it in its title bar as well, and `set_icon`
  gives a window one from a file, on Linux too.
- **For Node.js** `machineCompiler`'s options take `icon`, `version` and
  `include`; machine.moth's `compile_shipping` takes them, and
  `compile_allowing` is it with none.
- **A mistake in what it's given** (an icon that isn't one, a version that
  isn't up to four whole numbers, a file to include that isn't there) is
  moth's, said as `moth: ...`, not a place in the program.
- **Tested.** moth.exe building a program with a folder of files, one inside
  another, a picture built in and used as its icon, and a version; the program
  moved to a folder with none of them, reading them all, and refused a file
  that isn't built in; on Windows, its RT_ICON, RT_GROUP_ICON and RT_VERSION,
  and the version as Windows' own `VersionInfo` reads it; and the three
  mistakes. On Linux, the files.

## 54. Patterns, numbers, CSV and dates

- **Why.** Programs check what's typed, pull numbers out of text, show money
  with two decimals, read and write spreadsheets' CSV, and count days. None of
  it needs the system, so [`tools/text.moth`](tools/text.moth) and
  [`tools/dates.moth`](tools/dates.moth) are Moth alone, and work on every
  engine, machine code and the playground's three.
- **Patterns** are regular expressions as most languages have them: classes,
  `\d \w \s` and their opposites, `.`, `^ $ \b`, groups kept and not, `|`,
  `* + ?` and `{n,m}`, each greedy or not, and `(?i)`. A pattern is read by
  recursive descent into a program of steps (a character, a set of ranges, a
  split between two places to go on from, a jump, a group's edge saved, and
  the tests for the start, the end and a word's edge), and run by
  backtracking, with its own stack, not Moth's calls, so a long text can't run
  out of them. A split is tried in its order, so the first match is the one
  other languages find. A step at a place in the text that has been tried
  before is not tried again: it can't do better the second time, so `(a*)*b`
  can't go round for ever and `(a|aa)*c` isn't exponential, as RE2's
  bit-state backtracker does it. Repeats are copies of the steps: `{2,4}` is
  two, then two that may be skipped.
- **Numbers.** `number_text` rounds as a person does, half away from 0, on the
  digits Moth shows (15 of them), so `number_text(2.675, 2)` is `2.68`, where
  arithmetic on the double, 2.67499..., would give 2.67. `grouped` puts a
  comma (or `grouped_with`'s separator) between each three digits.
- **CSV** as RFC 4180 has it: commas, a value in quotes when it has a comma, a
  quote or a new line, `""` for a quote, and a line ending with a new line or
  a return and one; `read table` still reads a CSV file as records.
- **Dates** are records of a year, month and day, checked when they're made.
  A date's number of days from 1 January 1970, and back, is Howard Hinnant's
  days-from-civil, which counts from March, so February's leap day is last,
  in eras of 400 years. Moth has no floor, so it's the digits before the
  point, one less for a fraction below 0. Weekdays come from 1 January 1970
  being a Thursday; months are added keeping the day, or the month's last.
  `format_date` takes the tokens from the longest, `[ ]` for words as they
  are; `today` and `now` are Moth's own `the year`, `the hour` and the rest.
- **Tested.** text.test.moth's 8 tests and dates.test.moth's 6, on all three
  engines and in machine code, through moth.exe's test runner: patterns
  matching and not, groups and the rest, finding every match and empty ones,
  replacing with `$1` and `$$`, splitting, the two that would never end, bad
  patterns' mistakes, rounding at the edges, CSV both ways and back, and
  every week of 400 years, counted as a person counts them, against both of
  the date's directions.

## 55. Files, folders, the environment and SHA-256

- **Why.** Moth reads, writes and removes files, and lists a folder, but a real
  program also moves a file, makes a folder for its data, asks how big a file
  is or when it changed, reads `PATH` or `HOME`, and checks a download against
  its hash.
- **SHA-256** is [`tools/hash.moth`](tools/hash.moth), FIPS 180-4 in Moth, so
  it works everywhere. Moth's numbers are doubles, exact to 2^53, and its bit
  operations work on whole numbers up to there on every engine, so 32-bit
  words fit, and a sum of five of them does before it's cut back to 32 bits.
  Turning a word right by n would shift it left by up to 31 bits, past 2^53, so
  it's done by multiplying what falls off by 2^(32 - n) instead.
- **Files, folders and the environment** are
  [`tools/system.moth`](tools/system.moth), on the system's own functions:
  kernel32's on Windows (GetFileAttributesExW for a file's size and when it
  changed, a FILETIME's 100 ns since 1601 made seconds since 1970; MoveFileExW,
  CreateDirectoryW, GetEnvironmentVariableW and the rest), libc's on Linux
  (`stat`, its mode at byte 24, its size at 48 and its time at 88 on x86-64;
  `rename`, `mkdir`, `getenv`, `getcwd` and the rest). `make_folder` makes the
  folders a folder is in too, as `mkdir -p`. `move` is a Moth word (the
  turtle's), so it's `move_file`, and `copy_file` to match.
- **Tested.** hash.test.moth: the empty text, `abc`, the fox, FIPS 180-4's
  448-bit one, 55, 56 and 64 bytes of `a` (where the padding takes another
  block), text and its bytes alike, and 1000 bytes against Node's crypto, on
  all three engines and in machine code. system.moth: one program, run on
  Windows and on Linux, saying the same, word for word: a file made, its size
  and time, folders made in folders and removed, a folder that isn't empty
  refused, a file copied, moved and removed, a variable set, read and
  removed, the current folder changed and back, and the mistakes.

## 56. Games

- **Why.** A game is the program people most want to make first, and it needs
  what a window with buttons doesn't: drawing again many times a second, the
  keys being held, not just typed, where the mouse is, pictures and sounds.
- **[`tools/game.moth`](tools/game.moth)** is a window that is all one drawing,
  on ui.moth, so on Windows and Linux: `run_game(update, show)` calls
  `update(seconds)` and then `show(canvas)` about 60 times a second, by a 16 ms
  timer, with how long it's been since the frame before (a quarter of a second
  at most, so a program held up takes a step, not a leap). `the clock` times
  it. `key_down`, `mouse_x`, `mouse_y` and `mouse_down` say what's held and
  where; `on_key` and `on_click` are told as it happens.
- **In windows.moth and linux.moth.** A drawing keeps the keys held, by name,
  from WM_KEYDOWN and WM_KEYUP (and says it wants all of them, WM_GETDLGCODE,
  so `run`'s dialog manager leaves the arrows to it; and forgets them when it
  loses the keys), or from GTK's key-press-event and key-release-event on its
  window; and the mouse, from WM_MOUSEMOVE and the button's messages, or
  motion-notify-event. Its keys' names are the same on both: Left, Space, A,
  F1 and the rest, whatever case they're asked for in.
- **No flicker on Windows.** A drawing is drawn into a bitmap of the window's
  size, then onto the window in one BitBlt, and WM_ERASEBKGND does nothing:
  each frame a whole new picture, as GTK's double buffering gives already.
- **Pictures** are read as bytes, so one built into the program by
  `--include` works as one on the disk does: on Windows into an IStream
  (SHCreateMemStream) that GDI+ makes a bitmap of, drawn with
  GdipDrawImageRectI, nearest-pixel so it's sharp and quick; on Linux into a
  GdkPixbufLoader, drawn with cairo, scaled to the size asked for.
- **Sounds** are WAV files: on Windows PlaySoundW plays their bytes from
  memory, kept while they play; on Linux a copy in /tmp, played by `paplay`
  (PulseAudio's and PipeWire's) or `aplay` (ALSA's), started by fork and
  execvp and not waited for. A new one stops the one before on Windows.
- **Tested.** A game that plays itself, the same on both but for how a person
  is made: a picture's size read, a sound played, a key pressed (by its
  message on Windows; on Linux by GTK's own test call, which needs X11's core
  events), held for 17 frames and let go, moving what it held and then not,
  the mouse moved, pressed and let go, at least 30 frames a second, and a
  frame painted. And `tools/catch.moth`, a game of falling stars, played.

## 57. A value's own functions and fields

- **Why.** A record keeps a thing's values together, but the functions that
  work on it are written `bark(rex)` and `name of rex`, inside out from how
  it's said: rex's name, rex barks. Moth already had `'s`, for a file used `as`
  a name, and it reads the way people talk.
- **What it means.** Any `x's` that isn't a name the file used `as` is the
  value's own: `rex's bark()` is `bark(rex)`, the value given first and any
  other inputs after it, and `rex's name` is `name of rex`. They chain, `rex's
  owner's name`, and a bracketed value works too, `(item 2 of dogs)'s name`. On
  its own line a call needs no brackets, as any call: `rex's bark`, `rex's
  rename "Max"`. `set rex's age to 4` sets a field, and `set rex's bark() to 1`
  is a mistake that says so.
- **Only a way of writing.** The parser turns `'s` into the call or the field
  it stands for, so the VM, the JIT, WebAssembly and machine code have nothing
  new to do, and the function is found by its name as any other: two kinds of
  record can't each have their own `bark`, as in D's and Nim's uniform calls.
  No program that ran before changes: `'s` after any other name was a mistake.
  Only the mistake for `say x's y` with no `x` changes: x has no value yet.
- **A file's name wins.** Which `'s` it is is decided as the file is read:
  `use ... as` and `use the library ... as` note the name, and from then on
  `math's sqrt` is the file's, as before; compiler.moth keeps the same list.
- **Tested.** Two programs on the three engines and in machine code (calls
  with and without brackets, fields read, set and chained, a list's items, a
  number's own function); three mistakes; and compiler.moth held to moth.js,
  byte for byte, on every case.

## 58. Values in text

- **Why.** `say` joins its pieces, `say "Hi, " name "!"`, but text made to
  keep, a label or a line for a file, took `"Hi, " + name + "!"`, quotes
  opened and shut around every value.
- **What it means.** `"Hi, {name}!"` is `"Hi, " + name + "!"`: any value, as
  `say` would show it, since `+` with text on one side shows the other. The
  joining starts from text, so `"{a}{b}"` is text even when both are numbers.
  Inside the braces is any value: `{age + 1}`, `{rex's name}`, `{length of
  fruits}`.
- **What stays as it was.** Moth's own code is full of `{`: the JavaScript
  compiler.moth writes (`") {\n"`), patterns (`"\\d{3}"`), JSON (`"{\"a\":
  1}"`). So only a `{` right before a letter, `_` or a bracket starts a value,
  and it ends at its own `}`; any other `{` is itself, and so is `\{`, which
  already meant `{` (a `\` before any other character is that character). A
  value that starts with a number goes in brackets, `{(3 * n)}`, as `{3}` in a
  pattern is a count. Of every
  string in the repository's Moth, one changed: machine.moth's curl format,
  `%{http_code}`, now `%\{http_code}`.
- **In the tokenizer and the parser.** A text's token keeps its parts: text,
  and each value's own tokens, read from where they are in the line, so a
  mistake in one points at it, ending with a `}`. The parser reads each the way
  it reads a bracket and builds the `+`s, so the VM, the JIT, WebAssembly and
  machine code have nothing new to do. A mistake inside one says how to write
  a `{` itself. compiler.moth does the same, with each part a record of its
  text or its tokens, since Moth can't ask what kind a value is.
- **Text inside a value.** `"{join words with ", "}"`: a `"` inside a value
  starts text of its own, which can have values in it too, so where text ends
  is no longer the next quote. The tokenizer's pattern finds only an opening
  quote, and a scan finds the end: past a `\` and the character after it, and
  past each value, to its `}`, past any text inside it. Tidying, in moth.js and
  in moth.moth, and the playground's colouring find the end the same way. If
  the line ends inside a value, even inside text in it, the mistake is the
  value's `{`, which nothing ends, not the quote of the text in it.
- **Tested.** A program of values in text, on the three engines and in machine
  code on Windows and Linux: numbers, a sum, a call, `'s` and `of`, a list,
  nothing and yes, text as an item's key, and every `{` that stays as it was;
  another of text inside values, inside text inside values, and values in
  brackets; nine mistakes; compiler.moth held to moth.js on all of them;
  moth.exe tidying text with text in it as format() does; and the playground
  colours a value in text as code, the text inside it as text.

## 59. A debugger for built programs

- **Why.** The playground can step a program both ways and show every variable,
  but a program built into machine code could only `say` what it was doing.
- **`moth debug file.moth`** builds the program as `moth run` would, with a
  debugger in it, and runs it. It stops before the first line, and before each
  line it's told to, says where it is, and takes commands from its input,
  typed or not: `step`, `next`, `out`, `go`, `break 12` or `break math.moth 12`,
  `clear`, `breaks`, `show x`, `vars`, `where`, `list`, `quit` and `help`.
- **The debugger is Moth.** [`moth-debugger.moth`](moth-debugger.moth) is used
  `as moth_debugger`, read before the program so its functions are numbered
  first, and its code goes before the program's. Before each line of the
  program, and of the files it uses, machine.moth asks `wants(line, file, depth,
  function)` whether to stop, and if so calls `here` with the variables too.
  Stepping, breakpoints, the calls in progress (`wants` sees how deep each line
  is, so one more than the line before means that line made a call), and
  reading commands with `ask`, are all ordinary Moth; only the hook is machine
  code. moth.exe carries the debugger as a file built into it, `--include
  moth-debugger.moth`, and builds it into the programs it debugs.
- **What the hook needs.** How deep in calls the line is, r15, as
  `debug_depth`; and for each variable the line can see, nearest first (its
  own, then each function out to the top, but not the functions the program
  makes once, nor a file's names), what it holds and whether it has a value
  yet, `debug_value` and `debug_set`, which read it where it lives and never
  fail on one with no value.
- **Nothing kept where the debugger can't see.** A debug build keeps no loop's
  variables in registers, as the loop analysis never saw the hooks' calls, and
  makes no guesses about calls (§48). Near the most calls there can be, the
  hook doesn't call the debugger, so a program that recurses too far stops at
  its own line, as it would built the usual way.
- **Tested.** Three sessions word for word, on Windows and Linux; every test
  program built to be debugged and told to `go`, against its usual build; and
  `moth debug` through moth.exe.

## 60. Packages

- **Why.** A Moth file someone else wrote was a file to copy by hand, and copy
  again when it changed, with nothing to say which version a program needs.
- **A package is a Git repository** of Moth files, its main file named after it.
  `moth add <repository> [name]` clones it into `packages/<name>`, from a site
  (`github.com/someone/thing` gets `https://` put before it) or a folder, and
  writes a line to `moth.packages`: its name, where it came from, and the
  commit it's at. `moth get` makes `packages/` match the list, cloning what's
  missing and checking each clone out at its commit, fetching first if it hasn't
  that commit; `moth update` checks out `origin/HEAD` after a fetch, and writes
  the new commit down; `moth remove` takes the folder away, with the system's
  own `rmdir /s /q` or `rm -rf`, as a clone's files can be read-only. A package
  with a `moth.packages` of its own brings those packages too, at their commits,
  into the same `packages/`, unless one of that name is there already.
- **Git, not a registry.** Every program that needs packages is a program
  people already keep in Git, and a commit names the exact code, so the list
  needs no versions or hashes of its own. moth runs `git`, as it runs any
  program (`run program ... keeping its output`), and says what git said when
  it fails. It passes `core.longpaths=true` on Windows, where a package's
  files can be deeper than 260 characters.
- **Finding a package's files.** A file used to be found from the program's
  folder, even when another file used it; now a file uses files from its own
  folder (from the parser's `folder`, as `within` is kept for names), so a
  package's `use "helpers.moth"` is its own. `use the package "json"` is
  `packages/json/json.moth`, from the program's folder wherever it's written,
  so a package that uses another finds it where `moth add` put it. Nothing in
  the repository used a file from a folder, so nothing that ran changes.
  Both parsers do this, and moth.moth's list of the files to read before a
  build (`cli_used_by`) finds them the same way. compiler.moth's `use_file`
  had kept the wrong list of files being read after a file used one, which
  only mattered now.
- **Tested.** Git repositories made by the tests: a package with a file of its
  own, added, run, updated, fetched again after `packages/` was deleted, and
  one that uses it brought along at its listed commit; every mistake; and
  `remove`, through moth.exe, on Windows and Linux. Files in folders and
  packages on the three engines, and compiler.moth held to moth.js.

## 61. VS Code

- **Why.** The playground colours code, finds problems as it's typed and tidies
  it, but most people write programs in an editor, and VS Code is the one most
  of them use.
- **[`editors/vscode`](editors/vscode).** The colours are a TextMate grammar:
  comments, text, numbers, `to name`, calls, `'s`, and the words the playground
  colours, the same list, which a test holds them to (`package` was added to
  both). Text's values are a begin/end rule inside text that includes the
  whole grammar again, so text inside a value inside text is coloured as the
  tokenizer reads it. The rest is `extension.js`: it runs `check()` from
  moth.js a quarter of a second after each change, the files a program uses
  read from beside it, or from the editor where one is open and not saved,
  and shows each problem on the word at its column, red for a mistake or a
  line sure to fail and yellow for the rest; a mistake in a used file goes on
  the line that uses it. `suggestedFix` is its Quick Fix, `format()` is
  Format Document, `to` lines are the outline (by their indents, so it works on
  code with a mistake in it) and where Go to Definition goes, and Run, Debug
  and Build start `moth` (or `moth.path`) on the file as a terminal's own
  process, so nothing is quoted for a shell.
- **The engine goes with it.** `make-vsix.mjs` packs the extension, with
  moth.js and the seven files it needs as `engine/`, beside a package.json that
  makes them modules, into a .vsix: a zip with a manifest and a list of
  content types, written by the script itself (deflated, every file dated
  1980, so the same files make the same bytes), so there's nothing to install
  to make it.
- **Tested.** The grammar through a TextMate tokenizer the tests have, enough
  of one for this grammar; the extension against a stand-in for VS Code's API;
  the .vsix unzipped and compared, file for file; `code --install-extension`
  with a profile of its own; and, with MOTH_VSCODE=1, VS Code 1.142 itself,
  running the extension in its extension host: the problems, the Quick Fix,
  Format Document, the outline and the commands.

## 62. Tasks: threads of a program's own

- **Why.** §52's tasks are other programs: they share nothing, and what they
  find comes back as text. A program that wants a long sum done while its
  window still answers, or several files read at once, needed its own
  functions to run alongside it.
- **What a program writes.** `set job to start count(10)` starts the call on a
  thread of its own and gives back a task at once, `(record with task 1)`;
  `wait for job` waits for it to end and gives what it returned, as often as
  it's asked. `start count(10)` on a line of its own starts one and keeps
  nothing. A task shares the program's names: what it sets, the program sees.
  `start` alone, or before anything but a call, is still a name, so a program
  that called something `start` still runs, and `start 5` is a mistake that
  says how to start a task. A mistake in a task ends the program, as one in
  the program does, its trail ending at the line that started it.
- **On the JavaScript engines** a task runs to its end when it's started, so
  a program says the same each time it runs, and the playground's step and
  rewind work as they did. `wait for` gives what it gave back.
- **In machine code, one turn at a time.** The runtime has one heap and one
  collector, so its threads take turns: one holds the turn, as Python's
  threads hold its global lock. A thread lets the turn go every 200,000 loop
  rounds and calls (a count taken down at each loop's end and each function's
  start), and whenever it waits: for a time, a line typed, a program it runs,
  a site, a window's next message, or a library's function. So a task works
  while the program waits, and the program while a task does; and as a thread
  only lets the turn go at a loop's end, a call or a wait, `add 1 to total` in
  three threads at once loses nothing.
- **On Windows** the turn is a semaphore that's at most 1; a task is
  CreateThread, its stack 256 MB reserved, as the program's own is; a thread
  finds its slot through thread-local storage (TlsAlloc). `wait for` waits on
  an event of the task's slot.
- **On Linux** the turn is a ticket lock: a thread takes a number and sleeps on
  a futex until it's served, so turns go in order. A task is a `clone` with a
  stack from mmap, or, in a program that uses a library, `pthread_create`,
  found with dlsym, so the C library has the thread's own state; a thread
  finds its slot through gs (arch_prctl). `wait for` waits on a futex of the
  slot.
- **More tasks than threads.** What a task gave is kept by its number, in a
  list among the runtime's own, so `wait for` gives it however long after.
  There are 255 slots, and one is free for another task once its task has
  ended and nothing waits for it; on Linux, once its thread has left its
  stack too, which the system says by clearing the thread's id (clone's
  CHILD_CLEARTID), as the next task in the slot has the same stack. A task
  started while every slot is in use is made there and then, by the thread
  that starts it, as the JavaScript engines make every task, so tasks that
  start tasks never wait for a slot that can't come free.
- **What a thread keeps.** Its slot: where its stack starts (for the collector
  and for a mistake's trail), the innermost `try`, the text being built, and,
  while it hasn't the turn, its stack pointer. Taking the turn puts these where
  the runtime has them, and letting it go saves them back. A thread that lets
  the turn go keeps a copy of every register on its stack, or, in a library's
  function, in its slot, as C may need the stack where it is; the collector
  looks through each other thread's stack, from there to where it starts.
- **What changes in a program that starts a task.** machine.moth makes it
  twice: once to find that it starts one, then with threads. The second time it
  keeps no name of the program's in a register through a loop, and takes
  nothing as known about one from line to line (§48), as another thread can
  set it in between. A program that starts no task has none of this, imports
  nothing more, and is the same bytes as before.
- **One at a time.** Reading a line typed, running a program (and on Linux
  reading a site, through curl), and on Windows WinHTTP's requests are each
  claimed by a thread until it's done, so two threads asking at once are
  answered one after the other.
- **C calling back.** A function C calls back on a task's thread takes the
  turn for that thread first, and lets it go before going back to C. A thread
  the program didn't make has no slot, and ends the program, with 70.
- **Tested.** On Windows and Linux: what tasks say, fail with and give back,
  against the JavaScript engine, with names shared, a thousand tasks one after
  another, two thousand started before one is waited for, tasks starting tasks
  past the slots there are, five threads making far more than they keep, and
  files read and written by tasks at once; a task counting while the program
  waits for a line typed half a second late, a task running a program, one
  sleeping 300 ms in a library's function while the program counts to 3
  million, `qsort` calling a task back, and a window's timer ticking while a
  task sums to 50 million; and, by hand at the time, every example and table
  program that starts no task made to the same bytes as before. A thousand
  tasks start and end in about a tenth of a second.
- **Not yet.** Two threads running Moth at the same moment, which needs a
  collector that can stop them all. (A lock a program can take, and asking
  whether a task has ended without waiting for it, came in §94.)

## 63. Functions put in line, and inputs in registers

- **Why.** A loop that called a function kept nothing in registers (§32), as
  the function could use them, and every call cost about 25 instructions: a
  helper as small as `return x * x`, called in a loop, made it 2.5 times as
  slow as the sum written out.
- **What's put in line.** A function made once at the top of the program, and
  called by its name, whose code is one `return` of a small value (24 pieces
  at most) of its inputs: numbers, text, yes, no and nothing written out, `+`,
  `-`, `*` and `/`, comparisons, `and`, `or` and `not`, `-x`, `length of`, a
  field and an item; or a few `if ... return x ... end` before such a `return`,
  or with an `else` that returns. A name in it must be one of its inputs, so it
  means the same wherever it's put. Not in a program built to be debugged,
  where every line of the function is a line to stop at.
- **The call's checks stay.** That the function has been made by now, its
  inputs worked out in order and each kept in the caller's frame, checked if
  the function says what they must be, and that there's room for one more
  call (§48's 100,000): each as the call made it, at the call. Then the
  function's code, each input read from where it's kept. A mistake in there
  shows the trail it would have if the call had been made: the code that
  writes the mistake notes which function it's in and where it was called
  from (`err_fake_fn`, `err_fake_site`), and rt_e_end, before it goes
  through the frames, makes one for that call, going back to a call's number
  as a real call does. A mistake caught by a `try` leaves nothing noted.
- **Everywhere code is looked at before it's written.** What a loop does
  (`scan_expr`), what kind of value something gives (`expr_kind`), the guess
  at what each function is given (§48), and whether a loop can run as whole
  numbers (§32) all see such a call as its code, each input the expression
  given for it, and see no call. So a loop with one keeps its variables in
  registers, and in a loop of whole numbers `add square(i) to total` is
  `i * i` in whole numbers, the call's checks going the ordinary way if
  they'd fail.
- **Inputs in registers.** A function only ever called by its name (never
  used as a value, started as a task, or called back by C), with one to four
  inputs that don't say what they must be, and that makes no functions, gets
  its inputs in xmm0 to xmm3: the last isn't pushed at all, and the others are
  popped into their registers just before the call. It keeps them in its frame
  as its first variables. Whether a function is only called by its name is
  guessed with the rest of §48's guess, and checked the same way as its code
  is written, the program written again if it was wrong.
- **A value stored and read straight back** isn't read again: a load of what
  the instruction just before stored, from the same place, is no load at all
  (or a move between registers). A label marked in between, where code could
  jump in, forgets it.
- **What it gave.** A loop calling `square(i)` 20 million times went from 74
  ms to 30; one calling a function of three inputs from a function's loop,
  from 142 ms to 24; one calling a function with early returns and another,
  from 77 ms to 50; fib(32), from 27 ms to 24.5, against C's 19 (each a whole
  program, started up and all).
- **Tested.** Programs written to break it, said, failed and exited on as the
  JavaScript engine does them, trails and all, on Windows and Linux: sums
  past 2^53 in loops of whole numbers, mistakes in a function put in line
  with and without a `try`, one called before it's made and at the most calls
  there can be, inputs that say what they must be and ones with no value yet,
  fields, items, lengths, comparisons and text, early returns, an input that
  hides a name of the program's, a function also used as a value, and the
  wrong number of inputs; one to five inputs in registers, worked out by
  calls; and every other program the tests have.
- **Not yet.** A function that calls another put in line in it, and a
  function's variables kept in registers through its calls.

## 64. Lists, text and records, where the code is

- **Why.** `item i of xs`, `set item i of xs to v` and `add x to xs` went to
  the runtime each time, which works out what kind of value it was given;
  joining two texts went through the builder, copying both twice and counting
  every character again; and `x of p` looked through the record's fields one
  by one, which for the compiler's records, of 30 fields and more, was much of
  its work.
- **Lists.** If it's a list and the number is a whole number from 1 to its
  length, the item is read or set right there; anything else goes to the
  runtime as before, which says what's wrong. `add x to xs` puts x at the
  list's end itself when there's room. `set item` finds the item again after
  the value is worked out, as working it out may have moved the list's items.
- **Text.** Two texts, or text and a whole number below 10^15, are joined
  without the builder: the second's bytes after the first's, in the first's
  block if it ends there and has room (§25), else in a new block with room to
  grow, and the characters, both counts added up. A number's digits come from
  multiplying by a tenth's reciprocal rather than dividing, `x as text` of a
  whole number writes its digits out the same way, and the builder copies
  short bytes eight at a time and counts characters eight bytes at a time (a
  byte that isn't a character's first is 10xxxxxx: its top bit and not the one
  below, added up across the eight by one multiplication). `join` puts each
  text in as it is, not as `say` would show it.
- **Records.** Each place the program reads or sets a field has 8 bytes of its
  own saying where among the record's fields it found it last time. If the
  record has a field there, and it's that one, it's read or set there and
  then; else the runtime looks for it, and notes where.
- **What it gave.** Adding 3 million items and reading them back, 61 ms to
  about 45; setting 5 million, 82 ms to 34; joining a text to a text a million
  times, 87 ms to about 60; adding to one 2 million times, 122 ms to 60; text
  joined to a number a million times, 113 ms to 63; `as text`, 95 ms to 60
  (each a whole program, started up and all). And moth.exe builds itself in
  9.2 seconds, from 10.9, as the compiler reads fields all the time. With
  §63, it's 4.6% bigger: 19,020,288 bytes.
- **Tested.** Items read, set and added, with every number that isn't one of
  a list's (0, a fraction, one past the end, text, nothing) and a value worked
  out that grows the list being set; text joined to text, to digits (0, -0,
  the most digits, past them, fractions) and to anything else, in place and
  not, with characters past one byte; joins of every kind of value; records of
  other shapes at the same place, fields added later, and every mistake; on
  Windows and Linux, against the JavaScript engine.

## 65. The Moth shell

- **Why.** Python's first lesson is typing `2 + 3` and seeing 5. moth.exe
  could only build files; the shell Moth had, on the Node.js command line, went
  with it in 1.5.
- **What it does.** `moth`, or `moth shell` with `--allow` flags for what its
  entries may do, reads Moth an entry at a time: a line, or a block once its
  `end` is typed (the compiler says when what's typed ended too soon: its
  mistake is at the end of the code), with `....>` while it waits for more,
  and two empty lines dropping what isn't finished. An entry that's a value
  (`x + 1`, `xs`, `p's name`) is said; a call to one of the functions made
  (`square(4)`) shows what it gives, unless that's nothing. `quit`, `exit` or
  the end of the input ends it.
- **Each entry is a program.** moth.exe has no interpreter in it, only the
  compiler, so each entry is built into a program, run and removed, as `moth
  run` does, in about 35 ms. The program is what the entries before it left,
  then the entry: each entry before is a file of its own, `[1]`, `[2]`..., which
  the program uses in order, holding that entry's `to` blocks and `use` lines
  as typed, and in place of each other statement, a line giving each name it
  first gave a value to the value it had after the last entry, then blank
  lines. So line numbers are the ones typed, a mistake in a function made
  earlier says which entry it's in (`[3]:2:14`, `called from [4], line 1`), and
  a function changes the names it would have if the entries were one program
  (a name it sets that wasn't made before it is its own, §27).
- **Values in between.** After the entry, the program saves every name's value
  to `.moth-shell-state` with `save`, which the next program loads, so the
  program may read and write that one file whatever the flags say. A value
  `save` can't keep (a function, bytes, a list that holds itself) is said to
  be lost, and is nothing in the next entry. An entry that ends with a mistake,
  or stops the program with a number other than 0, keeps nothing it set, nor
  the functions it made; one that stops it with 0 keeps its functions only.
- **Not as one program.** Two names holding the same list hold copies of it
  after the entry, as each value is saved by itself; a task started doesn't
  outlive its entry; a file used runs its own lines again in every entry; and
  Ctrl+C ends the shell with the program, as no Moth program can catch it.
- **Tested.** A session through moth.exe, on Windows and Linux, typed into its
  input: values shown, functions made and called, a function's own name kept
  apart from the program's, lists added to, a loop's names, a file used, a
  mistake in a function made earlier, with its trail, a function that can't be
  kept, text past one byte, a block dropped, `quit`, and no file left behind.

## 66. Inputs left out, functions with no name, lists built from lists

- **Why.** Next to Python, Moth had no default inputs, no lambdas, no list
  comprehensions, no slices and no `**`: each a line of Python that took a
  loop or a helper function in Moth.
- **Only the parsers.** Each is written in terms of what Moth already had, so
  the VM, the JIT, WebAssembly and machine code needed nothing new: moth.js
  and compiler.moth make the same tree, and every back end compiles it as it
  compiles the rest.
- **Inputs left out.** `to greet with name, greeting or "Hello"`. Once the
  whole program is read (files it uses too), each call by the function's name
  that gives fewer inputs gets the rest written in, each a copy, so a list
  given this way is a new one each call. A name made more than once: its last
  `to`. A call through a variable (`set f to greet`) isn't seen by name, so it
  gives every input. After `or` only values written out, as anything else
  would be worked out where the call is, not where the function is.
- **Functions with no name.** `function with x gives x * 2` is a `to` block
  put before the statement it's in, named `function on line 3` (then `(2)`,
  and so on), a name no program can write, and the value is that name: so it
  remembers the variables around it, as any function does, and a mistake in
  it says where it is. One inside another's value goes inside that one, where
  its inputs are.
- **Lists built from lists.** `list of x * 2 for each x in xs where x is
  greater than 1` makes three such functions: one for an item's value, one
  for whether to keep it, each with x as its own input, so x is nobody else's,
  and one that goes through the list, adding each kept value, which the
  statement calls with `xs`. `for each` on the next line is a loop, as it was.
- **Items from one to another, and powers.** `items 2 to 4 of xs` (a list,
  text or bytes) and `x to the power of n` are builtins, as `in order` is:
  items 3 to 2 are none, and past the end is the mistake `item` makes. Powers
  are whole ones, worked out by squaring, so `2 to the power of 10` is exactly
  1024; math.moth's `power(x, y)` takes any, through `exp` and `ln`, which it
  has now, with `log10`, `log2`, `tangent`, `arctangent`, `arcsine`,
  `arccosine`, `angle_of`, `ceiling`, `round`, `absolute`, `radians` and
  `degrees`, tested in math.test.moth.
- **compiler.moth's numbers.** Functions are numbered in the order they're
  written, once the program is read, as scope.js counts them (§27), since
  the ones a statement's values make are read before the statement but go in
  front of it; and on from the last program's, so a build that reads two
  (the debugger's and the program) has no two functions of one number.
- **Tested.** Each, and each mistake (a power that isn't whole, of 0 below 0,
  items of a number or past the end, an `or` that isn't a value written out,
  an input after one with `or` without, a list built with a mistake in an
  item, and where it says it is), on the three engines and in compiler.moth,
  in machine code on Windows and Linux, and in the randomly broken programs.

## 67. Rounding, remainders, and whole numbers of any size

- **Why.** Moth had no `//`, `%`, `round` or `floor` of its own: math.moth
  found a number's whole part a power of two at a time, and nothing gave a
  remainder. Python's whole numbers have no size limit; Moth's are exact to
  2^53.
- **Rounding.** `x rounded down`, `x rounded up` and `x rounded` come after
  the sum they round, as `in miles` does, so `total / count rounded` rounds
  the quotient. They round x as Moth shows it, to 15 digits, so `(0.1 * 30)
  rounded down` is 3, like `item (0.1 * 30)`; a half rounds away from 0, as a
  spreadsheet's does, and none gives -0. `rounded` followed by a bracket is
  still a call, so math.moth's `rounded(x)` works as it did; a variable called
  `rounded` after a value in `say` now rounds it.
- **Remainders.** `remainder of a divided by b` has b's sign, as Python's `%`
  and a spreadsheet's MOD do. Of two whole numbers it is exact: a 64-bit
  `idiv` below 2^53 and the x87's `fprem` above, as `is divisible by` works it
  out; of anything else it is 0 whenever `is divisible by` says so, and else
  a - b times a / b to 15 digits, rounded down. `remainder of r` is still a
  field, as the phrase needs `divided by`.
- **Machine code.** `roundsd` rounds; each routine first takes the number to
  15 digits with the routine `say` uses (§25), keeping its sign.
- **big.moth.** Whole numbers of any size, as text, so `say`, `is`, `save` and
  JSON need nothing new. Inside, a sign and parts of 7 digits each, the lowest
  first, so two parts multiplied, with what's carried, stay below 2^53, and
  each carry is a remainder, so none is rounded. Division is a part at a time
  by a one-part divisor, else a digit at a time, each the most multiples of
  the divisor that fit; quotients round down and remainders take the
  divisor's sign, as Python's do.
- **Tested.** Rounding every kind of number (halves both ways, 15-digit
  neighbours, whole numbers past 2^53, fractions, infinities) and remainders
  of whole numbers below and above 2^53, fractions and mixed signs, with each
  mistake, on the three engines, in compiler.moth, and in machine code on
  Windows and Linux, 600 random ones too; big.moth's own tests, and 800
  random sums against BigInt, on each.

## 68. A record's own functions

- **Why.** Python's classes give each kind of object its own methods, and a
  subclass its own versions of some. Moth had records and `rex's bark()`,
  which is `bark(rex)`: one function for every record.
- **What it does.** `rex's speak()`, in a program that makes nothing called
  `speak` (no function, input or variable, in any file it uses), calls the
  function rex's `speak` field holds, with rex first, and the rest after it.
  A record's functions are any functions: made with `to`, or `function with
  self gives ...`. So two records, made by two functions, answer the same
  call two ways; one made by calling another maker can set its own `speak`,
  keeping the old one in a variable to call from the new; and a record can
  be given one later with `set speak of rex to ...`.
- **Where a name is made, the function wins.** If anything is called
  `speak`, `rex's speak()` is `speak(rex)` as it always was, so no program
  that ran before means anything new. A field that isn't a function says so
  (`'sound' is text, not a function`); a record without the field, or a value
  that isn't a record, fails as a call to a function nobody made did, with
  the same "Did you mean", from every name the program makes.
- **Only the parsers.** Once the whole program is read, each such call is
  given a function of its own at the program's top, `speak of the record on
  line 3`, which takes the field in a `try`, failing as above if it can't,
  and calls it; so every engine and machine code run it as any function, and
  a mistake in it shows that function in its trail.
- **Tested.** Two kinds of record answering one call, a function with inputs
  given later, one replaced that calls what it replaced, one said on its own
  line, two in a row on what the first gave, a function of that name winning,
  and each mistake, caught and not, on the three engines, in compiler.moth,
  and in machine code on Windows and Linux.

## 69. Lists as sets

- **Why.** Python has sets: each value once, `in` that's quick, and `&`, `|`
  and `-`. Moth had `is in` and dictionaries, whose keys are once each.
- **What's new.** `xs without repeats`, after the sum before it as `rounded`
  is, keeps each item where it first is, by `is`, so lists and records count
  as the same when they hold the same, and `0.1 * 30` is a repeat of 3. It
  is a function of the program's, made as list building's are (§66), so
  nothing else changed. What's in both, in one only, or in either is list
  building with `is in`, which the README shows.
- **Not added.** A set as a value of its own: the dictionaries Moth has are
  one already, for text and numbers, and finding a list in a list by `is`
  can't be quicker than looking at each.
- **Tested.** Repeats of numbers to 15 digits, of letters in text, of lists
  and records, none at all, and what isn't a list, on the three engines, in
  compiler.moth and in machine code on Windows and Linux.

## 70. XML

- **Why.** Python reads XML with `xml.etree`; feeds, office files, SVG and
  much of what older services send are XML.
- **What it is.** tools/xml.moth, in Moth alone, so it works on every engine.
  An element is a record with kind "element", its name, its attributes in a
  dictionary, in the order written, and its children, in order: elements, and
  text as records with kind "text", so a program tells them apart by `kind`.
  Text next to text (across a comment, or a CDATA section) is one piece.
  `text_of`, `first_named`, `all_named` and `attribute` find things;
  `element` and `text_node` make them, and `written` writes XML back, with
  `&`, `<`, `>` (and `"` in a value) as entities, so writing and reading
  again gives the same records.
- **As XML says.** Line ends are `\n` alone; in an attribute's value a tab or
  a line end is a space; the five named entities and `&#...;` and `&#x...;`
  are the letters they stand for, past one byte too; the `<?xml?>` line, a
  `<!DOCTYPE>` (with a `[...]` of its own), comments and `<?...?>` are passed
  over. A DOCTYPE's entities aren't used, and namespaces are just names with
  a `:`.
- **Mistakes** are a `fail with` saying the line: a closing tag that doesn't
  match, one missing, an attribute twice or without quotes, an entity Moth
  doesn't know, anything after the element.
- **Tested.** Its own tests, on the three engines and in machine code; and
  800 random documents (attributes in either quote, entities, CDATA,
  comments, text past one byte, nesting), read the same as Python's
  ElementTree reads them, and written and read back the same.

## 71. gzip and zip

- **Why.** Python has `gzip`, `zlib` and `zipfile`; downloads, logs and
  office files come squeezed.
- **What it is.** tools/zip.moth, in Moth alone, so it works on every engine:
  `deflate` and `inflate` (RFC 1951), `gzip` and `gunzip` (RFC 1952, every
  member of a file, its name, comment and extra field passed over, its check
  and size checked), `zipped` and `unzipped` for archives, and `crc32`.
  Each takes text or bytes and gives bytes.
- **Reading** is zlib's puff.c, a bit at a time: stored blocks, the fixed
  code, and codes a block brings, each code taken from its lengths in the
  canonical order. Data that can't be DEFLATE is a mistake that says why;
  DEFLATE has no check of its own, so damage it can still read is caught by
  gzip's and zip's CRC.
- **Writing** finds each place's longest match in the 32768 bytes before it,
  from the last 32 places with the same 3 bytes, and, as zlib does, writes a
  byte on its own when the next place has a longer match. Each 16384 matches
  are a block, written the shortest of three ways: with the fixed code, with
  Huffman codes made for it (from how often each symbol comes, none longer
  than 15 bits, or 7 for the lengths' own code, halving the counts until
  none is), or as it is. Its gzip came out 4% smaller than zlib's default
  level, in all, on the test's samples.
- **Archives** are version 2.0 with names in UTF-8, each file squeezed unless
  that makes it bigger, at 1980-01-01 0:00 so the same files make the same
  bytes. Reading takes the list at the end, so a file with a data
  descriptor, extra fields or a comment reads too; one locked with a
  password, ZIP64 or a method other than DEFLATE says so.
- **Tested.** Its own tests, on the three engines and in machine code: what
  zlib made at every level (so stored, fixed and own-code blocks), round
  trips of empty, short, repeating, random and every-byte data, archives
  with a folder, an empty file and a name past one byte, and each mistake.
  And 46 random samples of four shapes, up to 60 KB: zlib reads Moth's gzip
  and Moth reads zlib's, crc32 agrees, and the machine code on Windows and
  Linux writes the same bytes as the JIT; Windows' tar and Python's zipfile
  read Moth's archive, and Moth reads one with data descriptors and a
  comment. 400 gzip files damaged at random each stop with a mistake, or,
  where the damage is somewhere gzip doesn't look, read right: none gives
  wrong bytes.

## 72. Sockets

- **Why.** Python's `socket` is how a program talks to any other over a
  network: its own protocols, a database's, a game's. Moth had `read` and
  `send` for the web, and server.moth for answering it.
- **What it is.** tools/sockets.moth, on the system's own sockets through
  `use the library` (ws2_32 on Windows, the C library on Linux), so a
  program `moth build` makes, with `--allow-libraries`, can use it.
  Connections out (`connect`) and in (`listen`, `listen_everywhere`,
  `accept`), each a record with its handle and `peer`, the host and port at
  the other end; `send` sends all it's given; `receive` gives what has come,
  up to so many bytes, and no bytes once the other end has closed;
  `receive_line` a line, without its `\n` or `\r\n`; `receive_all` until the
  end; `finish_sending` (shutdown) ends the other end's `receive_all` while
  this end can still receive; `wait_at_most` makes a receive that waits
  longer fail. UDP: `open_messages`, `send_message`, `receive_message`.
- **Names** are looked up with getaddrinfo, IPv4 only, so the hosts file and
  DNS both work. What it gives is a list C made: its first entry is copied
  into the program's bytes with memcpy, and the address taken from where
  each system keeps it (Linux puts ai_addr before ai_canonname, Windows
  after), then the list is freed.
- **With tasks.** A library's function lets the turn go while it waits
  (§62), so a task can wait in `receive` while the program goes on, and a
  server can give each connection a task of its own.
- **Not added then.** TLS for sockets, IPv6, and `select`: §82 and §83.
- **Tested.** In machine code on Windows and Linux: a task of the program's
  own connecting to it by name, lines with `\r\n` and without an end, a reply
  after `finish_sending`, a message and where it came from, waiting too long
  for one, a port with nothing on it, a name no DNS has, a port past 65535,
  and 300 KB through `listen_everywhere`, read back the same.

## 73. HTTPS for server.moth

- **Why.** A server a browser reaches over the internet needs TLS; Python's
  `http.server` gets it from the `ssl` module, which is OpenSSL.
- **What it does.** `serve_secure(port, answer, certificate, key)` (and
  `serve_secure_everywhere`) answers as `serve` does, after a TLS handshake
  with each connection, through OpenSSL 3 by `use the library`: the
  certificate (and its chain) and key from PEM files, then `SSL_accept`,
  `SSL_read` and `SSL_write` where `recv` and `send` were. A connection that
  can't agree on TLS (one that doesn't trust the certificate) is said to the
  error output, and the server goes on. A certificate or key it can't use,
  or no OpenSSL at all, is a mistake that says which.
- **Where OpenSSL is.** Linux has libssl.so.3. Windows has none of its own:
  an MSVC build's libssl-3.dll and libcrypto-3.dll (Python's, in its DLLs
  folder) or libssl-3-x64.dll and libcrypto-3-x64.dll (the Win64 OpenSSL
  installer's) go beside the program, or Git for Windows' own, from its
  mingw64 folder: those, built with MinGW, once failed in a program of
  Moth's (no randomness to seed them, then a crash), until a library's own
  libraries were found in System32 too (below; §81).
- **A library beside the program** now finds what it needs from System32
  too: the second place a name is looked for was LoadLibraryExW with
  LOAD_LIBRARY_SEARCH_APPLICATION_DIR, which looks for the library's own
  libraries in the program's folder alone, so Python's libssl-3.dll couldn't
  find VCRUNTIME140.dll; it is LOAD_LIBRARY_SEARCH_DEFAULT_DIRS now.
- **Bodies in chunks.** HTTP/1.1 lets a body come as chunks, each its length
  in hex, then its bytes, until one of none, with trailers after it, and
  servers must read it: Node sends a body it's given in pieces that way.
  server.moth does now, over HTTP and HTTPS; chunks it can't read are 400.
- **Not added.** TLS for sockets.moth's own connections, and HTTP/2.
- **Tested.** In machine code on Windows and Linux, with a certificate the
  test makes: a page, a body in chunks and one with a length, a page that
  isn't there, a client that doesn't trust the certificate, and a
  certificate and a key it can't use.

## 74. The standard library, everywhere

- **Why.** Python's `import json` works in any folder. Moth's libraries were
  files in tools/, so a program used one only with a copy beside it.
- **What it does.** moth (the command, moth.moth) carries math.moth and the
  libraries in tools/ (not their tests or the example programs): when a file
  a program uses isn't beside the file that uses it, and has a standard
  library's name, moth uses its own copy, and so do the files that copy
  uses. A file beside the program comes first, as Python's own modules shadow
  its library's.
- **stdlib.moth** holds them, each file's text as a Moth text in a function
  that gives it by name, and moth.moth uses it as it uses machine.moth. It is
  made by make-stdlib.mjs, so moth still builds itself from its source
  alone, into the same bytes. Not `--include`: a file built into a program
  is found before the disk, so a program's own math.moth would lose to moth's,
  and a folder built in would take whatever else is in it.
- **Tested.** stdlib.moth is what make-stdlib.mjs makes of the files as they
  are, and holds each one exactly; and through moth.exe, in a folder with
  nothing else, a program that uses json.moth, math.moth and big.moth, and
  big.moth's own tests, and a math.moth beside the program used instead.

## 75. Every core at once

- **Why.** A task (§62) is a thread of the program's own, and the threads
  take turns, as Python's do under its lock, so a long sum is no quicker in
  four of them than in one. Python's answer is multiprocessing: copies of
  the program, each a process with a core to itself.
- **What it is.** tools/cores.moth, on tasks.moth's `start_self`, which
  starts the same program again with other arguments. `each_at_once(work,
  items)` shares the items out into as many parts as there are cores
  (GetActiveProcessorCount on Windows, sysconf on Linux), or
  `each_at_once_on(n, work, items)` into n; saves each part to a file;
  starts a copy for each, with the work's name, `<function work>`, and its
  files as arguments; waits for them all; and gives back what each gave, in
  the items' order. In a copy, `work_here(work)` finds its part, does it,
  saves what it gave, and stops the copy; a `work_here` for any other
  function does nothing, so a program can have several.
- **What it asks of a program.** Each copy runs the program from the top,
  so the `work_here` lines go after the functions they name and before
  anything that should run once, as Python wants `if __name__ ==
  "__main__"`; and what goes between them is what `save` keeps.
- **Mistakes.** A part that fails ends its copy; each_at_once waits for the
  rest, takes their files away, and fails with what the copy said, its line
  and trail. Where processes can't be started (the JavaScript engines), it
  does the items one after another, in the program, giving the same.
- **What it gave.** Counting the primes below 3 to 4.1 million, 12 items:
  24.8 s in one part, 5.1 s in a part a core, on a computer with 12.
- **Tested.** In machine code on Windows and Linux: one part and a part a
  core give the same, more parts than items, no items, and a part that fails
  in its copy; and nothing left behind.

## 76. A profiler

- **Why.** Python has cProfile: which functions a slow program's time goes
  to. Moth had the clock, and guessing.
- **What it does.** `moth profile file.moth args` runs the program as `moth
  run` does, then says on the error output how long it took and how many
  lines ran; each function's own time (its lines', not what it calls), as a
  share of the whole, and how often it was called; and the 15 lines that
  took longest, with how often each ran.
- **How.** It builds the program as `moth debug` does (§59), with
  moth-profiler.moth in the debugger's place: before each line, `wants`
  counts it and gives the time since the line before to that line and its
  function, and never stops; a line one call deeper than the one before
  starts a call. The debug build now calls the debugger's `finish` when the
  program ends or stops itself, which for the profiler says what it found
  (and for the debugger does nothing). The profiler is in the standard
  library (§74), so moth carries it and builds itself as it did.
- **Time** comes from `the clock`, which moves a millisecond at a time, each
  call about 40 ns: so each millisecond goes to the line that was running
  when it passed, which over a run worth profiling is where the time is, and
  counts are exact. A program profiled runs several times slower.
- **Not yet.** A program that ends with a mistake says nothing (the runtime
  has no Moth code to call there); nor does an app, whose handlers run after
  its last line.
- **Tested.** Through moth.exe: a program with a slow function and a quick
  one, its output and arguments as moth run gives them, every line's count,
  each function's calls, the slowest line first, a program that stops
  itself, and nothing left behind.

## 77. Notebooks

- **Why.** Jupyter is how much of Python is written: code in pieces, with
  words between them and what each piece said beneath it, kept in one file.
- **What it does.** `moth notebook notes.md` runs each ```moth block of a
  Markdown file in turn, as the shell runs entries (§65), so a block has what
  the blocks before it made, and writes what it said, its output and then
  its mistakes, beneath it in an ```output block, in place of the one there
  was; everything else in the file stays as it is. A block whose last line
  is a value shows it, as a cell's does. A mistake says the block and line
  (`block 3:1:7: can't divide by zero`), and, as in the shell, a block that
  fails keeps nothing it made. moth then says how many blocks ran and how
  many had a mistake, and ends with 1 if any did.
- **Plain Markdown.** The file stays one any editor, GitHub or a site shows
  as it is, its outputs as code blocks, and running it again gives the same
  file when the code does the same.
- **The shell, fixed.** A line whose value makes functions of its own (a
  list built from a list, a function with no name) gives them the line's
  number, and the shell kept every `to` block's lines for the entries after,
  so the whole line ran again in each. It keeps only the program's own.
- **Tested.** Through moth.exe: a notebook with a value, a function, a block
  that ends in a value, an old output to replace, a mistake, and a block
  after it, run twice to the same file, with nothing left behind; and the
  shell running a list built from a list once.

## 78. A package index

- **Why.** Python has PyPI: `pip install requests` finds a package by its
  name. Moth's packages (§60) are Git repositories, fetched by where they
  are.
- **What it is.** An index is a JSON file: each package's name, its
  repository as `moth add` takes it, and a line about it. `moth search
  [words]` lists its packages, or those with every word in their name or
  line, in no case; `moth add greeter` takes the index's greeter. A name
  alone (no folder, address or site, and no folder of that name here) is the
  index's; anything else is as it was. `--index` gives another, an address
  or a file.
- **Where it is.** By default
  raw.githubusercontent.com/samyyy2423/moth-packages/main/index.json, read
  with curl, which Windows 10 and later and Linux have, so moth needs no new
  permission: a package is added there by a pull request to that
  repository. Until it's made, the default address answers 404, which `moth
  search` says.
- **Tested.** Through moth.exe, with an index in a file: every package, words
  in any case, none, a package added by its name and used, a name the index
  hasn't, an index that isn't there, and one that isn't JSON.

## 79. Programs as web pages

- **Why.** A program anyone can run with nothing to install: a link, or a
  file sent. The playground runs Moth in a browser already; moth.exe made
  only programs for Windows and Linux.
- **What it does.** `moth build --web app.moth` writes app.html: the
  playground's page with Moth's engine in it, in app mode, holding the
  program and every file it uses (beside it, or from the standard library,
  §74), which runs it as soon as it opens and shows only what it says and
  draws, its buttons, text boxes and questions, taking keys and clicks as
  the playground does. It works from the file itself or from any site, with
  nothing else beside it. A program with a mistake in reading it says so,
  and makes no page.
- **One file.** Each of the engine's modules is in the page as text, and
  made a module from a blob: URL the first time it's imported, its own
  imports pointing at the others', so moth.js, vm.js and the rest, and the
  worker a run goes in, are as they are here; the page's own imports wait
  for them. The program goes in as JSON, with every `</` made `<\/`, so no
  text of its ends the page's script.
- **webpage.moth** holds the page, made by make-web.mjs from index.html and
  the modules, as stdlib.moth is made, so moth builds itself as it did; a
  test says when it's behind them. About 520 KB a page.
- **Tested.** The page's loader, run as a browser runs it, makes modules
  that find each other and run a program as moth.js does, with each
  module's text exactly its file's; through moth.exe, a page with a file of
  the standard library's in it, a `</script>` in the program, and a program
  with a mistake; and in a browser, a drawing, a question answered, and
  Snake, with its keys and timer.

## 80. A text a letter at a time

- **Why.** moth building itself went from 10 seconds to almost six minutes
  once it held webpage.moth, whose page is one line of half a million
  letters: moth.moth looks through each line with `item k of line`, and
  finding letter k of a text with letters past one byte meant counting from
  its start, so going through a line that way took its length squared.
  `moth tidy` did the same. Any program going through a long text by `item`
  did.
- **In machine code**, a text whose letters are a byte each goes straight to
  the letter, as it should have; and the routines that find a letter
  (`item`, and `items ... of`) remember the last one they found: where the
  text's bytes are, the letter's number and its byte. For the same bytes
  and that letter or one further, they count on from there. The collector
  makes them forget, since a text's bytes, once it's gone, can be another's;
  a view of fewer bytes than the remembered letter's counts from the start.
- **In JavaScript**, the engines turned the text into its letters for every
  `item`, `length of` and `items ... of`; they keep the last text's letters
  now.
- **What it gave.** moth builds itself in 10 seconds again, into the same
  bytes; `moth tidy --check` of the biggest files takes 3; 20,000 letters
  one at a time take 15 ms on the JIT.
- **Tested.** A text with letters of one to four bytes, every letter in
  turn, then out of order; views of its bytes; and 3,000 lookups at random
  across six texts and views, with the collector running between them, the
  same on the three engines and in machine code on Windows and Linux.


## 81. The profiler's last word, however a program ends

- **Why.** `moth profile` (§76) said nothing when a program ended with a
  mistake, and for an app it spoke too soon: its report was a call put after
  the program's last line, so a mistake never reached it, and an app, whose
  handlers run after its last line, had its report before any of them ran.
- **What it does now.** The runtime calls the debugger's `finish`, once,
  when the program ends however it does: after its last line and any window
  it left open, at `stop the program`, after a mistake's report, and when
  the pad it asked with is closed. It's called as a handler is, the first
  call in progress, so a mistake in it ends the program with no second last
  word. The debugger (moth debug, §59) has nothing to say then.
- **Waiting.** The runtime also calls the debugger's `waits` before an app's
  window loop and after each handler. The profiler gives the time from
  there to the next line to a row of its own, "(waiting for events)",
  instead of the line before, and the next line starts a call, so a
  handler run twice shows two calls.
- **Not yet.** Calls are counted by depth: when tasks (§62) take turns, a
  task's first line one call deep after another task's isn't counted as a
  call of its own.
- **Also.** server.moth's HTTPS test runs with Git's OpenSSL too, built
  with MinGW, when it's there. It was thought not to work in a Moth program
  ("entropy source strength too weak", then a crash), but built again with
  each commit's compiler, the same program fails only before §73's change
  to where a library's own libraries are looked for: a program built before
  it was what failed.
- **Tested.** Through moth.exe: a mistake, then the profile up to it; an
  app driven by two keys, with its handler's two calls and lines and the
  wait; on Windows and Linux.

## 82. Secure connections

- **Why.** Python's `ssl` wraps a socket in TLS: HTTPS by hand, mail
  (STARTTLS), databases, anything on the internet that isn't plain. Moth's
  sockets (§72) were plain, and only server.moth spoke TLS (§73).
- **What it does.** `connect_secure(host, port)` connects, then `secure`s
  the connection; `secure(connection, host)` makes one secure after it
  began, as STARTTLS does; `secure_as_server(connection, certificate, key)`
  is the other end, for a connection `accept` took. After that `send`,
  `receive` and the rest go through TLS, `finish_sending` sends TLS's last
  word, and `close` ends it. All through OpenSSL 3 by `use the library`,
  found where server.moth finds it.
- **What's checked.** The other end's certificate, against those the
  system trusts, and that it's for the host asked for, a name (also sent
  with SNI, for a server with many) or an address (SSL_set1_host takes
  either). Linux's are OpenSSL's default places; on Windows, OpenSSL has
  none of its own, so the certificates in Windows' ROOT store are read with
  crypt32 (each one's DER bytes, through d2i_X509) into OpenSSL's store.
  `trust(file)` adds a PEM file's, as for a certificate of one's own. A
  failure says why, as OpenSSL does: "self-signed certificate", "hostname
  mismatch".
- **The context** is made once, at the first secure connection (or
  `trust`), so the system's certificates are read once.
- **C's nothing.** A library function giving a pointer of 0 gives
  `nothing`, not 0: the loop through Windows' certificates waited for a 0
  that never came, and read from address 0.
- **Tested.** In machine code, with the HTTPS test's certificate and
  OpenSSL (on Windows, Python's and Git's): a task of the program's
  connecting to it, not trusting the certificate, then trusting it, by name
  and by address; a connection made secure after a line in the clear; one
  for the wrong name; and each mistake. By hand, example.com, on Windows
  and Linux.

## 83. IPv6, many at once, and addresses raced

- **Why.** Python's `socket` takes IPv6 addresses and names that have them,
  and `select` waits on many sockets at once, so one thread can serve many.
- **IPv6.** A name's addresses come from getaddrinfo for both families now,
  each as the sockaddr it gave (so an address's scope comes too), and an
  address written out, as "::1", is read by it with AI_NUMERICHOST.
  `listen_on(host, port)` listens on any address: "::1", or "::", which
  takes IPv4 too (IPV6_V6ONLY off, as Linux has it already and Windows
  doesn't). A peer's IPv6 address is written as RFC 5952 has it, with an
  IPv4 one mapped into it as `::ffff:127.0.0.1`. `open_messages_on` is UDP's.
- **Raced.** On Windows "localhost" is ::1, then 127.0.0.1, and a refused
  connection on ::1 takes two seconds, so connecting to a server listening
  on 127.0.0.1 alone took two seconds longer. A host with more than one
  address is tried as RFC 8305 has it now: each address a quarter of a
  second after the one before, without waiting for those to give up, the
  first connected kept and the rest closed. Each try is a socket that
  doesn't wait (FIONBIO), polled for being writable; it's connected if it
  has another end (getpeername), and waits again once it's kept.
- **ready(sockets, milliseconds)** gives those of a list of listeners,
  connections and sockets for messages that have something to take now, in
  the order given: through WSAPoll on Windows and poll on Linux, whose
  tables differ (an 8-byte SOCKET first on Windows). A secure connection
  whose bytes OpenSSL has read already is ready without asking.
- **Tested.** In machine code on Windows and Linux: a connection over ::1,
  one in IPv4 to "::", `ready` with nothing, with a connection waiting on
  the second of two listeners, bytes to receive, and an end; and
  "localhost" found within a second and a half.

## 84. Email

- **Why.** Python sends mail with `smtplib` and writes it with `email`: a
  report, an alert, a password reset. Moth had no way to.
- **What it is.** tools/email.moth, in Moth over sockets.moth (§82), in the
  standard library. `message(sender, recipients, subject, text)` is a
  record whose cc, bcc, reply_to, html, attachments and headers can be set;
  `attach(m, file)` and `attach_bytes(m, name, data, type)` add files;
  `server(host, port)` is a record of how to reach one, `log_in` adds a
  user and password, and `send(server, m)` sends it. `message_text(m)` is
  the message as it's sent.
- **The message.** Headers, then the body, in MIME: text alone; text and
  HTML as multipart/alternative; with files, multipart/mixed around them.
  Text in plain ASCII lines goes as it is; any other, as its UTF-8 in
  base64, so every byte arrives. Headers that aren't ASCII are RFC 2047's
  encoded words, of whole letters, a line each; a name with marks a header
  gives a meaning to goes in quotes; a file's name that isn't ASCII is RFC
  2231's `filename*`. Date is the time in UTC, from the C library's clock
  (`_time64` on Windows, `time` on Linux); Message-ID and each boundary are
  part of a SHA-256 (hash.moth) of the time, a count and a random number. A
  line end in an address, subject or header is a mistake, so none can add
  a header of its own (a Bcc, say). Bcc's addresses are sent to and never
  written.
- **SMTP.** The server's 220; EHLO, and what it offers; STARTTLS, then
  `secure` and EHLO again, for "starttls" (the default but on 465, which is
  "tls", secure from the start; "none" sends in the clear), and a mistake
  if it isn't offered; AUTH PLAIN, or LOGIN, if logged in; MAIL FROM, RCPT
  TO for each address, DATA, the message with a dot before each line that
  starts with one, and a dot alone; QUIT. An answer it doesn't want fails
  with what the server said, but not what was sent to log in.
- **base64** both ways: `base64_of` and `bytes_of_base64`.
- **Tested.** In machine code, against a mail server of the test's own in a
  task: after STARTTLS, logged in with PLAIN, to, cc and bcc, a subject over
  two encoded words, a name in quotes, a line that starts with a dot, HTML
  and three files; secure from the start, logged in with LOGIN; a password
  it won't take; a server with no STARTTLS; and messages it can't write.
  Python's email module reads the message back with no defects, each part
  and file as it was. On Windows (with Python's and Git's OpenSSL) and
  Linux.


## 85. A task's thread, gone back to its own start

- **What went wrong.** On Linux, a program that uses libraries starts each
  task's thread with pthread_create (so the C library has its own for that
  thread), and the thread goes back to where pthread began it when the
  task is done. Where that is was kept in the task's slot, and read after
  the task had said it was done and let go of the turn. By then the slot
  could be the next task's, and on one core it was: the thread went back on
  the next task's stack, and the program crashed, or the C library said
  "free(): invalid pointer". Secure connections' test (§82), which starts a
  task for each connection, did it on every run on one core.
- **Now** the thread takes where it goes back to onto its own stack before
  it says it's done. Windows' threads end with ExitThread, which needs
  nothing of the slot, and a thread made with clone waits for the last one
  to have gone, so neither did.
- **Tested.** The secure connections' test runs on one core too, with
  taskset, where Linux has it.

## 86. Hashes, base64 and secrets

- **Why.** Python's `hashlib`, `hmac`, `base64` and `secrets`: checking a
  download, signing a request to an API, a token in an address, a password
  kept safely. hash.moth had SHA-256 alone, base64 was inside email.moth, and
  `random number` is made to repeat when a program asks it to.
- **hash.moth** has SHA-224 (SHA-256 from other starting words), SHA-512 and
  SHA-384, SHA-1 and MD5, each by its own name or through `digest(name,
  data)`; `hmac(name, key, data)` (RFC 2104); `pbkdf2(name, password, salt,
  rounds, size)` (RFC 8018); and `hex_of` and `bytes_of_hex`. All in Moth, so
  on every engine. SHA-512's words are 64 bits, past what a number holds
  exactly, so each is two halves of 32 bits, every sum carried from the low
  half to the high; its constants were made from their definition (the cube
  and square roots of the first primes) and checked against FIPS 180-4's.
- **base64.moth** writes base64, its URL-safe kind, and base32 (RFC 4648),
  and reads them back passing over what isn't their alphabet, as Python
  does. email.moth uses it.
- **secrets.moth** asks the system: BCryptGenRandom on Windows, getrandom on
  Linux, through `use the library`. `random_bytes(n)`, `token_hex`,
  `token_url`, `below(n)` (each number as likely: bytes drawn again when
  they'd favour the smallest), `choice`, `shuffled` and `same_secret`, which
  compares two secrets taking as long however much of them is the same.
- **Tested.** Every hash, HMAC and PBKDF2 against Node's crypto, on texts and
  bytes of every length around a block's edges, on the three engines and in
  machine code on Windows and Linux; base64 and base32 against RFC 4648's
  and Node's; secrets on Windows and Linux.

## 87. Asking web servers: http.moth

- **Why.** `read` and `send` ask sites through the system (WinHTTP, curl),
  and only `read` and POST: no PUT, PATCH or DELETE, and a redirect isn't
  followed. Python's urllib.request does any method.
- **What it is.** tools/http.moth, in Moth over sockets.moth (§82), in the
  standard library. `request(method, url, body, headers)` and `head`, `get`,
  `post`, `put`, `patch`, `delete`; a body is text, bytes, or a record, list
  or dictionary sent as JSON; the answer is a record of status, reason,
  headers (each name in small letters), body, text and url. A 404 is an
  answer like any other: `check` makes one a mistake; `get_json` reads JSON.
- **What it does on the way.** Connection: close, so the answer ends when
  the connection does; Accept-Encoding: gzip, undone with zip.moth; a body in
  chunks put together; redirects followed up to 10, as browsers do: a 303,
  or a 301 or 302 to a POST, goes on as a GET with no body; a 307 or 308
  keeps both; Authorization isn't sent on to another host. A header with a
  line end in it is a mistake. `encoded`, `decoded` and `form_of` write and
  read what goes in an address or a form.
- **Where.** HTTPS uses OpenSSL as sockets.moth does, so on Windows its DLLs
  go beside the program; `read` and `send` need nothing there.
- **Tested.** In machine code on Windows and Linux, asking server.moth in a
  task of the program's: each method, a header of its own, JSON both ways,
  bytes, each redirect, one to another host, gzip, a 404, a loop of
  redirects, chunks, and each mistake. By hand, example.com over HTTP and
  HTTPS.

## 88. WebSockets

- **Why.** A page that's told things as they happen (a chat, a game, a
  dashboard) talks to its server over a WebSocket; Python has the websockets
  package. Moth's server.moth answers one request at a time and closes.
- **What it is.** tools/websocket.moth, over sockets.moth, both ends.
  `connect(url)` asks for one (ws:// or wss://) with a key of 16 random bytes
  (secrets.moth) and checks the server's answer: base64 of the SHA-1 of the
  key and RFC 6455's own text (hash.moth, base64.moth). `accept(listener)`
  answers such a request, and says 400 to any other. Each connection keeps
  the path and headers it was asked with.
- **Messages.** `send` sends text as text and bytes as bytes, a frame each,
  with a 7, 16 or 64-bit length; a client's are masked with 4 random bytes,
  as RFC 6455 says. `receive` gives the next message, putting pieces
  together, answering a ping with a pong, and passing over pongs; a close
  frame is answered and gives (record with kind "close", code, reason).
  `close` sends one and waits up to 2 seconds for the answer. A message is
  up to 16 MB.
- **Tested.** In machine code on Windows and Linux: an echo server in a task
  and the program connecting to it, with text, a ping, 70,000 bytes, 300
  letters, and a close; and Node's own WebSocket client, as a browser's,
  asking a server of Moth's.

## 89. Reading mail

- **Why.** Sending is half of Python's mail: `email` reads messages, and
  `poplib` and `imaplib` fetch them from a mailbox.
- **read_message(raw)** reads MIME, as text or bytes: headers (lines folded
  back into one, each name in small letters, RFC 2047's encoded words
  decoded, in B and Q, the space between two of them dropped), then the
  body. A multipart body is split at its boundary, part by part, inside each
  other; base64 and quoted-printable are undone; UTF-8 and Latin-1 (with
  ASCII and Windows-1252 taken as it) become text, with plain line ends. The
  first plain text and the first HTML that aren't files are the message's
  text and html; every other part is a file, its name from
  Content-Disposition (RFC 2231's `filename*` too) or Content-Type. Address
  headers are split at commas outside quotes and < >.
- **POP3.** `pop_open` (port 995 secure from the start, 110 after STLS),
  USER and PASS; `pop_count` (STAT), `pop_get` (RETR, its dots taken off),
  `pop_delete` (DELE), `pop_close` (QUIT).
- **IMAP.** `imap_open` (993, or 143 after STARTTLS), LOGIN in IMAP's
  quotes; `imap_folders` (LIST), `imap_select`, `imap_search` and `imap_get`
  by UID, the message fetched with BODY.PEEK[] so it isn't marked seen,
  `imap_mark` (STORE +FLAGS), `imap_close`. Each command has a tag of its own;
  an answer that carries bytes ({n}, then n bytes) is read exactly.
- **Tested.** In machine code on Windows and Linux: a message email.moth
  made, read back as it was; one another program wrote, in
  quoted-printable and Latin-1, with Q words and folded headers; and POP3
  and IMAP servers of the test's own, in tasks, with what each was told.

## 90. TOML, command lines and logging

- **Why.** Python reads settings with `tomllib`, its command line with
  `argparse`, and says what happened with `logging`; Moth had none of them.
- **toml.moth** reads TOML 1.0 into dictionaries and lists: bare, quoted and
  dotted keys; [tables] and [[arrays of tables]]; basic strings with every
  escape, literal strings, and both multiline kinds (a line end after the
  opening dropped, a \ at a line's end joining it to the next); whole
  numbers in hex, octal and binary, with _ between digits; decimals with
  exponents, read as their digits times a power of 10, so rounded once
  (`number of` doesn't take an exponent); true and false; arrays over many
  lines; inline tables. Dates and times stay text, as written. inf and nan
  are mistakes, as Moth's numbers have neither. `toml_of` writes a
  dictionary back: its plain values, its tables, then its arrays of
  tables. A mistake says which line.
- **options.moth** reads `arguments`: `option` (--name value, -n value,
  --name=value; a number if its default is), `flag`, `positional`, and
  `rest`; `--` ends the options; a negative number is a name, not an
  option. `--help` says the usage, the program's description and each
  name's and option's help, and stops the program; a mistake says the usage
  and why on the error output and stops it with 2, as argparse does.
  `parse_or_fail` fails instead, for a `try`.
- **log.moth** writes a line for each thing, with the date and time, its
  level (debug, info, warning, error, critical), a name if one is set, and
  the message, in a format of the program's own (%time%, %level%, %name%,
  %message%, as `{` starts a value in Moth's text), for those at the level
  set or above, to the error output or added to the end of a file.
- **system.moth's append_to_file** adds to the end of a file, making it if
  it isn't there: CreateFileW with FILE_APPEND_DATA on Windows, open with
  O_APPEND on Linux.
- **Tested.** TOML against Python's tomllib on a file with each of its
  kinds, and toml.test.moth and options.test.moth, on the three engines and
  in machine code; logging and adding to a file in machine code on Windows
  and Linux.

## 91. Collections, lists, statistics and time zones

- **Why.** Python's `collections`, `heapq`, `bisect`, `itertools`,
  `functools`, `statistics` and `zoneinfo`: each saves a program writing the
  same loops again, and the last one can't be written without the world's
  zone data.
- **collections.moth.** `counted` and `most_common` (most first, and those
  counted the same in the order they came: sorted by the count below 0,
  as Moth's sort keeps order); `grouped` by a function; a queue whose
  things are in a dictionary by place, from `first` to `last`, so both ends
  are quick, as Moth's lists can't be shortened at their end (`remove` takes
  a key from a dictionary); a heap in a list, with its own count, as a list
  only grows; and `where_sorted`, `where_sorted_first` and `insert_sorted`.
- **lists.moth.** chunks, windows, paired, numbered, flattened, product,
  permutations, combinations, running totals, total, folded, mapped,
  kept_by, dropped_by, split_by, taken_while, dropped_while, every_one,
  some_one, sorted_by (by a key, those the same kept in order),
  smallest_by, largest_by and repeated. A list given before another input
  goes in brackets, as `list of` takes what comes after it.
- **stats.moth.** mean (summed with Kahan's way), median and its low and
  high, mode and modes, variance and standard deviation of a sample and of
  a population, quantiles (Python's "exclusive" way), covariance,
  correlation, a straight line by least squares, and the geometric and
  harmonic means, with math.moth's square root, logs and powers.
- **zones.moth.** A moment is seconds since 1970 in UTC. On Windows, ICU's
  calendar in icu.dll (Windows 10 1903 and later): the zone's name checked,
  then its offset and summer time's at that moment. On Linux, the zone's
  zoneinfo file (TZif): its changes, the offset before the first, and the
  POSIX TZ rule after the last (EST5EDT,M3.2.0,M11.1.0), which says when
  summer time starts and ends in years past the file's, north or south of
  the equator. A negative 64-bit moment is read from its bytes flipped, so
  it's exact. `moment_of` a time in a zone tries the offsets on either side,
  as Python's zoneinfo does: of a time that's there twice, the first; of
  one that's skipped, as if the clocks hadn't changed yet. `local_zone` is
  ICU's default on Windows, and TZ or where /etc/localtime points on Linux.
- **Tested.** collections, lists and stats with their own tests on the three
  engines and in machine code; zones against Node's own (ICU's), in nine
  zones at nine moments, on Windows and Linux.

## 92. More of C: small whole numbers, structures by value, any thread

- **Why.** Python's ctypes has every C type, passes structures by value, and
  lets C call back on any thread; Moth's library blocks had whole numbers of
  32 and 64 bits, structures only by where they are, and callbacks only on
  the program's own threads.
- **Whole numbers.** `a byte`, `a signed byte`, `a short whole number`, `an
  unsigned short whole number`, `an unsigned whole number` and `an unsigned
  long whole number`, from one table (machine.moth's c_wholes): as inputs,
  checked from their least to their most; as what a function gives, made
  from their low bytes with or without their sign (an unsigned long from
  2^63 up as half of it, doubled); as fields, as many bytes as they have, on
  their own boundary, as C lays them out; and as a callback's inputs and
  what it gives. Both parsers know the same names.
- **By value.** `a point by value`, for an input or what a function gives.
  On Windows a structure of 1, 2, 4 or 8 bytes goes in its place's register
  (or stack slot), and any other as where a copy of it is; one given back of
  any other size comes through memory the program gives as a first input.
  On Linux each 8 bytes of one up to 16 is sorted as the System V convention
  says, into a whole number register if anything in it isn't a number or a
  float and an xmm register if it is, while there are enough of each; any
  other goes on the stack, 8 bytes a slot; one given back comes in rax and
  rdx, or xmm0 and xmm1, as it was sorted, and past 16 bytes through memory
  given first, in rdi. Each input's place says which 8 bytes of the
  structure's memory it takes, so one structure can be two registers or
  three stack slots. A structure by value can't be nothing.
- **Any thread.** A program whose library block has callbacks takes turns as
  one with tasks does (§62), so a thread C made has a turn to take. On
  entry, a thread with none of the program's slots takes one of the last 16,
  with lock cmpxchg so two can't both have it (waiting, with pause, while all
  are in use; tasks keep to the slots before them); its thread's own storage
  (TlsSetValue, or on Linux its GS base) is set to it; a count in it goes up
  for a callback inside a callback. On Linux the GS base is asked for first
  (arch_prctl), as gs:0 with none is address 0. Going back out of its first
  callback, the turn is let go, its storage cleared, and the slot free.
- **Tested.** In machine code on Windows and Linux: each new whole number in
  and out of C, and through a structure laid out as C does; C's div giving a
  structure by value, and on Linux, with gcc, a library of the test's own
  with every shape the conventions sort; and three of C's threads calling a
  callback at once (and 24, and on one core, by hand).

## 93. Tools: stopping at a mistake, coverage, and versions of packages

- **Why.** Python's pdb stops where an exception happened (`pdb.pm()`), coverage.py
  says which lines ran, and pip and uv take a package at a version.
- **At a mistake.** In a program built to be debugged, each mistake's stub
  (stub_start and fail_stub, which every mistake goes through) first tells
  the debugger where it is and every variable the line can see, as the hook
  before a line does (`failing`), with debugging off while that call is
  written, so a mistake of its own isn't told too, and what the code around
  it knows of its variables kept as it was; the debugger keeps the last.
  After the mistake's report the runtime calls `failed` (rt_dbg_failed),
  once, before the last word: the debugger says where it stopped and takes
  `show`, `vars`, `where` and `list` until another command ends it. With no
  more commands (the input over), it ends at once.
- **moth coverage.** As `moth profile`, with moth-coverage.moth in the
  debugger's place, from the standard library: `start` is told now every
  line a statement is on, in the blocks inside others too (with_debugger
  walks the program for them), and `wants` notes each line that runs; at
  the end, however the program ends, it says how many of each file's ran,
  the program's own first, and those that didn't, as runs (5-7).
- **Versions.** `moth add thing@v1.2`: what's after an @ in a source's last
  part is a tag, branch or commit, checked out after the clone, and kept in
  moth.packages with the source, so `moth get` fetches the same commit as
  before and `moth update` moves a branch's to its newest and leaves a tag's
  or a commit's where it is.
- **Tested.** Through moth.exe: coverage of a program and a file it uses; a
  package at a tag, which update leaves, on a branch, which it follows, and
  at a version that isn't there; and a program built to be debugged
  stopping at its mistake, with its variables, its calls and its lines.

## 94. Concurrency: asking whether a task has ended, locks and queues

- **Why.** Python has `future.done()`, `threading.Lock`, `Semaphore` and
  `Event`, `queue.Queue`, and `concurrent.futures`' `map`; Moth could start a
  task and wait for it, and nothing else (§62's "not yet").
- **`job has ended`.** A test, as `is` is: after a value, `has ended` on the
  same line, parsed by moth.js and compiler.moth alike into the builtin `has
  ended`, last in vm.js's BUILTINS. `has` alone is still a name. In machine
  code it finds the task's number as `wait for` does and looks through the
  slots (rt_task_ended): a slot running that task means no, and a number no
  task has had is the same mistake as `wait for`'s. On the JavaScript engines
  a task has always ended, as it ran to its end when it was started.
- **sync.moth, in Moth alone.** One thread runs Moth at a time and only lets
  the turn go at a loop's end, a call or a wait (§62), so between those
  nothing else runs: `take` sees the lock is free and marks it held with no
  call in between, and `receive` sees a value is there and takes it off the
  same way, which is why neither calls a function of its own to do it. They
  wait by `wait 1 millisecond` and looking again, which lets the turn go. A
  lock is a semaphore for one: a record with how many places are free and how
  many there are, so letting go of one that's free is a mistake. `holding`
  calls a function with the lock held and lets it go even if the function
  fails. The queue is collections.moth's, a dictionary from `first` to
  `last`, with `queue_holding(n)` making `send` wait while n are waiting.
  `take_within`, `wait_for_flag_within` and `receive_within` give up after so
  many milliseconds of `the clock`, which on the JavaScript engines moves on
  with each `wait`, so they give up there too. `run_each` starts a task for
  each thing and waits for them in order; `run_each_at_most(f, things, n)`
  waits for the oldest before starting more than n.
- **Tested.** sync.moth's own tests on every engine and in machine code;
  through tasks that really wait, on Windows and Linux: `has ended` before and
  after a task ends, three tasks adding to one total through a lock (which,
  without it, ends at 20 of 60), fifty values through a queue that holds 3, a
  task waiting on a flag, a wait for any, and a queue that gives up.

## 95. finally, inputs by name, unpacking, match and steps

- **Why.** Next to Python, Moth had no `finally`, no keyword arguments, no
  `a, b = b, a`, no `match`, and no `range` with a step: each a few lines of
  Python that took a helper variable or a loop by hand in Moth.
- **Only the parsers, again.** As in §66, each is written in terms of what
  Moth already had, so the VM, the JIT, WebAssembly, machine code, the
  checker and the shell needed nothing new; moth.js and compiler.moth make
  the same tree, and compiler.moth still writes the JIT's JavaScript byte for
  byte. A statement that becomes several (`several`) is put in its place in
  the block, as a used file's code is. The variables they need have names no
  program can write: `the step on line 3`, with `of shapes.moth` in a file the
  program uses, and `(2)` for a second on one line; the debuggers leave a name
  with "on line" in it out of what they show. A number they write in has a
  token of its own, with the number as its text, as the JIT writes numbers as
  they were written.
- **Steps.** `for each k from 10 to 1 by -2` keeps where it starts and the
  step, fails if the step is 0, and counts from 0 to `(10 - start) / step
  rounded down`, setting k to `start + count * step` each time round: so it
  ends before an end it doesn't land on, a step the wrong way runs no times,
  `stop` works as in any loop, and `by 0.25` lands on 1 exactly, as the
  division is rounded as it's shown.
- **Unpacking.** `set a, b to x` keeps x, fails if its length isn't 2 (`can't
  set 2 names from a list of 3`), and sets each name its item; with values
  after `to` (`set a, b to b, a`) they make a list first, so a swap works, and
  as there are as many as names there's no length to check. `for each name,
  age in people` is a loop over a variable of its own, unpacked first, before
  any `where`. `set a, b` used to be a mistake, so no program changed.
- **match.** `match x`, then `when` lines, is the statement only when the
  next line starts with `when`; `match` alone is still a name, and `match x`
  without it still calls `match`. Each clause is an `if` of x, kept in a
  variable of its own, the next in its `else`: `when 1, 2` (or `1 or 2`) is
  `is` to each, deep equality as `is` always is; `when is greater than 5`
  and the rest are what `is` takes after it, with x before it, so comparing
  text to a number is the mistake it always is; `else` is the rest. A `when`
  in a clause starts the next clause, so an app's handler can't be inside one.
- **Inputs by name.** `greet("Sam", mark "?")`: a name followed by a value,
  in a call, was always a mistake, so it can mean this. The parser keeps them
  among the call's inputs, and once the whole program is read, before the
  inputs left out get their `or` (§66), each goes in its place, by the
  function's last `to`; one left out before them gets its `or`, or the call
  is the mistake that it needs it. A call through a variable, or by a name no
  `to` made, can't give one, as there's nothing to say where it goes; nor can
  one come before an input given in order, or be given twice.
- **finally: `either way`.** After a try's statements, or its `if it fails`,
  `either way` alone on a line starts what runs however the try ends. The try
  goes inside another, whose `if it fails` keeps the mistake and notes that
  there was one; then what's after `either way` runs, then the mistake is
  passed on with `fail with`, so a `try` around it sees the same value, a
  record as a record. A `return` in the try, or a `stop` of a loop around it,
  would skip all that, so each becomes: keep the value, note how it left, and
  `stop` a loop that runs once, put around the inner try for it (a loop
  inside, with a return in it, stops the loop it's in too, after it ends).
  After what runs either way, the noted return or stop is made. A `return` or
  a `stop` after `either way` itself is left as it is, so it ends what it
  ends, as Python's `return` in a `finally` does. The mistake passed on is
  reported at the `try`, with its message: what's lost is where it was, since
  Moth has no way to fail again with the same mistake.
- **Tested.** Each, on the three engines, in compiler.moth against the JIT,
  in machine code on Windows and Linux: the order inputs are given in, a swap,
  steps down, by fractions and the wrong way, every kind of clause, a try left
  by a return in a loop, by a stop, by a mistake caught and one passed on, a
  try with `either way` inside another, and each mistake they can make; and
  `moth format` lays out `match` and `either way` as it does `if` and `else`.

## 96. Kinds, give, and numbers of any size

- **Why.** Python has classes, generators, and whole numbers of any size (and
  `fractions`, and `math.gcd`, `isqrt`, `comb`, `pow(a, n, m)`). Moth had a
  record's own functions (§68), lists, and big.moth.
- **Kinds, only in the parsers.** `kind dog with name, sound or "woof"`, then
  `to` lines, then `end`, is the statement when a name follows `kind` and
  then `with` or `from`, or a `to` starts the next line; `kind` alone is
  still a name. Its functions are made as `dog's speak`, with dog used as a
  file is (`dog's speak(self)` calls it by that name), and then a function
  `dog` with the kind's inputs, made as a `to` is, so inputs left out and
  given by name work: it sets a variable of its own to `record with kind
  "dog"` (or, with `from pet(name)`, to what that gives, and then its kind),
  gives the record a field for each input and each function, and returns it.
  `rex's speak()` is then §68's call of the function rex's `speak` field
  holds. A kind holds only functions; an input called `kind`, or a function
  called as an input is, is a mistake.
- **give.** Once the whole program is read, if nothing in it is called
  `give`, each function with a `give x` statement in it (not in a function
  inside it) starts by setting a list of its own to empty; each `give x`
  adds x to it, and each `return` returns it, as the end does. So the values
  come all at once, when it returns. A `return` with a value in one is a
  mistake. A real generator's laziness would need a function to stop and go
  on again, which only tasks can do here, and the JavaScript engines run a
  task to its end when it's started.
- **Numbers of any size.** big.moth has `gcd` (Euclid's, with its own
  remainder), `lcm`, `square_root` (Newton's way, from 10 to the power of
  half the digits, rounded up, which is never below the root), `factorial`,
  `choices` (each step's product divided at once, as each is whole),
  `power_mod` (squaring, and the remainder after each multiplying, so the
  power can have hundreds of digits), `absolute`, `negated`, `in_base` and
  `from_base`. fractions.moth keeps a fraction as text in lowest terms, the
  sign on top, read from "3/4", a whole number, or a decimal as it's
  written (a number as it's shown, so 0.1 is 1/10, not the binary fraction
  Python's Fraction(0.1) is); each sum is big.moth's, then the gcd.
  `as_decimal` rounds a half away from 0, as Moth's `rounded` does.
- **Tested.** Kinds, one from another, a function of the kind it's from,
  inputs by name, a kind with no inputs and one with no functions, `give` in
  loops, after a return and in a try with `either way`, a program with its
  own `give`, and each mistake, on the three engines, in compiler.moth and in
  machine code; big.moth's new functions and fractions.moth against
  JavaScript's BigInt on 400 random numbers, and their own tests on every
  engine and in machine code.

## 97. The language's own functions: decimals, and how a kind is shown

- **Why.** Python writes a number to so many places with `f"{x:.2f}"`, and a
  class says how it's printed with `__str__`. Moth had text.moth's
  `number_text`, a call away, and showed a kind's record as a record.
- **Written in Moth.** Both need code that runs, not just a new shape of tree,
  and every engine and machine code run Moth. So moth.js has `LANGUAGE`, a
  short Moth file, and compiler.moth the same text (a test holds them to each
  other): once the whole program is read, if it needs any of it, the parser
  reads that text as a file used as "the language", its names `the language's
  with_decimals` and so on, which no program can write and no file's alias
  renames, and puts it at the program's top. machine.moth knows the text too,
  for a mistake's line, and the debugger and coverage leave its lines out.
- **`x with 2 decimals`.** After a sum, `with`, one number or name, then
  `decimals` (or `decimal`) on the same line: a call of `with_decimals`, which
  takes the number as it's shown, to 15 digits, moves its point for an
  exponent, rounds the next digit a half away from 0 and writes exactly so
  many, so 1.005 is 1.01 (Python's binary 1.005 gives 1.00). A name followed
  by a value was a mistake in that place before, as `with` after a sum was.
- **A kind's `shown`.** A kind with a function called `shown` makes the parser
  send each part of every `say`, and each value in text, through the
  language's `shown`: the value's `shown` field, if it has one and it's a
  function (a typed input checks that, inside a `try`), given the value, or
  else the value itself. A program with no such kind is as it was.
- **Tested.** Decimals of numbers small, huge, below 0, carried up a place and
  in text; a kind shown by `say`, in text and inside other text, a record
  with a `shown` that isn't a function, on the three engines, in compiler.moth
  and in machine code.

## 98. Sets, and the debugger's sums

- **sets.moth.** A set is a kind's record holding a dictionary of its things,
  each to yes, its `kind` "set" and a `shown` that writes `{1, 2, 3}`; `has`
  is a dictionary's own finding, so it's as quick with a million as with ten.
  Its things are a dictionary's keys: numbers and text.
- **`show x + 1`.** moth-debugger.moth reads what's after `show` as Moth reads
  a sum: numbers, text, the line's variables, `+ - * /`, brackets, `is` and
  its comparisons, `and`, `or`, `not`, `item ... of`, `length of`, `keys of`,
  a field (`age of sam`, `sam's age`) and a file's name (`math's pi`), each
  worked out in the debugger with Moth's own operators, so the answer is the
  program's. A field is found through JSON (`json from (x as json)`), as
  Moth has no field by a name held in a variable. A function can't be
  called, as the program isn't running; a mistake says what it was.
- **Tested.** A program built to be debugged, shown sums, items, fields of
  fields, comparisons, brackets, a minus, and three it can't work out.

## 99. Installers and signing

- **Why.** A program to give to people needed a setup that puts it in the
  menus and can take it away, as Inno Setup or an MSI does, and a way to sign
  it, so Windows can say who made it.
- **The installer is a Moth program.** tools/installer.moth, in the standard
  library: `moth build --installer` writes a two-line program that uses it,
  with the app's name, version and file, and builds that with the app built in
  (`--include` does the same), its icon, and `--allow-all`. Run, it asks with
  Windows' own message box (or a question on Linux), writes the program where
  a person's own programs go, and what takes it away beside it.
- **Windows' entries.** A Start menu shortcut is a COM object's file, and the
  installed apps' list is in the registry, so the installer writes a short
  PowerShell script beside the program and runs it (`-File`, so no quotes go
  through a command line), then removes it: WScript.Shell's shortcut, and
  HKCU's Uninstall key with the name, version, folder, icon, and
  `cmd /c "...\uninstall.cmd"`, which removes the key, the shortcut and the
  folder, the last with `(goto) 2>nul & rmdir`, so cmd has let go of the file
  first. Everything is the person's own (AppData, HKCU), so no administrator.
- **Linux's.** `~/.local/opt/<name>`, a `.desktop` file in
  `~/.local/share/applications`, the icon beside the program, and
  `uninstall.sh`.
- **--sign.** A command, split at spaces with quoted parts kept, run with each
  program's name after it, after the program is built and before the
  installer takes it in, then on the installer; one that fails, or can't be
  started, stops the build. moth knows nothing of certificates: signtool, or
  any tool, does the signing.
- **Tested.** Through moth.exe, on Windows and Linux: an installer made and
  signed (with `echo` for signtool), installed into a folder, the program run
  from there, taken away, a wrong option, and a signer that isn't there. By
  hand, on Windows: the Start menu shortcut's target, the Settings entry's
  values, and its uninstall string run as Settings runs it, leaving nothing;
  and on Linux, in WSL, the menu entry and uninstall.sh. A real certificate
  wasn't at hand, so signtool itself is untried on Moth's programs.

## 100. Pictures, encryption and charts

- **Why.** Python has Pillow for pictures, `cryptography` for encrypting, and
  matplotlib for charts saved to files; Moth had a picture drawn in a window,
  hashes, and a chart in the playground.
- **images.moth.** An image is a record with its width, height and pixels, 4
  bytes each. PNG is read chunk by chunk, its IDAT inflated by zip.moth, each
  row's filter undone (Paeth's too), at any depth from 1 to 16 bits, grey,
  colour, a palette with tRNS's opacity, and Adam7's seven passes; written as
  8-bit RGBA, each row filtered the way whose numbers come out smallest, as
  libpng picks. JPEG is read as baseline Huffman (SOF0 and SOF1): DQT, DHT,
  restart markers, any sampling, each block's numbers scaled back and turned
  into pixels by a separable inverse DCT from a table of cosines, each part
  enlarged to the image's size by its nearest sample; progressive, arithmetic
  and lossless JPEGs say they aren't read yet. It's written as baseline JPEG
  4:2:0, with the standard's tables scaled as libjpeg scales them.
- **Tested against Pillow.** PNGs of every kind, made by Pillow, the same
  pixel for pixel; an interlaced one made by hand, the same; JPEGs from Pillow
  at 4:2:0, 4:2:2 and 4:4:4, grey, and of a size that isn't 8's, within 4 of
  what Pillow reads in them (it enlarges colour smoothly, this nearest); a
  JPEG written here, read by Pillow, 45.7 dB from what it was; crops, flips
  and grey the same as Pillow's; and machine code the same bytes as the
  JavaScript engine for all of them.
- **crypto.moth.** AES from FIPS 197, bytes as lists of numbers, with its
  S-box and doubling table written out; GCM from SP 800-38D, its GHASH on
  four 32-bit numbers, and its counter mode from 2. `decrypt` checks the tag
  with secrets.moth's `same_secret`, so how long it takes says nothing.
  `encrypt` puts a fresh 12-byte nonce from the system before what it seals;
  new_key, new_salt and encrypt need a program moth build made, as the system's
  randomness is through C. Tested: 36 cases from Python's cryptography (all
  three key sizes, messages of 0 to 40 bytes, with and without extra bytes)
  on every engine and in machine code, GCM's own first two, a byte changed,
  the wrong key and the wrong extra found out.
- **charts.moth.** A chart is laid out once, as shapes and text, then written
  as SVG (each mark's value in a `<title>`, so it shows under the mouse) or
  drawn into an image: rectangles with their data end rounded and smoothed,
  2-pixel lines by their distance from each pixel, dots with a ring, and
  DejaVu Sans's letters at 13 and its bold at 16, 4 bits of ink a pixel,
  in glyph-tables.py's format. Its look follows a data-visualisation method:
  a categorical palette checked for colour-blind readers, used in a fixed
  order and never cycled (a ninth series is a mistake that says to make an
  Other); bars at most 24 wide, 2 pixels apart; 1-pixel gridlines; text in
  text colours, not series colours; a legend for two series or more, and a
  line's name at its end too for up to four; axis numbers in nice steps,
  with commas, or 10K and 2.5M once they reach 10,000; and, for one whole
  split in parts, a segmented bar, not a pie.
- **Tested.** Axis steps and their text, an SVG's marks, titles and escaped
  text, a PNG's background and bar colour where they should be, each
  mistake, on every engine and in machine code; and the PNGs looked at.

## 101. Faster on the web, and every core with less to write

- **Why.** The playground and the pages `moth build --web` makes ran on the
  JIT. WebAssembly was already quicker at sums and calls, but two to three
  times slower with lists of numbers and with text: each number in a list was
  a box of its own, which the GC kept and copied (73% of the time, adding
  3,000,000 numbers to a list), and each `+` on text went into JavaScript and
  back six times. Counting steps took a call each turn of a loop. And
  cores.moth (§75) asked for a `work_here` line before anything that should
  run once.
- **Small whole numbers, unboxed.** A whole number from -2^30 to 2^30 - 1 is
  an i31 value, as yes and no already were. No and yes keep 0 and 1, so the
  numbers 0 and 1 are boxes, each made once, and -0 is a box of its own.
  Whatever reads a number takes either: isNum is an i31 of at least 2 (as
  unsigned) or a box, numOf the i31's value or the box's; `box` makes one from
  an f64, and truthy gives exactly 0 or 1. An i31 that reaches JavaScript is a
  number there, 1 and 0 being yes and no.
- **Text in one call.** Text + text, text + a number and a number + text call
  JavaScript once, with the strings and the number; and a list that starts
  with text comes to JavaScript one call an item, not three.
- **remainder of, and rounded.** A builtin went to JavaScript with its inputs
  in a list. `remainder of` two whole numbers that fit in 32 bits is now
  i32.rem_s, given the divisor's sign as vm.js gives it. `rounded down`,
  `rounded up` and `rounded` give a whole number itself, and work out a
  fraction here when it's further from a whole number (and from a half) than
  rounding it to 15 digits can move it, which is at most half its size times
  10^-14: floor, ceil, or half away from 0, never -0. Anything else, and every
  mistake, goes to the builtin as before.
- **Steps counted down.** A global i32 holds the steps left, refilled from
  JavaScript at most 2^30 at a time; a loop counts down a local of its own,
  handed back to the global around a call, at a return and after the loop,
  and, by a catch_all that keeps the smaller, when a mistake leaves it. So a
  loop's turn makes no call, and a program still stops at the same step on
  every engine. A JIT call checks how many inputs it got, and counts its step,
  before calling anything, which it does only when one is wrong.
- **The page's engine.** The playground starts on WebAssembly where the
  browser validates a module with a GC struct and one with try and
  catch_all, and on the JIT where it doesn't; Engine still picks any of the
  three.
- **No box for a moment.** `add x to total`, with total a number, adds x
  straight to the f64 when x is a number, and `item i of xs` or `byte i of
  b` with i a number takes the place as an f64, so neither makes a box only
  to take it apart again.
- **What it gave.** WebAssembly, best of five in Node, before and after:
  adding 3,000,000 numbers to a list and summing them by item, 352 to 71 ms;
  `for each` over them, 277 to 68; 300,000 records in a list, 206 to 79;
  joining 200,000 pieces of text, 148 to 52; a million bytes filled and
  summed, 47 to 38; a million-round loop, 5.3 to 3.9. 300,000 records, each
  with a `remainder of`, run once as the playground runs a program: 227 to
  87 ms (the JIT: 76). Primes up to 5,000, which compares numbers from a
  list, went from 15 to 18 ms, as each number now says which kind it is.
- **cores.moth with no work_here.** Each each_at_once outside a part has a
  number, counted as the program runs. A copy is started with its call's
  number and runs the program to it: a call before its own gives what it gave
  the program, from a file each_at_once saves them to (with how many calls
  were made inside each, which the copy skips), and its own call does its
  part and stops the copy. In a part, each_at_once does its items there. A
  call that failed in the program isn't saved, so the copy does it, and fails
  and carries on as the program did. work_here still stops a copy at once,
  and nothing is saved for a call whose function had a work_here before the
  first each_at_once.
- **A part's mistakes.** At its own each_at_once, a copy may be inside the
  program's `try`, which mustn't catch the part's mistake: so the part
  catches it, and saves it, with which item it was on, where each_at_once
  looks for what the part gave; each_at_once fails with `part 1 of 2 failed:
  falls_over failed on item 3: can't divide by zero`. A copy that comes to
  another function's each_at_once says so. At work_here, as before, the
  copy's own mistake, with its line and trail.
- **Shared in turn.** With n copies, the 1st, n+1st, 2n+1st... items go to the
  first, the 2nd, n+2nd... to the second, so a list whose items take longer
  and longer is shared evenly: counting the primes below 60,000 to 1,920,000,
  32 items, on 6 copies, 5.0 s before and 3.4 s now (one copy: 12.0 s). On 12
  or more both take 2.7 s, which is what 6 cores with two threads each give.
- **Waiting.** tasks.moth's wait_for waits on the process (Windows) or its
  output (Linux) for up to 10 ms, so it wakes when the task ends, not at the
  next 10 ms. Starting and finishing 12 copies took 117 ms, now 100 ms on
  Windows (most of it CreateProcess, 6 ms each), and 8 ms on Linux.
- **Tested.** Numbers either side of every edge (0, 1, -1, 2, ±2^30, -0,
  fractions, bytes, as yes and no, through kinds, dictionaries and records),
  `remainder of` every sign with whole numbers, fractions, 2^31 and more, and
  `rounded` near whole numbers and halves, small and big: the VM, the JIT and
  WebAssembly say the same. cores.moth in machine code on Windows and Linux:
  two calls in a row, one in a loop, records, calls inside a part and inside
  one done here, a part's mistake inside the program's own try, a copy that
  came to another each_at_once, and no files left behind.

## 102. Learning it, and a web app made with it

- **Why.** The README shows all of Moth at once, which suits someone who
  already programs; someone new needs it a step at a time. And a language is
  believed when something real is made with it, start to finish.
- **learn.html.** Eleven lessons, from `say` to a word counter and the turtle,
  each with what it teaches, a program in a box to change, Run (or
  Ctrl+Enter), Reset, Open in the playground, and something to try. Each run
  is a worker.js of its own, as the playground's are, on WebAssembly where the
  browser has it and the JIT where it hasn't, stopped after 10 seconds. A
  question shows a box under the output; its answer runs the program again with
  the answers so far, as the playground does. The lesson that draws opens in the
  playground, which shows drawings. Lessons run are ticked, and kept in the
  browser's storage.
- **Lessons that can't go stale.** They're in learn-lessons.js, which the page
  imports and moth.test.js runs: every program on every engine, the same on all
  of them, with the answers the lesson types; the one that fails on purpose (an
  item that isn't there, to show a mistake's words) fails with that mistake.
- **apps/guestbook.** A page to sign and read, in SQLite, with the entries as
  JSON: guestbook.moth serves book.moth, which does the work with no network,
  so it's tested by calling answer_with with requests made by hand. Values go to
  SQLite as parameters, never in the SQL; everything shown is escaped; a sign is
  answered with 303 to the page, so Reload doesn't sign again; a refused one with
  400, the page, the problem and what was typed. docs/guestbook.md walks through
  it. 161 lines, built into a 1.3 MB program.
- **A bug it found.** In text.moth, `^\s+|\s+$` never matched its first part:
  text_either worked out where each part jumps to from the list of steps it had
  before the last part, and a repeat in the last part (`+`) makes a new list. It
  reads the list again before setting the jumps now.
- **Tested.** Every lesson, as above; text.moth's either-ors whose last part
  repeats, against Python's re; the guestbook's own tests in machine code, then
  the guestbook built by moth.exe, run, signed (a name of `<script>`, one of
  only spaces), read as a page and as JSON, a 404, and its database file, over
  HTTP.

## 103. Package sums: moth.sums

- **Why.** A commit in `moth.packages` names a package's code, but nothing
  checked that the files in `packages/` were still that code. A cached
  `packages/` in CI, or a file changed there by hand, ran as it was; and a
  commit is a SHA-1, which Git hardens but which is the weakest link a company
  would be asked about. npm's lockfile has an integrity hash, Go has go.sum,
  Cargo checks each crate's.
- **What.** `moth add` and `moth update` write the SHA-256 of each package's
  files, at its commit, to `moth.sums`, beside `moth.packages`: a line each,
  its name, the commit and `sha256:` with 64 hex digits. `moth get` works it out
  again and compares. One that was in `packages/` already and differs is named
  with the files git sees changed, added or taken away, and left as it is, for
  a person to look at; one just fetched that differs came from somewhere that
  isn't what it was, and is taken away, so nothing uses it. `moth update`
  checks a package first, so a change in `packages/` never becomes the next
  sum. A package's own `moth.sums` is checked for the packages it brings.
- **The sum.** For each file in the folder but Git's own (any `.git` folder or
  file), in the order of its path's bytes, with `/` between its parts: its
  SHA-256 in hex, two spaces, its path, a line end; then the SHA-256 of that.
  It's what `sha256sum` writes, so `find`, `sort` and `sha256sum` can check one
  without moth, and it's Go's dirhash with hex for base64. Every file counts,
  not only the ones git tracks: a file added to a package's folder is a change.
  It uses tools/hash.moth, which moth.moth now uses `as cli_hashing`, so
  bootstrap.mjs and the tests give moth that file too. A megabyte takes moth
  about half a second.
- **The same on every system.** Git for Windows checks text files out with
  `\r\n` (its installer sets `core.autocrlf`), so a package's files, and their
  sum, were different on Windows and Linux. moth now runs git with
  `core.autocrlf=false`, `core.eol=lf` and `core.symlinks=false`: files as they
  were committed, or as the repository's own `.gitattributes` says, which is
  the same everywhere, and a symbolic link as a small file holding where it
  points, as Windows has it anyway. So a link in a package can't lead `use`
  out of it either.
- **A file of its own.** The sums could have gone at the end of each
  `moth.packages` line, but moth 1.11 takes a line's last word as its commit,
  so it couldn't have read the file. `moth.sums` is a file 1.11 doesn't know,
  and ignores. A `moth.packages` with no sums, or one whose commit has none,
  gets them from the next `moth get`, which fetches the package again first,
  as a moth before this one may have checked it out with other line ends.
- **Tested.** Through moth.exe: the sum against one Node.js works out the same
  way; a package whose `.gitattributes` asks for the system's line ends
  checked out with `\n` on Windows too; a file changed and a file added in
  `packages/`, by get and by update; a fetch whose sum differs, not kept; a
  `moth.packages` with no sums, and one checked out with `\r\n`; update's new
  sum; a package's own `moth.sums`, which fits and which doesn't; remove.

## 104. Signed packages: --signed

- **Why.** A sum says the code is what was pinned, not who wrote it. A company
  that signs its commits, or takes a library only at its signed releases, wants
  moth to check.
- **What.** `moth add`, `get` and `update` take `--signed`. A package passes if
  it was asked for at a tag that's a signed tag (an object of its own, not a
  name for a commit) at the package's commit and `git verify-tag` accepts it, or
  else if `git verify-commit` accepts its commit. Which keys count is git's:
  the person's GPG keyring, or for SSH signatures the file
  `gpg.ssh.allowedSignersFile` names. moth says what git said when it doesn't
  pass. `add` takes away what it fetched; `update` goes back to the commit it
  was at, and says so; `get` ends with 1.
- **Asked for, not always.** Most packages aren't signed yet, so checking each
  time would stop everyone. A company puts `moth get --signed` in its CI.
- **Tested.** Through moth.exe, with SSH keys ssh-keygen makes and an allowed
  signers file given to git in `GIT_CONFIG_*`: a tag that's only a name on an
  unsigned commit, refused; a signed commit asked for by its hash, and a signed
  tag on an unsigned commit, taken by add and get; a commit signed by a key
  that isn't trusted, refused, then taken without `--signed` and refused by get;
  update on a branch, refusing an unsigned newest commit and taking a signed
  one; and `--signed` where it means nothing.

## 105. Advisories and moth audit

- **Why.** npm audit, pip-audit and cargo audit say when a program depends on a
  version with a known problem. Moth's packages are pinned by commit, so its
  advisories name commits.
- **The advisories** are a list in the package index's JSON, beside its
  packages, so one file, one address and one pull request hold both. Each names
  its package (by the index's name, or a `repository` of its own), and which
  commits it's about: `commits`, a list, each all of a commit or its first 7 or
  more digits; or `introduced` and `fixed`, the commits from the one it came in
  with (or `"0"`) that aren't from the one that fixed it on, as OSV's GIT ranges
  are; or neither, for every commit. `id`, `severity`, `about` and `link` are
  for people.
- **moth audit** reads moth.packages and the index (`--index` as for search),
  matches each package to the advisories by where it comes from, in lower case,
  with no `https://`, `ssh://`, `git@site:`, `.git` or `/` at its end, and asks
  the package's own clone, with `git merge-base --is-ancestor`, whether a commit
  is before another. A package not fetched can't be asked, and says so. It ends
  with 1 if an advisory is about a package's commit or one couldn't be checked,
  so CI stops; with 0, it says there are none.
- **The index.** samyyy2423/moth-packages needs `advisories` in index.json,
  and its check-index.mjs to allow and check it; the pull request that adds
  this describes the change.
- **Tested.** Through moth.exe, with an index in a file: an advisory by its
  commits, written in another case with `.git/` after it, and one by
  introduced and fixed, each at the commits it's about and not; a package from
  a site written another way than the index has it; a package not fetched; an
  index with no advisories; advisories that aren't; and no moth.packages.

## 106. A specification, a promise, a changelog and a security policy

- **Why.** A company that builds on a language asks what it means, what
  updates will change, what's changed, and where to send a security problem.
  Moth's answers were spread through the README, DESIGN.md and the release
  notes.
- **SPEC.md** is the language as it is, from moth.js's parser and vm.js's
  checks and messages: how a program is read, the grammar of every statement
  and expression, values and their kinds, numbers to 15 digits, each built-in
  operation, mistakes, files, packages and the flags. What's guaranteed is
  marked apart from what's only how it's done today (the engines, limits,
  speed, the words of a mistake).
- **VERSIONING.md** is semantic versioning, with one number for the language,
  the standard library and the `moth` command, which are released together.
  1.x keeps every program working; no word is ever reserved in 1.x, as each new
  phrase has started with a word that stays a name; something to remove is
  deprecated first and can go only in 2.0. The newest minor release gets every
  fix and the one before it security fixes for 90 days. Bugs and security holes
  are fixed even where a program depended on them, as 1.5.1's was.
- **CHANGELOG.md** is the GitHub releases, newest first, shorter, with a
  section for what's not released yet.
- **SECURITY.md** says how to report a problem privately (GitHub's private
  reporting), which versions get fixes, how to check a download, and what the
  `--allow` flags protect against and don't: a library or a program the
  program starts can do anything, a flag allows all of what it names, and
  there are no limits on memory or time.

## 107. Types you can add, checked before the program runs

- **Why.** A company's code is read by people who didn't write it, and its
  mistakes are cheapest before it runs. TypeScript and Python's type hints say
  what a value is where it matters and nowhere else; Moth's inputs could say
  only one of eight kinds, and the checker could only speak where values were
  written out.
- **What the code can say.** An input can be `a dog` (or `an owl`): a record a
  kind makes. It can be `a list of numbers`, or of `text`, `yes or no`,
  `lists of numbers`, `records`, `dictionaries`, `bytes`, `functions`, or what
  a kind makes, `dogs` (`boxes`, `puppies`). After its inputs, a function can
  say `gives a number`, `gives a dog`, `gives nothing`, or `gives a dog or
  nothing`. A kind's inputs say so too: `kind point with x as a number`.
- **Gradual, so nothing old changes.** A run checks only what it always
  could, cheaply, at each call: `a dog` is checked as a record, `a list of
  numbers` as a list, and `gives` not at all. What's beyond that is for the
  checker. Code that says nothing is checked exactly as it was. `gives` is a
  word only after a function's inputs, so it stays a name (VERSIONING.md's
  promise), and `as` already was a word.
- **Two passes.** checker.js works out every variable's type twice: from
  what's sure (values written out, what each operation and builtin gives, an
  input whose `as` each call checks, what a kind makes, and now what a function
  returns, from its `return`s, again until nothing changes), and then with
  what the code says of itself too. A check that fails on the first is
  "will fail": that line stops the program whenever it runs. One that fails
  only on the second is "doesn't fit": the code goes against what it says,
  which no run would catch (`greet(cat("Tom"))` when greet takes `a dog`, or a
  `return 5` in a function that `gives nothing`, or one that `gives a number`
  and can reach its end). A type is a string ("record:dog", "list:number"), so
  joining two of them is cheap: a list of numbers and a list of text are a
  list. A field of a record a kind makes has the type its input says, unless
  the program sets a field of that name anywhere, when any record may have it.
  A kind named that the program doesn't make is said once, with the nearest
  name (`there is no kind called 'dgo'`).
- **moth check does the same in Moth.** It can't run vm.js's checks, so
  make-checker-rules.mjs runs each of checker.js's rules on a sample of every
  type, and of every unit and turtle action, and writes what each does into
  checker-rules.moth: a line per rule and types, saying which operands' values
  (not just types) can change the outcome, and which message it stops with.
  moth.moth works the types out as checker.js does and looks each check up
  there. So moth check says what the checker says, word for word, but leaves
  out what rests on a value written out (`1 / 0`, `item 0 of x`, `repeat "x"
  times`), which needs the value, not its type; the playground finds those
  too. moth.test.js says when checker-rules.moth is behind.
- **Everywhere alike.** moth check ends with 1 for "will fail" and "doesn't
  fit"; the editors and the playground show both in red, "doesn't fit"
  named as such (the playground showed it in yellow before).
- **Tested.** Each kind of input type, `gives`, kinds made from kinds, and
  every message, in moth.test.js, word for word; moth check against the
  checker on every example, working program, typed program and 120 broken
  ones, through moth.exe. And that unannotated code gets no false alarm: the
  checker's claims held against runs of the examples, the table programs, the
  lessons, the programs machine.test.js makes machine code of, and every file
  of the standard library (no "doesn't fit", and each "will fail" where the run
  stops, in its words, or on a line that never runs). Done once by hand,
  further: main's checker and this one on 2,970 unannotated programs differ
  only in a mistake's wording (`expected what kind of value it is ... or a
  kind's name`) and in true "will fail"s from what a function returns
  (`f() + 1` where f gives nothing); and moth check and the checker agree word
  for word on 2,360 programs, and the playground's Problems pane with moth check
  on every typed program, in Chromium.

## 108. The language server, and every major editor

- **Why.** People write code in their own editor. One language server gives
  them all what the VS Code extension had, and more.
- **moth lsp** speaks the Language Server Protocol on its input and output, in
  Moth (moth.moth), from what moth check and moth tidy already know: the
  problems as you type (moth check's, types and all), formatting (moth tidy's),
  the outline (each function, kind with its own functions in it, and variable,
  each to its `end`), go to definition (in the file, in a file it `use`s, and
  on a `use` line, the file itself), hover (what a name is, what a variable or
  input holds, what a function takes and gives, with the comment above it),
  and completion (the names the position can see, Moth's words, and after
  `rex's`, what rex's kind has). Hovers and `rex's` use the checker's types:
  it notes where each variable, input and function's returns are made, and
  hovers look them up.
- **Reading what an editor sends.** A message is a header, an empty line, and
  as many bytes of JSON as the header says, with no new line after. `ask for 64
  bytes` gives the next 64 bytes of the input, waited for but not to a line's
  end, or as many as come before it ends (machine code only; the playground's
  engines say so). The answers are said with `say`, whose new line the
  Content-Length counts.
- **Code being typed.** Most keystrokes leave code that can't be read. The
  problems then are its first mistake, as moth check says it; for everything
  else the server leaves out the line with the mistake (made empty, so the
  lines after keep their numbers), or the line before when the mistake is at
  a line's start (`set x to`, then the next line), or ends a block left open,
  and reads it again, 12 times at most. So the outline, hovers and completion
  still know the rest of the file.
- **One reading per change.** What it works out of a document is kept until
  its text, or a file it uses, changes. The editor's copies of the files it has
  open are read in place of the disk's, so a change not yet saved counts, and
  the documents that use a changed file get their problems again. An editor
  that finds the problems itself can ask for none (`initializationOptions:
  { diagnostics: no }`).
- **VS Code.** The extension now starts moth lsp where moth is installed
  (client.js, which needs no VS Code, speaks the protocol) for the outline,
  definitions, hovers and completion, which only the server can do across
  files. It keeps Moth's engine, built in, for the problems, the quick fixes and
  tidying: that needs no install, and finds what rests on a value written out
  too. Without moth, or with `moth.languageServer` off, it does as it did.
- **Neovim, Helix and Zed** colour with tree-sitter, so editors/tree-sitter-moth
  is a grammar: each line as Moth's tokenizer reads it, with a call, `to name`,
  `kind name`, `x's` and the values in text as parts of their own, and VS
  Code's words. Whether a `{` in text starts a value rests on the character
  after it, which a regular expression can't look at, so src/scanner.c reads the
  text between values. editors/neovim is a plugin folder (filetype, comments,
  Moth's indenting, moth lsp, the colours once the parser is built),
  editors/helix a languages.toml and its queries in Helix's names, and
  editors/zed an extension whose Rust starts moth lsp, as Zed runs a language
  server only for a language with a grammar. Zed and Helix build the grammar
  from the commit of this repository that added it. **JetBrains' IDEs** use
  LSP4IJ, which runs any language server, with the VS Code extension's
  TextMate grammar for the colours. editors/README.md says how to set up each.
- **Tested.** machine.test.js starts moth lsp and speaks the protocol to it,
  checking each message's framing: the problems as a document opens, against
  the checker's; the outline; definitions here and in two files it uses; each
  kind of hover; completion, and after `rex's` and `shapes's`; a document as
  it's typed; an unsaved change to a file it uses, and that file closed again;
  tidying, against format(); a message in pieces and two in one; shutdown and
  exit; no problems when asked for none; and the extension's client.js against
  it. editor.test.js runs the extension against stand-ins for VS Code and for
  the server, with and without it; and checks the grammar has VS Code's words,
  the colours' copies match, Zed and Neovim indent as VS Code does, and Zed and
  Helix name the commit the grammar is at. Done by hand: every Moth file here,
  and every example and test program (563), reads with tree-sitter with no
  error; Neovim 0.11, headless, showed the problems, hovered, went to a
  definition, tidied, indented and coloured; Helix 25.07 built the grammar and
  found the server and the queries; and the Zed extension built for
  WebAssembly.

## 109. A debug adapter for moth debug

- **Why.** An editor's debugger shows breakpoints in the margin, the calls in
  progress and the variables, and steps with a key. moth debug (§59) had all
  of that, as commands typed in a terminal.
- **What.** editors/vscode/debug-adapter.js speaks the Debug Adapter
  Protocol to the editor and moth debug's commands to the program: a
  breakpoint is `break lib.moth 4` (or `clear`), step in, over and out and
  continue are `step`, `next`, `out` and `go`, the calls in progress are
  `where`, the variables `vars`, and what's under the pointer, in a watch or
  in the debug console is `show` (the console's `where`, `list`, `breaks` and
  `help` are said as they are). The mistake that ends a program is a stop
  with its words, whose variables can still be looked at. While the program
  runs, a line typed in the debug console answers its `ask`.
- **Reading it.** The debugger answers on the program's own output, and asks
  for each command with `(moth) `, which the command is said after, as `ask`
  says an answer when the input isn't a terminal; a text value's new line is
  `\n`. So what comes before `(moth) ` after a command that only looks is its
  answer; after one that runs the program, it's what the program said, then
  the line it stopped at, whose shape (`prog.moth:5, in 'bump': ...`, or
  `stopped at the mistake, at ...`) the adapter reads. What the program says
  is shown as it comes, but for its last line, which may be that line: held
  until the next line comes, `(moth) ` does, or 200 ms go by.
- **In JavaScript, for now.** Driving a program's input and output both,
  while reading the editor's, needs a process with pipes for both, which
  tasks.moth hasn't, and moth isn't built with --allow-libraries. So the
  adapter is Node.js's: VS Code runs it inside the extension, and Neovim
  (nvim-dap, which editors/neovim sets up), Helix and LSP4IJ start it with
  node. A `moth dap` in Moth can come once tasks.moth can give a program its
  input.
- **What moth debug can't do.** It's told things only while the program is
  stopped, so a breakpoint set while it runs counts from where it next stops,
  and a pause is refused, saying so. A program stopped while it runs is ended
  with moth, as a group, and the program moth built (prog-debug) is taken
  away by the adapter, as moth can't, if this session made it.
- **VS Code.** *Moth: Debug this file* (and F5 with no launch.json) starts a
  debugging session in place of `moth debug` in a terminal, with moth.path's
  moth.
- **Tested.** machine.test.js runs the adapter as a program of its own, as an
  editor other than VS Code does, on moth.exe's moth debug: breakpoints in the
  program and a file it uses, taken away, the calls in progress, variables, a
  hover, a watch that fails, the console's `where` and an answer to `ask`,
  step out and over, a refused pause, what the program said and the number it
  ended with; a mistake stopped at, with its calls and variables; stopping on
  entry; a program stopped while it runs, and the program moth built taken
  away; and a moth that isn't there. editor.test.js checks the extension
  starts a session for Debug, fills a launch configuration in, and runs the
  adapter inside itself. Done by hand: Neovim 0.11 with nvim-dap, headless,
  set a breakpoint, stopped there, read a variable, continued, stepped and
  ran to the end, through editors/neovim's setup; and Helix 25.07 took the
  debugger's settings.

## 110. YAML

- **Why.** CI files, Kubernetes, Docker Compose and most of a company's
  settings are YAML; toml.moth read only TOML.
- **What.** yaml.moth reads YAML 1.2's core schema, as PyYAML does with
  YAML 1.2's resolver: `true`/`false`, `null`/`~`/nothing, decimal, `0x` and
  `0o` whole numbers, decimals with exponents and `.inf`; everything else text,
  so `on`, `no`, `1.2.3` and dates stay text (the "Norway problem" of 1.1
  doesn't happen). Block mappings and sequences (a sequence as indented as its
  key, compact `- key: v` items, `- - a`), flow `[ ]` and `{ }` over lines,
  plain text folded over lines, both quotes with every escape (`\x`, `\u`,
  `\U`, halves of a pair), `|` and `>` with `-`, `+` and an indentation
  digit, comments, `---` and `...`, `%` directives, anchors and aliases
  (the same value, as PyYAML gives), `<<` merges (one or a list, the
  mapping's own keys winning), `? key` explicit keys, and the tags !!str,
  !!int, !!float, !!bool, !!null and !!binary (bytes); other tags (`!Ref`)
  are passed over. Keys are text as written. A key twice is a mistake, as
  in toml.moth; YAML forbids it, though PyYAML keeps the last.
- **Writing.** yaml_of writes block style, two spaces a level; text plain
  where it reads back as itself, also by YAML 1.1 readers (so `yes`, `on`
  and anything starting with a digit, sign or dot is quoted), text with
  lines after `|`, `|-` or `|+`, bytes as `!!binary`, records as mappings.
- **Tested.** 62 documents (the spec's chapter 2, CI, Compose and Kubernetes
  files, every scalar kind, block scalar chomping, flow, anchors, merges and
  mistakes) against PyYAML with a YAML 1.2 resolver: 59 the same, the other
  three differences on purpose (a key twice, a tab after `:`, and `! 12`,
  which the spec says is text). Each of the 59 written by yaml_of, read back
  the same by yaml.moth and by PyYAML. yaml.test.moth keeps the cases, on all
  three engines and in machine code.

## 111. JSON Web Tokens

- **Why.** Every API a company runs or calls has bearer tokens, and an
  identity provider's are JWTs signed with RSA.
- **What.** jwt.moth makes tokens with HS256, HS384 and HS512 (hash.moth's
  HMAC) and checks them, and checks RS256, RS384 and RS512 with big.moth's
  `power_mod`: 0.05 s for a 2048-bit key in machine code, so checking is
  practical; signing with RSA (a 2048-bit private exponent, about 4 seconds
  even with the CRT) isn't offered. The signature is checked by building the
  whole expected PKCS #1 v1.5 block (00 01 FF.. 00, DigestInfo, hash) and
  comparing every byte with `same_secret`, never by parsing what the power
  gives, which is how forgeries have got through others' checks. Keys: a
  secret (text, bytes, or a JWK of kty `oct`), or RSA as a PEM public key,
  RSA public key or certificate (a small DER reader finds the key), or a JWK.
- **Algorithm confusion.** The key decides the algorithms, not the token: a
  secret only HS*, an RSA key only RS*; `none` is always turned down, and
  `crit` too. So a token signed with HMAC using the RSA public key's PEM as
  its secret fails, as does `alg: none`.
- **Claims.** exp and nbf with leeway, iat not in the future, iss among the
  issuers given, and aud: a token that has one must name the audience given,
  as RFC 7519 says; `require` lists claims that must be there; `now` can be
  given, so tests never ask the clock.
- **Tested.** RFC 7515's A.1 (HS256, its key a JWK) and A.2 (RS256); tokens
  PyJWT made with all six algorithms, the same bytes made here for HS*; a
  key from Python's cryptography as SPKI, PKCS #1, a certificate and a JWK;
  every claim failing; and the attacks above. On the JIT (RSA is slow on the
  other two engines) and in machine code.
- **A bug found.** In machine code, `list of a for each a in xs where ...`
  inside a function of a file used `as` a name fails, "'jwt' has nothing
  called 'jwt's each item'": the libraries use loops instead. Not fixed here.

## 112. S3 and Signature Version 4

- **Why.** Files a company keeps are in S3, or a store that speaks its
  language: MinIO, R2, B2, Ceph.
- **What.** s3.moth signs each request with SigV4 (the canonical request,
  the string to sign, the key derived from the date, region and service) and
  sends it through http.moth, with the Host header it signed and the path and
  query exactly as signed (each encoded once, as S3 wants, the query sorted).
  Objects are put, got, looked at, listed (ListObjectsV2, page after page),
  deleted; buckets made (with a LocationConstraint outside us-east-1),
  removed and listed; and presigned URLs made for GET, PUT or DELETE.
  Buckets go in the path for MinIO and other stores, in the host's name for
  amazonaws.com. Temporary credentials' token is sent and signed;
  `sign_payload no` sends UNSIGNED-PAYLOAD, as hashing in Moth is about
  1.7 MB a second. `sign()` is public, for other AWS services.
- **Tested.** Against the signatures in S3's own guide (GET with a Range,
  PUT of a key with `$`, a bucket's lifecycle, a listing, and the presigned
  URL), and AWS's test suite's get-vanilla, query order and header trimming,
  all matching on every engine and in machine code; then a real MinIO.

## 113. OAuth 2

- **Why.** A program a company writes signs people in through Google,
  GitHub, Okta or Entra, and calls APIs with its own credentials.
- **What.** oauth.moth has the authorization code flow with PKCE (S256; a
  32-byte verifier and 16-byte state from secrets.moth), and `sign_in`, which
  does it as command-line tools do (RFC 8252): server.moth answers on
  127.0.0.1, at the first free port from 8765; the browser is opened where
  the program may run one (rundll32 or xdg-open), and the address is said to
  the error output either way; a request whose state isn't the one sent is
  answered 400 and waited past; the code, or the provider's error, ends the
  wait. Then the client credentials grant, refresh (the old refresh token
  kept if no new one comes), `expired`, and `discover`, from OpenID Connect's
  document. A client secret goes as HTTP Basic or in the form. A token
  endpoint's answer in a form (GitHub's, unless asked for JSON) is read too.
- **Tested.** RFC 7636's PKCE example, the authorization address, every kind
  of answer, in machine code (the randomness is the system's); and a whole
  sign-in in machine.test.js: Node is the provider, checking the verifier
  against the challenge in the address the program said, and the browser,
  coming back to the program's own server first with a wrong state, then the
  code; refresh, a revoked refresh token, client credentials both ways, and a
  person saying no, its words escaped in the page.

## 114. Bytes on a connection, and Redis

- **Why.** Databases speak protocols of bytes: lengths, numbers and lines,
  arriving in pieces.
- **wire.moth.** A reader keeps a buffer of what came, twice as big when a
  message needs more, so a 10 MB reply costs about 10 MB of copying, not its
  square; `take(n)`, `line` (to \r\n), `text_to_zero`, numbers of 1 to 8 bytes
  either way round, signed or not, and IEEE 754 doubles both ways, written by
  finding the exponent and scaling by powers of 2, which are exact. A
  writer keeps pieces and joins them once. A negative 8-byte number is
  written as -n-1 with its bits turned over, so it stays exact to 2^53.
- **redis.moth.** RESP2 and RESP3 (maps as dictionaries, sets as lists,
  doubles, booleans, big numbers as text, verbatim strings, attributes passed
  over, pushes); commands as arrays of bulk strings, binary-safe; pipelining
  (every reply read before any error is raised, so the connection stays in
  step); MULTI/EXEC; SCAN rather than KEYS; BLPOP; pub/sub by channel and
  pattern, with a time limit through sockets.moth's `ready`; AUTH with a
  user; `rediss://` over TLS. Bulk strings come back as text, or as bytes
  through get_bytes and command_bytes.
- **Tested.** Every reply type read from bytes, and commands written byte
  for byte, on every engine and in machine code; then a real Redis.

## 115. PostgreSQL

- **Why.** It's the database most companies start with.
- **What.** Protocol 3: SSLRequest first unless TLS is "disable"; then
  SCRAM-SHA-256 (the server's signature checked at the end, so a server that
  doesn't know the password is found out), MD5 or a password in the clear,
  whichever the server asks for. Every query goes by the extended protocol:
  Parse with each parameter's type left to the server (bytea's said, as its
  bytes go in binary), Bind, Describe, Execute and Sync in one send, so the
  SQL and the values never meet. Results come as text and are made Moth
  values by their type's OID (int2/4/8, float4/8, numeric, bool, bytea, json
  and jsonb, one-dimensional arrays of those); NULL is nothing. After an
  error the server skips to Sync's ReadyForQuery, which is read before the
  error is raised, so the connection is ready for the next query. Notices
  are kept on the connection. `run_script` uses the simple protocol, for
  files of many statements. `in_transaction` commits, or rolls back and
  raises the mistake again.
- **TLS.** "prefer" tries TLS where the server has it; as sockets.moth
  always checks certificates, a server whose certificate can't be checked
  (or a Windows computer without OpenSSL) is connected to again without TLS,
  which is what "prefer" means in libpq, where it never checks at all.
  "require" never falls back.
- **Tested.** RFC 7677's SCRAM example; MD5; the messages of a query byte for
  byte, and a server's answers (every type, NULLs, an error with a notice
  before it, a constraint's detail) as Python's struct makes them, on the
  JIT and in machine code; then a real PostgreSQL 16.

## 116. MySQL

- **Why.** The other database companies run, with MariaDB.
- **What.** The handshake (protocol 10), an SSLRequest where TLS is wanted,
  HandshakeResponse41 with utf8mb4, and the three plugins:
  `mysql_native_password` (SHA-1), `caching_sha2_password` (SHA-256) and
  `sha256_password`, with the server's switch to another plugin followed.
  caching_sha2's full way, and sha256_password, send the password in the
  clear over TLS, and without TLS ask for the server's RSA key and send it
  XORed with the nonce and encrypted with RSAES-OAEP (SHA-1, MGF1), built
  here on big.moth and jwt.moth's key reader.
- **A user that isn't there.** So that a login can't tell whether an account
  exists, MySQL gives a user it doesn't have a plugin chosen at random (kept
  for that name until it restarts): any of the three. Without
  sha256_password, a mistyped user was refused, one time in three, with
  "the server logs in with sha256_password" rather than "Access denied";
  CI's live test caught it. With it, such a user is always refused by the
  server, as it should be.
  Statements are prepared once each (kept by their SQL on the connection) and
  run with COM_STMT_EXECUTE: whole numbers as 8 bytes, others as doubles,
  text, bytes as blobs, NULLs in the bitmap. Rows in the binary protocol are
  read by type (signed and unsigned integers, floats of 4 and 8 bytes,
  decimals, dates, times with days and a sign, JSON, binary columns as
  bytes); `run_script` uses COM_QUERY's text rows, with multi-statements on.
- **Tested.** The handshake, both scrambles, OAEP with a fixed seed against
  Python's by hand (which Python's cryptography decrypts), the execute
  message and a server's binary and text rows, OK and ERR, as Python makes
  them, on the JIT and in machine code; then a real MySQL 8.4, whose
  certificate is its own, so "prefer" falls back and caching_sha2 goes the
  RSA way, then the fast way; a native-password user; a sha256_password user;
  and six users that aren't there, each refused with "Access denied" whatever
  plugin the server drew for it. A sha256_password user was also logged in
  over TLS, with a certificate made for the test, against MySQL 8.0.

## 117. Real servers in CI

- **Why.** A protocol read only from bytes made by hand is a protocol as
  understood by whoever made them.
- **What.** machine.test.js has a live test for each of PostgreSQL, MySQL,
  Redis and S3, run where `MOTH_POSTGRES_URL`, `MOTH_MYSQL_URL`,
  `MOTH_REDIS_URL` and `MOTH_S3_URL` say where a server is, skipped where not.
  CI's test job has PostgreSQL 16 (logins md5, so a SCRAM password logs in by
  SCRAM and an MD5 one by MD5), Redis 7 and MinIO as service containers, and
  starts MySQL 8.4 with `docker run`, as `--mysql-native-password=ON` is a
  server option a service can't be given. MinIO no longer publishes images of
  its own, so CI uses Bitnami's build of it. The passwords are the
  containers' own, made up for the tests.
- **Tested.** Each program is built by the machine compiler and run with the
  server's address; what it says must be exactly what it said here against
  the same servers in WSL's Docker.

## 118. Arrays of numbers, and Moth's own loops

- **Why.** NumPy is what makes Python the language of data and machine
  learning: numbers in a shape, and maths on all of them at once. Moth had
  lists, and a loop in Moth takes a few instructions an item.
- **tools/arrays.moth** is an array as NumPy has one: a record of a `shape`
  and its numbers, the last axis's one after another, as C lays them out.
  It makes arrays (from nested lists, zeros, random, counting, identity),
  does maths element by element with NumPy's broadcasting, matrix
  multiplication, sums, means and the largest along an axis, reshaping,
  slicing, transposing, stacking and softmax. Axes and places count from 1,
  as items do. A shape that can't be, or shapes that don't go together, is
  a `fail with` that says which.
- **Moth's own loops.** `use the library "moth"` names functions a program
  has in it, which machine.moth writes in machine code: numbers_binary,
  numbers_matmul and numbers_reduce (matmul and sums with SSE2, two numbers
  at a time), and numbers_convert. Nothing is loaded, so they need no `--allow-libraries`.
  Each is given the lists themselves and checks what it's given: every
  place it reads or writes is in its list and every number it works out is
  a number. For anything else (a place outside a list, a NaN, a division by
  0) it gives 1 and arrays.moth does that work in Moth, so what happens is
  what Moth says happens, to the last bit, on every engine. On the
  JavaScript engines, which can't call a library, all of it is Moth.
- **Lists of numbers for C.** `a list of numbers` as a library function's
  input gives C where the list's numbers are, a `double*`, which C can read
  and change; a NaN C leaves there is made the NaN Moth's arithmetic makes.
  Only an input can be one.
- **Tested.** arrays.test.moth on all three engines and in machine code:
  making, element by element, broadcasting, matrices, along axes, shapes,
  NaN and infinity, mistakes, and machine code's loops giving exactly what
  Moth's give; Moth's own library used without `--allow-libraries` and not
  linked; and memcpy and memset on a list of numbers.

## 119. BLAS and ONNX Runtime: calls at an address

- **Why.** NumPy's matmul is BLAS's, and a model trained in PyTorch runs
  anywhere as an ONNX file through ONNX Runtime, whose C API is a table of
  functions found through one, OrtGetApiBase.
- **At an address.** A library's function quoted `"at an address"` has no
  name in the library: its first input is where it is, a pointer C gave.
  The library is still loaded, and asked for, first. A function with no
  pointer first is turned away when the program is built, and nothing in
  its place is a mistake that says so.
- **use_blas.** `arrays's use_blas()` has matmul go through BLAS's dgemm:
  OpenBLAS as its releases and Linux's packages have it, or NumPy's copy
  (scipy_openblas64_, with 64-bit whole numbers). It says which it found, or
  nothing, and stop_using_blas goes back to Moth's own loops.
- **tools/onnx.moth** loads a model, says its inputs and outputs (name,
  type and shape, -1 for an axis of any length), and runs it: arrays in and
  arrays out, in floats, doubles or 64-bit whole numbers, which
  numbers_convert converts to and from. Windows 11 has ONNX Runtime in
  System32; elsewhere it goes beside the program or where Linux keeps
  libraries. Its mistakes are a `fail with` with what ONNX Runtime said.
- **Tested.** In machine code: abs and strlen called where dlsym (or
  GetProcAddress) says they are; a dense layer as an ONNX model the test
  writes, in floats and doubles, with a wrong input's name, a wrong shape
  and a missing file; and matmul through BLAS giving what Moth's loops give.
  Each runs where ONNX Runtime and OpenBLAS are installed, and is skipped
  where they aren't; CI installs both.

## 120. Python inside Moth

- **Why.** Most of machine learning's libraries are Python's. A Moth
  program that can use them needn't wait for Moth to have its own.
- **tools/python.moth** loads CPython's own library, through its C API at
  addresses (§119): where PYTHON_LIBRARY says, else beside a folder in PATH,
  else as Linux installs it. It runs code, evaluates expressions, imports
  modules, calls functions (with inputs by name), and reads and sets
  attributes and variables. Numbers, text, yes and no, nothing, lists and
  dictionaries go across as each other; an array as a NumPy array, where
  NumPy is; anything else stays a Python object. Python's mistakes are
  Moth's: `Python: ZeroDivisionError: division by zero`.
- **Tested.** In machine code, with the Python the computer has: code,
  modules, values both ways, text beyond ASCII, Python's mistakes and a
  module that isn't there, and with NumPy, arrays both ways. It's skipped
  where Python's library isn't installed.

## 121. Large language models: tools/ai.moth

- **Why.** Programs ask models now: for an answer, for JSON of a shape, to
  use the program's own functions, or for embeddings to search by meaning.
- **What it does.** anthropic() is Anthropic's Messages API, Claude Opus
  5.5 unless a model is named; openai() is OpenAI's; openai_compatible()
  any server that speaks OpenAI's API, as Ollama, LM Studio and vLLM do.
  answer, chat (messages, a system prompt, effort, the reply's text, stop
  reason, tool calls and usage), stream (each piece of the answer to a
  function as it comes, from server-sent events read as they arrive, in
  chunks or not), chat_with_tools (each tool the model uses run, and its
  result sent back, until it answers; one that fails is sent back as an
  error), answer_json (structured outputs, from a JSON Schema), embed (an
  array, a row for each text), and vectors searched by cosine similarity,
  as one matmul.
- **Keys.** Only from the environment: ANTHROPIC_API_KEY for Anthropic, and
  OPENAI_API_KEY for OpenAI or a server that's said to want one. They're
  never kept in a value or shown, and each goes only to its own API.
- **Refusals.** On Claude Fable 5.1, Opus 5.5, Opus 5 and Sonnet 5.5, a
  request goes with `fallbacks: "default"`, so one the model declines is run
  again on another, on Anthropic's servers; `"fallbacks" is no` turns that
  off. After a fallback part of the way through, the turn sent back holds
  only the text from before it, not tool uses or thinking, and that tool
  use isn't run.
- **Tested.** ai.test.moth on all three engines: what each request says,
  events read from bytes however they're cut, a fallback part of the way,
  and searching vectors. In machine code, against a server of the test's
  own that answers as both APIs do: answers, streams, tools and a tool that
  fails, JSON, embeddings and a search of them, a server that wants no key,
  a wrong key and none, each key only in its own API's header and in no
  request's body. The keys are made up.

## 122. Jupyter

- **Why.** Jupyter is where data work is done, and its notebooks run in
  JupyterLab, VS Code and the rest. `moth notebook` (§77) runs Markdown,
  but people open .ipynb files.
- **moth kernel** runs cells as notebook blocks are run, so a cell has what
  the cells before it made, a cell whose last line is a value shows it, and
  one that fails keeps nothing. Each line it reads names a file holding a
  cell; a number before it numbers the cell as Jupyter does, so mistakes say
  `cell 4:1:5`, but never back, so each cell's name is its own. Unlike a
  notebook's blocks, a cell's output and mistakes go out as they come, and
  it has the kernel's input, so it can ask. A line of byte 1 and
  `moth-cell` comes before a cell's output, then one of byte 1 and
  `moth-done` on the error output and one with `ok` or `failed` on the
  output. Its program and the file it keeps names in have names of their
  own, so two kernels can share a folder. A one-line cell that's a value
  now shows it, and the shell's state file is the shell's record's.
- **editors/jupyter** is a wrapper kernel, ipykernel's `Kernel` with
  `do_execute`, and its kernelspec; `python moth_kernel.py install` installs
  it for the Python that ran it. Each cell goes to `moth kernel`, its output
  to Jupyter as it comes, a whole line at a time, and a mistake as
  Jupyter's error. A Moth program writes a line part of the way only when it
  asks, so output that stops part of the way for a quarter of a second is a
  question, asked in Jupyter's input box, whose answer goes to the cell's
  input and isn't shown twice; where the frontend can't answer, the cell is
  stopped. moth kernel has a process group of its own, so Jupyter's
  interrupt reaches only the Python kernel, which stops the cell's program
  (found in /proc, or with psutil) and keeps the cells before it. If moth
  kernel itself stops, a new one starts and the cell says so.
- **What cells may do.** All of it, unless MOTH_KERNEL_ALLOW gives other
  `--allow` flags: a notebook's code is the person's own, as a Python
  notebook's is.
- **Tested.** Through moth.exe, each line given once the one before is
  done: values, a function, a mistake that keeps nothing, an empty cell,
  the error output, numbering and its never going back, a file that isn't
  there, a question answered, and nothing left behind. In Python, against
  a stand-in for moth kernel that runs each cell as a program of its own:
  output in pieces and in several bytes a character, questions answered and
  not, mistakes, numbers, a cell stopped, moth kernel stopping, and the
  programs a program started; against the moth built here: what cells keep
  and show, a question, a cell stopped, a file beside the notebook, and two
  kernels in one folder; and, where ipykernel and jupyter_client are
  installed, the kernel installed and run as Jupyter runs it, interrupted
  and restarted.

## 123. A web server for many people at once

- **Why.** server.moth answered one request at a time, start to finish: it
  read until a request was whole, answered, and closed the connection. One
  client that stopped halfway held up everyone until it went away, nothing
  limited how long a request could take or how big its headers grew, and each
  request paid for a new connection. That's a server for one person.
- **One thread, many connections.** The server now waits, with poll (WSAPoll
  on Windows), for whichever of its connections has something to say, and on
  non-blocking sockets reads what has come and writes what the connection
  will take. A connection is a record: its stage (agreeing on TLS, reading, or
  writing), what has come, where its headers end, its answer and how much of
  it has gone, and when it's out of time. A round is one wait, of at most 50
  ms so time limits are kept, then each connection that can go on. A whole
  request is given to the handler as before, so a handler is written as it was.
- **Keep-alive.** HTTP/1.1 keeps a connection open for the next request
  unless it says `Connection: close`; HTTP/1.0 only if it asks. Requests sent
  together (pipelined) are answered in the order they came. `set_most_requests`
  closes one after so many (1,000), and `set_keep_alive(no)` after each.
- **Limits.** A request has `set_timeout` (30 s) to arrive once its first
  byte has come and a kept connection `set_idle_timeout` (5 s) to begin the
  next: one that goes over is answered 408 and closed, or just closed if it
  had begun nothing. Bigger than `set_most_bytes` (16 MB) is 413, headers over
  64 KB 431, and a request line, length or chunk that can't be read 400, as
  are two Content-Lengths that differ. Only `set_most_connections` (1,024) are
  held at once; the rest wait in the system's queue (512 deep).
- **Nothing looked through twice.** Looking for the end of the headers starts
  where the last look stopped, and a body in chunks is read on from the last
  chunk read, so a request that comes a byte at a time costs what one that
  comes at once does; before, each byte that came meant looking through all of
  it again. The headers are read once, into a dictionary that says the body's
  length, whether it's in chunks and whether to keep the connection.
- **Writing.** A write that the connection won't take now (its room is full,
  as with an answer of megabytes to a client that reads slowly) waits for poll
  to say it will, where before it was taken for a connection gone, cutting
  the answer short. A connection that's really gone says so to poll (POLLHUP,
  POLLERR), which closes it. An answer has `set_timeout` from each time the
  other end takes some of it, so a long download goes on while it's taken,
  and one the other end has stopped taking is cut off.
- **40 ms.** The first version answered 4,500 requests a second, each 40 ms
  late: the headers and the body went in two writes, and the second waited,
  by Nagle's algorithm, for the client to say it had the first, which the
  client put off for 40 ms. A text answer now goes in one write, and every
  connection has TCP_NODELAY, for an answer in bytes, which is still two.
- **A mistake in the server** while it sees to one connection closes that
  connection, says why to the error output, and the rest go on. stop_serving()
  stops reading and sends what's being sent before serve() returns.
- **What it gave.** tools/load-test.mjs builds a site with server.moth and
  asks it from Node on raw sockets: `steady` is 200 connections each asking
  again as soon as it's answered (on one connection if the server keeps it,
  a new one each time if not), `burst` 200 connections at once, `slow` 200
  requests while 50 connections sit with half a request sent, and `heavy` 200
  connections asking for a page that takes about 1 ms of work. Linux, 4 cores,
  5 s each, the client on the same machine:

  |            | before (1.11.0)              | now                          |
  |------------|------------------------------|------------------------------|
  | steady     | 10,506/s, slowest 7.7 s      | 84,748/s, 99% within 7.4 ms  |
  | burst      | typical 1,018 ms             | typical 8.1 ms               |
  | slow       | none of 200 in 10 s          | all 200, typical 27 ms       |
  | heavy      | 377/s, slowest 14.5 s        | 664/s, slowest 634 ms        |

  Before, connections waited in the queue for seconds, some until the client
  gave up; `slow` never ended, as the first half-sent request held the server.
  `heavy` is limited by its work on one thread; §124's workers take it to
  4,489/s on 4.
- **Tested.** On raw sockets, with time limits of 400 ms: three requests on
  one connection, the last told it's the last; two sent together, then HEAD;
  an answer of nothing (204); HTTP/1.0 with and without keep-alive; a body in
  pieces with a pause between, and one in chunks a few bytes at a time with
  an extension and a trailer, then another request on the same connection; an
  answer of 12.8 MB to a client that waits before reading, then stops five
  times as it reads, far longer than the time limit in all; a
  query with a % that isn't one; 413, 431, 400 for a request that isn't one,
  a length that isn't, two lengths and chunks that can't be read; 408 for a
  request too slow to arrive, and a kept connection closed when it's idle; a
  client sending a byte at a time while another is answered first; and
  stop_serving(). The tests from before (HTTPS, the guestbook app, http.moth's
  and websocket.moth's) pass as they were.

## 124. Workers: every core, sharing nothing

- **Why.** Tasks (§62) take turns: one runs Moth at a time, so a server's
  handlers, or a sum split into tasks, use one core however many there are.
  cores.moth (§75) uses them all, but with copies of the program, each a
  process, started again from the top and talking through files.
- **Isolated workers, not shared threads.** Threads that share memory would
  need every list, record and dictionary, and the runtime's own memory, to be
  safe to change from two threads at once: a lock around each, or a garbage
  collector that stops every thread to look at their memory, and a program
  could still change a list while another thread reads it, which is a race.
  sync.moth's lock is right only because one task runs at a time: it takes a
  lock by seeing it free and marking it held, with nothing in between. So a
  worker shares nothing. It has a copy of the program's variables as they were
  when it started, and copies of its inputs; it changes them as it likes, and
  no one else sees; what it gives back, or the mistake it ends with, is copied
  back when it's waited for. There are no races, sync.moth keeps its promise
  (a worker's tasks take turns among themselves, as the program's do), and
  each worker's collector looks at its own memory alone, with nothing to stop.
  It's what JavaScript's Web Workers, Erlang's processes and Python's
  subinterpreters do.
- **Plain English.** `start count(10) on another core` starts a worker and
  gives a record of its number, `(record with worker 1)`, as `start count(10)`
  gives a task; `wait for` and `has ended` take either, and so do sync.moth's
  wait_for_all and wait_for_any. `on another core` is read only after a
  `start` and its call, where nothing could follow before, so no program that
  worked means anything new, and `on`, `another` and `core` are still names.
- **What can be copied.** Numbers, text, yes and no, nothing, lists, records,
  dictionaries, bytes, amounts, and functions made at the top of a file, which
  share nothing but the program's variables, of which the worker has its own.
  A function made inside another shares that function's variables, so it
  can't go to a worker, nor come back from one; a value nested over 1,000
  deep can't be copied, which a list that holds itself is. Each is a mistake
  where it's started, or waited for; one of the program's variables that holds
  one has no value in the worker.
- **In machine code,** a worker is a thread of the system's (CreateThread on
  Windows; on Linux pthread_create, or clone where the C library isn't
  loaded) running a copy of the program's whole image: its code, its
  read-only data, its variables and the runtime's own memory, the 256 MB stack
  of the program's own thread left out. Every instruction reaches its data by
  a distance from itself, so the copy's code uses the copy's data; the 8-byte
  addresses in the data (a text's bytes, a record's field names, tables of
  texts) are listed when the program is built, and each is moved in the copy
  by how far the copy is from the original. So a worker has its own heap and
  collector, its own variables, its own turn for its own tasks, and its own
  workers, and the program and its workers run Moth at the same moment.
- **Copying between heaps.** Both heaps are in one address space, so the
  worker copies what it's given from the program's heap into its own while
  the program waits, which keeps the program's collector away from what's
  being read; after that it reads nothing of the program's. What it gives back
  waits in its heap until `wait for` copies it into the program's. A text or a
  field's name in the image isn't copied: the same place in the copy is that
  far along, so `x of r` finds its field in a worker as it does in the program.
- **Memory.** An image is made for a worker the first time its slot is used,
  and kept, with its heap, for the next worker in that slot once the program
  has taken the last one's answer; so a program that starts worker after
  worker, as a server does, makes as many images as it has workers at once.
  A server's image is about 0.8 MB, and each heap grows as the program's
  does. 64 workers can have answers nothing has taken yet, and starting a 65th
  is a mistake that says so. A worker ends its own tasks and workers before
  it ends, and the program ends its workers, as it ends its tasks, before it
  ends; `random number` goes on in each worker from where the program had got
  to, each 2^24 numbers further along than the one numbered before it.
- **Windows.** Written as the task threads are: the image's memory from
  VirtualAlloc, readable, writable and runnable; the thread from CreateThread
  with the same stack; a manual-reset event for its end, set before its state
  says it has ended, so a program that wakes early waits again; SwitchToThread
  while the program waits for a worker to copy what it was given; and the
  image's own TLS index and semaphore for its tasks, made once, with the slot
  set for each new thread. It's built and its imports checked on Linux, not
  run there; CI runs on Linux.
- **On the JavaScript engines** a worker runs to its end when it's started,
  as a task does, on copies all the same: the program's variables are swapped
  for copies while it runs and put back after, and what it gives is copied.
  Its own tasks and workers are numbered from 1 while it runs, as in machine
  code, and the limit of 64 is kept. So a program says the same everywhere,
  except what only threads show (a worker that hasn't ended yet).
- **server.moth on workers.** `set_workers(4)`, or `serve_on_workers(8080,
  answer, 4)`, starts 4 workers (0 for one a core) on the one listening
  socket. Each runs §123's rounds with connections of its own, taking one new
  connection a round, so those that wake for the same one share them. A
  handler that works for a second holds up only its own worker's connections.
  A worker that ends with a mistake is said and another started;
  stop_serving() stops the worker it's called on.
- **What it gave.** Four calls of a 40,000,000-round loop, one after another
  and then on four workers, on 4 cores: the workers took 0.27 of the time.
  Eight 30,000,000-round loops: 2,340 ms one after another, 626 ms on eight
  workers. 3,000 workers started and waited for one after another: 0.10 s; 64
  at once, 34 ms. The `heavy` load test of §123: 664/s on one thread, 4,489/s
  on four workers.
- **Tested.** The JavaScript engines, the compiler written in Moth and machine
  code agree on: the program's variables and a worker's inputs, which it
  changes only for itself; functions, records, dictionaries, bytes and amounts
  given and given back; a worker's mistake, kept for `wait for`; what can't be
  copied, at the start and at the end; what isn't a worker; a worker's own
  tasks and workers, numbered from 1; and the limit of 64. In machine code,
  against the JavaScript engine: eight workers at once, each making far more
  than it keeps; workers starting workers; the program's tasks running while
  worker after worker, each in its predecessor's memory, starts tasks of its
  own; 3,000 workers one after another and 64 at once; a list of 100,000
  given and given back; what a worker says, and one never waited for; a
  worker's mistake. And only in machine code: two workers that each wait for a
  file the other writes, which they can do only at the same moment; `has
  ended` on a worker still working; sync.moth's lock among a worker's tasks;
  four workers taking far less time than four calls; and a Windows program's
  imports. server.moth with three workers: twenty requests answered while one
  handler works for a second and a half.
## 125. A WebAssembly back end written in Moth

Moth's web side is about 18,000 lines of JavaScript, and even a program the
WebAssembly engine compiles calls back into `vm.js` for text, dictionaries,
built-ins and every mistake. The plan is a Moth compiler written in Moth that
runs in the browser as WebAssembly, with JavaScript left as a small loader, in
four stages: a WebAssembly back end in Moth; the runtime in WebAssembly, so a
module imports nothing from `vm.js`; `moth.wasm`, the compiler built into a
module that rebuilds itself to the same bytes; and the playground on
`moth.wasm`. This is the first. The rest are still to come, and the JavaScript
engines stay: as the fallback, and as what the tests compare against.

- **A port, byte for byte.** [`wasm.moth`](wasm.moth) is `wasm.js` written in
  Moth: the same encoder, the same runtime functions, the same escape analysis
  and unboxed numbers, the same fast paths for `remainder`, `rounded` and
  `item n of`, and numbers as `wasm.js` keeps them (an i31 from -2^30 to
  2^30-1 that isn't 0 or 1, which are no and yes, and a box otherwise). It
  reads programs with `compiler.moth`'s tokenizer, parser and scope rules, as
  `machine.moth` does, and makes exactly the bytes `wasm.js` makes, as
  `compiler.moth` makes exactly the JIT's JavaScript. Matching byte for byte
  is the strongest check there is: every local, global, type and position
  must come in the same order, so any difference in what the two back ends
  think a program means shows up as a byte.
- **The tree is `compiler.moth`'s.** Its fields differ from `moth.js`'s where
  `of`, `to` and `bytes` can't be field names (`subject`, `start` and `limit`,
  `over`, `binary`), and a number is kept as written, so `wasm.moth` works out
  a double's 8 bytes itself, with exact steps (halving, doubling and
  subtracting), as `machine.moth` does, and keeps one global for each
  different double, keyed by its bytes.
- **Writing code from text.** The runtime is about 450 lines of instruction
  chains in `wasm.js`. In Moth each chain is a line of text, such as
  `local.get 0 ref.test i31 if i32 ...`, which a small assembler turns into
  bytes, knowing each instruction's immediates and the names of the module's
  types, functions, imports, globals and a function's own locals. That kept
  the port close enough to `wasm.js` to check line by line.
- **The runtime once.** Every module starts with the same types, imports,
  runtime functions, exports and globals, so they are made once per run of
  the compiler and copied, with each function's encoded body kept. A program
  then costs only its own code: about 1.5 ms a program through the JIT, 12
  seconds for the 7,822 programs of the test corpora.
- **The escape analysis missed three places.** Making `wasm.moth` meant
  reading every field the parser makes, and `wasm.js`'s escape analysis never
  looked inside `ask`'s question, `wait`'s amount, or `play note`'s note and
  time. A function that used an outer variable only there kept it in a local
  of the program's, not in the heap, and found it unset. Both back ends now
  look there, and a test runs the four programs that showed it on every
  engine.
- **It compiles itself.** `wasm.moth` with `compiler.moth` is a program like
  any other: compiled by itself, it is a 977,707-byte module, `wasm.js`'s bytes
  exactly, in about a second, and that module, run, compiles a program into
  the same bytes again. That is the start of `moth.wasm`; what's missing is
  the runtime, which the module still imports from `vm.js`.
- **Half an emoji.** Holding `wasm.moth`'s mistakes to the VM's, column and
  all, found one more difference, in `compiler.moth`'s tokenizer: half of a
  character past the first 65,536, on its own, sorts among those characters,
  so it counted 2 columns where JavaScript counts 1. It now counts 2 only for
  a character that is 4 bytes of UTF-8.
- **`moth build --target wasm`.** `moth.moth` carries `wasm.moth`, made into
  machine code by `machine.moth` with the rest, and writes `<file>.wasm`:
  `wasm.js`'s module, byte for byte, then a custom section called `moth`
  holding, as JSON, what the JavaScript side needs to run it (each position,
  the names, the messages, the text, and what typed inputs must be).
  `runWasm` in `moth.js` reads that section and runs it. Until the runtime is
  in WebAssembly too, the module still imports `vm.js`'s checks, and with no
  source to hand to the VM, calls past 2,000 deep are a mistake there.
- **Tested.** `wasm.moth`, run through the JIT, makes `wasm.js`'s bytes, or
  stops at the same mistake, on every playground example, every hand-written
  case, the 1,500 programs the grammar makes, the 5,000 broken ones and 500 of
  machine code's random programs; what it makes says, draws and stops at what
  the VM does, mistakes, positions and trails included, on all of them but
  machine code's, and the hand-written cases say what they should. `moth`
  itself, with `wasm.moth` in machine code, builds a module whose bytes are
  `wasm.js`'s, which runs as the VM runs the program, and moth still builds
  itself into the same bytes.

## 126. The VS Code extension, ready to publish

- **Why.** People find VS Code extensions in VS Code's Extensions view, from
  the Visual Studio Marketplace, and editors built from VS Code (VSCodium,
  Cursor, Gitpod) from Open VSX. The extension was a .vsix to make from the
  repository, and it ran whatever `moth.path` said, `moth` by default.
- **Finding moth.** find-moth.js, which needs no VS Code, looks where
  `moth.path` says (the file, or the folder it's in; `~`, a path from the
  workspace's folder, and the quotes Windows' "Copy as path" puts round one,
  all taken), or else in each folder on the PATH, in order: `moth.exe` on
  Windows, where the PATH is Path, split at `;`, with folders in quotes, and
  `moth` on Linux, which must be marked as a program. It's looked for each
  time it's needed, so one installed since is found, and the language server
  starts again when `moth.path` changes. Run, Build, the debugger and moth
  lsp all start the full path found, never a name a shell or Windows would
  look for in the program's own folder first. Where there's none, one
  warning says why (not on the PATH, not where moth.path says, or not marked
  as a program), with **Get Moth**, which opens the releases, and **Don't
  Show Again**, kept between sessions; Run, Build and Debug say it again, as
  they can't do what was asked. Nothing waits for it to be answered. The
  checker and tidying are the engine built in, so the problems, Format
  Document, colours and snippets go on without moth.
- **Folders not trusted.** `moth.path` is a restricted setting
  (`untrustedWorkspaces: limited`): in VS Code's Restricted Mode a folder's
  own settings can't say which program to run, and a moth.path that doesn't
  start at the top is taken from the folder only once it's trusted.
- **Run and Build as tasks.** A terminal whose program is moth closes the
  moment the program ends, so what it said was gone at once. A task with a
  ProcessExecution starts moth the same way, with nothing for a shell to
  quote, but its terminal stays, says how it ended, and gives the program
  its input for `ask`. `"type": "moth"` tasks in tasks.json are made the
  same, from a task provider.
- **The Marketplace's page.** The manifest has an icon (the site's lantern on
  its cord and its moth flying to it, drawn in SVG, images/icon.svg, and made
  a 128-pixel PNG by Chromium), the site's night as the banner, keywords,
  the site as its homepage, issues as its bugs, no Q&A, and Education among
  its categories. The README is for someone who has never heard of Moth:
  what it is, how to get moth, then each feature with a picture taken in VS
  Code. Its pictures are the repository's, by their full address, as vsce
  would make a relative one point at the repository's top, not this folder,
  so the .vsix holds none of them but the icon. e2e/screenshots.mjs takes
  them again: VS Code on a display of Xvfb's, each scene put on it with
  VS Code's API from its extension host, the screen taken by ImageMagick,
  cut, and the GIFs made of its frames.
- **Packing.** vsce, pinned with ovsx and @vscode/test-electron in a
  package-lock.json of the extension's own, so the repository itself still
  needs nothing installed. Its vscode:prepublish script copies the engine
  into engine/, and .vscodeignore lets through only make-vsix.mjs's FILES:
  23 files, about 180 KB. make-vsix.mjs stays, for a .vsix with nothing to
  install, and check-package.mjs holds `vsce ls` and the .vsix to the same
  list, the engine to the repository's, the manifest to package.json, the
  README to pictures on the web, and the whole to under a megabyte.
- **Publishing.** publish-extension.yml runs only by hand, and only from
  main. Its first job packs the extension once, checks it and tests it in VS
  Code; its second, the only one given the tokens or an identity, publishes
  that same .vsix: to the Marketplace with VSCE_PAT and to Open VSX with
  OVSX_PAT, each skipped with a notice where its secret isn't set. vsce and
  ovsx read them from the environment. Azure DevOps retires the global
  tokens the Marketplace takes on December 1, 2026, so where there's no
  VSCE_PAT and the VSCE_TRUSTED_PUBLISHING variable is true, it publishes
  with `vsce publish --oidc`, the Marketplace's Trusted Publishing, which
  takes the run's own GitHub identity. docs/publishing-the-extension.md
  says how to set each up. The extension's version is its own, 0.1.0.
- **What it needs of moth.** Run, Build, questions and tasks work with
  moth 1.11.0, the latest release; moth lsp and the debugger need a newer
  one, so it's best published with Moth's next release.
- **Tested.** editor.test.js: finding moth on Linux's paths, and on
  Windows' (with a stand-in for the disk); the message, its buttons, Don't
  Show Again kept, and nothing waiting for an answer; the server started
  again with a new moth.path; Run, Build and a tasks.json task as tasks;
  the .vsix's files, its licence the repository's, and .vscodeignore's list.
  e2e/suite.js, in VS Code itself, on the extension as the .vsix has it, with
  moth in a folder with spaces in its name and with none: it starts, a
  broken file's problem, a problem as it's typed and its Quick Fix, Format
  Document, the outline and Go to Definition, the snippets, and with moth,
  Go to Definition into a used file, a hover and completion from moth lsp,
  Build and Run (moth build's program made, both ending with 0, and the
  output kept), a question answered in the terminal, a tasks.json task, and
  the debugger stopped at a breakpoint with its variables. CI runs it in the
  newest VS Code and in 1.75, the oldest the extension says it works in;
  it replaces in-vscode.js, which needed MOTH_VSCODE=1 and an installed
  VS Code.

## 127. The standard library from a package

- **Why.** A package couldn't use the standard library. `use "text.moth"`
  in packages/datey/datey.moth names packages/datey/text.moth, from the
  folder of the file that uses it (§60), and moth.moth's cli_sources_of
  asked the standard library for a file by that name, which it hasn't. So
  every package carried copies of the libraries it needed, and a file in a
  folder of the program's own had the same trouble.
- **The rule, kept.** SPEC.md's 10.1 and §74 already said it: a file is
  found from the folder of the file that uses it, and if it isn't there, the
  standard library's is used. So cli_sources_of now asks the library for the
  name the `use` line gives in quotes (cli_uses_in keeps it beside the path),
  not the path it makes. A file of the same name beside the file that uses
  it still comes first: the package's own text.moth beats moth's, as the
  program's beats it for the program. A file beside the program is the
  program's alone, as it was: a package never saw it. `use the package` and
  a name with a folder in it (`use "sub/text.moth"`) are never the
  library's.
- **A copy of its own.** The parsers ask for a file by its path from the
  program's folder, so moth's text.moth goes to them as
  packages/datey/text.moth, and a package's copy is its own, as the copy it
  carried in its folder was: the same names, the same top level, and no
  change to the parsers or engines. A mistake in it says it's in
  packages/datey/text.moth, as one in moth's own text.moth says text.moth.
- **Everywhere `use` is resolved.** Every command that reads a program's
  files goes through cli_sources_of: run, build, `build --web` (whose page
  holds the copies by those names), `build --target wasm`, test, debug,
  profile, coverage, check, the shell, notebooks and the language server,
  whose definitions and hovers now read a file as a run finds it.
  machine.moth, wasm.moth and the JavaScript engines are given the files by
  name and look nothing up themselves, and the playground fetches files
  from its own site.
- **Tested.** Through moth.exe: a package in a Git repository whose main
  file uses text.moth and dates.moth, and a file of its own that uses them
  too, added with `moth add`, then used by a program that has a text.moth of
  its own: run, checked, built and run as a program of its own, built as a
  page (which runs on the JavaScript engine and holds moth's copies under
  the package's names), built as a WebAssembly module and run, and tested
  with `moth test`; a json.moth in the package beating moth's; and a name
  the library hasn't, still a mistake.

## 128. Measuring machine code before making it faster

- **Why.** machine.moth already knows what each variable holds (§32), works
  out what each function is given (§48), puts small functions in line (§63)
  and reads lists and records where the code is (§64). What's left to make
  faster had to be found by measuring, not guessed: so first the benchmarks
  cover what they didn't, and the instructions are counted where they run.
- **More benchmarks.** `npm run bench -- --big` had loops, lists, records,
  a dictionary and joining text. It now also has calls the compiler can't
  put in line (a function of four inputs that sets two variables first),
  a function with a loop of its own (Collatz's steps), records made by
  functions, text built two letters at a time, each letter of a text compared
  with others, a grid read by `item c of item r of grid`, and a dictionary
  whose keys are made as text. And a real program: moth, as bootstrap.mjs
  makes it, building compiler.moth, 2,400 lines of Moth.
- **Counting instructions.** A short run of machine code takes 10% more or
  less from one run to the next, on this machine at least. The number of
  instructions it runs is the same every time, so `node bench-count.mjs
  program.moth` counts them with valgrind's callgrind and says how many ran
  in each of the program's functions and each of the runtime's routines. It
  builds the program with machine.moth on Node.js with a heap of 4 GB, not
  64, which valgrind can't give a program, and keeps machine.moth's
  assembler, for where each function and routine starts.
- **Where the time goes.** moth building compiler.moth runs 3.58 billion
  instructions. 12% are comparing two values with `is` (rt_equal and
  rt_cmp_is), nearly always a text with a text the program wrote, as in `if
  kind of node is "call"`: about 80 instructions, through two routines and
  `repe cmpsb`, for what can't fail. 9.5% are `bit and` and the shifts
  (rt_bits, rt_bit_and, rt_shift_right), which machine.moth's put32 and the
  rest do for every byte they write: each calls rt_bits twice, about 60
  instructions, to `and` two whole numbers. 22% is the collector and making
  blocks, 6% the code kept out of the way for when something's unusual
  (`add x to xs` with a list, among it), and the rest is spread out. In the
  benchmarks: a call of `distance(i, 0, 0, i bit and 1023)` spends 58% of its
  instructions on the `bit and`; comparing letters, 54% on `is`; Collatz's
  steps, 43 instructions each, as `n / 2` makes its loop's variable a
  fraction as far as the compiler knows; and primes, its 64-bit division,
  which C's 32-bit one does in 24 ms to the 40 ms the 64-bit one takes.
- **Where it starts.** On Linux, an Intel Xeon at 2.8 GHz with 4 cores, Node
  22, machine code timed from start to finish, starting up included:

  | `npm run bench` | Machine code |
  |:--|--:|
  | a program that only starts | 2.5 ms |
  | fib(25), function calls | 3.1 ms |
  | sum 1 to 1,000,000, a loop | 2.8 ms |
  | primes up to 5,000, lists | 18 ms |
  | 200,000 records, made and read | 14 ms |
  | 1,000,000 bytes, filled and summed | 37 ms |
  | 200,000 words counted, dictionary | 14 ms |
  | recursion 10,000 deep | 3.1 ms |

  With work big enough, starting up taken off (best of two runs of five):

  | `npm run bench -- --big` | JIT | WebAssembly | Machine code |
  |:--|--:|--:|--:|
  | 2,000,000 records | 181 ms | 78 ms | 68 ms |
  | list: 3,000,000 adds, then summed by item | 172 ms | 117 ms | 55 ms |
  | list: `for each` over 3,000,000 | 205 ms | 117 ms | 53 ms |
  | list: `set item` 5,000,000 times | 285 ms | 113 ms | 28 ms |
  | dictionary: 2,000,000 counts | 246 ms | 163 ms | 104 ms |
  | 300,000 records in a list | 139 ms | 131 ms | 37 ms |
  | text: join 200,000 pieces | 70 ms | 89 ms | 20 ms |
  | calls: 4 inputs, 3,000,000 times | 375 ms | 166 ms | 44 ms |
  | calls: a loop in each, 300,000 times | 1,135 ms | 1,092 ms | 267 ms |
  | records: 2 calls make 2, 1,000,000 times | 204 ms | 65 ms | 68 ms |
  | text: 2 letters added, 1,000,000 times | 202 ms | 81 ms | 35 ms |
  | text: 2,000,000 letters, each compared | 148 ms | 579 ms | 350 ms |
  | list: a grid, item of item, 4,000,000 | 117 ms | 93 ms | 30 ms |
  | dictionary: 300,000 keys made, set, read | 424 ms | 386 ms | 175 ms |
  | moth building compiler.moth | | | 697 ms |

  | `npm run versus` | C (gcc -O2) | Rust | Moth, machine code |
  |:--|--:|--:|--:|
  | fib(32): 7 million calls | 9 ms | 13 ms | 23 ms |
  | adding 1 to 100,000,000 | 50 ms | 4 ms | 46 ms |
  | primes up to 300,000 | 29 ms | 29 ms | 45 ms |
  | 30,000,000 steps of decimal maths | 41 ms | 41 ms | 41 ms |

  And counted: fib(32), 152 million instructions; primes, 282 million;
  Collatz's steps, 1,432 million; the letters compared, 1,161 million; the
  calls of four inputs, 573 million; moth building compiler.moth, 3,579
  million. The sections after this one each say what they changed, from
  these.

## 129. A library for C: moth build --library

- **Why.** Moth could call C (§45) and Python (§120), but nothing could call
  Moth: a fast function written in it was only any use to another Moth
  program. A shared library with a C ABI is what every language can call:
  C, Python's ctypes, Rust, Go, C#, Node.
- **The file.** On Linux an ELF shared object, loaded anywhere: every
  instruction already reaches its data by a distance from itself (as workers
  rely on, §124), and the 8-byte addresses in the data, which absolute()
  lists, become R_X86_64_RELATIVE relocations. The read-only data is in a
  writable segment the linker makes read-only again once it has moved them
  (PT_GNU_RELRO). Its dynamic symbols, a SysV hash table and section headers
  are enough for dlopen, and for gcc to link C to it with `-lfast`. It wants
  the C library's `environ`, for programs it runs, and `dlopen` and `dlsym`
  for a program that uses a library, as §45's do. On Windows a DLL: an
  export directory, names in order as GetProcAddress halves them, base
  relocations for the same addresses, no entry point, and the same imports.
- **What it exports.** Each function the main file makes at its top level
  (not one of a file it uses, a library block's, or one the parser made),
  by its name: `int fib(moth_value *result, moth_value n)` in Windows x64's
  convention or System V's, as §46's callbacks take theirs. A `moth_value` is
  a value's own 8 bytes, so a number is its double. One that's only ever
  called by its name, with inputs in registers (§63), is called straight;
  any other as a call through its name's value is, its inputs checked by its
  description. C may give it anything, so the guesses (§48) know nothing of
  its inputs. Names starting with `moth_` are the library's own, and a
  program's function of such a name is a mistake when it's built.
- **The value API.** Pure functions for what needs no memory (`moth_number`,
  `moth_number_of`, `moth_yes_or_no`, `moth_nothing`, `moth_kind`) or only
  reads it (`moth_text_utf8`, `moth_bytes_data`, `moth_list_length`,
  `moth_list_numbers`, `moth_exports`); and functions shaped as the program's
  are for what makes or finds values: `moth_text`, `moth_bytes`,
  `moth_numbers`, `moth_list`, `moth_list_add`, `moth_list_item`,
  `moth_dictionary`, its `_set`, `_get` and `_keys`, `moth_record_names` and
  `_values`, `moth_call`, `moth_keep` (a value kept once more), and
  `moth_free`. `fast.h` declares them, with the
  program's own functions.
- **Whose a value is.** What the library gives C is kept from the collector
  in a list among its roots until C gives it to moth_free, which takes the
  last place it's kept (so a value given twice is freed twice). What C gives
  a function stays C's. Numbers, yes, no and nothing are kept nowhere.
- **Mistakes.** Every call is made inside a `try` of its own, so a mistake,
  or `fail with`, gives 1 and, in `*result`, `(record with message, line,
  column, file, value)`: a site in a library carries its file, line and
  column after what a program's has. What the runtime would end the process
  for (memory run out) stops the call in progress the same way. What would
  have to end it is a mistake when it's built: `stop the program`, tasks and
  workers (which outlive a call), drawing and an app's handlers, sounds, and
  callbacks from C.
- **Started once.** The first call runs what a program's start does, then
  the program's top level, inside a try; a top level that fails gives its
  mistake to every later call of the program's functions, while the value
  API still works, to read it.
- **One at a time, from any thread.** One heap and one collector, as in §62,
  so a lock: a ticket lock with a futex on Linux, as tasks take their turn,
  and an SRW lock on Windows. A call from the thread that holds it (C called
  by Moth, calling back in) goes on inside it, so it can't wait for itself.
  Running Moth from several threads at once would need what workers do: an
  image each.
- **Its own stack.** Moth allows 100,000 calls in progress, which can take
  far more than a thread C made has, so each call moves to the library's own
  256 MB stack (in the zeroed data on Linux; on Windows committed at the
  first call, the TEB's stack fields set to it while Moth runs, so Windows'
  probes and exceptions see where the stack is) and back. The collector
  looks through it alone: C's frames hold nothing it keeps.
- **What it costs.** A call of a function that gives 1 takes about 30 ns
  from C. fib(30) runs as fast as in a program of its own.
- **Tested.** A C program, built with gcc and linked to the library, calls
  it with every kind of value and the value API, gets mistakes as records
  (a `fail with`, one of the runtime's, an input of the wrong kind, and the
  value API's), calls a function Moth made, runs eight threads at once that
  lose no count, recurses 50,000 deep from a 256 KB thread stack (and is
  told 200,000 is too deep), and holds 100 values through two million
  lists' collections; a library whose top level fails; each mistake a
  library can't be built with; `moth build --library` with gcc linking C
  to what it wrote; and a Windows DLL read as Windows reads it. On Windows,
  CI runs the same C program against the DLL.
