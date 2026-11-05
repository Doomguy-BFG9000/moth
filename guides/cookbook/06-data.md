# Numbers, statistics and a chart

`stats.moth` has what Python's statistics module has, and `charts.moth` draws bars and lines to SVG or PNG.
A week of temperatures, summed up and drawn:

```moth
use "stats.moth" as stats
use "charts.moth" as charts

set days to list of "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"
set temperatures to list of 12.5, 14, 13.2, 17.8, 19.4, 21, 18.6

say "mean " + (stats's mean(temperatures) with 1 decimals) + "°C"
say "median " + stats's median(temperatures) + "°C"
say "standard deviation " + (stats's stdev(temperatures) with 2 decimals)
set warmest to 1
for each k from 2 to length of temperatures
    if item k of temperatures is greater than item warmest of temperatures
        set warmest to k
    end
end
say "warmest " + item warmest of temperatures + "°C, on " + item warmest of days

charts's save(charts's line_chart("A week of temperatures", days, temperatures), "week.svg")
say "drew week.svg"
```

```output
mean 16.6°C
median 17.8°C
standard deviation 3.36
warmest 21°C, on Sat
drew week.svg
```

Numbers in Moth are decimals compared to 15 digits, as a spreadsheet keeps them, so money adds up as it
should:

```moth
set prices to list of 0.1, 0.2, 19.99
set total to 0
for each p in prices
    set total to total + p
end
say total
say 0.1 + 0.2 is 0.3
```

```output
20.29
yes
```
