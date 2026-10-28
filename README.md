<div align="center">

<h1>Moth</h1>

<p><b>A programming language that reads like plain English.</b><br>
Written from scratch in JavaScript, with no dependencies.</p>

<p>
<a href="https://samyyy2423.github.io/moth/"><b>Open the playground</b></a>
&nbsp;·&nbsp;
<a href="#the-language">The language</a>
&nbsp;·&nbsp;
<a href="DESIGN.md">How it's built</a>
&nbsp;·&nbsp;
<a href="https://github.com/samyyy2423/moth/releases/tag/v1.0.0">Release 1.0</a>
</p>

<p>
<a href="https://github.com/samyyy2423/moth/actions/workflows/test.yml"><img src="https://github.com/samyyy2423/moth/actions/workflows/test.yml/badge.svg" alt="tests"></a>
<a href="https://github.com/samyyy2423/moth/releases/latest"><img src="https://img.shields.io/github/v/release/samyyy2423/moth?color=4f8ff7" alt="latest release"></a>
<img src="https://img.shields.io/badge/dependencies-none-2ea043" alt="no dependencies">
<a href="LICENSE"><img src="https://img.shields.io/github/license/samyyy2423/moth?color=6e7681" alt="MIT license"></a>
</p>

<img src="docs/handwriting.gif" width="760" alt="Drawing digits in the playground: a 2, a 7 and a 5, and a neural network written in Moth reads each one">

<sub>A neural network written in Moth, reading digits drawn in the playground.</sub>

</div>

<br>

Moth reads the way you'd say it out loud. It's small enough to learn in an
afternoon, and built like a real language underneath: three engines that must
agree on every result, a compiler written in Moth itself, a debugger that runs
backwards, and neural networks written in it.

<table>
<tr>
<th width="58%">Moth</th>
<th>What it says</th>
</tr>
<tr>
<td valign="top">

```
set fruits to list of "apple", "pear"
add "mango" to fruits

for each fruit in fruits
    say "I like " fruit
end

to area with width and height
    return width * height
end
say "3 by 4 is " area(3, 4)
say item 5 of fruits
```

</td>
<td valign="top">

```text
I like apple
I like pear
I like mango
3 by 4 is 12

line 12: there is no item 5,
the list only has 3 items
```

</td>
</tr>
</table>

<table>
<tr>
<td width="50%" valign="top"><img src="docs/debugger.png" alt="The playground's time-travel debugger, halfway through drawing a tree: the line about to run highlighted, the tree half drawn, and the variables of eight nested calls"></td>
<td width="50%" valign="top"><img src="docs/checker.png" alt="The checker in the playground: wavy lines under five mistakes, listed under Problems, found without running the code"></td>
</tr>
<tr>
<td valign="top"><b>A debugger that goes backwards.</b> It records the whole run, so a slider moves through it either way, showing every variable as it was.</td>
<td valign="top"><b>Mistakes found as you type.</b> Wavy lines mark code that will fail, in the same words as the error it would stop with.</td>
</tr>
</table>

## What makes it different

**Three engines that agree.** Every program can run on a bytecode virtual
machine, on a JIT that compiles it to JavaScript, or as WebAssembly that Moth
writes byte by byte. All three must say, draw and fail exactly alike, and 5,000
randomly broken programs check that they do on every push. WebAssembly is the
fastest:

| `npm run bench` | VM | JIT | WebAssembly |
|:--|--:|--:|--:|
| fib(25), function calls | 67 ms | 6.8 ms | **4.7 ms** |
| a million-round loop | 55 ms | 7.1 ms | **2.6 ms** |
| primes up to 5,000 | 104 ms | 17 ms | **13 ms** |
| 200,000 records | 86 ms | 14 ms | **7.7 ms** |
| the neural network below | 3.1 s | 0.58 s | **0.33 s** |

**A compiler written in Moth.** [`compiler.moth`](compiler.moth) is 1,100
lines of Moth that compile any Moth program, itself included, to exactly the
JavaScript the JIT writes, byte for byte. Compiled by itself, it compiles itself
again, and again, to the same result:

```text
$ moth bootstrap
compiler.moth: 1098 lines of Moth, which the JIT compiles to 93952 characters of JavaScript
stage 1, made by the JIT, compiles compiler.moth: the same JavaScript (76 ms)
stage 2, made by stage 1, compiles compiler.moth: the same JavaScript (56 ms)
stage 3, made by stage 2, compiles compiler.moth: the same JavaScript (61 ms)
fixed point: the compiler written in Moth compiles itself to exactly what the JIT makes of it
```

**Neural networks, written in Moth.** [`neural.moth`](neural.moth) learns to
tell apart two moons of dots, after Andrej Karpathy's
[micrograd](https://github.com/karpathy/micrograd): every number it works out is
a record that remembers how it was made, so backpropagation can trace each
weight's share of the blame. Moth has no random numbers, sine or `exp`, so
[`math.moth`](math.moth) writes them in Moth too. From 50% right to 100% in 60
steps:

<p align="center"><img src="docs/neural.svg" width="560" alt="Four pictures of what the network believes: before training it calls almost everything blue; at step 8 and step 20 the boundary bends between the moons; at the end it wraps around both moons exactly. Below, the loss falls from 1.17 to 0.006."></p>

<details>
<summary>Backpropagation, in Moth</summary>

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

</details>

**It reads your handwriting.** The network at the top of this page learned
from digits Moth drew itself: there's no dataset.
[`digit-shapes.moth`](digit-shapes.moth) holds each digit as pen strokes and
bends them at random, [`digits.moth`](digits.moth) turns strokes into 16×16
pictures and runs the network, and [`digits-train.moth`](digits-train.moth)
trains it on 3,000 pictures in about 7 seconds, then writes what it learned as a
Moth file: 99% right on drawings it hadn't seen.

```bash
moth run digits-train.moth --engine wasm > digits-model.moth
```

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
for each i from 1 to 100
    if i is divisible by 7
        stop                        # leave the loop
    end
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

set words to split "the quick fox" by " "   # text: split, join, uppercase, lowercase
say uppercase of item 2 of words " " join words with "-"
say position of "fox" in "the quick fox"    # 11: where it starts, or 0
set age to number of ask "How old are you?" # ask: the answer typed in, as text

use "math.moth"                     # another file's code: random numbers, sine, exp, sqrt

# drawing: the turtle starts in the middle, facing up, with its pen down
move forward 100                    # or: move back 50
turn right 90                       # or: turn left 45
pen color "tomato"                  # any CSS color name
pen width 3
pen up                              # move without drawing
pen down
```

- **Values:** numbers, `"text"`, `yes`, `no`, `nothing`, lists and records.
  Only `no` and `nothing` count as false.
- **Comparisons:** `is`, `is not`, `is less than`, `is greater than`,
  `is at least`, `is at most`, `is divisible by`, joined with `and`, `or`, `not`.
- **Maths:** `+ - * /`. Adding text to anything joins them into text.
- **Variables:** inside a function, `set` changes a variable the top level (or
  an enclosing function) also sets; otherwise it stays inside the function.
  Functions remember the variables around them.
- **Text:** any character but control characters; write `\n` for a new line and
  `\t` for a tab. Upper or lower case doesn't matter in names and words.

Mistakes get a message in plain words that points at the exact spot, with the
right name when you misspell one, and the right word when you type a symbol from
another language:

```text
line 2: 'totl' has no value yet. Did you mean 'total'?
say "Total: " totl
              ^
line 1: I don't understand '>' (write 'is greater than')
if x > 5
     ^
```

<p align="center">
<img src="docs/spiral.svg" height="230" alt="A colour spiral drawn by Moth">
&nbsp;&nbsp;
<img src="docs/tree.svg" height="230" alt="A tree drawn by a Moth function that calls itself">
<br><sub>Drawn by the Spiral and Tree examples, saved with <code>moth run</code>.</sub>
</p>

## The playground

[The playground](https://samyyy2423.github.io/moth/) runs in any browser, with
nothing to install.

- **Run** works in a background thread, so **Stop** ends even a loop that never
  does. **Engine** picks the JIT, WebAssembly or the VM, and the status bar times
  each run, so you can race them.
- **Debug** records the run, then **Back**, **Step**, **End** and a slider move
  through it in either direction: the line about to run, the calls in progress,
  every variable in view, and the output and drawing as they were.
- **Problems** appear as you type. Click one to jump to it.
- **Compiled** shows what the code became: bytecode, the JIT's JavaScript, the
  JavaScript from the compiler written in Moth, or the WebAssembly module.
- **Share** puts the code in the link.
- **Examples** include **Handwriting** (draw on a pad), **Guess** (a
  number-guessing game that asks for answers), **Neural network**, and **Moth's
  own compiler**, running in your browser.

## Command line

```bash
npm install -g github:samyyy2423/moth
```

```text
moth                               start the Moth shell
moth run hello.moth                run it, saving any drawing as hello.svg
moth run hello.moth --engine wasm  the same, on WebAssembly (or vm)
moth check hello.moth              find mistakes without running it
moth build hello.moth              compile it to hello.mjs, which runs with plain node
moth bytecode hello.moth           show the bytecode the VM runs
moth js hello.moth                 show the JavaScript the JIT makes
moth wasm hello.moth               show the WebAssembly module, as text
moth bootstrap                     compile Moth's compiler with itself, three times over
```

<details>
<summary>What they look like</summary>

`moth check` gives each problem in the same words as the error it would stop with:

```text
bad.moth:2:10: will fail: can't use '*' on text and a number
say name * 2
         ^
bad.moth:5:5: never runs: this line can never run, because 'return' comes first
    say "never"
    ^
bad.moth:8:1: unused: 'spare' is set but never used
set spare to 5
^
```

The shell remembers earlier entries and waits for a block's `end`:

```text
moth> set name to "Sam"
moth> to greet with who
....>     say "Hello, " who
....> end
moth> greet name
Hello, Sam
```

`moth bytecode` shows what the compiler made, here the start of FizzBuzz:

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
```

</details>

## How it's built

```text
                                       ┌→ bytecode    → the VM        debugger, shell
source → tokens → syntax tree → scope ─┼→ JavaScript  → V8            Run
                                       ├→ WebAssembly → V8            the fastest
                                       └→ checker     → problems      as you type
```

A tokenizer and a recursive-descent parser make a syntax tree whose every node
remembers where it came from, so errors can point at it. The scope rules give
each variable a slot, once, for every back end, so they can't disagree about
what a name means. Every check and error message lives in one place, `vm.js`,
which all three engines call. The compiler written in Moth repeats the first
four steps and the JIT, in Moth.

How each engine was made fast, what didn't work, and why: **[DESIGN.md](DESIGN.md)**.

<details>
<summary>The files</summary>

| File | What it is |
|:--|:--|
| [`moth.js`](moth.js) | Tokenizer, parser, bytecode compiler, and the public API (`run`, `check`, `compile`, `timeline`...) |
| [`scope.js`](scope.js) | Which variable each name means, shared by every back end |
| [`vm.js`](vm.js) | The virtual machine, and every check and error message all three engines use |
| [`jit.js`](jit.js) | The JIT: Moth to JavaScript |
| [`wasm-binary.js`](wasm-binary.js) | WebAssembly's binary format, written byte by byte |
| [`wasm.js`](wasm.js) | Moth to WebAssembly, with escape analysis and unboxed numbers |
| [`checker.js`](checker.js) | Finds mistakes without running the program |
| [`compiler.moth`](compiler.moth) | Moth's compiler, written in Moth |
| [`neural.moth`](neural.moth), [`math.moth`](math.moth) | The neural network, and the maths it needs, in Moth |
| [`digits.moth`](digits.moth), [`digit-shapes.moth`](digit-shapes.moth), [`digits-train.moth`](digits-train.moth), [`handwriting.moth`](handwriting.moth) | Reading handwriting: strokes to pictures, the network, its training, and the program that asks you to draw |
| [`cli.js`](cli.js) | The `moth` command and its shell |
| [`index.html`](index.html), [`worker.js`](worker.js) | The playground |

</details>

## Tested

`npm test` runs on every push. Tables of programs and mistakes run on all three
engines, and 5,000 randomly broken programs must make all three agree: the same
output, the same drawing, the same error at the same spot.

<details>
<summary>Everything it checks</summary>

- every playground example, on all three engines
- programs with their exact output, and broken programs with their exact error
  messages and positions, on all three engines
- 5,000 randomly broken programs: each must fail with a proper Moth error, never
  a JavaScript crash, and the three engines must agree on all of them
- the checker against reality, on 3,000 more: no line it says will fail ever
  runs in a program that finishes, and it predicts 44% of runtime errors with
  no false alarms
- the compiler written in Moth against the JIT, byte for byte, on every example,
  every table program and 3,000 broken ones, and bootstrapping it three stages deep
- the neural network and the handwriting reader, on all three engines
- `stop`, the text helpers, `ask` and `use`, including that `ask` never asks
  twice when a run is handed over, and that a mistake in a used file names it
- the WebAssembly encoder against the spec's examples, the playground's script,
  and every `moth` command as a real process

The tests are tested too: bugs planted on purpose in the VM, the JIT, the
checker, the compiler written in Moth, the neural network and WebAssembly's
unboxed numbers were all caught, some only by the fuzzer.

</details>

## Limits

- No dictionaries, and no reading files, the network or the clock: a program
  learns about the world only through `ask`.
- A used file's top level is the program's, so a library's helper names and a
  program's can collide.
- The handwriting reader learned from shapes, not people, so unusual ways of
  writing a digit can fool it.
- The WebAssembly engine needs WebAssembly GC: Node 22, Chrome 119, Firefox 120,
  Safari 18.2, or later.

<details>
<summary>The rest</summary>

- These words are part of the language and can't be variable names: `set add
  say if else end repeat while for to return and or not is yes no nothing list
  empty length item move turn pen record fail stop ask use uppercase lowercase
  split join number position`.
- Recursion goes up to 100,000 calls deep.
- The checker only warns when it is sure, so it misses some mistakes: the length
  of a list, and a name used before the line that sets it.
- The playground shows the first 10,000 lines of output, and the debugger
  records the first 10,000 steps.
- In the shell, Ctrl+C stops a program that never ends by quitting the shell.
- The compiler written in Moth gives up on code nested more than about 245
  brackets deep (the JIT goes to about 1,000), and on text holding half an emoji,
  which no file can hold.

</details>

## Run it from the source

```bash
npm test                     # everything above, in about 20 seconds
npm run bench                # the three engines, timed
node cli.js run hello.moth   # the moth command, without installing it
python -m http.server        # then open http://localhost:8000 for the playground
```

<br>

<p align="center"><sub>MIT licensed · made by <a href="https://github.com/samyyy2423">Samyak Pudke</a></sub></p>
