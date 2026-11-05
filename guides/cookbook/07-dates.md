# Dates

`dates.moth` reads dates, adds days, counts the days between two, and writes a date as a person wants it.

```moth
use "dates.moth" as dates

set start to dates's read_date("2026-11-05")
set due to dates's add_days(start, 30)
say "due " + dates's format_date(due, "dddd D MMMM YYYY")
say dates's days_between(start, due) + " days from " + dates's format_date(start, "ddd D MMM")
say "a weekend day: " + (dates's format_date(due, "ddd") is in list of "Sat", "Sun")
```

```output
due Saturday 5 December 2026
30 days from Thu 5 Nov
a weekend day: yes
```

`dates's now()` is the date and time it is now, and `format_date` writes hours, minutes and seconds too:
`dates's format_date(dates's now(), "YYYY-MM-DD hh:mm:ss")`.
