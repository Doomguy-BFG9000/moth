// Pictures from files, for `draw picture "cat.png" at x, y`: PNG and BMP files made into pixels here, by
// Moth's own code, so every engine and the playground get the same pixels and the same mistakes. machine.moth
// has the same decoder in machine code, written step for step as this one, so a broken file is broken in the
// same place, for the same reason, there too (see DESIGN §37).
//
// decodePicture(data, name, error) gives { width, height, pixels }: pixels has 4 bytes for each pixel, red,
// green, blue and how opaque it is (0 to 255, not multiplied in), row by row from the top. `name` is the
// file's name, for a mistake, or null for bytes the program had already.

export const MOST_PIXELS = 4096 * 4096; // 64 MB of pixels

// why a PNG or a BMP is broken, as a mistake says it
const ENDS = "it ends too soon";
const CHECKSUM = "a chunk's checksum is wrong";
const HEADER = "its header is wrong";
const DAMAGED = "its pixel data is damaged";
const PALETTE = "a pixel's colour isn't in its palette";

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const [IHDR, PLTE, TRNS, IDAT, IEND] = ["IHDR", "PLTE", "tRNS", "IDAT", "IEND"].map((t) => [...t].reduce((n, c) => n * 256 + c.charCodeAt(0), 0));
// the bit depths each PNG colour type may have: grey, -, red green blue, palette, grey and alpha, -, all four
const DEPTHS = [[1, 2, 4, 8, 16], [], [8, 16], [1, 2, 4, 8], [8, 16], [], [8, 16]];
const CHANNELS = [1, 0, 3, 1, 2, 0, 4];
// Adam7: where each of an interlaced PNG's seven passes starts across and down, and how far apart its pixels are
const ADAM7 = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]];
const BMP_HEADERS = [40, 52, 56, 108, 124]; // BITMAPINFOHEADER and the ones that grew from it

let crcTable = null;
function crc32(data, from, count) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = from; i < from + count; i++) crc = crcTable[(crc ^ data[i]) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const u32 = (d, at) => d[at] * 0x1000000 + d[at + 1] * 0x10000 + d[at + 2] * 0x100 + d[at + 3]; // highest byte first, as PNG has them
const le16 = (d, at) => d[at] + d[at + 1] * 0x100; // lowest byte first, as BMP has them
const le32 = (d, at) => d[at] + d[at + 1] * 0x100 + d[at + 2] * 0x10000 + d[at + 3] * 0x1000000;

export function decodePicture(data, name, error) {
  const [subject, is, isnt] = name === null ? ["these bytes", "are", "aren't"] : [`'${name}'`, "is", "isn't"];
  const broken = (kind, reason) => error(`${subject} ${is} a broken ${kind}: ${reason}`);
  const tooBig = () => error(`${subject} ${is} too big to draw: more than ${MOST_PIXELS.toLocaleString("en")} pixels (4096 by 4096)`);
  if (data.length >= 8 && PNG_SIGNATURE.every((b, i) => data[i] === b)) return png(data, (reason) => broken("PNG", reason), tooBig);
  if (data.length >= 2 && data[0] === 66 && data[1] === 77) { // BM
    return bmp(data, (reason) => broken("BMP", reason), tooBig, () => error(`${subject} ${is} a kind of BMP Moth can't read`));
  }
  return error(`${subject} ${isnt} a PNG or BMP picture`);
}

// ---------- PNG ----------

function png(d, broken, tooBig) {
  const n = d.length;
  let p = 8;
  let chunks = 0;
  let width = 0;
  let height = 0;
  let depth = 0;
  let type = 0;
  let interlaced = 0;
  let palette = -1; // where the palette's colours start, and how many there are
  let colours = 0;
  let trns = -1; // where tRNS's data starts, and how long it is
  let trnsLength = 0;
  const pieces = []; // each IDAT's data: where it starts and how long it is
  let packed = 0;
  for (;;) {
    if (n - p < 12) broken(ENDS); // a chunk is its length, its type, its data and its checksum
    const length = u32(d, p);
    const kind = u32(d, p + 4);
    if (length > n - p - 12) broken(ENDS);
    if (crc32(d, p + 4, length + 4) !== u32(d, p + 8 + length)) broken(CHECKSUM);
    const at = p + 8;
    if ((chunks === 0) !== (kind === IHDR)) broken(HEADER); // IHDR comes first, and only once
    if (kind === IHDR) {
      if (length !== 13) broken(HEADER);
      [width, height, depth, type, interlaced] = [u32(d, at), u32(d, at + 4), d[at + 8], d[at + 9], d[at + 12]];
      if (width === 0 || height === 0) broken(HEADER);
      if (type > 6 || !DEPTHS[type].includes(depth)) broken(HEADER);
      if (d[at + 10] !== 0 || d[at + 11] !== 0 || interlaced > 1) broken(HEADER); // the one way to compress and filter
      if (width * height > MOST_PIXELS) tooBig();
    } else if (kind === PLTE) {
      if (length === 0 || length > 768 || length % 3 !== 0) broken(HEADER);
      [palette, colours] = [at, length / 3];
    } else if (kind === TRNS) {
      [trns, trnsLength] = [at, length];
    } else if (kind === IDAT) {
      pieces.push(at, length);
      packed += length;
    } else if (kind === IEND) break;
    chunks++;
    p = at + length + 4;
  }
  if (type === 3 && palette < 0) broken(HEADER);

  // each pass's pixels across and down, and the bytes in each of its rows, a filter byte first
  const bits = CHANNELS[type] * depth; // a pixel's bits
  const passes = (interlaced ? ADAM7 : [[0, 0, 1, 1]]).map(([x0, y0, dx, dy]) => {
    const across = width > x0 ? Math.floor((width - x0 + dx - 1) / dx) : 0;
    const down = height > y0 ? Math.floor((height - y0 + dy - 1) / dy) : 0;
    return { x0, y0, dx, dy, across: down ? across : 0, down: across ? down : 0, row: Math.floor((across * bits + 7) / 8) + 1 };
  });
  const total = passes.reduce((sum, pass) => sum + pass.down * pass.row, 0);
  const z = new Uint8Array(packed);
  for (let i = 0, to = 0; i < pieces.length; to += pieces[i + 1], i += 2) z.set(d.subarray(pieces[i], pieces[i] + pieces[i + 1]), to);
  const raw = zlib(z, total, () => broken(DAMAGED));

  // each row unfiltered where it is, then its pixels into the picture
  const pixels = new Uint8Array(width * height * 4);
  const step = Math.max(1, bits >> 3); // the byte a filter looks back to: the same byte of the pixel before
  const most = (1 << depth) - 1;
  const grey = depth < 8 ? 255 / most : 1; // a grey level of 1, 2 or 4 bits, made 8
  const sample = (row, x) => (depth === 16 ? raw[row + 2 * x] * 256 + raw[row + 2 * x + 1] : depth === 8 ? raw[row + x]
    : (raw[row + ((x * depth) >> 3)] >> (8 - depth - ((x * depth) & 7))) & most);
  const high = (v) => (depth === 16 ? v >> 8 : v);
  const clear = type === 0 && trnsLength >= 2 ? d[trns] * 256 + d[trns + 1] : -1; // the grey that's see-through, if there is one
  const clearRgb = type === 2 && trnsLength >= 6 ? [0, 2, 4].map((k) => d[trns + k] * 256 + d[trns + k + 1]) : null;
  let start = 0;
  for (const { x0, y0, dx, dy, across, down, row } of passes) {
    for (let r = 0; r < down; r++, start += row) {
      const filter = raw[start];
      if (filter > 4) broken(DAMAGED);
      const line = start + 1;
      const above = r ? line - row : -1;
      for (let i = 0; i < row - 1; i++) {
        const a = i >= step ? raw[line + i - step] : 0;
        const b = above >= 0 ? raw[above + i] : 0;
        const c = above >= 0 && i >= step ? raw[above + i - step] : 0;
        let add = 0;
        if (filter === 1) add = a;
        else if (filter === 2) add = b;
        else if (filter === 3) add = (a + b) >> 1;
        else if (filter === 4) {
          const [pa, pb, pc] = [Math.abs(b - c), Math.abs(a - c), Math.abs(a + b - 2 * c)];
          add = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        }
        raw[line + i] = (raw[line + i] + add) & 255;
      }
      for (let x = 0; x < across; x++) {
        const out = (((y0 + r * dy) * width) + x0 + x * dx) * 4;
        let [red, green, blue, alpha] = [0, 0, 0, 255];
        if (type === 0) {
          const v = sample(line, x);
          red = green = blue = depth < 8 ? v * grey : high(v);
          if (v === clear) alpha = 0;
        } else if (type === 2) {
          const [vr, vg, vb] = [sample(line, 3 * x), sample(line, 3 * x + 1), sample(line, 3 * x + 2)];
          [red, green, blue] = [high(vr), high(vg), high(vb)];
          if (clearRgb && vr === clearRgb[0] && vg === clearRgb[1] && vb === clearRgb[2]) alpha = 0;
        } else if (type === 3) {
          const v = sample(line, x);
          if (v >= colours) broken(PALETTE);
          [red, green, blue] = [d[palette + 3 * v], d[palette + 3 * v + 1], d[palette + 3 * v + 2]];
          if (v < trnsLength) alpha = d[trns + v];
        } else if (type === 4) {
          red = green = blue = high(sample(line, 2 * x));
          alpha = high(sample(line, 2 * x + 1));
        } else {
          [red, green, blue, alpha] = [0, 1, 2, 3].map((k) => high(sample(line, 4 * x + k)));
        }
        [pixels[out], pixels[out + 1], pixels[out + 2], pixels[out + 3]] = [red, green, blue, alpha];
      }
    }
  }
  return { width, height, pixels };
}

// A zlib stream (RFC 1950) inflated (RFC 1951) into exactly `total` bytes, as puff.c, Mark Adler's own plain
// inflater, does it: one bit at a time through each code, which is simple to write the same way twice.
// Anything wrong in it, or a stream that gives more or less than `total`, is `damaged()`.
function zlib(z, total, damaged) {
  const out = new Uint8Array(total);
  let made = 0;
  if (z.length < 2) damaged();
  if ((z[0] & 15) !== 8 || z[0] >> 4 > 7 || (z[0] * 256 + z[1]) % 31 !== 0 || z[1] & 32) damaged();
  let at = 2;
  let held = 0; // bits read but not used yet, and how many
  let count = 0;
  const bits = (need) => { // never more than 13 at once, so `held` stays below 2^21
    while (count < need) {
      if (at >= z.length) damaged();
      held |= z[at++] << count;
      count += 8;
    }
    const v = held & ((1 << need) - 1);
    held >>>= need;
    count -= need;
    return v;
  };
  const put = (b) => {
    if (made >= total) damaged();
    out[made++] = b;
  };
  // a Huffman code from each symbol's length: how many codes of each length, and the symbols in order
  const code = (lengths, from, n) => {
    const counts = new Array(16).fill(0);
    const symbols = new Array(n).fill(0);
    for (let s = 0; s < n; s++) counts[lengths[from + s]]++;
    const offsets = new Array(16).fill(0);
    let left = 1; // codes not yet used: more than none left is a code that isn't complete
    for (let len = 1; len < 16; len++) {
      left = left * 2 - counts[len];
      if (left < 0) return { counts, symbols, left };
    }
    for (let len = 1; len < 15; len++) offsets[len + 1] = offsets[len] + counts[len];
    for (let s = 0; s < n; s++) if (lengths[from + s]) symbols[offsets[lengths[from + s]]++] = s;
    return { counts, symbols, left: counts[0] === n ? 0 : left };
  };
  const decode = ({ counts, symbols }) => {
    let [c, first, index] = [0, 0, 0];
    for (let len = 1; len < 16; len++) {
      c |= bits(1);
      const k = counts[len];
      if (c - k < first) return symbols[index + (c - first)];
      index += k;
      first = (first + k) * 2;
      c *= 2;
    }
    return damaged();
  };
  const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
  const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
  const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073,
    4097, 6145, 8193, 12289, 16385, 24577];
  const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
  const codes = (lit, dist) => {
    for (;;) {
      let s = decode(lit);
      if (s < 256) put(s);
      else if (s === 256) return;
      else {
        s -= 257;
        if (s >= 29) damaged();
        const len = LENGTH_BASE[s] + bits(LENGTH_EXTRA[s]);
        const ds = decode(dist);
        if (ds >= 30) damaged();
        const back = DIST_BASE[ds] + bits(DIST_EXTRA[ds]);
        if (back > made) damaged();
        for (let i = 0; i < len; i++) put(out[made - back]);
      }
    }
  };
  let fixed = null;
  const lengths = new Array(320).fill(0);
  const ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
  let last = 0;
  do {
    last = bits(1);
    const kind = bits(2);
    if (kind === 0) { // stored: the bytes as they are, from the next whole byte
      [held, count] = [0, 0];
      if (z.length - at < 4) damaged();
      const len = z[at] + z[at + 1] * 256;
      if (z[at + 2] !== (~len & 255) || z[at + 3] !== ((~len >> 8) & 255)) damaged();
      at += 4;
      if (z.length - at < len) damaged();
      for (let i = 0; i < len; i++) put(z[at + i]);
      at += len;
    } else if (kind === 1) {
      if (!fixed) {
        const lengths = [...new Array(144).fill(8), ...new Array(112).fill(9), ...new Array(24).fill(7), ...new Array(8).fill(8), ...new Array(30).fill(5)];
        fixed = [code(lengths, 0, 288), code(lengths, 288, 30)];
      }
      codes(...fixed);
    } else if (kind === 2) {
      const nlen = bits(5) + 257;
      const ndist = bits(5) + 1;
      const ncode = bits(4) + 4;
      if (nlen > 286 || ndist > 30) damaged();
      for (let i = 0; i < 19; i++) lengths[ORDER[i]] = i < ncode ? bits(3) : 0;
      const lencode = code(lengths, 0, 19);
      if (lencode.left !== 0) damaged(); // the code for the lengths must be complete
      let index = 0;
      while (index < nlen + ndist) {
        let s = decode(lencode);
        if (s < 16) lengths[index++] = s;
        else {
          let len = 0;
          if (s === 16) {
            if (index === 0) damaged();
            len = lengths[index - 1];
            s = 3 + bits(2);
          } else if (s === 17) s = 3 + bits(3);
          else s = 11 + bits(7);
          if (index + s > nlen + ndist) damaged();
          while (s--) lengths[index++] = len;
        }
      }
      if (lengths[256] === 0) damaged(); // no end to the block
      const lit = code(lengths, 0, nlen);
      if (lit.left < 0 || (lit.left > 0 && nlen !== lit.counts[0] + lit.counts[1])) damaged(); // only a single code may be incomplete
      const dist = code(lengths, nlen, ndist);
      if (dist.left < 0 || (dist.left > 0 && ndist !== dist.counts[0] + dist.counts[1])) damaged();
      codes(lit, dist);
    } else damaged();
  } while (!last);
  if (made !== total) damaged();
  if (z.length - at < 4) damaged(); // then Adler-32 of what it made, from the next whole byte
  let [a, b] = [1, 0];
  for (let i = 0; i < total; i++) {
    a = (a + out[i]) % 65521;
    b = (b + a) % 65521;
  }
  if (u32(z, at) !== b * 65536 + a) damaged();
  return out;
}

// ---------- BMP ----------

function bmp(d, broken, tooBig, cantRead) {
  const n = d.length;
  if (n < 18) broken(ENDS);
  const size = le32(d, 14); // how long the header is says which header it is
  if (!BMP_HEADERS.includes(size)) cantRead();
  if (n < 14 + size) broken(ENDS);
  const width = le32(d, 18) | 0;
  const down = le32(d, 22) | 0; // below 0 for rows from the top down
  const height = Math.abs(down);
  const bits = le16(d, 28);
  const packing = le32(d, 30); // 0 for none, 3 or 6 for colours in masks of bits
  if (width <= 0 || down === 0) broken(HEADER);
  if (![1, 4, 8, 16, 24, 32].includes(bits)) cantRead();
  if (!(packing === 0 || ((packing === 3 || packing === 6) && (bits === 16 || bits === 32)))) cantRead();
  if (width * height > MOST_PIXELS) tooBig();
  // the bits of a 16- or 32-bit pixel that hold its red, green, blue and alpha
  let masks = bits === 16 ? [0x7c00, 0x3e0, 0x1f, 0] : [0xff0000, 0xff00, 0xff, 0];
  if (packing !== 0) {
    const alpha = packing === 6 || size >= 56;
    if (n < 54 + (alpha ? 16 : 12)) broken(ENDS); // after a header of 40 bytes, or in a longer one
    masks = [le32(d, 54), le32(d, 58), le32(d, 62), alpha ? le32(d, 66) : 0];
  }
  const fields = masks.map((mask) => {
    let shift = 0;
    while (mask && shift < 32 && Math.floor(mask / 2 ** shift) % 2 === 0) shift++;
    const top = Math.floor(mask / 2 ** shift); // the mask's bits, moved down to the bottom
    if ((top + 1) & top) broken(HEADER); // its bits must be side by side
    return { mask, shift, most: top };
  });
  const scaled = ({ mask, shift, most }, v) => (mask ? Math.floor((Math.floor(v / 2 ** shift) % (most + 1) * 510 + most) / (2 * most)) : 0);
  let colours = 0;
  const palette = 14 + size;
  if (bits <= 8) {
    const used = le32(d, 46);
    if (used > 2 ** bits) broken(HEADER);
    colours = used || 2 ** bits;
    if (n < palette + 4 * colours) broken(ENDS);
  }
  const stride = Math.floor((width * bits + 31) / 32) * 4;
  const from = le32(d, 10); // where the pixels start
  if (from + stride * height > n) broken(ENDS);
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const row = from + (down < 0 ? y : height - 1 - y) * stride;
    for (let x = 0; x < width; x++) {
      const out = (y * width + x) * 4;
      let [red, green, blue, alpha] = [0, 0, 0, 255];
      if (bits <= 8) {
        const v = (d[row + ((x * bits) >> 3)] >> (8 - bits - ((x * bits) & 7))) & ((1 << bits) - 1);
        if (v >= colours) broken(PALETTE);
        [blue, green, red] = [d[palette + 4 * v], d[palette + 4 * v + 1], d[palette + 4 * v + 2]];
      } else if (bits === 24) {
        [blue, green, red] = [d[row + 3 * x], d[row + 3 * x + 1], d[row + 3 * x + 2]];
      } else {
        const v = bits === 16 ? le16(d, row + 2 * x) : le32(d, row + 4 * x);
        [red, green, blue] = [scaled(fields[0], v), scaled(fields[1], v), scaled(fields[2], v)];
        if (fields[3].mask) alpha = scaled(fields[3], v);
      }
      [pixels[out], pixels[out + 1], pixels[out + 2], pixels[out + 3]] = [red, green, blue, alpha];
    }
  }
  return { width, height, pixels };
}
