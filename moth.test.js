import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { run, test as testMoth, format, debug, timeline, check, compile, compileToJs, compileToWasm, load, mothCompiler, memoryDisk, excerpt, describeTrail, MothError } from "./moth.js";
import { Machine } from "./vm.js";
import examples from "./examples.js";

const ENGINES = ["jit", "wasm", "vm"];

function output(source, options) {
  const lines = [];
  run(source, (line) => lines.push(line), options);
  return lines.join("\n");
}

function error(source, options) {
  try {
    output(source, options);
  } catch (err) {
    if (err instanceof MothError) return err;
    throw err;
  }
  assert.fail("expected the program to fail");
}

const EXAMPLES = {
  "Spiral": "", // the drawing examples only draw; see the next test
  "Tree": "",
  "Hello": "Hello, world!\nMy name is Moth and it has 4 letters.",
  "Repeat": "*\n**\n***\n****\n*****",
  "FizzBuzz": "1\n2\nFizz\n4\nBuzz\nFizz\n7\n8\nFizz\nBuzz\n11\nFizz\n13\n14\nFizzBuzz",
  "Lists": "I like apple\nI like banana\nI like cherry\nI like mango\nThat's 4 fruits, and the first is apple",
  "Functions": "Hello, Sam!\nfib(20) is 6765",
  "Counter": "Ticked 3 times",
  "Records": 'Sam is 20\nAna is 31\n(record with name "Sam", age 21)',
  "Primes": "Primes up to 50: [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47]",
  "Guess": "Guess my number (1 to 100): 50\nLower\nGuess my number (1 to 100): 25\nHigher\nGuess my number (1 to 100): 37\nYes! 37 in 3 tries",
};

test("every playground example runs, on all three engines", () => {
  for (const engine of ENGINES) {
    for (const [name, source] of Object.entries(examples)) {
      if (name === "Errors") assert.equal(error(source, { engine }).message, "line 3: there is no item 5, the list only has 2 items");
      else {
        const answers = ["50", "25", "37"]; // for Guess, the one that asks
        const said = [];
        run(source, (line) => said.push(line), { engine, ask: (question) => (said.push(`${question} ${answers[0]}`), answers.shift()) });
        assert.equal(said.join("\n"), EXAMPLES[name], `${engine}: ${name}`);
      }
    }
  }
});

const PROGRAMS = [
  // a `set` inside a function changes a variable the top level also sets
  ["set total to 0\nto bump\n    add 5 to total\nend\nbump\nbump\nsay total", "10"],
  // this is decided when the program is read, so it holds even before the top level's own `set` runs
  ["to f\n    set x to 1\nend\nf\nsay x\nset x to 2", "1"],
  // ...but a variable only the function sets stays inside it, so every call starts fresh
  ["to f\n    set count to 0\n    add 1 to count\n    return count\nend\nsay f() f()", "11"],
  // inputs and functions made with `to` always belong to their own function
  ["set n to 1\nto f with n\n    set n to 5\nend\nf(2)\nsay n", "1"],
  ['to helper\n    say "global"\nend\nto f\n    to helper\n        say "inner"\n    end\n    helper\nend\nf\nhelper', "inner\nglobal"],
  ["to sum with n\n    if n is 0\n        return 0\n    end\n    return n + sum(n - 1)\nend\nsay sum(10000)", "50005000"],
  ["to find with xs\n    for each x in xs\n        if x is greater than 1\n            return x\n        end\n    end\nend\nsay find(list of 1, 2, 3) find(list of 0)", "2nothing"],
  ["if yes\n    set x to 1\nend\nsay x", "1"],
  ['to boom\n    return 1 / 0\nend\nsay (no and boom()) " " (yes or boom())', "no yes"],
  ['say (3 is less than 5) " " (5 is at least 5) " " (4 is not divisible by 2) " " ("apple" is less than "banana")', "yes yes no yes"],
  ['say (list of 1, 2) is (list of 1, 2) " " (list of "a", nothing, yes)', 'yes ["a", nothing, yes]'],
  ['say length of "héllo😀" " " item 6 of "héllo😀"', "6 😀"],
  ['say "tab\\there \\"quoted\\""', 'tab\there "quoted"'],
  ["set xs to list of 1, 2\nset item 1 of xs to 9\nsay xs", "[9, 2]"],
  ['set s to "a"\nadd 1 to s\nsay s', "a1"],
  ["set total to 1 +\n    2\nsay total", "3"],
  ['SAY "hi"\nSet X to 1\nsay x', "hi\n1"],
  ["to area with width and height\n    return width * height\nend\nsay area(3, 4)", "12"],
  ['to pair with a, b\n    say a " & " b\nend\npair "x", "y"\npair("p", "q")', "x & y\np & q"],
  ["to f\n    return\nend\nsay f()", "nothing"],
  ['repeat 0 times\n    say "never"\nend\nfor each n from 3 to 1\n    say "never"\nend\nsay "done"', "done"],
  ['say 2 + 3 * 4 " " (-(2 + 3)) " " (not 1 is 2)', "14 -5 yes"],
  ["set n to 0\nrepeat while n is less than 3\n    add 1 to n\nend\nsay n", "3"],
  // records
  ['set p to record with name "Sam", age 20\nset age of p to 21\nsay name of p " " age of p', "Sam 21"],
  ['set a to record with x 1, inner record with y 2\nsay y of inner of a " " (a is record with x 1, inner record with y 2)', "2 yes"],
  ['set r to empty record\nset colour of r to "red"\nsay r " " (r is empty record)', '(record with colour "red") no'],
  ["set r to record with n 2\nset xs to list of 10, 20\nsay item (n of r) of xs \" \" item 1 of xs", "20 10"], // `n of r` needs brackets inside `item ... of`
  // numbers: leading zeros are fine, and one too big for JavaScript is Infinity on both engines
  ["say 007 + 00.5 \" \" 2.50", "7.5 2.5"],
  [`say 1${"0".repeat(400)}`, "Infinity"],
  // divisible by: fractions, negatives, and numbers past 2^52, where the WebAssembly engine leaves it to JavaScript
  ["say (7.5 is divisible by 2.5) \" \" (0 - 4 is divisible by 2) \" \" (9007199254740992 is divisible by 3) \" \" (10 is divisible by 4)", "yes yes no no"],
  // variables that only ever hold numbers (unboxed by the WebAssembly engine)
  ['set n to 1\nsay n\nadd 2 to n\nsay n " " (n * 2) " " (n is 3) " " (n / 4)', "1\n3 6 yes 0.75"],
  ['set total to 0\nfor each i from 1 to 5\n    add i to total\nend\nsay total " " i', "15 5"],
  ['set x to 10\nset y to x - 3\nset x to y * 2\nsay x " " y " " (x is divisible by 7) " " (0 - x)', "14 7 yes -14"],
  ["set a to 0 / 1\nset b to 1\nrepeat 3 times\n    set b to b * 2 + a\nend\nsay b", "8"],
  // every control character is a space, and a comment runs to the end of the line
  ["say 1\v+\f2\r\n# a comment say 3\nsay 4", "3\n4"],
  // stop leaves the loop it's in, and only that one
  ["for each n from 1 to 10\n    if n is 4\n        stop\n    end\n    say n\nend", "1\n2\n3"],
  ["repeat 3 times\n    for each c in \"abc\"\n        if c is \"b\"\n            stop\n        end\n        say c\n    end\nend", "a\na\na"],
  ["set i to 0\nrepeat while yes\n    add 1 to i\n    if i is 5\n        stop\n    end\nend\nsay i", "5"],
  ["to first_big with xs\n    set found to nothing\n    for each x in xs\n        if x is greater than 10\n            set found to x\n            stop\n        end\n    end\n    return found\nend\nsay first_big(list of 3, 12, 40)", "12"],
  // text helpers: upper and lower case, split, join, number, position
  ["set line to \"the quick brown fox\"\nset words to split line by \" \"\nsay words \" \" length of words\nsay uppercase of item 2 of words \" \" lowercase of \"LOUD\"\nsay join words with \"-\"", "[\"the\", \"quick\", \"brown\", \"fox\"] 4\nQUICK loud\nthe-quick-brown-fox"],
  ["say number of \" 42 \" + 1 \" \" number of \"-2.5\" * 2 \" \" number of 7", "43 -5 7"],
  ["set line to \"the quick brown fox\"\nsay position of \"brown\" in line \" \" position of \"cat\" in line \" \" position of \"x\" in \"😀x\"", "11 0 2"],
  ["say split \"héllo\" by \"\" \" \" join list of 1, yes, nothing with \", \"", "[\"h\", \"é\", \"l\", \"l\", \"o\"] 1, yes, nothing"],
  // try ... if it fails: a mistake, or a fail with, is caught and the program goes on
  ["to risky with n\n    if n is 3\n        fail with record with code 3, reason \"three is bad\"\n    end\n    return 10 / n\nend\nfor each n from 0 to 4\n    try\n        say n \": \" risky(n)\n    if it fails with problem\n        say n \": caught \" problem\n    end\nend", "0: caught can't divide by zero\n1: 10\n2: 5\n3: caught (record with code 3, reason \"three is bad\")\n4: 2.5"],
  ["try\n    fail with \"x\"\n    say \"never\"\nif it fails with e\n    say \"got \" e\nend\nsay \"after\"", "got x\nafter"],
  ["try\n    try\n        say 1 / 0\n    if it fails with e\n        fail with \"again: \" + e\n    end\nif it fails with e\n    say e\nend", "again: can't divide by zero"],
  ["to safe_div with a, b\n    try\n        return a / b\n    if it fails\n        return 0\n    end\nend\nsay safe_div(6, 3) \" \" safe_div(1, 0)", "2 0"],
  ["set total to 0\nfor each k from 1 to 10\n    try\n        if k is 4\n            stop\n        end\n        add k to total\n    if it fails\n        say \"never\"\n    end\nend\nsay total", "6"],
  ["to deep with n\n    if n is 0\n        say 1 / 0\n    end\n    return deep(n - 1)\nend\ntry\n    deep(3000)\nif it fails with why\n    say \"deep: \" why\nend", "deep: can't divide by zero"],
  // dictionaries: look things up by key, change them, go through their keys; and `is in`
  ["set ages to dictionary where \"Sam\" is 20, \"Ana\" is 31\nsay item \"Sam\" of ages\nset item \"Bo\" of ages to 7\nsay ages\nsay length of ages\nremove \"Ana\" from ages\nsay ages\nsay \"Sam\" is in ages\nsay \"Ana\" is in ages\nsay keys of ages", "20\n(dictionary where \"Sam\" is 20, \"Ana\" is 31, \"Bo\" is 7)\n3\n(dictionary where \"Sam\" is 20, \"Bo\" is 7)\nyes\nno\n[\"Sam\", \"Bo\"]"],
  ["set counts to empty dictionary\nfor each w in split \"a b a c b a\" by \" \"\n    if w is in counts\n        set item w of counts to item w of counts + 1\n    else\n        set item w of counts to 1\n    end\nend\nfor each w in counts\n    say w \": \" item w of counts\nend", "a: 3\nb: 2\nc: 1"],
  ["set squares to dictionary where 1 is 1, 2 is 4, 3 is 9\nsay item 2 of squares\nsay 3 is in list of 1, 2, 3\nsay \"ell\" is in \"hello\"\nsay 5 is not in squares\nsay (list of 1) is in list of (list of 1), 2", "4\nyes\nyes\nyes\nyes"],
  ["set a to dictionary where \"x\" is list of 1, 2\nset b to dictionary where \"x\" is list of 1, 2\nsay a is b\nset l to item \"x\" of a\nadd 3 to l\nsay a\nsay a is b\nsay empty dictionary\nsay length of empty dictionary", "yes\n(dictionary where \"x\" is [1, 2, 3])\nno\n(empty dictionary)\n0"],
  ["set people to list of (dictionary where \"name\" is \"Sam\"), (dictionary where \"name\" is \"Ana\", \"likes\" is yes)\nfor each p in people\n    say item \"name\" of p\nend\nsay people", "Sam\nAna\n[(dictionary where \"name\" is \"Sam\"), (dictionary where \"name\" is \"Ana\", \"likes\" is yes)]"],
  ["set d to dictionary where \"apple\" is 3\ntry\n    say item \"aple\" of d\nif it fails with why\n    say why\nend", "there is no \"aple\" in this dictionary. Did you mean \"apple\"?"],
  ["to total with prices\n    set sum to 0\n    for each name in prices\n        add item name of prices to sum\n    end\n    return sum\nend\nsay total(dictionary where \"tea\" is 2, \"cake\" is 3.5)", "5.5"],
  ["set d to dictionary where \"a\" is 1, \"b\" is 2, \"a\" is 3\nsay d\nset item \"b\" of d to nothing\nsay d is dictionary where \"a\" is 3, \"b\" is nothing\nsay (dictionary where 1 is 2) is (dictionary where \"1\" is 2)", "(dictionary where \"a\" is 3, \"b\" is 2)\nyes\nno"],
  ["set grid to dictionary where \"row\" is list of 0, 0\nset item 2 of item \"row\" of grid to 5\nset item \"next\" of grid to grid\nsay item 2 of item \"row\" of item \"next\" of grid", "5"],
  // bytes, bits, and numbers in hex and binary
  ["say 0xFF\nsay 0b1010\nsay 0x10 + 1\nsay 255 as hex\nsay 10 as binary\nsay 0 as binary", "255\n10\n17\nff\n1010\n0"],
  ["say 12 bit and 10\nsay 12 bit or 10\nsay 12 bit xor 10\nsay shift 1 left by 10\nsay shift 1024 right by 3\nsay shift 5 right by 1\nsay (0xF0 bit or 0x0F) is 0xFF\nsay 0x1FFFFFFFFFFFFF bit and 0xF0000000F\nsay 0x100000000 bit or 1\nsay shift 0 left by 2000", "8\n14\n6\n1024\n128\n2\nyes\n64424509455\n4294967297\n0"],
  ["set block to 5 bytes\nset byte 1 of block to 72\nset byte 2 of block to 105\nsay block\nsay length of block\nsay byte 2 of block\nset greeting to \"Hi!\" as bytes\nsay greeting\nsay greeting as text\nsay (list of 1, 2, 255) as bytes\nsay 105 is in block\nsay block is (list of 72, 105, 0, 0, 0) as bytes", "(5 bytes: 72, 105, 0, 0, 0)\n5\n105\n(3 bytes: 72, 105, 33)\nHi!\n(3 bytes: 1, 2, 255)\nyes\nyes"],
  ["set total to 0\nfor each b in \"héllo\" as bytes\n    add b to total\nend\nsay total\nsay length of (\"héllo\" as bytes)\nsay (\"héllo\" as bytes) as text\nsay 0 bytes\nsay 1 bytes", "795\n6\nhéllo\n(0 bytes)\n(1 byte: 0)"],
  ["set check to 0\nfor each b in \"abc\" as bytes\n    set check to check bit xor b\nend\nsay check\nsay check as hex\nsay 5 as text + \"!\"\nsay (list of 1, 2) as text", "96\n60\n5!\n[1, 2]"],
  ["set b to 2 bytes\ntry\n    set byte 1 of b to 256\nif it fails with why\n    say why\nend\nsay b\nset c to b as bytes\nset byte 2 of c to 9\nsay b \" \" c", "a byte is a whole number from 0 to 255, not 256\n(2 bytes: 0, 0)\n(2 bytes: 0, 0) (2 bytes: 0, 9)"],
  // files and arguments, where a run has none
  ["say arguments\nsay length of arguments\nset a to arguments\nadd 1 to a\nsay arguments", "[]\n0\n[]"],
  // expect: nothing happens when it is so; otherwise it says what each side was
  ["expect 1 + 1 is 2\nexpect \"a\" is not \"b\"\nexpect 3 is in list of 1, 2, 3\nexpect 2 is at most 2\nexpect yes\nexpect 1\nsay \"ok\"", "ok"],
  ["try\n    expect 1 is 2\nif it fails with why\n    say why\nend\nto check with n\n    expect n is greater than 0\n    return n\nend\nsay check(5)", "expected 1 to be 2\n5"],
];

test("programs print what they should, on all three engines", () => {
  for (const engine of ENGINES) for (const [source, expected] of PROGRAMS) assert.equal(output(source, { engine }), expected, `${engine}: ${source}`);
});

const ERRORS = [
  ["\n\nsay totl", "line 3: 'totl' has no value yet (give it one with 'set totl to ...')"],
  ["to f\n    set secret to 1\nend\nf\nsay secret", "line 5: 'secret' has no value yet (give it one with 'set secret to ...')"],
  ["say x\nset x to 1", "line 1: 'x' has no value yet (give it one with 'set x to ...')"],
  // misspellings get the closest name that exists, including Moth's own words at the start of a line
  ["set total to 1\nsay totl", "line 2: 'totl' has no value yet. Did you mean 'total'?"],
  ["set total to 1\nadd 2 to totla", "line 2: 'totla' has no value yet. Did you mean 'total'?"],
  ["to greet with who\nend\ngreeet 1", "line 3: there is no function called 'greeet'. Did you mean 'greet'?"],
  ['sya "hi"', "line 1: there is no function called 'sya'. Did you mean 'say'?"],
  ["to fib with n\n    if n is less than 2\n        return n\n    end\n    return fib(n - 1) + fbi(n - 2)\nend\nsay fib(3)", "line 5: there is no function called 'fbi'. Did you mean 'fib'?"],
  ["set cat to 1\nsay dog", "line 2: 'dog' has no value yet (give it one with 'set dog to ...')"],
  ["x is 5", "line 1: to give 'x' a value write 'set x to ...'"],
  ["x = 5", "line 1: I don't understand '=' (to store a value write 'set x to 5', to compare write 'x is 5')"],
  ["if x > 5\nend", "line 1: I don't understand '>' (write 'is greater than')"],
  ["say 1 + yes", "line 1: can't use '+' on a number and yes/no"],
  ['say -"a"', "line 1: '-' needs a number, not text"],
  ['say "abc" * 2', "line 1: can't use '*' on text and a number"],
  ["say 1 / 0", "line 1: can't divide by zero"],
  ['say "a" is less than 5', "line 1: can't check if text is less than a number"],
  ['say item 0 of "abc"', "line 1: there is no item 0, items are counted from 1"],
  ['say item 4 of "abc"', "line 1: there is no item 4, the text only has 3 letters"],
  ['set s to "ab"\nset item 1 of s to "x"', "line 2: can only change items of a list, dictionary or bytes, not text"],
  ["set n to 5\nadd list of 1 to n", "line 2: can't add a list to a number"],
  ["to f with a\nend\nf", "line 3: 'f' needs 1 input but got 0"],
  ['greet "x"', "line 1: there is no function called 'greet'"],
  ["constructor 1", "line 1: there is no function called 'constructor'"], // a name JavaScript objects already have
  ["set n to 5\nn", "line 2: 'n' is a number, not a function"],
  ["for each x in 5\nend", "line 1: can only go through a list, text, dictionary or bytes, not a number"],
  ['repeat "a" times\nend', 'line 1: repeat needs a whole number of times, not "a"'],
  ['say "hi', "line 1: this text is missing its closing quote"],
  ['if yes\n    say "hi"', "line 2: 'if' from line 1 is missing its 'end'"],
  ["set list to 5", "line 1: 'list' is a Moth word, so it can't be used as a variable name"],
  ["set x to 5 6", "line 1: expected a new line but found '6'"],
  ['if yes say "hi"\nend', "line 1: expected a new line but found 'say'"],
  ["end", "line 1: a line can't start with 'end'"],
  ["return 1", "line 1: 'return' only works inside a function (one made with 'to')"],
  ["to down with n\n    return down(n + 1)\nend\nsay down(0)", "line 2: too much recursion: a function kept calling itself"],
  ['set s to "ab"\nrepeat while yes\n    add s to s\nend', "line 3: a value got too big to fit in memory"],
  ['move forward "a"', "line 1: 'move forward' needs a number, not text"],
  ["turn left yes", "line 1: 'turn left' needs a number, not yes/no"],
  ["pen color 5", "line 1: 'pen color' needs text like \"red\", not a number"],
  ["pen width 0", "line 1: 'pen width' needs a number above 0, not 0"],
  ["move sideways 5", "line 1: expected 'forward' or 'back' but found 'sideways'"],
  ["set pen to 1", "line 1: 'pen' is a Moth word, so it can't be used as a variable name"],
  ['set p to record with name "Sam"\nsay nmae of p', "line 2: this record has no 'nmae'. Did you mean 'name'?"],
  ["say name of 5", "line 1: can't take 'name' of a number"],
  ['set s to "x"\nset name of s to 1', "line 2: can only change 'name' of a record, not text"],
  ["set x to empty thing", "line 1: expected 'list', 'record' or 'dictionary' but found 'thing'"],
  ["say person.name", "line 1: I don't understand '.' (to get a field write 'name of person')"],
  ['say "before"\nfail with "your own message"', "line 2: your own message"],
  ["set x to 5 007", "line 1: expected a new line but found '007'"], // numbers are shown as written
  // variables that only ever hold numbers keep every mistake
  ['set n to 1\nadd "x" to n', "line 2: can't add text to a number"],
  ["say n + 1\nset n to 5", "line 1: 'n' has no value yet (give it one with 'set n to ...')"],
  ["add 1 to n\nset n to 0", "line 1: 'n' has no value yet (give it one with 'set n to ...')"],
  ["set n to 4\nset m to 0\nsay n / m", "line 3: can't divide by zero"],
  ["set n to 3\nsay n is divisible by 0", "line 2: can't divide by zero"],
  ['say "a\u0001b"', "line 1: this text is missing its closing quote"], // text can't hold control characters but tab
  ["say 1 😀", "line 1: I don't understand '😀'"],
  // stop leaves the loop it's in, and only that one
  ["stop", "line 1: 'stop' only works inside a loop (one made with 'repeat' or 'for each')"],
  ["repeat 2 times\n    to f\n        stop\n    end\nend", "line 3: 'stop' only works inside a loop (one made with 'repeat' or 'for each')"],
  ["set stop to 1", "line 1: 'stop' is a Moth word, so it can't be used as a variable name"],
  // text helpers: upper and lower case, split, join, number, position
  ["say uppercase of 5", "line 1: 'uppercase of' needs text, not a number"],
  ["say split \"a,b\" by 1", "line 1: 'split ... by' needs text, not a number"],
  ["say join \"abc\" with \",\"", "line 1: 'join' needs a list, not text"],
  ["say number of \"12abc\"", "line 1: \"12abc\" isn't a number"],
  ["say position of 1 in \"abc\"", "line 1: 'position of' needs text, not a number"],
  ["set number to 5", "line 1: 'number' is a Moth word, so it can't be used as a variable name"],
  ["say split \"a b\" \" \"", "line 1: expected 'by' but found \" \""],
  // ask needs someone to answer
  ["say ask \"x\"", "line 1: this program asks a question, but nothing can answer it here"],
  ["set ask to 1", "line 1: 'ask' is a Moth word, so it can't be used as a variable name"],
  // try ... if it fails: a mistake, or a fail with, is caught and the program goes on
  ["try\n    say 1\nend", "line 3: expected 'if it fails' but found 'end'"],
  ["try say 1\nif it fails\nend", "line 1: expected a new line but found 'say'"],
  ["set try to 1", "line 1: 'try' is a Moth word, so it can't be used as a variable name"],
  ["try\n    say 1\nif it fails\n    say 2", "line 4: 'try' from line 1 is missing its 'end'"],
  // dictionaries: look things up by key, change them, go through their keys; and `is in`
  ["say item \"Bob\" of (dictionary where \"Bo\" is 1)", "line 1: there is no \"Bob\" in this dictionary. Did you mean \"Bo\"?"],
  ["set d to dictionary where 1 is 2\nsay item 2 of d", "line 2: there is no 2 in this dictionary"],
  ["set d to dictionary where (list of 1) is 2", "line 1: a dictionary's keys are text or numbers, not a list"],
  ["remove \"x\" from list of 1, 2", "line 1: can only remove from a dictionary, not a list"],
  ["remove \"x\" from empty dictionary", "line 1: there is no \"x\" in this dictionary"],
  ["say keys of 5", "line 1: 'keys of' needs a dictionary, not a number"],
  ["say 1 is in 2", "line 1: can't check if a number is in a number"],
  ["say 1 is in \"a1\"", "line 1: can't check if a number is in text"],
  ["set item yes of empty dictionary to 1", "line 1: a dictionary's keys are text or numbers, not yes/no"],
  ["say dictionary \"a\" is 1", "line 1: expected 'where' but found \"a\""],
  ["say dictionary where \"a\" 1", "line 1: expected 'is' but found '1'"],
  ["set keys to 1", "line 1: 'keys' is a Moth word, so it can't be used as a variable name"],
  ["remove \"a\" of d", "line 1: expected 'from' but found 'of'"],
  ["set d to empty dictionary\nadd 1 to d", "line 2: can't add a number to a dictionary"],
  // bytes, bits, and numbers in hex and binary
  ["set b to 3 bytes\nset byte 1 of b to 300", "line 2: a byte is a whole number from 0 to 255, not 300"],
  ["set b to 3 bytes\nset item 1 of b to \"a\"", "line 2: a byte is a whole number from 0 to 255, not \"a\""],
  ["set b to 3 bytes\nsay byte 4 of b", "line 2: there is no item 4, there are only 3 bytes"],
  ["say -1 bytes", "line 1: 'bytes' needs a whole number in front of it, not -1"],
  ["say 1.5 bit and 1", "line 1: 'bit and' needs whole numbers of 0 or more, not 1.5"],
  ["say \"a\" bit or 1", "line 1: 'bit or' needs whole numbers of 0 or more, not text"],
  ["say 10000000000000000 bit xor 1", "line 1: 'bit xor' works on numbers up to 9007199254740991, not 10000000000000000"],
  ["say shift 1 left by 53", "line 1: 1 shifted left by 53 is too big: bits work on numbers up to 9007199254740991"],
  ["say shift 1 right by -1", "line 1: 'shift ... by' needs whole numbers of 0 or more, not -1"],
  ["say shift 1 up by 2", "line 1: expected 'left' or 'right' but found 'up'"],
  ["say 5 as words", "line 1: expected 'bytes' or 'text' or 'hex' or 'binary' but found 'words'"],
  ["say 5 as bytes", "line 1: 'as bytes' needs text, a list or bytes, not a number"],
  ["say (list of 1, 300) as bytes", "line 1: a byte is a whole number from 0 to 255, not 300"],
  ["say -5 as hex", "line 1: 'as hex' needs whole numbers of 0 or more, not -5"],
  ["set as to 1", "line 1: 'as' is a Moth word, so it can't be used as a variable name"],
  ["say (5 bytes) + 1", "line 1: can't use '+' on bytes and a number"],
  ["set b to 2 bytes\nadd 1 to b", "line 2: can't add a number to bytes"],
  // files and arguments, where a run has none
  ["say read \"x.txt\"", "line 1: this program reads a file, but there are no files here"],
  ["write \"a\" to \"x.txt\"", "line 1: this program writes a file, but there are no files here"],
  ["say read 5", "line 1: a file name is text, not a number"],
  ["write \"a\" to 5", "line 1: a file name is text, not a number"],
  ["say read bytes list of 1", "line 1: a file name is text, not a list"],
  ["set arguments to 1", "line 1: 'arguments' is a Moth word, so it can't be used as a variable name"],
  ["write \"a\" \"b\"", "line 1: expected 'to' but found \"b\""],
  // expect: nothing happens when it is so; otherwise it says what each side was
  ["expect 1 + 1 is 3", "line 1: expected 2 to be 3"],
  ["expect \"a\" is not \"a\"", "line 1: expected \"a\" not to be \"a\""],
  ["expect 5 is less than 2", "line 1: expected 5 to be less than 2"],
  ["expect \"x\" is in list of \"a\", \"b\"", "line 1: expected \"x\" to be in [\"a\", \"b\"]"],
  ["expect 7 is divisible by 2", "line 1: expected 7 to be divisible by 2"],
  ["expect 1 is not at least 0", "line 1: expected 1 not to be at least 0"],
  ["expect nothing", "line 1: expected yes, but got nothing"],
  ["expect not yes", "line 1: expected yes, but got no"],
  ["expect 1 is less than \"a\"", "line 1: can't check if a number is less than text"],
  ["set expect to 1", "line 1: 'expect' is a Moth word, so it can't be used as a variable name"],
  ["expect", "line 1: expected a value but found the end of the code"],
  ["to check with n\n    expect n is greater than 0\nend\ncheck(-1)", "line 2: expected -1 to be greater than 0"],
];

test("mistakes give a clear message, on all three engines", () => {
  for (const engine of ENGINES) for (const [source, message] of ERRORS) assert.equal(error(source, { engine }).message, message, `${engine}: ${source}`);
});

test("errors point at the exact spot", () => {
  const source = "if yes\n    say 1 / 0\nend";
  assert.equal(excerpt(source, error(source)), "    say 1 / 0\n          ^");
  const example = examples["Errors"];
  assert.equal(excerpt(example, error(example)), "say item 5 of fruits\n    ^");
});

test("maxSteps stops a loop that never ends", () => {
  assert.equal(error("repeat while yes\nend", { maxSteps: 1000 }).message, "line 1: stopped after 1,000 steps (is there a loop that never ends?)");
});

test("the drawing examples draw", () => {
  for (const [name, count] of [["Spiral", 150], ["Tree", 511]]) {
    let drawn = 0;
    run(examples[name], () => {}, { draw: () => drawn++ });
    assert.equal(drawn, count, name);
  }
});

test("the turtle draws where it moves with its pen down", () => {
  const lines = [];
  run('repeat 4 times\n    move forward 10\n    turn right 90\nend\npen up\nmove back 5\npen down\npen color "red"\npen width 3\nmove forward 1', () => {}, {
    draw: (line) => lines.push(line),
  });
  const blue = { color: "#4f8ff7", width: 2 };
  assert.deepEqual(lines, [
    { x1: 0, y1: 0, x2: 0, y2: 10, ...blue }, // starts in the middle, facing up
    { x1: 0, y1: 10, x2: 10, y2: 10, ...blue },
    { x1: 10, y1: 10, x2: 10, y2: 0, ...blue },
    { x1: 10, y1: 0, x2: 0, y2: 0, ...blue },
    { x1: 0, y1: -5, x2: 0, y2: -4, color: "red", width: 3 }, // pen up moved it without drawing
  ]);
});

test("output said before a mistake is kept", () => {
  const lines = [];
  assert.throws(() => run('say "first"\nsay nope', (line) => lines.push(line)), MothError);
  assert.deepEqual(lines, ["first"]);
});

// The debugger: a debug build pauses before each statement, and on a loop's line before each round.
function pauses(source) {
  const lines = [];
  const machine = debug(source, () => {});
  while (machine.run({ pauseAtLines: true }) === "line") lines.push(machine.line);
  return lines;
}

test("the debugger pauses at each statement and each loop round", () => {
  assert.deepEqual(pauses("set x to 1\nrepeat 2 times\n    add 1 to x\nend\nsay x"), [1, 2, 3, 2, 3, 5]);
  assert.deepEqual(pauses("for each n from 1 to 2\n    say n\nend"), [1, 2, 1, 2]);
  assert.deepEqual(pauses("set n to 0\nrepeat while n is less than 2\n    add 1 to n\nend"), [1, 2, 3, 2, 3, 2]);
  assert.deepEqual(pauses("if no\n    say 1\nelse if yes\n    say 2\nend"), [1, 3, 4]);
});

test("the debugger shows the calls in progress and the variables they can see", () => {
  const machine = debug("set x to 10\nto double with n\n    set y to n * 2\n    return y\nend\nsay double(x)", () => {});
  while (machine.run({ pauseAtLines: true }) === "line" && machine.line !== 4);
  assert.deepEqual(machine.inspect(), {
    line: 4,
    calls: ["main", "double"],
    scopes: [
      { name: "double", vars: [["n", "10"], ["y", "20"]] },
      { name: "main", vars: [["double", "<function double>"], ["x", "10"]] },
    ],
  });
});

test("the debugger shows the variables a closure remembers", () => {
  const machine = debug(examples["Counter"], () => {});
  while (machine.run({ pauseAtLines: true }) === "line" && machine.line !== 6);
  assert.deepEqual(machine.inspect().scopes.map(({ name, vars }) => [name, vars]), [
    ["next", []],
    ["counter", [["next", "<function next>"], ["count", "1"]]],
    ["main", [["counter", "<function counter>"], ["tick", "<function next>"]]],
  ]);
});

test("a debug build prints exactly what a normal run prints", () => {
  for (const [name, source] of Object.entries(examples)) {
    if (name === "Errors") continue;
    const lines = [];
    const answers = ["50", "25", "37"]; // for Guess
    const machine = debug(source, (line) => lines.push(line), undefined, (question) => (lines.push(`${question} ${answers[0]}`), answers.shift()));
    while (machine.run({ pauseAtLines: true }) !== "done");
    assert.equal(lines.join("\n"), EXAMPLES[name], name);
  }
});

// Time travel: timeline() records every step, so a debugger can go backwards as well as forwards.
test("a timeline records each step with the variables, output and drawing so far", () => {
  const { steps, said, drawn, cut } = timeline("set x to 1\nrepeat 2 times\n    add 1 to x\n    say x\n    move forward x\nend");
  const x = (step) => step.scopes.at(-1).vars.find(([name]) => name === "x")?.[1];
  assert.deepEqual(
    steps.map((s) => [s.done ? "done" : s.line, x(s), s.said, s.drawn]),
    [[1, undefined, 0, 0], [2, "1", 0, 0], [3, "1", 0, 0], [4, "2", 0, 0], [5, "2", 1, 0], [2, "2", 1, 1], [3, "2", 1, 1], [4, "3", 1, 1], [5, "3", 2, 1], ["done", "3", 2, 2]],
  );
  assert.deepEqual(said, ["2", "3"]);
  assert.equal(drawn.length, 2);
  assert.equal(cut, false);
});

test("a timeline ends with the mistake, or is cut short if the program never ends", () => {
  const failed = timeline('say "hi"\nsay item 2 of "a"');
  assert.equal(failed.steps.at(-1).error.message, "line 2: there is no item 2, the text only has 1 letter");
  assert.equal(failed.steps.at(-1).said, 1);
  const forever = timeline("repeat while yes\nend", { limit: 50 });
  assert.equal(forever.steps.length, 50);
  assert.equal(forever.cut, true);
});

test("when JavaScript's stack runs out, the JIT hands over to the VM without repeating anything", () => {
  const said = [];
  let drawn = 0;
  const source = 'say "start"\nmove forward 10\nto sum with n\n    if n is 0\n        return 0\n    end\n    return n + sum(n - 1)\nend\nsay sum(20000)';
  run(source, (line) => said.push(line), { draw: () => drawn++ }); // 20,000 calls deep is past JavaScript's stack
  assert.deepEqual(said, ["start", "200010000"]);
  assert.equal(drawn, 1);
});

// The checker: problems found without running.
const problems = (source) => check(source).map(({ line, col, kind, message }) => `${line}:${col} ${kind}: ${message}`);

test("the checker finds mistakes without running the program", () => {
  const source = [
    'set name to "Moth"',
    "say name * 2", // 2
    "to double with n",
    "    return n * 2",
    '    say "never"', // 5
    "end",
    "say double(1, 2)", // 7
    "set spare to 5", // 8
    "say totl", // 9
    "set total to 0",
    "sya total", // 11
    'add "x" to total', // 12
    "set count to 5",
    "count", // 14
    'repeat "x" times', // 15
    "end",
    "say item 0 of list of 1", // 17
    "say length of 5", // 18
    "for each c in 7", // 19
    "end",
    'move forward "far"', // 21
    "say 1 / 0", // 22
    'say no and ("a" * 2)', // the right side of `and` might not run, so nothing is certain there
  ].join("\n");
  assert.deepEqual(problems(source), [
    "2:10 fails: can't use '*' on text and a number",
    "5:5 never runs: this line can never run, because 'return' comes first",
    "7:5 fails: 'double' needs 1 input but got 2",
    "8:1 unused: 'spare' is set but never used",
    "9:5 fails: 'totl' has no value yet. Did you mean 'total'?",
    "11:1 fails: there is no function called 'sya'. Did you mean 'say'?",
    "12:1 fails: can't add text to a number",
    "14:1 fails: 'count' is a number, not a function",
    '15:1 fails: repeat needs a whole number of times, not "x"',
    "17:5 fails: there is no item 0, items are counted from 1",
    "18:5 fails: 'length of' needs a list, text, dictionary or bytes, not a number",
    "19:1 fails: can only go through a list, text, dictionary or bytes, not a number",
    "21:1 fails: 'move forward' needs a number, not text",
    "22:7 fails: can't divide by zero",
  ]);
  assert.deepEqual(problems("say (1"), ["1:7 error: expected ')' but found the end of the code"]);
  assert.deepEqual(problems('set n to 5\nsay name of n\nfail with "stop"\nsay "after"'), [
    "2:5 fails: can't take 'name' of a number",
    "4:1 never runs: this line can never run, because 'fail' comes first",
  ]);
});

test("load() hands JavaScript what a program made, and fail with's value", () => {
  const made = load('to greet with who\n    return "Hello, " + who\nend\nset version to 3\nto check with n\n    fail with record with problem "bad", value n\nend');
  assert.equal(made.greet("JavaScript"), "Hello, JavaScript");
  assert.equal(made.version, 3);
  assert.equal(load("set __proto__ to 5").__proto__, 5);
  // a call that fails deep inside leaves nothing behind: the next call starts from the bottom again
  const { outer } = load("to outer with n\n    return inner(n)\nend\nto inner with n\n    fail with n\nend");
  for (let i = 0; i < 2500; i++) assert.throws(() => outer(i), MothError);
  assert.throws(() => made.check(7), (err) => err instanceof MothError && err.value.problem === "bad" && err.value.value === 7);
});

// A "fails" warning on a line that never runs is still true (like `return 1 / 0` in a function nobody
// calls), so the rule for working programs is: no warned line actually runs. A program with a `try` can
// run a failing line and still finish, so those are left out.
const catches = (source) => /\btry\b/i.test(source);
test("the checker raises no false alarms on working programs", () => {
  for (const source of [...Object.values(examples), ...PROGRAMS.map(([source]) => source)]) {
    if (catches(source)) continue;
    const { lines } = trace(source);
    for (const p of check(source)) if (p.kind !== "unused") assert.ok(!lines.has(p.line), `${p.line}: ${p.message} in:\n${source}`);
  }
});

// The lines a program really runs (its LINE markers), and the mistake it stops at, if any.
function trace(source) {
  const lines = new Set();
  const machine = new Machine(compile(source, { debug: true }), () => {}, { maxSteps: 10_000 });
  try {
    while (machine.run({ pauseAtLines: true }) === "line") lines.add(machine.line);
  } catch (err) {
    if (!(err instanceof MothError)) throw err;
    return { lines, error: err };
  }
  return { lines };
}

// Checking the checker against what really happens, on thousands of randomly broken programs: a line
// it says will fail never runs in a program that finishes; when a program does fail where it said, it
// said the same words; and a line it says never runs, never does. One known gap: the checker doesn't
// follow the order code runs in, so a name used before it's set fails with "no value yet" instead.
test("the checker's claims hold on randomly broken programs", () => {
  let seed = 7;
  const random = (n) => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return Math.floor((seed / 2 ** 31) * n);
  };
  const pick = (list) => list[random(list.length)];
  const sources = [...Object.values(examples), ...PROGRAMS.map(([source]) => source), ...ERRORS.map(([source]) => source)];
  const mutations = [
    (s) => { const i = random(s.length); return s.slice(0, i) + s.slice(i + 1); },
    (s) => { const lines = s.split("\n"); lines.splice(random(lines.length), 0, pick(lines)); return lines.join("\n"); },
    (s) => { const words = s.match(/\w+|\S/g); return s.replace(pick(words), pick(words)); },
  ];
  let predicted = 0;
  for (let i = 0; i < 3000; i++) {
    let source = pick(sources);
    for (let n = random(4); n > 0; n--) source = pick(mutations)(source);
    const found = check(source);
    if (found.some((p) => p.kind === "error")) continue; // doesn't compile, so nothing ran
    const { lines, error } = trace(source);
    for (const p of found) {
      if (p.kind === "never runs") assert.ok(!lines.has(p.line), `line ${p.line} ran:\n${source}`);
      if (p.kind !== "fails") continue;
      if (error && error.line === p.line && error.col === p.col) {
        if (error.reason !== p.message) assert.match(error.reason, /has no value yet|there is no function called/, source);
        predicted++;
      }
      if (!error && !catches(source)) assert.ok(!lines.has(p.line), `said line ${p.line} fails, but it ran fine:\n${source}`);
    }
  }
  assert.ok(predicted > 100, `only ${predicted} runtime errors were predicted`); // the checker isn't silent either
});

// Everything one engine does with a program: what it said and drew, and the mistake it stopped at.
function outcome(source, engine) {
  const said = [];
  const drawn = [];
  try {
    run(source, (line) => said.push(line), { engine, maxSteps: 10_000, draw: (line) => drawn.push(line) });
    return { said, drawn };
  } catch (err) {
    if (!(err instanceof MothError)) assert.fail(`the ${engine} crashed with ${err.stack}\non this program:\n${source}`);
    assert.ok(err.line >= 1 && err.line <= source.split("\n").length && err.col >= 1, `bad position ${err.line}:${err.col} in:\n${source}`);
    return { said, drawn, error: [err.message, err.col, err.trail] };
  }
}

// The examples and the tables above, each broken by up to three random edits. The seed is fixed, so a
// failure always reproduces.
function brokenPrograms(seed, count) {
  const random = (n) => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return Math.floor((seed / 2 ** 31) * n);
  };
  const pick = (list) => list[random(list.length)];
  const sources = [...Object.values(examples), ...PROGRAMS.map(([source]) => source), ...ERRORS.map(([source]) => source)];
  const mutations = [
    (s) => { const i = random(s.length); return s.slice(0, i) + s.slice(i + 1); }, // delete a character
    (s) => { const i = random(s.length); return s.slice(0, i) + s[random(s.length)] + s.slice(i); }, // copy one in
    (s) => { const lines = s.split("\n"); lines.splice(random(lines.length), 0, pick(lines)); return lines.join("\n"); }, // repeat a line
    (s) => { const words = s.match(/\w+|\S/g); return s.replace(pick(words), pick(words)); }, // swap a word for another
  ];
  const programs = [];
  for (let i = 0; i < count; i++) {
    let source = pick(sources);
    for (let n = random(4); n > 0; n--) source = pick(mutations)(source);
    programs.push(source);
  }
  return programs;
}

// Fuzzing: thousands of randomly broken programs must only ever fail with a MothError that points inside
// the code, never with a JavaScript crash, and the JIT and the WebAssembly engine must do exactly what the
// VM does with every one of them: same output, same drawing, same mistake at the same spot.
test("randomly broken programs fail cleanly, and all three engines agree on every one", () => {
  for (const source of brokenPrograms(42, 5000)) {
    const vm = outcome(source, "vm");
    assert.deepEqual(outcome(source, "jit"), vm, source);
    assert.deepEqual(outcome(source, "wasm"), vm, `wasm: ${source}`);
  }
});

// ---------- the compiler written in Moth ----------

const COMPILER = readFileSync(new URL("./compiler.moth", import.meta.url), "utf8");

// What a compiler makes of a program: its JavaScript and the spot each position in it points at, or the
// mistake it stops at.
function compiled(compiler, source) {
  try {
    const { source: js, ats } = compiler(source);
    return { js, ats: ats.map(({ line, col }) => [line, col]) };
  } catch (err) {
    if (!(err instanceof MothError)) throw err;
    return { error: [err.message, err.col, err.incomplete] };
  }
}

test("the compiler written in Moth writes the JIT's JavaScript, byte for byte, and stops at the same mistakes", () => {
  const moth = mothCompiler(COMPILER);
  const deep = `say ${"(".repeat(3000)}1${")".repeat(3000)}`; // too deep for both
  for (const source of [...Object.values(examples), ...PROGRAMS.map(([s]) => s), ...ERRORS.map(([s]) => s), deep, COMPILER])
    assert.deepEqual(compiled(moth, source), compiled(compileToJs, source), source);
});

// The one known difference: Moth sees text as whole characters, so it can't tell half of an emoji (a lone
// UTF-16 surrogate, which no file can hold) from a whole one. The fuzzer cuts emoji in half, so those are left out.
test("the compiler written in Moth matches the JIT on randomly broken programs", () => {
  const moth = mothCompiler(COMPILER);
  for (const source of brokenPrograms(1, 3000)) {
    if (/[\ud800-\udfff]/u.test(source)) continue;
    assert.deepEqual(compiled(moth, source), compiled(compileToJs, source), source);
  }
});

// Bootstrapping: compiler.moth compiled by the JIT compiles itself; the compiler that makes compiles it
// again, and so on. Each one writes exactly the JIT's JavaScript, so the compiler has reached a fixed point.
test("the compiler written in Moth compiles itself, and what it makes does the same", () => {
  const js = compileToJs(COMPILER).source;
  let compiler = compileToJs;
  for (let stage = 1; stage <= 3; stage++) {
    compiler = mothCompiler(COMPILER, compiler);
    assert.equal(compiler(COMPILER).source, js, `stage ${stage}`);
  }
  const said = [];
  compiler(examples.Functions).run((line) => said.push(line), undefined, Infinity); // and what it compiles runs
  assert.deepEqual(said, ["Hello, Sam!", "fib(20) is 6765"]);
});

// ---------- the neural network written in Moth ----------

// It makes its own random numbers, so a run is the same every time: all three engines must say and draw
// exactly the same things, and the network must learn to put every dot on the right side.
test("the neural network written in Moth learns, the same way on all three engines", () => {
  const network = readFileSync(new URL("./neural.moth", import.meta.url), "utf8");
  const files = (name) => readFileSync(new URL(`./${name}`, import.meta.url), "utf8"); // math.moth
  const train = (engine) => {
    const said = [];
    const drawn = [];
    run(network, (line) => said.push(line), { engine, draw: (line) => drawn.push(line), files });
    return { said, drawn };
  };
  const jit = train("jit");
  assert.deepEqual(train("vm"), jit);
  assert.deepEqual(train("wasm"), jit);
  assert.equal(jit.said[1], "step 1: loss 1.173, 50% right");
  assert.equal(jit.said.at(-1), "after 60 steps: 100% of the dots are on the right side");
  assert.deepEqual(check(network, { files }), []);
});

// ---------- the WebAssembly encoder ----------

test("the WebAssembly encoder writes numbers as the spec does, and modules that validate", async () => {
  const { uleb, sleb, Module } = await import("./wasm-binary.js");
  assert.deepEqual(uleb(624485), [0xe5, 0x8e, 0x26]); // the examples from the LEB128 article the spec points to
  assert.deepEqual(sleb(-123456), [0xc0, 0xbb, 0x78]);
  assert.deepEqual([sleb(63), sleb(64), sleb(-64), sleb(-65)], [[0x3f], [0xc0, 0x00], [0x40], [0xbf, 0x7f]]);
  const m = new Module();
  const f = m.func("answer", [], ["i32"]);
  f.code.emit("i32.const", 42);
  m.export("answer", f.index);
  const { instance } = await WebAssembly.instantiate(m.encode());
  assert.equal(instance.exports.answer(), 42);
  assert.throws(() => f.code.emit("local.get", undefined), /needs indices/);
  for (const source of Object.values(examples)) assert.ok(WebAssembly.validate(compileToWasm(source).bytes));
});

// ---------- ask ----------

// A question goes to whoever can answer, as text, and the answer comes back as text. Running the program
// again on the VM (after deep recursion here) must reuse the answers already given, not ask twice.
test("ask gets answers, on all three engines, and a hand-over to the VM doesn't ask again", () => {
  const source = 'set a to ask "first?"\nto down with n\n    if n is 0\n        return 0\n    end\n    return 1 + down(n - 1)\nend\nsay a " " down(5000)\nsay ask "second " + a + "?"';
  for (const engine of ENGINES) {
    const asked = [];
    const replies = ["x", "y"];
    assert.equal(output(source, { engine, ask: (question) => (asked.push(question), replies.shift()) }), "x 5000\ny", engine);
    assert.deepEqual(asked, ["first?", "second x?"], engine);
  }
  const { said } = timeline('say ask "name?"\nsay "bye"', { answers: ["Sam"] });
  assert.deepEqual(said, ["name? Sam", "Sam", "bye"]); // the debugger replays the answers it was given
  assert.equal(error('say ask "x"', { ask: () => null }).message, "line 1: there was no answer to this question: the input ended");
});

// ---------- use ----------

// `use "x.moth"` puts another file's code in the program, once; a mistake in it names that file. The
// compiler written in Moth reads files the same way, and still writes the JIT's JavaScript.
test("use reads other files once, on all three engines, and mistakes in them say which file", () => {
  const files = {
    "shapes.moth": "to square with n\n    return n * n\nend\nset unit to 1",
    "twice.moth": 'use "shapes.moth"\nsay "twice"',
    "bad.moth": "say 1 +",
    "loop.moth": 'use "loop2.moth"',
    "loop2.moth": 'use "loop.moth"',
    "boom.moth": "to boom\n    say 1 / 0\nend",
  };
  const reading = { files: (name) => files[name] };
  const program = 'use "shapes.moth"\nuse "twice.moth"\nsay square(4) + unit';
  const mistakes = [
    ['use "nope.moth"', "line 1: there is no file called 'nope.moth'", undefined],
    ['use "bad.moth"', "bad.moth, line 1: expected a value but found the end of the code", "bad.moth"],
    ['use "loop.moth"', "loop2.moth, line 1: 'loop.moth' is already being read, so it can't be used here: files can't use each other in a circle", "loop2.moth"],
    ['if yes\n    use "shapes.moth"\nend', "line 2: 'use' only works at the top level of a program", undefined],
    ['use "boom.moth"\nboom', "boom.moth, line 2: can't divide by zero", "boom.moth"],
    ["use shapes", 'line 1: expected a file name in quotes, like "shapes.moth" but found \'shapes\'', undefined],
  ];
  for (const engine of ENGINES) {
    assert.equal(output(program, { engine, ...reading }), "twice\n17", engine);
    for (const [source, message, file] of mistakes) {
      const err = error(source, { engine, ...reading });
      assert.equal(err.message, message, `${engine}: ${source}`);
      assert.equal(err.file, file);
    }
  }
  files["warns.moth"] = "say 1 / 0";
  assert.deepEqual(check('use "warns.moth"\nsay "a" * 2', reading).map((p) => [p.file, p.line, p.message]),
    [["warns.moth", 1, "can't divide by zero"], [undefined, 2, "can't use '*' on text and a number"]]);
  const moth = mothCompiler(COMPILER);
  for (const source of [program, ...mistakes.map(([source]) => source)]) {
    assert.deepEqual(compiled((s) => moth(s, files), source), compiled((s) => compileToJs(s, reading), source), source);
  }
});

// ---------- reading handwriting ----------

const here = (name) => readFileSync(new URL(`./${name}`, import.meta.url), "utf8");

// Digits drawn differently from the shapes it learned from (other proportions, another start, a sloppy 8),
// and smaller, off to one side, as the drawing pad would send them.
const DRAWN = {
  0: ["70,52 66,25 45,14 24,25 20,52 26,80 45,90 64,80 70,52 68,40"],
  1: ["40,22 50,10 48,90"],
  2: ["25,30 35,15 55,12 70,22 68,40 30,85 75,85"],
  3: ["25,15 55,10 68,25 50,45 70,60 65,85 35,90 22,80"],
  4: ["55,10 20,60 80,60", "60,35 58,95"],
  5: ["70,12 35,12 32,45 55,42 70,58 62,85 30,85"],
  6: ["65,12 35,40 30,75 45,90 65,80 62,60 40,58 32,70"],
  7: ["20,15 80,15 45,90"],
  8: ["55,15 35,20 38,40 60,55 65,75 50,90 30,80 35,60 60,42 62,25 55,15"],
  9: ["65,35 50,15 30,25 35,45 60,42 65,30 62,90"],
};
const small = (stroke) => stroke.split(" ").map((p) => p.split(",").map(Number)).map(([x, y]) => `${Math.round(x * 0.6 + 25)},${Math.round(y * 0.6 + 15)}`).join(" ");

test("the network written in Moth reads digits drawn on the pad, on all three engines", () => {
  for (const engine of ENGINES) {
    const answers = Object.values(DRAWN).map((strokes) => strokes.map(small).join(";"));
    const said = [];
    try {
      run(here("handwriting.moth"), (line) => said.push(line), { engine, files: here, ask: () => answers.shift() ?? null });
    } catch (err) {
      assert.match(err.message, /the input ended/); // it asks for another until the answers run out
    }
    assert.deepEqual(said.map((line) => line.match(/it's an? (\d)/)?.[1]), Object.keys(DRAWN), engine);
  }
  for (const name of ["handwriting.moth", "digits-train.moth", "neural.moth"]) assert.deepEqual(check(here(name), { files: here }), [], name);
});

// The real training takes seconds; a tiny one checks that it learns something and writes a model Moth can read.
test("digits-train.moth writes the model as Moth", () => {
  const source = here("digits-train.moth").replace(/set per_digit to \d+/, "set per_digit to 5").replace(/set rounds to \d+/, "set rounds to 1");
  const said = [];
  run(source, (line) => said.push(line), { engine: "wasm", files: here });
  assert.match(said[1], /^# round 1: \d+% right while learning$/);
  const model = said.join("\n");
  assert.ok(compileToJs(`${model}\nsay length of hidden_weights of model " " length of output_bias of model`));
  const out = [];
  run(`${model}\nsay length of hidden_weights of model " " length of output_bias of model`, (line) => out.push(line));
  assert.deepEqual(out, ["8192 10"]);
});

// ---------- try ----------

// A loop that never ends must still stop: running past maxSteps isn't a mistake a `try` catches. And the
// checker doesn't warn about a mistake inside a `try`, which is there to catch it.
test("try can't catch running out of steps, and the checker trusts it", () => {
  const forever = 'repeat while yes\n    try\n        set x to 1\n    if it fails\n        say "caught"\n    end\nend';
  for (const engine of ENGINES) assert.equal(error(forever, { engine, maxSteps: 100 }).message, "line 1: stopped after 100 steps (is there a loop that never ends?)", engine);
  assert.deepEqual(problems('try\n    say 1 / 0\nif it fails\n    say "zero"\nend'), []);
  assert.deepEqual(problems('try\n    say 1\nif it fails with e\n    say 1 / 0\nend'), ["4:11 fails: can't divide by zero"]);
});

// ---------- files and arguments ----------

// Files in memory that keep a log of what was done to them.
function loggedDisk(start) {
  const disk = memoryDisk(start);
  const { read, write } = disk;
  disk.log = [];
  disk.read = (name, asBytes) => (disk.log.push(`read ${name}`), read(name, asBytes));
  disk.write = (name, data) => (disk.log.push(`write ${name}`), write(name, data));
  return disk;
}

test("programs read and write files, and get their arguments, on all three engines", () => {
  const source = [
    'write "one\\ntwo" to "notes.txt"',
    'set lines to split read "notes.txt" by "\\n"',
    'say length of lines " lines, the last is " item 2 of lines',
    'set data to read bytes "photo.bin"',
    "set byte 1 of data to 255",
    'write data to "copy.bin"',
    'say read bytes "copy.bin"',
    'say read bytes "photo.bin"',
    "try",
    '    say read "missing.txt"',
    "if it fails with why",
    "    say why",
    "end",
    "for each a in arguments",
    '    say "argument: " a',
    "end",
  ].join("\n");
  for (const engine of ENGINES) {
    const disk = loggedDisk({ "photo.bin": new Uint8Array([1, 2, 3]) });
    const said = output(source, { engine, disk, args: ["-v", "x.txt"] });
    assert.equal(said, "2 lines, the last is two\n(3 bytes: 255, 2, 3)\n(3 bytes: 1, 2, 3)\nthere is no file called 'missing.txt'\nargument: -v\nargument: x.txt", engine);
    assert.equal(disk.files.get("notes.txt"), "one\ntwo", engine);
  }
});

// The JIT and the WebAssembly engine hand a program that goes too deep to the VM, which runs it again from
// the start: it must read what the first run read, and not write again what the first run wrote.
test("a hand-over to the VM reads the same files and writes nothing twice", () => {
  const source = [
    'set n to number of read "count.txt"',
    'write n + 1 to "count.txt"',
    'say "count was " n',
    "to deep with k",
    "    if k is 0",
    "        return 0",
    "    end",
    "    return deep(k - 1)",
    "end",
    "say deep(3000)",
    'say read "count.txt"',
  ].join("\n");
  for (const engine of ENGINES) {
    const disk = loggedDisk({ "count.txt": "41" });
    assert.equal(output(source, { engine, disk }), "count was 41\n0\n42", engine);
    assert.deepEqual(disk.log, ["read count.txt", "write count.txt", "read count.txt"], engine);
  }
});

// ---------- modules ----------

// The file's names become shapes's sides and so on, so they can't clash with the program's; a file used as
// two names is two separate copies; and inside the file, a function's inputs and its own functions still
// hide the file's names, as they would anywhere.
test("use ... as keeps a file's names apart, on all three engines and in the compiler written in Moth", () => {
  const files = {
    "shapes.moth": 'set sides to 4\nto area with w, h\n    return w * h\nend\nto describe\n    return "a shape with " + sides + " sides"\nend',
    "counter.moth": "set count to 0\nto bump\n    add 1 to count\n    return count\nend",
    "hide.moth": 'set n to 10\nset helper to 1\nto plus_one with n\n    return n + 1\nend\nto grow\n    set n to n + 5\n    return n\nend\nto own_helper\n    to helper\n        return "inner"\n    end\n    return helper()\nend',
  };
  const reading = { files: (name) => files[name] };
  const program = [
    'use "shapes.moth" as shapes',
    'use "counter.moth" as a',
    'use "counter.moth" as b',
    'use "hide.moth" as h',
    "set sides to 3",
    'say shapes\'s sides " " sides',
    "say shapes's area(2, 3)",
    "say shapes's describe()",
    'say a\'s bump() " " a\'s bump() " " b\'s bump()',
    "a's bump",
    "say a's count",
    'say h\'s plus_one(1) " " h\'s grow() " " h\'s n',
    'say h\'s own_helper() " " h\'s helper',
  ].join("\n");
  const mistakes = [
    ['use "shapes.moth" as shapes\nsay shapes\'s sids', "line 2: 'shapes' has nothing called 'sids'. Did you mean 'shapes's sides'?"],
    ['use "shapes.moth" as shapes\nshapes\'s nope(1)', "line 2: 'shapes' has nothing called 'nope'"],
    ["say x's y", "line 1: 'x' has nothing called 'y'"],
    ['use "shapes.moth" as list', "line 1: 'list' is a Moth word, so it can't be used as a name for the file"],
    ['use "shapes.moth" as shapes\nsay shapes\'s 5', "line 2: expected a name but found '5'"],
  ];
  for (const engine of ENGINES) {
    assert.equal(output(program, { engine, ...reading }), "4 3\n6\na shape with 4 sides\n1 2 1\n3\n2 15 15\ninner 1", engine);
    for (const [source, message] of mistakes) assert.equal(error(source, { engine, ...reading }).message, message, `${engine}: ${source}`);
  }
  assert.deepEqual(check(program, reading), []);
  const moth = mothCompiler(COMPILER);
  for (const source of [program, ...mistakes.map(([source]) => source)]) {
    assert.deepEqual(compiled((s) => moth(s, files), source), compiled((s) => compileToJs(s, reading), source), source);
  }
});

// ---------- error trails ----------

// Each engine keeps track of the calls in progress its own way (the VM's frames, the JIT's arrays, an array
// inside the WebAssembly module), and all three must give the same trail. The fuzzer compares them too.
test("a mistake inside functions shows the calls that led to it, the same on all three engines", () => {
  const files = { "lib.moth": "to boom\n    say 1 / 0\nend\nto go\n    boom()\nend" };
  const cases = [
    [[
      "to average with numbers",
      "    set total to 0",
      "    for each n in numbers",
      "        add n to total",
      "    end",
      "    return total / length of numbers",
      "end",
      "to report with groups",
      "    for each g in groups",
      '        say "average: " average(g)',
      "    end",
      "end",
      "report(list of (list of 1, 2), empty list)",
    ], [["average", 10, 1], ["report", 13, 1]], "  in 'average', called from line 10\n  in 'report', called from line 13"],
    [["to countdown with n", "    if n is 0", "        say 1 / 0", "    end", "    countdown(n - 1)", "end", "countdown(3)"],
      [["countdown", 5, 3], ["countdown", 7, 1]], "  in 'countdown', called from line 5 (3 times)\n  in 'countdown', called from line 7"],
    [["to countdown with n", "    if n is 0", "        say 1 / 0", "    end", "    countdown(n - 1)", "end", "countdown(5000)"], // handed to the VM
      [["countdown", 5, 5000], ["countdown", 7, 1]], "  in 'countdown', called from line 5 (5,000 times)\n  in 'countdown', called from line 7"],
    [['use "lib.moth" as lib', "lib's go()"],
      [["lib's boom", 5, 1], ["lib's go", 2, 1]], "  in 'lib's boom', called from lib.moth, line 5\n  in 'lib's go', called from line 2"],
    [["to safe", "    try", "        say 1 / 0", "    if it fails", "        say 2", "    end", "end", "safe()", "say 1 / 0"], [], ""],
    [["to spin", "    repeat while yes", "    end", "end", "spin()"], [["spin", 5, 1]], "  in 'spin', called from line 5"],
  ];
  for (const [lines, expected, shown] of cases) {
    const source = lines.join("\n");
    const vm = error(source, { engine: "vm", files: (name) => files[name], maxSteps: 100_000 });
    assert.deepEqual(vm.trail.map(({ name, line, times }) => [name, line, times]), expected, source);
    assert.equal(describeTrail(vm.trail), shown, source);
    for (const engine of ["jit", "wasm"]) assert.deepEqual(error(source, { engine, files: (name) => files[name], maxSteps: 100_000 }).trail, vm.trail, `${engine}: ${source}`);
  }
  const deep = error("to dive with n\n    dive(n + 1)\nend\ndive(1)", { engine: "vm" }); // the VM's own limit
  assert.equal(deep.reason, "too much recursion: a function kept calling itself");
  assert.equal(describeTrail(deep.trail), "  in 'dive', called from line 2 (99,999 times)\n  in 'dive', called from line 4");
});

// ---------- fast paths ----------

// WebAssembly does bytes, bits and dictionary lookups itself where it can, and hands everything else to the
// shared code. Right at the edges of what it does itself, all three engines must still agree.
test("WebAssembly's fast paths for bytes, bits and dictionaries agree with the other engines at their edges", () => {
  const programs = [];
  const pairs = [[0, 0], [5, 3], [2147483647, 1], [2147483648, 1], [2147483647, 2147483647], [4294967295, 65535],
    [9007199254740991, 255], [9007199254740992, 1], [1.5, 1], [-1, 1], ['"a"', 1], ["yes", 1]];
  for (const [a, b] of pairs) for (const op of ["bit and", "bit or", "bit xor"]) programs.push(`say ${a} ${op} ${b}\nsay ${b} ${op} ${a}`);
  const shifts = [[1, 0], [1, 21], [1, 22], [3, 21], [2147483647, 21], [2147483647, 22], [1, 52], [1, 53], [0, 5000],
    [5, 31], [5, 32], [2147483647, 31], [4294967296, 1], [1, -1], [1, 0.5], ['"a"', 1]];
  for (const [x, n] of shifts) for (const way of ["left", "right"]) programs.push(`say shift ${x} ${way} by ${n}`);
  for (const v of ["0", "255", "256", "-1", "0.5", "-0", "yes", '"a"', "nothing", "list of 1"]) programs.push(`set b to 3 bytes\nset byte 2 of b to ${v}\nsay b`);
  for (const i of ["0", "1", "3", "4", "1.5", '"a"', "-0"]) {
    programs.push(`set b to (list of 7, 8, 9) as bytes\nsay byte ${i} of b`);
    programs.push(`set b to (list of 7, 8, 9) as bytes\nset byte ${i} of b to 1\nsay b`);
  }
  for (const n of ["0", "5", "-1", "1.5", '"a"']) programs.push(`set b to ${n} bytes\nsay length of b`);
  programs.push("set b to 3 bytes\nsay length of b\nfor each x in b\n    say x\nend\nsay b is 3 bytes\nsay 0 is in b\nsay 1 is in b\nsay b is (list of 0, 0, 0) as bytes\nsay b is list of 0, 0, 0");
  for (const key of ["1", "-0", "0", "1.5", '"1"', '""', "yes", "list of 1", "nothing", "3 bytes"]) {
    programs.push(`set d to empty dictionary\nset item ${key} of d to "v"\nsay d\nsay item ${key} of d\nsay ${key} is in d`);
    programs.push(`set d to dictionary where 1 is "one", "1" is "text one"\nsay ${key} is in d\nsay item ${key} of d`);
  }
  programs.push('set d to dictionary where 0 is "zero"\nsay item -0 of d\nsay -0 is in d\nsay "0" is in d');
  programs.push('set d to dictionary where "a" is yes, "b" is nothing, "c" is list of 1\nsay item "a" of d " " item "b" of d " " item "c" of d\nset l to item "c" of d\nadd 2 to l\nsay d\nsay item "a" of d is yes');
  programs.push('set d to dictionary where "a" is 1\nset item "a" of d to item "a" of d + 1\nsay d\nsay item "b" of d');
  for (const source of programs) {
    const vm = outcome(source, "vm");
    assert.deepEqual(outcome(source, "jit"), vm, `jit: ${source}`);
    assert.deepEqual(outcome(source, "wasm"), vm, `wasm: ${source}`);
  }
});

// ---------- moth test ----------

// Each test_ function runs on its own, in a fresh run of the file: test_two doesn't see what test_one did.
test("test() runs each test_ function on its own, and says why one failed, on all three engines", () => {
  const source = [
    "set count to 0",
    "to average with numbers",
    "    return 10 / length of numbers",
    "end",
    "to test_one",
    "    add 1 to count",
    "    expect count is 1",
    "end",
    "to test_two",
    "    add 1 to count",
    '    say "count is " count',
    "    expect count is 2",
    "end",
    "to test_three",
    "    expect average(empty list) is 1",
    "end",
    "to helper",
    "    expect 1 is 2",
    "end",
  ].join("\n");
  for (const engine of ENGINES) {
    const results = testMoth(source, { engine });
    assert.deepEqual(results.map((r) => [r.name, r.said, r.error?.message]), [
      ["test_one", [], undefined],
      ["test_two", ["count is 1"], "line 12: expected 1 to be 2"],
      ["test_three", [], "line 3: can't divide by zero"],
    ], engine);
    assert.deepEqual(results[2].error.trail.map((t) => [t.name, t.line]), [["average", 15]], engine); // not the call that started it
    assert.deepEqual(results[1].error.trail, [], engine);
  }
  const [whole] = testMoth("say 1\nexpect 1 is 2"); // no tests: the file is one
  assert.deepEqual([whole.name, whole.said, whole.error.message], [null, ["1"], "line 2: expected 1 to be 2"]);
  assert.throws(() => testMoth("to test_a\n    say 1"), /'to' from line 1 is missing its 'end'/);
});

// ---------- tidying ----------

test("format() tidies code the one way, without changing a piece of it, and tidy code stays as it is", () => {
  const messy = [
    "to   area with w,h", "return w*h", "  end", "", "", "", "if area( 2,3 ) is 6   # check", '        say "six"',
    "# a note before else", "else", 'say  "no"', "end", "set l to list of 1 ,2,", " 3", "say - 5", "try", "say 1/0",
    "if it fails with why", " say why", "end", "set r to record with label -1, x (2 + 3)", "move forward (1 + 2)", "", "",
  ].join("\n");
  const tidy = [
    "to area with w, h", "    return w * h", "end", "", "if area(2, 3) is 6   # check", '    say "six"',
    "    # a note before else", "else", '    say "no"', "end", "set l to list of 1, 2,", "    3", "say -5", "try",
    "    say 1 / 0", "if it fails with why", "    say why", "end", "set r to record with label -1, x (2 + 3)",
    "move forward (1 + 2)", "",
  ].join("\n");
  assert.equal(format(messy), tidy);
  assert.equal(format(tidy), tidy);
  for (const source of Object.values(examples)) assert.equal(format(source), `${source}\n`); // they only lack the last new line
  for (const file of readdirSync(new URL(".", import.meta.url)).filter((f) => f.endsWith(".moth"))) {
    const text = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
    assert.equal(format(text), text, file);
  }
  assert.throws(() => format("if yes\n    say 1"), MothError);
  let tidied = 0;
  for (const source of brokenPrograms(7, 2000)) {
    let once;
    try {
      once = format(source); // which itself checks that every piece is the same
    } catch (err) {
      if (err instanceof MothError) continue;
      throw err;
    }
    assert.equal(format(once), once, source);
    tidied++;
  }
  assert.ok(tidied > 500, `only ${tidied} could be tidied`);
});
