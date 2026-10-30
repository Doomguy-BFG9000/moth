// The programs the tests run: each with what it should say, or the mistake it should stop at, and a fuzzer that
// breaks them. moth.test.js runs them on the three JavaScript engines; machine.test.js holds the machine code
// machine.moth makes up against the JavaScript VM on every one it takes.
import examples from "./examples.js";

export const PROGRAMS = [
  // inputs that say what they are: each call checks them
  ["to area with width as a number, height as a number\n    return width * height\nend\nsay area(3, 4)", "12"],
  ["to describe with name as text, age as a number and kind\n    say name \" is \" age \" (\" kind \")\"\nend\ndescribe(\"Rex\", 3, nothing)\ndescribe(\"Tom\", 9, 1)", "Rex is 3 (nothing)\nTom is 9 (1)"],
  ["to f with l as a list, d as a dictionary, b as bytes, ok as yes or no, g as a function, r as a record\n    say length of l \" \" length of d \" \" length of b \" \" ok \" \" g() \" \" x of r\nend\nto two\n    return 2\nend\nf((list of 1), (dictionary where 1 is 2), 3 bytes, no, two, record with x 4)", "1 1 3 no 2 4"],
  // numbers as a spreadsheet has them: shown, compared and used as whole numbers to 15 digits
  ["say 0.1 + 0.2\nsay 0.1 + 0.2 is 0.3\nsay 1 / 3\nsay 2 / 3\nsay 0.1 * 3", "0.3\nyes\n0.333333333333333\n0.666666666666667\n0.3"],
  ["say 0.1 + 0.2 is less than 0.3\nsay 0.1 + 0.2 is at most 0.3\nsay 0.3 is at least 0.1 + 0.2\nsay 0.3 is greater than 0.1 + 0.2\nsay 0.3 is divisible by 0.1\nsay 0.35 is divisible by 0.1", "no\nyes\nyes\nno\nyes\nno"],
  ["set things to list of \"a\", \"b\", \"c\"\nsay item (0.1 * 30) of things\nset n to 0\nrepeat 0.1 * 30 times\n    add 1 to n\nend\nsay n", "c\n3"],
  ["set d to dictionary where 0.3 is \"found\"\nsay item (0.1 + 0.2) of d\nsay (0.1 + 0.2) is in d\nset item (0.1 + 0.2) of d to \"again\"\nsay length of d \" \" item 0.3 of d", "found\nyes\n1 again"],
  ["for each i from 0.1 * 10 to 0.1 * 30\n    say i\nend\nsay 123456789012344.5 \" \" 0 - 123456789012344.5 \" \" 3.141592653589793", "1\n2\n3\n123456789012345 -123456789012345 3.14159265358979"],
  ["say (0.1 * 30) as hex\nsay (0.1 * 30) bytes\nsay (list of 1, 2, 3) is (list of 0.1 * 10, 0.2 * 10, 0.1 * 30)\nsay 9007199254740993 is 9007199254740992", "3\n(3 bytes: 0, 0, 0)\nyes\nyes"],
  // amounts with units: added, converted, compared, scaled
  ["set trip to 5 km + 300 m\nsay trip\nsay trip in m\nsay 1 mile in km\nsay number of (trip in m)", "5.3 km\n5300 m\n1.609344 km\n5300"],
  ["say 2 hours + 30 minutes\nsay (2 hours + 30 minutes) in minutes\nsay 3 * 2 hours\nsay 10 km / 4\nsay 10 km / 2 km\nsay -5 km", "2.5 hours\n150 minutes\n6 hours\n2.5 km\n5\n-5 km"],
  ["say 1 km is 1000 m\nsay 1 km is 1000\nsay 1 km is greater than 999 m\nsay 1 foot \" \" 2 feet \" \" 1 kg \" \" 500 ml in litres", "yes\nno\nyes\n1 foot 2 feet 1 kg 0.5 litres"],
  ["set trip to 5 km\nadd 700 m to trip\nsay \"Trip: \" trip\nsay list of 1 km, 2 kg, 3 litres\nsay (1 km) is in (list of 1000 m)\nsay 2 km as text", "Trip: 5.7 km\n[1 km, 2 kg, 3 litres]\nyes\n2 km"],
  ["set n to 2\nevery n minutes\n    say \"tick\"\nend\nevery 1 hour\n    say \"tock\"\nend\nsay \"ready\"", "ready"],
  // a unit's word is only a unit after a number, so it can still be a name
  ["set m to \"am\"\nsay position of \"m\" in m\nset day to 3\nsay \"Day \" day\nsay 2 * day", "2\nDay 3\n6"],
  // a `set` inside a function changes a variable the top level made above it
  ["set total to 0\nto bump\n    add 5 to total\nend\nbump\nbump\nsay total", "10"],
  // ...but one the top level only makes below the function is a different variable: the function's own
  ["to f\n    set x to 1\n    return x\nend\nset x to 5\nsay f() \" \" x", "1 5"],
  ["to f\n    for each k from 1 to 3\n    end\n    return k\nend\nfor each k from 10 to 11\n    say f() \" \" k\nend", "3 10\n3 11"],
  ["to f\n    try\n        say 1 / 0\n    if it fails with why\n        return why\n    end\nend\nset why to 3\nsay f() \" \" why", "can't divide by zero 3"],
  // a name a function only reads is the top level's wherever the top level sets it
  ["to show\n    say setting\nend\nset setting to 5\nshow", "5"],
  // ...and a variable only the function sets stays inside it, so every call starts fresh
  ["to f\n    set count to 0\n    add 1 to count\n    return count\nend\nsay f() f()", "11"],
  // a function made inside another changes that one's variable if it's made above it, so closures work
  ["to make_counter\n    set count to 0\n    to step\n        add 1 to count\n        return count\n    end\n    return step\nend\nset a to make_counter()\nset b to make_counter()\na()\nsay a() \" \" b()", "2 1"],
  ["to outer\n    set n to 1\n    to inner\n        set n to 5\n    end\n    inner()\n    return n\nend\nsay outer()", "5"],
  ["to outer\n    to inner\n        set n to 5\n    end\n    inner()\n    set n to 1\n    inner()\n    return n\nend\nsay outer()", "1"],
  ["to outer with n\n    to inner\n        set n to n + 5\n    end\n    inner()\n    return n\nend\nsay outer(1)", "6"],
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
  // an if on the line after an else is a new if inside the else, not an else if
  ["if no\n    say 1\nelse\n    if yes\n        say 2\n    end\nend\nsay 3", "2\n3"],
  ["if no\n    say 1\nelse if yes\n    say 2\nelse\n    if no\n        say 3\n    else\n        say 4\n    end\nend", "2"],
  ["set x to 5\nif x is 1\n    say \"one\"\nelse\n    if x is 5\n        say \"five\"\n    else if x is 6\n        say \"six\"\n    end\n    say \"done\"\nend", "five\ndone"],
  // a list, record or dictionary that holds itself shows [...] or (...) where it comes round again
  ["set l to list of 1\nadd l to l\nsay length of l\nsay l\nsay l as text", "2\n[1, [...]]\n[1, [...]]"],
  ["set r to record with name 1\nset me of r to r\nsay r", "(record with name 1, me (...))"],
  ["set d to dictionary where \"a\" is 1\nset item \"me\" of d to d\nsay d", "(dictionary where \"a\" is 1, \"me\" is (...))"],
  ["set a to list of 1\nadd a to a\nset b to list of 1\nadd b to b\nsay a is b\nadd 2 to b\nsay a is b", "yes\nno"],
  ["set shared to list of 1\nsay list of shared, shared", "[[1], [1]]"],
  // random number from: the same numbers every run unless real ones are given
  ["set rolls to empty list\nrepeat 10 times\n    add random number from 1 to 6 to rolls\nend\nsay rolls\nsay random number from 5 to 5\nsay random number from -2 to 2 is in list of -2, -1, 0, 1, 2", "[4, 1, 4, 6, 6, 2, 4, 5, 3, 6]\n5\nyes"],
  ["to random\n    return 4\nend\nsay random() \" \" random number from 1 to 1", "4 1"],
  // when and every: the program sets them up, and run() returns an app that waits for them
  ["say \"set up\"\nwhen a key is pressed\n    say \"never, until a key comes\"\nend\nevery 1 second\n    say \"nor this\"\nend\nsay \"done\"", "set up\ndone"],
];

export const ERRORS = [
  ["to area with width as a number, height as a number\n    return width * height\nend\nsay area(3, \"4\")", "line 4: 'area' needs height to be a number, not text"],
  ["to shout with words as text\n    say uppercase of words\nend\nshout(nothing)", "line 4: 'shout' needs words to be text, not nothing"],
  ["to f with ok as yes or no\n    say ok\nend\nf(1)", "line 4: 'f' needs ok to be yes or no, not a number"],
  ["to f with l as a list\n    say l\nend\nto g\n    f(\"a\")\nend\ng()", "line 5: 'f' needs l to be a list, not text"],
  ["to f with x as a thing\n    say x\nend", "line 1: expected what kind of value it is ('a number', 'text', 'yes or no', 'a list', 'a record', 'a dictionary', 'bytes' or 'a function') but found 'a'"],
  ["to f with x as\n    say x\nend", "line 2: expected what kind of value it is ('a number', 'text', 'yes or no', 'a list', 'a record', 'a dictionary', 'bytes' or 'a function') but found 'say'"],
  // `use` only reads files in the program's folder, or folders inside it
  ['use "../secret.moth"', "line 1: '../secret.moth' isn't in the program's folder: 'use' only reads files there, or in folders inside it"],
  ['say 1\nuse "lib/../../x.moth" as x', "line 2: 'lib/../../x.moth' isn't in the program's folder: 'use' only reads files there, or in folders inside it"],
  ['use "/etc/passwd"', "line 1: '/etc/passwd' isn't in the program's folder: 'use' only reads files there, or in folders inside it"],
  ['use "C:/secret.moth"', "line 1: 'C:/secret.moth' isn't in the program's folder: 'use' only reads files there, or in folders inside it"],
  ['use "lib\\\\..\\\\x.moth"', "line 1: 'lib\\..\\x.moth' isn't in the program's folder: 'use' only reads files there, or in folders inside it"],
  ["say 5 km + 2 hours", "line 1: can't use '+' on a distance and a time"],
  ["say 5 km + 3", "line 1: can't use '+' on a distance and a number"],
  ["say 5 km * 2 km", "line 1: can't use '*' on a distance and a distance"],
  ["say 3 hours in km", "line 1: 'in km' needs a distance, not a time"],
  ["set x to 3\nsay x in km", "line 2: 'in km' needs a distance, not a number"],
  ["say 5 km is less than 2 hours", "line 1: can't check if a distance is less than a time"],
  ["set trip to 5 km\nadd 1 hour to trip", "line 2: can't add a time to a distance"],
  ["say 5 km / 0", "line 1: can't divide by zero"],
  ["say 5 km / 0 m", "line 1: can't divide by zero"],
  ["every 2 km\n    say 1\nend", "line 2: expected 'milliseconds' or 'seconds' but found 'say'"],
  ["say item 1 km of (list of 1)", "line 1: item numbers must be whole numbers, not 1 km"],
  ["\n\nsay totl", "line 3: 'totl' has no value yet (give it one with 'set totl to ...')"],
  ["to f\n    set secret to 1\nend\nf\nsay secret", "line 5: 'secret' has no value yet (give it one with 'set secret to ...')"],
  // a function's `set`, or `add`, of a name the top level makes below it is the function's own
  ["to f\n    set x to 1\nend\nf\nsay x\nset x to 2", "line 5: 'x' has no value yet (give it one with 'set x to ...')"],
  ["to bump\n    add 5 to total\nend\nset total to 0\nbump", "line 2: 'total' has no value yet (give it one with 'set total to ...')"],
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
  ["move sideways 5", "line 1: expected 'forward' or 'back' or 'to' but found 'sideways'"],
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
  // drawing for apps: move to, clear, and boxes, circles and text
  ["move to 1", "line 1: expected ',' but found the end of the code"],
  ["move to \"a\", 2", "line 1: 'move to' needs numbers, not text"],
  ["draw box at 1, 2 size 3", "line 1: expected 'by' but found the end of the code"],
  ["draw box at \"a\", 1 size 2 by 2", "line 1: 'draw box' needs numbers, not text"],
  ["draw circle at 0, 0 size -1", "line 1: a circle's size is 0 or more, not -1"],
  ["draw \"hi\" at 0, 0 size 0", "line 1: text's size is a number above 0, not 0"],
  ["draw \"hi\"", "line 1: expected 'at' but found the end of the code"],
  ["set clear to 1", "line 1: 'clear' is a Moth word, so it can't be used as a variable name"],
  // pictures from files: what it's given is checked first, then the file, which these programs can't read
  ["draw picture 5 at 0, 0", "line 1: 'draw picture' needs a file's name or its bytes, not a number"],
  ["draw picture \"cat.png\" at \"a\", 0", "line 1: 'draw picture' needs numbers, not text"],
  ["draw picture \"cat.png\" at 0, 0 size 4 by nothing", "line 1: 'draw picture' needs numbers, not nothing"],
  ["draw picture \"cat.png\" at 0, 0 size 10 by 0", "line 1: a picture's size is a number above 0, not 0"],
  ["draw picture \"cat.png\" at 0, 0", "line 1: this program reads a file, but there are no files here"],
  ["draw picture \"hello\" as bytes at 0, 0", "line 1: these bytes aren't a PNG or BMP picture"],
  ["draw picture \"BM\" as bytes at 0, 0", "line 1: these bytes are a broken BMP: it ends too soon"],
  ["draw picture \"cat.png\" at 0, 0 size 4", "line 1: expected 'by' but found the end of the code"],
  ["draw picture \"cat.png\"", "line 1: expected 'at' but found the end of the code"],
  ["set picture to 7\ndraw picture at 0, 0 size 0", "line 2: text's size is a number above 0, not 0"], // still a name
  // random number from: the same numbers every run unless real ones are given
  ["say random number from 1 to 2.5", "line 1: 'random number from' needs whole numbers, not 2.5"],
  ["say random number from \"a\" to 2", "line 1: 'random number from' needs whole numbers, not text"],
  ["say random number from 6 to 1", "line 1: there is no number from 6 to 1"],
  ["say random number 1 to 6", "line 1: expected 'of' but found '1'"],
  // when and every: the program sets them up, and run() returns an app that waits for them
  ["when the dog barks\n    say 1\nend", "line 1: expected 'a key is pressed', 'the mouse is clicked' or 'the mouse is dragged' but found 'the'"],
  ["when a key is pressed with a and b\n    say 1\nend", "line 1: 'when a key is pressed' gives 1 value, so name one input or none, not 2"],
  ["when the mouse is clicked with x\n    say 1\nend", "line 1: 'when the mouse is clicked' gives 2 values, so name 2 inputs or none, not 1"],
  ["if yes\n    when a key is pressed\n        say 1\n    end\nend", "line 2: 'when' only works at the top level of a program"],
  ["to f\n    every 1 second\n        say 1\n    end\nend", "line 2: 'every' only works at the top level of a program"],
  ["every 100\n    say 1\nend", "line 2: expected 'milliseconds' or 'seconds' but found 'say'"],
  ["every \"a\" seconds\n    say 1\nend", "line 1: 'every' needs a number above 0, not text"],
  ["every 0 seconds\n    say 1\nend", "line 1: 'every' needs a number above 0, not 0"],
  ["set when to 1", "line 1: 'when' is a Moth word, so it can't be used as a variable name"],
  ["when a key is pressed\n    stop\nend", "line 2: 'stop' only works inside a loop (one made with 'repeat' or 'for each')"],
  ["set code to 255\nstop the program with code + 1", "line 2: 'stop the program with' needs a whole number from 0 to 255, not 256"],
  ["say 1 to the error put", "line 1: expected 'the error output' but found 'the'"],
  ["set c to run program 5 with (list of \"a\")", "line 1: 'run program' needs text, not a number"],
  ["remove the file list of \"a\"", "line 1: a file name is text, not a list"],
  ["run program \"x\"", "line 1: 'run program' gives back the number the program ended with, so it goes where a value goes: 'set code to run program ...'"],
];

// The examples and the tables above, each broken by up to three random edits. The seed is fixed, so a
// failure always reproduces.
export function brokenPrograms(seed, count) {
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
