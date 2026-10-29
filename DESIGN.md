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
