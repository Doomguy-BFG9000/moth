// The VS Code extension (editors/vscode, DESIGN §61): its colours, run through a small TextMate tokenizer;
// its indenting; the extension itself, against a stand-in for VS Code's API; and the .vsix it's packed in.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { createRequire, Module } from "node:module";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { check, format, suggestedFix } from "./moth.js";
import examples from "./examples.js";
import { contents, zip, ENGINE } from "./editors/vscode/make-vsix.mjs";

const here = (file) => new URL(`./${file}`, import.meta.url);
const grammar = JSON.parse(readFileSync(here("editors/vscode/syntaxes/moth.tmLanguage.json"), "utf8"));

// ---------- a TextMate tokenizer, enough of one for this grammar ----------

// the patterns a rule's patterns stand for, its includes followed
function expand(patterns) {
  return patterns.flatMap((p) => (p.include === "$self" ? expand(grammar.patterns) : p.include ? expand([grammar.repository[p.include.slice(1)]]) : [p]));
}
// Oniguruma's (?i) is JavaScript's i flag; d gives each group's place
const regex = (source) => (source.startsWith("(?i)") ? new RegExp(source.slice(4), "gid") : new RegExp(source, "gd"));

// A line as its pieces, each with the scopes it's in; `stack` carries a begin/end rule left open to the next
// line, as a tokenizer does
function tokenize(line, stack = []) {
  const pieces = [];
  const scopes = () => stack.flatMap((open) => open.scopes);
  const put = (text, more = []) => text && pieces.push({ text, scopes: [...scopes(), ...more] });
  const captured = (m, captures, outer) => {
    if (!captures) return put(m[0], outer);
    let at = m.index;
    const groups = Object.keys(captures).map(Number).sort((a, b) => a - b);
    if (groups[0] === 0) return put(m[0], [...outer, captures[0].name]);
    for (const g of groups) {
      if (!m.indices[g]) continue;
      const [from, to] = m.indices[g];
      put(m.input.slice(at, from), outer);
      put(m.input.slice(from, to), [...outer, captures[g].name]);
      at = to;
    }
    put(m.input.slice(at, m.index + m[0].length), outer);
  };
  for (let pos = 0; pos < line.length; ) {
    const open = stack.at(-1);
    let best = null;
    if (open) {
      const re = regex(open.rule.end);
      re.lastIndex = pos;
      const m = re.exec(line);
      if (m) best = { m, ending: true };
    }
    for (const p of expand(open ? open.rule.patterns ?? [] : grammar.patterns)) {
      const re = regex(p.match ?? p.begin);
      re.lastIndex = pos;
      const m = re.exec(line);
      if (m && (!best || m.index < best.m.index)) best = { m, p };
    }
    if (!best) {
      put(line.slice(pos));
      break;
    }
    const { m } = best;
    put(line.slice(pos, m.index));
    if (best.ending) {
      stack.pop();
      captured(m, open.rule.endCaptures, [open.rule.name].filter(Boolean));
    } else if (best.p.match) captured(m, best.p.captures, [best.p.name].filter(Boolean));
    else {
      captured(m, best.p.beginCaptures, [best.p.name].filter(Boolean));
      stack.push({ rule: best.p, scopes: [best.p.name, best.p.contentName].filter(Boolean) });
    }
    pos = m.index + Math.max(m[0].length, 1);
  }
  return pieces;
}
// the scopes a piece of a line is in, the last one with that text
const scopesOf = (pieces, text) => pieces.findLast((p) => p.text === text)?.scopes ?? null;

test("the editor colours the words the playground colours, and text, values in text, numbers and names", () => {
  const html = readFileSync(here("index.html"), "utf8");
  const words = eval(/const WORDS = new Set\(\(([\s\S]*?)\)\.split\(" "\)\)/.exec(html)[1]).split(" ");
  const keyword = /^\(\?i\)\\b\(\?:(.*)\)\\b$/.exec(grammar.repository.keyword.match)[1].split("|");
  assert.deepEqual(new Set(keyword), new Set(words.filter((w) => !["yes", "no", "nothing"].includes(w))));

  let line = tokenize('set greeting to "Hi {name}, {join words with ", "}!" # a note');
  assert.deepEqual(scopesOf(line, "set"), ["keyword.control.moth"]);
  assert.deepEqual(scopesOf(line, "Hi "), ["string.quoted.double.moth"]);
  assert.deepEqual(scopesOf(line, "{"), ["string.quoted.double.moth", "meta.interpolation.moth", "punctuation.section.interpolation.begin.moth"]);
  assert.deepEqual(scopesOf(line, "name"), ["string.quoted.double.moth", "meta.interpolation.moth", "source.moth"]);
  assert.deepEqual(scopesOf(line, "join"), ["string.quoted.double.moth", "meta.interpolation.moth", "source.moth", "keyword.control.moth"]);
  assert.deepEqual(scopesOf(line, ", "), ["string.quoted.double.moth", "meta.interpolation.moth", "source.moth", "string.quoted.double.moth"]);
  assert.deepEqual(scopesOf(line, "!"), ["string.quoted.double.moth"]);
  assert.deepEqual(scopesOf(line, "# a note"), ["comment.line.number-sign.moth"]);
  // a { before anything but a letter, _ or a bracket is itself, as is \{
  line = tokenize('say "\\\\d{3} \\{name} { x } {(2 * n)}"');
  assert.equal(line.filter((p) => p.scopes.includes("meta.interpolation.moth")).map((p) => p.text).join(""), "{(2 * n)}");
  assert.deepEqual(scopesOf(line, "\\{"), ["string.quoted.double.moth", "constant.character.escape.moth"]);
  line = tokenize("to area with width, height");
  assert.deepEqual(scopesOf(line, "area"), ["entity.name.function.moth"]);
  line = tokenize("say area(0xFF, 2.5) + rex's age");
  assert.deepEqual(scopesOf(line, "area"), ["entity.name.function.call.moth"]);
  assert.deepEqual(scopesOf(line, "0xFF"), ["constant.numeric.moth"]);
  assert.deepEqual(scopesOf(line, "2.5"), ["constant.numeric.moth"]);
  assert.deepEqual(scopesOf(line, "'s"), ["keyword.operator.possessive.moth"]);
  assert.deepEqual(scopesOf(tokenize("SAY nothing"), "SAY"), ["keyword.control.moth"]); // Moth's words don't care about case
  assert.deepEqual(scopesOf(tokenize("say nothing"), "nothing"), ["constant.language.moth"]);
  // every example's text ends on its own line
  for (const [name, source] of Object.entries(examples)) {
    for (const [i, text] of source.split("\n").entries()) {
      const stack = [];
      tokenize(text, stack);
      assert.equal(stack.length, 0, `${name}, line ${i + 1}: ${text}`);
    }
  }
});

test("the editor indents after a line that opens a block, and takes it back at end, else, if it fails and either way", () => {
  const rules = JSON.parse(readFileSync(here("editors/vscode/language-configuration.json"), "utf8")).indentationRules;
  const more = new RegExp(rules.increaseIndentPattern);
  const less = new RegExp(rules.decreaseIndentPattern);
  for (const line of ["to area with w, h", "if x is 1", "else", "    repeat 3 times", "for each i from 1 to 9", "try", "if it fails with why", "either way", "match command", "kind dog with name", "when a key is pressed", 'use the library "user32"'])
    assert.ok(more.test(line), line);
  for (const line of ["say 1", "set to_do to 1", "end", "toast()", "# if it's so"]) assert.ok(!more.test(line), line);
  for (const line of ["end", "  else", "if it fails", "either way"]) assert.ok(less.test(line), line);
  for (const line of ["ending()", "say 1"]) assert.ok(!less.test(line), line);
});

// ---------- the extension, against a stand-in for VS Code ----------

class Position {
  constructor(line, character) {
    this.line = line;
    this.character = character;
  }
  isEqual(other) {
    return this.line === other.line && this.character === other.character;
  }
  translate(lines, characters) {
    return new Position(this.line + lines, this.character + characters);
  }
}
class Range {
  constructor(start, end) {
    this.start = start;
    this.end = end;
  }
}
// A document of the stand-in's: its text, by lines, and words as the language's wordPattern finds them
function makeDocument(fsPath, text, languageId = "moth") {
  const lines = text.split(/\r?\n/);
  const offsetOf = (p) => lines.slice(0, p.line).reduce((n, l) => n + l.length + 1, 0) + p.character;
  return {
    uri: { scheme: "file", fsPath, toString: () => `file://${fsPath}` },
    languageId,
    isUntitled: false,
    isDirty: false,
    getText: (range) => (range ? text.slice(offsetOf(range.start), offsetOf(range.end)) : text),
    lineAt: (i) => ({ range: new Range(new Position(i, 0), new Position(i, lines[i].length)) }),
    positionAt(offset) {
      let line = 0;
      while (line < lines.length - 1 && offset > lines[line].length) offset -= lines[line++].length + 1;
      return new Position(line, offset);
    },
    getWordRangeAtPosition(p) {
      for (const m of (lines[p.line] ?? "").matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) {
        if (m.index <= p.character && p.character <= m.index + m[0].length) return new Range(new Position(p.line, m.index), new Position(p.line, m.index + m[0].length));
      }
      return undefined;
    },
  };
}
function standIn() {
  const seen = { diagnostics: new Map(), providers: {}, listeners: {}, commands: {}, terminals: [], messages: [] };
  const on = (kind) => (f) => ((seen.listeners[kind] = f), { dispose() {} });
  const provider = (kind) => (selector, p) => ((seen.providers[kind] = p), { dispose() {} });
  const vscode = {
    Position, Range,
    Diagnostic: class { constructor(range, message, severity) { Object.assign(this, { range, message, severity }); } },
    DiagnosticSeverity: { Error: 0, Warning: 1 },
    DiagnosticTag: { Unnecessary: 1 },
    DocumentSymbol: class { constructor(name, detail, kind, range, selectionRange) { Object.assign(this, { name, detail, kind, range, selectionRange, children: [] }); } },
    SymbolKind: { Function: 11 },
    Location: class { constructor(uri, range) { Object.assign(this, { uri, range }); } },
    TextEdit: { replace: (range, newText) => ({ range, newText }) },
    CodeAction: class { constructor(title, kind) { Object.assign(this, { title, kind }); } },
    CodeActionKind: { QuickFix: "quickfix" },
    WorkspaceEdit: class { constructor() { this.edits = []; } replace(uri, range, text) { this.edits.push({ uri, range, text }); } },
    languages: {
      createDiagnosticCollection: () => ({ set: (uri, d) => seen.diagnostics.set(uri.toString(), d), delete: (uri) => seen.diagnostics.delete(uri.toString()), dispose() {} }),
      registerDocumentFormattingEditProvider: provider("format"),
      registerCodeActionsProvider: provider("actions"),
      registerDocumentSymbolProvider: provider("symbols"),
      registerDefinitionProvider: provider("definition"),
    },
    workspace: {
      textDocuments: [],
      onDidOpenTextDocument: on("open"),
      onDidChangeTextDocument: on("change"),
      onDidCloseTextDocument: on("close"),
      getConfiguration: () => ({ get: () => "C:/tools/moth.exe" }),
    },
    window: {
      activeTextEditor: null,
      createTerminal: (options) => (seen.terminals.push(options), { show() {} }),
      showInformationMessage: (m) => seen.messages.push(m),
      showWarningMessage: (m) => seen.messages.push(m),
    },
    commands: { registerCommand: (name, f) => ((seen.commands[name] = f), { dispose() {} }) },
  };
  return { vscode, seen };
}
function loadExtension(vscode) {
  const load = Module._load;
  Module._load = function (request, ...rest) {
    return request === "vscode" ? vscode : load.call(this, request, ...rest);
  };
  try {
    const require = createRequire(import.meta.url);
    const file = require.resolve("./editors/vscode/extension.js");
    delete require.cache[file];
    return require(file);
  } finally {
    Module._load = load;
  }
}

test("the extension shows the checker's problems, fixes what it can, tidies, outlines, and starts moth", async () => {
  const { vscode, seen } = standIn();
  const extension = loadExtension(vscode);
  extension.activate({ subscriptions: [] });
  const folder = mkdtempSync(join(tmpdir(), "moth-editor-"));
  try {
    writeFileSync(join(folder, "lib.moth"), "to twice with n\n    return n * 2\nend\n");
    writeFileSync(join(folder, "broken.moth"), "say (1\n");
    const source = 'use "lib.moth"\nset totl to 1\nsay total\nto outer\n    to inner\n        say 1\n    end\n    return inner\nend\nsay twice(3)\nif 2 is 2\n    say outer()\nend\n';
    const document = makeDocument(join(folder, "main.moth"), source);
    await seen.listeners.open(document);
    const found = seen.diagnostics.get(document.uri.toString());
    const want = check(source, { files: (name) => readFileSync(join(folder, name), "utf8") });
    assert.equal(found.length, want.length);
    for (const [i, p] of want.entries()) {
      assert.equal(found[i].message, p.message);
      assert.equal(found[i].source, "moth");
      assert.equal(found[i].severity, ["error", "fails"].includes(p.kind) ? 0 : 1);
      assert.deepEqual([found[i].range.start.line, found[i].range.start.character], [p.line - 1, p.col - 1]);
    }
    // a misspelling's fix, and a symbol's from another language, are what suggestedFix says, in their places
    const symbol = makeDocument(join(folder, "symbol.moth"), "if 2 >= 1\n    say 1\nend\n");
    await seen.listeners.open(symbol);
    for (const [fixing, text] of [[document, "totl"], [symbol, "is at least"]]) {
      const problems = seen.diagnostics.get(fixing.uri.toString());
      const actions = await seen.providers.actions.provideCodeActions(fixing, null, { diagnostics: problems });
      assert.deepEqual(actions.map((a) => [a.title, a.edit.edits[0].text]), [[`Change to '${text}'`, text]]);
      const [p] = actions[0].diagnostics;
      const fix = suggestedFix(fixing.getText(), { line: p.range.start.line + 1, col: p.range.start.character + 1, reason: p.message });
      const { range } = actions[0].edit.edits[0];
      assert.deepEqual([range.start.line, range.start.character, range.end.character - range.start.character], [fix.line - 1, fix.col - 1, fix.length]);
    }

    // a mistake in a file it uses is shown on the line that uses it
    const user = makeDocument(join(folder, "user.moth"), 'say 1\nuse "broken.moth"\n');
    await seen.listeners.open(user);
    const [mistake] = seen.diagnostics.get(user.uri.toString());
    assert.equal(mistake.message, "broken.moth:2:1: expected ')' but found the end of the code");
    assert.equal(mistake.range.start.line, 1);

    // tidying is format()'s, and a mistake leaves the code as it is
    const messy = makeDocument(join(folder, "messy.moth"), "to   area with w,h\nreturn w*h\n  end\n");
    const [edit] = await seen.providers.format.provideDocumentFormattingEdits(messy);
    assert.equal(edit.newText, format(messy.getText()));
    assert.deepEqual(await seen.providers.format.provideDocumentFormattingEdits(makeDocument(join(folder, "b.moth"), "say (1\n")), []);
    assert.equal(seen.messages.at(-1), "Moth can't tidy this until its mistake is put right: line 2: expected ')' but found the end of the code");

    // the outline: outer, with inner inside it, each to its end; and Go to Definition
    const symbols = seen.providers.symbols.provideDocumentSymbols(document);
    assert.deepEqual(symbols.map((s) => [s.name, s.range.start.line, s.range.end.line, s.children.map((c) => [c.name, c.range.start.line, c.range.end.line])]),
      [["outer", 3, 8, [["inner", 4, 6]]]]);
    const location = seen.providers.definition.provideDefinition(document, new Position(11, 10)); // outer()
    assert.deepEqual([location.range.start.line, location.range.start.character], [3, 3]);
    assert.equal(seen.providers.definition.provideDefinition(document, new Position(9, 5)), null); // twice is lib.moth's

    // Run and Debug: moth, started on the file, from its folder
    vscode.window.activeTextEditor = { document };
    await seen.commands["moth.run"]();
    await seen.commands["moth.debug"]();
    assert.deepEqual(seen.terminals.map((t) => [t.shellPath, t.shellArgs, t.cwd]), [["C:/tools/moth.exe", ["run", "main.moth"], folder], ["C:/tools/moth.exe", ["debug", "main.moth"], folder]]);
    vscode.window.activeTextEditor = { document: makeDocument(join(folder, "notes.txt"), "hi", "plaintext") };
    await seen.commands["moth.build"]();
    assert.equal(seen.messages.at(-1), "Open a Moth file first.");
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

// ---------- the .vsix ----------

// a zip's files, read back from its central directory
function unzip(bytes) {
  const files = new Map();
  const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let at = bytes.readUInt32LE(end + 16);
  for (let n = bytes.readUInt16LE(end + 10); n > 0; n--) {
    assert.equal(bytes.readUInt32LE(at), 0x02014b50);
    const nameLength = bytes.readUInt16LE(at + 28);
    const local = bytes.readUInt32LE(at + 42);
    const name = bytes.subarray(at + 46, at + 46 + nameLength).toString("utf8");
    const packed = bytes.readUInt32LE(at + 20);
    const data = inflateRawSync(bytes.subarray(local + 30 + bytes.readUInt16LE(local + 26), local + 30 + bytes.readUInt16LE(local + 26) + packed));
    assert.equal(data.length, bytes.readUInt32LE(at + 24));
    files.set(name, data);
    at += 46 + nameLength + bytes.readUInt16LE(at + 30) + bytes.readUInt16LE(at + 32);
  }
  return files;
}

test("the .vsix holds the extension and Moth's engine as they are here, the same bytes each time", () => {
  const files = contents();
  const bytes = zip(files);
  assert.ok(bytes.equals(zip(contents())), "packing it twice made different bytes");
  const read = unzip(bytes);
  assert.deepEqual([...read.keys()], [...files.keys()]);
  for (const [name, data] of files) assert.ok(read.get(name).equals(data), name);
  for (const file of ENGINE) assert.ok(read.get(`extension/engine/${file}`).equals(readFileSync(here(file))), file);
  // every file the engine imports is in it
  for (const file of ENGINE) {
    for (const [, imported] of readFileSync(here(file), "utf8").matchAll(/^import .* from "\.\/([^"]+)"/gm)) assert.ok(ENGINE.includes(imported), `${file} imports ${imported}`);
  }
  const manifest = JSON.parse(read.get("extension/package.json"));
  assert.match(read.get("extension.vsixmanifest").toString(), new RegExp(`Id="moth" Version="${manifest.version}" Publisher="samyyy2423"`));
});

const code = spawnSync("code --version", { encoding: "utf8", shell: true }).status === 0;
test("VS Code installs the .vsix", { skip: code ? false : "there's no VS Code here" }, () => {
  const folder = mkdtempSync(join(tmpdir(), "moth-vsix-"));
  try {
    const vsix = join(folder, "moth.vsix");
    writeFileSync(vsix, zip(contents()));
    const done = spawnSync(`code --install-extension "${vsix}" --extensions-dir "${join(folder, "ext")}" --user-data-dir "${join(folder, "data")}"`, { encoding: "utf8", shell: true, timeout: 120_000 });
    assert.equal(done.status, 0, done.stdout + done.stderr);
    const [installed] = readdirSync(join(folder, "ext")).filter((f) => f.startsWith("samyyy2423.moth-"));
    assert.ok(installed, readdirSync(join(folder, "ext")).join(", "));
    assert.deepEqual(readdirSync(join(folder, "ext", installed, "engine")).sort(), [...ENGINE, "package.json"].sort());
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

// In VS Code itself, its extension host running in-vscode.js: only with MOTH_VSCODE=1, as it opens a window
// of VS Code's for a few seconds, with a profile of its own
const vscodeAt = process.platform === "win32" ? join(process.env.LOCALAPPDATA ?? "", "Programs", "Microsoft VS Code", "Code.exe") : "code";
test("in VS Code, the extension shows problems, fixes, tidies and outlines", { skip: process.env.MOTH_VSCODE === "1" ? false : "set MOTH_VSCODE=1 to open VS Code for it" }, () => {
  const folder = mkdtempSync(join(tmpdir(), "moth-vscode-"));
  try {
    writeFileSync(join(folder, "main.moth"), "set totl to 1\nsay total\nto  outer\n    to inner\n        say 1\n    end\nend\n");
    const done = spawnSync(vscodeAt, [`--extensionDevelopmentPath=${new URL("./editors/vscode", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")}`,
      `--extensionTestsPath=${new URL("./editors/vscode/in-vscode.js", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")}`,
      `--user-data-dir=${join(folder, "data")}`, `--extensions-dir=${join(folder, "ext")}`, "--disable-extensions", "--disable-workspace-trust", "--skip-welcome", "--skip-release-notes"],
    { env: { ...process.env, MOTH_HOST_FILE: join(folder, "main.moth"), MOTH_HOST_OUT: join(folder, "out.json") }, timeout: 120_000 });
    assert.equal(done.status, 0);
    const got = JSON.parse(readFileSync(join(folder, "out.json"), "utf8"));
    assert.equal(got.error, undefined);
    assert.equal(got.language, "moth");
    assert.deepEqual(got.diagnostics.map(([line, col, severity, source]) => [line, col, severity, source]), [[0, 0, 1, "moth"], [1, 4, 0, "moth"], [2, 0, 1, "moth"], [3, 4, 1, "moth"]]);
    assert.ok(got.fixes.includes("Change to 'totl'"), got.fixes.join(", "));
    assert.equal(got.formatted, format("set totl to 1\nsay total\nto  outer\n    to inner\n        say 1\n    end\nend\n"));
    assert.deepEqual(got.symbols, [["outer", ["inner"]]]);
    assert.deepEqual(got.commands.sort(), ["moth.build", "moth.debug", "moth.run"]);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
