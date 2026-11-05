# Moth exercises

Twenty small problems to practise Moth with, from `hello-world` up, each with tests to make pass. They're in
[Exercism](https://exercism.org)'s track format, so they can become a Moth track there one day; for now, they
work on their own.

## How to do one

1. [Install Moth](../README.md#start-in-a-minute), and copy an exercise's folder, `practice/leap` say.
2. Read its `.docs/instructions.md`.
3. Run `moth test` in the folder. Every test fails at first: the file to write, `leap.moth`, has only the
   functions' first lines.
4. Write the functions in `leap.moth` until every test passes.

`.meta/example.moth` is one way to do it, kept for the tests that check the exercises themselves: try not to
look until yours passes.

| Exercise | What it practises |
|:--|:--|
| hello-world | a function that gives back text |
| two-fer | an input that can be left out |
| leap | `is divisible by`, and the order of `if`s |
| raindrops | building text |
| bob | text: capitals, the last character, spaces |
| isogram | lists, and `is in` |
| pangram | going through the letters |
| word-count | dictionaries |
| anagram | sorting with `in order` |
| acronym | the start of each word |
| hamming | comparing two texts, and `fail with` |
| rna-transcription | a dictionary as a table |
| difference-of-squares | arithmetic |
| collatz-conjecture | `repeat while` |
| armstrong-numbers | digits, and `to the power of` |
| reverse-string | text, backwards |
| matching-brackets | a list as a stack |
| clock | `remainder of`, and numbers written with two digits |
| sieve | a dictionary as a set, without dividing |
| luhn | going from the right |

Each exercise's tests are run with its example solution, and with its starting file, every time Moth changes
(`guides.test.js`), so the exercises keep working as the language grows.
