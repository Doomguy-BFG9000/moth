# mothlang: Moth from Python

[Moth](https://github.com/samyyy2423/moth) is a programming language that reads like plain English and
compiles to machine code. `mothlang` lets Python use it: run Moth programs, and call a Moth file's
functions straight from Python, compiled, for speed.

```text
pip install mothlang
```

Wheels are for Windows and Linux on x86-64, and each has `moth` itself in it, so there's nothing else to
install. They also give you the `moth` command.

## Call Moth for speed

Write the slow part in Moth:

```moth
# fast.moth
to fib with n
    if n is less than 2
        return n
    end
    return fib(n - 1) + fib(n - 2)
end
```

and call it from Python:

```python
import mothlang as moth

fast = moth.load("fast.moth")
print(fast.fib(30))      # 832040, 10 to 13 times as fast as the same function in Python
```

`moth.load` builds the file into a shared library (a `.so` on Linux, a `.dll` on Windows) the first time,
and keeps it in a cache, named by a hash of the file and the files it uses, so it's built again only when
one of them changes. `moth.compile(source)` does the same for Moth code in a string. Each function the
file makes at its top level is then a function of the library, called through plain `ctypes`: no compiled
Python extension, and no Python version it's tied to.

### Values

| Python                  | Moth                                     |
|-------------------------|------------------------------------------|
| `int`, `float`          | a number (a double: an `int` past 2^53 is an `OverflowError`) |
| `str`                   | text                                     |
| `bool`                  | yes or no                                |
| `None`                  | nothing                                  |
| `bytes`, `bytearray`    | bytes                                    |
| `list`, `tuple`         | a list                                   |
| `dict`                  | a dictionary (its keys text or numbers)  |
| `mothlang.Record`       | a record, from Moth: read as `p.x` or `p["x"]`; given back, a dictionary |
| `mothlang.Value`        | anything else, a function say, which can be given back, and called |

A number Moth gives back is an `int` when it's whole, and a `float` when it isn't. A list of numbers
goes across all at once, not an item at a time.

### Mistakes

A mistake in Moth raises `mothlang.MothError`, with Moth's message and where it happened:

```python
try:
    fast.fib("thirty")
except moth.MothError as err:
    print(err.message, err.line, err.column, err.file)
```

`fail with` in Moth raises it too, with what it failed with in `err.value`. Code that can't be built
raises `mothlang.BuildError`, with moth's report of it.

### Threads

Any thread can call a library's functions. One call runs Moth at a time, and the others wait their turn;
`ctypes` lets go of Python's lock while Moth runs, so other Python threads go on meanwhile. Every call
runs on the library's own stack, so recursion goes as deep in a call from a thread as in Moth itself.

A library's top level runs once, the first time it's called, and its variables last from call to call.

## Run Moth

```python
result = moth.run('say "Hello from Moth"')
print(result.output)     # Hello from Moth
print(result.errors)     # what it said to the error output, a mistake's report among it
print(result.status)     # the number it ended with: 0, or 1 for a mistake
```

`moth.run(source, ["arguments"], allow=["read"], input="typed\n", cwd="folder")` runs it as
`moth run` does, as a program of its own, with arguments, `--allow` flags, what it reads as typed, and the
folder it runs in (where the files it `use`s are found).

## The command

The wheel installs `moth`, Moth's own command line: `moth run hello.moth`, `moth build hello.moth`,
`moth build fast.moth --library`, the Moth shell, and the rest. `python -m mothlang` is the same.

## Speed

`benchmarks/bench.py`, in the source, times each function called from Python against the same function in
pure Python ([benchmarks/RESULTS.md](https://github.com/samyyy2423/moth/blob/main/python/benchmarks/RESULTS.md)
has Windows too):

| on Linux, x86-64, Python 3.13   | Python   | Moth    |        |
|---------------------------------|---------:|--------:|-------:|
| `fib(30)`                       | 52.6 ms  | 5.3 ms  | 10×    |
| `mandelbrot(400, 300)`          | 355.8 ms | 19.3 ms | 18×    |
| `primes_below(5,000,000)`       | 296.3 ms | 84.1 ms | 3.5×   |
| `total_of` a list of 1,000,000  | 11.3 ms  | 21.9 ms | 0.5×   |

A call costs one or two microseconds, most of it `ctypes`' own, and a value that goes across is copied.
Moth is worth it for work that's done in it, not for a sum over a list Python already has.

## Where things are

- `MOTHLANG_CACHE`: where built libraries are kept (else `~/.cache/mothlang`, or
  `%LOCALAPPDATA%\mothlang\Cache` on Windows).
- `MOTHLANG_MOTH`: a `moth` to use instead of the wheel's own.

Moth is Apache-2.0 licensed. Its language, its standard library and how the library is built are described
in [its repository](https://github.com/samyyy2423/moth).
