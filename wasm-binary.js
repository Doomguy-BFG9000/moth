// WebAssembly's binary format, written byte by byte: just enough of an encoder for the Moth compiler in
// wasm.js. It covers the GC types (structs, arrays, i31) that let a module keep Moth's values without a
// memory of its own, and it keeps a readable listing of every function as it goes, for `moth wasm`.

// ---------- numbers ----------

// unsigned LEB128: 7 bits at a time, lowest first, the top bit saying "more follows"
export function uleb(n, out = []) {
  do {
    let byte = n & 0x7f;
    n = Math.floor(n / 128);
    if (n) byte |= 0x80;
    out.push(byte);
  } while (n);
  return out;
}

// signed LEB128, for i32 constants and type indices
export function sleb(n, out = []) {
  for (;;) {
    const byte = n & 0x7f;
    n >>= 7;
    if ((n === 0 && !(byte & 0x40)) || (n === -1 && byte & 0x40)) return out.push(byte), out;
    out.push(byte | 0x80);
  }
}

function f64Bytes(x) {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, x, true);
  return [...new Uint8Array(view.buffer)];
}

const utf8 = (text) => [...new TextEncoder().encode(text)];
const name = (text) => {
  const bytes = utf8(text);
  return [...uleb(bytes.length), ...bytes];
};

function append(out, bytes) {
  for (const b of bytes) out.push(b);
  return out;
}

const vec = (items) => items.reduce((out, item) => append(out, item), uleb(items.length));

// ---------- types ----------

// Value types are written as strings ("i32", "eqref"...) or, for references to one of the module's own
// types, as ref(index) and refNull(index). Packed "i8" and "i16" only go in structs and arrays.
const VALUE = { i32: 0x7f, i64: 0x7e, f32: 0x7d, f64: 0x7c, i8: 0x78, i16: 0x77, funcref: 0x70, externref: 0x6f, anyref: 0x6e, eqref: 0x6d, i31ref: 0x6c };
const HEAP = { func: 0x70, extern: 0x6f, any: 0x6e, eq: 0x6d, i31: 0x6c, struct: 0x6b, array: 0x6a, none: 0x71 };

export const ref = (heap) => ({ heap, nullable: false });
export const refNull = (heap) => ({ heap, nullable: true });

const heapType = (h) => (typeof h === "number" ? sleb(h) : [HEAP[h]]);
const valueType = (t) => (typeof t === "string" ? [VALUE[t]] : [t.nullable ? 0x63 : 0x64, ...heapType(t.heap)]);
const typeText = (t) => (typeof t === "string" ? t : `(ref ${t.nullable ? "null " : ""}${t.heap})`);
const fieldType = ({ type, mutable }) => [...valueType(type), mutable ? 1 : 0];

function compositeType(t) {
  if (t.kind === "func") return [0x60, ...vec(t.params.map(valueType)), ...vec(t.results.map(valueType))];
  if (t.kind === "struct") return [0x5f, ...vec(t.fields.map(fieldType))];
  return [0x5e, ...fieldType(t.element)];
}

// ---------- instructions ----------

const OPS = {
  unreachable: [0x00], try: [0x06], catch_all: [0x19], rethrow: [0x09], block: [0x02], loop: [0x03], if: [0x04], else: [0x05], end: [0x0b], br: [0x0c], br_if: [0x0d],
  return: [0x0f], call: [0x10], call_ref: [0x14], drop: [0x1a],
  "local.get": [0x20], "local.set": [0x21], "local.tee": [0x22], "global.get": [0x23], "global.set": [0x24],
  "i32.const": [0x41], "f64.const": [0x44],
  "i32.eqz": [0x45], "i32.eq": [0x46], "i32.ne": [0x47], "i32.lt_s": [0x48], "i32.lt_u": [0x49], "i32.gt_s": [0x4a],
  "i32.gt_u": [0x4b], "i32.le_s": [0x4c], "i32.le_u": [0x4d], "i32.ge_s": [0x4e], "i32.ge_u": [0x4f],
  "f64.eq": [0x61], "f64.ne": [0x62], "f64.lt": [0x63], "f64.gt": [0x64], "f64.le": [0x65], "f64.ge": [0x66],
  "i32.add": [0x6a], "i32.sub": [0x6b], "i32.mul": [0x6c], "i32.and": [0x71], "i32.or": [0x72], "i32.xor": [0x73], "i32.shl": [0x74],
  "i32.shr_u": [0x76],
  "f64.abs": [0x99], "f64.neg": [0x9a], "f64.trunc": [0x9d], "f64.add": [0xa0], "f64.sub": [0xa1], "f64.mul": [0xa2], "f64.div": [0xa3],
  "i32.trunc_f64_s": [0xaa], "f64.convert_i32_s": [0xb7], "f64.convert_i32_u": [0xb8],
  "ref.null": [0xd0], "ref.is_null": [0xd1], "ref.func": [0xd2], "ref.eq": [0xd3], "ref.as_non_null": [0xd4],
  "struct.new": [0xfb, 0x00], "struct.get": [0xfb, 0x02], "struct.set": [0xfb, 0x05],
  "array.new": [0xfb, 0x06], "array.new_default": [0xfb, 0x07], "array.new_fixed": [0xfb, 0x08], "array.new_data": [0xfb, 0x09],
  "array.get": [0xfb, 0x0b], "array.get_u": [0xfb, 0x0d], "array.set": [0xfb, 0x0e], "array.len": [0xfb, 0x0f],
  "array.copy": [0xfb, 0x11], "ref.test": [0xfb, 0x14], "ref.cast": [0xfb, 0x16], "ref.i31": [0xfb, 0x1c], "i31.get_u": [0xfb, 0x1e],
};

function immediates(op, args) {
  switch (op) {
    case "block": case "loop": case "if": case "try": {
      const [type] = args;
      if (type === undefined) return [0x40];
      return typeof type === "object" && type.func !== undefined ? sleb(type.func) : valueType(type);
    }
    case "i32.const": return sleb(args[0]);
    case "f64.const": return f64Bytes(args[0]);
    case "ref.null": case "ref.test": case "ref.cast": return heapType(args[0]);
    default:
      for (const a of args) if (!Number.isInteger(a) || a < 0) throw new Error(`${op} needs indices, not ${a}`);
      return args.flatMap((a) => uleb(a));
  }
}

// One function's instructions, as bytes and as text.
// Which immediates of an instruction name a type, a function or a global, for the listing.
const TYPED = new Set(["struct.new", "struct.get", "struct.set", "array.new", "array.new_default", "array.new_fixed", "array.new_data",
  "array.get", "array.get_u", "array.set", "call_ref", "ref.test", "ref.cast", "ref.null"]);

// One function's instructions, as bytes, plus what the listing needs to show them as text.
export class Code {
  constructor() {
    this.bytes = [];
    this.entries = [];
    this.depth = 1;
  }

  // emit("i32.const", 5), emit("struct.get", type, field)...; the listing indents each one by nesting
  emit(op, ...args) {
    if (!OPS[op]) throw new Error(`no such instruction: ${op}`);
    append(this.bytes, OPS[op]);
    append(this.bytes, immediates(op, args));
    if (op === "end" || op === "else" || op === "catch_all") this.depth--;
    this.entries.push({ depth: this.depth, op, args, note: "" });
    if (op === "block" || op === "loop" || op === "if" || op === "else" || op === "try" || op === "catch_all") this.depth++;
    return this;
  }

  // a comment on the instruction just emitted, for the listing
  note(text) {
    this.entries[this.entries.length - 1].note = text;
    return this;
  }
}

// ---------- the module ----------

export class Module {
  constructor() {
    this.types = [];
    this.typeKeys = new Map();
    this.imports = [];
    this.funcs = [];
    this.globals = [];
    this.exports = [];
    this.datas = [];
    this.declared = new Set(); // functions named by ref.func, which the format wants declared
    this.typeNames = []; // for the listing
    this.globalNames = [];
  }

  // the index of a type, adding it once; all of them go in one recursive group, so they can refer to each other
  type(t) {
    const key = JSON.stringify(t);
    if (!this.typeKeys.has(key)) this.typeKeys.set(key, this.types.push(t) - 1);
    return this.typeKeys.get(key);
  }

  funcType(params, results) {
    return this.type({ kind: "func", params, results });
  }

  // Imports come first in the function index space, so they must all be added before any function.
  import(module, field, type) {
    if (this.funcs.length) throw new Error("imports go before functions");
    return this.imports.push({ module, field, type }) - 1;
  }

  // A function to fill in later; `params` and `results` are value types. Returns { index, code, local(type) }.
  func(label, params, results) {
    const f = {
      label,
      type: this.funcType(params, results),
      index: this.imports.length + this.funcs.length,
      params: params.length,
      locals: [],
      code: new Code(),
      local: (type) => f.params + f.locals.push(type) - 1,
    };
    this.funcs.push(f);
    return f;
  }

  // `init` is a Code holding a constant expression
  global(type, mutable, init) {
    return this.globals.push({ type, mutable, init }) - 1;
  }

  export(field, index) {
    this.exports.push({ field, index });
  }

  // a passive data segment, for array.new_data
  data(bytes) {
    return this.datas.push(bytes) - 1;
  }

  encode() {
    const out = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];
    const section = (id, payload) => append(append(out, [id, ...uleb(payload.length)]), payload);
    section(1, vec([[0x4e, ...vec(this.types.map(compositeType))]])); // one recursive group
    if (this.imports.length) section(2, vec(this.imports.map((i) => [...name(i.module), ...name(i.field), 0x00, ...uleb(i.type)])));
    section(3, vec(this.funcs.map((f) => uleb(f.type))));
    if (this.globals.length) section(6, vec(this.globals.map((g) => [...valueType(g.type), g.mutable ? 1 : 0, ...g.init.bytes, 0x0b])));
    section(7, vec(this.exports.map((e) => [...name(e.field), 0x00, ...uleb(e.index)])));
    if (this.declared.size) section(9, vec([[0x03, 0x00, ...vec([...this.declared].map((i) => uleb(i)))]]));
    if (this.datas.length) section(12, uleb(this.datas.length));
    section(10, vec(this.funcs.map((f) => {
      const groups = [];
      for (const t of f.locals) {
        const last = groups.at(-1);
        if (last && JSON.stringify(last.type) === JSON.stringify(t)) last.count++;
        else groups.push({ type: t, count: 1 });
      }
      const body = append([...vec(groups.map((g) => [...uleb(g.count), ...valueType(g.type)]))], f.code.bytes);
      body.push(0x0b);
      return [...uleb(body.length), ...body];
    })));
    if (this.datas.length) section(11, vec(this.datas.map((d) => [0x01, ...uleb(d.length), ...d])));
    return new Uint8Array(out);
  }

  // the module as text, roughly in the style of WebAssembly's text format
  // `first` is the index of the first function to show; the ones before it follow, after a line saying so
  listing(first = 0) {
    const funcName = (i) => (i < this.imports.length ? `$${this.imports[i].module}.${this.imports[i].field}` : `$${this.funcs[i - this.imports.length].label}`);
    const typeName = (i) => (this.typeNames[i] ? `$${this.typeNames[i]}` : String(i));
    const typed = (t) => (typeof t === "string" ? t : `(ref ${t.nullable ? "null " : ""}${typeof t.heap === "number" ? typeName(t.heap) : t.heap})`);
    const arg = (op, a, i) => {
      if (typeof a === "object") return a.func !== undefined ? typeName(a.func) : typed(a);
      if (op === "call" || op === "ref.func") return funcName(a);
      if (op.startsWith("global.")) return this.globalNames[a] ? `$${this.globalNames[a]}` : String(a);
      if (TYPED.has(op) && (i === 0 || op === "array.copy") && typeof a === "number") return typeName(a);
      if (op === "array.copy") return typeName(a);
      return String(a);
    };
    const out = [];
    const later = this.funcs.filter((f) => f.index < first);
    for (const f of [...this.funcs.filter((f) => f.index >= first), ...later]) {
      if (f === later[0]) out.push("", ";; ---------- the runtime every module has ----------", "");
      const t = this.types[f.type];
      const sig = [...t.params.map((p) => `(param ${typed(p)})`), ...t.results.map((r) => `(result ${typed(r)})`)].join(" ");
      out.push(`(func $${f.label} ${sig}`.trimEnd());
      if (f.locals.length) out.push(`  (local ${f.locals.map(typed).join(" ")})`);
      for (const { depth, op, args, note } of f.code.entries) {
        out.push(`${"  ".repeat(depth)}${op}${args.map((a, i) => ` ${arg(op, a, i)}`).join("")}${note ? `  ;; ${note}` : ""}`);
      }
      out.push(")");
    }
    return out.join("\n");
  }
}
