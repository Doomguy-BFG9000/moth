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
<a href="https://github.com/samyyy2423/moth/releases/tag/v1.5.1">Release 1.5.1</a>
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

**Numbers and data the way people use them.** Arithmetic is shown and compared
like a spreadsheet, to 15 significant digits, so `0.1 + 0.2` is `0.3`. A number
can carry a unit, and Moth keeps the units straight. A CSV file is one line
away from a table you can filter, total and chart. And a program asks before it
touches your files or goes online.

<table>
<tr>
<th width="58%">Moth</th>
<th>What it says</th>
</tr>
<tr>
<td valign="top">

```
say 0.1 + 0.2 is 0.3
set trip to 5 km + 300 m
say trip " = " trip in miles
say 2 hours + 30 minutes in minutes

set sales to read table "sales.csv"
for each row in sales where price of row is greater than 10
    say name of row
end
say total of price in sales
draw chart of price in sales
say trip + 1 hour
```

</td>
<td valign="top">

```text
yes
5.3 km = 3.29326731885787 miles
150 minutes

Big, red melon
15.75
(a bar chart, saved as an SVG)

line 12: can't use '+' on
a distance and a time
```

</td>
</tr>
</table>

**Four engines that agree.** Every program can run on a bytecode virtual
machine, on a JIT that compiles it to JavaScript, as WebAssembly that Moth
writes byte by byte, or on [the Rust engine](#without-javascript), which has no
JavaScript at all. All four must say, draw and fail exactly alike, and
thousands of randomly broken programs check that they do on every push. And
`moth-native build --exe` turns a program into
[machine code](#in-machine-code): a program of its own, the fastest of all at
working with numbers, and well ahead of the Rust engine everywhere else:

| `npm run bench` | VM | JIT | WebAssembly | Rust | Machine code |
|:--|--:|--:|--:|--:|--:|
| fib(25), function calls | 68 ms | 9.8 ms | **8.5 ms** | 31 ms | 16 ms |
| a million-round loop | 73 ms | 11 ms | 6.5 ms | 33 ms | **2.5 ms** |
| primes up to 5,000 | 119 ms | 19 ms | **15 ms** | 110 ms | 45 ms |
| 200,000 records | 93 ms | 15 ms | **10 ms** | 66 ms | 48 ms |
| a million bytes, filled and summed | 397 ms | 94 ms | **43 ms** | 186 ms | 90 ms |
| 200,000 words counted in a dictionary | 104 ms | 28 ms | **26 ms** | 80 ms | 53 ms |

**A compiler written in Moth.** [`compiler.moth`](compiler.moth) is 2,400
lines of Moth that compile any Moth program, itself included, to exactly the
JavaScript the JIT writes, byte for byte, or to exactly the bytecode the Rust
engine runs. Compiled by itself, it compiles itself again, and again, to the
same result:

```text
$ moth bootstrap
compiler.moth: 2381 lines of Moth, which the JIT compiles to 230735 characters of JavaScript
stage 1, made by the JIT, compiles compiler.moth: the same JavaScript (212 ms)
stage 2, made by stage 1, compiles compiler.moth: the same JavaScript (183 ms)
stage 3, made by stage 2, compiles compiler.moth: the same JavaScript (207 ms)
fixed point: the compiler written in Moth compiles itself to exactly what the JIT makes of it
```

**Neural networks, written in Moth.** [`neural.moth`](neural.moth) learns to
tell apart two moons of dots, after Andrej Karpathy's
[micrograd](https://github.com/karpathy/micrograd): every number it works out is
a record that remembers how it was made, so backpropagation can trace each
weight's share of the blame. Moth has no sine or `exp`, so
[`math.moth`](math.moth) writes them in Moth too, with random numbers that come
out the same every run. From 50% right to 100% in 60
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

**Real tools.** [`tools/`](tools) holds programs that do real work with files,
bytes and dictionaries:

<p align="center"><img src="docs/mandelbrot.png" width="560" alt="The Mandelbrot set: a black shape like a beetle, edged with a glow that goes from deep blue to bright cyan, drawn by picture.moth"></p>

- [`picture.moth`](tools/picture.moth) draws the Mandelbrot set above and writes
  it as a BMP file, byte by byte, the header's numbers put together with bit
  operations.
- [`wordcount.moth`](tools/wordcount.moth) counts the words in any file:

  ```text
  $ moth run wordcount.moth --allow-read story.txt 4
  290 words, 107 different ones
  the   ██████████████████████████████ 45
  and   █████████████ 20
  it    ███████ 11
  moth  ██████ 10
  ```
- [`json.moth`](tools/json.moth) reads JSON into dictionaries and lists, `\u`
  escapes and emoji included, and [`json.test.moth`](tools/json.test.moth)
  tests it with `moth test`.

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
to circle_area with r as a number   # an input can say what it is: each call checks
    return 3.14159 * r * r
end

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

For real programs: catching mistakes, dictionaries, modules, files, and bytes.

```
try                                         # catch a mistake and carry on
    set age to number of ask "Age?"
if it fails with why
    say "That's not a number: " why
end

set ages to dictionary where "Sam" is 20, "Ana" is 31   # look things up by key
set item "Bo" of ages to 7
remove "Ana" from ages
if "Sam" is in ages                         # is in: a list's items, a dictionary's keys, or text
    say item "Sam" of ages
end
for each person in ages                     # a dictionary's keys, in the order they were added
    say person ": " item person of ages
end

use "math.moth" as math                     # another file, its names kept apart as math's ...
say math's sqrt(2)

set notes to read "notes.txt"               # files: read, read bytes, write ... to
write uppercase of notes to "loud.txt"
for each word in arguments                  # moth run tool.moth a b c
    say word
end

set block to 4 bytes                        # memory: bytes from 0 to 255
set byte 1 of block to 0xFF                 # numbers in hex and binary: 0xFF, 0b1010
say block                                   # (4 bytes: 255, 0, 0, 0)
say "hi" as bytes                           # (2 bytes: 104, 105); back again with: as text
say 12 bit and 10 " " shift 1 left by 4     # 8 16; also bit or, bit xor, shift right
say 255 as hex " " 5 as binary              # ff 101

to test_area                                # moth test runs every function named test_...
    expect area(3, 4) is 12                 # and if it isn't so: expected 13 to be 12
end
```

For data: amounts with units, tables, and charts.

```
set trip to 5 km + 300 m                    # an amount: a number, then its unit
say trip in miles                           # 3.29326731885787 miles
say 3 * 2 hours " " 10 km / 4 " " 10 km / 2 km      # 6 hours 2.5 km 5
say 1 km is 1000 m                          # yes: amounts compare across units
add 700 m to trip
say number of (trip in m)                   # 6000: the number alone

set sales to read table "sales.csv"         # a CSV file: a list of records, one for each row
for each row in sales where price of row is greater than 10
    say name of row                         # the header names the fields, in lower case
end
say total of price in sales                 # also average of, largest of, smallest of;
say average of (list of 2, 4, nothing)      # 3: like a spreadsheet, empty cells are skipped
draw chart of price in sales                # a bar for each row
draw chart of (dictionary where "Mon" is 5, "Tue" is 7)     # the keys label the bars
set prices to read table "https://example.com/prices.csv"   # read can go online too
```

Apps: pictures that answer keys, clicks and time.
[`apps/snake.moth`](apps/snake.moth) is a whole game in 110 lines, and
[`apps/paint.moth`](apps/paint.moth) a paint program in 54.

```
move to 50, -20                             # straight to a spot, drawing if the pen is down
draw box at 0, 0 size 40 by 20              # filled with the pen's color
draw circle at 0, 0 size 10
draw "Score: 3" at -200, 220 size 16
clear                                       # wipe the picture
say random number from 1 to 6               # a whole number, different each run

when a key is pressed with key              # "left", "space", "a", ...
    say "you pressed " key
end
when the mouse is clicked with x and y      # also: when the mouse is dragged
    draw circle at x, y size 5
end
every 100 milliseconds                      # or: every 2 seconds, every 1 minute
    move forward 1
end
```

- **Values:** numbers, amounts like `5 km`, `"text"`, `yes`, `no`, `nothing`,
  lists, records, dictionaries and bytes. Only `no` and `nothing` count as false.
- **Numbers** are worked out the computer's way, but shown, compared and used as
  whole numbers (an item's place, a count of times) to 15 significant digits,
  like a spreadsheet: `0.1 + 0.2` is `0.3`, and `item (0.1 * 30)` is item 3.
  Whole numbers up to 2^53 are always exact.
- **Units:** distances (`mm cm m km`, `inches feet yards miles`, and `metres`
  or `meters` written out), times (`milliseconds` to `weeks`), weights (`mg g
  kg`, `ounces pounds tonnes`, `grams` written out) and volumes (`ml`,
  `litres` or `liters`). A unit's word only counts as one after a number or
  after `in`, so it can still name a variable. Amounts of one measure add,
  subtract, compare and convert with `in`; they're times or over a number, and
  one over another of the same measure is a number. Mixing measures is a
  mistake, which says so.
- **Tables:** after `total of`, `average of`, `largest of`, `smallest of` and
  `draw chart of`, `price in sales` means each row's price; to convert a total,
  bracket it: `(total of trips) in miles`.
- **Inputs** can say what they are: `with name as text, age as a number` (also
  `yes or no`, `a list`, `a record`, `a dictionary`, `bytes`, `a function`), and
  each call checks them.
- **Comparisons:** `is`, `is not`, `is less than`, `is greater than`,
  `is at least`, `is at most`, `is divisible by`, `is in`, joined with `and`,
  `or`, `not`.
- **Maths:** `+ - * /`. Adding text to anything joins them into text.
- **Variables:** inside a function, `set` changes a variable the top level (or
  an enclosing function) also sets; otherwise it stays inside the function.
  Functions remember the variables around them.
- **Text:** any character but control characters; write `\n` for a new line and
  `\t` for a tab. Upper or lower case doesn't matter in names and words.

Mistakes get a message in plain words that points at the exact spot, with the
right name when you misspell one, the right word when you type a symbol from
another language, and the calls that led there:

```text
line 2: 'totl' has no value yet. Did you mean 'total'?
say "Total: " totl
              ^
line 1: I don't understand '>' (write 'is greater than')
if x > 5
     ^
line 6: can't divide by zero
    return total / length of numbers
                 ^
  in 'average', called from line 10
  in 'report', called from line 13
line 4: 'area' needs height to be a number, not text
say area(3, "4")
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
- **Problems** appear as you type. Click one to jump to it, and **Fix** puts a
  misspelled name, or a symbol from another language, right.
- **Compiled** shows what the code became: bytecode, the JIT's JavaScript, the
  JavaScript from the compiler written in Moth, or the WebAssembly module.
- **Share** puts the code in the link, and **Tidy** lays it out the one way
  Moth writes it (Undo brings it back).
- **Apps** keep running once they've set up: click the picture, and your keys,
  clicks and drags go to the program. Try **Snake** and **Paint**.
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
moth run tool.moth a b c           run it with arguments; it asks before it reads or writes a file here, or goes online
moth run tool.moth --allow-read    let it read files without asking (also --allow-write, --allow-net, --allow-all)
moth run tool.moth --allow-read=data   only the files in data (also --allow-write=out, --allow-net=example.com)
moth test                          run every test_ function in every .test.moth file here
moth fmt hello.moth                tidy it (--check only says whether it's tidy)
moth check hello.moth              find mistakes without running it
moth build hello.moth              compile it to hello.mjs, which runs with plain node
moth build --web snake.moth        make it into snake.html: one web page, apps and all
moth bytecode hello.moth           show the bytecode the VM runs
moth js hello.moth                 show the JavaScript the JIT makes
moth wasm hello.moth               show the WebAssembly module, as text
moth bootstrap                     compile Moth's compiler with itself, three times over
```

A program run with `moth run` or `moth test`, or made by `moth build`, asks
before it reads a file, writes one, or goes online, the way Deno does: at a
terminal you're asked, once for each file or site (or `a` for all of them);
anywhere else, such as in a script, the answer is no unless moth was started
with `--allow-read`, `--allow-write`, `--allow-net` or `--allow-all` (for `moth
build`, after the file: they're built into the program). The first three can
name what they allow: `--allow-read=data,notes.txt` lets it read those files and
everything in those folders, wherever their links lead; `--allow-net=example.com`
that site. A site that sends the program on to another address is asked about
again, there. `use` only reads files in the program's own folder, or folders
inside it. A refusal is a mistake the program can catch with `try`:

```text
$ moth run copy.moth
moth: let this program read 'notes.txt'? (y = yes, a = yes to all, n = no) n
copy.moth:1:20: can't read 'notes.txt': this program isn't allowed to read files (start it with --allow-read)
write uppercase of read "notes.txt" to "loud.txt"
                   ^
```

<details>
<summary>What they look like</summary>

`moth test` runs each test on its own, in a fresh run of the file:

```text
$ moth test shapes.test.moth
✓ test_area
✗ test_average
    shapes.test.moth:17:5: expected 1.5 to be 2
        expect average(list of 1, 2) is 2
        ^
    it said:
      checking
1 passed, 1 failed
```

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

## Without JavaScript

Moth's engines are written in JavaScript, so a bug in JavaScript itself could
reach them. [`native/`](native/) is Moth written again from scratch in Rust,
with no JavaScript anywhere: its own lexer, parser, compiler and virtual machine,
and no libraries.

```bash
cargo install --git https://github.com/samyyy2423/moth moth-native
```

```text
moth-native run hello.moth              run it, saving any drawing as hello.svg; it asks, as moth run does
moth-native build hello.moth            compile it to hello.mothc, bytecode that runs without compiling again
moth-native run hello.mothc             run the bytecode
moth-native build --exe hello.moth      compile it to machine code: hello.exe (or hello), a program of its own
moth-native test                        run every test_ function in every .test.moth file here
moth-native bytecode hello.moth         show the bytecode, the same as moth bytecode
moth-native bootstrap compiler.moth     build Moth's compiler with itself, with no JavaScript
```

It isn't a lookalike. On every push, a test holds it up against the JavaScript
VM on every test program, 5,000 broken and 1,500 generated ones, the neural
network, the handwriting reader, and Moth's compiler compiling itself: the two
must compile to the same bytecode and say, draw, write and fail exactly alike.
To get there it prints numbers the way JavaScript does, down to which digit
wins a tie, and works out sine and cosine with the same method as Chrome's
engine, checked bit for bit on a million numbers.

**As one WebAssembly file.** The same engine builds into `moth-native.wasm`,
which runs in any WebAssembly runtime with WASI, the standard way for
WebAssembly to reach files and a terminal. It asks its runtime for nothing
else, and on every push CI runs it in wasmtime, which has no JavaScript in it,
on every test program and 1,000 broken ones, and has it build Moth's compiler
with itself.

```bash
cd native && rustup target add wasm32-wasip1 && cargo build --release --target wasm32-wasip1
wasmtime run --dir . target/wasm32-wasip1/release/moth-native.wasm run hello.moth
```

### In machine code

`moth-native build --exe hello.moth` makes `hello.exe` (just `hello` on Mac and
Linux): the program in machine code, which runs with nothing else installed.
Each Moth function becomes a function of its own; a variable no inner function
can see becomes a local; and a variable or value that can only ever be a number
becomes a plain machine number, so a loop over numbers runs at the speed of C.
An input that says it is a number (`to area with width as a number`) counts as
one, so saying what inputs are makes them faster. Every check and every message
is the Rust engine's own, so it does exactly what `moth-native run` does: on
every push a test compiles 700 programs and holds them to the engine's output,
drawings and mistakes. It asks before files and going online as `run` does, and
`--allow` flags after the file are built into it:

```bash
moth-native build --exe tool.moth --allow-read=data
```

It needs Rust's compiler, `rustc` (from [rustup.rs](https://rustup.rs)), which
turns the Rust that moth-native writes into machine code, together with the
engine's own source, which moth-native carries inside it. A small program builds
in about five seconds; Moth's 2,400-line compiler takes a few minutes.

**Moth builds itself, with no JavaScript.** [`compiler.moth`](compiler.moth),
Moth's compiler written in Moth, now writes bytecode as well as JavaScript, and
the bytecode is exactly what the Rust compiler makes, byte for byte. So the
Rust engine can run compiler.moth compiling itself, then run what that made to
compile it again:

```text
$ moth-native bootstrap compiler.moth
compiler.moth: 2381 lines of Moth, which moth-native's compiler (in Rust) makes into 300408 bytes of bytecode
stage 1, made by moth-native's compiler, compiles compiler.moth: the same bytecode (611 ms)
stage 2, made by stage 1, compiles compiler.moth: the same bytecode (646 ms)
stage 3, made by stage 2, compiles compiler.moth: the same bytecode (601 ms)
fixed point: the compiler written in Moth builds itself to exactly what moth-native's compiler makes, with no JavaScript
```

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
| [`tools/`](tools) | Real tools in Moth: a picture maker, a word counter, a JSON reader and its tests |
| [`cli.js`](cli.js) | The `moth` command and its shell |
| [`disk.js`](disk.js) | The files and sites a program on the command line can reach, and asking before it does |
| [`index.html`](index.html), [`worker.js`](worker.js) | The playground |

</details>

## Tested

`npm test` runs on every push, then `moth test` and `moth fmt --check` on the
Moth in this repository. Tables of programs and mistakes run on all three
engines, and 5,000 randomly broken programs must make all three agree: the same
output, the same drawing, the same error at the same spot, and the same trail of
calls that led there.

<details>
<summary>Everything it checks</summary>

- every playground example, on all three engines
- programs with their exact output, and broken programs with their exact error
  messages and positions, on all three engines
- 5,000 randomly broken programs: each must fail with a proper Moth error, never
  a JavaScript crash, and the three engines must agree on all of them
- 1,500 new programs made from the grammar ([`generate.js`](generate.js)), every
  feature mixed in: the engines must agree, files and trails included, the
  compiler written in Moth must match the JIT, tidying must change nothing they
  do, and the checker must raise no false alarms. Run for longer, it found the
  `else` / `if` bug
- the checker against reality, on 3,000 more: no line it says will fail ever
  runs in a program that finishes, and it predicts 44% of runtime errors with
  no false alarms
- the compiler written in Moth against the JIT, byte for byte, on every example,
  every table program and 3,000 broken ones, and bootstrapping it three stages deep
- the neural network and the handwriting reader, on all three engines
- `stop`, the text helpers, `ask` and `use`, including that `ask` never asks
  twice when a run is handed over, and that a mistake in a used file names it
- `try`, dictionaries, bytes and bits, files and arguments (a run handed over
  reads the same files and writes nothing twice), and modules, whose names stay
  apart even where a function's own names hide them
- WebAssembly's own fast paths for bytes, bits and dictionaries, right at their
  edges (2^31, a shift by 21 or 22, -0, 255 and 256), against the other engines
- `expect` and `moth test`, including that each test starts afresh; `moth fmt`
  on every file here (already tidy) and on 2,000 broken programs (each tidied
  without changing a piece, and tidy the second time); and the three tools,
  whose pictures must match byte for byte on every engine
- the WebAssembly encoder against the spec's examples, the playground's script,
  and every `moth` command as a real process
- the Rust engine against the JavaScript VM: every test program, 5,000 broken
  and 1,500 generated ones, the bundled programs, every character's upper and
  lower case, and its commands against `moth`'s, down to the bytes of a drawing
- the Rust engine built as WebAssembly, run with WASI: its imports, and every
  test program and 1,000 broken ones against the JavaScript VM
- compiler.moth's bytecode against the Rust compiler's, byte for byte, on 630
  programs and 1,500 broken ones, and `moth-native bootstrap` three stages deep,
  natively and as WebAssembly
- `moth-native build --exe` against the Rust engine: every test program, 150
  generated and 150 broken ones compiled to machine code, which must say, draw,
  write and fail exactly alike; and a compiled tool's files, arguments, asking
  and mistakes against `moth-native run`'s

The tests are tested too: bugs planted on purpose in the VM, the JIT, the
checker, the compiler written in Moth, the neural network and WebAssembly's
unboxed numbers were all caught, some only by the fuzzer.

</details>

## Limits

- No clock: a program learns about the world through `ask`, its files, the
  sites it reads, its arguments, and in an app, keys, clicks and timers. In the
  playground, files last for one run, and only sites that let any page read
  them can be read. `moth-native` goes online through `curl`; as WebAssembly it
  can't.
- Units go one at a time: there's no speed, like km per hour, yet; dividing a
  distance by a time is a mistake. Temperatures aren't units either.
- A table's cells are numbers, text or nothing: dates stay text.
- An app runs in the playground or as a page made by `moth build --web`; `moth
  run` only sets it up, since a terminal has no clicks. In the playground, an
  app can't `ask` once it's running.
- `use` without `as` puts a file's names in with the program's, where they can
  collide; `use ... as` keeps them apart. It only reads files in the program's
  folder, or folders inside it: not `../lib.moth`, and not through a link out.
- The handwriting reader learned from shapes, not people, so unusual ways of
  writing a digit can fool it.
- The WebAssembly engine needs WebAssembly GC: Node 22, Chrome 119, Firefox 120,
  Safari 18.2, or later.
- A program in machine code is fastest at work with numbers; with lists,
  records and dictionaries it is about twice as fast as the Rust engine, but
  JavaScript's engine, which has years of tuning behind it, is faster still.
  Building one needs `rustc`, and a very big program takes minutes. It has no
  limit on its steps, so a loop that never ends runs until it's stopped.
- The Rust engine runs code and values nested deeper than JavaScript's stack
  allows (about 900 brackets, or a list held 2,000 deep): there JavaScript stops
  with a mistake, and Rust carries on. As WebAssembly, whose stack is smaller,
  it stops code nested past 500 levels and values past 1,000. It runs, builds
  and tests programs; checking, tidying, apps and the playground are the
  JavaScript side's.

<details>
<summary>The rest</summary>

- These words are part of the language and can't be variable names: `set add
  say if else end repeat while for to return and or not is yes no nothing list
  empty length item move turn pen record fail stop ask use try uppercase
  lowercase split join number position dictionary remove keys in byte bytes as
  shift read write arguments expect clear draw when every`. And `total`,
  `average`, `largest` and `smallest` followed by `of` work something out from a
  list, so a record's field with one of those names can't be read with `of`.
- There's no word yet for asking what kind a value is (a number, text, a list...).
- Bits work on whole numbers from 0 to 2^53 − 1, the most a Moth number holds
  exactly.
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
cargo build --release --manifest-path native/Cargo.toml   # the Rust engine, which npm test checks too
npm test                     # everything above, in about a minute
npm run bench                # the four engines, timed
node cli.js run hello.moth   # the moth command, without installing it
python -m http.server        # then open http://localhost:8000 for the playground
```

<br>

<p align="center"><sub>MIT licensed · made by <a href="https://github.com/samyyy2423">Samyak Pudke</a></sub></p>
