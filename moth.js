// Moth: a small programming language that reads like plain English.
// Source text -> tokens -> syntax tree -> bytecode (this file) -> the virtual machine (vm.js).

import { MothError, Ended, fail, startTasks, seeded, fakeClock, NOW_WORDS, EVENTS, KINDS, Turtle, callFunction, makeRecord, catchable, caughtValue, COMPARISONS, COMPARE_OPS, OP, OPCODES, TURTLE_ACTIONS, BUILTINS, UNSET, Closure, Machine, execute, isRecord, UNITS, unitNamed } from "./vm.js";
import { Scope, declarations } from "./scope.js";
import { jit, fromJs, TooDeep } from "./jit.js";
import { wasm, compileToWasmModule } from "./wasm.js";
import { check as checkProgram } from "./checker.js";

export { MothError, excerpt, describeTrail, seeded, soundSamples, soundWav, SOUND_RATE } from "./vm.js";

// ---------- tokens ----------

// Every control character counts as a space (as in Wirth's compilers), and text holds any character but a
// control character other than tab (\n makes a new line). Rules this small let the compiler written in Moth,
// which has no character codes, follow them exactly. Of text this finds only the opening quote: textEnd finds
// where it ends, as text can be inside text.
const TOKEN = /([\0-\x20]+)|(#[^\n]*)|(0x[\da-fA-F]+|0b[01]+|\d+(?:\.\d+)?)|([A-Za-z_]\w*)|(")|([-+*/(),]|'s(?!\w))/y;
const ESCAPES = { n: "\n", t: "\t" };
const unescape = (raw) => raw.replace(/\\(.)/gs, (_, c) => ESCAPES[c] ?? c);
const fitsText = (c) => c !== undefined && !/[\0-\x08\n-\x1f]/.test(c);
// a '{' right before one of these starts a value in text: a name, or a bracket
const startsValue = (c) => c !== undefined && /[A-Za-z_(]/.test(c);
// what a mistake in a value inside text adds, for text written before there were values in it
const BRACE_HINT = "to write a '{' itself, put '\\' before it";
// symbols people type out of habit from other languages, and what Moth says instead
const HINTS = {
  "=": "to store a value write 'set x to 5', to compare write 'x is 5'",
  "!": "write 'is not'",
  "<": "write 'is less than'",
  ">": "write 'is greater than'",
  "%": "write 'is divisible by'",
  "[": "make a list with 'list of 1, 2, 3'",
  "]": "make a list with 'list of 1, 2, 3'",
  "{": "blocks finish with 'end', not braces",
  "}": "blocks finish with 'end', not braces",
  "'": "put text in double quotes",
  ".": "to get a field write 'name of person'",
};

// Text that starts with the quote at `at`: `{ end }`, just past its closing quote, or what's missing, `{ quote:
// true }` if the line ends first, or `{ brace }`, the '{' of a value in it that never ends. A value
// ("Hi {name}") ends at its own '}', and can have text of its own inside it.
function textEnd(src, at) {
  for (let i = at + 1; ; ) {
    const c = src[i];
    if (c === '"') return { end: i + 1 };
    if (c === "\\" && fitsText(src[i + 1])) i += 2;
    else if (!fitsText(c)) return { quote: true };
    else if (c === "{" && startsValue(src[i + 1])) {
      const value = valueEnd(src, i);
      if (value.brace !== undefined) return value;
      i = value.end + 1;
    } else i++;
  }
}

// The value in text whose '{' is at `at`: `{ end }`, its '}', or `{ brace: at }` if nothing ends it, the text
// inside it included.
function valueEnd(src, at) {
  for (let i = at + 1; ; ) {
    const c = src[i];
    if (c === "}") return { end: i };
    if (!fitsText(c)) return { brace: at };
    if (c !== '"') i++;
    else {
      const inside = textEnd(src, i);
      if (inside.end === undefined) return { brace: at };
      i = inside.end;
    }
  }
}

// `file` names a file the program uses, for errors in it; the program's own file has none. `start`, for a
// value inside text ("Hi {name}"), is where it starts: its tokens are counted from there, and end with a '}'.
function tokenize(src, file, start) {
  const tokens = [];
  let line = start ? start.line : 1;
  let lineStart = start ? 1 - start.col : 0;
  let nl = !start; // does the next token start a new line?
  const place = (i) => (file ? { line, col: i - lineStart + 1, file } : { line, col: i - lineStart + 1 });
  for (let at = 0; at < src.length; at = TOKEN.lastIndex) {
    TOKEN.lastIndex = at;
    const m = TOKEN.exec(src);
    const where = place(at);
    if (!m) {
      const c = String.fromCodePoint(src.codePointAt(at)); // a whole emoji, not half of one
      const hint = start ? BRACE_HINT : HINTS[c];
      fail(where, `I don't understand '${c}'${start || Object.hasOwn(HINTS, c) ? ` (${hint})` : ""}`);
    }
    let [text, space, comment, number, word, string] = m;
    if (string) {
      const { end, brace } = textEnd(src, at);
      if (brace !== undefined) fail(place(brace), `this '{' has no '}' to end it (${BRACE_HINT})`);
      if (end === undefined) fail(where, "this text is missing its closing quote");
      text = src.slice(at, end);
    }
    if (space || comment) {
      const newlines = text.split("\n").length - 1;
      if (newlines) {
        line += newlines;
        lineStart = at + text.lastIndexOf("\n") + 1;
        nl = true;
      }
      continue;
    }
    const [type, value] = number
      ? ["number", Number(number)]
      : word
        ? ["word", word.toLowerCase()]
        : string
          ? ["string", unescape(text.slice(1, -1))]
          : [text, text];
    const token = { type, value, ...where, nl };
    if (word) token.raw = word; // as written: a library's function is named in its own case (see library)
    if (number) token.text = number; // as written, for messages and the JIT
    if (string) {
      const parts = textParts(src, at + 1, at + text.length - 1, place, file);
      if (parts) token.parts = parts;
      TOKEN.lastIndex = at + text.length; // past the text, which reading a value in it moved
    }
    tokens.push(token);
    nl = false;
  }
  if (start) tokens.push({ type: "}", value: "}", line, col: src.length - lineStart + 1, nl: true, ...(file && { file }) });
  tokens.push({ type: "eof", value: "", line, col: src.length - lineStart + 1, nl: true, ...(file && { file }) });
  return tokens;
}

// "Hi {name}!": text with values in it. A '{' right before a letter, '_' or '(' starts a value, which ends at
// its own '}'; any other '{' is itself, and so is '\{'. Gives the text and each value's tokens, in order, or
// nothing for text with no value in it. The text as written is `src` from `from` to just before `upto`.
function textParts(src, from, upto, place, file) {
  const parts = [];
  let last = from; // where the text not yet in parts starts
  for (let i = from; i < upto; i++) {
    if (src[i] === "\\") i++;
    else if (src[i] === "{" && startsValue(src[i + 1])) {
      const { end } = valueEnd(src, i);
      if (i > last) parts.push(unescape(src.slice(last, i)));
      const { line, col } = place(i + 1);
      parts.push(tokenize(src.slice(i + 1, end), file, { line, col }));
      last = end + 1;
      i = end;
    }
  }
  if (!parts.length) return null;
  if (last < upto) parts.push(unescape(src.slice(last, upto)));
  return parts;
}

// ---------- syntax tree ----------

// words that start a statement or a value, so they can't name a variable
const RESERVED = new Set([
  "set", "add", "say", "if", "else", "end", "repeat", "while", "for", "to", "return", "and", "or", "not", "is", "yes", "no",
  "nothing", "list", "empty", "length", "item", "move", "turn", "pen", "record", "fail", "stop",
  "uppercase", "lowercase", "split", "join", "number", "position", "ask", "use", "try", "dictionary", "remove", "keys", "in",
  "byte", "bytes", "as", "shift", "read", "write", "arguments", "expect", "clear", "draw", "when", "every"]);
// built-in operations (BUILTINS in vm.js), by the word that starts them: the word after it, if any, then
// either one input, or two with a word between them: `uppercase of x`, `split x by ","`, `position of "a" in x`
// the folder a file is in, as its name has it: up to its last / or \, or "" for one in the program's own
const folderOf = (name) => name.slice(0, Math.max(name.lastIndexOf("/"), name.lastIndexOf("\\")) + 1);
// whether a file `use` names could be outside the program's folder: from the top of a disk ("/x", "C:x"), or
// going up out of a folder ("../x")
const outsideFolder = (name) => /^[/\\]|^[A-Za-z]:/.test(name) || name.split(/[/\\]/).includes("..");
const AGGREGATES = ["total", "average", "largest", "smallest"]; // `total of prices`: these words and `of` work out something from a list
const BUILTIN_SYNTAX = new Map([["uppercase", ["of"]], ["lowercase", ["of"]], ["number", ["of"]], ["split", [null, "by"]],
  ["join", [null, "with"]], ["position", ["of", "in"]], ["keys", ["of"]]]);
// `a bit and b`, `a bit or b`, `a bit xor b`; `bit` alone is still a name
const BIT_WORDS = ["and", "or", "xor"];
// what `as` turns a value into: `block as text`, `"hi" as bytes`, `255 as hex`
const AS_WORDS = ["bytes", "text", "hex", "binary", "json"];
// what `when` can wait for, and how many values each gives its handler
const EVENT_PHRASES = new Map([["a key is pressed", { event: "key", gives: 1 }], ["the mouse is clicked", { event: "click", gives: 2 }],
  ["the mouse is dragged", { event: "drag", gives: 2 }]]);
// buttons and text boxes (DESIGN §36): `when enter is pressed in the text box "Name"`, `the text in the text box
// "Name"`, and the words that can follow a value, so `draw button at 0, 0` still draws a variable called button
const ENTER_PHRASE = ["enter", "is", "pressed", "in", "the", "text", "box"];
const TEXT_IN_BOX = ["the", "text", "in", "the", "text", "box"];
// checkboxes, text areas and lists (DESIGN §40)
const CHOSEN_PHRASE = ["an", "item", "is", "chosen", "in", "the", "list"];
const TEXT_IN_AREA = ["the", "text", "in", "the", "text", "area"];
const CHOICE_IN_LIST = ["the", "choice", "in", "the", "list"];
// dropdowns, sliders and choosing a file (DESIGN §42)
const CHOSEN_IN_DROPDOWN = ["an", "item", "is", "chosen", "in", "the", "dropdown"];
const CHOICE_IN_DROPDOWN = ["the", "choice", "in", "the", "dropdown"];
const VALUE_OF_SLIDER = ["the", "value", "of", "the", "slider"];
const CHOOSE_FILE = ["choose", "a", "file", "to"];
const AFTER_A_VALUE = ["at", "of", "bytes", "as", "in", "bit", "is", "and", "or"];
// drawing: `move forward 10`, `turn left 90`, `pen up`, `pen color "red"`
const TURTLE_WORDS = new Map([["move", ["forward", "back", "to"]], ["turn", ["left", "right"]], ["pen", ["up", "down", "color", "width"]]]);
// the words that can carry a value on, as in `draw picture at 0, 0` (which draws the text `picture` holds):
// `draw picture` followed by any other word, or by text, a number or a bracket with a space before it (one
// with none calls `picture`), draws a picture from a file
const CARRY_ON = ["at", "of", "bit", "is", "and", "or", "in", "as", "bytes"];

// Every node keeps the token it came from (`at`), so errors can point at it. `reading` is shared with the
// files the program uses: `files` gives a file's text by name, `loaded` is every file read so far (each is read
// once), and `open` the files being read right now, to catch two that use each other.
function parse(tokens, reading = { loaded: new Set(), open: [] }) {
  if (!reading.depth) [reading.calls, reading.defines] = [[], []]; // for inputs a call leaves out (see fillDefaults)
  reading.depth = (reading.depth ?? 0) + 1;
  let pos = 0;
  const aliases = new Set(); // the names this file used files and libraries `as`: `x's` is theirs, and any other `x's` a value's
  let atTop = false; // directly in the program, not in a block or a function
  let fnDepth = 0;
  let loopDepth = 0; // loops around this spot, in this function: `stop` needs one
  let indexing = false; // inside `item ... of`, where a name followed by `of` is the item number, not a field
  let hoisted = []; // functions the statement being read makes for its values (see unnamed)
  const unnamedOnLine = new Map(); // how many each line has made, so each has a name of its own
  let converting = true; // `trip in miles`; not in `position of ... in`, whose `in` is its own
  const unitAt = (i) => tokens[i].type === "word" && !tokens[i].nl && unitNamed(tokens[i].value) !== undefined;
  const peek = () => tokens[pos];
  const check = (type) => tokens[pos].type === type;
  const match = (type) => check(type) && tokens[pos++];
  const isWord = (w) => check("word") && tokens[pos].value === w;
  // a call by a name, noted for the inputs it may leave out (see fillDefaults)
  const madeCall = (name, args, at) => {
    const made = { kind: "call", name, args, at };
    reading.calls.push(made);
    return made;
  };
  const word = (w) => isWord(w) && tokens[pos++];
  const describe = (t) => (t.type === "eof" ? "the end of the code" : t.type === "string" ? `"${t.value}"` : `'${t.text ?? t.value}'`);
  const expected = (what) => fail(peek(), `expected ${what} but found ${describe(peek())}`);
  const expectWord = (w) => word(w) || expected(`'${w}'`);
  const wordAt = (i, w) => tokens[i].type === "word" && tokens[i].value === w;
  // `run program "git" with (list of "status")`: `run` alone is still a name
  const runsProgram = () => wordAt(pos + 1, "program") && !tokens[pos + 1].nl;
  // `load "scores.txt"`, `load name`: `load` alone, or with `of` after it, is still a name
  const loadsFile = () => !tokens[pos + 1].nl && (tokens[pos + 1].type === "string"
    || (tokens[pos + 1].type === "word" && !RESERVED.has(tokens[pos + 1].value) && tokens[pos + 1].value !== "of"));
  // A phrase that starts with a word that could be a name: `wait 2 seconds`, `save x to "f"`. `parsed` reads the
  // rest, and gives a node, or nothing if this isn't the phrase after all, which makes the line a call again.
  function phrase(parsed) {
    const [start, marks] = [pos, tightMarks.length];
    let node = null;
    try {
      pos++;
      node = parsed();
    } catch (err) {
      if (!(err instanceof MothError)) throw err;
    }
    if (!node) {
      pos = start;
      for (const key of tightMarks.splice(marks)) reading.tight.delete(key);
    }
    return node;
  }
  // these words from token i on, on the line before them
  const wordsAt = (i, words) => words.every((w, k) => wordAt(i + k, w) && !tokens[i + k].nl);
  // a button's label can start at token i: a value there on the same line, where today `button` would end one
  const labelAt = (i) => !tokens[i].nl && (tokens[i].type === "string" || tokens[i].type === "number"
    || (tokens[i].type === "word" && !AFTER_A_VALUE.includes(tokens[i].value)));
  // `send data to "https://..."`: `send` alone is still a name, and so is one not followed by a value and `to`
  // on its line
  const sendsData = () => {
    if (tokens[pos + 1].nl) return false;
    const start = pos;
    const found = phrase(() => (expression(), isWord("to") && !peek().nl ? true : null));
    pos = start;
    return Boolean(found);
  };
  // `json from reply`: `json` alone is still a name
  const jsonFrom = () => wordAt(pos + 1, "from") && !tokens[pos + 1].nl;
  // ` with headers h`, after a site's address
  const withHeaders = () => !peek().nl && wordsAt(pos, ["with", "headers"]) && ((pos += 2), true);
  // `play note ...` and `play a beep`: `play` alone is still a name, and so are `note`, `a` and `beep`
  const playsSound = () => isWord("play") && !tokens[pos + 1].nl
    && (wordAt(pos + 1, "note") || (wordAt(pos + 1, "a") && wordAt(pos + 2, "beep") && !tokens[pos + 2].nl));

  function name(what) {
    const t = peek();
    if (t.type !== "word") expected(what);
    if (RESERVED.has(t.value)) fail(t, `'${t.value}' is a Moth word, so it can't be used as ${what}`);
    pos++;
    return t.value;
  }

  // the line that starts a `try`'s handler: `if it fails`
  const isIfItFails = () => isWord("if") && tokens[pos + 1].type === "word" && tokens[pos + 1].value === "it"
    && tokens[pos + 2]?.type === "word" && tokens[pos + 2].value === "fails";

  // For format(): how deep in blocks each statement starts, and each end, else and if it fails, by "line:col";
  // and the pieces written with no space after them: a negating minus, and a call's bracket (no space before)
  let nesting = 0;
  const lay = (t) => reading.layout && !t.file && reading.layout.set(`${t.line}:${t.col}`, nesting);
  const tightMarks = []; // the marks tight made, in order, so a phrase that isn't one can take its own back
  const tight = (t) => {
    const key = t && `${t.line}:${t.col}`;
    if (reading.tight && t && !t.file && !reading.tight.has(key)) {
      reading.tight.add(key);
      tightMarks.push(key);
    }
    return t;
  };

  // `inTry`: the statements of a `try`, which also end at its `if it fails`
  function statements(opener, inTry = false) {
    const body = [];
    const outside = atTop;
    atTop = !opener;
    if (opener) nesting++;
    while (opener ? !isWord("end") && !isWord("else") && !(inTry && isIfItFails()) : !check("eof")) {
      if (check("eof")) fail(peek(), `'${opener.value}' from line ${opener.line} is missing its 'end'`);
      lay(peek());
      const madeBefore = hoisted;
      hoisted = [];
      const s = statement();
      body.push(...hoisted); // functions its values made, made before it runs
      hoisted = madeBefore;
      if (s.kind === "use") body.push(...s.body); // the file's code, in its place
      else body.push(s);
      if (!peek().nl) expected("a new line");
    }
    if (opener) {
      nesting--;
      lay(peek()); // the end, else or if it fails that closes the block
    }
    atTop = outside;
    return body;
  }

  // The statements of a file the program uses, or none if it was read already. Used `as` a name, its own
  // names are kept apart (see prefixed), and it can be used again as another. Files are read once for each
  // set of names: a file that one used `as m` uses is m's own copy (`within` is then "m's "), and the
  // program can still use the same file for itself. A file's name is from the folder of the file that uses
  // it, unless `fromTop`, for a package's, which is from the program's.
  function useFile(nameToken, alias, fromTop = false) {
    const written = nameToken.value;
    if (outsideFolder(written)) fail(nameToken, `'${written}' isn't in the program's folder: 'use' only reads files there, or in folders inside it`);
    const name = fromTop ? written : (reading.folder ?? "") + written; // `folder`: the using file's
    const within = reading.within ?? "";
    const key = `${within}${name}${alias ? ` as ${alias}` : ""}`;
    if (reading.open.includes(name)) fail(nameToken, `'${name}' is already being read, so it can't be used here: files can't use each other in a circle`);
    if (reading.loaded.has(key)) return [];
    const text = reading.files?.(name);
    if (typeof text !== "string") fail(nameToken, `there is no file called '${name}'`);
    reading.loaded.add(key);
    reading.open.push(name);
    if (alias) reading.within = `${within}${alias}'s `;
    const folder = reading.folder;
    reading.folder = folderOf(name);
    const body = parse(tokenize(text, name), reading);
    reading.within = within;
    reading.folder = folder;
    reading.open.pop();
    return alias ? prefixed(body, alias) : body;
  }

  // `use the library "sqlite3" or "winsqlite3" as sqlite`, then a line for each of its functions the program
  // calls, and `end`: each a function of the program's, whose inputs say what they are as Moth has it (see
  // LIBRARY_TYPES). Only a program moth build makes can call them (see "library call" in vm.js); used `as` a
  // name, they're that name's, as a file's are.
  function library(t) {
    pos += 2;
    if (!atTop) fail(t, "'use the library' only works at the top level of a program");
    const libraryName = () => match("string")?.value ?? expected("a library's name in quotes, like \"sqlite3\"");
    const names = [libraryName()];
    while (!peek().nl && word("or")) names.push(libraryName());
    const alias = !peek().nl && word("as") ? name("a name for the library") : null;
    if (alias) aliases.add(alias);
    if (!peek().nl) expected("a new line");
    nesting++;
    const body = [];
    const made = { structures: {}, callbacks: {} }; // the block's own, which its lines after them can use
    while (!isWord("end")) {
      if (check("eof")) fail(peek(), `'use' from line ${t.line} is missing its 'end'`);
      lay(peek());
      if (isWord("structure") && tokens[pos + 1].type === "word" && wordAt(pos + 2, "with")) libraryStructure(made);
      else if (isWord("callback") && tokens[pos + 1].type === "word" && tokens[pos + 2].type === "(") libraryCallback(made);
      else body.push(libraryFunction(names[0], made));
      if (!peek().nl) expected("a new line");
    }
    nesting--;
    lay(peek());
    pos++;
    for (const d of body) Object.assign(d.native, { libraries: names, ...made });
    return { kind: "use", body: alias ? prefixed(body, alias) : body, at: t };
  }

  // `structure point with x as a whole number, y as a whole number`: a C struct, whose fields are a record's,
  // laid out as C lays them out; one of its fields can be another, `N bytes`, or a callback
  function libraryStructure(made) {
    pos++;
    const structure = libraryTypeName("a name for the structure", made);
    expectWord("with");
    const fields = [];
    do {
      const at = peek();
      const field = name("a field's name");
      if (fields.some((f) => f.name === field)) fail(at, `'${field}' is already one of its fields`);
      expectWord("as");
      fields.push({ name: field, type: libraryType(made, "field") });
    } while (match(","));
    made.structures[structure] = fields;
  }

  // `callback compare(a pointer, a pointer) gives a whole number`: a function of the program's, given for an
  // input of this kind, which C calls back
  function libraryCallback(made) {
    pos++;
    const callback = libraryTypeName("a name for the callback", made);
    tight(match("("));
    const types = [];
    if (!match(")")) {
      do types.push(libraryType(made, "callback input")); while (match(","));
      match(")") || expected("')'");
    }
    if (types.length > 16) fail(peek(), "a callback can be given at most 16 inputs");
    made.callbacks[callback] = { types, gives: !peek().nl && word("gives") ? libraryType(made, "callback result") : null };
  }

  // a structure's or callback's name: neither a Moth word nor one of the words for C's types, nor one before
  function libraryTypeName(what, made) {
    const t = peek();
    const named = name(what);
    if (["number", "whole", "long", "pointer", "float"].includes(named)) fail(t, `'${named}' is one of the words for what C takes, so it can't be used as ${what}`);
    if (Object.hasOwn(made.structures, named) || Object.hasOwn(made.callbacks, named)) fail(t,`'${named}' is already a structure or callback here`);
    return named;
  }

  // `MessageBoxW(a pointer, wide text, wide text, a whole number) gives a whole number`, or with the name the
  // library has for it in quotes, for one Moth can't use: `"remove" as remove_file(text) gives a whole number`
  function libraryFunction(first, made) {
    const t = peek();
    let symbol;
    if (check("string")) {
      symbol = match("string").value;
      expectWord("as");
    } else symbol = t.raw;
    const fnName = name("the name of one of the library's functions");
    tight(match("(")) || expected("'(' and what the function takes");
    const types = [];
    if (!match(")")) {
      do types.push(libraryType(made, "input")); while (match(","));
      match(")") || expected("')'");
    }
    if (types.length > 16) fail(t, "a library's function can take at most 16 inputs");
    const gives = !peek().nl && word("gives") ? libraryType(made, "result") : null;
    const call = { kind: "builtin", name: "library call", args: [{ kind: "value", value: first, at: t }], at: t };
    return {
      kind: "define", name: fnName, params: types.map((_, i) => `input ${i + 1}`), body: [{ kind: "return", value: call, at: t }], at: t,
      kinds: types.map((type) => LIBRARY_TYPES[type] ?? (type.startsWith("a ") && Object.hasOwn(made.callbacks, type.slice(2)) ? 7 : -1)),
      native: { symbol, types, gives, libraries: [first] },
    };
  }

  // what a library's function takes or gives (`where` it is), as C has it: `a whole number` is an int, `wide
  // text` wchar_t*; or a structure or callback the block has, `a point`, or in a structure, `32 bytes`
  function libraryType(made, where) {
    const t = peek();
    let type = Object.keys(LIBRARY_TYPES).find((k) => k.split(" ").every((w, i) => wordAt(pos + i, w)));
    if (type !== undefined) pos += type.split(" ").length;
    else if (where === "field" && check("number") && wordAt(pos + 1, "bytes")) {
      const n = tokens[pos].value;
      if (!Number.isInteger(n) || n < 1 || n > 65536) fail(t, "a structure's bytes are a whole number of them, from 1 to 65536");
      type = `${n} bytes`;
      pos += 2;
    } else if (isWord("a") && tokens[pos + 1].type === "word" && (Object.hasOwn(made.structures, tokens[pos + 1].value) || Object.hasOwn(made.callbacks, tokens[pos + 1].value))) {
      type = `a ${tokens[pos + 1].value}`;
      pos += 2;
    } else expected(`what it takes or gives (${Object.keys(LIBRARY_TYPES).map((k) => `'${k}'`).join(", ").replace(/, ([^,]*)$/, " or $1")}, or a structure or callback)`);
    const structure = type.startsWith("a ") && Object.hasOwn(made.structures, type.slice(2));
    const callback = type.startsWith("a ") && Object.hasOwn(made.callbacks, type.slice(2));
    const wrong = (why) => fail(t, why);
    if (type === "bytes" && where === "result") wrong("a library's function can't give bytes: it can give a pointer to them");
    if (type === "bytes" && where !== "input") wrong(`${where === "field" ? "a structure's field" : "a callback"} can't be bytes: ${where === "field" ? "say how many, as in '16 bytes', or" : "it can"} take a pointer`);
    if (callback && where !== "input" && where !== "field") wrong("only a function's input or a structure's field can be a callback");
    if ((type === "text" || type === "wide text" || structure) && where === "callback result") wrong(`a callback can't give ${type === "text" || type === "wide text" ? type : "a structure"}`);
    return type;
  }

  // `math's sine`: a name the file used `as math` makes
  const member = (first) => (aliases.has(first) && match("'s") ? `${first}'s ${name("a name")}` : first);

  // Any other `x's` is the value's own: `rex's bark()` is bark(rex), a function given the value first, and
  // `rex's name` is name of rex, its field; one after another, `rex's owner's name`.
  function possessive(node) {
    while (check("'s")) {
      pos++;
      const t = peek();
      const named = name("a function's or a field's name");
      node = tight(match("(")) ? madeCall(named, [node, ...argList()], t) : { kind: "field", name: named, of: node, at: t };
    }
    return node;
  }

  function block(opener) {
    if (!peek().nl) expected("a new line");
    return statements(opener);
  }

  function loopBody(opener) {
    loopDepth++;
    const body = blockEnd(opener);
    loopDepth--;
    return body;
  }

  function blockEnd(opener) {
    const body = block(opener);
    expectWord("end");
    return body;
  }

  function statement() {
    const t = peek();
    if (word("set")) {
      if (isWord("item") || isWord("byte")) {
        const target = primary();
        expectWord("to");
        return { kind: "setItem", target, value: expression(), at: t };
      }
      if (wordsAt(pos, ["the", "slider"])) { // `set the slider "Volume" to 50`
        pos += 2;
        const label = additive();
        expectWord("to");
        return { kind: "turtle", action: "set slider", value: { kind: "list", items: [label, expression()], at: t }, at: t };
      }
      const variable = name("a variable name");
      if (check("'s") && !aliases.has(variable)) { // `set rex's name to ...` changes a field
        const field = possessive({ kind: "name", name: variable, at: t });
        if (field.kind !== "field") fail(field.at, `a call can't be given a value: set a field, as in 'set ${variable}'s name to ...'`);
        expectWord("to");
        return { kind: "setField", name: field.name, target: field.of, value: expression(), at: t };
      }
      if (word("of")) { // `set name of person to ...` changes a field
        const target = unary();
        expectWord("to");
        return { kind: "setField", name: variable, target, value: expression(), at: t };
      }
      expectWord("to");
      return { kind: "set", name: variable, value: expression(), at: t };
    }
    if (word("add")) {
      const value = expression();
      expectWord("to");
      return { kind: "add", value, name: name("a variable name"), at: t };
    }
    if (word("say")) { // `say "oops" to the error output`
      const parts = [expression()];
      while (!peek().nl && !isWord("to")) parts.push(expression());
      if (peek().nl || !word("to")) return { kind: "say", parts, at: t };
      if (!(isWord("the") && wordAt(pos + 1, "error") && wordAt(pos + 2, "output"))) expected("'the error output'");
      pos += 3;
      return { kind: "say", parts, at: t, errors: true };
    }
    if (word("if")) return ifRest(t);
    if (word("repeat")) {
      if (word("while")) return { kind: "while", cond: expression(), body: loopBody(t), at: t };
      const count = expression();
      expectWord("times");
      return { kind: "repeat", count, body: loopBody(t), at: t };
    }
    if (word("for")) {
      expectWord("each");
      const variable = name("a variable name");
      if (word("from")) {
        const from = expression();
        expectWord("to");
        return { kind: "count", name: variable, from, to: expression(), body: loopBody(t), at: t };
      }
      if (!word("in")) expected("'in' or 'from'");
      const list = expression();
      const where = word("where"); // `for each row in sales where price of row is greater than 10`
      const cond = where && expression();
      const body = loopBody(t);
      return { kind: "each", name: variable, list, body: where ? [{ kind: "if", cond, then: body, otherwise: [], at: where }] : body, at: t };
    }
    if (word("to")) {
      const fnName = name("a function name");
      const params = [];
      const kinds = []; // what each input says it is: `with width as a number`
      const defaults = []; // what each is when a call leaves it out: `greeting or "Hello"`, or null
      if (word("with")) {
        do {
          const at = peek();
          params.push(name("an input name"));
          kinds.push(word("as") ? kind() : -1);
          const fallback = word("or") ? unary() : null;
          if (fallback && !fallbackFits(fallback)) fail(fallback.at, `an input's 'or' is what it is when a call leaves it out: a number, text, yes, no, nothing, or a list of them, written out`);
          if (!fallback && defaults.some((d) => d)) fail(at, `'${params.at(-1)}' needs an 'or' too, as an input before it has one`);
          defaults.push(fallback);
        } while (match(",") || word("and"));
      }
      const made = { ...func(fnName, params, t), kinds };
      if (defaults.some((d) => d)) made.defaults = defaults;
      reading.defines.push(made);
      return made;
    }
    if (word("when")) { // `when a key is pressed with key`, `when the mouse is clicked with x and y`
      const start = pos;
      let phrase;
      let known;
      let label; // the button or text box it waits for, worked out once, when it's set up
      if (wordsAt(pos, ["the", "button"])) { // `when the button "Start" is clicked`
        pos += 2;
        label = additive();
        expectWord("is");
        expectWord("clicked");
        [phrase, known] = ["the button is clicked", { event: "button", gives: 0 }];
      } else if (wordsAt(pos, ENTER_PHRASE)) { // `when enter is pressed in the text box "Name" with words`
        pos += ENTER_PHRASE.length;
        label = additive();
        [phrase, known] = ["enter is pressed in the text box", { event: "enter", gives: 1 }];
      } else if (wordsAt(pos, ["the", "checkbox"])) { // `when the checkbox "Done" is clicked`
        pos += 2;
        label = additive();
        expectWord("is");
        expectWord("clicked");
        [phrase, known] = ["the checkbox is clicked", { event: "checkbox", gives: 0 }];
      } else if (wordsAt(pos, CHOSEN_PHRASE) || wordsAt(pos, CHOSEN_IN_DROPDOWN)) { // `when an item is chosen in the list "Fruits" with item`
        pos += CHOSEN_PHRASE.length;
        phrase = `an item is chosen in the ${tokens[pos - 1].value}`;
        label = additive();
        known = { event: "choice", gives: 1 };
      } else if (wordsAt(pos, ["the", "slider"])) { // `when the slider "Volume" is moved with volume`
        pos += 2;
        label = additive();
        expectWord("is");
        expectWord("moved");
        [phrase, known] = ["the slider is moved", { event: "slider", gives: 1 }];
      } else {
        const words = [];
        while (check("word") && !isWord("with") && !peek().nl) words.push(tokens[pos++].value);
        phrase = words.join(" ");
        known = EVENT_PHRASES.get(phrase);
      }
      if (!known) {
        pos = start;
        expected("'a key is pressed', 'the mouse is clicked', 'the mouse is dragged', 'the button ... is clicked', 'enter is pressed in the text box ...', 'the checkbox ... is clicked', 'an item is chosen in the list ...' or 'the slider ... is moved'");
      }
      const params = [];
      if (known.gives && word("with")) do params.push(name("an input name")); while (match(",") || word("and"));
      if (params.length && params.length !== known.gives) {
        fail(t, `'when ${phrase}' gives ${known.gives === 1 ? "1 value" : `${known.gives} values`}, so name ${known.gives === 1 ? "one input" : `${known.gives} inputs`} or none, not ${params.length}`);
      }
      if (!atTop) fail(t, "'when' only works at the top level of a program");
      if (label) return { kind: "when", event: known.event, label, fn: func(`when ${phrase}`, params, t), at: t };
      return { kind: "when", event: known.event, fn: func(`when ${phrase}`, params, t), at: t };
    }
    if (word("every")) { // `every 100 milliseconds`, `every 2 seconds`
      let interval = additive();
      let unit = interval.kind === "builtin" && interval.name === "unit" ? unitNamed(interval.args[1].value) : undefined;
      if (unit !== undefined && UNITS[unit][2] === 1) interval = interval.args[0]; // `every 2 seconds`: the number, and its unit
      else if (unitAt(pos) && UNITS[unitNamed(peek().value)][2] === 1) unit = unitNamed(tokens[pos++].value); // `every n seconds`
      else expected("'milliseconds' or 'seconds'");
      if (!atTop) fail(t, "'every' only works at the top level of a program");
      return { kind: "every", interval, unit: UNITS[unit][3] * 1000, fn: func("every", [], t), at: t };
    }
    if (word("return")) {
      if (!fnDepth) fail(t, "'return' only works inside a function (one made with 'to')");
      return { kind: "return", value: peek().nl ? null : expression(), at: t };
    }
    if (word("fail")) {
      expectWord("with");
      return { kind: "fail", value: expression(), at: t };
    }
    if (word("try")) {
      if (!peek().nl) expected("a new line");
      const body = statements(t, true);
      if (!isIfItFails()) expected("'if it fails'");
      pos += 3;
      const caught = word("with") ? name("a variable name") : null;
      return { kind: "try", body, name: caught, handler: blockEnd(t), at: t };
    }
    if (word("use")) {
      if (isWord("the") && !peek().nl && wordAt(pos + 1, "library")) return library(t);
      // `use the package "json" as json`: what `moth add` put in packages/json, its main file json.moth
      const aPackage = isWord("the") && !peek().nl && wordAt(pos + 1, "package") && !tokens[pos + 1].nl && ((pos += 2), true);
      const nameToken = match("string") || expected(aPackage ? "a package's name in quotes, like \"json\"" : "a file name in quotes, like \"shapes.moth\"");
      if (aPackage && !/^[A-Za-z0-9_.-]+$/.test(nameToken.value)) fail(nameToken, `'${nameToken.value}' isn't a package's name: letters, digits, '-', '_' and '.' make one`);
      const alias = word("as") ? name(aPackage ? "a name for the package" : "a name for the file") : null; // `use "math.moth" as math`
      if (alias) aliases.add(alias);
      if (!atTop) fail(t, "'use' only works at the top level of a program");
      const file = aPackage ? { ...nameToken, value: `packages/${nameToken.value}/${nameToken.value}.moth` } : nameToken;
      return { kind: "use", body: useFile(file, alias, aPackage), at: t };
    }
    if (word("stop")) {
      if (isWord("the") && !peek().nl && wordAt(pos + 1, "program")) { // `stop the program`, `stop the program with 2`
        pos += 2;
        return { kind: "exit", value: !peek().nl && word("with") ? expression() : null, at: t };
      }
      if (!loopDepth) fail(t, "'stop' only works inside a loop (one made with 'repeat' or 'for each')");
      return { kind: "stop", at: t };
    }
    if (word("remove")) { // `remove "Sam" from ages`, `remove the file "old.txt"`
      if (isWord("the") && !peek().nl && wordAt(pos + 1, "file")) {
        pos += 2;
        return { kind: "removeFile", target: additive(), at: t };
      }
      const key = additive();
      expectWord("from");
      return { kind: "remove", key, target: unary(), at: t };
    }
    if (word("expect")) return { kind: "expect", cond: expression(), at: t }; // `expect total(2, 3) is 5`
    if (playsSound()) { // `play note "C4" for 0.5 seconds`, `play note 440 for 200 milliseconds`, `play a beep`
      pos++;
      if (word("a")) {
        pos++;
        return { kind: "play", note: null, time: null, unit: 0, at: t };
      }
      pos++;
      const note = additive();
      expectWord("for");
      // how long, as `every` takes it: `for 2 seconds`, `for n milliseconds`; and `for n * 100 milliseconds`
      // and `for -1 seconds` (which fails) too, the unit at the end counting what comes before it
      let time = additive();
      let unit;
      const found = timed(time);
      if (found) [time, unit] = found;
      else if (unitAt(pos) && UNITS[unitNamed(peek().value)][2] === 1) unit = unitNamed(tokens[pos++].value);
      else expected("'milliseconds' or 'seconds'");
      return { kind: "play", note, time, unit: UNITS[unit][3] * 1000, at: t };
    }
    if (word("write")) { // `write "hello" to "notes.txt"`: the file's name is its target
      const value = expression();
      expectWord("to");
      return { kind: "write", value, target: expression(), at: t };
    }
    const turtle = t.type === "word" && TURTLE_WORDS.get(t.value);
    if (turtle) {
      pos++;
      const action = turtle.find(isWord);
      if (!action) expected(turtle.map((w) => `'${w}'`).join(" or "));
      pos++;
      if (action === "to") return { kind: "turtle", action, value: several(2, t), at: t }; // `move to x, y`
      return { kind: "turtle", action, value: action === "up" || action === "down" ? null : expression(), at: t };
    }
    if (word("clear")) {
      if (wordsAt(pos, ["the", "text", "box"]) || wordsAt(pos, ["the", "text", "area"])) { // `clear the text box "Name"`: empties it
        pos += 3;
        return { kind: "turtle", action: "clear text box", value: additive(), at: t };
      }
      return { kind: "turtle", action: "clear", value: null, at: t }; // wipe the picture
    }
    if (word("draw")) { // `draw box at x, y size w by h`, `draw circle at x, y size r`, `draw "hi" at x, y size 20`
      if (isWord("chart") && tokens[pos + 1].type === "word" && tokens[pos + 1].value === "of") { // `draw chart of sales`
        pos += 2;
        return { kind: "turtle", action: "chart", value: column(expression), at: t };
      }
      const after = isWord("picture") && tokens[pos + 1];
      if (after && !after.nl && (after.type === "string" || after.type === "number" || (after.type === "word" && !CARRY_ON.includes(after.value))
        || (after.type === "(" && after.col > peek().col + 7))) {
        pos++; // `draw picture "cat.png" at x, y size w by h`: a file's name, or its bytes
        const what = expression();
        expectWord("at");
        const place = several(2, t);
        const none = { kind: "value", value: null, at: t }; // no size: as big as it is
        const size = word("size") ? [additive(), (expectWord("by"), expression())] : [none, none];
        return { kind: "turtle", action: "picture", value: { ...place, items: [what, ...place.items, ...size] }, at: t };
      }
      // `draw button "Start" at x, y`, `draw text box "Name" at x, y`: a value straight after `button` (which
      // a name couldn't have) or `text box`
      const widget = isWord("button") && labelAt(pos + 1) ? "button" : wordsAt(pos, ["text", "box"]) ? "text box"
        : isWord("checkbox") && labelAt(pos + 1) ? "checkbox" : null;
      // `draw text area "Notes" at x, y size w by h`, `draw list "Fruits" showing fruits at x, y size w by h`
      const tall = wordsAt(pos, ["text", "area"]) ? "text area" : isWord("list") && labelAt(pos + 1) ? "list" : null;
      // `draw dropdown "Size" showing sizes at x, y`, `draw slider "Volume" from 0 to 100 at x, y`
      if ((isWord("dropdown") || isWord("slider")) && labelAt(pos + 1)) {
        const control = tokens[pos++].value;
        const label = additive();
        const middle = control === "dropdown" ? [(expectWord("showing"), additive())] : [(expectWord("from"), additive()), (expectWord("to"), additive())];
        expectWord("at");
        const place = several(2, t);
        return { kind: "turtle", action: control, value: { ...place, items: [label, ...middle, ...place.items] }, at: t };
      }
      if (tall) {
        pos += tall === "list" ? 1 : 2;
        const label = additive();
        const items = tall === "list" ? [(expectWord("showing"), additive())] : [];
        expectWord("at");
        const place = several(2, t);
        const none = { kind: "value", value: null, at: t }; // no size: the usual one
        const size = word("size") ? [additive(), (expectWord("by"), expression())] : [none, none];
        return { kind: "turtle", action: tall, value: { ...place, items: [label, ...items, ...place.items, ...size] }, at: t };
      }
      if (widget) {
        pos += widget === "text box" ? 2 : 1;
        const label = additive();
        expectWord("at");
        const place = several(2, t);
        return { kind: "turtle", action: widget, value: { ...place, items: [label, ...place.items] }, at: t };
      }
      const shape = ["box", "circle"].find((w) => isWord(w) && tokens[pos + 1].type === "word" && tokens[pos + 1].value === "at");
      if (shape) {
        pos += 2;
        const place = several(2, t);
        expectWord("size");
        const sizes = shape === "box" ? [additive(), (expectWord("by"), expression())] : [expression()];
        return { kind: "turtle", action: shape, value: { ...place, items: [...place.items, ...sizes] }, at: t };
      }
      const text = expression();
      expectWord("at");
      const place = several(2, t);
      const size = word("size") ? expression() : { kind: "value", value: null, at: t }; // no size: the usual one
      return { kind: "turtle", action: "text", value: { ...place, items: [text, ...place.items, size] }, at: t };
    }
    if (isWord("run") && runsProgram()) fail(t, "'run program' gives back the number the program ended with, so it goes where a value goes: 'set code to run program ...'");
    const ticking = ["tick", "untick"].find((w) => isWord(w) && wordsAt(pos + 1, ["the", "checkbox"])); // `tick the checkbox "Done"`
    if (ticking) {
      pos += 3;
      return { kind: "turtle", action: ticking, value: additive(), at: t };
    }
    if (isWord("send") && sendsData()) fail(t, "'send' gives back what the site replies, so it goes where a value goes: 'set reply to send ...'");
    // `start count(10)`, a task whose call runs on a thread of its own (see "start" in vm.js), and `wait for job`,
    // done for what they do: `start` alone, or before a bracket, is still a name, and so is `wait`
    if (isWord("start") && !tokens[pos + 1].nl && tokens[pos + 1].type === "word") {
      const started = phrase(() => {
        const call = primary();
        return call.kind === "call" && peek().nl ? call : null;
      });
      if (started) return { kind: "do", value: { kind: "builtin", name: "start", args: [started], at: t }, at: t };
    }
    if (isWord("wait") && !tokens[pos + 1].nl && wordAt(pos + 1, "for")) {
      pos += 2;
      return { kind: "do", value: { kind: "builtin", name: "wait for", args: [expression()], at: t }, at: t };
    }
    if (isWord("wait") && !tokens[pos + 1].nl) { // `wait 2 seconds`, `wait n milliseconds`: `wait` alone is still a name
      const waiting = phrase(() => {
        let amount = additive();
        const timed = (e) => e.kind === "builtin" && e.name === "unit" && UNITS[unitNamed(e.args[1].value)][2] === 1;
        let unit;
        if (timed(amount)) { // `wait 2 seconds`: the number, and its unit
          unit = unitNamed(amount.args[1].value);
          amount = amount.args[0];
        } else if (amount.kind === "negate" && timed(amount.operand)) { // `wait -2 seconds`, which is a mistake when it runs
          unit = unitNamed(amount.operand.args[1].value);
          amount = { ...amount, operand: amount.operand.args[0] };
        } else if (unitAt(pos) && UNITS[unitNamed(peek().value)][2] === 1) unit = unitNamed(tokens[pos++].value); // `wait n seconds`
        else return null;
        return peek().nl ? { kind: "wait", amount, unit: UNITS[unit][3] * 1000, at: t } : null;
      });
      if (waiting) return waiting;
    }
    if (isWord("save") && !tokens[pos + 1].nl) { // `save scores to "scores.txt"`: `write` of what `load` reads back
      const saving = phrase(() => {
        const value = expression();
        if (!word("to")) return null;
        return { kind: "write", value: { kind: "builtin", name: "save", args: [value], at: t }, target: expression(), at: t };
      });
      if (saving) return saving;
    }
    if (t.type === "word" && !RESERVED.has(t.value)) {
      // a line that starts with a name calls it: `greet "Sam"` or `greet("Sam")`
      pos++;
      const called = member(t.value);
      if (called === t.value && check("'s")) { // `rex's bark()`, or `rex's rename "Max"`
        const made = possessive({ kind: "name", name: t.value, at: t });
        if (made.kind === "call") return made;
        const args = [made.of];
        if (!peek().nl) do args.push(expression()); while (match(","));
        return madeCall(made.name, args, made.at);
      }
      if (isWord("is")) fail(t, `to give '${called}' a value write 'set ${called} to ...'`);
      let args = [];
      if (tight(match("("))) args = argList();
      else if (!peek().nl) do args.push(expression()); while (match(","));
      return madeCall(called, args, t);
    }
    fail(t, `a line can't start with ${describe(t)}`);
  }

  // `a number`, `text`, `yes or no`...: what an input says it is (one of KINDS in vm.js), after its `as`
  function kind() {
    const phrases = KINDS.map((k) => k.split(" "));
    const at = phrases.findIndex((words) => words.every((w, i) => tokens[pos + i].type === "word" && tokens[pos + i].value === w));
    if (at < 0) expected(`what kind of value it is (${KINDS.map((k) => `'${k}'`).join(", ").replace(/, ([^,]*)$/, " or $1")})`);
    pos += phrases[at].length;
    return at;
  }

  // the body of a function, made with `to`, or an app's handler (`when`, `every`), which starts outside any loop
  function func(fnName, params, t) {
    const outside = loopDepth;
    fnDepth++;
    loopDepth = 0;
    const body = blockEnd(t);
    fnDepth--;
    loopDepth = outside;
    return { kind: "define", name: fnName, params, body, at: t };
  }

  function ifRest(t) {
    const cond = expression();
    const then = block(t);
    let otherwise = [];
    if (word("else")) {
      const elseIf = !peek().nl && word("if"); // an `if` on the next line starts a new if inside the else
      if (elseIf) return { kind: "if", cond, then, otherwise: [ifRest(elseIf)], at: t };
      otherwise = block(t);
    }
    expectWord("end");
    return { kind: "if", cond, then, otherwise, at: t };
  }

  function expression() {
    let left = and();
    for (let t; (t = word("or")); ) left = { kind: "or", left, right: and(), at: t };
    return left;
  }

  function and() {
    let left = not();
    for (let t; (t = word("and")); ) left = { kind: "and", left, right: not(), at: t };
    return left;
  }

  function not() {
    const t = word("not");
    return t ? { kind: "not", operand: not(), at: t } : comparison();
  }

  function comparison() {
    const left = bitwise();
    const t = word("is");
    if (!t) return left;
    const negate = Boolean(word("not"));
    const phrase = check("word") && tokens[pos + 1].type === "word" ? `${peek().value} ${tokens[pos + 1].value}` : "";
    const op = Object.hasOwn(COMPARISONS, phrase) ? ((pos += 2), phrase) : word("in") ? "in" : "is";
    return { kind: "compare", op, negate, left, right: bitwise(), at: t };
  }

  function bitwise() {
    let left = additive();
    while (isWord("bit") && tokens[pos + 1].type === "word" && BIT_WORDS.includes(tokens[pos + 1].value)) {
      const t = peek();
      const name = `bit ${tokens[pos + 1].value}`;
      pos += 2;
      left = { kind: "builtin", name, args: [left, additive()], at: t };
    }
    return left;
  }

  // `price in sales`, after `total of` and `draw chart of`: the price of each row; anything else is `rest()`
  function column(rest) {
    if (!check("word") || RESERVED.has(peek().value) || tokens[pos + 1].type !== "word" || tokens[pos + 1].value !== "in") return rest();
    const field = tokens[pos];
    pos += 2;
    return { kind: "builtin", name: "column", args: [{ kind: "value", value: field.value, at: field }, rest()], at: field };
  }

  function additive() {
    let left = multiplicative();
    for (let t; (t = match("+") || match("-")); ) left = { kind: "math", op: t.type, left, right: multiplicative(), at: t };
    // `trip in miles`: an amount in another unit that measures the same
    while (converting && isWord("in") && unitAt(pos + 1)) {
      const t = tokens[pos++];
      const unit = tokens[pos++];
      left = { kind: "builtin", name: "in", args: [left, { kind: "value", value: unit.value, at: unit }], at: t };
    }
    // `scores in order`, `scores in reverse order`, `people in order by age`
    if (converting && isWord("in") && !tokens[pos + 1].nl && (wordAt(pos + 1, "order") || (wordAt(pos + 1, "reverse") && wordAt(pos + 2, "order")))) {
      const t = tokens[pos++];
      const how = word("reverse") ? "reverse order" : "order";
      pos++;
      if (isWord("by") && !tokens[pos + 1].nl) {
        pos++;
        const field = peek();
        return { kind: "builtin", name: `${how} by`, args: [left, { kind: "value", value: name("a field name"), at: field }], at: t };
      }
      return { kind: "builtin", name: how, args: [left], at: t };
    }
    return left;
  }

  function multiplicative() {
    let left = postfix(unary());
    for (let t; (t = match("*") || match("/")); ) left = { kind: "math", op: t.type, left, right: postfix(unary()), at: t };
    return left;
  }

  // `100 bytes`, `block as text`
  function postfix(e) {
    for (;;) {
      const t = peek();
      if (isWord("to") && !t.nl && wordAt(pos + 1, "the") && wordAt(pos + 2, "power") && wordAt(pos + 3, "of")) { // `2 to the power of 10`
        pos += 4;
        e = { kind: "builtin", name: "power", args: [e, postfix(unary())], at: t };
      } else if (word("bytes")) e = { kind: "builtin", name: "bytes", args: [e], at: t };
      else if (word("as")) {
        const to = AS_WORDS.find(isWord) ?? expected(AS_WORDS.map((w) => `'${w}'`).join(" or "));
        pos++;
        e = { kind: "builtin", name: `as ${to}`, args: [e], at: t };
      } else return e;
    }
  }

  function unary() {
    const t = tight(match("-"));
    return t ? { kind: "negate", operand: unary(), at: t } : primary();
  }

  function primary() {
    const t = peek();
    if (match("number")) {
      const n = { kind: "value", value: t.value, at: t };
      if (!unitAt(pos)) return n;
      const unit = tokens[pos++]; // `5 km`: an amount of a unit
      return { kind: "builtin", name: "unit", args: [n, { kind: "value", value: unit.value, at: unit }], at: t };
    }
    if (match("string")) return t.parts ? filledIn(t) : { kind: "value", value: t.value, at: t };
    if (word("yes") || word("no")) return { kind: "value", value: t.value === "yes", at: t };
    if (word("nothing")) return { kind: "value", value: null, at: t };
    if (word("list")) {
      expectWord("of");
      const items = [];
      const before = hoisted.length;
      do {
        items.push(expression());
        if (items.length === 1 && isWord("for") && !peek().nl && wordAt(pos + 1, "each")) return builtList(items[0], hoisted.splice(before), t);
      } while (match(","));
      return { kind: "list", items, at: t };
    }
    if (word("record")) {
      expectWord("with");
      const [fields, values] = [[], []];
      do {
        fields.push(name("a field name"));
        values.push(expression());
      } while (match(","));
      return { kind: "record", fields, values, at: t };
    }
    if (word("dictionary")) { // `dictionary where "Sam" is 20, "Ana" is 31`: its items are each key, then its value
      expectWord("where");
      const items = [];
      do {
        items.push(additive());
        expectWord("is");
        items.push(expression());
      } while (match(","));
      return { kind: "dictionary", items, at: t };
    }
    if (word("empty")) {
      if (word("record")) return { kind: "record", fields: [], values: [], at: t };
      if (word("dictionary")) return { kind: "dictionary", items: [], at: t };
      if (!word("list")) expected("'list', 'record' or 'dictionary'");
      return { kind: "list", items: [], at: t };
    }
    if (word("length")) {
      expectWord("of");
      return { kind: "length", of: unary(), at: t };
    }
    if (word("ask")) return { kind: "ask", question: additive(), at: t }; // `ask "How old are you? "`
    if (word("read")) { // `read "notes.txt"`, `read bytes "photo.png"`: `of` is the file's name
      if (isWord("the") && !peek().nl && wordAt(pos + 1, "folder")) { // `read the folder "tests"`
        pos += 2;
        return { kind: "readFolder", of: additive(), at: t };
      }
      if (word("table")) return { kind: "builtin", name: "table", args: [{ kind: "read", bytes: false, of: additive(), at: t }], at: t };
      const bytes = Boolean(word("bytes"));
      const of = additive();
      if (withHeaders()) return { kind: "builtin", name: bytes ? "read bytes with headers" : "read with headers", args: [of, additive()], at: t };
      return { kind: "read", bytes, of, at: t };
    }
    if (word("arguments")) return { kind: "arguments", at: t };
    if (wordsAt(pos, TEXT_IN_BOX) || wordsAt(pos, TEXT_IN_AREA)) { // `the text in the text box "Name"`: what's typed in it
      pos += TEXT_IN_BOX.length;
      return { kind: "builtin", name: "text in box", args: [unary()], at: t };
    }
    if (wordsAt(pos, VALUE_OF_SLIDER)) { // `the value of the slider "Volume"`
      pos += VALUE_OF_SLIDER.length;
      return { kind: "builtin", name: "slider value", args: [unary()], at: t };
    }
    if (wordsAt(pos, CHOOSE_FILE) && (wordAt(pos + 4, "open") || wordAt(pos + 4, "save"))) { // `choose a file to open`: asked, see DESIGN §42
      const question = { kind: "value", value: `Which file to ${tokens[pos + 4].value}?`, at: t };
      pos += CHOOSE_FILE.length + 1;
      return { kind: "builtin", name: "chosen file", args: [{ kind: "ask", question, at: t }], at: t };
    }
    if (wordsAt(pos, CHOICE_IN_LIST) || wordsAt(pos, CHOICE_IN_DROPDOWN)) { // `the choice in the list "Fruits"`: the item chosen, or nothing
      pos += CHOICE_IN_LIST.length;
      return { kind: "builtin", name: "choice in list", args: [unary()], at: t };
    }
    if (wordsAt(pos, ["the", "checkbox"])) { // `the checkbox "Done" is ticked`, or `is not ticked`
      pos += 2;
      const ticked = { kind: "builtin", name: "ticked", args: [additive()], at: t };
      expectWord("is");
      const not = word("not");
      expectWord("ticked");
      return not ? { kind: "not", operand: ticked, at: not } : ticked;
    }
    // `total of prices`, `average of price in sales`, `largest of`, `smallest of`
    if (t.type === "word" && AGGREGATES.includes(t.value) && tokens[pos + 1].type === "word" && tokens[pos + 1].value === "of") {
      pos += 2;
      return { kind: "builtin", name: t.value, args: [column(unary)], at: t };
    } // what the program was started with: `tool a b`
    if (isWord("start") && !tokens[pos + 1].nl && tokens[pos + 1].type === "word") { // `set job to start count(10)`
      const started = phrase(() => {
        const call = primary();
        return call.kind === "call" ? call : null;
      });
      if (started) return { kind: "builtin", name: "start", args: [started], at: t };
    }
    if (isWord("wait") && !tokens[pos + 1].nl && wordAt(pos + 1, "for")) { // `set answer to wait for job`
      pos += 2;
      return { kind: "builtin", name: "wait for", args: [unary()], at: t };
    }
    if (isWord("run") && runsProgram()) { // `run program "tool.exe" with (list of "a") keeping its output`
      pos += 2;
      const program = additive();
      const inputs = !peek().nl && word("with") ? additive() : { kind: "list", items: [], at: t };
      const keeping = !peek().nl && isWord("keeping") && wordAt(pos + 1, "its") && wordAt(pos + 2, "output");
      if (keeping) pos += 3;
      return { kind: "builtin", name: keeping ? "run program keeping" : "run program", args: [program, inputs], at: t };
    }
    // `the time`, `the date`, `the year` ... `the weekday`, `the clock`
    if (isWord("the") && !tokens[pos + 1].nl && tokens[pos + 1].type === "word" && NOW_WORDS.includes(tokens[pos + 1].value)) {
      pos += 2;
      return { kind: "now", which: NOW_WORDS.indexOf(tokens[pos - 1].value), at: t };
    }
    if (isWord("send") && sendsData()) { // `send data to "https://..."`, maybe `with headers h`
      pos++;
      const body = expression();
      expectWord("to");
      const address = additive();
      if (withHeaders()) return { kind: "builtin", name: "send with headers", args: [body, address, additive()], at: t };
      return { kind: "builtin", name: "send", args: [body, address], at: t };
    }
    if (isWord("json") && jsonFrom()) { // `json from reply`: what JSON text says
      pos += 2;
      return { kind: "builtin", name: "json from", args: [additive()], at: t };
    }
    if (isWord("load") && loadsFile()) { // `load "scores.txt"`: a value `save` wrote, read back
      pos++;
      return { kind: "builtin", name: "load", args: [{ kind: "read", bytes: false, of: additive(), at: t }], at: t };
    }
    // `random number from 1 to 6`: `random` alone is still a name (math.moth makes a function of it)
    if (isWord("random") && tokens[pos + 1].type === "word" && tokens[pos + 1].value === "number" && tokens[pos + 2].type === "word" && tokens[pos + 2].value === "from") {
      pos += 3;
      const low = additive();
      expectWord("to");
      return { kind: "random", left: low, right: additive(), at: t };
    }
    const syntax = t.type === "word" && BUILTIN_SYNTAX.get(t.value);
    if (syntax) {
      pos++;
      if (syntax[0]) expectWord(syntax[0]);
      if (syntax.length === 1) return { kind: "builtin", name: t.value, args: [unary()], at: t };
      const outside = converting;
      converting = syntax[1] !== "in";
      const first = additive();
      converting = outside;
      expectWord(syntax[1]);
      return { kind: "builtin", name: t.value, args: [first, additive()], at: t };
    }
    if (word("shift")) { // `shift x left by 2`
      const value = additive();
      const way = ["left", "right"].find(isWord) ?? expected("'left' or 'right'");
      pos++;
      expectWord("by");
      return { kind: "builtin", name: `shift ${way}`, args: [value, additive()], at: t };
    }
    if (isWord("function") && (wordAt(pos + 1, "with") || wordAt(pos + 1, "gives")) && !tokens[pos + 1].nl) { // `function with x gives x * 2`
      pos++;
      const params = [];
      if (word("with")) do params.push(name("an input name")); while (match(",") || word("and"));
      expectWord("gives");
      const outside = hoisted;
      hoisted = [];
      const value = expression();
      const body = [...hoisted, { kind: "return", value, at: t }]; // functions its value makes are its own
      hoisted = outside;
      return { kind: "name", name: unnamed("function", params, body, t), at: t };
    }
    if (isWord("items") && !tokens[pos + 1].nl) { // `items 2 to 4 of xs`; `items` alone is still a name
      const outside = indexing;
      const slice = phrase(() => {
        indexing = true;
        const from = additive();
        expectWord("to");
        const upto = additive();
        indexing = outside;
        expectWord("of");
        return { kind: "builtin", name: "items", args: [from, upto, unary()], at: t };
      });
      indexing = outside;
      if (slice) return slice;
    }
    if (word("item") || word("byte")) { // `byte 5 of block` is another way to say `item 5 of block`
      const outside = indexing;
      indexing = true;
      const index = additive();
      indexing = outside;
      expectWord("of");
      return { kind: "item", index, of: unary(), at: t };
    }
    if (match("(")) {
      const [outside, wasConverting] = [indexing, converting];
      [indexing, converting] = [false, true];
      const inner = expression();
      [indexing, converting] = [outside, wasConverting];
      if (!match(")")) expected("')'");
      return possessive(inner); // `(item 2 of dogs)'s name`
    }
    if (t.type === "word" && !RESERVED.has(t.value)) {
      pos++;
      const full = member(t.value);
      if (tight(match("("))) return possessive(madeCall(full, argList(), t));
      if (full === t.value && !indexing && word("of")) return { kind: "field", name: t.value, of: unary(), at: t }; // `name of person`
      return possessive({ kind: "name", name: full, at: t });
    }
    expected("a value");
  }

  // `2 seconds`, `n * 100 milliseconds`, `-1 seconds`: the value with the amount of time at its end made its
  // number, and that amount's unit; or nothing, if it doesn't end with an amount of time
  function timed(e) {
    if (e.kind === "builtin" && e.name === "unit") return UNITS[unitNamed(e.args[1].value)][2] === 1 ? [e.args[0], unitNamed(e.args[1].value)] : null;
    if (e.kind !== "negate" && e.kind !== "math") return null;
    const inner = timed(e.kind === "negate" ? e.operand : e.right);
    return inner && [e.kind === "negate" ? { ...e, operand: inner[0] } : { ...e, right: inner[0] }, inner[1]];
  }

  // `n` values with commas between them, as a list: the x, y of `move to x, y` and the like
  function several(n, t) {
    const items = [expression()];
    while (items.length < n) {
      if (!match(",")) expected("','");
      items.push(expression());
    }
    return { kind: "list", items, at: t };
  }

  // "Hi {name}!" is "Hi " + name + "!", which joins them as `say` does; text comes first, so "{a}{b}" is
  // text too. Each value is read from its own tokens, as if it were in brackets.
  function filledIn(t) {
    const outside = [tokens, pos, indexing, converting];
    let node = typeof t.parts[0] === "string" ? null : { kind: "value", value: "", at: t };
    try {
      for (const part of t.parts) {
        let piece = { kind: "value", value: part, at: t };
        if (typeof part !== "string") {
          [tokens, pos, indexing, converting] = [part, 0, false, true];
          piece = expression();
          if (!check("}")) fail(peek(), `expected '}' but found ${describe(peek())} (${BRACE_HINT})`);
        }
        node = node ? { kind: "math", op: "+", left: node, right: piece, at: t } : piece;
      }
    } finally {
      [tokens, pos, indexing, converting] = outside;
    }
    return node;
  }

  // A function with no name of its own, made before the statement it's in runs, with one that no name can be:
  // `function on line 3`, then `function on line 3 (2)`. Gives that name.
  function unnamed(what, params, body, t) {
    const n = (unnamedOnLine.get(`${what} ${t.line}`) ?? 0) + 1;
    unnamedOnLine.set(`${what} ${t.line}`, n);
    const named = `${what} on line ${t.line}${n > 1 ? ` (${n})` : ""}`;
    hoisted.push({ kind: "define", name: named, params, body, at: t, kinds: params.map(() => -1) });
    return named;
  }

  // `list of x * 2 for each x in xs where x is greater than 1`: a call to a function, made before the statement,
  // that goes through what it's given, calling one function of x for each item (`list on line 3`) and, with
  // `where`, another that says whether to keep it, as each item's own input, so x is theirs alone
  // `valueMade`: the functions the item's value made, which are the first function's own.
  function builtList(value, valueMade, t) {
    pos += 2;
    const variable = name("a variable name");
    expectWord("in");
    const over = expression();
    const outside = hoisted;
    hoisted = [];
    const keep = word("where") ? expression() : null;
    const keepMade = hoisted;
    hoisted = outside;
    const at = (kind, rest) => ({ ...rest, kind, at: t });
    const each = unnamed("list", [variable], [...valueMade, at("return", { value })], t);
    const test = keep && unnamed("test for the list", [variable], [...keepMade, at("return", { value: keep })], t);
    const [items, made, one] = ["the items", "the list made", "each item"];
    const call = (named) => at("call", { name: named, args: [at("name", { name: one })] });
    const adding = at("add", { name: made, value: call(each) });
    const loop = at("each", { name: one, list: at("name", { name: items }), body: [test ? at("if", { cond: call(test), then: [adding], otherwise: [] }) : adding] });
    const builder = unnamed("building the list", [items], [at("set", { name: made, value: at("list", { items: [] }) }), loop, at("return", { value: at("name", { name: made }) })], t);
    return madeCall(builder, [over], t);
  }

  function argList() {
    const outside = indexing;
    indexing = false;
    const args = [];
    while (!check(")")) {
      args.push(expression());
      if (!match(",")) break;
    }
    if (!match(")")) expected("')'");
    indexing = outside;
    return args;
  }

  const made = statements(null);
  if (--reading.depth === 0) fillDefaults(reading);
  return made;
}

// A call by a function's name that leaves inputs out, `greet("Sam")` for `to greet with name, greeting or
// "Hello"`, gets what each was given after its `or`, once the whole program is read, so every engine sees a
// call with all of them. A function made more than once with that name: its last. Through a value, a call
// needs them all.
function fillDefaults(reading) {
  const withDefaults = new Map();
  for (const f of reading.defines) withDefaults.set(f.name, f.defaults ? f : null);
  for (const call of reading.calls) {
    const f = withDefaults.get(call.name);
    if (!f || call.args.length >= f.params.length || f.defaults.slice(call.args.length).includes(null)) continue;
    call.args.push(...f.defaults.slice(call.args.length).map(copied));
  }
}
const copied = (node) => (Array.isArray(node) ? node.map(copied) : node?.kind ? Object.fromEntries(Object.entries(node).map(([k, v]) => [k, k === "at" ? v : copied(v)])) : node);

// what can come after an input's `or`: a value written out, or a list of them
const fallbackFits = (e) => e.kind === "value" || (e.kind === "negate" && e.operand.kind === "value" && typeof e.operand.value === "number")
  || (e.kind === "list" && e.items.every(fallbackFits)) || (e.kind === "dictionary" && e.items.length === 0) || (e.kind === "record" && e.fields.length === 0);

// `use "math.moth" as math`: each name in the file becomes `math's pi`, `math's sine`, which no name in the
// program can be, so the file keeps its own top level, as if it ran alone. The file's code is then the
// program's, as with any `use`. A function's inputs, and the functions a function makes, are left alone,
// since nothing outside the function can reach them; every other name is renamed, so a variable only a
// function in the file sets stays that function's own, and a name the file never makes isn't the program's.
// What a library's function can take and give, and what Moth checks each input is (see KINDS in vm.js, and -1
// for anything): a number is a double, a float a float, a whole number an int, a long whole number 64 bits,
// and a pointer a whole number, nothing or bytes; text is UTF-8, wide text wchar_t's (UTF-16 on Windows). A
// structure is a record, or nothing, and a callback a function.
const LIBRARY_TYPES = { "a number": 0, "a float": 0, "a whole number": 0, "a long whole number": 0, "a pointer": -1, "text": 1, "wide text": 1, "bytes": 6, "yes or no": 2 };

const NAMED = new Set(["set", "add", "count", "each", "define", "call", "name", "try"]); // nodes whose `name` is a variable
function prefixed(body, alias) {
  const walk = (node, hidden, handler) => {
    if (NAMED.has(node.kind) && node.name != null && !hidden.has(node.name) && !handler) node.name = `${alias}'s ${node.name}`;
    const inside = node.kind === "define" ? new Set([...hidden, ...node.params, ...declarations(node.body).own]) : hidden;
    for (const [key, child] of Object.entries(node)) { // a `when` or `every`'s function (`fn`) has a name that isn't a variable
      if (key !== "at") for (const c of Array.isArray(child) ? child : [child]) if (c?.kind) walk(c, key === "body" ? inside : hidden, key === "fn");
    }
  };
  for (const s of body) walk(s, new Set());
  return body;
}

// ---------- bytecode compiler ----------

const { GET, SET, CONST, JUMP, JUMP_IF_FALSE, COMPARE, ADD, SUB, MUL, DIV, CALL, GET_FN, RETURN, POP, AND, OR, NEG, NOT,
  LIST, LENGTH, ITEM, ITEM_REF, SET_ITEM, ADD_TO, SAY, CHECK_REPEAT, REPEAT_NEXT, CHECK_RANGE, RANGE_NEXT, ITER, ITER_NEXT,
  MAKE_FN, UNDEFINED, HALT, LINE, TURTLE, RECORD, FIELD, RECORD_REF, SET_FIELD, FAIL, BUILTIN, ASK, TRY, END_TRY, CAUGHT, DICT, REMOVE, READ, WRITE, ARGUMENTS, EXPECT, RANDOM, HANDLE, EVERY, SAY_ERROR, EXIT, REMOVE_FILE, NOW, WAIT,
  READ_FOLDER, PLAY } = OP;
const MATH_OPS = { "+": ADD, "-": SUB, "*": MUL, "/": DIV };
const LOOPS = new Set(["while", "repeat", "count", "each"]);

// Compiles one function (or the whole program) to bytecode for vm.js. Scope (scope.js) has already given
// every variable a slot, so a name becomes a (depth, slot) pair here.
class Compiler extends Scope {
  constructor(parent, name, params, body, options) {
    super(parent, name, params, body, options);
    Object.assign(this.fn, { code: [], consts: [], at: [] });
    this.loops = []; // the loops being compiled, innermost last: how much each keeps on the stack, and its stops
    this.tries = 0; // `try`s around the code being compiled, in this function
    for (const s of body) this.statement(s);
    if (parent) this.emit(null, CONST, this.constant(null), RETURN);
    else this.emit(null, HALT);
  }

  // In a debug build, the machine can pause here: a statement on this line is about to run.
  mark(s) {
    if (this.debug && !s.at.file) this.emit(s.at, LINE, s.at.line); // the debugger steps through this file, not the ones it uses
  }

  emit(at, ...code) {
    this.fn.at[this.fn.code.length] = at;
    this.fn.code.push(...code);
  }

  constant(value) {
    return this.fn.consts.push(value) - 1;
  }

  here() {
    return this.fn.code.length;
  }

  jump(at, op, to = -1) {
    this.emit(at, op, to);
    return this.here() - 1; // where the target goes, for patch()
  }

  patch(i) {
    this.fn.code[i] = this.here();
  }

  // A name nothing ever sets: fail when this line runs (with any "did you mean" from Scope).
  undefinedName(name, at, options) {
    this.emit(at, UNDEFINED, this.constant(this.undefinedMessage(name, options)));
  }

  load(name, at) {
    const found = this.resolve(name);
    if (found) this.emit(at, GET, ...found, this.constant(name));
    else this.undefinedName(name, at);
  }

  store(name, at) {
    this.emit(at, SET, ...this.resolve(name)); // always found: declarations() saw every name that is stored
  }

  // `state` is how many values the loop keeps on the stack while it runs, which a `stop` takes off
  loop(s, next, state) {
    const top = this.here();
    const exit = this.jump(s.at, next);
    if (s.name) this.store(s.name, s.at);
    this.mark(s); // every round pauses on the loop's line, after the loop variable has its new value
    this.body(s.body, state);
    this.jump(s.at, JUMP, top);
    this.patch(exit);
    this.patchStops();
  }

  body(statements, state) {
    this.loops.push({ state, stops: [], tries: this.tries });
    for (const inner of statements) this.statement(inner);
  }

  patchStops() {
    for (const i of this.loops.pop().stops) this.patch(i);
  }

  call(e, statement = false) {
    const found = this.resolve(e.name);
    if (found) this.emit(e.at, GET_FN, ...found, this.constant(e.name));
    else this.undefinedName(e.name, e.at, { call: true, statement });
    for (const arg of e.args) this.expr(arg);
    this.emit(e.at, CALL, e.args.length, this.constant(e.name));
  }

  statement(s) {
    if (!LOOPS.has(s.kind)) this.mark(s); // loops mark each round instead
    switch (s.kind) {
      case "set":
        this.expr(s.value);
        this.store(s.name, s.at);
        return;
      case "setItem":
        this.expr(s.target.of);
        this.expr(s.target.index);
        this.emit(s.target.at, ITEM_REF);
        this.expr(s.value);
        this.emit(s.target.at, SET_ITEM); // fails if the value can't go there, like 300 in a byte
        return;
      case "add": {
        this.expr(s.value);
        const found = this.resolve(s.name);
        if (found) this.emit(s.at, ADD_TO, ...found, this.constant(s.name));
        else this.undefinedName(s.name, s.at);
        return;
      }
      case "say":
        for (const part of s.parts) this.expr(part);
        this.emit(s.at, s.errors ? SAY_ERROR : SAY, s.parts.length);
        return;
      case "exit":
        if (s.value) this.expr(s.value);
        else this.emit(s.at, CONST, this.constant(0));
        this.emit(s.at, EXIT);
        return;
      case "if": {
        this.expr(s.cond);
        const toElse = this.jump(s.at, JUMP_IF_FALSE);
        for (const inner of s.then) this.statement(inner);
        const toEnd = this.jump(s.at, JUMP);
        this.patch(toElse);
        for (const inner of s.otherwise) this.statement(inner);
        this.patch(toEnd);
        return;
      }
      case "while": {
        const top = this.here();
        this.mark(s);
        this.expr(s.cond);
        const exit = this.jump(s.at, JUMP_IF_FALSE);
        this.body(s.body, 0);
        this.jump(s.at, JUMP, top);
        this.patch(exit);
        this.patchStops();
        return;
      }
      case "repeat":
        this.expr(s.count);
        this.emit(s.at, CHECK_REPEAT);
        this.loop(s, REPEAT_NEXT, 1);
        return;
      case "count":
        this.expr(s.from);
        this.expr(s.to);
        this.emit(s.at, CHECK_RANGE);
        this.loop(s, RANGE_NEXT, 2);
        return;
      case "each":
        this.expr(s.list);
        this.emit(s.at, ITER);
        this.loop(s, ITER_NEXT, 1);
        return;
      case "define": {
        const fn = new Compiler(this, s.name, s.params, s.body).fn;
        if (s.kinds.some((k) => k >= 0)) fn.kinds = s.kinds; // checked at each call (see checkKinds in vm.js)
        this.emit(s.at, MAKE_FN, this.constant(fn));
        this.store(s.name, s.at);
        return;
      }
      case "when": { // a handler is a function of its own, made and handed over, not kept in a variable
        const fn = new Compiler(this, s.fn.name, s.fn.params, s.fn.body).fn;
        if (s.label) this.expr(s.label); // the button or text box it waits for, under it
        this.emit(s.at, MAKE_FN, this.constant(fn));
        this.emit(s.at, HANDLE, EVENTS.indexOf(s.event));
        return;
      }
      case "every": {
        const fn = new Compiler(this, s.fn.name, s.fn.params, s.fn.body).fn;
        this.expr(s.interval);
        this.emit(s.at, MAKE_FN, this.constant(fn));
        this.emit(s.at, EVERY, s.unit);
        return;
      }
      case "return":
        if (s.value) this.expr(s.value);
        else this.emit(s.at, CONST, this.constant(null));
        this.emit(s.at, RETURN);
        return;
      case "call":
        this.call(s, true);
        this.emit(s.at, POP);
        return;
      case "do": // a value done for what it does: `start count(10)`, `wait for job`
        this.expr(s.value);
        this.emit(s.at, POP);
        return;
      case "turtle":
        if (s.value) this.expr(s.value);
        this.emit(s.at, TURTLE, TURTLE_ACTIONS.indexOf(s.action));
        return;
      case "setField": // the record is checked before the value is worked out, as `set item` does
        this.expr(s.target);
        this.emit(s.at, RECORD_REF, this.constant(s.name));
        this.expr(s.value);
        this.emit(s.at, SET_FIELD, this.constant(s.name));
        return;
      case "fail":
        this.expr(s.value);
        this.emit(s.at, FAIL);
        return;
      case "remove":
        this.expr(s.key);
        this.expr(s.target);
        this.emit(s.at, REMOVE);
        return;
      case "write":
        this.expr(s.value);
        this.expr(s.target);
        this.emit(s.at, WRITE);
        return;
      case "removeFile":
        this.expr(s.target);
        this.emit(s.at, REMOVE_FILE);
        return;
      case "wait":
        this.expr(s.amount);
        this.emit(s.at, WAIT, s.unit);
        return;
      case "play": // the note, then how long, unless it's a beep
        if (s.note) {
          this.expr(s.note);
          this.expr(s.time);
        }
        this.emit(s.at, PLAY, s.unit);
        return;
      case "expect": // a comparison keeps both its sides, to say what they were
        if (s.cond.kind === "compare") {
          this.expr(s.cond.left);
          this.expr(s.cond.right);
          this.emit(s.at, EXPECT, COMPARE_OPS.indexOf(s.cond.op), s.cond.negate ? 1 : 0);
        } else {
          this.expr(s.cond);
          this.emit(s.at, EXPECT, -1, 0);
        }
        return;
      case "try": {
        const handler = this.jump(s.at, TRY);
        this.tries++;
        for (const inner of s.body) this.statement(inner);
        this.tries--;
        this.emit(s.at, END_TRY);
        const end = this.jump(s.at, JUMP);
        this.patch(handler);
        this.emit(s.at, CAUGHT);
        if (s.name) this.store(s.name, s.at);
        else this.emit(s.at, POP);
        for (const inner of s.handler) this.statement(inner);
        this.patch(end);
        return;
      }
      case "stop": { // leave the tries inside the loop, take its own values off the stack, and jump to its end
        const loop = this.loops.at(-1);
        for (let i = loop.tries; i < this.tries; i++) this.emit(s.at, END_TRY);
        for (let i = 0; i < loop.state; i++) this.emit(s.at, POP);
        loop.stops.push(this.jump(s.at, JUMP));
        return;
      }
    }
  }

  expr(e) {
    switch (e.kind) {
      case "value":
        this.emit(e.at, CONST, this.constant(e.value));
        return;
      case "name":
        this.load(e.name, e.at);
        return;
      case "call":
        this.call(e);
        return;
      case "math":
        this.expr(e.left);
        this.expr(e.right);
        this.emit(e.at, MATH_OPS[e.op]);
        return;
      case "compare":
        this.expr(e.left);
        this.expr(e.right);
        this.emit(e.at, COMPARE, COMPARE_OPS.indexOf(e.op));
        if (e.negate) this.emit(e.at, NOT);
        return;
      case "and":
      case "or": {
        this.expr(e.left);
        const end = this.jump(e.at, e.kind === "and" ? AND : OR);
        this.expr(e.right);
        this.patch(end);
        return;
      }
      case "not":
        this.expr(e.operand);
        this.emit(e.at, NOT);
        return;
      case "negate":
        this.expr(e.operand);
        this.emit(e.at, NEG);
        return;
      case "list":
        for (const item of e.items) this.expr(item);
        this.emit(e.at, LIST, e.items.length);
        return;
      case "length":
        this.expr(e.of);
        this.emit(e.at, LENGTH);
        return;
      case "item":
        this.expr(e.of);
        this.expr(e.index);
        this.emit(e.at, ITEM);
        return;
      case "record":
        for (const value of e.values) this.expr(value);
        this.emit(e.at, RECORD, this.constant(e.fields));
        return;
      case "dictionary":
        for (const x of e.items) this.expr(x);
        this.emit(e.at, DICT, e.items.length);
        return;
      case "field":
        this.expr(e.of);
        this.emit(e.at, FIELD, this.constant(e.name));
        return;
      case "ask":
        this.expr(e.question);
        this.emit(e.at, ASK);
        return;
      case "read":
        this.expr(e.of);
        this.emit(e.at, READ, e.bytes ? 1 : 0);
        return;
      case "readFolder":
        this.expr(e.of);
        this.emit(e.at, READ_FOLDER);
        return;
      case "arguments":
        this.emit(e.at, ARGUMENTS);
        return;
      case "random":
        this.expr(e.left);
        this.expr(e.right);
        this.emit(e.at, RANDOM);
        return;
      case "now":
        this.emit(e.at, NOW, e.which);
        return;
      case "builtin":
        for (const arg of e.args) this.expr(arg);
        this.emit(e.at, BUILTIN, BUILTINS.findIndex((b) => b.name === e.name));
        return;
    }
  }
}

// ---------- reading bytecode ----------

const shown = (v) => (v === null ? "nothing" : typeof v === "boolean" ? (v ? "yes" : "no") : JSON.stringify(v));

// What an instruction's operands mean, where a number alone wouldn't say.
function note(fn, op, args, scopes) {
  switch (op) {
    case "SET": return scopes.at(-1 - args[0]).names[args[1]];
    case "LINE": return `line ${args[0]}`;
    case "CONST": return shown(fn.consts[args[0]]);
    case "MAKE_FN": return `function ${fn.consts[args[0]].name}`;
    case "GET": case "GET_FN": case "ADD_TO": return fn.consts[args[2]];
    case "CALL": return fn.consts[args[1]];
    case "UNDEFINED": return fn.consts[args[0]];
    case "COMPARE": return args[0] ? `is ${COMPARE_OPS[args[0]]}` : "is";
    case "RECORD": return fn.consts[args[0]].join(", ");
    case "FIELD": case "RECORD_REF": case "SET_FIELD": return fn.consts[args[0]];
    case "BUILTIN": return BUILTINS[args[0]].name;
    default: return "";
  }
}

// Bytecode as readable text, for `moth bytecode` and the playground.
export function disassemble(fn, scopes = [fn], out = []) {
  const inputs = fn.params.map((p, i) => (fn.kinds?.[i] >= 0 ? `${p} as ${KINDS[fn.kinds[i]]}` : p));
  out.push(`${fn.name}${inputs.length ? ` with ${inputs.join(", ")}` : ""}:`);
  for (let i = 0; i < fn.code.length; ) {
    const [op, count] = OPCODES[fn.code[i]];
    const args = fn.code.slice(i + 1, i + 1 + count);
    const why = note(fn, op, args, scopes);
    out.push(`  ${String(i).padStart(4)}  ${op.padEnd(13)} ${args.join(" ").padEnd(8)}${why ? ` ; ${why}` : ""}`.trimEnd());
    i += 1 + count;
  }
  for (const c of fn.consts) if (c?.code) disassemble(c, [...scopes, c], out); // functions made inside this one
  return out.join("\n");
}

// ---------- running ----------

// Parses the source and hands the syntax tree to a back end.
// `files` gives the text of a file the program uses, by name, and `file` is the program's own name, if it has one.
function build(source, backEnd, { files, file } = {}) {
  try {
    return backEnd(parse(tokenize(source), { files, loaded: new Set(file ? [file] : []), open: file ? [file] : [] }));
  } catch (err) {
    // shortcut: points at line 1, since the overflow hides where the nesting was; only ~1,000 levels of brackets get here
    if (err instanceof RangeError) fail({ line: 1, col: 1 }, "the code is nested too deeply");
    throw err;
  }
}

// Compiles Moth source to bytecode for vm.js. Options: `slots` carries over the top-level variables of
// earlier shell entries; `debug` adds LINE markers so a debugger can pause at each statement.
export function compile(source, options) {
  return build(source, (program) => new Compiler(null, "main", [], program, options).fn, options);
}

// Compiles Moth source to JavaScript (jit.js): { source, run(print, draw, maxSteps) }.
export function compileToJs(source, options) {
  return build(source, jit, options);
}

// Compiles Moth source to a WebAssembly module (wasm.js): { bytes, listing, run(print, draw, maxSteps) }.
export function compileToWasm(source, options) {
  return build(source, wasm, options);
}

// The same module's bytes and a readable listing, without compiling it (which a browser page may only do
// for small modules unless it waits): { bytes, listing }.
export function compileToWasmBytes(source, options) {
  return build(source, compileToWasmModule, options);
}

// Problems found without running the program (checker.js): [{ line, col, kind, message }]. Code that
// can't even be read comes back as a single problem of kind "error".
export function check(source, options) {
  try {
    return build(source, checkProgram, options);
  } catch (err) {
    if (!(err instanceof MothError)) throw err;
    return [{ line: err.line, col: err.col, kind: "error", message: err.reason, ...(err.file && { file: err.file }) }];
  }
}

// ---------- fixing ----------

// symbols from other languages, and the Moth words that mean the same (`=` alone could mean set or is, and `%`
// a remainder, so those get no fix)
const SYMBOL_FIXES = { "<=": "is at most", ">=": "is at least", "!=": "is not", "==": "is", "<": "is less than", ">": "is greater than" };

// The fix a mistake points to, for a Fix button: a misspelled name ("'totl' has no value yet. Did you mean
// 'total'?") becomes the name it meant, and a symbol from another language (`>`) the Moth words for it. Gives
// { line, col, length, text } (put `text` in place of `length` characters at line:col), or null. It checks the
// code really has the misspelling at that spot, so a fix can't land anywhere else.
export function suggestedFix(source, { line, col, reason }) {
  const text = source.split(/\r?\n/)[line - 1];
  if (text === undefined || !reason) return null;
  const at = col - 1;
  const meant = reason.match(/\. Did you mean '([^' ]+)'\?$/);
  const wrong = reason.match(/^(?:there is no function called |this record has no )?'([^' ]+)'/);
  if (meant && wrong) {
    const name = wrong[1];
    const written = text.slice(at, at + name.length);
    if (written.toLowerCase() === name && !/\w/.test(text[at + name.length] ?? "") && !/\w/.test(text[at - 1] ?? "")) {
      return { line, col, length: name.length, text: meant[1] };
    }
  }
  if (/^I don't understand '[<>!=]'/.test(reason)) {
    const symbol = [text.slice(at, at + 2), text[at]].find((s) => Object.hasOwn(SYMBOL_FIXES, s));
    if (symbol) return { line, col, length: symbol.length, text: SYMBOL_FIXES[symbol] };
  }
  return null;
}

// ---------- tidying ----------

// One line of code as its pieces, as written, and its comment: [{ type, text, col }], comment or null.
function piecesOf(line) {
  const pieces = [];
  for (let at = 0; at < line.length; at = TOKEN.lastIndex) {
    TOKEN.lastIndex = at;
    let [text, space, comment, number, word, string] = TOKEN.exec(line);
    if (comment) return { pieces, comment: text.trimEnd(), commentCol: at };
    if (space) continue;
    if (string) {
      text = line.slice(at, textEnd(line, at).end); // the parser read it already, so it ends
      TOKEN.lastIndex = at + text.length;
    }
    pieces.push({ type: number ? "number" : word ? "word" : string ? "string" : text, text, col: at + 1, end: at + text.length });
  }
  return { pieces, comment: null };
}

// The pieces of line `line` joined the one way Moth writes them: a space between each, but none inside
// brackets, before a comma or 's, before a call's bracket, or after a minus that makes a number negative.
// `tight` holds those brackets and minuses, which only the parser can tell from the others.
function joined(pieces, line, tight) {
  let out = "";
  pieces.forEach((p, i) => {
    const before = pieces[i - 1];
    const marked = (q) => tight.has(`${line}:${q.col}`);
    const close = !before || before.type === "(" || p.type === ")" || p.type === "," || p.type === "'s"
      || (before.type === "-" && marked(before)) || (p.type === "(" && marked(p));
    out += (close ? "" : " ") + p.text;
  });
  return out;
}

// Moth code, tidied: each line indented 4 spaces for each block it's in (and 4 more if it carries on a
// statement from the line before), single spaces between the pieces of a line, comments kept where they
// are, at most one blank line in a row, and one new line at the end. The parser says where each statement
// starts and how deep, so nothing is guessed. Only code that can be read is tidied (a mistake throws, as in
// compile()), and the result must read exactly the same, piece for piece.
export function format(source) {
  const [layout, tight] = [new Map(), new Set()];
  parse(tokenize(source), { files: () => "", loaded: new Set(), open: [], layout, tight }); // what a used file holds doesn't matter here
  const tidy = [];
  let indent = 0; // the indent of the statement being written, for the lines that carry it on
  let waiting = []; // lines with only a comment, which take the indent of the code after them
  source.split("\n").forEach((line, i) => {
    const { pieces, comment, commentCol } = piecesOf(line);
    if (!pieces.length) {
      if (comment) waiting.push(tidy.push(comment) - 1);
      else if (tidy.length && tidy.at(-1) !== "") tidy.push("");
      return;
    }
    const depth = layout.get(`${i + 1}:${pieces[0].col}`);
    const here = depth === undefined ? indent + 4 : depth * 4;
    if (depth !== undefined) indent = here;
    // a comment just before an end, else or if it fails belongs to the block it closes
    const closing = /^(end|else)$/i.test(pieces[0].text) || pieces.slice(0, 3).map((p) => p.text.toLowerCase()).join(" ") === "if it fails";
    for (const at of waiting) tidy[at] = " ".repeat(closing ? here + 4 : here) + tidy[at];
    waiting = [];
    let text = " ".repeat(here) + joined(pieces, i + 1, tight);
    if (comment) text += " ".repeat(Math.max(1, commentCol - pieces.at(-1).end)) + comment;
    tidy.push(text);
  });
  while (tidy.at(-1) === "") tidy.pop();
  const result = tidy.length ? `${tidy.join("\n")}\n` : "";
  const same = (a, b) => a.length === b.length && a.every((t, i) => t.type === b[i].type && t.value === b[i].value);
  if (!same(tokenize(source), tokenize(result))) throw new Error("tidying would have changed the code"); // a bug in format(), never a mistake in the code
  return result;
}

// Runs a Moth program. Each `say` line goes to `print` (or to `printError`, said to the error output), each
// line the turtle draws to `draw`, and each `ask` to `ask`, which returns the answer (see askFor in vm.js);
// mistakes in the program throw MothError. `stop the program with 2` ends the run, and `exit` gets the 2.
// `maxSteps` stops loops and calls after that many rounds, for running untrusted code without a Stop button.
// `engine` is "jit" (compile to JavaScript), "wasm" (WebAssembly) or "vm" (bytecode). `files` and `file` are
// for `use` (see build). `disk` holds the files `read` and `write` use (see readFile in vm.js, and memoryDisk
// below), `args` is what `arguments` gives, `random` gives the random numbers (seeded() unless given), and
// `clock` the time and the waiting (fakeClock() unless given: see vm.js).
// A program that sets up handlers with `when` or `every` is an app: run() returns it, to be sent events.
// Each sound the program makes goes to `play`, as { hertz, seconds } (see soundOf in vm.js).
export function run(source, print = console.log, { maxSteps = Infinity, draw, engine = "jit", ask, files, file, disk, args = [], random = seeded(), printError = console.error, exit, clock = fakeClock(), play } = {}) {
  const reading = { files, file };
  startTasks();
  // What the program got from outside, in order: each answer, each file it read, and how each write went.
  // Kept, so that running it again (below) gets the same, and writes nothing twice.
  const outside = [];
  const kept = (f) => (...inputs) => {
    try {
      const got = f(...inputs);
      outside.push({ got: copy(got) });
      return got;
    } catch (err) {
      outside.push({ err });
      throw err;
    }
  };
  const answer = ask && kept(ask);
  const chance = kept(random);
  const timer = { now: kept(() => clock.now()), since: kept(() => clock.since()), sleep: kept((ms) => clock.sleep(ms)) };
  const drive = disk && { read: kept((name, asBytes, headers) => (headers ? disk.read(name, asBytes, headers) : disk.read(name, asBytes))),
    write: kept((name, data) => disk.write(name, data)), remove: disk.remove && kept((name) => disk.remove(name)),
    folder: disk.folder && kept((name) => disk.folder(name)), send: disk.send && kept((address, data, headers) => disk.send(address, data, headers)) };
  let program = null;
  if (engine !== "vm") {
    try {
      program = engine === "wasm" ? compileToWasm(source, reading) : compileToJs(source, reading);
    } catch (err) {
      if (!(err instanceof EvalError)) throw err; // a page whose security policy forbids making code from text
    }
  }
  let said = 0;
  let complained = 0; // lines said to the error output
  let drawn = 0;
  let played = 0;
  // each handler an app has called so far, as [handler, inputs], and each event its picture's buttons and text
  // boxes have seen, as [event, inputs]: a run on the VM does them all again, in order
  const sent = [];

  // The program on the VM. `again`: run from the start once more, as the JIT or WebAssembly engine handed it
  // over, getting everything from outside that the first run got, and passing on only what it hadn't said or
  // drawn already. The clock is from outside too, so a second run gets the same times, and doesn't wait again.
  function onVm(again) {
    let [next, skipSaid, skipDrawn, skipComplained, skipPlayed] = [0, again ? said : 0, again ? drawn : 0, again ? complained : 0, again ? played : 0];
    const replay = (f) => f && (!again ? f : (...inputs) => {
      if (next >= outside.length) { // past what the first run got: a call of its own, which is kept too, so not got again
        try {
          return f(...inputs);
        } finally {
          next = outside.length;
        }
      }
      const before = outside[next++];
      if ("err" in before) throw before.err;
      return copy(before.got);
    });
    const say = (line) => skipSaid-- > 0 || print(line);
    const options = {
      maxSteps, ask: replay(answer), disk: drive && { read: replay(drive.read), write: replay(drive.write), remove: replay(drive.remove), folder: replay(drive.folder), send: replay(drive.send) }, args, random: replay(chance),
      clock: { now: replay(timer.now), since: replay(timer.since), sleep: replay(timer.sleep) },
      listeners: [], turtle: new Turtle((line) => skipDrawn-- > 0 || draw?.(line)), printError: (line) => skipComplained-- > 0 || printError(line),
      play: (sound) => skipPlayed-- > 0 || play?.(sound),
    };
    startTasks();
    new Machine(compile(source, reading), say, options).run();
    const host = { vm: true, handlers: options.listeners, call: (handler, inputs) => callFunction(handler.closure, inputs, say, options), turtle: options.turtle };
    for (const [i, inputs] of sent) typeof i === "string" ? host.turtle.route(i, inputs) : host.call(host.handlers[i], inputs);
    return host;
  }

  // Calls went deeper than the JIT (or the WebAssembly engine) goes, or the stack ran out anyway, or a value
  // outgrew what JavaScript allows: the VM keeps its own stack, and reports a too-big value at the right line.
  const handOver = (err) => err instanceof TooDeep || err instanceof RangeError || err?.name === "InternalError";
  // `stop the program` ends it on purpose, not as a mistake: `exit` gets the number it ended with
  const ended = (err) => {
    if (!(err instanceof Ended)) throw err;
    exit?.(err.code);
  };
  let host = { handlers: [] }; // the engine running the program, which fills in its handlers, how to call one, and its turtle
  try {
    if (!program) host = onVm(false);
    else {
      try {
        // counted once passed on, so a hand-over in the middle of passing one on can't lose it
        program.run((line) => (print(line), said++), (line) => (draw?.(line), drawn++), maxSteps, answer, drive, args, chance, host,
          (line) => (printError(line), complained++), timer, (sound) => (play?.(sound), played++));
      } catch (err) {
        if (!handOver(err)) throw err;
        host = onVm(true);
      }
    }
  } catch (err) {
    ended(err);
    return undefined;
  }
  if (!host.handlers.length) return undefined;

  // An app: what its handlers wait for, and a way to hand them events. Each handler call gets `maxSteps` of
  // its own, and a mistake in one throws, which ends the app. A handler that stops the program ends it too:
  // `stopped` is then the number it ended with, and events after it do nothing.
  const app = {
    waits: host.handlers.map(({ event, interval, label }) => (interval !== undefined ? { event, interval } : label !== undefined ? { event, label } : { event })),
    stopped: undefined,
    handle(i, inputs = []) {
      if (app.stopped !== undefined) return;
      try {
        try {
          host.call(host.handlers[i], inputs);
        } catch (err) {
          if (host.vm || !handOver(err)) throw err;
          host = onVm(true); // everything so far again, on the VM, then this event
          host.call(host.handlers[i], inputs);
        }
      } catch (err) {
        if (!(err instanceof Ended)) throw err;
        app.stopped = err.code;
        exit?.(err.code);
      }
      sent.push([i, inputs]);
    },
    // every handler of this event, in the order the program made them: "key" with the key's name, "click"
    // and "drag" with x and y, and "type" with the text typed. The picture's buttons and text boxes see it
    // first (see route() in vm.js), and may take it: a click on a button goes to that button's handlers.
    send(event, inputs = []) {
      if (app.stopped !== undefined) return;
      const [to, label, given] = host.turtle.route(event, inputs) ?? [];
      sent.push([event, inputs]);
      app.waits.forEach((wait, i) => wait.event === to && wait.label === label && app.handle(i, given));
    },
  };
  return app;
}
const copy = (v) => (v instanceof Uint8Array ? v.slice() : v); // bytes a program read could be changed after

// Runs a file's tests: each function at its top level named test_something, on its own, in a fresh run of
// the file, so one test can't spoil another. A mistake in it, like an `expect` that isn't so, fails it, and
// so does stopping the program with a number other than 0. A file with no tests is one test itself. Gives
// [{ name, said, error, stopped }], `error` only for a test that failed with a mistake, whose trail leaves
// out the call that started the test, and `stopped` only for one that stopped the program with a number
// other than 0. Options as for run(); a file that can't be read at all throws, as in run().
export function test(source, options = {}) {
  const program = build(source, (body) => body, options);
  const names = program.filter((s) => s.kind === "define" && s.name.startsWith("test_")).map((s) => s.name);
  const last = source.split("\n").length; // the call that starts a test goes on the line after this one
  const one = (name) => {
    const said = [];
    let stopped = 0;
    try {
      run(name ? `${source}\n${name}()` : source, (line) => said.push(line), { ...options, exit: (code) => (stopped = code) });
      return stopped ? { name, said, stopped } : { name, said };
    } catch (err) {
      if (!(err instanceof MothError)) throw err;
      err.trail = err.trail.filter((t) => t.file || t.line <= last);
      return { name, said, error: err };
    }
  };
  return names.length ? names.map(one) : [one(null)];
}

// Files kept in memory, for a page or a test: `start` gives the first ones, by name, as text or bytes.
export function memoryDisk(start = {}) {
  const files = new Map(Object.entries(start));
  const sent = [];
  return {
    files,
    // what was sent to a site, each { address, data, headers }; a site's reply is the file of its address
    sent,
    send: (address, data, headers) => {
      sent.push({ address, data, headers });
      if (!files.has(address)) throw new Error("couldn't reach it");
      const reply = files.get(address);
      return typeof reply === "string" ? reply : new TextDecoder().decode(reply);
    },
    read: (name, asBytes) => {
      if (!files.has(name)) return null;
      const data = files.get(name);
      if (asBytes) return typeof data === "string" ? new TextEncoder().encode(data) : data.slice();
      return typeof data === "string" ? data : new TextDecoder().decode(data);
    },
    write: (name, data) => void files.set(name, data),
    remove: (name) => files.delete(name),
    // what is in a folder: the files and folders whose names start with its name and a /, where // is / and
    // ./ at the start is nothing; the top is "." or ""
    folder: (name) => {
      const path = name.replace(/\/+/g, "/").replace(/^(\.\/)+/, "").replace(/\/$/, "");
      const top = path === "." || path === "";
      const start = top ? "" : `${path}/`;
      const found = new Set();
      for (const file of files.keys()) {
        if (!file.startsWith(start)) continue;
        const rest = file.slice(start.length);
        const cut = rest.indexOf("/");
        found.add(cut < 0 ? rest : rest.slice(0, cut + 1));
      }
      return found.size || top ? [...found] : null;
    },
  };
}

// Runs a program and hands back what it made at the top level, by name; a Moth function comes back as a
// JavaScript function. This is how JavaScript drives code written in Moth, like Moth's own compiler.
export function load(source, print = console.log) {
  return loadProgram(compileToJs(source), print);
}

function loadProgram(program, print = console.log) {
  const values = program.run(print, undefined, Infinity);
  const made = Object.create(null); // a variable could be called __proto__
  program.names.forEach((name, slot) => {
    const value = values[slot - 1];
    if (value !== UNSET) made[name] = value instanceof Closure ? (...args) => value.fn.run(...args) : value;
  });
  return made;
}

// Moth's compiler written in Moth (compiler.moth): give it that file's text and get back a compiler that
// works like compileToJs(). `using` compiles compiler.moth itself: compileToJs() by default, or a compiler
// made by this function, which is how the tests show the compiler compiling itself.
export function mothCompiler(compilerSource, using = compileToJs) {
  const { compile } = loadProgram(using(compilerSource));
  return (source, files = {}) => { // files: each file a program may use, by name
    let made;
    try {
      made = compile(source, Object.entries(files).map(([name, text]) => makeRecord(["name", "text"], [name, text])));
    } catch (err) {
      // a mistake in the program it compiles comes back as `fail with` a record of where and why
      if (err instanceof MothError && isRecord(err.value) && Object.hasOwn(err.value, "reason")) fail(err.value.at, err.value.reason);
      if (err instanceof TooDeep) fail({ line: 1, col: 1 }, "the code is nested too deeply");
      throw err;
    }
    const names = [];
    made.names.forEach((name, i) => (names[i + 1] = name)); // slot 1 is the first name, as in jit()
    return fromJs(made.js, made.ats, names);
  };
}

// Moth's machine-code back end (machine.moth, which reads programs with compiler.moth): give it both files'
// text and get back a function that turns a program into the bytes of a program of its own, for `target`
// "windows" (a PE .exe) or "linux" (an ELF executable). `files` are the files the program uses, by name,
// `name` is the program's own, for its mistakes, and `allow` the --allow flags built into it, which say what it
// may do without asking.
export function machineCompiler(machineSource, compilerSource) {
  const { compile_shipping: compileMachine, compile_debugging: compileDebugging } = loadProgram(compileToJs(machineSource, { files: (name) => (name === "compiler.moth" ? compilerSource : undefined), file: "machine.moth" }));
  // `icon`, an .ico or .png file's bytes, and `version`, as "1.2.0", for a Windows program; `include`, files built
  // into the program, as { "logo.png": bytes }, which its `read`s find there first; `debug`, a build for `moth debug`,
  // which needs the debugger, moth-debugger.moth, among the files
  return (source, { files = {}, target, name = "program.moth", allow = [], icon = null, version = null, include = {}, debug = false } = {}) => {
    try {
      if (debug) return Uint8Array.from(compileDebugging(source, Object.keys(files), Object.values(files), target, name, allow));
      return Uint8Array.from(compileMachine(source, Object.keys(files), Object.values(files), target, name, allow, icon, version,
        Object.keys(include), Object.values(include).map((b) => Uint8Array.from(b))));
    } catch (err) {
      if (err instanceof MothError && isRecord(err.value) && Object.hasOwn(err.value, "reason")) fail(err.value.at, err.value.reason);
      if (err instanceof TooDeep) fail({ line: 1, col: 1 }, "the code is nested too deeply");
      throw err;
    }
  };
}

// A paused program for a debugger: call run({ pauseAtLines: true }) to go to the next statement, and
// inspect() to see where it is and what its variables hold.
export function debug(source, print = console.log, draw = undefined, ask = undefined, { files, file, disk, args, random, printError, clock } = {}) {
  startTasks();
  return new Machine(compile(source, { debug: true, files, file }), print, { draw, ask, disk, args, random, printError, clock });
}

// A whole run, recorded for a time-travel debugger: at every statement, where the program was, what its
// variables held, and how many lines it had said and drawn by then. Recording stops after `limit` steps
// (`cut` is then true), so a loop that never ends can't run forever. A mistake ends it with an `error` step,
// and `stop the program` with a `done` one that says what it `stopped` with. `answers` answer its questions,
// in order, each shown after its question as a line of output; lines said to the error output are output too.
export function timeline(source, { limit = 10_000, answers = [], files, file, disk, args, random, clock } = {}) {
  const said = [];
  const drawn = [];
  let asked = 0;
  const ask = (question) => {
    if (asked >= answers.length) return null;
    said.push(`${question} ${answers[asked]}`);
    return answers[asked++];
  };
  const machine = debug(source, (line) => said.push(line), (line) => drawn.push(line), ask, { files, file, disk, args, random, printError: (line) => said.push(line), clock });
  const steps = [];
  const snapshot = (extra) => steps.push({ ...machine.inspect(), said: said.length, drawn: drawn.length, ...extra });
  let cut = false;
  try {
    for (;;) {
      if (machine.run({ pauseAtLines: true }) === "done") {
        snapshot({ done: true });
        break;
      }
      snapshot();
      if ((cut = steps.length >= limit)) break;
    }
  } catch (err) {
    if (err instanceof Ended) snapshot({ done: true, stopped: err.code });
    else if (!(err instanceof MothError)) throw err;
    else snapshot({ error: err }); // the variables as they were when it failed, since lists and values change in place
  }
  return { steps, said, drawn, cut };
}

// A shell session: each entry runs with the variables and functions made by the entries before it.
export function session(print = console.log, { files, disk } = {}) {
  const slots = new Map();
  const env = [null];
  return (source) => {
    const main = compile(source, { slots, files });
    while (env.length <= main.nslots) env.push(UNSET); // room for the variables this entry adds
    execute(main, print, Infinity, env, undefined, disk);
  };
}
