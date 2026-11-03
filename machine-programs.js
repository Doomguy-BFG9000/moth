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
  // random numbers: run with MOTH_SEED=1, the seed the JavaScript engine's tests use, so they're the same ones
  "set counts to list of 0, 0, 0, 0, 0, 0\nrepeat 6000 times\n    set d to random number from 1 to 6\n    set item d of counts to item d of counts + 1\nend\nsay counts\nfor each i from 1 to 5\n    say random number from -1000000000000 to 1000000000000\nend\nsay random number from 0 - 0 to 0\nsay random number from 2.9999999999999996 to 3\nsay random number from 0.1 * 30 to 0.1 * 30\nto roll with sides\n    return random number from 1 to sides\nend\nset rolls to empty list\nrepeat 20 times\n    add roll(20) to rolls\nend\nsay rolls",
  "say random number from 1 to \"6\"",
  "say random number from nothing to 1",
  "say \"before\"\nsay random number from 6 to 1",
  "say random number from 0.1 * 3 to 1",
  "say random number from 1 to 1 / 0",
  "set low to -2.5\nsay random number from low + 0.5 to low",
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
  // loops kept in registers, and what the compiler knows about variables (DESIGN §32): a variable that is a
  // number and then isn't, mistakes inside those loops, a try around one, calls that change main's variables,
  // more variables than registers, comparisons and divisible by right there, and deep recursion
  // a variable in a loop that is a number, then text, then a number again: its checks stay
  "set x to 0\nfor each i from 1 to 6\n    add i to x\n    if i is 3\n        set x to \"a\"\n    end\nend\nsay x\nset y to 1\nfor each i from 1 to 4\n    if i is 2\n        set y to \"b\"\n    else if i is 3\n        set y to 10\n    end\n    say y + 1\nend\nset z to 5\nrepeat 3 times\n    say z * 2\n    set z to list of z\nend",
  // a variable with no value yet before the loop, and one that gets one only on the way round
  "for each i from 1 to 3\n    if i is 1\n        set w to 5\n    end\n    say w + i\nend\nfor each i from 1 to 3\n    if i is 2\n        say v\n    end\n    set v to i\nend",
  "for each i from 1 to 3\n    if i is 2\n        say u + 1\n    end\nend\nset u to 1",
  // what the right of `and` and `or` finds out isn't known after: b has no value here
  "set a to yes\nif a or b\n    say \"ok\"\nend\nset c to no\nif c and b\n    say \"never\"\nend\nsay a and b\nsay b\nset b to 1",
  // mistakes inside loops kept in registers, at the right place
  "set total to 0\nfor each i from 1 to 10\n    if i is 5\n        add \"x\" to total\n    end\n    add i to total\nend",
  "set total to 0\nfor each i from 0 to 3\n    add 1 / i to total\nend\nsay total",
  "set total to 0\nset d to 2\nrepeat while d is less than 10\n    add d to total\n    if total is greater than 10\n        set d to \"ten\"\n    end\n    add 1 to d\nend",
  "set n to 7\nfor each i from 1 to 5\n    if n is divisible by i - 1\n        say i\n    end\nend",
  "set k to 0\nrepeat 5 times\n    add 1 to k\n    if k is 3\n        say -nothing\n    end\nend",
  // a try around a loop kept in registers: the handler sees every value the loop made
  "set total to 0\nset last to 0\ntry\n    for each i from 1 to 10\n        add i to total\n        set last to i * 2\n        if i is 4\n            fail with \"stop here\"\n        end\n    end\nif it fails with why\n    say why \" \" total \" \" last\nend\nsay total + last\nto run with n\n    set s to 0\n    for each i from 1 to n\n        add i to s\n        if i is 3\n            say s / 0\n        end\n    end\n    return s\nend\ntry\n    say run(5)\nif it fails with why\n    say why\nend\nsay run(2)",
  // loops that call functions keep nothing in registers, and a call may change main's variables
  "set total to 0\nto bump\n    add 10 to total\n    for each j from 1 to 3\n        add j to total\n    end\nend\nfor each i from 1 to 3\n    add i to total\n    bump()\n    add total to total\nend\nsay total\nto show\n    say \"total \" total\nend\nfor each i from 1 to 3\n    add i to total\nend\nshow()\nset total to \"t\"\nto change\n    set total to 5\nend\nset seen to total\nchange()\nsay seen \" \" total + 1",
  // a loop's count changed inside the loop doesn't change how often it goes round; nor does its limit
  "for each i from 1 to 5\n    set i to i * 10\n    say i\nend\nset top to 3\nfor each i from 1 to top\n    set top to 10\n    say i \" \" top\nend\nfor each x from 0.5 to 3\n    say x\nend\nfor each x from -2 to 0.1 * 3\n    say x\nend\nfor each i from 2.9999999999999996 to 3\n    say i\nend\nfor each i from 1 to 2.9999999999999996\n    say i\nend\nfor each i from 9007199254740980 to 9007199254740983\n    say i\nend\nset n to 0\nrepeat 0.1 * 30 times\n    add 1 to n\nend\nsay n",
  // more variables than registers, in loops inside loops
  "set a to 0\nset b to 0\nset c to 0\nset d to 0\nset e to 0\nset f to 0\nset g to 0\nset h to 0\nset k to 0\nset m to 0\nfor each i from 1 to 20\n    for each j from 1 to 3\n        add 1 to a\n        add 2 to b\n        add 3 to c\n        add 4 to d\n        add i to e\n        add j to f\n        add a to g\n        add b to h\n        add c * d to k\n        repeat 2 times\n            add 1 to m\n            add e - f to m\n        end\n    end\nend\nsay a \" \" b \" \" c \" \" d \" \" e \" \" f \" \" g \" \" h \" \" k \" \" m",
  // comparisons of numbers right there: whole ones, close ones that 15 digits can't tell apart, infinities and NaN
  "set x to 0\nrepeat while x is not 1\n    add 0.1 to x\nend\nsay x\nset big to 1\nrepeat 400 times\n    set big to big * 10\nend\nset nan to big - big\nsay big is greater than 5\nsay 0 - big is less than 5\nsay nan is less than 1\nsay nan is at least 1\nsay nan is nan\nsay big is big\nsay 1 / 3 is less than 0.333333333333333\nsay 0.333333333333333 is less than 1 / 3\nsay 1 / 3 is at most 0.333333333333333\nsay 3 is 2.9999999999999996\nsay 3 is less than 2.9999999999999996\nsay 2.9999999999999996 is less than 3\nsay 1000000000000000 is less than 1000000000000001\nsay 0 is 0 - 0\nsay 0 - 0 is less than 0\nfor each i from 1 to 6\n    say i is less than 3.5 \" \" i is at least 2 \" \" i is greater than 4 \" \" 4 is at most i \" \" i is 5 \" \" i * 0.1 is 0.3\nend\nset s to 0\nfor each i from 1 to 100\n    set q to i / 7\n    if q is less than 3\n        add q to s\n    end\nend\nsay s",
  // divisible by: whole numbers right there, and everything else as before
  "set big to 1\nrepeat 62 times\n    set big to big * 2\nend\nsay big is divisible by 3\nsay big is divisible by 1024\nsay big * 2 is divisible by 2\nsay big * 4 is divisible by 3\nsay big is divisible by big\nsay 0 - big * 2 is divisible by 7\nsay 0 - 0 is divisible by 5\nsay 0 is divisible by big * big * big * big * big * big * big * big * big * big * big * big * big * big * big * big * big * big * big * big\nsay 5 is divisible by big * big * big * big * big * big * big * big * big * big * big * big * big * big * big * big * big * big * big * big\nsay 7.5 is divisible by 2.5\nsay 10 is divisible by 2.5\nsay -12 is divisible by 4\nsay 12 is divisible by -5\nfor each n from 1 to 30\n    if n is divisible by 3 and not (n is divisible by 2)\n        say n\n    end\nend\nset count to 0\nfor each n from 2 to 2000\n    set prime to yes\n    set d to 2\n    repeat while d * d is at most n\n        if n is divisible by d\n            set prime to no\n            stop\n        end\n        add 1 to d\n    end\n    if prime\n        add 1 to count\n    end\nend\nsay count",
  "for each i from 3 to 0\n    say \"never\"\nend\nfor each i from 1 to 3\n    say 12 is divisible by i - 2\nend",
  "set x to \"a\"\nfor each i from 1 to 3\n    say x is divisible by i\nend",
  "set x to 5\nfor each i from 1 to 3\n    if i is 2\n        set x to \"a\"\n    end\n    say x is less than 7\nend",
  // functions: inputs, typed ones, own variables kept in registers, made inside, and deep recursion
  "to sum_to with n\n    set s to 0\n    for each i from 1 to n\n        add i to s\n    end\n    return s\nend\nsay sum_to(100) \" \" sum_to(0) \" \" sum_to(2.5)\nto scaled with n as a number, k\n    set s to 0\n    repeat 3 times\n        add n * k to s\n        set n to n - 1\n    end\n    return s\nend\nsay scaled(5, 2)\nsay scaled(5, \"x\")",
  "to counter\n    set n to 0\n    to bump\n        add 1 to n\n        return n\n    end\n    for each i from 1 to 3\n        bump()\n    end\n    set got to 0\n    for each i from 1 to 4\n        add n to got\n    end\n    return got\nend\nsay counter()",
  "to depth with n\n    if n is 0\n        return 0\n    end\n    set s to 0\n    for each i from 1 to 2\n        add i to s\n    end\n    return s + depth(n - 1)\nend\nsay depth(40000)\nsay depth(99990)",
  "to down with n\n    if n is less than 1\n        return 0\n    end\n    return 1 + down(n - 1)\nend\nsay down(50000)\nsay down(100001)",
  "to fib with n\n    if n is less than 2\n        return n\n    end\n    return fib(n - 1) + fib(n - 2)\nend\nsay fib(20)\nsay fib(2.5)\nsay fib(\"x\")",
  // text, lists and records in loops kept in registers, made far more often than kept
  "set keep to empty list\nset t to \"\"\nfor each i from 1 to 30000\n    set s to \"x\" + i\n    add s to keep\n    if i is divisible by 1000\n        add \"!\" to t\n    end\nend\nsay length of keep \" \" item 29999 of keep \" \" t\nset r to record with n 0\nfor each i from 1 to 5000\n    set r to record with n n of r + i\nend\nsay n of r",
  // each, repeat and while with registers, and stop in the middle
  "set total to 0\nset seen to 0\nfor each v in list of 1, 2.5, \"a\", 4, nothing\n    add 1 to seen\n    if v is \"a\"\n        stop\n    end\n    add v to total\nend\nsay total \" \" seen\nset k to 10\nrepeat k times\n    add 1 to k\nend\nsay k\nset m to 0\nrepeat while m is less than 100\n    add 7 to m\n    if m is divisible by 5\n        stop\n    end\nend\nsay m",
  // whole numbers in general registers: sums that go past 2^53 go on as doubles, from the statement that went past
  "set total to 9007199254740000\nfor each i from 1 to 2000\n    add i to total\nend\nsay total\nset p to 1\nfor each i from 1 to 30\n    set p to p * i\nend\nsay p\nset q to 1\nset steps to 0\nrepeat while q is less than 1000000000000000000000\n    set q to q * 3 + 1\n    add 1 to steps\nend\nsay q \" \" steps\nset t to 0\nfor each i from 1 to 100000\n    add i * i * i to t\nend\nsay t\nset u to 0\nfor each i from 1 to 300000\n    add i + (i * i - (i - 1)) to u\n    if u is greater than 9000000000000000\n        set u to u - 9000000000000000\n    end\nend\nsay u\nset w to 0 - 9007199254740000\nfor each i from 1 to 2000\n    set w to w - i\nend\nsay w",
  // the count's start and limit: whole and small, or not; past the limit by less than 15 digits can tell
  "set t to 0\nfor each i from -5 to -1\n    add i to t\nend\nsay t\nfor each i from -5 to -2.5\n    say i\nend\nfor each i from 1 to 2.9999999999999996\n    say i\nend\nfor each i from 0.5 to 3\n    add i to t\nend\nsay t\nfor each i from 999999999999990 to 1000000000000000\n    add 1 to t\nend\nsay t\nfor each i from 3 to 1\n    add 100 to t\nend\nsay t \" \" i\nfor each i from 2 to 2\n    add i to t\nend\nsay t \" \" i\nset z to -0\nfor each i from 1 to 3\n    add i to z\nend\nsay z\nset big to 9007199254740992\nfor each i from 1 to 3\n    add i to big\nend\nsay big\nset n to 4\nfor each i from 1 to n * 2.5\n    add 1 to t\nend\nsay t",
  // dividing by 0, and comparisons, inside: what's wrong, said where
  "set hits to 0\nfor each i from -3 to 3\n    if 12 is divisible by i + 4 and not (i is 0)\n        add 1 to hits\n    end\n    if i is at least 1 or i is less than -2\n        add 10 to hits\n    end\n    if i * i is at most 4 and i is not -1\n        add 100 to hits\n    end\nend\nsay hits\nfor each i from 1 to 5\n    if 30 is divisible by 3 - i\n        add i to hits\n    end\nend",
  "set count to 0\nfor each n from 2 to 3000\n    set prime to yes\n    set d to 2\n    repeat while d * d is at most n\n        if n is divisible by d\n            set prime to no\n            stop\n        end\n        add 1 to d\n    end\n    if prime\n        add 1 to count\n    end\nend\nsay count \" \" d \" \" prime\nset x to 0\nset y to 0\nrepeat while x is less than 1000\n    add 7 to x\n    if x is divisible by 11\n        set y to y + x\n        stop\n    else if x is divisible by 13\n        set y to 0 - y\n    else\n        add 1 to y\n    end\nend\nsay x \" \" y",
  // in a function, with its own variables and inputs; the count changed inside; and every register used
  "to sum_to with n\n    set s to 0\n    for each i from 1 to n\n        add i to s\n    end\n    return s\nend\nsay sum_to(1000) \" \" sum_to(0) \" \" sum_to(-3) \" \" sum_to(2.5)\nto mixed with n as a number\n    set a to 1\n    set b to 2\n    set c to 3\n    for each i from 1 to n\n        add a to b\n        add b to c\n        set a to c - b\n    end\n    return a + b + c\nend\nsay mixed(20) \" \" mixed(80)\nfor each i from 1 to 5\n    set i to i * 10\n    say i\nend\nsay i\nset a to 0\nset b to 0\nset c to 0\nset d to 0\nfor each i from 1 to 1000\n    add i to a\n    add a to b\n    add b to c\nend\nsay a \" \" b \" \" c\nfor each i from 1 to 10\n    add i to a\n    add a to b\n    add b to c\n    add c to d\nend\nsay a \" \" b \" \" c \" \" d\nset e to 0\nfor each i from 1 to 10\n    add i to a\n    add a to b\n    add b to c\n    add c to d\n    add d to e\nend\nsay a \" \" b \" \" c \" \" d \" \" e",
  // a try around one, and a mistake after it goes back to doubles
  "set total to 0\ntry\n    for each i from 1 to 10\n        add i to total\n    end\n    say 1 / (total - 55)\nif it fails with why\n    say why \" \" total\nend\nset k to 0\nrepeat while k is not 10\n    add 3 to k\n    if k is greater than 20\n        stop\n    end\nend\nsay k\nset m to 5\nfor each i from 1 to 3\n    set m to 0 - m * 2\nend\nsay m\nset n to 0\nfor each i from 1 to 3\n    set n to n * (0 - i)\nend\nsay n \" \" 1 / (n + 1)",
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
  // upper and lower case, Σ at the end of a word and not, and mistakes
  "say uppercase of \"hello, World! 123\"\nsay lowercase of \"HELLO, wORLD! 123\"\nsay uppercase of \"\"\nsay uppercase of \"straße ŉ ǰ ﬃ\"\nsay lowercase of \"İSTANBUL\"",
  "for each t in list of \"ΑΣ\", \"ΑΣΑ\", \"Σ\", \"Α.Σ\", \"ΑΣ.\", \"ΣΑ\", \"ΑΣ Α\", \"ΟΔΥΣΣΕΥΣ\", \"ΆΣ\", \"ΑΣ1\", \"1Σ\"\n    say lowercase of t\nend",
  "set t to \"abc\"\nset u to uppercase of t\nadd \"d\" to t\nsay t + \" \" + u\nsay lowercase of (uppercase of \"Ünïcödé 😀 ΣΊΣΥΦΟΣ\")",
  "say uppercase of 5",
  "say lowercase of (list of \"A\")",
  // functions as values, functions made inside functions, and calls through a variable
  "to make_counter\n    set count to 0\n    to step\n        add 1 to count\n        return count\n    end\n    return step\nend\nset c to make_counter()\nsay c()\nsay c()\nset d to make_counter()\nsay d()\nsay c()\nsay c",
  "to twice with f, x\n    return f(f(x))\nend\nto inc with n\n    return n + 1\nend\nsay twice(inc, 5)\nset g to inc\nsay g(10)\nsay list of inc, 1\nsay record with f inc",
  "to adder with n\n    to add_it with x\n        return x + n\n    end\n    return add_it\nend\nset add5 to adder(5)\nset add10 to adder(10)\nsay add5(1)\nsay add10(1)\nsay add5(add10(100))",
  "to f with a, b\n    return a + b\nend\nset g to f\nsay g(1)",
  "to f with a as a number\n    return a * 2\nend\nset g to f\nsay g(3)\nsay g(\"x\")",
  "set x to 5\nsay x(1)",
  "say nope(1)",
  "to outer\n    set total to 0\n    to add_some with k\n        set total to total + k\n    end\n    for each i from 1 to 5\n        add_some(i)\n    end\n    return total\nend\nsay outer()",
  "to fact with n\n    to go with k\n        if k is at most 1\n            return 1\n        end\n        return k * go(k - 1)\n    end\n    return go(n)\nend\nsay fact(10)",
  "to a\n    to b\n        to c\n            fail with \"deep\"\n        end\n        c()\n    end\n    b()\nend\na()",
  "to f\n    return 1\nend\nset f to 3\nsay f\nto g\n    return 2\nend\nsay g()\nset h to g\nset g to 7\nsay h()",
  "set fs to empty list\nfor each i from 1 to 3\n    to show with x\n        return x * 10\n    end\n    add show to fs\nend\nfor each f in fs\n    say f(2)\nend",
  "to make with name\n    set greeting to \"hi \" + name\n    to say_it\n        return greeting\n    end\n    return say_it\nend\nset ps to list of make(\"a\"), make(\"b\")\nfor each p in ps\n    say p()\nend",
  "to loop_forever with n\n    return loop_forever(n + 1)\nend\nset f to loop_forever\nsay f(0)",
  "to apply with f, xs\n    set out to empty list\n    for each x in xs\n        add f(x) to out\n    end\n    return out\nend\nto sq with x\n    return x * x\nend\nsay apply(sq, (list of 1, 2, 3))\ntry\n    say apply(sq, (list of \"a\"))\nif it fails with why\n    say \"failed: \" + why\nend",
  "to outer with a\n    to mid with b\n        to inner with c\n            return a + b + c\n        end\n        return inner\n    end\n    return mid\nend\nset m to outer(1)\nset i to m(10)\nsay i(100)\nsay outer(2)(20)(200)",
  "to f\n    return 1\nend\nto g\n    return 1\nend\nset h to f\nsay f is f\nsay f is g\nsay h is f\nsay f is not g\nsay \"x\" + f\nsay length of f",
  "set base to 100\nto make\n    to get with k\n        return base + k\n    end\n    return get\nend\nset q to make()\nsay q(1)\nset base to 200\nsay q(1)",
  "to make\n    to bad\n        return missing_thing\n    end\n    return bad\nend\nset b to make()\ntry\n    say b()\nif it fails with why\n    say \"caught: \" + why\nend\nsay b()",
  "to make\n    to later\n        return v\n    end\n    set r to later()\n    set v to 3\n    return r\nend\nsay make()",
  "to make\n    set v to 1\n    to later\n        return v\n    end\n    set v to 2\n    return later\nend\nset m to make()\nsay m()",
  "to make with n\n    to go\n        if n is 0\n            return \"done\"\n        end\n        set n to n - 1\n        return go()\n    end\n    return go\nend\nset g to make(5)\nsay g()\nsay g()",
  "to k with x as a function\n    return x(2)\nend\nto dbl with y\n    return y * 2\nend\nsay k(dbl)\nsay k(5)",
  "set d to empty dictionary\nto f\n    return 1\nend\nset item \"a\" of d to f\nsay d\nsay item \"a\" of d\nset r to record with go f\nsay go of r\nset w to go of r\nsay w()",
  "to outer\n    to inner with a, b\n        return a * b\n    end\n    set results to empty list\n    for each i from 1 to 3\n        try\n            add inner(i) to results\n        if it fails with why\n            add why to results\n        end\n    end\n    return results\nend\nsay outer()",
  "to f with n\n    if n is 0\n        fail with \"bottom\"\n    end\n    return g(n - 1)\nend\nto g with n\n    set h to f\n    return h(n)\nend\nf(3)",
  // what comes from outside, with nothing given and nothing allowed: no arguments, no answer, and files and
  // sites refused
  "say arguments\nsay length of arguments\nset a to arguments\nadd 1 to a\nsay length of arguments\nsay a",
  "say \"before\"\nset name to ask \"What's your name?\"\nsay \"never\"",
  "to greet\n    return ask list of \"name\", 1\nend\ntry\n    say greet()\nif it fails with why\n    say \"failed: \" why\nend\nsay greet()",
  "for each name in list of \"in.txt\", \"https://example.com/x\", \"HTTP://a\", 5, nothing, list of 1\n    try\n        say read name\n    if it fails with why\n        say why\n    end\n    try\n        say read bytes name\n    if it fails with why\n        say why\n    end\nend\nfor each name in list of \"out.txt\", \"https://example.com/x\", yes\n    try\n        write \"x\" to name\n    if it fails with why\n        say why\n    end\nend\nwrite list of 1, 2 to \"out.txt\"",
  "to save with v\n    write v to \"keep.txt\"\nend\nsave(\"x\")",
  "say read bytes 3",
  // the error output, and the number a program ends with
  "say \"out 1\"\nsay \"err \" 1 + 1 \" \" list of 1, \"a\" to the error output\nsay \"out 2\"\nfor each i from 1 to 3\n    say i to the error output\n    say i * 10\nend\nsay \"\" to the error output\nsay \"é😀\\ttab\" to the error output",
  "say \"before\"\nstop the program\nsay \"after\"",
  "say \"a\"\nstop the program with 3",
  "to deep with n\n    if n is 0\n        try\n            stop the program with 7\n        if it fails\n            say \"caught\"\n        end\n    end\n    say n\n    deep(n - 1)\nend\nfor each i from 1 to 10\n    deep(5)\nend",
  "say \"x\" to the error output\nstop the program with 0.1 * 30",
  "stop the program with 255",
  "say 1\nstop the program with 256",
  "stop the program with -1",
  "stop the program with 2.5",
  "stop the program with \"2\"",
  "set codes to list of 1, 2\nstop the program with codes",
  "try\n    stop the program with nothing\nif it fails with why\n    say \"caught: \" why\n    stop the program with 4\nend",
  "set c to run program 5",
  "set c to run program \"x\" with 5",
  "set c to run program (list of 1)",
  "for each name in list of \"in.txt\", 5, nothing\n    try\n        remove the file name\n    if it fails with why\n        say why\n    end\nend\nremove the file \"nowhere.txt\"",
  // amounts with units: shown, converted, compared, added to, and every mistake they can make
  "say 1.0000000000000002 km\nsay -1 mile\nsay 0.999999999999999 miles\nsay 0.1 * 3 km\nsay 1 / 3 * 1 hour\nsay 3 hours / 0.5\nsay 1 inch in mm\nsay 1 tonne in pounds\nsay 1 week in seconds\nsay 1000000000000000000000 mm in km\nsay 0x10 kg in grams\nsay 28.349523125 grams in ounces\nsay -(1 hour) \" \" -(0 km)\nset l to list of 3 km, 1 mile, 1000 yards\nfor each x in l\n    say x in m\nend\nsay item 2 of l is 1 mile\nsay number of 5 km + 1",
  "set a to 1 km\nset b to 1000 m\nsay a is b\nsay a is not b\nsay a is at least b\nsay a is at most 999 m\nsay 2 km is less than 1 mile\nsay (list of 1 km) is (list of 1000 m)\nsay (record with d 1 km) is (record with d 1 km)\nsay 1 km is 1 kg\nsay 0 km is -0 km\nsay (1 km) is in (dictionary where 1 is 2)\nset t to \"x\"\nadd 5 km to t\nsay t\nsay \"a\" + 2 km\nsay 2 km + \"a\"\nsay join (list of 1 km, 2 hours) with \"; \"\nsay length of (5 km as text)\nsay 5 km - 300 m\nset trip to 1 mile\nfor each leg in list of 1 km, 500 yards, 3 feet\n    add leg to trip\nend\nsay trip\ntry\n    fail with 5 km\nif it fails with why\n    say why + 1 km\nend",
  "set total to 0\nadd 5 km to total",
  "say 0 - 1 km",
  "say 5 km is divisible by 1 km",
  "say 3 is in 5 km",
  "say 5 km bit and 1",
  "repeat 2 km times\n    say 1\nend",
  "say length of 5 km",
  "for each x in 2 km\n    say x\nend",
  "set d to dictionary where 1 km is 2",
  "say 5 km is in \"abc\"",
  "to f with x as a number\n    return x\nend\nsay f(5 km)",
  "say uppercase of 5 km",
  "stop the program with 5 km",
  "fail with 2 kg",
  "say 5 km - 1 kg",
  "say 2 / 4 km",
  "say 7 km * nothing",
  "say (5 km) / (0 - 0)",
  "for each i from 1 km to 3\n    say i\nend",
  "say item 1 of 5 km",
  "say name of 5 km",
  "move forward 5 km",
  "pen width 2 km",
  // tables' helpers on lists: total of, average of, largest of, smallest of, a column of records, and their mistakes
  "say total of (list of 1, 2, 3)\nsay average of (list of 1, 2, 4)\nsay largest of (list of 3, 9, 2)\nsay smallest of (list of 3, 9, 2)",
  "say total of empty list\nsay total of (list of nothing, 0.1, nothing, 0.2)\nsay largest of (list of \"pear\", \"apple\", \"Zebra\")\nsay smallest of (list of \"pear\", \"apple\", \"Zebra\")",
  "say total of (list of 5 km, 300 m)\nsay average of (list of 1 hour, 30 minutes)\nsay largest of (list of 1 km, 999 m, 1001 m)\nsay smallest of (list of 1 mile, 1 km)",
  "set week to list of (record with day \"Mon\", steps 4200), (record with day \"Tue\", steps 8100)\nsay steps in week\nsay total of steps in week\nsay average of steps in week\nsay largest of day in week",
  "say average of empty list",
  "say largest of empty list",
  "say smallest of (list of nothing)",
  "say total of 5",
  "say average of \"abc\"",
  "say total of (list of 1, \"a\")",
  "say total of (list of 1, 2 km)",
  "say total of (list of 2 km, 1)",
  "say total of (list of 2 km, 1 hour)",
  "say largest of (list of 1, \"a\")",
  "say smallest of (list of 1 km, 1 kg)",
  "say largest of (list of yes, no)",
  "set rows to list of (record with a 1), (record with b 2)\nsay total of a in rows",
  "set rows to 5\nsay total of a in rows",
  "set rows to list of 1, 2\nsay total of a in rows",
  "set rows to list of (record with price 1), (record with prise 2)\nsay total of price in rows",
  "say total of (list of 1, nothing, yes)",
  "say average of (list of 1, 2)\nsay average of (list of 0.1, 0.2)\nsay total of (list of 9007199254740992, 1, 1)",
  "say largest of (list of 0.1 + 0.2, 0.3)\nsay smallest of (list of 2, 2.0000000000000004, 1.9999999999999998)",
  // draw chart of: lists, dictionaries and amounts, and its mistakes
  "draw chart of (list of 1, 2)\npen color \"red\"\ndraw chart of (list of 3, -1.5, nothing, 0, 2.25)\nset d to dictionary where \"Mon\" is 4200, \"Tue\" is 8100\nremove \"Tue\" from d\nset item 7 of d to 100\ndraw chart of d\ndraw chart of (list of 5 km, 300 m, 1 mile)\ndraw chart of empty list\ndraw chart of (list of nothing, 0, 0)\nsay \"charted\"",
  "draw chart of 5",
  "draw chart of \"abc\"",
  "draw chart of (list of 1, \"a\")",
  "draw chart of (list of nothing, 1 km, 2)",
  "draw chart of (list of 1, 2 km)",
  "draw chart of (list of 1 km, 1 kg)",
  "draw chart of (dictionary where \"a\" is 1, \"b\" is yes)",
  "set week to list of (record with day \"Mon\", steps 4200), (record with day \"Tue\", steps 8100)\ndraw chart of steps in week\ndraw chart of day in week",
  // read the folder, refused as reading a file is, and its words still names
  "for each name in list of \"data\", 5, nothing, \"\"\n    try\n        say read the folder name\n    if it fails with why\n        say why\n    end\nend\nsay length of read the folder \".\"",
  "set the to \"x.txt\"\nset folder to 3\nsay read the\nsay folder",
  // checkboxes, text areas and lists, read before anything's clicked, and their mistakes (DESIGN §40)
  "draw list \"L\" showing (list of 1, \"two\", yes, nothing, list of 3) at 0, 0\nsay the choice in the list \"L\"\nsay the choice in the list \"M\"\nsay the checkbox \"x\" is ticked\ntick the checkbox \"x\"\nsay the checkbox \"x\" is ticked\nsay the checkbox \"x\" is not ticked\nuntick the checkbox \"x\"\nsay the checkbox \"x\" is ticked\nsay \"[\" + the text in the text area \"T\" + \"]\"\ndraw text area \"T\" at 0, 0\nclear\ndraw checkbox \"x\" at 10, 10\nsay the checkbox \"x\" is ticked",
  "set things to list of \"a\", \"b\"\ndraw list 5 showing things at 0, 0 size 100 by 48\nadd \"c\" to things\nsay the choice in the list 5\ndraw checkbox 2 at 0, 0\ndraw list 5 showing empty list at 0, 0 size 1 by 1\nsay \"done\"",
  "draw list \"L\" showing 5 at 0, 0",
  "draw list \"L\" showing (list of 1) at 0, 0 size 0 by 10",
  "draw list \"L\" showing (list of 1) at 0, 0 size 10 by -3.5",
  "draw text area \"T\" at 0, \"x\"",
  "draw text area \"T\" at 0, 0 size 0.001 by 5",
  "draw checkbox \"C\" at yes, 0",
  // dropdowns, sliders and choosing a file, away from a terminal (DESIGN §42)
  "set the slider \"S\" to 70.6\ndraw slider \"S\" from 10.4 to -5 at 0, 0\nsay the value of the slider \"S\"\nsay the value of the slider \"T\"\nset the slider \"S\" to -99\nsay the value of the slider \"S\"\nclear\nset the slider \"S\" to 99\nsay the value of the slider \"S\"\ndraw dropdown \"D\" showing (list of 3, \"x\") at 0, 0\nsay the choice in the dropdown \"D\"\nset choose to 2\nsay choose",
  "draw dropdown \"D\" showing 5 at 0, 0",
  "draw dropdown \"D\" showing (list of 1) at \"x\", 0",
  "draw slider \"S\" from 0 to \"x\" at 0, 0",
  "set the slider \"S\" to \"loud\"",
  "set the slider \"S\" to nothing",
  "set f to choose a file to open\nsay f",
  // a record made with its fields in its own block, then given more than it has room for (DESIGN §43)
  "set p to record with a 1, b 2\nset c of p to 3\nset d of p to 4\nset e of p to 5\nsay p\nsay a of p + e of p\nset q to record with a 1, b 2, c 3, d 4, e 5\nsay p is q\nset r to record with x 1, x 2\nsay r\nset big to record with f1 1, f2 2, f3 3, f4 4, f5 5, f6 6, f7 7, f8 8, f9 9\nset f10 of big to 10\nsay big\nset items to empty list\nfor each i from 1 to 2000\n    set item_record to record with n i, half i / 2\n    set extra of item_record to i * 3\n    add item_record to items\nend\nsay extra of item 2000 of items + n of item 1 of items",
  // what a function is given and gives, worked out across the program (DESIGN §48): given numbers in one call and
  // text in another, used as a value, fed fractions and infinities, ending without a return, and changing its input
  "to plus_one with x\n    return x + 1\nend\nsay plus_one(1)\nsay plus_one(2.5)\nsay plus_one(\"a\")\nsay plus_one(nothing)",
  "to twice with x\n    return x * 2\nend\nset g to twice\nsay twice(3)\nsay g(1.5)\nto apply with h, v\n    return h(v)\nend\nsay apply(twice, 4)\nsay apply(twice, \"a\")",
  "to fib with n\n    if n is less than 2\n        return n\n    end\n    return fib(n - 1) + fib(n - 2)\nend\nsay fib(10)\nsay fib(10.5)\nsay fib(0.1 + 0.2)\nsay fib(15) is 610\nsay fib(\"3\")",
  "to pick with n\n    if n is greater than 0\n        return n * 2\n    end\n    if n is 0\n        return \"zero\"\n    end\nend\nsay pick(2) + 1\nsay pick(0) + 1\nsay pick(-1)\nsay pick(-1) + 1",
  "to sq with n\n    return n * n\nend\nset huge to 1\nrepeat 200 times\n    set huge to huge * 10\nend\nsay sq(huge)\nsay sq(huge) - sq(huge)\nsay sq(huge) is sq(huge)\nsay sq(3) is 9\nsay sq(0.1) is 0.01\nto down with n\n    if n is less than 1\n        return n\n    end\n    return down(n / 2)\nend\nsay down(10)\nsay down(sq(huge))",
  "to is_even with n\n    if n is 0\n        return yes\n    end\n    return is_odd(n - 1)\nend\nto is_odd with n\n    if n is 0\n        return no\n    end\n    return is_even(n - 1)\nend\nsay is_even(10) \" \" is_odd(7) \" \" is_even(7)\nto count_down with n\n    set total to 0\n    repeat while n is greater than 0\n        add n to total\n        set n to n - 1\n    end\n    return total\nend\nsay count_down(100)\nsay count_down(2.5)\nto typed with n as a number\n    return n + 0.5\nend\nsay typed(1) + typed(2)\nsay is_even(2.5)",
  "to cube with x\n    return x * x * x\nend\nset total to 0\nfor each i from 1 to 10\n    add cube(i) to total\nend\nsay total\nset t to 0\nfor each i from 0.5 to 3\n    add cube(i) to t\nend\nsay t\nfor each w in list of 1, \"b\", 2.5\n    say cube(w)\nend",
  "set n to 1\nto change\n    set n to \"text\"\nend\nto show with v\n    return v + 1\nend\nsay show(n)\nchange()\nsay show(n)\nto shift_it with m\n    set m to \"x\" + m\n    return m\nend\nsay shift_it(1) + 1\nto divides with a, b\n    return a is divisible by b\nend\nsay divides(10, 5) \" \" divides(10, 3) \" \" divides(10, 0.5) \" \" divides(7.5, 2.5)\nsay divides(10, 0)",
  "to unused with n\n    return n + 1\nend\nto sum_to with n\n    if n is 0\n        return 0\n    end\n    return n + sum_to(n - 1)\nend\nsay sum_to(100)\nset results to empty list\nfor each k from 1 to 5\n    add sum_to(k) to results\nend\nsay results\nto nearly with a, b\n    return a is b\nend\nsay nearly(0.1 + 0.2, 0.3) \" \" nearly(3, 3) \" \" nearly(9007199254740993, 9007199254740992)\nto bigger with a, b\n    if a is greater than b\n        return a\n    end\n    return b\nend\nsay bigger(1, 2) + bigger(2.5, 1) + bigger(-3, -4)\nsay bigger(\"a\", \"b\")\nsay bigger(1, \"b\")",
  // functions put in line (DESIGN §63): sums in loops of whole numbers and past 2^53, mistakes inside with the
  // trail a call would show, a try around them, called before they're made, at the most calls there can be,
  // inputs that say what they must be, ones with no value yet, fields, items, lengths, comparisons, text,
  // early returns, an input that hides a name of the program's, used as a value too, and the wrong number of inputs
  "to square with x\n    return x * x\nend\nto mix with a, b\n    return a * 3 + b\nend\nset total to 0\nfor each i from 1 to 100000\n    add square(i) to total\nend\nsay total\nset t2 to 0\nfor each i from 1 to 1000\n    set t2 to t2 + mix(i, 7) - square(i - 1)\nend\nsay t2\nsay square(square(3))\nsay square(2.5)\nsay square(-0)\nset big to 0\nfor each i from 94906260 to 94906270\n    set big to square(i)\nend\nsay big",
  "to square with x\n    return x * x\nend\nto outer with v\n    return square(v) + 1\nend\ntry\n    say square(\"a\")\nif it fails with why\n    say \"caught: \" why\nend\nsay outer(4)\nsay outer(\"b\")",
  "say twice(2)\nto twice with x\n    return x * 2\nend",
  "to area with w as a number, h as a number\n    return w * h\nend\nsay area(3, 4)\nsay area(\"x\", 2)",
  "to square with x\n    return x * x\nend\nsay square(y)",
  "to name_of with p\n    return name of p\nend\nto first with xs\n    return item 1 of xs\nend\nto size with xs\n    return length of xs\nend\nto big with x\n    return x is greater than 10\nend\nto both with a, b\n    return a and not b\nend\nto greet with n\n    return \"Hi \" + n\nend\nto answer\n    return 42\nend\nset sam to record with name \"Sam\"\nsay name_of(sam) \" \" first(list of 5, 6) \" \" size(\"hello\") \" \" big(5) \" \" big(50) \" \" both(yes, no) \" \" greet(\"Bo\") \" \" answer()\nif big(11)\n    say \"big\"\nend\nsay first(empty list)",
  "to name_of with p\n    return name of p\nend\nto wrap with q\n    return name_of(q)\nend\nsay wrap(5)",
  "to square with x\n    return x * x\nend\nto down with n\n    if n is 0\n        return square(3)\n    end\n    return down(n - 1)\nend\nsay down(99998)\nsay down(99999)",
  "to half with x\n    return x / 2\nend\nto inv with x\n    return 1 / x\nend\nto work with n\n    set acc to 0\n    set k to 1\n    repeat while k is at most n\n        set acc to acc + half(k)\n        add 1 to k\n    end\n    return acc\nend\nsay work(100)\nsay inv(4)\nsay inv(0)",
  "to clamp with v, low, high\n    if v is less than low\n        return low\n    end\n    if v is greater than high\n        return high\n    end\n    return v\nend\nto bigger with a, b\n    if a is greater than b\n        return a\n    else\n        return b\n    end\nend\nto sign with x\n    if x is less than 0\n        return -1\n    end\n    if x is 0\n        return 0\n    end\n    return 1\nend\nto label with n\n    if n is 1\n        return \"one\"\n    end\n    return \"many\"\nend\nset total to 0\nfor each i from 1 to 2000\n    set total to total + clamp(i * 3 - 1000, 0, 5000) + bigger(i, 1000) + sign(i - 1000)\nend\nsay total\nsay label(1) \" \" label(2) \" \" clamp(2.5, 0, 1) \" \" bigger(\"b\", \"a\")\nsay clamp(\"x\", 0, 1)",
  "to pick with flag, a, b\n    if flag\n        return a\n    end\n    return b\nend\nsay pick(yes, 1, 2) \" \" pick(no, 1, 2) \" \" pick(nothing, 3, 4)\nsay pick(5, 1, 2)",
  "set x to 100\nto f with x\n    return x + 1\nend\nset g to f\nto work with n\n    set acc to 0\n    for each k from 1 to n\n        set acc to acc + f(k) * 2\n    end\n    return acc\nend\nsay f(1) \" \" g(2) \" \" work(1000) \" \" x\nset seen to empty list\nfor each i from 1 to 5\n    try\n        add f(item i of (list of 1, 2, \"a\", 4, nothing)) to seen\n    if it fails with why\n        add why to seen\n    end\nend\nsay seen\nsay f(1, 2)",
  // inputs in registers (DESIGN §63): one to five inputs, worked out by calls, a function also used as a value; and
  // lists and text where the code is (§64): items read, set and added, with every number that isn't one of a
  // list's; text joined to text, to digits and to anything else, in place and not, characters past one byte
  "to fib with n\n    if n is less than 2\n        return n\n    end\n    return fib(n - 1) + fib(n - 2)\nend\nto add3 with a, b, c\n    set t to a + b\n    return t + c\nend\nto four with a, b, c, d\n    say a \" \" b \" \" c \" \" d\n    return a * 1000 + b * 100 + c * 10 + d\nend\nto five with a, b, c, d, e\n    return a + b + c + d + e\nend\nto apply with g, v\n    return g(v)\nend\nto twice with x\n    set y to x * 2\n    return y\nend\nsay fib(20) \" \" add3(1, 2, 3) \" \" four(1, 2, 3, 4) \" \" five(1, 2, 3, 4, 5)\nsay add3(\"a\", \"b\", \"c\") \" \" four(add3(1, 1, 1), fib(5), 7, add3(0, 0, 9))\nsay apply(twice, 21)\nsay twice(4)\nsay add3(1, 2, nothing)",
  "set xs to empty list\nfor each i from 1 to 1000\n    add i * 2 to xs\nend\nset total to 0\nfor each i from 1 to length of xs\n    set total to total + item i of xs\nend\nsay total\nset item 3 of xs to \"three\"\nsay item 3 of xs \" \" item (0.1 * 30) of xs \" \" item 1000 of xs\nset d to dictionary where \"a\" is 1\nset item \"b\" of d to 2\nsay item \"a\" of d + item \"b\" of d\nset t to \"hello\"\nsay item 2 of t\nset bs to 4 bytes\nset item 2 of bs to 7\nsay item 2 of bs\nto grow with l\n    add 5 to l\n    return 9\nend\nset ys to list of 1, 2, 3\nset item 2 of ys to grow(ys)\nsay ys\nfor each bad in list of 0, 4.5, -1, 1001, \"x\", nothing\n    try\n        say item bad of xs\n    if it fails with why\n        say why\n    end\n    try\n        set item bad of xs to 1\n    if it fails with why\n        say why\n    end\nend\nset zs to empty list\nrepeat 10 times\n    add zs to zs\nend\nsay length of zs\nset n to 5\ntry\n    add 1 to n\n    add \"a\" to xs\n    say length of xs \" \" item 1001 of xs\n    add 1 to nothing_here\nif it fails with why\n    say why\nend\nsay item 1 of 5",
  "set s to \"\"\nfor each i from 1 to 300\n    add \"ab\" to s\n    add \"é😀\" to s\nend\nsay length of s \" \" item 3 of s \" \" item 600 of s\nset base to \"hello\"\nset a to base + \" world\"\nset b to base + \" there\"\nsay a \" | \" b \" | \" base\nset c to a + \"\"\nset d to \"\" + b\nsay c \" \" d \" \" length of c \" \" length of d\nset e to \"\"\nfor each i from 1 to 1000\n    set e to e + i\nend\nsay length of e\nset parts to empty list\nfor each i from 1 to 2000\n    set t to \"x\" + \"é\" + i\n    add t to parts\nend\nsay item 1999 of parts \" \" length of (join parts with \",\")\nset big to \"0123456789\"\nrepeat 12 times\n    set big to big + big\nend\nsay length of big\nset f to big\nadd \"!\" to f\nadd \"?\" to big\nsay length of f \" \" length of big \" \" item 40961 of f \" \" item 40961 of big\nsay \"a\" + 1 + 2 \" \" 1 + 2 + \"a\" \" \" \"x\" + yes \" \" \"x\" + nothing\nsay \"😀\" is \"😀\" \" \" \"ab\" + \"c\" is \"abc\"",
  "say \"x\" + 0 \" \" \"x\" + (0 * -1) \" \" 7 + \"y\" \" \" \"a\" + 123456789012345 + \"b\" + -999999999999999 \" \" \"n\" + 1000000000000000 \" \" \"n\" + 0.5 \" \" \"n\" + -3.25\nsay \"n\" + 99999999999999.99 \" \" \"n\" + 9007199254740993 \" \" \"big\" + 1e300 \" \" \"nan\" + (1 / 3)\nset s to \"k\"\nfor each i from -5 to 5\n    set s to s + i + \",\"\nend\nsay s\nset t to 5\nadd \"!\" to t",
  "say 0 \" \" 1 \" \" 9 \" \" 10 \" \" 99 \" \" 100 \" \" 12345678901234567890 \" \" 18446744073709551615 \" \" 1e21 \" \" 123.456 \" \" -7 \" \" 9007199254740991\nfor each i from 1 to 30\n    say i * 123456789 \" \" (i * 7) as text \" \" \"x\" + i * 99999999\nend\nsay 1000000 * 1000000 \" \" 0.1 + 0.2 \" \" 1 / 3\nsay \"a\" + 18446744073709551615 + \"b\"",
  "set parts to list of \"a\", \"é\", \"😀x\", \"\", 5, 2.5, yes, nothing, (list of 1, \"q\"), \"end\"\nset j to join parts with \"–\"\nsay j \" \" length of j\nset w to \"\"\nrepeat 50 times\n    add \"aé😀bcdefgh\" to w\nend\nsay length of w \" \" length of (w + w) \" \" item 99 of w\nset many to empty list\nfor each i from 1 to 3000\n    add \"word\" + i to many\nend\nset joined to join many with \", \"\nsay length of joined \" \" item 20 of joined\nsay split \"a,b,,c\" by \",\"\nsay join (empty list) with \"x\"\nsay join (list of \"only\") with \", \"",
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
    const makers = [];
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
      const names = [...params, ...vars.slice(0, random(2))];
      // sometimes a function made inside it, which uses its variables, and which it hands back
      const inner = chance(0.3) ? `${name}_in` : null;
      if (inner) lines.push(`    to ${inner} with r`, ...block(2, [...names, "r"], 1, false, true), "    end");
      lines.push(...block(1, names, 0, false, true));
      if (inner) {
        lines.push(`    return ${inner}`);
        makers.push([name, params.length]);
      }
      lines.push("end");
    }
    // what those hand back, and a function in a variable, called like any
    makers.forEach(([f, n], i) => {
      lines.push(`set m${i} to ${f}(${Array.from({ length: n }, () => value(1, vars)).join(", ")})`);
      fns.push([`m${i}`, 1]);
    });
    if (fns.length && chance(0.3)) {
      const [f, n] = pick(fns);
      lines.push(`set v to ${f}`);
      fns.push(["v", n]);
    }
    lines.push(...block(0, vars, 0, false, false));
    return lines.join("\n");
  }
  return Array.from({ length: count }, program);
}
