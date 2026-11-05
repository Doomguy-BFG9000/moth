# The Moth language

This is the specification of Moth 1.x: what a Moth program means, and what every Moth 1 release does with
it. It was written from what Moth does, from the parser in [`moth.js`](moth.js), the checks and messages in
[`vm.js`](vm.js), and [README.md](README.md) and [DESIGN.md](DESIGN.md), and it is held to them: where this
document and moth disagree, one of them has a bug, and the next release fixes it.

## How to read this

- Everything here is **guaranteed** for every 1.x release, as [VERSIONING.md](VERSIONING.md) promises,
  unless it is marked as an **implementation detail**. An implementation detail is how moth does
  something today; it can change in any release, and a program shouldn't depend on it.
- **moth** is the command (`moth.exe` on Windows, `moth` on Linux), whose compiler, `machine.moth`, makes a
  program into machine code. **The playground** runs Moth in a browser on engines written in JavaScript.
  Both follow this document; where they can't do the same thing, it says so.
- Grammar is written like this:

  ```text
  repeat     = "repeat" expression "times" NL block "end"
  ```

  A word in quotes is that word, in any case. `NL` is the end of a line. `[ x ]` means x may be left out,
  `{ x }` that x may come any number of times, and `a | b` either one. `name` is a name (section 1.3),
  `text` text written out (1.5), and `block` any number of statements, each on its own line.

## Contents

1. [How a program is read](#1-how-a-program-is-read)
2. [Values](#2-values)
3. [Numbers](#3-numbers)
4. [Amounts with units](#4-amounts-with-units)
5. [Expressions](#5-expressions)
6. [Statements](#6-statements)
7. [Functions, kinds and names](#7-functions-kinds-and-names)
8. [Built-in operations](#8-built-in-operations)
9. [Mistakes](#9-mistakes)
10. [Files and packages](#10-files-and-packages)
11. [The world outside, and the permission flags](#11-the-world-outside-and-the-permission-flags)
12. [Apps](#12-apps)
13. [Tasks](#13-tasks)
14. [Implementation details](#14-implementation-details)

## 1. How a program is read

### 1.1 Characters

A Moth file is text in UTF-8. Every control character (U+0000 to U+0020, so tabs, carriage returns and
line feeds too) counts as a space, except that a line feed ends a line. So a file with Windows line ends
(`\r\n`) means the same as one with `\n`.

Outside text and comments, a program is made of words, numbers, text, the symbols `+ - * / ( ) ,` and `'s`.
Any other character is a mistake, said where it is. For the characters people type out of habit from other
languages, the mistake says what Moth writes instead:

| Written | Moth says |
|:--|:--|
| `=` | to store a value write 'set x to 5', to compare write 'x is 5' |
| `!` | write 'is not' |
| `<` `>` | write 'is less than', write 'is greater than' |
| `%` | write 'is divisible by' |
| `[` `]` | make a list with 'list of 1, 2, 3' |
| `{` `}` | blocks finish with 'end', not braces |
| `'` | put text in double quotes |
| `.` | to get a field write 'name of person' |

### 1.2 Lines and statements

Each statement starts on a new line. A statement ends where the line ends, if the statement could end
there; if it can't, it carries on. In practice a statement carries on to the next line when that line
starts with `+`, `-`, `*`, `/`, `and` or `or`, or when the line before ends with a comma or inside a
bracket:

```text
set area to width * height
    + border * 2                  # one statement
set colours to list of "red", "green",
    "blue"                        # one statement
```

`moth tidy` indents a line that carries a statement on by 4 more spaces than the statement's first line.
Two statements on one line are a mistake ("expected a new line").

### 1.3 Words and names

A word is a letter or `_`, then any letters, digits and `_`: `[A-Za-z_][A-Za-z0-9_]*`. Only ASCII letters
make words.

**Case doesn't matter in words.** `Say`, `SAY` and `say` are the same word, and `Total` and `total` the same
name. Case does matter inside text.

A **name** is a word that names a variable, a function, an input, a field or a file used `as` a name. These
words are part of the language and can't be names:

```text
set add say if else end repeat while for to return and or not is yes no nothing list empty length
item move turn pen record fail stop uppercase lowercase split join number position ask use try
dictionary remove keys in byte bytes as shift read write arguments expect clear draw when every
```

Other words are words of the language only in their phrases, and names anywhere else: `run` in `run program`,
`load` before a value, `save ... to`, `send ... to`, `json from`, `play note`, `play a beep`, `wait` before an
amount of time, `wait for`, `start` before a call, `random number from`, `function with`, `remainder of`,
`items ... to ... of`, `match` before a line starting with `when`, `kind` before a name, `gives` after a
function's inputs, `the time` and the other times (section 8.11), `rounded`, `with ... decimals`, `without
repeats`, `to the power of`, `has ended`, `in order`, `bit and`, and `total`, `average`, `largest` and
`smallest` before `of`.
A field called `total` can't be read with `of`, since `total of` means a total; `x's total` reads it.

### 1.4 Numbers written out

```text
number = digits [ "." digits ] | "0x" hexdigits | "0b" binarydigits
```

`42`, `3.14`, `0xFF` (255) and `0b1010` (10). There's no exponent (`1e5`), no leading point (`.5`) and no
`_` between digits. A minus sign before a number is the minus of section 5.4, so `-3` is minus 3. A unit's
word straight after a number makes an amount: `5 km` (section 4).

### 1.5 Text written out

Text is written between double quotes on one line. Inside it:

- `\n` is a new line, `\t` a tab, and `\` before any other character is that character, so `\"` is a quote,
  `\\` a backslash and `\{` a brace.
- Any character but a control character can be written as itself; a tab can too.
- **Values in text.** A `{` right before a letter, `_` or `(` starts a value, which ends at its own `}`:
  `"Hi, {name}!"` is `"Hi, " + name + "!"`. The value is any expression, and can hold text of its own:
  `"{join words with ", "}"`. A `{` before anything else is itself (`"{3}"`, `"a { b"`), and so is `\{`.
  A value that starts with a number goes in brackets: `"{(3 * n)}"`. Text with a value in it is always
  text, even `"{a}{b}"`.

A text that isn't closed on its line, or a `{` whose value has no `}`, is a mistake.

### 1.6 Comments

`#` outside text starts a comment, which runs to the end of the line.

### 1.7 Blocks

A statement that holds others (`if`, `repeat`, `for each`, `to`, `try`, `when`, `every`, `kind`, `match`
and `use the library`) ends its first line there, holds statements on the lines after it, and ends with
`end` on a line of its own. Indenting doesn't change what a program means, but `moth tidy` writes 4 spaces
for each block a statement is in. A block that reaches the end of the file is a mistake that names the
line it started on ("'if' from line 3 is missing its 'end'").

## 2. Values

### 2.1 Kinds of value

| Kind | Written | Shown by `say` | Called in messages |
|:--|:--|:--|:--|
| a number | `42`, `3.5` | `42`, `3.5` | a number |
| an amount | `5 km` | `5 km` | a distance, a time, a weight, a volume |
| text | `"hi"` | `hi` | text |
| yes or no | `yes`, `no` | `yes`, `no` | yes/no |
| nothing | `nothing` | `nothing` | nothing |
| a list | `list of 1, 2` | `[1, 2]` | a list |
| a record | `record with name "Sam"` | `(record with name "Sam")` | a record |
| a dictionary | `dictionary where "a" is 1` | `(dictionary where "a" is 1)` | a dictionary |
| bytes | `4 bytes` | `(4 bytes: 0, 0, 0, 0)` | bytes |
| a function | `area` (a function's name), `function with x gives x * 2` | `<function area>` | a function |

There are no other kinds. A task (section 13) is a record. An empty list shows as `[]`, an empty record as
`(empty record)` and an empty dictionary as `(empty dictionary)`. Inside a list, record or dictionary,
text is shown in quotes, with `\"`, `\\`, `\n` and the like as JSON writes them: `["a", "b\"c"]`. A list
that holds itself shows `[...]` where it comes round again, and a record or dictionary `(...)`.

A kind made with `kind` (section 7.4) can say how its records are shown, with a function called `shown`.

### 2.2 Yes, no and nothing

Only `no` and `nothing` count as false, in `if`, `repeat while`, `and`, `or`, `not`, `where` and `expect`.
Everything else counts as true, `0` and `""` included. `and` and `or` give `yes` or `no`; the second side is
worked out only if the first doesn't settle it.

`nothing` is what a variable holds when it's given `nothing`, what a function gives when it returns
without a value or reaches its end, an empty cell in a table, and what some operations give when there's no
answer (the choice in a list nobody has chosen from).

### 2.3 Lists, records and dictionaries are shared

A list, record, dictionary or bytes value is one thing, however many names hold it. `set b to a` makes `b`
the same list as `a`, so `add 4 to b` changes `a` too, and so does a function given it. Numbers, amounts,
text, yes, no and nothing never change: every operation on them makes a new value.

- A **list** holds any values in order, counted from 1. It grows with `add`.
- A **record** holds named values, its fields, in the order they were made. `set name of r to x` changes a
  field, or adds it if `r` hasn't one of that name.
- A **dictionary** holds values by key, each key text or a number, in the order the keys were first set. A
  key given twice in `dictionary where` keeps its first place and its last value.
- **Bytes** are a fixed number of whole numbers from 0 to 255.

### 2.4 When two values are the same

`a is b` is yes when:

- both are numbers whose values to 15 digits are the same (section 3);
- both are amounts of the same measure, the same once one is put in the other's unit (`1 km is 1000 m`);
- both are text with the same characters;
- both are yes, both are no, or both are nothing;
- both are lists of the same length whose items are the same, in order; both are dictionaries with the
  same keys whose values are the same, in any order; or both are records with the same fields whose values
  are the same, in any order;
- both are bytes with the same numbers;
- both are the same function.

Values of different kinds are never the same: `"10" is 10` is no, and so is `0 is no`. A list that holds
itself is compared without going round for ever.

## 3. Numbers

A number is a 64-bit floating-point number (IEEE 754 binary64), as in most languages. **What Moth adds is
that it works to 15 significant digits**, like a spreadsheet: `0.1 + 0.2` is `0.3`.

### 3.1 The arithmetic

`+`, `-`, `*` and `/` are the computer's own, to the full precision of the number, with nothing rounded
between steps. Dividing by zero is a mistake. A whole number is always exactly itself up to 2^53
(9,007,199,254,740,992); past that, numbers are as binary64 has them. A sum too big for a number gives
`Infinity` (or `-Infinity`), which shows as that.

### 3.2 A number's value to 15 digits

A number that isn't whole has a **value to 15 digits**: the binary64 number nearest to it rounded to 15
significant digits. A whole number's value is itself. This value is what's used wherever a number is
shown, compared or used as a whole number:

- **Shown** (`say`, text, `join`, `as text`, `save`): the value to 15 digits, written with as few digits
  as tell it apart: `1 / 3` shows as `0.333333333333333`, `2 / 3` as `0.666666666666667`,
  `123456.7890123456789` as `123456.789012346`. Whole numbers below 10^21 are written in full; numbers from
  10^21 up, and below 10^-6, are written with an exponent as JavaScript writes them: `1e+21`, `1e-7`. `-0`
  shows as `0`.
- **Compared** (`is`, `is less than` and the rest): by their values to 15 digits, so `0.1 + 0.2 is 0.3` is
  yes. Two whole numbers are compared exactly.
- **Used as a whole number**: an item's place (`item (0.1 * 30) of xs` is item 3), a count of times, a byte,
  a dictionary key (`0.1 + 0.2` finds the key `0.3`), `is divisible by`, `rounded`, bit operations, `bytes`,
  `as hex`, `to the power of`'s power, `stop the program with`, and `random number from`. Where a whole
  number is needed and the value isn't whole, it's a mistake.

`is divisible by` of two whole numbers is by their remainder; of others, it's whether `a / b` is whole to
15 digits.

### 3.3 Rounding

`x rounded down`, `x rounded up` and `x rounded` round x's value to 15 digits to a whole number: down,
up, or to the nearest, a half away from 0 (`-3.5 rounded` is `-4`). They round the whole sum before them:
`7 / 2 rounded` is `(7 / 2) rounded`. `x with 2 decimals` writes x as text with exactly that many decimals,
the last rounded a half away from 0, from the 15-digit value (`3.14159 with 2 decimals` is `"3.14"`).

`remainder of a divided by b` has b's sign, as Python's `%` does: `remainder of -7 divided by 3` is `2`. Of
two whole numbers it's exact; otherwise it's 0 whenever `a is divisible by b`, and else `a - b * (a / b
rounded down)`.

`x to the power of n` takes a whole n (to 15 digits) and multiplies x by itself, squaring as it goes, so
it's the same on every engine. `0 to the power of` a negative number is a mistake. math.moth's `power(x,
y)` takes any y.

### 3.4 Bits

`bit and`, `bit or`, `bit xor`, `shift ... left by` and `shift ... right by`, `as hex` and `as binary` work
on whole numbers from 0 to 2^53 - 1, so they never round. Anything else is a mistake, and so is a shift left
past 2^53 - 1. `shift x right by n` is `x / 2^n` rounded down. `255 as hex` is `"ff"`, in lower case.

## 4. Amounts with units

A number with a unit's word straight after it is an **amount**: `5 km`, `2 hours`, `300 g`. A unit's word
counts as one only straight after a number, or after `in`; anywhere else it's a name like any other.

| Measure | Units |
|:--|:--|
| a distance | `mm`, `cm`, `m`, `km`; `millimetre(s)`, `centimetre(s)`, `metre(s)`, `kilometre(s)` and the same with `-er`; `inch(es)`, `foot`/`feet`, `yard(s)`, `mile(s)` |
| a time | `millisecond(s)`, `second(s)`, `minute(s)`, `hour(s)`, `day(s)`, `week(s)` |
| a weight | `mg`, `g`, `kg`, `milligram(s)`, `gram(s)`, `kilogram(s)`, `ounce(s)`, `pound(s)`, `tonne(s)` |
| a volume | `ml`, `millilitre(s)`, `litre(s)`, `milliliter(s)`, `liter(s)` |

An inch is 0.0254 m, a foot 0.3048 m, a yard 0.9144 m, a mile 1609.344 m, an ounce 28.349523125 g and a
pound 453.59237 g.

- `a + b` and `a - b` of the same measure give an amount in a's unit: `5 km + 300 m` is `5.3 km`.
- An amount times a number, or a number times an amount, or an amount over a number, is an amount in the
  same unit. An amount over another of the same measure is a number: `10 km / 2 km` is `5`.
- `trip in miles` is the amount in another unit of the same measure.
- Amounts compare with `is`, `is less than` and the rest across units of a measure: `1 km is 1000 m`.
- `number of trip` is the number alone.
- An amount shows as its number and its unit, the unit for one when the number is 1 or -1: `1 mile`, `2
  miles`.
- Anything else, mixing measures included, is a mistake: `can't use '+' on a distance and a time`.

## 5. Expressions

### 5.1 How tightly things hold

From loosest to tightest:

| | Form |
|:--|:--|
| 1 | `a or b` |
| 2 | `a and b` |
| 3 | `not a` |
| 4 | `a is b`, `a is not b`, `a is less than b`, ... ; `job has ended` |
| 5 | `a bit and b`, `a bit or b`, `a bit xor b` |
| 6 | `a + b`, `a - b`, then after them: `in km`, `without repeats`, `rounded`, `with 2 decimals`, `in order` |
| 7 | `a * b`, `a / b` |
| 8 | after a value: `to the power of n`, `bytes`, `as text` and the other `as` words |
| 9 | `-a` |
| 10 | everything in section 5.5, and `(a)` |

`or`, `and`, `bit ...`, `+ -` and `* /` go from the left: `10 - 3 - 2` is 5. There's one comparison in each
part of a condition: `a is b is c` is a mistake; write `a is b and b is c`.

The words of section 5.5 that take a value after them (`length of x`, `uppercase of x`, `item 2 of x`,
`name of x`) take one value of level 9 or 10, so `length of xs + 1` is `(length of xs) + 1`, and `name of
item 1 of people` is the name of the first person. `ask`, `read` and the operations with two inputs take a
whole level-6 sum for each: `split text by ", "`.

### 5.2 Comparisons

```text
comparison = sum "is" [ "not" ] [ "less than" | "greater than" | "at least" | "at most"
                                  | "divisible by" | "in" ] sum
```

- `is` and `is not`: whether two values are the same (section 2.4).
- `is less than`, `is greater than`, `is at least`, `is at most`: two numbers (to 15 digits), two texts (by
  their characters' code points in turn, so `"B"` comes before `"a"` and `"apple"` before `"apples"`), or
  two amounts of one measure. Anything else is a mistake.
- `is divisible by`: two numbers; by 0 is a mistake.
- `a is in b`: an item of a list (as `is` finds it), a number in bytes, a key of a dictionary, or text
  inside text. Anything else is a mistake.

`not` before a comparison turns it round, as `is not` does.

### 5.3 Arithmetic and joining

- `+` adds two numbers, or two amounts of a measure. If either side is text, `+` joins the two as text,
  each shown as `say` shows it: `"total " + 3` is `"total 3"`. Anything else is a mistake.
- `-`, `*` and `/` work on numbers and amounts (section 4).

### 5.4 Minus

`-x` is minus a number or an amount. Anything else is a mistake.

### 5.5 Values

```text
value = number [ unit ]
      | text
      | "yes" | "no" | "nothing"
      | "list of" expression { "," expression }
      | "list of" expression "for each" name "in" expression [ "where" expression ]
      | "record with" name expression { "," name expression }
      | "dictionary where" sum "is" expression { "," sum "is" expression }
      | "empty list" | "empty record" | "empty dictionary"
      | "function" [ "with" name { ("," | "and") name } ] "gives" expression
      | name                                # a variable's value, or a function
      | name "(" [ inputs ] ")"             # a call
      | name "of" value                     # a field
      | value "'s" name                     # a field
      | value "'s" name "(" [ inputs ] ")"  # a call given the value first
      | file "'s" name                      # a name from a file used as a name
      | "(" expression ")"
      | the built-in operations of section 8
inputs = expression { "," expression } { "," name expression }
```

- `list of x for each x in xs where x is greater than 1` builds a list: the value after `list of` for each
  item, of those for which the `where` holds. `x` is the item's own name, which nothing outside sees.
- A **call** gives what the function returns. Inputs can be given by name after those given in order:
  `greet("Sam", greeting "Hi")` (section 7.2).
- `name of r` and `r's name` are r's field; reading a field r hasn't got is a mistake, with the closest name
  it has.
- `rex's speak()` calls `speak(rex)`. If the program makes nothing called `speak` (no function, input or
  variable, in any file it uses), it calls the function rex's `speak` field holds, with rex first.
  `(item 2 of dogs)'s name` and `rex's owner's name` work too.
- `function with x gives x * 2` is a function with no name, as a value.

### 5.6 Where a name is a call

A name followed by `(` is a call: `area(3, 4)`. A name on its own is the variable, or the function as a value.
A statement that starts with a name followed by a value is a call too: `greet "Sam"` (section 6.17). The one
place a space before the bracket matters is `draw picture (...)`: section 6.16.

## 6. Statements

### 6.1 set

```text
set = "set" name "to" expression
    | "set" name { "," name } "to" expression { "," expression }
    | "set" name "of" value "to" expression
    | "set" name "'s" name { "'s" name } "to" expression
    | "set" ( "item" | "byte" ) sum "of" value "to" expression
    | "set the slider" sum "to" expression
```

- `set x to 5` gives x a value. Section 7.5 says which variable it is inside a function.
- `set a, b to 1, 2` gives each name a value; `set a, b to b, a` swaps them. `set a, b to pair` gives each
  name an item of a list, which must have as many items as there are names, or it's a mistake.
- `set age of sam to 21` and `set sam's age to 21` change a field, or add it.
- `set item 2 of xs to x` changes a list's item, a dictionary's value for a key (adding the key if it isn't
  there) or a byte (a whole number from 0 to 255). A list's items and bytes' places must be there already:
  counted from 1, up to how many there are. Text can't be changed.

### 6.2 add

```text
add = "add" expression "to" name
```

To a list, adds the value at its end. To text, joins the value on, shown as `say` shows it. To a number,
adds a number; to an amount, an amount of the same measure. Anything else is a mistake. `add` takes a
variable, not a field: `add x to items of r` is a mistake.

### 6.3 say

```text
say = "say" expression { expression } [ "to the error output" ]
```

Shows each value as section 2.1 does, one after another with nothing between them, then a new line:
`say "Hi, " name "!"`. With `to the error output`, it goes to the error output instead.

### 6.4 if

```text
if = "if" expression NL block { "else if" expression NL block } [ "else" NL block ] "end"
```

`else if` on one line starts another `if` inside the `else`, which shares the first's `end`.

### 6.5 repeat

```text
repeat = "repeat" expression "times" NL block "end"
       | "repeat while" expression NL block "end"
```

The number of times is a whole number of 0 or more, worked out once. `repeat while` checks before each time
round.

### 6.6 for each

```text
for = "for each" name "from" expression "to" expression [ "by" expression ] NL block "end"
    | "for each" name { "," name } "in" expression [ "where" expression ] NL block "end"
```

- `for each i from 1 to 10` counts from the first number to the second, both included, by 1: none at all if
  the first is the larger. Both are numbers, and the loop stops when i, to 15 digits, is past the second.
  With `by`, it goes by that step, which can be negative and can't be 0, and stops before passing the
  second, as Python's `range` does: `from 10 to 1 by -2` is 10, 8, 6, 4, 2.
- `for each x in xs` goes through a list's items, text's letters, bytes' numbers, or a dictionary's keys in
  order. It goes through them as they were when it started: adding to the list inside the loop doesn't make
  it longer. Anything else is a mistake.
- `for each name, age in people` gives each name an item of each item (section 6.1's unpacking).
- `where` skips the items for which it doesn't hold.

### 6.7 stop

```text
stop = "stop" | "stop the program" [ "with" expression ]
```

`stop` leaves the loop it's in; outside a loop it's a mistake. `stop the program` ends the whole program at
once, with 0, or the number after `with`, a whole number from 0 to 255. Nothing catches it, not even
`try`, and an `either way` doesn't run.

### 6.8 Functions: to and return

```text
to     = "to" name [ "with" input { ("," | "and") input } ] [ "gives" gives ] NL block "end"
input  = name [ "as" type ] [ "or" default ]
type   = kind | ("a" | "an") name | "a list of" holds
kind   = "a number" | "text" | "yes or no" | "a list" | "a record" | "a dictionary" | "bytes" | "a function"
holds  = "numbers" | "text" | "yes or no" | "lists of" holds | "records" | "dictionaries" | "bytes"
       | "functions" | name
gives  = "nothing" | type [ "or nothing" ]
return = "return" [ expression ]
```

In `("a" | "an") name`, the name is a kind's (section 7.4), as `a dog`; in `holds`, it's what a kind makes,
more than one, as `dogs`, `boxes` or `puppies`. `gives` is a word only here, after a function's inputs: it
stays a name everywhere else.

Section 7 has what they mean. `return` outside a function is a mistake.

### 6.9 kind

```text
kind = "kind" name [ "with" input { ("," | "and") input } ] [ "from" expression ] NL { to } "end"
```

Section 7.4.

### 6.10 match

```text
match  = "match" expression NL { clause } [ "else" NL block ] "end"
clause = "when" sum { ("," | "or") sum } NL block
       | "when is" [ "not" ] [ comparison word ] sum NL block
```

The value is worked out once; the first `when` that fits runs, and if none does, the `else`. `when "go",
"walk"` fits a value that is one of them; `when is greater than 100` fits as that comparison would.

### 6.11 try

```text
try = "try" NL block [ "if it fails" [ "with" name ] NL block ] [ "either way" NL block ] "end"
```

A try has `if it fails`, `either way` or both. A mistake in the first block (section 9), however deep in
the functions it calls, stops it and runs the `if it fails` block, with the name given what `fail with`
gave, or the mistake's message as text. The block after `either way` runs however the rest ends: normally,
by a mistake, a `return` or a `stop`; after it, a mistake that wasn't handled is passed on, and a `return` or
`stop` happens.

### 6.12 fail and expect

```text
fail   = "fail with" expression
expect = "expect" expression
```

`fail with x` is a mistake of the program's own. x can be any value, so `fail with record with kind
"missing", file name` is one a `try` can tell from the rest. Not caught, it ends the program with x, as
`say` shows it, as its message.

`expect a is b` (or any comparison) is a mistake when it isn't so, saying what each side was: `expected 13
to be 12`. `expect done` needs `done` to be yes.

### 6.13 remove

```text
remove = "remove" sum "from" value | "remove the file" sum
```

`remove "Sam" from ages` takes a key out of a dictionary; a key that isn't there is a mistake. `remove the
file` is section 11.

### 6.14 Files, waiting and sound

```text
write = "write" expression "to" expression
save  = "save" expression "to" expression
wait  = "wait" sum time-unit | "wait for" expression
play  = "play note" sum "for" sum time-unit | "play a beep"
start = "start" call
```

`write` and `save` are section 11. `wait 2 seconds` waits (a number of 0 or more of `milliseconds`,
`seconds` or any unit of time). `wait for` and `start` are section 13. `play note "C4" for 0.5 seconds`
plays a note (`"C"` to `"B"`, with `#` or `b` and an octave, or `"rest"`), or a pitch in hertz from 20 to
20,000, for up to a minute; each sound starts when the one before it ends, and the program goes on at
once.

### 6.15 use

```text
use = "use" text [ "as" name ]
    | "use the package" text [ "as" name ]
    | "use the library" text { "or" text } [ "as" name ] NL { library-line } "end"
```

Only at a program's or a file's top level. Section 10.

### 6.16 Drawing and apps

```text
turtle = "move" ( "forward" | "back" ) expression | "move to" expression "," expression
       | "turn" ( "left" | "right" ) expression
       | "pen" ( "up" | "down" ) | "pen color" expression | "pen width" expression
       | "clear" | "clear the text box" sum | "clear the text area" sum
draw   = "draw box at" x "," y "size" w "by" h | "draw circle at" x "," y "size" r
       | "draw" expression "at" x "," y [ "size" expression ]
       | "draw picture" expression "at" x "," y [ "size" w "by" h ]
       | "draw chart of" ( name "in" expression | expression )
       | "draw button" sum "at" x "," y | "draw text box" sum "at" x "," y
       | "draw checkbox" sum "at" x "," y
       | "draw text area" sum "at" x "," y [ "size" w "by" h ]
       | "draw list" sum "showing" sum "at" x "," y [ "size" w "by" h ]
       | "draw dropdown" sum "showing" sum "at" x "," y
       | "draw slider" sum "from" sum "to" sum "at" x "," y
       | ( "tick" | "untick" ) "the checkbox" sum
```

The turtle starts in the middle of a 500 by 500 picture, facing up, its pen down, blue (`#4f8ff7`) and 2
wide; x goes right and y up, from -250 to 250. A colour is a CSS colour: a name, `#` and hex digits, `rgb()`, `rgba()`,
`hsl()` or `hsla()`. `draw picture` takes a file's name, or its bytes, when what follows it is text, a
number, a word that couldn't carry a value on, or a bracket with a space before it; `draw picture at 0, 0`
draws the text a variable called `picture` holds, and `draw picture(x) at 0, 0` what a call to `picture`
gives. Section 12 has the rest.

### 6.17 Calls as statements

```text
call = name [ "(" [ inputs ] ")" | inputs ]
     | value "'s" name ( "(" [ inputs ] ")" | [ inputs ] )
```

A line that starts with a name calls it: `greet "Sam"`, `greet("Sam")`, `sam's birthday()` or `sam's
rename "Max"`. What the call gives is dropped. A line that starts with a name and then `is` is a mistake
that says to use `set`. `give x` in a function is section 7.6.

### 6.18 when and every

```text
when  = "when" event [ "with" name { ("," | "and") name } ] NL block "end"
every = "every" sum time-unit NL block "end"
```

Only at a program's top level. Section 12.

## 7. Functions, kinds and names

### 7.1 Making and calling a function

`to area with width, height` makes a function called `area`, which is a value like any other: it can be
held in a variable or a field, given to a function, and called through it. A function made inside another
remembers the variables around it (a closure). A function can call itself; how deep is an implementation
detail.

A call gives each input the value given for it, runs the block, and gives what `return` gave, or nothing.
A call must give a function as many inputs as it has, counting the ones it can leave out (section 7.2):
`'area' needs 2 inputs but got 1`.

### 7.2 Inputs

- **What an input is.** `with width as a number` checks every call: `'area' needs width to be a number, not
  text`. The kinds are those of section 6.8's `kind`; `yes or no` is yes or no only, and `a number` is a
  number, not an amount.
- **What an input says beyond its kind.** `with pet as a dog` is checked at each call as `a record`, and
  `with xs as a list of numbers` as `a list`; that the record is one the kind dog made, or that every item is
  a number, isn't checked when the program runs. A function's `gives` (`gives a number`, `gives nothing`,
  `gives a dog or nothing`) isn't checked when it runs either. They say what the code means, for people and for
  the checker (`moth check`, the playground's Problems and the editors), which says where the code goes
  against them before it runs. A program means the same with them or without them.
- **Inputs left out.** `with name, greeting or "Hello"`: after `or`, a value written out (a number, text,
  yes, no, nothing, or a list of them), which each call that leaves the input out gets afresh. Every input
  after one with `or` needs one too.
- **Inputs by name.** `greet("Sam", greeting "Hi")`: after the inputs given in order, a name and a value, for
  a function made with `to`. They're worked out in the order of the function's inputs, and the ones left out
  get their `or`.
- A call through a variable, or through a record's field, gives every input, in order.

### 7.3 A value's own functions

`x's f(a)` is `f(x, a)`. Where nothing in the program is called `f`, it calls the function in x's field
`f`, with x first, so records made by different functions can each answer the same call in their own way.

### 7.4 Kinds

```text
kind dog with name, sound or "woof"
    to speak with self
        return self's name + " says " + self's sound
    end
end
```

`kind dog` makes a function `dog`, with those inputs, that gives a record of them, with a field `kind` that
is `"dog"` and a field for each of the kind's functions. So `dog("Rex")'s speak()` calls dog's `speak`
with the dog first, and `dog's speak` is that function. A kind holds only functions made with `to`; an
input can't be called `kind`, and a function can't have an input's name.

`kind puppy with name from dog(name, sound "yip")` makes a puppy from what `dog(...)` gives: it's given
puppy's inputs, kind and functions, and `dog's speak(self)` calls dog's own. A kind's function called
`shown` says how `say`, and a value in text, show its records.

### 7.5 Which variable a name is

- At a program's top level, `set x` makes or changes the top level's x.
- **Inside a function, `set x` (or `add`, or `for each x`) changes a variable of the top level, or of a
  function the function is inside, only if that variable is made above the function's `to` line.**
  Otherwise x is the function's own, made afresh for each call.
- A name a function only reads can be set anywhere around it, even below the function.
- An input is the function's own.
- Reading a variable that hasn't been given a value is a mistake (`'totl' has no value yet. Did you mean
  'total'?`), as is calling a name that isn't a function.
- Every name in a file used `as` a name is that file's own (section 10.1).

### 7.6 give

In a function, `give x` adds x to a list the function gives back when it returns, unless the program makes
something of its own called `give`:

```text
to squares_to with n
    for each k from 1 to n
        give k * k
    end
end
say squares_to(4)        # [1, 4, 9, 16]
```

The function runs to its end before the list is there.

## 8. Built-in operations

Each of these checks what it's given first, and a value of the wrong kind is a mistake that says what was
wanted and what it got: `'uppercase of' needs text, not a number`.

### 8.1 Text

| Operation | Gives |
|:--|:--|
| `length of x` | text: how many characters (Unicode code points, so `"é"` and `"😀"` are 1 each); also a list's items, a dictionary's keys, bytes' numbers |
| `item n of text` | the nth character, from 1 |
| `items a to b of text` | the characters from a to b, both kept: text; `""` if b is before a |
| `uppercase of t`, `lowercase of t` | t in upper or lower case, by Unicode's full mapping (`uppercase of "straße"` is `"STRASSE"`) |
| `split t by s` | a list of the pieces of t between each s; by `""`, its characters |
| `join xs with s` | text: each item of the list shown as `say` shows it, with s between |
| `position of a in b` | where text a first starts in text b, counted in characters from 1, or 0 |
| `number of t` | the number text writes, an optional minus, digits and an optional point and digits, with spaces around allowed; anything else is a mistake. Of a number, itself; of an amount, its number |
| `x as text` | x as `say` shows it; bytes read as UTF-8, with U+FFFD for what isn't |
| `x with n decimals` | text: section 3.3 |
| `a is in b` | section 5.2 |

`join xs with a + b` takes all of `a + b` as what goes between; to join and then add, use brackets.

### 8.2 Lists

| Operation | Gives |
|:--|:--|
| `item n of xs` | the nth item, from 1; also of text, bytes, and a dictionary by key |
| `items a to b of xs` | a new list of the items from a to b, both kept; empty if b is before a |
| `xs in order`, `xs in reverse order` | a new list sorted smallest first (or largest first): all numbers, or all text (by code point); equal ones keep their order |
| `xs in order by f`, `xs in reverse order by f` | a list of records, sorted by their field f |
| `xs without repeats` | a new list with each item once, where it first is |
| `total of xs` | the sum of the numbers, or of the amounts of one measure; `nothing`s are skipped; 0 for none |
| `average of xs` | the total over how many there are; a list with nothing in it is a mistake |
| `largest of xs`, `smallest of xs` | the first item no other beats |
| `f in rows` | after `total of`, `average of`, `largest of`, `smallest of` and `draw chart of`: each row's field f |
| `keys of d` | a dictionary's keys, in order, as a list |

`in order`, `without repeats` and `rounded` take the sum before them, which in `list of` is its last item:
write `(list of 3, 1, 2) in order`.

An item number must be a whole number from 1 to how many there are: `there is no item 4, the list only has
3 items`. A dictionary's key must be there to be read.

### 8.3 Numbers

`x rounded`, `x rounded down`, `x rounded up`, `remainder of a divided by b`, `x to the power of n`,
`random number from a to b` (a whole number from a to b, each as likely), `a bit and b`, `a bit or b`, `a
bit xor b`, `shift x left by n`, `shift x right by n`, `x as hex` and `x as binary`. Section 3 has what they
do.

### 8.4 Bytes

`n bytes` is that many bytes, all 0. `x as bytes` is text's UTF-8, a list of whole numbers from 0 to 255,
or a copy of bytes. `byte n of b` is `item n of b`. `set byte n of b to v` needs v from 0 to 255.

### 8.5 Data

| Operation | Gives |
|:--|:--|
| `x as json` | JSON text of a number, text, yes, no, nothing, list, record or dictionary |
| `json from t` | what JSON text says: objects as dictionaries, arrays as lists, `true`/`false` as yes/no, `null` as nothing |
| `read table f` | a CSV file (or site) as a list of records, a row each: the first row names the fields, in lower case, with `_` for anything but letters and digits; a cell that's a number is that number, an empty one nothing, any other text |
| `save x to f` | writes x as section 2.1 shows a value inside a list: numbers to 15 digits, text in quotes, yes, no, nothing, lists, records and dictionaries; functions, bytes, amounts, and a list that holds itself can't be saved |
| `load f` | reads back what `save` wrote, as it was |

### 8.6 Asking

`ask q` shows q and gives the line typed in answer, as text. If the input has ended, it's a mistake.
`ask for n bytes` gives the input's next n bytes, as bytes: it waits for them, but not for a line's end, and
gives fewer if the input ends first, and none once it has ended. Both read the same input, so a line `ask`
reads is gone for `ask for`, and the other way round. n is a whole number from 0, as `n bytes` takes. Only a
program moth builds reads its input so; on the playground's engines it's a mistake.
`choose a file to open` (or `to save`) gives the file chosen, or nothing.

### 8.7 Files, folders, sites and programs

`read f`, `read bytes f`, `read the folder f`, `write x to f`, `remove the file f`, `read f with headers h`,
`send x to a`, and `run program p with args`. Section 11.

### 8.8 The program

`arguments` is the list of texts the program was started with, after its own name.

### 8.9 Drawing and apps

`the text in the text box l` (or text area), `the value of the slider l`, `the choice in the list l` (or
dropdown), and `the checkbox l is ticked` (or `is not ticked`). Section 12.

### 8.10 Tasks

`start f(x)`, `wait for job` and `job has ended`. Section 13.

### 8.11 The time

| Value | Gives |
|:--|:--|
| `the time` | text, `14:05:09` |
| `the date` | text, `2026-10-30` |
| `the year`, `the month`, `the day`, `the hour`, `the minute`, `the second` | numbers |
| `the weekday` | text, `Friday` |
| `the clock` | seconds since the program started, to the millisecond |

They're the time where the program runs, in its time zone.

### 8.12 The language's own functions

`with ... decimals` and a kind's `shown` are written in Moth, in the language's own functions, which the
program carries when it uses them. Their names start with `the language's`, which no program can write.

## 9. Mistakes

### 9.1 Two times a mistake is found

- **While the program is read.** A mistake in how a program is written (a word in the wrong place, a block
  with no `end`, a name used as a reserved word, a `use` of a file that isn't there) is found before
  anything runs. `moth build` makes no program, `moth run` runs nothing, and both end with 1.
- **While it runs.** Anything this document calls a mistake when it runs (dividing by zero, an item that
  isn't there, a value of the wrong kind, a `fail with`, a refusal of section 11) stops the statement and
  goes to the nearest `try` around it, in this function or any that called it. With none, the program ends.

### 9.2 How a mistake is reported

A mistake that ends a program goes to the error output, as the file, line and column where it is, what
went wrong, the line itself, and a `^` under the spot; then, for one inside functions, the calls that led
there, innermost first:

```text
report.moth:2:24: can't divide by zero
    return total of xs / length of xs
                       ^
  in 'average', called from line 5
  in 'report', called from line 8
```

A function that called itself from the same spot many times is one line with how many (`(1,000 times)`),
and at most 10 calls are listed, then `... and 4 more`. A mistake inside a file the program uses names
that file. The program then ends with 1.

**Guaranteed:** that a mistake ends the program with 1, where it goes, the file, line and column, the
excerpt and `^`, and the order of the calls. **Implementation detail:** the words that say what went wrong.
They're written to help, and a release can make them clearer, so a program should tell its mistakes apart by
what it gave `fail with`, not by a message's words.

### 9.3 What a try catches

Every mistake that happens while a program runs, `fail with` and the refusals of section 11 included. Not
`stop the program`, and not a mistake found while the program is read.

## 10. Files and packages

### 10.1 use

- `use "shapes.moth"` reads that file and puts its code where the `use` is, its names in with the
  program's, where they can collide.
- `use "math.moth" as math` keeps the file's names to itself, as if it ran alone: the program reaches them
  as `math's sqrt(2)`, and the file's functions' variables are theirs.
- A file is found from the folder of the file that uses it. It must be in the program's folder or a folder
  inside it: a name that starts at the top of a disk (`/x`, `C:x`) or goes up (`../x`) is a mistake, and so
  is a link inside the folder that leads out of it.
- If the file isn't there, moth looks in the **standard library** it carries (section 10.3), for the name
  in quotes, from any file: the program, a package, or a file either uses.
- A file is read once for each name it's used as, and once without one; two files that use each other are
  a mistake.
- `use the package "json" as json` is `packages/json/json.moth`, from the program's folder, wherever the
  `use` is written. A package's name is letters, digits, `-`, `_` and `.`.

### 10.2 use the library

```text
use the library "user32"
    MessageBoxW(a pointer, wide text, wide text, a whole number) gives a whole number
end
```

Calls a C library's functions, in a program `moth build` makes, on Windows or Linux. Each line names a
function, what it takes and what it `gives`: `a number` (double), `a float`, `a whole number` (int), `a
long whole number` (64 bits), `a byte`, `a signed byte`, `a short whole number`, `an unsigned short whole
number`, `an unsigned whole number`, `an unsigned long whole number`, `a pointer` (a whole number, nothing
or bytes), `text` (UTF-8), `wide text` (wchar_t), `bytes` (the program's memory, for C to fill) and `yes or
no` (an int). A name Moth has for its own goes in quotes: `"remove" as remove_file(text)`. `structure point
with x as a whole number, y as a whole number` makes `a point`, a record C sees as its struct, and `a point
by value` passes it as itself; `callback compare(a pointer, a pointer) gives a whole number` makes `a
compare`, a function of the program's that C calls. At most 16 inputs each. A library is found by its name
as the system finds one: on Windows `"user32"` is user32.dll from System32 or else the program's folder, on
Linux `"sqlite3"` is libsqlite3.so (or `.so.0` to `.so.9`). It needs `--allow-libraries` (section 11).

### 10.3 The standard library

moth carries these files, so `use "json.moth"` works in any folder: `math.moth`, and from `tools/`:
`base64`, `big`, `charts`, `collections`, `cores`, `crypto`, `dates`, `email`, `fractions`, `game`, `hash`,
`http`, `images`, `installer`, `json`, `jwt`, `linux`, `lists`, `log`, `mysql`, `oauth`, `options`,
`postgres`, `redis`, `s3`, `secrets`, `server`, `sets`, `sockets`, `sqlite`, `stats`, `sync`, `system`,
`tasks`, `text`, `toml`, `ui`, `websocket`, `windows`, `wire`, `xml`, `yaml`, `zip` and `zones`, each
`.moth`. A file of the same name beside the file that uses it is used instead: beside the program for the
program, and in a package's folder for the package. Each
file's own comments say what its functions do; [VERSIONING.md](VERSIONING.md) says which of them are kept.

### 10.4 Packages

A package is a Git repository of Moth files whose main file is named after it. moth runs the system's
`git` to fetch them.

- **`moth.packages`**, in the folder moth runs in, lists a program's packages, a line each: its name, where
  it comes from, and the full commit it's at, with spaces between. Where it comes from is an address, a
  site's short form (`github.com/someone/thing`, which is `https://github.com/someone/thing`; also
  `gitlab.com/`, `codeberg.org/` and `bitbucket.org/`), or a folder; with `@` and a tag, branch or commit
  after its last part, it was asked for at that version. A line that starts with `#` is a comment.
- **`moth.sums`**, beside it, has the SHA-256 of each package's files at that commit: a line each, the
  package's name, the commit and `sha256:` and 64 hex digits. The sum is worked out as `sha256sum` writes
  one: for each file in the package's folder but Git's own (any `.git` folder or file), in the order of its
  path's bytes, with `/` between its parts, its SHA-256 in hex, two spaces, its path and a line end; and the
  SHA-256 of all that. On Linux:

  ```text
  cd packages/thing && find . -type f ! -path '*/.git/*' ! -name .git | sed 's|^\./||' \
      | LC_ALL=C sort | xargs sha256sum | sha256sum
  ```

- **Checking out.** moth checks a package's files out as they are in the repository, whatever the system or
  the person's own git settings: line ends as they were committed (or as the repository's own
  `.gitattributes` says, the same everywhere), and a symbolic link as a small file holding where it points.
  So a package's files, and their sum, are the same on Windows and Linux.
- `moth add <where> [name]` fetches a package into `packages/<name>`, lists it with its commit and writes its
  sum, and then the packages its own `moth.packages` lists, at their commits, unless one of that name is
  here already, each checked against the sum its own `moth.sums` has for it, if it has one. A name alone
  (no `/`, `\` or `:`, and no folder of that name here) is a package in the package index.
- `moth get` makes `packages/` match the list: each package fetched, or moved to its commit, and its files
  checked against `moth.sums`. A package whose files aren't what its sum says is a mistake: if it was there
  already, the files that changed are named and left as they are; if it was just fetched, it isn't kept. A
  package with no sum yet is fetched again and its sum written down.
- `moth update [name]` checks a package's files, moves it to the newest commit where it comes from (a
  branch's, if it was asked for at one; one asked for at a tag or a commit stays there) and writes the new
  commit and sum down.
- `--signed`, after `moth add`, `get` or `update`, takes only a package whose commit, or the tag it was
  asked for at if that's a signed tag at that commit, has a signature `git verify-commit` or `git
  verify-tag` accepts: one made by a key in the person's GPG keyring, or in the file
  `gpg.ssh.allowedSignersFile` names for SSH signatures. A newest commit that isn't signed isn't taken.
- `moth remove <name>` takes a package's folder and lines away; `moth packages` lists them.
- **The package index** is a JSON file: `{"packages": {"thing": {"repository": "github.com/someone/thing",
  "about": "..."}}, "advisories": [...]}`. By default it's
  `https://raw.githubusercontent.com/samyyy2423/moth-packages/main/index.json`, read with `curl`; `--index`
  gives another, an address or a file. `moth search [words]` lists its packages, or those with every word
  in their name or what they're about.
- **Advisories.** Each is a JSON object about one package: `package` (its name in the index) or
  `repository`; `id`, `severity`, `about` and `link`, which `moth audit` shows; and which commits it's about:
  `commits`, a list of commits (all of one, or its first 7 or more hex digits), and `introduced` and `fixed`,
  each a commit, for the commits from `introduced` on (`"0"`, or none, for from the first) that aren't from
  `fixed` on. One with none of those is about every commit. `moth audit` checks each package moth.packages
  lists against them, matching where it comes from in lower case without `https://`, `.git` or a `/` at its
  end, and says which are about the commits they're at. It ends with 0 if none are, and 1 if one is, or if a
  package whose history it needs isn't fetched.

## 11. The world outside, and the permission flags

### 11.1 Files and folders

| | |
|:--|:--|
| `read f` | a file's text, read as UTF-8, with U+FFFD for what isn't |
| `read bytes f` | a file's bytes |
| `read the folder f` | the names of what's in a folder, in order, a folder's name ending in `/` |
| `write x to f` | writes text, or bytes, or anything else as `say` shows it, making the file or replacing it |
| `remove the file f` | removes a file, which must be there |

A file's name is text, from the folder the program runs in, unless it starts at the top of a disk. A file
that isn't there, or can't be read, is a mistake.

### 11.2 Sites

`read "https://..."` (and `read bytes`, and `read table`) reads a site with a GET: on Windows through
WinHTTP, with the system's certificates, and on Linux through the system's `curl`. A move to another
address (an answer from 300 to 399 that says where) is a new address, asked about again (section 11.4), ten
moves at most; any other answer from 300 up is a mistake (`the site answered 404`). A site gets 60 seconds.
`send x to "https://..."` POSTs x (text as it is, anything else as JSON) and gives back the reply as text.
`with headers h` adds a dictionary of text headers to a `read` or a `send`; a `send`, or a `read` with
headers, doesn't follow a move.

### 11.3 Programs

`run program "git" with (list of "status")` starts a program, gives it this program's input and output,
waits for it and gives the number it ended with; with `keeping its output` after it, a record of `code`,
`output` and `mistakes` (what it wrote to its error output). A name with no folder in it is looked for on
Linux in PATH, and on Windows in System32, then Windows' folder, then PATH, never beside the program or in
the folder it runs from. On Windows, an argument to a `.bat` or `.cmd` file can't hold `" % ^ & | < > !` or
a line break, since cmd.exe would read those as part of a command. `say ... to the error output`, `stop the
program`, `run program` and `remove the file` only work in a program `moth build` makes; in the playground,
starting a program is a mistake that says so.

### 11.4 Asking first, and the flags

A program moth makes **asks before it reads a file, writes one, goes online, starts another program or uses
a library**, as Deno does. At a terminal the person is asked, once for each file, site, program or library:

```text
moth: let this program read 'notes.txt'? (y = yes, a = yes to all, n = no)
```

Anywhere else (in a script, a service, a pipe), the answer is no. A no is a mistake a `try` can catch:
`can't read 'notes.txt': this program isn't allowed to read files (start it with --allow-read)`.

The flags given to `moth build` are built into the program, and `moth run`, `debug`, `profile`,
`coverage`, `test`, `notebook` and the shell take them too, before the file:

| Flag | Lets the program |
|:--|:--|
| `--allow-read` | read any file or folder |
| `--allow-read=data,notes.txt` | read those files, and everything in those folders |
| `--allow-write`, `--allow-write=out` | write and remove files, anywhere or only there |
| `--allow-net`, `--allow-net=example.com` | read and send to any site, or only that host, exactly, at any port (or only the port named) |
| `--allow-run` | start other programs (it names none) |
| `--allow-libraries` | use C libraries |
| `--allow-all` | all of them |

A file named by a flag is checked where it really is: `data/../notes.txt`, and a link inside `data` that
leads out of it, aren't in `data`. A web address written in an odd way (`a.com@b.com`, a backslash) matches
no host.

**What this protects against, and what it doesn't**, is in [SECURITY.md](SECURITY.md). In short: the flags
keep a Moth program to what it was allowed; a C library, and a program it starts, can do anything.

### 11.5 Standard input, output and error

`say` writes to the standard output, `say ... to the error output` and mistakes to the standard error, and
`ask` reads a line from the standard input. Output is UTF-8. A program ends with 0, with what `stop the
program with` gave, or with 1 for a mistake.

### 11.6 The command's release version

`moth --version` and `moth version`, with no other arguments, write `moth MAJOR.MINOR.PATCH` and a
newline to the standard output, write nothing to the standard error, and end with 0. The version is the
release version from `package.json`, built into moth when it is made; no file beside the installed program
or in the current folder is needed. Extra arguments are wrong usage, reported on the standard error with
exit code 2. `moth build app.moth --version 1.2.0` still sets the built program's version.

## 12. Apps

A program can wait for things to happen once its top level has run:

```text
when a key is pressed with key            # "left", "space", "a", ...
when the mouse is clicked with x and y    # also: when the mouse is dragged with x and y
when the button "Add" is clicked
when enter is pressed in the text box "Name" with words
when the checkbox "Dark" is clicked
when an item is chosen in the list "Fruits" with fruit     # or in the dropdown
when the slider "Volume" is moved with volume
every 100 milliseconds                    # or any amount of time above 0
```

Each runs its block when that happens, with the values named after `with` (as many as the event gives, or
none). `when` and `every` work only at a program's top level. A program with any of them keeps running after
its top level ends, in the playground or in a window of its own (on Windows, and on Linux with an X server),
until it's closed or `stop the program` runs. A mistake in a handler ends the program.

The controls of section 6.16 are drawn where they're placed and found by their label. A text box holds one
line of up to 40 letters and a text area 2,000; a slider's value is a whole number, kept between its ends;
`the choice in the list` is nothing until there is one.

## 13. Tasks and workers

`start count(10)` runs the call on a thread of its own and gives a task, a record, at once; `wait for job`
waits for it to end and gives what the call gave; `job has ended` says whether it has, without waiting.
Tasks share the program's variables. A mistake in a task ends the program.

`start count(10) on another core` runs the call on a worker and gives a record of its number, `(record with
worker 1)`; `wait for` and `has ended` take it as they take a task. A worker shares nothing with the program:
it's given copies of the call's inputs and of the program's variables as they are when it starts, and what it
changes is its own. `wait for` gives a copy of what the call gave; if the call ended with a mistake, `wait
for` fails with it (a `try` around `wait for` catches it, with the value `if it fails with` would have given
inside the worker). A copy is made of numbers, text, yes and no, nothing, lists, records, dictionaries, bytes,
amounts and functions made at the top of a file, all the way down; a function made inside another, or a value
nested more than 1,000 deep, can't be copied, which is a mistake where the worker is started (its inputs or
its function) or waited for (what it gave), and a variable of the program's that holds one has no value in
the worker. A worker's own tasks and workers are numbered from 1. No more than 64 workers may have ended or
be working with nothing having waited for them; starting another is a mistake. A program ends its workers, as
it ends its tasks, before it ends, and so does a worker.

**Implementation detail:** in a program moth builds, tasks take turns: one runs Moth at a time, and lets the
others run every so often and whenever it waits (for input, a program, a site, a window, a C function or
`wait`), so a task keeps a program from waiting but doesn't make a sum faster on more cores. Workers run at
the same moment, each a thread with a copy of the program's memory, on as many cores as there are; a worker's
tasks take turns among themselves. In the playground, a task or a worker runs to its end when it's started.

## 14. Implementation details

These are how Moth works today. Any release can change them.

- **The engines.** moth makes x86-64 machine code for Windows and Linux; the playground runs a bytecode
  virtual machine, a JIT to JavaScript, and WebAssembly. They're tested to say, draw, write and fail alike.
- **The words of a mistake** (section 9.2) and of moth's own messages, and what `moth check` warns about.
- **Limits.** How deep functions can call themselves (100,000 calls on the playground's engines; in machine
  code, as far as the stack goes), how deeply code can be nested, how long a program can run in the
  playground before it's stopped (it's given a number of steps), and how big a value can be.
- **Memory.** How values are laid out, the garbage collector, and where a program is loaded (at a fixed
  address).
- **How tasks take turns, and how workers run** (section 13), and how many C callbacks of each kind can be
  waiting at once (64).
- **Speed**, and what's put in line or kept in registers.
- **Text order beyond U+FFFF.** `is less than` on text compares UTF-16 units on the playground's engines,
  which can put a character beyond U+FFFF before one from U+E000 to U+FFFF; `in order` sorts by code point
  everywhere.
- **The playground.** Its files last for one run; only sites that let any page read them can be read;
  answering a question runs the program again from the start; it can't start programs or use libraries.
- **The bytes `moth build` makes**, which are the same for the same source and moth, but change between
  releases.
- **The text of `moth.packages` and `moth.sums`'s comment lines**, which moth writes again when it changes
  them.
