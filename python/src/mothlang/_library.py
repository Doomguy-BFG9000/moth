"""A Moth library loaded with ctypes: its functions, called straight through the C ABI, and values converted
both ways through its value API (see DESIGN §128 and §129 in Moth's repository)."""

from __future__ import annotations

import ctypes
import math
import struct
from array import array
from collections.abc import Callable, Iterator, Mapping
from pathlib import Path
from typing import Any

__all__ = ["Library", "MothError", "Record", "Value"]

_u64 = ctypes.c_uint64
_i64 = ctypes.c_int64
_int = ctypes.c_int
_double = ctypes.c_double
_result = ctypes.POINTER(_u64)

# a value's own 8 bytes, as moth.h's moth_value: nothing, no and yes are NaNs arithmetic never makes
_NOTHING = 0x7FF8000000000001
_NO = 0x7FF8000000000002
_YES = 0x7FF8000000000003
_UNSET = 0x7FF8000000000004
_NAN = 0x7FF8000000000000
_TAG_TEXT = 0xFFF9

# what moth_kind says a value is
_OTHER, _NUMBER, _TEXT, _YES_OR_NO, _NOTHING_KIND, _LIST, _RECORD, _DICTIONARY, _BYTES, _FUNCTION = range(10)

# a value's kind from the top 16 bits of one in memory
_KIND_OF_TAG = {0xFFF9: _TEXT, 0xFFFA: _LIST, 0xFFFB: _RECORD, 0xFFFC: _DICTIONARY, 0xFFFD: _BYTES, 0xFFFE: _FUNCTION}

_LARGEST_EXACT = 2**53
_pack_double = struct.Struct("<d").pack
_unpack_double = struct.Struct("<d").unpack
_pack_bits = struct.Struct("<Q").pack
_unpack_bits = struct.Struct("<Q").unpack


def _number_bits(x: float) -> int:
    if x != x:  # every NaN the one NaN numbers have
        return _NAN
    return _unpack_bits(_pack_double(x))[0]


def _number_of_bits(v: int) -> float:
    return _unpack_double(_pack_bits(v))[0]


def _kind(bits: int) -> int:
    """What moth_kind says, worked out here, as a call to C costs more than the sum"""
    top = bits >> 48
    if top < _TAG_TEXT:
        if _NOTHING <= bits <= _UNSET:
            return _NOTHING_KIND if bits == _NOTHING else _OTHER if bits == _UNSET else _YES_OR_NO
        return _NUMBER
    return _KIND_OF_TAG.get(top, _OTHER)


def _python_number(n: float) -> int | float:
    return int(n) if n.is_integer() and -_LARGEST_EXACT <= n <= _LARGEST_EXACT else n


class MothError(Exception):
    """A mistake in Moth code: its message, and where it was (line and column from 1, and the file), or None
    for each when it was made outside the program (a wrong kind of input, say). `value` is what `fail with`
    gave, converted as anything Moth gives Python is."""

    def __init__(self, message: str, line: int | None = None, column: int | None = None, file: str | None = None,
                 value: Any = None) -> None:
        self.message = message
        self.line = line
        self.column = column
        self.file = file
        self.value = value
        super().__init__(message)

    def __str__(self) -> str:
        if self.line is None:
            return self.message
        return f"{self.file}:{self.line}:{self.column}: {self.message}"


class Record(Mapping[str, Any]):
    """A Moth record: its fields, in order, read as attributes (`p.x`) or by name (`p["x"]`). Given back to
    Moth, it's a dictionary, as C can't make Moth's records."""

    __slots__ = ("_fields",)

    def __init__(self, fields: dict[str, Any]) -> None:
        object.__setattr__(self, "_fields", dict(fields))

    def __getattr__(self, name: str) -> Any:
        try:
            return self._fields[name]
        except KeyError:
            raise AttributeError(f"the record has no field '{name}'") from None

    def __setattr__(self, name: str, value: Any) -> None:
        raise AttributeError("a record from Moth can't be changed")

    def __getitem__(self, name: str) -> Any:
        return self._fields[name]

    def __iter__(self) -> Iterator[str]:
        return iter(self._fields)

    def __len__(self) -> int:
        return len(self._fields)

    def __eq__(self, other: object) -> bool:
        if isinstance(other, Record):
            return self._fields == other._fields
        return NotImplemented

    def __hash__(self) -> int:
        return hash(tuple(self._fields))

    def __repr__(self) -> str:
        return "Record(" + ", ".join(f"{k}={v!r}" for k, v in self._fields.items()) + ")"


class Value:
    """A Moth value Python has no kind for (a function, an amount), kept for Moth until it's no longer used.
    It can be given back to Moth, and a function can be called."""

    __slots__ = ("_library", "_bits", "__weakref__")

    def __init__(self, library: "Library", bits: int) -> None:
        self._library = library
        self._bits = bits

    @property
    def is_function(self) -> bool:
        return _kind(self._bits) == _FUNCTION

    def __call__(self, *inputs: Any) -> Any:
        library = self._library
        made: list[int] = []
        try:
            listed = library._to_moth(list(inputs), made)
            return library._given(library._api.moth_call, self._bits, listed)
        finally:
            library._free_all(made)

    def __del__(self) -> None:
        library = getattr(self, "_library", None)
        if library is not None and library._api is not None:
            try:
                library._api.moth_free(self._bits)
            except Exception:
                pass

    def __repr__(self) -> str:
        return "<Moth function>" if self.is_function else "<Moth value>"


_API: list[tuple[str, Any, list[Any]]] = [
    ("moth_number", _u64, [_double]),
    ("moth_number_of", _double, [_u64]),
    ("moth_yes_or_no", _u64, [_int]),
    ("moth_kind", _int, [_u64]),
    ("moth_text_utf8", ctypes.c_void_p, [_u64, ctypes.POINTER(_i64)]),
    ("moth_bytes_data", ctypes.c_void_p, [_u64, ctypes.POINTER(_i64)]),
    ("moth_list_length", _i64, [_u64]),
    ("moth_list_numbers", _i64, [_u64, ctypes.c_void_p, _i64]),
    ("moth_exports", ctypes.c_char_p, []),
    ("moth_start", _int, [_result]),
    ("moth_text", _int, [_result, ctypes.c_char_p, _i64]),
    ("moth_bytes", _int, [_result, ctypes.c_char_p, _i64]),
    ("moth_numbers", _int, [_result, ctypes.c_void_p, _i64]),
    ("moth_list", _int, [_result]),
    ("moth_list_add", _int, [_result, _u64, _u64]),
    ("moth_list_item", _int, [_result, _u64, _i64]),
    ("moth_dictionary", _int, [_result]),
    ("moth_dictionary_set", _int, [_result, _u64, _u64, _u64]),
    ("moth_dictionary_get", _int, [_result, _u64, _u64]),
    ("moth_dictionary_keys", _int, [_result, _u64]),
    ("moth_record_names", _int, [_result, _u64]),
    ("moth_record_values", _int, [_result, _u64]),
    ("moth_call", _int, [_result, _u64, _u64]),
    ("moth_keep", _int, [_result, _u64]),
    ("moth_free", None, [_u64]),
]


class _Api:
    """The value API's functions, typed for ctypes."""

    def __init__(self, dll: ctypes.CDLL) -> None:
        for name, restype, argtypes in _API:
            f = getattr(dll, name)
            f.restype = restype
            f.argtypes = argtypes
            setattr(self, name, f)


class Function:
    """One of a Moth library's functions, called straight through the C ABI."""

    def __init__(self, library: "Library", name: str, inputs: list[str]) -> None:
        self.__name__ = name
        self.__qualname__ = name
        self.name = name
        self.inputs = inputs
        self.__doc__ = f"{name}({', '.join(inputs)}), a function of {library.path.name}"
        self._library = library
        c_function = getattr(library._dll, name)
        c_function.restype = _int
        c_function.argtypes = [_result] + [_u64] * len(inputs)
        self._c = c_function
        self._count = len(inputs)

    def __call__(self, *inputs: Any, _float: type = float, _int: type = int, _pack: Any = _pack_double,
                 _unpack: Any = _unpack_bits, _byref: Any = ctypes.byref, _top: int = _TAG_TEXT) -> Any:
        if len(inputs) != self._count:
            raise TypeError(f"{self.name}() takes {self._count} input{'' if self._count == 1 else 's'} "
                            f"({', '.join(self.inputs)}), not {len(inputs)}")
        made: list[int] = []
        given = []
        for x in inputs:  # numbers here, as they're most of what's given, and the rest by _to_moth
            kind = type(x)
            if (kind is _float and x == x) or (kind is _int and -_LARGEST_EXACT <= x <= _LARGEST_EXACT):
                given.append(_unpack(_pack(x))[0])
            else:
                given.append(self._library._to_moth(x, made))
        result = _u64()
        status = self._c(_byref(result), *given)
        bits = result.value
        if status == 0 and bits >> 48 < _top and not _NOTHING <= bits <= _UNSET and not made:
            n = _unpack_double(_pack_bits(bits))[0]
            return int(n) if n.is_integer() and -_LARGEST_EXACT <= n <= _LARGEST_EXACT else n
        library = self._library
        try:
            try:
                if status == 0:
                    return library._to_python(bits)
                raise library._mistake(bits)
            finally:
                library._free(bits)
        finally:
            if made:
                library._free_all(made)

    def __repr__(self) -> str:
        return f"<Moth function {self.name}({', '.join(self.inputs)})>"


class Library:
    """A Moth program made a shared library, loaded: each of its top-level functions is an attribute,
    called with Python values and giving one back. A mistake in Moth raises MothError."""

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self._dll = ctypes.CDLL(str(self.path))
        self._api: _Api | None = _Api(self._dll)
        self.functions: dict[str, Function] = {}
        for line in self._api.moth_exports().decode("utf-8").splitlines():
            if line:
                name, *inputs = line.split("\t")
                self.functions[name] = Function(self, name, inputs)

    def __getattr__(self, name: str) -> Function:
        functions = self.__dict__.get("functions", {})
        if name in functions:
            return functions[name]
        raise AttributeError(f"{self.path.name} has no function called '{name}'")

    def __dir__(self) -> list[str]:
        return sorted(set(super().__dir__()) | set(self.functions))

    def __repr__(self) -> str:
        return f"<Moth library {self.path.name}: {', '.join(self.functions)}>"

    # ---------- calls ----------

    def _given(self, c_function: Callable[..., int], *inputs: int) -> Any:
        """Calls a function shaped `int f(moth_value *result, ...)`: what it gave, or its mistake raised."""
        result = _u64(0)
        status = c_function(ctypes.byref(result), *inputs)
        given = result.value
        try:
            if status == 0:
                return self._to_python(given)
            raise self._mistake(given)
        finally:
            self._free(given)

    def _made(self, c_function: Callable[..., int], *inputs: Any) -> int:
        """Calls a value API function that makes a value: its bits, which the caller frees."""
        result = _u64(0)
        status = c_function(ctypes.byref(result), *inputs)
        if status != 0:
            mistake = self._mistake(result.value)
            self._free(result.value)
            raise mistake
        return result.value

    def _free(self, bits: int) -> None:
        if (bits >> 48) >= _TAG_TEXT:
            self._api.moth_free(bits)

    def _free_all(self, made: list[int]) -> None:
        free = self._api.moth_free
        for bits in reversed(made):
            free(bits)

    def _mistake(self, record: int) -> MothError:
        fields = self._to_python(record)
        if not isinstance(fields, Record):
            return MothError(str(fields))
        message = fields.get("message")
        return MothError(message if isinstance(message, str) else str(message), fields.get("line"),
                         fields.get("column"), fields.get("file"), fields.get("value"))

    # ---------- Python to Moth ----------

    def _to_moth(self, x: Any, made: list[int]) -> int:
        """x as a Moth value's bits; each value made in Moth's memory is added to `made`, to be freed."""
        api = self._api
        if x is None:
            return _NOTHING
        if x is True:
            return _YES
        if x is False:
            return _NO
        if isinstance(x, float):
            return _number_bits(x)
        if isinstance(x, int):
            if not -_LARGEST_EXACT <= x <= _LARGEST_EXACT:
                raise OverflowError(f"{x} is too big for a Moth number, which is a double: give a float")
            return _number_bits(float(x))
        if isinstance(x, str):
            data = x.encode("utf-8")
            bits = self._made(api.moth_text, data, len(data))
            made.append(bits)
            return bits
        if isinstance(x, (bytes, bytearray, memoryview)):
            data = bytes(x)
            bits = self._made(api.moth_bytes, data, len(data))
            made.append(bits)
            return bits
        if isinstance(x, Value):
            if x._library is not self:
                raise ValueError("a Moth value can only go back to the library it came from")
            return x._bits
        if isinstance(x, (list, tuple)):
            kinds = set(map(type, x))
            if kinds and kinds <= {float, int} and (int not in kinds or -_LARGEST_EXACT <= min(x) and max(x) <= _LARGEST_EXACT):
                numbers = array("d", x)  # a list of numbers, all at once
                where, count = numbers.buffer_info()
                bits = self._made(api.moth_numbers, where, count)
                made.append(bits)
                return bits
            bits = self._made(api.moth_list)
            made.append(bits)
            for item in x:
                self._made(api.moth_list_add, bits, self._to_moth(item, made))
            return bits
        if isinstance(x, Mapping):
            bits = self._made(api.moth_dictionary)
            made.append(bits)
            for key, item in x.items():
                if isinstance(key, bool) or not isinstance(key, (str, int, float)):
                    raise TypeError(f"a Moth dictionary's keys are text or numbers, not {type(key).__name__}")
                self._made(api.moth_dictionary_set, bits, self._to_moth(key, made), self._to_moth(item, made))
            return bits
        raise TypeError(f"Moth has no kind of value for {type(x).__name__}: give a number, text, yes or no "
                        "(a bool), None, bytes, a list or a dictionary")

    # ---------- Moth to Python ----------

    def _to_python(self, bits: int) -> Any:
        api = self._api
        kind = _kind(bits)
        if kind == _NUMBER:
            return _python_number(_number_of_bits(bits))
        if kind == _TEXT:
            length = _i64(0)
            where = api.moth_text_utf8(bits, ctypes.byref(length))
            return ctypes.string_at(where, length.value).decode("utf-8", errors="replace") if length.value else ""
        if kind == _YES_OR_NO:
            return bits == _YES
        if kind == _NOTHING_KIND:
            return None
        if kind == _BYTES:
            length = _i64(0)
            where = api.moth_bytes_data(bits, ctypes.byref(length))
            return ctypes.string_at(where, length.value) if length.value else b""
        if kind == _LIST:
            return self._list(bits)
        if kind == _DICTIONARY:
            keys = self._made(api.moth_dictionary_keys, bits)
            try:
                made = {}
                for key_bits in self._items(keys):
                    value_bits = self._made(api.moth_dictionary_get, bits, key_bits)
                    try:
                        made[self._to_python(key_bits)] = self._to_python(value_bits)
                    finally:
                        self._free(value_bits)
                return made
            finally:
                self._free(keys)
        if kind == _RECORD:
            names = self._made(api.moth_record_names, bits)
            values = self._made(api.moth_record_values, bits)
            try:
                return Record(dict(zip(self._list(names), self._list(values))))
            finally:
                self._free(names)
                self._free(values)
        # anything else stays Moth's, kept once more, as `bits` is freed by whoever gave it
        return Value(self, self._made(api.moth_keep, bits))

    def _items(self, list_bits: int) -> Iterator[int]:
        """Each item of a Moth list, as bits that are freed once the next is asked for."""
        api = self._api
        for i in range(api.moth_list_length(list_bits)):
            item = self._made(api.moth_list_item, list_bits, i)
            try:
                yield item
            finally:
                self._free(item)

    def _list(self, bits: int) -> list[Any]:
        api = self._api
        length = api.moth_list_length(bits)
        if length > 0:  # a list of numbers, all at once
            numbers = array("d", bytes(8 * length))
            if api.moth_list_numbers(bits, numbers.buffer_info()[0], length) == length:
                return [_python_number(n) for n in numbers.tolist()]
        return [self._to_python(item) for item in self._items(bits)]


# NaN and infinity are numbers to Moth, as to Python
assert math.isnan(_number_of_bits(_NAN))
