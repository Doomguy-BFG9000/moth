#!/bin/sh
# Makes a release's moth-linux, moth-windows.exe and SHA256SUMS.txt from this checkout, as DESIGN.md says a
# release is made, and checks the fixed point on the way: Node.js makes the first moth from the source, that
# moth builds itself into the same bytes, and it builds the Windows moth into the bytes Node.js makes of it.
# (That the Windows moth builds itself and the Linux one byte for byte is checked on Windows, by the release
# workflow.)
#
#     packaging/release-build.sh <folder>
#
# Given a release's files too, it checks they're the same bytes, so a release made by hand is one this source
# makes:
#
#     packaging/release-build.sh <folder> <folder with the release's files>
set -eu

if [ $# -lt 1 ] || [ $# -gt 2 ]; then
    echo "usage: $0 <folder> [folder with a release's files to compare]" >&2
    exit 2
fi
mkdir -p "$1"
out=$(cd "$1" && pwd)
release=
if [ $# -eq 2 ]; then release=$(cd "$2" && pwd); fi
cd "$(dirname "$0")/.."
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
self="moth.moth --allow-read --allow-write --allow-run --include moth-debugger.moth"

node bootstrap.mjs linux
mv moth "$work/moth-first"

# moth, built by the moth Node.js made, must be the same bytes
# shellcheck disable=SC2086 # $self is words
"$work/moth-first" build $self
cmp moth "$work/moth-first" || { echo "moth built itself into different bytes from the ones Node.js made" >&2; exit 1; }
mv moth "$out/moth-linux"

# shellcheck disable=SC2086
"$work/moth-first" build $self --target windows
mv moth.exe "$out/moth-windows.exe"
node bootstrap.mjs windows
cmp moth.exe "$out/moth-windows.exe" || { echo "moth built the Windows moth into different bytes from the ones Node.js made" >&2; exit 1; }
rm moth.exe

# as the releases have them: the Windows program's sum, then Linux's
(cd "$out" && sha256sum moth-windows.exe moth-linux > SHA256SUMS.txt)
cat "$out/SHA256SUMS.txt"

if [ -n "$release" ]; then
    (cd "$release" && sha256sum -c SHA256SUMS.txt) || { echo "the release's files don't match its SHA256SUMS.txt" >&2; exit 1; }
    for file in moth-linux moth-windows.exe; do
        if ! cmp "$out/$file" "$release/$file"; then
            echo "the release's $file isn't what this source builds: it must be made with moth build $self" >&2
            exit 1
        fi
    done
    echo "the release's moth-linux and moth-windows.exe are the bytes this source builds"
fi
