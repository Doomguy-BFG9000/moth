# What the benchmark gave

`python benchmarks/bench.py`: each of [fast.moth](fast.moth)'s functions called from Python through mothlang,
against the same function written in Python in [bench.py](bench.py), each the best of three runs. Moth's
time includes the call from Python and converting what goes in and what comes out. CI runs it on every push
(the `python` workflow's last step); these are from GitHub's own runners, on 5 November 2026, with the
wheel built from this repository.

Linux (Ubuntu, x86-64), Python 3.13.17:

| function                        | Python   | Moth    | Moth is   |
|---------------------------------|---------:|--------:|----------:|
| `fib(30)`                       | 52.6 ms  | 5.3 ms  | 10.0×     |
| `primes_below(5,000,000)`       | 296.3 ms | 84.1 ms | 3.5×      |
| `mandelbrot(400, 300)`          | 355.8 ms | 19.3 ms | 18.5×     |
| `total_of` a list of 1,000,000  | 11.3 ms  | 21.9 ms | 0.5×      |

A call with a number in and one out: 1.7 µs.

Windows Server, x86-64 (AMD), Python 3.12.10:

| function                        | Python   | Moth    | Moth is   |
|---------------------------------|---------:|--------:|----------:|
| `fib(30)`                       | 66.1 ms  | 5.0 ms  | 13.2×     |
| `primes_below(5,000,000)`       | 329.6 ms | 58.1 ms | 5.7×      |
| `mandelbrot(400, 300)`          | 300.1 ms | 18.7 ms | 16.1×     |
| `total_of` a list of 1,000,000  | 13.4 ms  | 22.6 ms | 0.6×      |

A call with a number in and one out: 1.5 µs.

What it says: work done in Moth, function calls and arithmetic in loops, is 10 to 18 times as fast as in
Python. A call costs a microsecond or two, most of it ctypes' own, and a value given to Moth is copied, so
handing Moth a million numbers just to add them up is slower than Python's own loop: the copy costs more
than the sum. The sieve is in between, as Moth's list of yes and no is a list of values, each 8 bytes.
