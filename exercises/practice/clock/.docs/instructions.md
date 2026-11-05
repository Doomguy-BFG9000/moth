# Clock

Write `clock_at`, which takes hours and minutes and gives back the time a 24-hour clock shows, as `hh:mm`.
Minutes past 59 go on into the hours, hours past 23 come round again from 0, and taking time away goes back
past midnight: `clock_at(25, 160)` is `03:40`, and `clock_at(1, -40)` is `00:20`.

Then write `plus_minutes`, which takes the hours, minutes and how many minutes to add (or take away, when
it's less than 0), and gives back the time as `clock_at` does.
