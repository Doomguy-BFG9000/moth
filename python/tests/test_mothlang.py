"""mothlang against the moth it finds: the one in the wheel, or MOTHLANG_MOTH's."""

from __future__ import annotations

import math
import os
import subprocess
import sys
import threading
from pathlib import Path

import pytest

import mothlang as moth

FAST = '''set calls to 0

to fib with n
    if n is less than 2
        return n
    end
    return fib(n - 1) + fib(n - 2)
end

to echo with x
    return x
end

to greet with name
    add 1 to calls
    return "Hello, " + name + "! (" + calls + ")"
end

to total_of with numbers
    set sum to 0
    for each x in numbers
        set sum to sum + x
    end
    return sum
end

to divide with a, b
    if b is 0
        fail with "can't divide " + a + " by 0"
    end
    return a / b
end

to point with x, y
    return record with x x, y y
end

to adder with n
    return function with m gives n + m
end

to doubled with n as a number
    return n * 2
end

to depth with n
    if n is 0
        return 0
    end
    return 1 + depth(n - 1)
end

to count_to with n
    set counted to 0
    for each k from 1 to n
        set counted to counted + 1
    end
    return counted
end

to fails_with_a_record
    fail with record with code 7
end
'''


@pytest.fixture(scope="module")
def fast(tmp_path_factory: pytest.TempPathFactory) -> moth.Library:
    os.environ["MOTHLANG_CACHE"] = str(tmp_path_factory.mktemp("cache"))
    return moth.compile(FAST, name="fast.moth")


def test_run_says_and_fails() -> None:
    said = moth.run('say "Hello from Moth"\nsay 1 + 2')
    assert (said.output, said.errors, said.status, said.ok) == ("Hello from Moth\n3\n", "", 0, True)
    failed = moth.run("set xs to list of 1, 2\nsay item 3 of xs\n")
    assert failed.status == 1
    assert failed.output == ""
    assert failed.errors.startswith("program.moth:2:5: there is no item 3, the list only has 2 items")
    stopped = moth.run("stop the program with 4")
    assert stopped.status == 4


def test_run_takes_arguments_input_and_flags(tmp_path: Path) -> None:
    said = moth.run('say arguments\nset name to ask "Name?"\nsay "Hi " + name', ["a", "b c"], input="Sam\n")
    assert said.output == '["a", "b c"]\nName? Sam\nHi Sam\n'  # the answer shown, as it wasn't typed at a terminal
    (tmp_path / "data.txt").write_text("from a file", encoding="utf-8")
    read = moth.run('say read "data.txt"', allow=["read"], cwd=tmp_path)
    assert read.output == "from a file\n"


def test_numbers_text_and_the_rest_both_ways(fast: moth.Library) -> None:
    assert fast.fib(20) == 6765
    assert isinstance(fast.fib(20), int)
    for value in [0, -3, 2.5, 1e300, -0.25, 2**53, True, False, None, "", "Wörld 😀", b"\x00\x01\xfe\xff",
                  [1, 2, 3], [1.5, "two", [3, None]], {"a": 1, "b": [2, 3]}, {1: "one", 2.5: "two and a half"},
                  [], {}]:
        assert fast.echo(value) == value, value
    assert fast.echo((1, 2)) == [1, 2]
    assert math.isnan(fast.echo(float("nan")))
    assert fast.echo(float("inf")) == float("inf")
    assert fast.echo(3.0) == 3 and isinstance(fast.echo(3.0), int)
    assert fast.total_of(list(range(1, 101))) == 5050
    assert fast.total_of([0.5] * 4) == 2
    assert fast.greet("Sam") == "Hello, Sam! (1)"
    assert fast.greet("Ana") == "Hello, Ana! (2)"  # its top level's variables last from call to call


def test_records_and_functions(fast: moth.Library) -> None:
    p = fast.point(3, "four")
    assert isinstance(p, moth.Record)
    assert (p.x, p["y"], list(p), len(p)) == (3, "four", ["x", "y"], 2)
    assert repr(p) == "Record(x=3, y='four')"
    with pytest.raises(AttributeError):
        p.z
    add_ten = fast.adder(10)
    assert isinstance(add_ten, moth.Value) and add_ten.is_function
    assert add_ten(5) == 15
    assert fast.echo(add_ten)(1) == 11  # given back to Moth, and back again
    with pytest.raises(moth.MothError, match="needs 1 input but got 2"):
        add_ten(1, 2)


def test_mistakes_are_exceptions_with_where_they_were(fast: moth.Library) -> None:
    with pytest.raises(moth.MothError) as caught:
        fast.divide(1, 0)
    err = caught.value
    assert (err.message, err.line, err.column, err.file, err.value) == ("can't divide 1 by 0", 29, 9, "fast.moth", "can't divide 1 by 0")
    assert str(err) == "fast.moth:29:9: can't divide 1 by 0"
    with pytest.raises(moth.MothError, match="can only go through a list"):
        fast.total_of(3)
    with pytest.raises(moth.MothError) as caught:
        fast.doubled("x")
    assert (caught.value.message, caught.value.line) == ("'doubled' needs n to be a number, not text", None)
    with pytest.raises(moth.MothError) as caught:
        fast.fails_with_a_record()
    assert caught.value.value == moth.Record({"code": 7})
    with pytest.raises(TypeError, match=r"fib\(\) takes 1 input \(n\), not 2"):
        fast.fib(1, 2)
    with pytest.raises(OverflowError):
        fast.echo(2**60)
    with pytest.raises(TypeError, match="no kind of value for set"):
        fast.echo({1, 2})
    with pytest.raises(TypeError, match="keys are text or numbers"):
        fast.echo({(1, 2): 3})
    with pytest.raises(AttributeError, match="has no function called 'nope'"):
        fast.nope
    assert fast.fib(10) == 55  # and it goes on


def test_what_a_library_has(fast: moth.Library) -> None:
    assert list(fast.functions) == ["fib", "echo", "greet", "total_of", "divide", "point", "adder", "doubled", "depth",
                                    "count_to", "fails_with_a_record"]
    assert fast.divide.inputs == ["a", "b"]
    assert "fib" in dir(fast)
    assert repr(fast.fib) == "<Moth function fib(n)>"


def test_deep_recursion_and_threads(fast: moth.Library) -> None:
    assert fast.depth(50000) == 50000
    with pytest.raises(moth.MothError, match="too much recursion"):
        fast.depth(200000)
    results: list[int] = []

    def work() -> None:
        for _ in range(50):
            results.append(fast.count_to(1000))

    threads = [threading.Thread(target=work) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert results == [1000] * 400


def test_built_once_and_cached(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MOTHLANG_CACHE", str(tmp_path / "cache"))
    (tmp_path / "helper.moth").write_text("to helped with x\n    return x + 1\nend\n", encoding="utf-8")
    (tmp_path / "main.moth").write_text('use "helper.moth"\n\nto twice_helped with x\n    return helped(x) * 2\nend\n',
                                        encoding="utf-8")
    first = moth.load(tmp_path / "main.moth")
    assert first.twice_helped(1) == 4
    assert list(first.functions) == ["twice_helped"]
    assert moth.load(tmp_path / "main.moth") is first
    libraries = list((tmp_path / "cache").glob("*/*main*"))
    (tmp_path / "helper.moth").write_text("to helped with x\n    return x + 2\nend\n", encoding="utf-8")
    changed = moth.load(tmp_path / "main.moth")  # a file it uses changed: built again
    assert changed.twice_helped(1) == 6
    assert len(list((tmp_path / "cache").glob("*/*main*"))) > len(libraries)
    assert sorted(p.name for p in tmp_path.iterdir()) == ["cache", "helper.moth", "main.moth"]  # nothing beside them


def test_a_mistake_in_the_code_is_a_build_error(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MOTHLANG_CACHE", str(tmp_path))
    with pytest.raises(moth.BuildError) as caught:
        moth.compile("to f with x\n    return x +\nend\n", name="broken.moth")
    assert (caught.value.line, caught.value.file) == (3, "broken.moth")
    with pytest.raises(moth.BuildError, match="a library can't stop the program"):
        moth.compile("to f\n    stop the program\nend\n")
    top = moth.compile("to f\n    return 1\nend\nsay item 2 of (list of 1)\n", name="top.moth")
    with pytest.raises(moth.MothError, match="there is no item 2"):
        top.f()


def test_the_moth_command(tmp_path: Path) -> None:
    (tmp_path / "hi.moth").write_text('say "hi"\n', encoding="utf-8")
    ran = subprocess.run([sys.executable, "-m", "mothlang", "run", "hi.moth"], cwd=tmp_path, capture_output=True,
                         text=True)
    assert (ran.stdout, ran.returncode) == ("hi\n", 0)
