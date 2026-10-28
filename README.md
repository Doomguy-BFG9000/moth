# Moth

[![tests](https://github.com/samyyy2423/moth/actions/workflows/test.yml/badge.svg)](https://github.com/samyyy2423/moth/actions/workflows/test.yml)

A programming language that reads like plain English. It's written from scratch
in JavaScript with no libraries: a parser, a bytecode compiler, a virtual
machine, a step-by-step debugger, and a `moth` command with its own shell.
**[Try it in the playground](https://samyyy2423.github.io/moth/)**.

```
for each n from 1 to 15
    if n is divisible by 15
        say "FizzBuzz"
    else if n is divisible by 3
        say "Fizz"
    else if n is divisible by 5
        say "Buzz"
    else
        say n
    end
end
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
```

- Values: numbers, `"text"`, `yes`, `no`, `nothing`, and lists.
- Comparisons: `is`, `is not`, `is less than`, `is greater than`, `is at least`,
  `is at most`, `is divisible by`. Combine them with `and`, `or`, `not`.
- Math: `+ - * /`. Adding text to anything joins them into text.
- Inside a function, `set` changes a variable that the top level (or an
  enclosing function) also sets; otherwise the variable stays inside the
  function. Functions remember the variables around them (closures).
- Only `no` and `nothing` count as false. Upper or lower case doesn't matter.

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

- **Run** runs the code in a background thread, so **Stop** works even on a
  loop that never ends.
- **Debug** goes through the code one statement at a time. **Step** highlights
  the line about to run and shows the calls in progress and every variable in
  view, including the ones a closure remembers from the function it was made
  in. **Continue** runs to the end.
- **Share** puts the code into the link, so opening the link opens the program.
- **Show bytecode** shows what the compiler turned the code into.

## Command line

```bash
npm install -g github:samyyy2423/moth
```

| Command | What it does |
|---|---|
| `moth` | Starts the Moth shell |
| `moth run hello.moth` | Runs a program |
| `moth build hello.moth` | Compiles it to `hello.mjs`, which runs with plain `node` and doesn't need Moth installed |
| `moth bytecode hello.moth` | Shows the instructions the compiler made |

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

Errors give the file, line, and column, so editors can jump straight to them:

```text
errors.moth:3:5: there is no item 5, the list only has 2 items
say item 5 of fruits
    ^
```

## How it works

| File | What it is |
|---|---|
| [`moth.js`](moth.js) | Tokenizer, parser, and bytecode compiler |
| [`vm.js`](vm.js) | The virtual machine. It imports nothing, so `moth build` copies it into compiled programs |
| [`cli.js`](cli.js) | The `moth` command and shell |
| [`index.html`](index.html), [`worker.js`](worker.js) | The playground. Each run gets its own Web Worker, so **Stop** works even on a loop that never ends |

The source goes through four stages:

1. **Tokenizer**: one regular expression cuts the source into words, numbers,
   text, and symbols, each with its line and column.
2. **Parser**: recursive descent builds a syntax tree. Every node keeps the token
   it came from, so errors can point at it.
3. **Compiler**: turns each function into bytecode (35 opcodes). Each variable
   is resolved here, once, to a fixed slot.
4. **Virtual machine**: one loop with its own value stack and call stack, so
   recursion isn't limited by JavaScript's stack.

| Benchmark (`npm run bench`) | v1 tree-walker | v2 bytecode VM |
|---|---|---|
| sum 1 to 1,000,000 | 163 ms | 61 ms (2.7× faster) |
| primes up to 5,000 | 320 ms | 113 ms (2.8× faster) |
| fib(25) | 60 ms | 72 ms (1.2× slower) |
| recursion 10,000 deep | fails | 6 ms |

Why calls got slower, what I tried, and the other design decisions are in
**[DESIGN.md](DESIGN.md)**.

## Testing

`npm test` runs on every push. It checks:

- every playground example's output
- tables of programs with their exact output, and broken programs with their
  exact error messages and positions
- a fuzzer that randomly breaks 5,000 programs and checks that each one fails
  with a proper Moth error, never a JavaScript crash
- every `moth` command, run as a real process, including running a compiled
  program and checking it prints the same as `moth run`

During the rewrite to bytecode, 19,001 fuzzed programs gave identical results
on the old and new engines.

## Limits

- No dictionaries, `break`, text functions (like upper case or split), or imports.
- These words are part of the language and can't be variable names:
  `set add say if else end repeat while for to return and or not is yes no
  nothing list empty length item`.
- Recursion goes up to 100,000 calls deep.
- The playground shows the first 10,000 lines of output.
- In the shell, Ctrl+C stops a program that never ends by quitting the shell.

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
