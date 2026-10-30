// Small PNG and BMP files made for the tests, in every colour type and bit depth, interlaced or not, with
// every filter and every kind of compressed block; what each one's pixels must come out as; and the same
// files broken in each way a mistake names. Node.js only (its zlib compresses them).
import { deflateSync, constants } from "node:zlib";

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (bytes) => {
  let c = 0xffffffff;
  for (const b of bytes) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const be32 = (v) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
const le16 = (v) => [v & 255, (v >>> 8) & 255];
const le32 = (v) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
const ascii = (t) => [...t].map((c) => c.charCodeAt(0));

// a chunk: its length, type, data and checksum
export function chunk(type, data) {
  const body = [...ascii(type), ...data];
  return [...be32(data.length), ...body, ...be32(crc32(body))];
}

// The same small generator the engines use (mulberry32), so a case is the same every time.
export function random(seed) {
  let a = seed >>> 0;
  return (n) => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * n);
  };
}

const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const ADAM7 = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]];

// A PNG of `width` by `height`, colour type `type` and bit depth `depth`, whose samples (each channel of each
// pixel, row by row) come from `pick`; `palette` (a list of [r, g, b]) and `trns` (bytes) for the chunks of
// those names; each row filtered as `filter(row)` says (0 to 4); compressed with zlib's `options`; split
// into IDATs of at most `split` bytes. Gives the file's bytes and what its pixels must come out as (RGBA).
export function makePng({ width, height, type, depth, interlaced = false, pick, palette, trns, filter = () => 0,
  options = {}, split = Infinity, extra = [] }) {
  const channels = CHANNELS[type];
  const samples = Array.from({ length: height }, (_, y) => Array.from({ length: width * channels }, (_, i) => pick(y, i, (1 << depth) - 1)));
  const bits = channels * depth;
  const raw = [];
  for (const [x0, y0, dx, dy] of interlaced ? ADAM7 : [[0, 0, 1, 1]]) {
    const xs = [];
    for (let x = x0; x < width; x += dx) xs.push(x);
    const ys = [];
    for (let y = y0; y < height; y += dy) ys.push(y);
    if (!xs.length || !ys.length) continue;
    const size = Math.ceil((xs.length * bits) / 8);
    let above = new Array(size).fill(0);
    ys.forEach((y, r) => {
      const line = new Array(size).fill(0); // the row's samples, packed
      let at = 0; // in bits
      for (const x of xs) {
        for (let c = 0; c < channels; c++) {
          const v = samples[y][x * channels + c];
          if (depth === 16) [line[at / 8], line[at / 8 + 1]] = [v >> 8, v & 255];
          else if (depth === 8) line[at / 8] = v;
          else line[at >> 3] |= v << (8 - depth - (at & 7));
          at += depth;
        }
      }
      const kind = filter(r);
      const step = Math.max(1, bits >> 3);
      const filtered = line.map((b, i) => {
        const a = i >= step ? line[i - step] : 0;
        const up = above[i];
        const c = i >= step ? above[i - step] : 0;
        const paeth = () => {
          const [pa, pb, pc] = [Math.abs(up - c), Math.abs(a - c), Math.abs(a + up - 2 * c)];
          return pa <= pb && pa <= pc ? a : pb <= pc ? up : c;
        };
        return (b - [0, a, up, (a + up) >> 1, kind === 4 ? paeth() : 0][kind] + 256) & 255;
      });
      raw.push(kind, ...filtered);
      above = line;
    });
  }
  const z = [...deflateSync(Uint8Array.from(raw), options)];
  const idats = [];
  for (let i = 0; i < z.length || i === 0; i += Math.min(split, z.length - i || 1)) idats.push(...chunk("IDAT", z.slice(i, i + split)));
  const file = [137, 80, 78, 71, 13, 10, 26, 10, ...chunk("IHDR", [...be32(width), ...be32(height), depth, type, 0, 0, interlaced ? 1 : 0]),
    ...extra.flat(), ...(palette ? chunk("PLTE", palette.flat()) : []), ...(trns ? chunk("tRNS", trns) : []), ...idats, ...chunk("IEND", [])];
  // what each pixel must be: 8 bits of each channel, the top 8 of 16, a grey of fewer bits stretched
  const eight = (v) => (depth === 16 ? v >> 8 : depth < 8 ? Math.round((v * 255) / ((1 << depth) - 1)) : v);
  const pixels = [];
  const trnsAt = (k) => trns[k] * 256 + trns[k + 1];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const s = samples[y].slice(x * channels, (x + 1) * channels);
      if (type === 0) pixels.push(eight(s[0]), eight(s[0]), eight(s[0]), trns?.length >= 2 && s[0] === trnsAt(0) ? 0 : 255);
      else if (type === 2) pixels.push(...s.map(eight), trns?.length >= 6 && s.every((v, k) => v === trnsAt(2 * k)) ? 0 : 255);
      else if (type === 3) pixels.push(...palette[s[0]], s[0] < (trns?.length ?? 0) ? trns[s[0]] : 255);
      else if (type === 4) pixels.push(eight(s[0]), eight(s[0]), eight(s[0]), eight(s[1]));
      else pixels.push(...s.map(eight));
    }
  }
  return { bytes: Uint8Array.from(file), width, height, pixels: Uint8Array.from(pixels) };
}

// A BMP of `width` by `height` with `bits` bits a pixel (1, 4 or 8 with a palette of `colours` [r, g, b];
// 16, 24 or 32 without), `header` bytes of header (40, 52, 56, 108 or 124), `packing` 0, or 3 or 6 with
// `masks` [r, g, b, a], rows from the bottom up unless `topDown`. Its pixels are `pick(x, y)`: a palette index,
// or the value of a 16- or 32-bit pixel, or [r, g, b] for 24 bits. Gives the bytes, and what the pixels must be.
export function makeBmp({ width, height, bits, header = 40, packing = 0, masks, colours = [], used = colours.length, topDown = false, pick }) {
  const stride = Math.ceil((width * bits) / 32) * 4;
  const head = [...le32(header), ...le32(width), ...le32(topDown ? -height : height), ...le16(1), ...le16(bits), ...le32(packing),
    ...le32(stride * height), ...le32(2835), ...le32(2835), ...le32(used), ...le32(0)];
  const fields = packing ? masks : bits === 16 ? [0x7c00, 0x3e0, 0x1f, 0] : [0xff0000, 0xff00, 0xff, 0];
  if (header > 40) head.push(...le32(fields[0]), ...le32(fields[1]), ...le32(fields[2]));
  if (header > 52) head.push(...le32(fields[3]));
  while (head.length < header) head.push(0);
  // the masks a header is too short to hold, after it
  const after = !packing ? [] : header === 40 ? [...le32(fields[0]), ...le32(fields[1]), ...le32(fields[2]), ...(packing === 6 ? le32(fields[3]) : [])]
    : header === 52 && packing === 6 ? le32(fields[3]) : [];
  const table = colours.flatMap(([r, g, b]) => [b, g, r, 0]);
  const from = 14 + header + after.length + table.length;
  const rows = [];
  const pixels = [];
  const scale = (v, mask) => {
    if (!mask) return 0;
    let shift = 0;
    while (!((mask >>> shift) & 1)) shift++;
    const most = mask >>> shift;
    return Math.round((((v & mask) >>> 0) >>> shift) * 255 / most);
  };
  for (let y = 0; y < height; y++) {
    const row = new Array(stride).fill(0);
    for (let x = 0; x < width; x++) {
      const v = pick(x, y);
      if (bits <= 8) {
        row[(x * bits) >> 3] |= v << (8 - bits - ((x * bits) & 7));
        pixels.push(...colours[v], 255);
      } else if (bits === 24) {
        [row[3 * x], row[3 * x + 1], row[3 * x + 2]] = [v[2], v[1], v[0]];
        pixels.push(...v, 255);
      } else {
        const b = bits === 16 ? le16(v) : le32(v);
        b.forEach((byte, k) => (row[(bits / 8) * x + k] = byte));
        pixels.push(scale(v, fields[0]), scale(v, fields[1]), scale(v, fields[2]), fields[3] ? scale(v, fields[3]) : 255);
      }
    }
    rows.push(row);
  }
  if (!topDown) rows.reverse();
  const body = rows.flat();
  const file = [66, 77, ...le32(from + body.length), 0, 0, 0, 0, ...le32(from), ...head, ...after, ...table, ...body];
  return { bytes: Uint8Array.from(file), width, height, pixels: Uint8Array.from(pixels) };
}

// Every kind of PNG, small: each colour type at each depth it may have, interlaced or not, with transparency
// where the type has it, each with every filter and in stored, fixed and dynamic blocks.
export function pngCases(seed = 1) {
  const r = random(seed);
  const cases = [];
  const ZLIB = [{ level: 0 }, { strategy: constants.Z_FIXED }, { level: 9 }, { level: 6, strategy: constants.Z_RLE }];
  const kinds = [[0, [1, 2, 4, 8, 16]], [2, [8, 16]], [3, [1, 2, 4, 8]], [4, [8, 16]], [6, [8, 16]]];
  let k = 0;
  for (const [type, depths] of kinds) {
    for (const depth of depths) {
      for (const interlaced of [false, true]) {
        const [width, height] = [1 + r(13), 1 + r(11)];
        const most = (1 << depth) - 1;
        const colours = type === 3 ? Array.from({ length: 1 + r(most + 1) }, () => [r(256), r(256), r(256)]) : undefined;
        let trns;
        if (type === 0) trns = [...be32(r(most + 1))].slice(2);
        if (type === 2) trns = [0, 1, 2].flatMap(() => [...be32(r(2) ? 0 : r(most + 1))].slice(2));
        if (type === 3) trns = Array.from({ length: r(colours.length + 1) }, () => r(256));
        // greys and colours often the see-through one, so it's tested
        let clear = false;
        const pick = (y, i, top) => {
          if (type === 3) return r(colours.length);
          if (type === 0 && r(3) === 0) return trns[0] * 256 + trns[1];
          if (type === 2 && i % 3 === 0) clear = r(3) === 0;
          if (type === 2 && clear) return trns[2 * (i % 3)] * 256 + trns[2 * (i % 3) + 1];
          return r(top + 1);
        };
        cases.push(makePng({ width, height, type, depth, interlaced, pick, palette: colours, trns: k % 3 === 2 && type !== 3 ? undefined : trns,
          filter: () => r(5), options: ZLIB[k % ZLIB.length], split: k % 2 ? 7 : Infinity }));
        k++;
      }
    }
  }
  return cases;
}

// Every kind of BMP Moth reads, small: palettes of 1, 4 and 8 bits, 16, 24 and 32 bits, each header, masks
// with alpha, rows from the top down
export function bmpCases(seed = 1) {
  const r = random(seed);
  const cases = [];
  const MASKS = [[0xff0000, 0xff00, 0xff, 0xff000000], [0xf800, 0x7e0, 0x1f, 0], [0xf00, 0xf0, 0xf, 0xf000], [0x3ff00000, 0xffc00, 0x3ff, 0]];
  let k = 0;
  for (const bits of [1, 4, 8, 16, 24, 32]) {
    for (const header of [40, 52, 56, 108, 124]) {
      for (const packing of bits === 16 || bits === 32 ? [0, 3, 6] : [0]) {
        const [width, height] = [1 + r(9), 1 + r(7)];
        const colours = bits <= 8 ? Array.from({ length: 1 + r(2 ** bits) }, () => [r(256), r(256), r(256)]) : [];
        const used = bits <= 8 && colours.length === 2 ** bits && r(2) ? 0 : colours.length; // 0 says all of them
        let masks;
        if (packing) {
          masks = MASKS[bits === 16 ? 1 + r(2) : r(2) * 3].slice();
          if (packing === 3 && header < 56) masks[3] = 0;
        }
        const pick = (x, y) => (bits <= 8 ? r(colours.length) : bits === 24 ? [r(256), r(256), r(256)] : bits === 16 ? r(65536) : r(2 ** 32));
        cases.push(makeBmp({ width, height, bits, header, packing, masks, colours, used, topDown: k % 3 === 1, pick }));
        k++;
      }
    }
  }
  return cases;
}

// The same files broken: cut short, a byte changed (in a PNG, often with its chunk's checksum made right
// again, so the change reaches what's inside), and made by hand wrong in each way a mistake names
export function brokenPictures(seed = 1) {
  const r = random(seed);
  const files = [...pngCases(seed), ...bmpCases(seed)].map((c) => c.bytes);
  const broken = [];
  for (const file of files) {
    broken.push(file.slice(0, r(file.length)));
    for (let k = 0; k < 3; k++) {
      const bad = file.slice();
      const at = r(bad.length);
      bad[at] = (bad[at] + 1 + r(255)) & 255;
      if (bad[0] === 137 && r(4)) fixChecksums(bad);
      broken.push(bad);
    }
  }
  return broken;
}

// each chunk's checksum, made right for what the chunk holds now, as far as the chunks can be followed
export function fixChecksums(bytes) {
  let p = 8;
  while (p + 12 <= bytes.length) {
    const length = ((bytes[p] << 24) | (bytes[p + 1] << 16) | (bytes[p + 2] << 8) | bytes[p + 3]) >>> 0;
    if (p + 12 + length > bytes.length) return;
    be32(crc32(bytes.subarray(p + 4, p + 8 + length))).forEach((b, i) => (bytes[p + 8 + length + i] = b));
    p += 12 + length;
  }
}

// Files broken by hand, each in one way a mistake names, with what the mistake says after the file's name
export function handmadeBroken() {
  const ihdr = (w, h, depth, type, lace = 0, packing = 0) => chunk("IHDR", [...be32(w), ...be32(h), depth, type, packing, 0, lace]);
  const png = (...chunks) => Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, ...chunks.flat()]);
  const z = (raw) => [...deflateSync(Uint8Array.from(raw))];
  const idat = (raw) => chunk("IDAT", z(raw));
  const iend = chunk("IEND", []);
  const greys = [0, 10, 20, 0, 30, 40]; // two rows of two greys, each row with filter 0
  const good = png(ihdr(2, 2, 8, 0), idat(greys), iend);
  const changed = (bytes, at, value) => {
    const copy = Uint8Array.from(bytes);
    copy[at] = value;
    return copy;
  };
  const le = (bytes, at, v, size = 4) => {
    const copy = Uint8Array.from(bytes);
    for (let k = 0; k < size; k++) copy[at + k] = (v >>> (8 * k)) & 255;
    return copy;
  };
  const NOT = "isn't a PNG or BMP picture";
  const [ENDS, CHECKSUM, HEADER, DAMAGED, PALETTE] = ["it ends too soon", "a chunk's checksum is wrong", "its header is wrong",
    "its pixel data is damaged", "a pixel's colour isn't in its palette"].map((reason) => `is a broken PNG: ${reason}`);
  const zBad = z(greys);
  const adler = z(greys);
  adler[adler.length - 1] ^= 1;
  const bmp = makeBmp({ width: 2, height: 2, bits: 8, colours: [[1, 2, 3], [4, 5, 6]], pick: (x, y) => (x + y) % 2 }).bytes;
  const masked = makeBmp({ width: 2, height: 2, bits: 16, packing: 3, masks: [0xf0f0, 0x0f00, 0x000f, 0], pick: () => 0 }).bytes;
  return [
    [Uint8Array.from("hello", (c) => c.charCodeAt(0)), NOT],
    [new Uint8Array(0), NOT],
    [good.slice(0, 4), NOT], // a PNG's first 4 bytes are not its 8
    [good.slice(0, 8), ENDS],
    [good.slice(0, 40), ENDS], // in the middle of its pixels
    [good.slice(0, good.length - 12), ENDS], // no IEND
    [changed(good, 30, good[30] ^ 1), CHECKSUM],
    [png(chunk("tEXt", [97, 0, 98]), ihdr(2, 2, 8, 0), idat(greys), iend), HEADER], // IHDR isn't first
    [png(ihdr(2, 2, 8, 0), ihdr(2, 2, 8, 0), idat(greys), iend), HEADER], // or there are two
    [png(chunk("IHDR", [...be32(2), ...be32(2), 8, 0, 0, 0]), idat(greys), iend), HEADER], // too short
    [png(ihdr(0, 2, 8, 0), idat(greys), iend), HEADER],
    [png(ihdr(2, 2, 3, 0), idat(greys), iend), HEADER], // 3 bits
    [png(ihdr(2, 2, 8, 1), idat(greys), iend), HEADER], // no colour type 1
    [png(ihdr(2, 2, 4, 2), idat(greys), iend), HEADER], // red, green and blue of 4 bits
    [png(ihdr(2, 2, 8, 0, 2), idat(greys), iend), HEADER], // interlaced some other way
    [png(ihdr(2, 2, 8, 0, 0, 1), idat(greys), iend), HEADER], // compressed some other way
    [png(ihdr(2, 2, 8, 3), idat(greys), iend), HEADER], // palette colours, with no palette
    [png(ihdr(2, 2, 8, 3), chunk("PLTE", [1, 2, 3, 4]), idat(greys), iend), HEADER], // a palette of 4 bytes
    [png(ihdr(5000, 4000, 8, 0), idat([0]), iend), "is too big to draw: more than 16,777,216 pixels (4096 by 4096)"],
    [png(ihdr(2, 2, 8, 0), iend), DAMAGED], // no pixels at all
    [png(ihdr(2, 2, 8, 0), chunk("IDAT", [zBad[0], zBad[1] ^ 1, ...zBad.slice(2)]), iend), DAMAGED], // zlib's header
    [png(ihdr(2, 2, 8, 0), chunk("IDAT", adler), iend), DAMAGED], // its Adler-32
    [png(ihdr(2, 2, 8, 0), idat(greys.slice(0, 5)), iend), DAMAGED], // a byte too few
    [png(ihdr(2, 2, 8, 0), idat([...greys, 0]), iend), DAMAGED], // a byte too many
    [png(ihdr(2, 2, 8, 0), idat([5, 10, 20, 0, 30, 40]), iend), DAMAGED], // no filter 5
    [png(ihdr(2, 2, 8, 3), chunk("PLTE", [255, 0, 0, 0, 255, 0]), idat([0, 0, 1, 0, 1, 2]), iend), PALETTE],
    [Uint8Array.from([66, 77]), "is a broken BMP: it ends too soon"],
    [bmp.slice(0, bmp.length - 1), "is a broken BMP: it ends too soon"],
    [le(bmp, 14, 12), "is a kind of BMP Moth can't read"], // OS/2's old header
    [le(bmp, 30, 1), "is a kind of BMP Moth can't read"], // run-length compressed
    [le(bmp, 28, 2, 2), "is a kind of BMP Moth can't read"], // 2 bits a pixel
    [le(bmp, 18, 0), "is a broken BMP: its header is wrong"],
    [le(bmp, 46, 1), "is a broken BMP: a pixel's colour isn't in its palette"], // one colour, but pixels of two
    [masked, "is a broken BMP: its header is wrong"], // a mask whose bits aren't side by side
  ];
}
