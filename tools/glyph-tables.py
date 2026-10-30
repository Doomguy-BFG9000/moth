# Writes the glyph tables machine.moth draws text with on Linux, between the two lines that mark them in
# machine.moth, from DejaVu Sans and DejaVu Sans Mono: each character drawn by FreeType, through Pillow,
# at 16 pixels to the em, the size of what's written on buttons and in boxes, and DejaVu Sans at 24 too, to
# draw text of other sizes from. The fonts are where Debian and Ubuntu keep them, or wherever the two arguments
# say: python tools/glyph-tables.py [DejaVuSans.ttf DejaVuSansMono.ttf]
import base64
import struct
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

CHARS = list(range(32, 127)) + list(range(160, 256)) + [0xFFFD]
START = "# ---------- DejaVu's letters: made by tools/glyph-tables.py ----------"
END = "# ---------- the end of DejaVu's letters ----------"
NOTICE = """DejaVu Sans and DejaVu Sans Mono: Copyright (c) 2003 by Bitstream, Inc. All Rights Reserved. \
Bitstream Vera is a trademark of Bitstream, Inc. DejaVu changes are in public domain. \
Permission is hereby granted, free of charge, to any person obtaining a copy of the fonts accompanying this \
license ("Fonts") and associated documentation files (the "Font Software"), to reproduce and distribute the \
Font Software, including without limitation the rights to use, copy, merge, publish, distribute, and/or sell \
copies of the Font Software, and to permit persons to whom the Font Software is furnished to do so, subject \
to the following conditions: The above copyright and trademark notices and this permission notice shall be \
included in all copies of one or more of the Font Software typefaces. The Font Software may be modified, \
altered, or added to, and in particular the designs of glyphs or characters in the Fonts may be modified and \
additional glyphs or characters may be added to the Fonts, only if the fonts are renamed to names not \
containing either the words "Bitstream" or the word "Vera". This License becomes null and void to the extent \
applicable to Fonts or Font Software that has been modified and is distributed under the "Bitstream Vera" \
names. The Font Software may be sold as part of a larger software package but no copy of one or more of the \
Font Software typefaces may be sold by itself. THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY \
KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A \
PARTICULAR PURPOSE AND NONINFRINGEMENT OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL \
BITSTREAM OR THE GNOME FOUNDATION BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, INCLUDING ANY GENERAL, \
SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, \
ARISING FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM OTHER DEALINGS IN THE FONT \
SOFTWARE. Except as contained in this notice, the names of Gnome, the Gnome Foundation, and Bitstream Inc., \
shall not be used in advertising or otherwise to promote the sale, use or other dealings in this Font \
Software without prior written authorization from the Gnome Foundation or Bitstream Inc., respectively. For \
further information, contact: fonts at gnome dot org."""


def table(path, em):
    font = ImageFont.truetype(str(path), em)
    ascent, descent = font.getmetrics()
    heads = b""
    ink = bytearray()
    for cp in CHARS:
        ch = chr(cp)
        advance = font.getlength(ch)
        left, top, right, bottom = font.getbbox(ch, anchor="ls")
        width, height = max(0, right - left), max(0, bottom - top)
        start = len(ink)
        if width and height:
            img = Image.new("L", (width, height), 0)
            ImageDraw.Draw(img).text((-left, -top), ch, font=font, fill=255, anchor="ls")
            px = img.load()
            for y in range(height):
                row = bytearray((width + 1) // 2)
                for x in range(width):
                    v = (px[x, y] * 15 + 127) // 255
                    row[x // 2] |= v << (4 * (x % 2))
                ink += row
        assert -128 <= left <= 127 and -128 <= -top <= 127 and width < 256 and height < 256 and start < 1 << 24
        heads += struct.pack("<I", cp)[:3] + struct.pack("<HbbBB", round(advance * 64), left, -top, width, height)
        heads += struct.pack("<I", start)[:3]
    return b"MF" + bytes([em, ascent, descent]) + struct.pack("<H", len(CHARS)) + heads + bytes(ink)


def moth_lines(name, data):
    text = base64.b64encode(data).decode()
    lines = [text[i:i + 100] for i in range(0, len(text), 100)]
    return f"set {name} to list of " + ",\n    ".join(f'"{line}"' for line in lines)


def main():
    folder = Path("/usr/share/fonts/truetype/dejavu")
    sans, mono = sys.argv[1:3] if len(sys.argv) > 2 else (folder / "DejaVuSans.ttf", folder / "DejaVuSansMono.ttf")
    notice = NOTICE.replace("\\", "\\\\").replace('"', '\\"')
    block = "\n".join([
        START,
        "# DejaVu Sans at 16 and 24 pixels to the em, and DejaVu Sans Mono at 16: the glyph tables rt_fb_text draws",
        "# text with on Linux, as base64, 100 characters a line. A table is \"MF\", the em, the ascent and descent and",
        "# how many glyphs (2 bytes); then 12 bytes for each: its character (3 bytes), its advance in 64ths of a pixel",
        "# (2), its picture's left and top from where it's drawn, the top going up (1 each, signed), its width and",
        "# height (1 each), and where its ink starts among the ink bytes (3); then the ink, 4 bits a pixel, the left",
        "# one in a byte's low half, each row starting on a byte of its own. Its characters are 32 to 126, 160 to 255",
        "# and U+FFFD, for any other. dejavu_notice is the fonts' licence, which goes into a program with them.",
        moth_lines("dejavu_sans16_lines", table(sans, 16)),
        moth_lines("dejavu_sans24_lines", table(sans, 24)),
        moth_lines("dejavu_mono16_lines", table(mono, 16)),
        f'set dejavu_notice to "{notice}"',
        END,
    ])
    file = Path(__file__).resolve().parent.parent / "machine.moth"
    source = file.read_text(encoding="utf8")
    start, end = source.find(START), source.find(END)
    if start < 0 or end < 0:
        raise SystemExit("machine.moth has no place marked for DejaVu's letters")
    file.write_text(source[:start] + block + source[end + len(END):], encoding="utf8", newline="\n")
    print(f"{len(CHARS)} characters in each table, written to machine.moth")


if __name__ == "__main__":
    main()
