# Read and write CSV

`text.moth` reads CSV the way spreadsheets write it, quotes and commas inside them included, and writes it
back. `csv_rows` gives a list of rows, each a list of text; `csv_text` makes CSV from rows.

```moth
use "text.moth" as text

set rows to list of (list of "name", "city", "score"), (list of "Ada", "London", 91), (list of "Lee, Ana", "Lisbon", 78)
write text's csv_text(rows) to "scores.csv"

set table to text's csv_rows(read "scores.csv")
for each row in items 2 to (length of table) of table
    say item 1 of row + " from " + item 2 of row + " scored " + item 3 of row
end
```

```output
Ada from London scored 91
Lee, Ana from Lisbon scored 78
```

Every value comes back as text. `number of` makes a number of one, so the scores can be added up:

```moth
use "text.moth" as text

set table to text's csv_rows("name,score\nAda,91\nLee,78\nSam,85")
set total to 0
for each row in items 2 to (length of table) of table
    add number of item 2 of row to total
end
say "average: " + (total / (length of table - 1) with 1 decimals)
```

```output
average: 84.7
```
