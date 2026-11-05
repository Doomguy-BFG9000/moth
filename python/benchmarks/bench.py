"""A Moth function called from Python, against the same function in pure Python.

    python benchmarks/bench.py

Each is timed as the best of a few runs; Moth's time includes the call from Python and converting what
goes in and out. The library is built (or found in the cache) before the timing starts."""

from __future__ import annotations

import platform
import sys
import time
from pathlib import Path
from typing import Any, Callable

import mothlang as moth


def fib(n: int) -> int:
    if n < 2:
        return n
    return fib(n - 1) + fib(n - 2)


def primes_below(n: int) -> int:
    sieve = [True] * n
    found = 0
    for k in range(2, n):
        if sieve[k]:
            found += 1
            for m in range(k * k, n, k):
                sieve[m] = False
    return found


def mandelbrot(width: int, height: int) -> int:
    inside = 0
    for row in range(height):
        for col in range(width):
            cr = col / width * 3 - 2
            ci = row / height * 2 - 1
            zr = zi = 0.0
            rounds = 0
            while rounds < 100 and zr * zr + zi * zi <= 4:
                zr, zi = zr * zr - zi * zi + cr, 2 * zr * zi + ci
                rounds += 1
            if rounds == 100:
                inside += 1
    return inside


def total_of(numbers: list[float]) -> float:
    total = 0
    for x in numbers:
        total += x
    return total


def best(f: Callable[..., Any], *inputs: Any, runs: int = 3) -> tuple[float, Any]:
    times = []
    for _ in range(runs):
        start = time.perf_counter()
        gave = f(*inputs)
        times.append(time.perf_counter() - start)
    return min(times), gave


def main() -> None:
    fast = moth.load(Path(__file__).with_name("fast.moth"))
    numbers = [i * 0.5 for i in range(1_000_000)]
    cases = [
        ("fib(30)", "fib", (30,)),
        ("primes_below(5,000,000)", "primes_below", (5_000_000,)),
        ("mandelbrot(400, 300)", "mandelbrot", (400, 300)),
        ("total_of(a list of 1,000,000)", "total_of", (numbers,)),
    ]
    print(f"Python {platform.python_version()} on {platform.system()} {platform.machine()}, {platform.processor() or ''}".rstrip(", "))
    print(f"{'':32} {'Python':>10} {'Moth':>10} {'faster':>8}")
    for title, name, inputs in cases:
        python_time, python_gave = best(globals()[name], *inputs)
        moth_time, moth_gave = best(getattr(fast, name), *inputs)
        assert python_gave == moth_gave, (title, python_gave, moth_gave)
        print(f"{title:32} {python_time * 1000:8.1f}ms {moth_time * 1000:8.1f}ms {python_time / moth_time:7.1f}x")
    calls = 100_000
    start = time.perf_counter()
    for _ in range(calls):
        fast.fib(1)
    each = (time.perf_counter() - start) / calls
    print(f"a call from Python, with a number in and out: {each * 1e9:.0f} ns")


if __name__ == "__main__":
    sys.exit(main())
