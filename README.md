# Moth

[![tests](https://github.com/samyyy2423/moth/actions/workflows/test.yml/badge.svg)](https://github.com/samyyy2423/moth/actions/workflows/test.yml)

A programming language that reads like plain English, written from scratch in
JavaScript with no libraries. It has two engines that must agree: a bytecode
virtual machine, and a JIT that compiles Moth to JavaScript and runs 6–9×
faster. It also has a checker that finds mistakes before the code runs, turtle
drawing, a debugger that can go backwards in time, and a `moth` command with
its own shell.

Moth's compiler is also written in Moth: [`compiler.moth`](compiler.moth),
1,100 lines that compile any Moth program, itself included, to exactly the
JavaScript the JIT writes, byte for byte. And a neural network written in Moth
learns to sort dots, with backpropagation and every bit of maths done in Moth.
**[Try it in the playground](https://samyyy2423.github.io/moth/)**.

<p>
  <img src="docs/spiral.svg" alt="A colour spiral drawn by Moth" width="300">
  <img src="docs/tree.svg" alt="A tree drawn by a Moth function that calls itself" width="300">
</p>

Both pictures were drawn by Moth programs (the Spiral and Tree examples) and
saved with `moth run`. The tree is a function that calls itself:

```
to branch with size
    if size is less than 6
        return
    end
    move forward size
    turn left 25
    branch size * 0.72
    turn right 50
    branch size * 0.72
    turn left 25
    pen up
    move back size
    pen down
end

branch 105
```

## A neural network, written in Moth

[`neural.moth`](neural.moth) is a small neural network that learns, written
from scratch in Moth, after Andrej Karpathy's
[micrograd](https://github.com/karpathy/micrograd). Every number it works out is
a record that remembers how it was made, so after each guess, backpropagation
can trace how much every weight was to blame. Moth has no random numbers and no
sine, so the program makes its own. It learns to tell apart two moons of dots,
from 50% right to 100% in 60 steps, and draws what it believes as it goes:

<p><img src="docs/neural.svg" alt="Four pictures of what the network believes: before training it calls almost everything blue; at step 8 and step 20 the boundary bends between the moons; at the end it wraps around both moons exactly. Below, the loss falls from 1.17 to 0.006." width="600"></p>

Top left: before training. Top right: step 8. Bottom left: step 20. Bottom
right: after 60 steps. Below: the loss, step by step. Backpropagation reads
like this:

```
for each i from 1 to count
    set v to item (count - i + 1) of order
    set g to grad of v
    set left to a of v
    if op of v is "+"
        set right to b of v
        set grad of left to grad of left + g
        set grad of right to grad of right + g
    else if op of v is "*"
        set right to b of v
        set grad of left to grad of left + data of right * g
        set grad of right to grad of right + data of left * g
    else if op of v is "relu" and data of v is greater than 0
        set grad of left to grad of left + g
    end
end
```

It trains in about 0.6 seconds on the JIT. Open **Neural network** in the
playground to watch it learn.

## The language

```
# comments start with #
set name to "Moth"                  # store a value
set fruits to list of "apple", "pear"
add "mango" to fruits               # add to a list, a number, or text
set item 1 of fruits to "kiwi"      # items are counted from 1

say "Hi, " name "!"                 # say joins the pieces exactly as written
say "I have " length of fruits " fruits"

if length of fruits is greater than 2
    say "lots of fruit"
else if fruits is empty list
    say "no fruit"
else
    say "some fruit"
end

repeat 3 times
    say "hip hip hooray"
end

set n to 1
repeat while n is less than 100
    set n to n * 2
end

for each fruit in fruits
    say fruit
end
for each i from 1 to 3
    say i
end

to area with width and height       # make a function
    return width * height
end
say "area: " area(3, 4)             # use it inside a value with brackets

to greet with person
    say "Hello, " person
end
greet "Sam"                         # or call it on its own line

set sam to record with name "Sam", age 20   # a record keeps named values together
set age of sam to 21
say name of sam " is " age of sam

to check_age with age
    if age is less than 0
        fail with "an age can't be below 0"  # stop with your own message
    end
end

# drawing: the turtle starts in the middle, facing up, with its pen down
move forward 100                    # or: move back 50
turn right 90                       # or: turn left 45
pen color "tomato"                  # any CSS color name
pen width 3
pen up                              # move without drawing
pen down
```

- Values: numbers, `"text"`, `yes`, `no`, `nothing`, lists, and records.
- Comparisons: `is`, `is not`, `is less than`, `is greater than`, `is at least`,
  `is at most`, `is divisible by`. Combine them with `and`, `or`, `not`.
- Math: `+ - * /`. Adding text to anything joins them into text.
- Inside a function, `set` changes a variable that the top level (or an
  enclosing function) also sets; otherwise the variable stays inside the
  function. Functions remember the variables around them (closures).
- Only `no` and `nothing` count as false. Upper or lower case doesn't matter.
- Text holds any character except control characters; write `
` for a new
  line and `	` for a tab.

Mistakes get a plain-words message that points at the exact spot. Moth
suggests the right name when you misspell one, and the right word when you type
a symbol from another language:

```text
line 3: there is no item 5, the list only has 2 items
say item 5 of fruits
    ^
```
```text
line 2: 'totl' has no value yet. Did you mean 'total'?
say "Total: " totl
              ^
```
```text
line 1: there is no function called 'sya'. Did you mean 'say'?
sya "hi"
^
```
```text
line 1: I don't understand '>' (write 'is greater than')
if x > 5
     ^
```

## The playground

[The playground](https://samyyy2423.github.io/moth/) runs in any browser, with
nothing to install.

![The playground's time-travel debugger, halfway through drawing the tree: line 16 highlighted, the tree half drawn, and the variables of the 8 nested calls](docs/debugger.png)

- **Run** runs the code in a background thread, so **Stop** works even on a
  loop that never ends. Drawings appear on a canvas as they're drawn.
- **Debug** is a time-travel debugger. It records the whole run, then **Back**,
  **Step**, **End** and a slider move through it in either direction. At every
  step it highlights the line about to run and shows the calls in progress,
  every variable in view (including the ones a closure remembers from the
  function it was made in), and the output and drawing as they were at that
  moment. Drag the slider and watch the tree grow and shrink.
- **Problems** appear as you type, without running anything: red wavy lines
  under code that will fail when it runs, yellow under code that never runs or
  is never used. Click one to jump to it.
- **Share** puts the code into the link, so opening the link opens the program.
- **Compiled** shows what the code turned into: the VM's bytecode, the
  JavaScript the JIT made, or the JavaScript from the compiler written in Moth,
  checked against the JIT's.
- **Neural network** trains the network and draws it learning.
- The last example, **Moth's own compiler**, is `compiler.moth` itself, with
  a line at the end that uses it to compile some Moth.

![The checker in the playground: wavy lines under five mistakes, listed under Problems, found without running the code](docs/checker.png)

## Command line

```bash
npm install -g github:samyyy2423/moth
```

| Command | What it does |
|---|---|
| `moth` | Starts the Moth shell |
| `moth run hello.moth` | Runs a program. If it draws, the drawing is saved as `hello.svg` |
| `moth check hello.moth` | Finds mistakes without running it |
| `moth build hello.moth` | Compiles it to `hello.mjs`, which runs with plain `node` and doesn't need Moth installed |
| `moth bytecode hello.moth` | Shows the bytecode the compiler made for the VM |
| `moth js hello.moth` | Shows the JavaScript the JIT made |
| `moth bootstrap` | Compiles the compiler written in Moth with itself, three times over |

`moth check` gives each problem the same words the error would have when the
line runs:

```text
bad.moth:2:10: will fail: can't use '*' on text and a number
say name * 2
         ^
bad.moth:5:5: never runs: this line can never run, because 'return' comes first
    say "never"
    ^
bad.moth:7:5: will fail: 'double' needs 1 input but got 2
say double(1, 2)
    ^
bad.moth:8:1: unused: 'spare' is set but never used
set spare to 5
^
```

The shell remembers what you made in earlier entries and waits for a block's
`end` before running it:

```text
moth> set name to "Sam"
moth> to greet with who
....>     say "Hello, " who
....> end
moth> greet name
Hello, Sam
```

`moth bytecode` shows the compiler's output, for example the start of FizzBuzz:

```text
main:
     0  CONST         0        ; 1
     2  CONST         1        ; 15
     4  CHECK_RANGE
     5  RANGE_NEXT    66
     7  SET           0 1
    10  GET           0 1 2    ; n
    14  CONST         3        ; 15
    16  COMPARE       5        ; is divisible by
    18  JUMP_IF_FALSE 26
    20  CONST         4        ; "FizzBuzz"
    22  SAY           1
```

`moth bootstrap` shows the compiler written in Moth compiling itself:

```text
compiler.moth: 1098 lines of Moth, which the JIT compiles to 93952 characters of JavaScript
stage 1, made by the JIT, compiles compiler.moth: the same JavaScript (76 ms)
stage 2, made by stage 1, compiles compiler.moth: the same JavaScript (56 ms)
stage 3, made by stage 2, compiles compiler.moth: the same JavaScript (61 ms)
fixed point: the compiler written in Moth compiles itself to exactly what the JIT makes of it
```

Errors give the file, line, and column, so editors can jump straight to them:

```text
errors.moth:3:5: there is no item 5, the list only has 2 items
say item 5 of fruits
    ^
```

## How it works

| File | What it is |
|---|---|
| [`moth.js`](moth.js) | Tokenizer, parser, bytecode compiler, and the public API (`run`, `check`, `compile`, `timeline`...) |
| [`scope.js`](scope.js) | Which variable each name means, shared by every back end so they can't disagree |
| [`vm.js`](vm.js) | The virtual machine, plus every check and error message both engines use. It imports nothing, so `moth build` copies it into compiled programs |
| [`jit.js`](jit.js) | The JIT: Moth to JavaScript, which V8 compiles to machine code |
| [`checker.js`](checker.js) | Finds mistakes without running the program |
| [`compiler.moth`](compiler.moth) | Moth's compiler written in Moth: tokenizer, parser, scope rules and JavaScript writer |
| [`neural.moth`](neural.moth) | A neural network written in Moth, with its own random numbers, sine, and backpropagation |
| [`cli.js`](cli.js) | The `moth` command and shell |
| [`index.html`](index.html), [`worker.js`](worker.js) | The playground. Each run gets its own Web Worker, so **Stop** works even on a loop that never ends |

1. **Tokenizer**: one regular expression cuts the source into words, numbers,
   text, and symbols, each with its line and column.
2. **Parser**: recursive descent builds a syntax tree. Every node keeps the token
   it came from, so errors can point at it.
3. **Scope**: gives every variable a numbered slot, once.
4. Then one of three back ends:
   - **Bytecode compiler and VM**: 36 opcodes, run by one loop with its own
     stack, so recursion goes 100,000 calls deep and the debugger can pause it.
   - **JIT**: each Moth function becomes a JavaScript function and each
     variable a JavaScript variable, so V8 can keep them in machine registers.
   - **Checker**: works out every variable's type and tests each operation
     without running it.

The compiler written in Moth repeats steps 1–3 and the JIT in Moth, with
records for the syntax tree. `load()` runs a Moth program and hands its
functions to JavaScript, which is how `mothCompiler()` runs it.

**Run** uses the JIT. The debugger and the shell use the VM. The JIT hands deep
recursion (more than 2,000 calls) to the VM, without showing any output twice.

| Benchmark (`npm run bench`) | v1 tree-walker | v2 bytecode VM | v3 JIT |
|---|---|---|---|
| fib(25), function calls | 60 ms | 67 ms | **7.2 ms** |
| sum 1 to 1,000,000, a loop | 163 ms | 56 ms | **7.5 ms** |
| primes up to 5,000, lists | 320 ms | 106 ms | **17 ms** |
| 200,000 records, made and read | | 87 ms | **15 ms** |
| recursion 10,000 deep | fails | 4 ms | 5 ms (handed to the VM) |

How each engine was made fast, what didn't work, and the other design decisions
are in **[DESIGN.md](DESIGN.md)**.

## Testing

`npm test` runs on every push. It checks:

- every playground example's output
- tables of programs with their exact output, and broken programs with their
  exact error messages and positions, all run on **both** engines
- a fuzzer that randomly breaks 5,000 programs. Each one must fail with a proper
  Moth error, never a JavaScript crash, and the JIT must match the VM exactly:
  the same output, the same drawing, the same error at the same spot
- the checker against reality, on 3,000 more broken programs: no line it says
  will fail ever runs in a program that finishes, and its message matches the
  real error when the program does fail there. It predicts 44% of runtime
  errors before running, with no false alarms
- the compiler written in Moth against the JIT, on every example, every table
  program and 3,000 broken ones: the same JavaScript byte for byte, the same
  positions, and the same mistakes
- bootstrapping: `compiler.moth` compiles itself, and the compiler that makes
  does too, three stages deep, each writing the same JavaScript
- the neural network, trained on both engines: the same output and the same
  drawing, line for line, and every dot on the right side at the end
- every `moth` command, run as a real process

The tests are tested too: bugs planted on purpose in the VM, the JIT and the
checker were caught, one of them only by the JIT-versus-VM fuzzer. Two bugs
planted in `compiler.moth` were caught too, one of them only by its fuzzer, and
a backpropagation bug planted in `neural.moth` left it stuck at 50%.

## Limits

- No dictionaries, `break`, text functions (like upper case or split), or imports.
- These words are part of the language and can't be variable names:
  `set add say if else end repeat while for to return and or not is yes no
  nothing list empty length item move turn pen record fail`.
- Recursion goes up to 100,000 calls deep.
- The checker only warns when it is sure, so it misses some mistakes: the length
  of a list, and a name used before the line that sets it.
- The playground shows the first 10,000 lines of output, and the debugger
  records the first 10,000 steps.
- In the shell, Ctrl+C stops a program that never ends by quitting the shell.
- The compiler written in Moth gives up on code nested more than about 245
  brackets deep (the JIT goes to about 1,000). Moth sees text as whole
  characters, so text holding half an emoji (which no file can hold) can come
  out differently from the JIT's.

## Run it from the source

```bash
npm test
```
```bash
npm run bench
```
```bash
node cli.js run hello.moth
```

To open the playground on your own computer, serve the folder (browsers won't
load JavaScript modules or workers straight from disk), then go to
http://localhost:8000:

```bash
python -m http.server
```

MIT licensed.
