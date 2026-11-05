# Find and change text

`text.moth`'s patterns are regular expressions: `\d` a digit, `\w` a letter, digit or _, `+` one or more, and
the rest. In Moth's own text, a `\` is written `\\`.

```moth
use "text.moth" as text

set log to "2026-11-05 ERROR disk full\n2026-11-05 INFO started\n2026-11-06 ERROR no network"
for each line in split log by "\n"
    if text's contains_pattern("ERROR", line)
        say text's replace_all("^[\\d-]+ ERROR ", line, "problem: ")
    end
end

say text's matches("^[a-z.]+@[a-z]+\\.[a-z]+$", "ada.l@moth.dev")
set found to text's find("(\\d+) of (\\d+)", "page 12 of 40")
say item 1 of groups of found + " and " + item 2 of groups of found
```

```output
problem: disk full
problem: no network
yes
12 and 40
```

Counting words needs no library at all: a dictionary keeps a count for each.

```moth
set counts to empty dictionary
for each word in split (lowercase of "The moth and the lamp and the night") by " "
    if word is in counts
        set item word of counts to item word of counts + 1
    else
        set item word of counts to 1
    end
end
say counts
```

```output
(dictionary where "the" is 3, "moth" is 1, "and" is 2, "lamp" is 1, "night" is 1)
```
