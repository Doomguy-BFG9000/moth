"""Finding the moth command: the one in the wheel, or one named by MOTHLANG_MOTH, or one on PATH."""

from __future__ import annotations

import os
import shutil
import sys
import sysconfig
from pathlib import Path

__all__ = ["moth_binary", "MothNotFound"]

_EXE = "moth.exe" if sys.platform == "win32" else "moth"


class MothNotFound(RuntimeError):
    """Raised when there is no moth command to run: a wheel for this system bundles one."""


def _is_native(path: Path) -> bool:
    """Whether a file is a program of moth's own (ELF or PE), not the `moth` script pip made for this package."""
    try:
        with open(path, "rb") as f:
            head = f.read(4)
    except OSError:
        return False
    if sys.platform == "win32":
        # pip's launcher is a PE too, but it lives in this Python's Scripts folder, which is skipped below
        return head[:2] == b"MZ"
    return head == b"\x7fELF"


def moth_binary() -> Path:
    """Where the moth command is: $MOTHLANG_MOTH, else the one bundled in this package, else `moth` on PATH."""
    named = os.environ.get("MOTHLANG_MOTH")
    if named:
        path = Path(named)
        if not path.is_file():
            raise MothNotFound(f"MOTHLANG_MOTH names {named}, which isn't a file")
        return path
    bundled = Path(__file__).resolve().parent / "bin" / _EXE
    if bundled.is_file():
        if sys.platform != "win32" and not os.access(bundled, os.X_OK):
            try:  # a wheel unpacked by a tool that dropped its mode
                bundled.chmod(0o755)
            except OSError:
                pass
        return bundled
    scripts = Path(sysconfig.get_path("scripts")).resolve()
    found = shutil.which("moth")
    if found:
        path = Path(found).resolve()
        if path.parent != scripts and _is_native(path):
            return path
    raise MothNotFound(
        "no moth command: install a wheel of mothlang built for this system (Windows or Linux, x86-64), "
        "or set MOTHLANG_MOTH to where moth is"
    )
