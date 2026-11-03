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
  in line where they're called.

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
- **Not yet.** Sending a task its input, threads of the program's own, and
  telling its output from its error output.

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
