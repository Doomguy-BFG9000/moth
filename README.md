# Moth

[![tests](https://github.com/samyyy2423/moth/actions/workflows/test.yml/badge.svg)](https://github.com/samyyy2423/moth/actions/workflows/test.yml)

A programming language that reads like plain English. It's written from scratch
in JavaScript with no libraries: a parser, a bytecode compiler, and a virtual
machine. **[Try it in the playground](https://samyyy2423.github.io/moth/)**.

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

Mistakes get a plain-words message that points at the exact spot, and Moth
suggests the right word when you type a symbol from another language:

```text
line 3: there is no item 5, the list only has 2 items
say item 5 of fruits
    ^
```
```text
line 1: I don't understand '>' (write 'is greater than')
if x > 5
     ^
```

## How it works

[`moth.js`](moth.js) runs the source through four stages:

1. **Tokenizer**: one regular expression cuts the source into words, numbers,
   text, and symbols, each with its line and column.
2. **Parser**: recursive descent builds a syntax tree. Every node keeps the token
   it came from, so errors can point at it.
3. **Compiler**: turns each function into bytecode (34 opcodes). Each variable
   is resolved here, once, to a fixed slot.
4. **Virtual machine**: one loop with its own value stack and call stack, so
   recursion isn't limited by JavaScript's stack.

The playground runs each program in a Web Worker, so the **Stop** button works
even on a loop that never ends.

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

During the rewrite to bytecode, 19,001 fuzzed programs gave identical results
on the old and new engines.

## Limits

- No dictionaries, `break`, text functions (like upper case or split), or imports.
- These words are part of the language and can't be variable names:
  `set add say if else end repeat while for to return and or not is yes no
  nothing list empty length item`.
- Recursion goes up to 100,000 calls deep.
- The playground shows the first 10,000 lines of output.

## Run it yourself

```bash
npm test
```
```bash
npm run bench
```

To open the playground on your own computer, serve the folder (browsers won't
load JavaScript modules or workers straight from disk), then go to
http://localhost:8000:

```bash
python -m http.server
```

MIT licensed.
