# Collatz Conjecture

Take a whole number above 0. If it's even, halve it; if it's odd, times it by 3 and add 1. Do that again and
again, and it seems you always reach 1, though nobody has proved it.

Write `steps`, which says how many steps it takes to reach 1: 1 takes 0, and 12 takes 9. A number of 0 or less
can't start: fail with `only positive whole numbers are allowed`.
