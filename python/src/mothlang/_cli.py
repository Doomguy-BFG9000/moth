"""The `moth` command a wheel installs: moth itself, the one bundled in the wheel, given the same arguments."""

from __future__ import annotations

import subprocess
import sys

from ._binary import MothNotFound, moth_binary


def main() -> int:
    try:
        binary = moth_binary()
    except MothNotFound as err:
        print(f"moth: {err}", file=sys.stderr)
        return 127
    try:
        return subprocess.call([str(binary), *sys.argv[1:]])
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    sys.exit(main())
