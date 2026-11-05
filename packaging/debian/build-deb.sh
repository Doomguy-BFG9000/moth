#!/bin/sh
# Builds moth_<version>_amd64.deb, for Debian and Ubuntu, from a release's moth-linux, with dpkg-deb:
#
#     packaging/debian/build-deb.sh moth-linux 1.11.0 [folder]
#
# moth goes to /usr/bin/moth as it is, byte for byte, so the package holds the same program the release
# does, and its copyright and notices to /usr/share/doc/moth. moth is one static program, so the package
# depends on nothing; it suggests git and curl, which moth add, get and search run, and OpenSSL 3, which a
# program moth builds loads for a secure connection. Every file's time is SOURCE_DATE_EPOCH (else the time of
# this repository's last commit), so the same moth-linux and version make the same .deb on the same dpkg.
set -eu

if [ $# -lt 2 ] || [ $# -gt 3 ]; then
    echo "usage: $0 <moth-linux> <version> [folder]" >&2
    exit 2
fi
binary=$1
version=$2
out=${3:-.}
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)

if ! printf '%s\n' "$version" | grep -Eqx '[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?'; then
    echo "'$version' isn't a version like 1.11.0 or 1.12.0-rc.1" >&2
    exit 2
fi
# a pre-release's 1.12.0-rc.1 is Debian's 1.12.0~rc.1, which comes before 1.12.0
debian_version=$(printf '%s' "$version" | tr '-' '~')
if [ ! -f "$binary" ]; then
    echo "there's no file called '$binary'" >&2
    exit 1
fi
# an x86-64 Linux program: ELF's 7f 45 4c 46, 64-bit (02), and machine 0x3e at byte 18
magic=$(od -An -tx1 -N20 "$binary" | tr -d ' \n')
case $magic in
    7f454c4602*) ;;
    *) echo "'$binary' isn't a 64-bit Linux program (moth-linux)" >&2; exit 1 ;;
esac
if [ "$(printf %s "$magic" | cut -c37-40)" != "3e00" ]; then
    echo "'$binary' isn't for x86-64" >&2
    exit 1
fi
if [ -z "${SOURCE_DATE_EPOCH:-}" ]; then
    SOURCE_DATE_EPOCH=$(git -C "$repo" log -1 --format=%ct 2> /dev/null || date +%s)
fi
export SOURCE_DATE_EPOCH

umask 022
root=$(mktemp -d)
chmod 0755 "$root"
trap 'rm -rf "$root"' EXIT
mkdir -p "$root/DEBIAN" "$root/usr/bin" "$root/usr/share/doc/moth"
cp "$binary" "$root/usr/bin/moth"
chmod 0755 "$root/usr/bin/moth"

# Debian's machine-readable copyright file: Moth under Apache 2.0 (which Debian keeps in common-licenses), with
# its NOTICE, and the DejaVu letters in machine.moth under their own license, in full
{
    cat << 'END'
Format: https://www.debian.org/doc/packaging-manuals/copyright-format/1.0/
Upstream-Name: Moth
Upstream-Contact: https://github.com/samyyy2423/moth/issues
Source: https://github.com/samyyy2423/moth
Comment:
END
    sed -e 's/^$/./' -e 's/^/ /' "$repo/NOTICE"
    cat << 'END'

Files: *
Copyright: 2026 Samyak Pudke
 2003 Bitstream, Inc.
License: Apache-2.0 and Bitstream-Vera
Comment: Moth is under the Apache License 2.0. The glyph tables moth draws text
 with, which a program it builds for Linux carries, are drawn from DejaVu Sans
 and DejaVu Sans Mono (https://dejavu-fonts.github.io/), under the Bitstream
 Vera license below; DejaVu changes are in the public domain.

License: Apache-2.0
 Licensed under the Apache License, Version 2.0 (the "License"); you may not
 use this file except in compliance with the License. You may obtain a copy
 of the License at http://www.apache.org/licenses/LICENSE-2.0
 .
 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
 WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
 License for the specific language governing permissions and limitations
 under the License.
 .
 On Debian systems, the full text of the Apache License 2.0 is in
 /usr/share/common-licenses/Apache-2.0.

License: Bitstream-Vera
END
    sed -e 's/^$/./' -e 's/^/ /' "$repo/LICENSE-DejaVu"
} > "$root/usr/share/doc/moth/copyright"

# Installed-Size: KiB, each file rounded up, and one for each folder, as dpkg-gencontrol counts it
size=$(cd "$root" && find usr -type f -exec stat -c %s {} + | awk '{ k += int(($1 + 1023) / 1024) } END { print k }')
folders=$(cd "$root" && find usr -type d | wc -l)
cat > "$root/DEBIAN/control" << END
Package: moth
Version: $debian_version
Architecture: amd64
Maintainer: Samyak Pudke <workitsam01@gmail.com>
Installed-Size: $((size + folders))
Suggests: git, curl, libssl3t64 | libssl3
Section: devel
Priority: optional
Homepage: https://github.com/samyyy2423/moth
Description: programming language that reads like plain English
 Moth is a programming language that reads like plain English, small enough
 to learn in an afternoon. moth runs a program, builds it into a Linux or
 Windows program of its own as fast as C, and has a shell, a debugger, tests,
 packages, a language server and a standard library from web servers and
 databases to pictures and encryption.
 .
 moth is one static program. moth add, get and update run git, moth search
 runs curl, and a program that makes a secure connection loads OpenSSL 3.
END
(cd "$root" && find usr -type f -print0 | LC_ALL=C sort -z | xargs -0 md5sum) > "$root/DEBIAN/md5sums"
chmod 0644 "$root/DEBIAN/control" "$root/DEBIAN/md5sums" "$root/usr/share/doc/moth/copyright"
find "$root" -exec touch -h -d "@$SOURCE_DATE_EPOCH" {} +

mkdir -p "$out"
deb="$out/moth_${version}_amd64.deb"
dpkg-deb --root-owner-group -Zxz --build "$root" "$deb" > /dev/null
echo "made $deb ($(stat -c %s "$deb") bytes)"
