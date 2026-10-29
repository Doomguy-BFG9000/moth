// Random programs made only from the part of Moth that machine.moth turns into machine code: numbers
// chosen to be awkward (0.1, numbers 15 digits can't tell apart, 2^53, tiny and huge ones), yes, no and
// nothing where a number should be, text and lists in half of them, every comparison, the loops, and
// functions that call each other. Most finish; some stop at a mistake on purpose. The seed is fixed, so a
// failure always reproduces.

const NUMBERS = ["0", "1", "2", "3", "7", "10", "0.1", "0.2", "0.3", "0.5", "2.5", "1.5", "0.7", "100", "255", "1000000",
  "0.000001", "0.0000001", "123456789012345", "9007199254740991", "9007199254740992", "0.1 * 3", "1 / 3", "2 / 3",
  "4.35", "1.005", "99999999999999.99", "0x10", "0b101", "3.141592653589793"];
const ODD = ["nothing", "yes", "no"];
const TEXTS = ['""', '"a"', '"Sam"', '"é😀"', '"a,b"', '"x\\ny"', '"tab\\there"', '"q\\"uote"', '"10"', '"Zz"'];
const COMPARE = ["is", "is not", "is less than", "is greater than", "is at least", "is at most", "is divisible by"];

// Programs written by hand for what is easy to get wrong: how numbers show, 15-digit comparisons, every
// mistake the machine code can make, and long trails of calls.
export const MACHINE_CASES = [
  "say 0.1 + 0.2\nsay 1 / 3\nsay 2 / 3\nsay 0 - 1 / 3\nsay 100 / 7\nsay 1 / 1000000\nsay 1 / 10000000\nsay 15 / 100000000000\nsay 123456789012344.5\nsay 0 - 123456789012344.5\nsay 3.141592653589793\nsay 2.9999999999999996\nsay 0.000001\nsay 0.0000012345\nsay 1234.5678\nsay 99999999999999.99\nsay 999999999999999.9\nset big to 1\nrepeat 53 times\n    set big to big * 2\nend\nsay big\nsay big + 2\nsay big * 2\nsay big * 1024\nset p to 1\nrepeat 21 times\n    set p to p * 10\nend\nsay p\nsay p * 10\nsay p / 10\nset huge to 1\nrepeat 300 times\n    set huge to huge * 10\nend\nsay huge\nsay huge * 1000000000\nsay huge * huge\nsay 0 - huge * huge\nsay huge * huge - huge * huge\nset tiny to 1\nrepeat 1074 times\n    set tiny to tiny / 2\nend\nsay tiny\nsay tiny * 3\nset small to 1\nrepeat 300 times\n    set small to small / 10\nend\nsay small\nsay small * 7.5\nsay 0 - 0\nsay 0 * (0 - 1)\nset f to 1\nfor each i from 1 to 25\n    set f to f * i\n    say i \": \" f\nend\nsay 0.1 * 3\nsay 1.1 * 1.1\nsay 4.35 * 100\nsay 1.005 * 1000\nsay 0.07 * 100\nsay 1 / 3 * 3\nsay 9007199254740993\nsay 0x10 \" \" 0b101 \" \" 0xFF\nsay -5\nsay 5 - 7.25",
  "say 0.1 + 0.2 is 0.3\nsay 0.1 + 0.2 is less than 0.3\nsay 0.1 + 0.2 is at most 0.3\nsay 0.3 is at least 0.1 + 0.2\nsay 0.3 is greater than 0.1 + 0.2\nsay 0.3 is divisible by 0.1\nsay 0.35 is divisible by 0.1\nsay 10 is divisible by 3\nsay 12 is divisible by 4\nsay -12 is divisible by 4\nsay 1 / 3 is 0.333333333333333\nsay 1 / 3 is 0.3333333333333333\nsay 2 / 3 is 0.666666666666667\nsay 1 is 1.00000000000001\nsay 1 is 1.000000000000001\nsay 1000000000000000 is 1000000000000001\nsay 9007199254740993 is 9007199254740992\nsay 5 is not 6\nsay nothing is nothing\nsay yes is yes\nsay yes is no\nsay nothing is 0\nsay 3 is nothing\nsay not yes\nsay not nothing\nsay not 0\nsay yes and 5\nsay no and 5\nsay nothing or 7\nsay 3 or 4\nsay (1 is 1) and (2 is 3)\nset big to 1\nrepeat 60 times\n    set big to big * 2\nend\nsay big is divisible by 3\nsay big is divisible by 1024\nsay big + 1 is big\nsay 7.5 is divisible by 2.5\nsay 7.5 is divisible by 0.5\nfor each i from 0.1 * 10 to 0.1 * 30\n    say i\nend\nset n to 0\nrepeat 0.1 * 30 times\n    add 1 to n\nend\nsay n\nrepeat 0 times\n    say \"never\"\nend\nfor each j from 5 to 3\n    say \"never\"\nend\nfor each j from 1 to 2.5\n    say j\nend\nset k to 0\nrepeat while k is less than 5\n    add 1 to k\n    if k is 3\n        stop\n    end\nend\nsay k\nif 0\n    say \"0 counts as true\"\nend\nif nothing\n    say \"never\"\nelse if no\n    say \"never\"\nelse\n    say \"both false\"\nend",
  "to fib with n\n    if n is less than 2\n        return n\n    end\n    return fib(n - 1) + fib(n - 2)\nend\nsay fib(20)\nset total to 0\nto bump with by\n    add by to total\nend\nbump(5)\nbump 2\nsay total\nto nothing_back\n    set x to 1\nend\nsay nothing_back()\nto early with n\n    for each i from 1 to 10\n        if i is n\n            return i * 100\n        end\n    end\n    return\nend\nsay early(3) \" \" early(20)\nto area with width as a number, height as a number\n    return width * height\nend\nsay area(3, 4)\nto flag with ok as yes or no\n    if ok\n        return 1 is 1\n    end\n    return no\nend\nsay flag(yes) \" \" flag(no)\nto sum with n\n    if n is 0\n        return 0\n    end\n    return n + sum(n - 1)\nend\nsay sum(10000)\nto two with a, b\n    return a - b\nend\nsay two(10, 3)\nsay two(two(10, 3), two(1, 2))",
  "set a to 1\nif a is 2\n    set b to 5\nend\nsay a + b",
  "to f\n    set x to 1\nend\nsay f() + 1",
  "to half with n\n    return n / (n - n)\nend\nto outer with n\n    return half(n) + 1\nend\nsay outer(4)",
  "set count to 0\nto f with n\n    add 1 to count\n    return f(n + 1)\nend\nsay f(1)",
  "to ping with n\n    return pong(n + 1)\nend\nto pong with n\n    return ping(n + 1)\nend\nsay ping(1)",
  "to two with a, b\n    return a + b\nend\nsay \"start\"\nsay two(1)",
  "to area with width as a number, height as a number\n    return width * height\nend\nsay area(2, 3)\nsay area(2, yes)",
  "to flag with ok as yes or no\n    return ok\nend\nsay flag(no)\nsay flag(1)",
  "to shout with words as text\n    return 1\nend\nshout(5)",
  "set total to 5\nsay totl",
  "say helper(2)\nto helper with x\n    return x\nend",
  "to helper with x\n    return x\nend\nsay helpr(2)",
  "repeat 2.5 times\n    say \"x\"\nend",
  "to f\n    return\nend\nrepeat f() times\n    say \"x\"\nend",
  "for each i from 1 to yes\n    say i\nend",
  "say -(1 is 1)",
  "say 3 is less than nothing",
  "say 10 is divisible by 0",
  "set x to nothing\nadd 1 to x",
  "set x to 1\nadd yes to x",
  "add 1 to y",
  "to a1 with n\n    return a2(n)\nend\nto a2 with n\n    return a3(n)\nend\nto a3 with n\n    return a4(n)\nend\nto a4 with n\n    return a5(n)\nend\nto a5 with n\n    return a6(n)\nend\nto a6 with n\n    return a7(n)\nend\nto a7 with n\n    return a8(n)\nend\nto a8 with n\n    return a9(n)\nend\nto a9 with n\n    return b1(n)\nend\nto b1 with n\n    return b2(n)\nend\nto b2 with n\n    return b3(n)\nend\nto b3 with n\n    return n / 0\nend\nsay a1(5)",
  "say \"before\"\nsay \"a \" 1 \" b \" c",
  "to f\n\tsay 1 + nothing\nend\nf()",
  // text and lists: joined, compared, counted, indexed, gone through, and their mistakes
  "set name to \"Moth\"\nsay \"Hi, \" + name + \"!\"\nsay name \" is \" 4 \" letters\"\nsay length of name\nset t to \"\"\nfor each i from 1 to 5\n    add i to t\n    add \",\" to t\nend\nsay t\nsay length of t\nsay \"a\" + 1 + 2\nsay 1 + 2 + \"a\"\nsay nothing + \"x\"\nsay \"x\" + yes\nsay \"é😀\" + \"ok\"\nsay length of \"é😀ok\"\nsay \"abc\" is \"abc\"\nsay \"abc\" is \"abd\"\nsay \"abc\" is less than \"abd\"\nsay \"b\" is greater than \"abc\"\nsay \"\" is less than \"a\"\nsay \"Zebra\" is less than \"apple\"\nsay \"😀\" is greater than \"￿\"\nsay \"x\" is in \"fox\"\nsay \"ox\" is in \"fox\"\nsay \"\" is in \"fox\"\nsay \"fx\" is in \"fox\"\nsay item 2 of \"héllo\"\nsay item 1 of \"😀a\"\nfor each c in \"héllo😀\"\n    say c\nend",
  "set fruits to list of \"apple\", \"pear\"\nadd \"mango\" to fruits\nsay fruits\nsay length of fruits\nsay item 2 of fruits\nset item 1 of fruits to \"kiwi\"\nsay fruits\nfor each f in fruits\n    say f\nend\nset numbers to list of 1, 2.5, 0.1 + 0.2, nothing, yes, \"a\\\"b\\c\"\nsay numbers\nsay empty list\nset l to empty list\nfor each i from 1 to 10\n    add i * i to l\nend\nsay l\nsay length of l\nsay 49 is in l\nsay 50 is in l\nsay (list of 1, 2) is (list of 1, 2)\nsay (list of 1, 2) is (list of 1, 3)\nsay (list of 1, list of 2, 3) is (list of 1, list of 2, 3)\nset nested to list of 1, (list of 2, (list of 3))\nsay nested\nset me to list of 1\nadd me to me\nsay me\nsay me is me\nsay item (0.1 * 30) of l\nset total to 0\nfor each n in l\n    add n to total\nend\nsay total\nset copy to list of 1, 2, 3\nfor each x in copy\n    add x to copy\nend\nsay copy\nsay \"list: \" + fruits\nsay \"a\\tb\\nc\"\nsay list of \"a\\tb\\nc\", \"\\u\"",
  "set l to list of 1, 2, 3\nsay item 4 of l",
  "set l to list of 1, 2, 3\nsay item 0 of l",
  "set l to list of 1, 2, 3\nsay item 1.5 of l",
  "say item 1 of 5",
  "set t to \"ab\"\nset item 1 of t to \"x\"",
  "say item 3 of \"ab\"",
  "say length of 5",
  "for each x in 5\n    say x\nend",
  "say \"a\" - 1",
  "set l to list of 1\nsay l * 2",
  "say 3 is in 5",
  "say \"a\" is less than 2",
  "set x to 1\nadd \"a\" to x",
  "to f with words as text\n    return words\nend\nsay f(\"ok\")\nsay f(list of 1)",
  "set l to list of 1, 2\nset item 3 of l to 5",
  "set l to list of 1, 2\nsay item \"x\" of l",
  "say item 1 of (list of 9)\nsay item 1 of empty list",
  "repeat \"a\" times\n    say 1\nend",
  "set l to list of 1, 2, 3\nsay item 2 of l\nsay item (0 - 1) of l",
  "set s to \"ab\"\nrepeat while yes\n    add s to s\nend",
  // records and dictionaries: made, changed, shown, compared, gone through, and their mistakes
  "set sam to record with name \"Sam\", age 20\nsay sam\nsay name of sam \" is \" age of sam\nset age of sam to 21\nset city of sam to \"Pune\"\nsay sam\nsay record with x 1, x 2\nset r to record with items list of 1, 2, inner record with deep \"yes\"\nsay r\nsay deep of inner of r\nsay (record with a 1, b 2) is (record with b 2, a 1)\nsay (record with a 1, b 2) is (record with a 1, b 3)\nsay (record with a 1) is (record with a 1, b 2)\nset me to record with self nothing\nset self of me to me\nsay me\nset people to list of (record with name \"Ana\"), (record with name \"Bo\")\nfor each p in people\n    say name of p\nend\nsay length of people",
  "set sam to record with name \"Sam\", age 20\nsay nme of sam",
  "set x to 5\nsay name of x",
  "set x to \"text\"\nset name of x to 1",
  "set sam to record with name \"Sam\", age 20, height 1.8\nsay weight of sam",
  "set ages to dictionary where \"Sam\" is 20, \"Ana\" is 31\nsay ages\nset item \"Bo\" of ages to 7\nsay item \"Bo\" of ages\nsay length of ages\nremove \"Ana\" from ages\nsay ages\nsay \"Sam\" is in ages\nsay \"Ana\" is in ages\nfor each person in ages\n    say person \": \" item person of ages\nend\nsay keys of ages\nset d to dictionary where 0.3 is \"found\", 1 is \"one\", -0 is \"zero\"\nsay item (0.1 + 0.2) of d\nsay (0.1 + 0.2) is in d\nsay item 0 of d\nset item (0.1 + 0.2) of d to \"again\"\nsay d\nsay keys of d\nset e to empty dictionary\nsay e\nsay length of e\nfor each i from 1 to 100\n    set item i of e to i * i\nend\nsay length of e \" \" item 50 of e\nfor each i from 1 to 100\n    if i is divisible by 3\n        remove i from e\n    end\nend\nsay length of e \" \" item 50 of e\nsay 51 is in e\nsay (dictionary where \"a\" is 1, \"b\" is 2) is (dictionary where \"b\" is 2, \"a\" is 1)\nsay (dictionary where \"a\" is 1) is (dictionary where \"a\" is 2)\nset counts to empty dictionary\nfor each w in list of \"the\", \"cat\", \"the\", \"hat\", \"the\"\n    if w is in counts\n        set item w of counts to item w of counts + 1\n    else\n        set item w of counts to 1\n    end\nend\nsay counts\nset nested to dictionary where \"list\" is list of 1, 2, \"rec\" is record with x 1\nsay nested\nsay yes is in counts\nsay (list of 1) is in counts",
  "set ages to dictionary where \"Sam\" is 20, \"Ana\" is 31\nsay item \"Sma\" of ages",
  "set ages to dictionary where \"Sam\" is 20\nsay item \"Zed\" of ages",
  "set d to dictionary where yes is 1",
  "set d to empty dictionary\nset item (list of 1) of d to 2",
  "set d to dictionary where 1 is 2\nremove 5 from d",
  "set l to list of 1\nremove 1 from l",
  "say keys of (list of 1)",
  "set d to dictionary where 1 is 2\nsay item nothing of d",
  "set d to dictionary where 2.5 is \"x\"\nsay item 2.50000000000001 of d\nsay item 2.6 of d",
  // try, the helpers (position, split, join, number of, the bits, shift, bytes, as text) and bytes
  "try\n    say 1 / 0\nif it fails with why\n    say \"caught: \" why\nend\ntry\n    fail with \"my own\"\nif it fails with why\n    say \"caught: \" why\nend\ntry\n    fail with 42\nif it fails with why\n    say why + 1\nend\ntry\n    fail with list of 1, 2\nif it fails with why\n    say why\nend\ntry\n    say \"fine\"\nif it fails\n    say \"never\"\nend\nto risky with n\n    if n is 0\n        fail with \"zero!\"\n    end\n    return risky(n - 1)\nend\ntry\n    say risky(5)\nif it fails with why\n    say \"deep: \" why\nend\nto f\n    try\n        return 1 / 0\n    if it fails with why\n        return \"f caught \" + why\n    end\nend\nsay f()\nfor each i from 1 to 5\n    try\n        if i is 3\n            stop\n        end\n        say i\n    if it fails\n        say \"no\"\n    end\nend\nsay \"after\"\nset n to 0\nrepeat while yes\n    add 1 to n\n    try\n        try\n            if n is 4\n                stop\n            end\n        if it fails\n            say \"x\"\n        end\n    if it fails\n        say \"y\"\n    end\nend\nsay n\ntry\n    try\n        say item 5 of (list of 1)\n    if it fails with inner\n        say \"inner: \" inner\n        fail with \"again\"\n    end\nif it fails with outer\n    say \"outer: \" outer\nend\nto deep with n\n    return deep(n + 1)\nend\ntry\n    say deep(1)\nif it fails with why\n    say why\nend\nto early\n    try\n        return 5\n    if it fails\n        return 6\n    end\nend\nsay early()\nsay 1 / 0",
  "to g\n    try\n        return 1\n    if it fails\n        return 2\n    end\nend\nsay g()\nsay item 9 of (list of 1)",
  "say position of \"fox\" in \"the quick fox\"\nsay position of \"x\" in \"abc\"\nsay position of \"\" in \"abc\"\nsay position of \"é\" in \"aé😀é\"\nsay position of \"😀é\" in \"aé😀é\"\nsay split \"the quick fox\" by \" \"\nsay split \"a,,b,\" by \",\"\nsay split \"héllo\" by \"\"\nsay split \"\" by \",\"\nsay split \"abc\" by \"abcd\"\nsay join (list of \"a\", 1, yes, nothing, list of 2) with \"-\"\nsay join empty list with \",\"\nsay number of \"42\"\nsay number of \" -3.5 \"\nsay number of \"007\"\nsay number of \"0.1\"\nsay number of \"3.141592653589793\"\nsay number of \"123456789012345678901234567890\"\nsay number of \"0.000000000000000000000000000001\"\nsay number of \"1\" + 0\nsay number of 5\nsay number of \"9007199254740993\"\nsay number of \"2.2250738585072011e-308\" is 0\nsay number of \"179769313486231570000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000\"\nsay number of \"0.0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000049406564584124654\"\nsay 12 bit and 10\nsay 12 bit or 3\nsay 12 bit xor 10\nsay shift 1 left by 4\nsay shift 255 right by 4\nsay shift 1 left by 52\nsay shift 1 right by 100\nsay 255 as hex\nsay 5 as binary\nsay 0 as hex\nsay 9007199254740991 as hex\nset block to 4 bytes\nsay block\nset byte 1 of block to 0xFF\nsay block\nsay byte 1 of block\nsay length of block\nfor each b in block\n    say b\nend\nsay \"hi\" as bytes\nsay (\"hi\" as bytes) as text\nsay (list of 104, 105, 0xE2, 0x82, 0xAC) as bytes as text\nsay (list of 0xFF, 0x61, 0xE2, 0x82, 0x41, 0xF0, 0x9F, 0x98) as bytes as text\nsay (list of 0xEF, 0xBB, 0xBF, 0x61) as bytes as text\nsay 5 as text + 1\nsay (list of 1, 2) as text\nsay 255 is in (list of 1, 255) as bytes\nsay 3 is in (\"abc\" as bytes)\nsay 97 is in (\"abc\" as bytes)\nsay (\"ab\" as bytes) is (\"ab\" as bytes)\nsay (\"ab\" as bytes) is (\"ac\" as bytes)\nsay 0 bytes\nsay 1 bytes\nsay (list of 7) as bytes",
  "say position of 1 in \"a\"",
  "say position of \"a\" in 2",
  "say split 1 by \",\"",
  "say split \"a\" by 2",
  "say join 5 with \",\"",
  "say join (list of 1) with 5",
  "say number of \"abc\"",
  "say number of \"1.\"",
  "say number of \".5\"",
  "say number of nothing",
  "say number of \"1e5\"",
  "say 1.5 bit and 2",
  "say -1 bit or 2",
  "say 9007199254740992 bit xor 1",
  "say \"a\" bit and 1",
  "say shift 1 left by 53",
  "say shift 3 left by 52",
  "say shift 2.5 right by 1",
  "say -1 as hex",
  "say 2.5 bytes",
  "say \"x\" bytes",
  "set b to 2 bytes\nset byte 1 of b to 256",
  "set b to 2 bytes\nset byte 3 of b to 1",
  "say byte 3 of (2 bytes)",
  "say (list of 1, 300) as bytes",
  "say 5 as bytes",
  "set b to 2 bytes\nset byte 1 of b to \"a\"",
];

export function machinePrograms(seed, count) {
  let state = seed;
  const random = (n) => {
    state = (state * 1103515245 + 12345) % 2 ** 31;
    return Math.floor((state / 2 ** 31) * n);
  };
  const pick = (list) => list[random(list.length)];
  const chance = (p) => random(1000) < p * 1000;

  function program() {
    const data = chance(0.5); // text and lists as well as numbers
    const vars = data ? ["a", "b", "c", "t", "l"] : ["a", "b", "c"];
    const fns = [];
    const lines = [];
    const number = () => (chance(0.01) ? pick(ODD) : pick(NUMBERS));
    const leaf = (names) => (data && chance(0.25) ? pick(TEXTS) : chance(0.5) && names.length ? pick(names) : number());
    function value(depth, names) {
      const r = random(data ? 13 : 10);
      if (depth > 2 || r < 3) return leaf(names);
      if (r === 10) return `(list of ${value(depth + 1, names)}, ${value(depth + 1, names)})`;
      if (r === 11) return `length of ${pick(names.length ? names : ['"abc"'])}`;
      if (r === 12) return `item ${pick(["1", "2", "0.1 * 20", "3", "0", "1.5"])} of ${pick(names.length ? names : ['"abc"'])}`;
      if (r < 6) return `(${value(depth + 1, names)} ${pick(["+", "-", "*", "/"])} ${value(depth + 1, names)})`;
      if (r < 7) return `-${value(depth + 1, names)}`;
      if (r < 8 && fns.length) {
        const [f, n] = pick(fns);
        return `${f}(${Array.from({ length: chance(0.05) ? n + 1 : n }, () => value(depth + 1, names)).join(", ")})`;
      }
      if (r < 9 && chance(0.3)) return `(${test(depth + 1, names)})`;
      if (r < 9) return names.length ? pick(names) : number();
      return `(${value(depth + 1, names)} ${pick(["and", "or"])} ${value(depth + 1, names)})`;
    }
    function test(depth, names) {
      if (chance(0.15)) return `not ${test(depth + 1, names)}`;
      if (chance(0.15) && depth < 3) return `${test(depth + 1, names)} ${pick(["and", "or"])} ${test(depth + 1, names)}`;
      return `${value(depth + 1, names)} ${pick(COMPARE)} ${value(depth + 1, names)}`;
    }
    function block(indent, names, depth, inLoop, inFn) {
      const out = [];
      for (let k = 1 + random(3); k > 0; k--) {
        const pad = "    ".repeat(indent);
        const r = random(12);
        if (r < 3 && data && chance(0.4)) out.push(`${pad}say ${pick(["l", "t", "l \" \" t", "(list of l, t, a)"])}`);
        else if (r < 3) out.push(`${pad}say ${chance(0.4) ? '"v: " ' : ""}${value(0, names)}${chance(0.3) ? ` " " ${value(0, names)}` : ""}`);
        else if (r < 5) out.push(`${pad}set ${pick(names.length ? names : vars)} to ${value(0, names)}`);
        else if (r < 6 && data && chance(0.6)) out.push(`${pad}add ${value(1, names)} to ${pick(["l", "t"])}`);
        else if (r < 6) out.push(`${pad}add ${value(1, names)} to ${pick(names.length ? names : vars)}`);
        else if (r < 7 && depth < 2) {
          out.push(`${pad}if ${test(0, names)}`, ...block(indent + 1, names, depth + 1, inLoop, inFn));
          if (chance(0.5)) out.push(`${pad}else`, ...block(indent + 1, names, depth + 1, inLoop, inFn));
          out.push(`${pad}end`);
        } else if (r < 8 && depth < 2) {
          out.push(`${pad}repeat ${pick(["2", "3", "0.1 * 30", "0", "1.5", "2.9999999999999996", "nothing", pick(names.length ? names : ["2"])])} times`,
            ...block(indent + 1, names, depth + 1, true, inFn), `${pad}end`);
        } else if (r < 9 && depth < 2) {
          const v = pick(["i", "j", ...names]);
          out.push(`${pad}for each ${v} from ${pick(["1", "0.1 * 10", "0", "2.5", "-1"])} to ${pick(["3", "0.1 * 30", "2", "0", "yes"])}`,
            ...block(indent + 1, [...new Set([...names, v])], depth + 1, true, inFn), `${pad}end`);
        } else if (data && r < 10 && chance(0.4)) {
          const v = pick(["x", "y"]);
          out.push(`${pad}for each ${v} in ${pick(names.length ? names : ["l"])}`, ...block(indent + 1, [...names, v], depth + 1, true, inFn), `${pad}end`);
        } else if (data && r < 10 && chance(0.4)) out.push(`${pad}set item ${pick(["1", "2", "0.1 * 30"])} of ${pick(names.length ? names : ["l"])} to ${value(1, names)}`);
        else if (r < 10 && inLoop) out.push(`${pad}if ${test(0, names)}`, `${pad}    stop`, `${pad}end`);
        else if (r < 11 && inFn) out.push(`${pad}return ${chance(0.2) ? "" : value(0, names)}`.trimEnd());
        else if (fns.length) {
          const [f, n] = pick(fns);
          out.push(`${pad}${f}(${Array.from({ length: n }, () => value(1, names)).join(", ")})`);
        } else out.push(`${pad}say ${value(0, names)}`);
      }
      return out;
    }
    for (const v of vars.slice(0, 3)) if (chance(0.97)) lines.push(`set ${v} to ${pick(NUMBERS)}`);
    if (data) lines.push(`set t to ${pick(TEXTS)}`, `set l to list of ${pick(NUMBERS)}, ${pick(TEXTS)}, ${pick(NUMBERS)}`);
    for (let i = random(3); i > 0; i--) {
      const name = ["f", "g", "h"][fns.length];
      const params = ["p", "q"].slice(0, random(3));
      const kinds = params.map((p) => (chance(0.2) ? `${p} as ${pick(["a number", "yes or no", "text", "a list"])}` : p));
      lines.push(`to ${name}${params.length ? ` with ${kinds.join(", ")}` : ""}`);
      fns.push([name, params.length]);
      // a function may call itself, but only so deep: its first input counts down
      if (params.length && chance(0.3)) lines.push(`    if ${params[0]} is greater than 3`, `        return ${name}(${[`${params[0]} - 1`, ...params.slice(1)].join(", ")})`, "    end");
      lines.push(...block(1, [...params, ...vars.slice(0, random(2))], 0, false, true), "end");
    }
    lines.push(...block(0, vars, 0, false, false));
    return lines.join("\n");
  }
  return Array.from({ length: count }, program);
}
