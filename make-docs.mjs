// Makes the standard library's reference, the pages at /docs/ on the site, from the libraries' own comments:
//
//     node make-docs.mjs
//
// A page for each library (docs/json.html, ...), and docs/index.html, which lists them and searches every
// function. It reads what the language server's hovers read (moth.moth's cli_lsp_comment_above and
// cli_lsp_file_comment): a file's opening comment says what it's for, and the comment lines just above a
// `to` say what that function does. Lines in a comment indented three spaces past the # are code. Each
// function's example is the first of: code in its own comment; a line of the file's opening comment that
// calls it; a line of its tests (tools/x.test.moth) that does; each with the `set` lines it needs. The
// example is run on the JavaScript engine, and what it says is shown under it. docs.test.js says when the
// pages are behind the files they're made from, and when a public function has no comment.
import { readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { STANDARD } from "./make-stdlib.mjs";
import { run } from "./moth.js";

const here = (file) => readFileSync(new URL(`./${file}`, import.meta.url), "utf8");

// the libraries a program uses: the standard library, but for what `moth profile` and `moth coverage` build in
export const LIBRARIES = STANDARD.filter((file) => !/moth-(profiler|coverage)\.moth$/.test(file));

// Each library's own helpers, which the reference leaves out, as VERSIONING.md leaves them out of what's
// kept: a name that starts with the library's prefix (`stats_`), or one of the names listed. Everything else
// at a library's top level is public, and needs a comment.
export const HELPERS = {
  "ai.moth": /^ai_/, "arrays.moth": /^arrays_/, "base64.moth": /^b64_/, "cores.moth": /^cores_/, "email.moth": /^mail_/,
  "hash.moth": /^hash_/, "jwt.moth": /^jwt_/, "linux.moth": /^ui_/, "lists.moth": /^lists_/, "log.moth": /^log_/,
  "oauth.moth": /^oauth_/, "onnx.moth": /^onnx_/, "options.moth": /^options_/, "redis.moth": /^redis_/, "s3.moth": /^s3_/,
  "server.moth": /^web_/, "sockets.moth": /^net_/, "stats.moth": /^stats_/, "system.moth": /^system_/,
  "toml.moth": /^toml_(?!of$)/, "ui.moth": /^ui_/, "websocket.moth": /^ws_/, "windows.moth": /^ui_/, "yaml.moth": /^yaml_(?!of$)/,
  "zones.moth": /^zones_/, "dates.moth": /^dates_/, "game.moth": /^game_/, "http.moth": /^http_/,
  "tasks.moth": /^task_/, "wire.moth": /^wire_/, "text.moth": [/^text_/, "find_all_from", "csv_value"], "python.moth": /^python_/,
  "mysql.moth": [/^my_/, "native_scramble", "sha2_scramble", "rsa_oaep"],
  "postgres.moth": [/^pg_/, "scram_first", "scram_final"],
  "big.moth": ["read_big", "made_big", "written_big", "compare_parts", "add_parts", "take_parts", "times_parts", "scaled_parts",
    "divide_parts", "divided_whole", "base_of"],
  "charts.moth": ["series_of", "new_chart", "fonts", "font_of", "glyph_of", "font_for", "width_of", "nice_step", "axis_text",
    "with_commas", /^shape_/, "shapes_of", "y_of", "bar_shapes", "line_shapes", "parts_shapes", /^svg_(?!of$)/, "bar_path",
    "colour_numbers", "blend", "clamped", "rect_cover", /^draw_/, "distance_to_segment", "minimum_of", "maximum_of"],
  "crypto.moth": ["as_bytes_of", "aes_round_keys", "aes_block", "words_at", "field_times", "ghash", "numbers_of", "counter_block",
    "counter_mode", "gcm_setup", "gcm_tag"],
  "fractions.moth": ["lowest", "written_of", "read_fraction"],
  "images.moth": ["two_to", "whole_size", "colour_of", "place_of", "read_four", "read_two", "cut_out", /^png_(?!of$)/, "unfiltered",
    "paeth", "sample_of", "full_sample", "grey_level", "filtered_values", "add_four", "add_two", "add_chunk", "adler32",
    "huffman_table", "new_bit_reader", "next_bit", "decoded_symbol", "received", /^jpeg_(?!of$)/, "inverse_dct", "level_of",
    "scaled_steps", "new_bit_writer", "put_bits", "put_code", "size_of", "put_number", "halved"],
  "installer.moth": ["asked_of", "ask_first", "tell", "folder_for", "joined", "put_in", "menu_file", "windows_entries", "quoted",
    "shortcut_of", "windows_uninstaller", "linux_uninstaller", "run_powershell", "run_checked", "take_away"],
  "json.moth": ["problem", "here", "skip_spaces", "take", "shown", /^read_/, "hex_number"],
  "sqlite.moth": ["prepared", "column_value", "pointer_in"],
  "sets.moth": ["set_record"],
  "xml.moth": ["problem", "here", "looking_at", "take", "is_space", "skip_spaces", "up_to", "skip_around", "skip_doctype",
    "is_name_letter", "read_name", "shown", "read_element", "read_inside", "add_text", "read_entity", "hex_number", "letter_of",
    "gather_text", "gather_named", "write_element", "escaped"],
  "zip.moth": ["two_to", "made_crc_table", "new_reader", "bits", "huffman", "decoded", "fixed_tables", "dynamic_tables",
    "inflate_into", "matches_of", "place_key", "note_place", "longest_match", "code_lengths", "huffman_lengths", "codes_of",
    "runs_of", "new_writer", "put_bits", "put_code", "base_code", "fixed_length", "write_block", "add_four", "read_four",
    "read_two", "add_header", "add_two"],
};

// libraries that have the same functions as another, whose examples they borrow where they have none
export const SAME_AS = { "linux.moth": "ui.moth", "windows.moth": "ui.moth" };

// the index's sections, each library in one; a library that isn't listed goes in the last
export const SECTIONS = [
  ["Text and data", "Reading and writing the formats data comes in, and working with text, dates and numbers.",
    ["json", "yaml", "toml", "xml", "text", "dates", "zones", "base64", "zip", "images", "charts"]],
  ["Numbers and collections", "Maths beyond what's built in, statistics, arrays, and ways to keep things.",
    ["math", "stats", "arrays", "big", "fractions", "collections", "lists", "sets"]],
  ["The web and networks", "Serving and asking web pages, sockets, mail, and signing in.",
    ["http", "server", "websocket", "sockets", "email", "oauth", "jwt", "s3", "wire"]],
  ["Databases", "SQLite in a file, and the database servers companies run.", ["sqlite", "postgres", "mysql", "redis"]],
  ["Secrets and security", "Hashes, encryption and randomness no one can guess.", ["hash", "crypto", "secrets"]],
  ["The system and programs", "Files and folders, command lines, logs, background work, and every core.",
    ["system", "options", "log", "tasks", "cores", "sync", "installer"]],
  ["Windows and games", "The system's own windows and controls, and games drawn 60 times a second.", ["ui", "windows", "linux", "game"]],
  ["Models and other languages", "Large language models, trained models and Python, from Moth.", ["ai", "onnx", "python"]],
  ["More", "", []],
];

const isHelper = (file, name) => {
  const rule = HELPERS[file.split("/").at(-1)];
  return [rule ?? []].flat().some((r) => (typeof r === "string" ? r === name : r.test(name)));
};

// ---------- reading a library ----------

// a comment's lines, without their #, as prose (paragraphs) and code (lines three spaces in): [{ prose }, { code }]
function blocksOf(lines) {
  const blocks = [];
  for (const raw of lines) {
    const line = raw.replace(/^\s*#/, "");
    const code = /^ {3}/.test(line) ? line.slice(3) : null;
    const last = blocks.at(-1);
    if (code !== null) {
      if (last?.code !== undefined) last.code.push(code);
      else blocks.push({ code: [code] });
    } else if (line.trim() === "") {
      if (last?.prose !== undefined) blocks.push({ gap: true });
      else if (last?.code !== undefined) last.code.push("");
    } else if (last?.prose !== undefined) last.prose += ` ${line.trim()}`;
    else blocks.push({ prose: line.trim() });
  }
  return blocks.filter((b) => !b.gap).map((b) => (b.code ? { code: b.code.join("\n").replace(/\s+$/, "") } : b));
}

// where a piece of a line outside text ("...") and comments matches `test`, or -1
function outside(text, test, from = 0) {
  for (let i = from, quoted = false; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === "\\") i++;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === "#") return -1;
    else if (test(text, i)) return i;
  }
  return -1;
}
const words = (w) => (text, i) => text.startsWith(w, i) && (i === 0 || /[\s,(]/.test(text[i - 1])) && !/\w/.test(text[i + w.length] ?? "");
// a line without the comment at its end, if it has one
function withoutComment(text) {
  for (let i = 0, quoted = false; i < text.length; i++) {
    if (quoted) {
      if (text[i] === "\\") i++;
      else if (text[i] === '"') quoted = false;
    } else if (text[i] === '"') quoted = true;
    else if (text[i] === "#") return text.slice(0, i).trimEnd();
  }
  return text.trimEnd();
}

// the inputs of a `to` line's `with ...`, each { name, type, default }, and what it `gives`
export function signatureOf(line) {
  let rest = withoutComment(line).replace(/^(to|kind)\s+\w+/, "");
  let gives = null;
  const givesAt = outside(rest, words("gives"));
  if (givesAt >= 0) {
    gives = rest.slice(givesAt + "gives".length).trim();
    rest = rest.slice(0, givesAt);
  }
  const fromAt = /^kind /.test(line) ? outside(rest, words("from")) : -1; // kind puppy with name from dog(...)
  if (fromAt >= 0) rest = rest.slice(0, fromAt);
  rest = rest.trim();
  const inputs = [];
  if (rest.startsWith("with ")) {
    let text = rest.slice(5);
    while (text.trim()) {
      const at = outside(text, (t, i) => t[i] === "," || words("and")(t, i));
      const piece = (at < 0 ? text : text.slice(0, at)).trim();
      text = at < 0 ? "" : text.slice(text[at] === "," ? at + 1 : at + 3);
      const m = /^(\w+)(?:\s+as\s+(yes or no|.+?))?(?:\s+or\s+(.+))?$/.exec(piece);
      if (!m) throw new Error(`can't read the input '${piece}' in: ${line}`);
      inputs.push({ name: m[1], type: m[2] ?? null, default: m[3] ?? null });
    }
  }
  return { inputs, gives };
}

// what a file's name is used as, by its opening comment's `use "x.moth" as y`, or its own name
const aliasOf = (name, aboutCode) => new RegExp(`use "${name}\\.moth" as (\\w+)`).exec(aboutCode)?.[1] ?? name;

export function readLibrary(file, read = here) {
  const text = read(file);
  const lines = text.split("\n");
  const name = file.split("/").at(-1).replace(/\.moth$/, "");
  let top = 0;
  while (top < lines.length && lines[top].startsWith("#")) top++;
  const about = blocksOf(lines.slice(0, top));
  const alias = aliasOf(name, about.filter((b) => b.code).map((b) => b.code).join("\n"));
  const functions = [];
  lines.forEach((line, k) => {
    const m = /^(to|kind)\s+(\w+)/.exec(line);
    if (!m || isHelper(file, m[2])) return;
    let first = k;
    while (first > 0 && lines[first - 1].startsWith("#")) first--;
    const comment = blocksOf(lines.slice(first, k));
    functions.push({ name: m[2], kind: m[1], line: k + 1, written: withoutComment(line), ...signatureOf(line), comment });
  });
  return { file, name, alias, about, functions };
}

// ---------- examples ----------

const libraryFiles = new Map(STANDARD.map((file) => [file.split("/").at(-1), file]));
const MOTH_WORDS = new Set(("set add say if else end repeat while for to return and or not is yes no nothing list empty length item of "
  + "record dictionary where remove keys byte bytes as text number in from with by each use expect fail try it fails times than at least "
  + "most read write save load round rounded split join uppercase lowercase position kind give stop start wait arguments json random").split(" "));

// the names a line uses, outside its text and its comment
function namesIn(line) {
  const code = withoutComment(line).replace(/"(?:[^"\\]|\\.)*"/g, '""');
  return new Set([...code.matchAll(/(?<!')\b[A-Za-z_]\w*\b/g)].map((m) => m[0]).filter((w) => !MOTH_WORDS.has(w)));
}

const depthOf = (line) => /^\s*/.exec(line)[0].length;

// An example of its own: `ending`, its last lines, after the lines before it, `lines`, that it needs: at its
// own depth, each a line of its own, the `set`s of the names it uses (and of the names those use), and, if
// `changes`, the statements after them that change one (a call, `add`, `set item 1 of xs`), but no `expect`
// or `say`; and the functions it calls that `defined` has. Then the `use` line, first.
function cutDown(lines, ending, depth, use, { changes = true, defined = new Map() } = {}) {
  const kept = [];
  const alias = / as (\w+)$/.exec(use)[1]; // the library's own name for itself is no variable to look for
  const wanted = new Set(ending.flatMap((line) => [...namesIn(line)]).filter((n) => n !== alias));
  for (let k = lines.length - 1; k >= 0; k--) {
    const line = lines[k];
    if (depthOf(line) < depth && line.trim()) break; // the start of the block it's in
    const next = lines[k + 1] ?? "";
    if (depthOf(line) !== depth || !line.trim() || line.trim().startsWith("#") || line.trimEnd().endsWith(",")
      || (next.trim() && depthOf(next) > depth) || (k > 0 && lines[k - 1].trimEnd().endsWith(","))) continue;
    const names = namesIn(line);
    const made = /^\s*set (\w+) to /.exec(line)?.[1];
    if (made) {
      if (!wanted.has(made)) continue;
      wanted.delete(made); // what changed it before this doesn't matter
    } else if (!changes || /^\s*(expect|say|stop|return|end|else|if|for|repeat|try|to|match|when|give|use|fail)\b/.test(line)
      || ![...names].some((n) => wanted.has(n))) continue;
    kept.unshift(line.slice(depth));
    names.forEach((n) => made !== n && n !== alias && wanted.add(n));
  }
  const functions = [];
  for (let more = true; more; ) {
    more = false;
    for (const [name, block] of defined) {
      if (wanted.has(name) && !functions.includes(block)) {
        functions.push(block);
        block.split("\n").forEach((line) => namesIn(line).forEach((n) => n !== alias && wanted.add(n)));
        more = true;
      }
    }
  }
  return [use, ...functions, ...kept, ...ending.map((line) => line.slice(Math.min(depth, depthOf(line))))].join("\n");
}

// a line of code that calls a library's function: `alias's name(` or `alias's name ` and so on
const callsIt = (alias, name) => new RegExp(`\\b${alias}'s ${name}\\b(?!')`);

// the call in a line, `alias's name(...)` to its closing bracket, or to the line's end if it has none
function callIn(line, alias, name) {
  const at = callsIt(alias, name).exec(line)?.index;
  if (at === undefined) return null;
  let k = at + `${alias}'s ${name}`.length;
  if (line[k] !== "(") return withoutComment(line.slice(at)).trim();
  for (let open = 0, quoted = false; k < line.length; k++) {
    const c = line[k];
    if (quoted) {
      if (c === "\\") k++;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === "(") open++;
    else if (c === ")" && --open === 0) return line.slice(at, k + 1);
  }
  return null;
}

// the top-level functions a file of tests makes for its tests to use, by name: each one's lines
function helpersIn(lines) {
  const made = new Map();
  lines.forEach((line, k) => {
    const m = /^to (\w+)/.exec(line);
    if (!m || m[1].startsWith("test_")) return;
    let e = k;
    while (e < lines.length && lines[e] !== "end") e++;
    made.set(m[1], lines.slice(k, e + 1).join("\n"));
  });
  return made;
}

// what a line that calls the function ends an example with: `expect a is b` as `say a`, or the call itself
// said; a `set` and what it set said; or a statement, and then what the next `expect` about what it changed
// says. Nothing for a line that starts a block.
function endingOf(lines, at, alias, name) {
  const line = withoutComment(lines[at]);
  const pad = /^\s*/.exec(line)[0];
  if ((lines[at + 1] ?? "").trim() && depthOf(lines[at + 1]) > pad.length) return null;
  const said = /^\s*expect (.+?) is (?!not\b|in\b|at\b|less\b|greater\b|about\b|divisible\b)(.+)$/.exec(line);
  if (said && callsIt(alias, name).test(said[1])) return [`${pad}say ${said[1]}`];
  if (/^\s*expect /.test(line)) {
    const call = callIn(line, alias, name);
    return call ? [`${pad}say ${call}`] : null;
  }
  const made = /^\s*set (\w+) to /.exec(line);
  if (made) return [line, `${pad}say ${made[1]}`];
  if (/^\s*(if|for|repeat|while|try|return|say|match|to)\b/.test(line)) return null;
  const names = [...namesIn(line)].filter((n) => n !== alias);
  for (let k = at + 1; k < lines.length && depthOf(lines[k]) >= pad.length; k++) {
    const after = /^\s*expect (.+?) is (?!not\b)(.+)$/.exec(withoutComment(lines[k]));
    if (depthOf(lines[k]) === pad.length && after && [...namesIn(after[1])].some((n) => names.includes(n))) return [line, `${pad}say ${after[1]}`];
  }
  return [line];
}

// The examples a function could have, best first, each { code, from }: code in its own comment; a line of
// the file's opening comment that calls it, with what it needs; the lines of its tests that do, with what
// they need, what they expect said instead
function candidates(lib, fn, tests) {
  const found = [];
  for (const code of fn.comment.filter((b) => b.code).map((b) => b.code)) found.push({ code, from: "comment" });
  const use = `use "${lib.name}.moth" as ${lib.alias}`;
  const ownUse = new RegExp(`^\\s*use "${lib.name}\\.moth" as \\w+\\s*$`);
  const blocks = lib.about.filter((b) => b.code).map((b) => b.code.split("\n").filter((line) => !ownUse.test(line)));
  for (const lines of blocks) {
    const at = lines.findIndex((line) => callsIt(lib.alias, fn.name).test(withoutComment(line)));
    if (at < 0) continue;
    // a line at the block's top is cut down to what it needs, the block's functions it names with it; a line in
    // a function or a loop has the whole block
    found.push({ code: depthOf(lines[at]) === 0 && !/^\s/.test(lines[at + 1] ?? "")
      ? cutDown(lines.slice(0, at), [lines[at]], 0, use, { changes: false, defined: helpersIn(lines) }) : [use, ...lines].join("\n"), from: "about" });
  }
  const alias = tests && new RegExp(`^use "${lib.name}\\.moth" as (\\w+)`, "m").exec(tests)?.[1];
  if (alias) {
    const lines = tests.split("\n");
    const helpers = helpersIn(lines);
    const ours = (code) => code.replace(new RegExp(`\\b${alias}'s `, "g"), `${lib.alias}'s `);
    for (let at = 0; at < lines.length && found.filter((f) => f.from === "tests").length < 4; at++) {
      if (depthOf(lines[at]) !== 4 || !callsIt(alias, fn.name).test(withoutComment(lines[at]))) continue;
      const ending = endingOf(lines, at, alias, fn.name);
      if (ending) found.push({ code: ours(cutDown(lines.slice(0, at), ending, 4, use, { defined: helpers })), from: "tests" });
    }
  }
  // else the call, with what the opening comment sets that it names, as `r` for redis's get(r, key)
  const call = `${lib.alias}'s ${fn.name}(${fn.inputs.map((i) => i.name).join(", ")})`;
  found.push({ code: cutDown(blocks.flat(), [call], 0, use, { changes: false }), from: "call" });
  return found;
}

// what a piece of code says on the JavaScript engine, with the standard library, or null if it can't run
// there (it needs a file, a site or a C library) or says nothing
export function sayOf(code, read = here) {
  const said = [];
  try {
    run(code, (line) => said.push(line), { maxSteps: 3_000_000, printError: () => {}, exit: () => {}, ask: () => null,
      files: (name) => (libraryFiles.has(name) ? read(libraryFiles.get(name)) : undefined) });
  } catch {
    return null;
  }
  return said.length && said.join("\n").length < 1200 ? said.join("\n") : null;
}

// a function's example: the first candidate that runs, with what it says; else the first, as it is. A
// library with the same functions as another borrows its examples, with its own name, where it has only the call.
function exampleOf(lib, fn, tests, read) {
  let all = candidates(lib, fn, tests);
  const same = SAME_AS[lib.file.split("/").at(-1)];
  if (same && all.length === 1) {
    const other = readLibrary(STANDARD.find((file) => file.endsWith(`/${same}`) || file === same), read);
    const twin = other.functions.find((f) => f.name === fn.name);
    if (twin) {
      all = [...candidates(other, twin, null).filter((c) => c.from !== "call").map((c) => ({ ...c,
        code: c.code.replace(`use "${other.name}.moth" as ${other.alias}`, `use "${lib.name}.moth" as ${lib.alias}`)
          .replace(new RegExp(`\\b${other.alias}'s `, "g"), `${lib.alias}'s `) })), ...all];
    }
  }
  for (const c of all) {
    const says = sayOf(c.code, read);
    if (says !== null) return { code: c.code, says };
  }
  return { code: all[0].code, says: null };
}

// how the function is called: `stats's mean(numbers)`
const callOf = (lib, fn) => `${lib.alias}'s ${fn.name}(${fn.inputs.map((i) => i.name).join(", ")})`;

// ---------- the pages ----------

const escape = (text) => String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// Moth's words, coloured as the playground colours them (highlight() in index.html)
const WORDS = new Set(("set add say if else end repeat while for to return and or not is yes no nothing list empty length item "
  + "move turn pen record dictionary where remove keys byte bytes as hex binary shift bit xor read write arguments expect clear draw box circle button random when every milliseconds seconds pressed clicked dragged mouse key fail stop ask use try fails uppercase lowercase split join number position by times each in from with than at least most divisible by of forward back left right up down color width "
  + "table total average largest smallest chart picture play note beep send json headers checkbox tick untick area showing choice ticked dropdown slider moved choose library gives package function power items rounded remainder divided without repeats start wait kind give match").split(" "));
const PIECE = /(#.*)|("(?:[^"\\]|\\.)*"?)|\b(\d+(?:\.\d+)?)\b|([A-Za-z_]\w*)|([^#"\w])/y;
export function highlight(source) {
  return source.split("\n").map((text) => {
    let line = "";
    for (let at = 0; at < text.length; ) {
      PIECE.lastIndex = at;
      const m = PIECE.exec(text);
      if (!m) {
        line += escape(text[at++]);
        continue;
      }
      const [all, comment, quoted, number, word, other] = m;
      line += comment ? `<span class="c">${escape(comment)}</span>` : quoted ? `<span class="s">${escape(quoted)}</span>`
        : number ? `<span class="n">${number}</span>` : word ? (WORDS.has(word.toLowerCase()) ? `<span class="k">${word}</span>` : word)
        : escape(other);
      at += all.length;
    }
    return line;
  }).join("\n");
}

// prose, with `code` as code, and the first mention of another of the library's functions linked to it: a
// name with a _ in it, or one written as a call, `size()`, so a plain word like "line" stays a word
function prose(text, links = new Map()) {
  const seen = new Set();
  return escape(text).split(/(`[^`]+`)/).map((piece) => (piece.startsWith("`") && piece.length > 1 ? `<code>${piece.slice(1, -1)}</code>`
    : piece.replace(/(?<![\w'#.-])([a-z][a-z0-9]*(?:_[a-z0-9]+)+|[a-z][a-z0-9]*(?=\())(\(\))?(?![\w'-])/g, (all, name, call) => {
      if (!links.has(name) || seen.has(name)) return all;
      seen.add(name);
      return `<a href="#${name}">${name}</a>${call ?? ""}`;
    }))).join("");
}

const MOTH = `<symbol id="moth" class="moth" viewBox="0 0 64 64">
        <path class="hind" d="M30 34C20 35 11 42 15 49C19 55 27 48 31 40ZM34 34C44 35 53 42 49 49C45 55 37 48 33 40Z"/>
        <path class="fore" d="M30 27C22 14 8 10 4 18C2 25 10 33 29 33ZM34 27C42 14 56 10 60 18C62 25 54 33 35 33Z"/>
        <circle class="spot" cx="15" cy="21" r="2.6"/><circle class="spot" cx="49" cy="21" r="2.6"/>
        <ellipse class="body" cx="32" cy="35" rx="2.6" ry="11"/><circle class="body" cx="32" cy="23" r="2.8"/>
        <path class="feelers" d="M31 21C29 15 25 11 20 9M33 21C35 15 39 11 44 9"/>
      </symbol>`;

// The site's pages around their own content: the same top and foot as learn.html, from `root`, the way to
// the site's top from the page ("../" from docs/)
export function page({ title, description, root, current, hero, body, script = "" }) {
  const nav = [["Playground", `${root}#playground`], ["Learn", `${root}learn.html`], ["Docs", `${root}docs/`], ["Cookbook", `${root}docs/cookbook/`],
    ["Examples", `${root}docs/examples.html`]].filter(([name]) => SITE_PAGES.includes(name));
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escape(title)}</title>
  <meta name="description" content="${escape(description)}">
  <meta name="theme-color" content="#0c0a08">
  <link rel="icon" href="${root}docs/moth.svg" type="image/svg+xml">
  <link rel="stylesheet" href="${root}docs/site.css">
</head>
<body>
  <svg width="0" height="0" style="position: absolute" aria-hidden="true">
    <defs>
      <linearGradient id="wing-fore" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd98a"/><stop offset="1" stop-color="#e8952e"/></linearGradient>
      <linearGradient id="wing-hind" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f0a845"/><stop offset="1" stop-color="#b8651c"/></linearGradient>
      ${MOTH}
      <symbol id="i-github" viewBox="0 0 16 16"><path d="${GITHUB}"/></symbol>
    </defs>
  </svg>

  <header>
    <div class="lamp" aria-hidden="true"></div>
    <nav class="nav wrap" aria-label="Moth">
      <a class="brand" href="${root}"><svg class="moth" aria-hidden="true"><use href="#moth"/></svg>Moth</a>
${nav.map(([name, href]) => `      <a class="go" href="${href}"${name === current ? ' aria-current="page"' : ""}>${name}</a>`).join("\n")}
      <a class="go outlined" href="https://github.com/samyyy2423/moth"><svg class="icon" aria-hidden="true"><use href="#i-github"/></svg>GitHub</a>
    </nav>
    <div class="hero wrap">
${hero}
    </div>
  </header>

${body}

  <footer class="foot wrap">
    <a class="brand" href="${root}"><svg class="moth" aria-hidden="true"><use href="#moth"/></svg>Moth</a>
    <p>Open source under the Apache License 2.0</p>
    <nav aria-label="More about Moth">
      <a href="${root}#playground">Playground</a>
      <a href="${root}learn.html">Learn</a>
      <a href="${root}docs/">The standard library</a>
      <a href="https://github.com/samyyy2423/moth#the-language">The language</a>
      <a href="https://github.com/samyyy2423/moth">GitHub</a>
    </nav>
  </footer>
${script}</body>
</html>
`;
}
// the pages the site has, for its navigation: more as they come
export const SITE_PAGES = ["Playground", "Learn", "Docs"];
const GITHUB = "M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z";

// a block of Moth, coloured, and what it says under it if it's known
const codeBlock = (code, says) => `<div class="code"><pre><code>${highlight(code)}</code></pre>${says === null || says === undefined ? "" : `<pre class="says"><code>${escape(says)}</code></pre>`}</div>`;

// the first sentence of some prose, for a list: up to its first full stop; one too long for a card is cut at
// its first colon or semicolon, or else at a word, with an ellipsis
export function summaryOf(text) {
  let first = /^(.+?\.)(\s|$)/.exec(text)?.[1] ?? text;
  if (first.length > 170) {
    const cut = /^(.{30,}?)[:;]\s/.exec(first);
    first = cut ? `${cut[1]}.` : `${first.slice(0, 160).replace(/\s+\S*$/, "")}…`;
  }
  return first.replace(/^[a-z]/, (c) => c.toUpperCase());
}
const describe = (fn) => fn.comment.filter((b) => b.prose).map((b) => b.prose).join(" ");

function inputsOf(fn) {
  if (!fn.inputs.length) return `<p class="takes">Takes nothing.</p>`;
  return `<ul class="inputs">${fn.inputs.map((i) => `<li><code>${i.name}</code>${i.type ? ` <span class="type">${escape(i.type)}</span>` : ""}${i.default !== null
    ? ` <span class="optional">optional: ${escape(i.default)} if it's left out</span>` : ""}</li>`).join("")}</ul>`;
}

function libraryPage(lib, tests, read) {
  const names = new Set(lib.functions.map((fn) => fn.name));
  const about = lib.about.map((b) => (b.code ? codeBlock(b.code) : `<p>${prose(b.prose, names)}</p>`)).join("\n          ");
  const entries = lib.functions.map((fn) => {
    const example = exampleOf(lib, fn, tests, read);
    const said = describe(fn);
    return `        <section class="fn" id="${fn.name}">
          <h3><a href="#${fn.name}"><code>${escape(fn.kind === "kind" ? `${lib.alias}'s ${fn.name}(${fn.inputs.map((i) => i.name).join(", ")})` : callOf(lib, fn))}</code></a></h3>
          ${said ? `<p>${prose(said, new Set([...names].filter((n) => n !== fn.name)))}</p>` : ""}
          <div class="facts">
            <div><h4>Inputs</h4>${inputsOf(fn)}</div>
            ${fn.gives || fn.kind === "kind" ? `<div><h4>Gives</h4><p>${fn.gives ? escape(fn.gives) : `a record of kind ${fn.name}`}</p></div>` : ""}
          </div>
          <p class="written">Written <code>${escape(fn.written)}</code>, at <a href="https://github.com/samyyy2423/moth/blob/main/${lib.file}#L${fn.line}">${lib.file.split("/").at(-1)} line ${fn.line}</a></p>
          <h4>Example</h4>
          ${codeBlock(example.code, example.says)}
        </section>`;
  }).join("\n");
  const toc = lib.functions.map((fn) => `<li><a href="#${fn.name}">${fn.name}</a></li>`).join("");
  const first = lib.about.find((b) => b.prose)?.prose ?? "";
  const hero = `      <p class="eyebrow"><a href="./">The standard library</a></p>
      <h1><em>${lib.name}</em>.moth</h1>
      <p>${prose(summaryOf(first))}</p>
      <p class="use"><code>use "${lib.name}.moth" as ${lib.alias}</code></p>`;
  const body = `  <div class="layout wrap">
    <nav class="toc" aria-label="${lib.name}.moth's functions">
      <h2>${lib.functions.length} function${lib.functions.length === 1 ? "" : "s"}</h2>
      <input type="search" id="filter" placeholder="Filter" aria-label="Filter the functions">
      <ol id="toc">${toc}</ol>
      <p class="more"><a href="./">Every library</a> · <a href="https://github.com/samyyy2423/moth/blob/main/${lib.file}">The source</a></p>
    </nav>
    <main>
      <section class="about">
        <h2>What it's for</h2>
          ${about}
      </section>
      <section class="fns">
        <h2>Functions</h2>
${entries}
      </section>
    </main>
  </div>`;
  const script = `  <script>
    // the list of functions, filtered as a name is typed
    const filter = document.getElementById("filter");
    filter.oninput = () => {
      const wanted = filter.value.trim().toLowerCase();
      for (const li of document.getElementById("toc").children) li.hidden = !li.textContent.toLowerCase().includes(wanted);
    };
  </script>
`;
  return page({ title: `${lib.name}.moth · Moth's standard library`, description: summaryOf(first), root: "../", current: "Docs", hero, body, script });
}

function indexPage(libs) {
  const byName = new Map(libs.map((lib) => [lib.name, lib]));
  const placed = new Set(SECTIONS.flatMap(([, , names]) => names));
  const sections = SECTIONS.map(([title, about, names]) => [title, about, title === "More" ? libs.map((l) => l.name).filter((n) => !placed.has(n)) : names.filter((n) => byName.has(n))])
    .filter(([, , names]) => names.length);
  const card = (lib) => `<a class="card" href="${lib.name}.html" data-library="${lib.name}"><b>${lib.name}.moth</b><span>${prose(summaryOf(lib.about.find((b) => b.prose)?.prose ?? "")).replace(/<\/?a[^>]*>/g, "")}</span><i>${lib.functions.length} function${lib.functions.length === 1 ? "" : "s"}</i></a>`;
  const index = libs.flatMap((lib) => lib.functions.map((fn) => [lib.name, fn.name, summaryOf(describe(fn))]));
  const count = index.length;
  const hero = `      <p class="eyebrow">The standard library</p>
      <h1>Everything Moth <em>carries</em>.</h1>
      <p>${libs.length} libraries and ${count} functions, from JSON and web servers to databases, charts and encryption,
        each built into moth, so <code>use "json.moth" as json</code> works in any folder. Each function, what it takes,
        what it gives, and an example, made from the libraries' own comments.</p>
      <form class="search" role="search" onsubmit="return false">
        <input type="search" id="q" placeholder="Search every function: csv, parse, median, serve…" aria-label="Search every function" autocomplete="off">
      </form>`;
  const body = `  <main class="wrap index">
    <section id="results" class="results" hidden aria-live="polite"></section>
    <div id="libraries">
${sections.map(([title, about, names]) => `      <section class="group">
        <h2>${title}</h2>
        ${about ? `<p>${about}</p>` : ""}
        <div class="cards">${names.map((n) => card(byName.get(n))).join("\n          ")}</div>
      </section>`).join("\n")}
    </div>
  </main>`;
  const script = `  <script>
    // every function: its library, its name and the first sentence of what it does
    const FUNCTIONS = ${JSON.stringify(index).replace(/</g, "\\u003c")};
    const q = document.getElementById("q");
    const results = document.getElementById("results");
    const escape = (t) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
    // a function's name that has the words first, then its library's, then what it does
    function search() {
      const words = q.value.trim().toLowerCase().split(/\\s+/).filter(Boolean);
      document.getElementById("libraries").hidden = words.length > 0;
      results.hidden = !words.length;
      if (!words.length) return;
      const score = ([library, name, about]) => words.every((w) => (name + " " + library + " " + about).toLowerCase().includes(w))
        ? words.reduce((s, w) => s + (name.toLowerCase().includes(w) ? 3 : library.includes(w) ? 2 : 1), 0) : 0;
      const found = FUNCTIONS.map((f) => [score(f), f]).filter(([s]) => s).sort((a, b) => b[0] - a[0]).slice(0, 80);
      results.innerHTML = found.length
        ? \`<h2>\${found.length === 80 ? "The first 80" : found.length} found</h2><ul>\${found.map(([, [library, name, about]]) =>
          \`<li><a href="\${library}.html#\${name}"><code>\${library}'s \${name}</code></a><span>\${escape(about)}</span></li>\`).join("")}</ul>\`
        : "<h2>Nothing found</h2><p>Try fewer words, or another word for it.</p>";
    }
    q.oninput = () => {
      search();
      history.replaceState(null, "", q.value ? "?q=" + encodeURIComponent(q.value) : location.pathname);
    };
    q.value = new URLSearchParams(location.search).get("q") ?? "";
    search();
  </script>
`;
  return page({ title: "The standard library · Moth", description: `Moth's standard library: ${libs.length} libraries and ${count} functions, each with an example.`, root: "../", current: "Docs", hero, body, script });
}

// the tests of a library, if it has any
const testsOf = (file, read) => {
  const name = file.replace(/\.moth$/, ".test.moth");
  try {
    return read(name);
  } catch {
    return null;
  }
};

// one library's page
export const pageOf = (file, read = here) => libraryPage(readLibrary(file, read), testsOf(file, read), read);

// every page, by its file's name in docs/
export function docs(read = here) {
  const libs = LIBRARIES.map((file) => readLibrary(file, read));
  const pages = { "index.html": indexPage(libs) };
  for (const lib of libs) pages[`${lib.name}.html`] = libraryPage(lib, testsOf(lib.file, read), read);
  return pages;
}

// the public functions with no comment, as "file: name"
export function undocumented(read = here) {
  return LIBRARIES.map((file) => readLibrary(file, read)).flatMap((lib) => lib.functions.filter((fn) => !describe(fn)).map((fn) => `${lib.file}: ${fn.name}`));
}

// the pages in docs/ that aren't the reference's, which making it leaves alone
export const KEPT = ["examples.html"];

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const made = docs();
  const folder = new URL("./docs/", import.meta.url);
  // a page for a library that's gone, gone too: every page here that isn't made or kept was a library's
  for (const file of readdirSync(folder)) if (file.endsWith(".html") && !(file in made) && !KEPT.includes(file)) unlinkSync(new URL(file, folder));
  for (const [file, html] of Object.entries(made)) writeFileSync(new URL(file, folder), html);
  const missing = undocumented();
  console.log(`made docs/: ${Object.keys(made).length} pages${missing.length ? `; ${missing.length} public functions have no comment: ${missing.join(", ")}` : ""}`);
}
