// The VS Code extension (editors/vscode, DESIGN §61, §108 and §123): its colours, run through a small TextMate
// tokenizer; its indenting; the extension itself, against a stand-in for VS Code's API, with and without a
// stand-in for moth lsp; finding moth; and the .vsix it's packed in. Its tests in VS Code itself are
// editors/vscode/e2e, which CI runs on the .vsix vsce makes.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire, Module } from "node:module";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readdirSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { check, format, suggestedFix } from "./moth.js";
import examples from "./examples.js";
import { contents, zip, unzip, ENGINE, FILES } from "./editors/vscode/make-vsix.mjs";
const { findMoth, missingMessage } = createRequire(import.meta.url)("./editors/vscode/find-moth.js");

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

// a moth for the extension to find, in a folder with spaces in its name, as Windows' Program Files has: an
// empty file marked as a program, since the stand-ins never run it
const mothHome = mkdtempSync(join(tmpdir(), "moth-home-"));
const fakeMoth = join(mothHome, "Program Files", "Moth", "moth");
mkdirSync(join(mothHome, "Program Files", "Moth"), { recursive: true });
writeFileSync(fakeMoth, "");
chmodSync(fakeMoth, 0o755);
after(() => rmSync(mothHome, { recursive: true, force: true }));

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
// A document of the stand-in's: its text, by lines, and words as the language's wordPattern finds them;
// edit(text) changes it, as typing does, and counts its version up
function makeDocument(fsPath, text, languageId = "moth") {
  let lines = text.split(/\r?\n/);
  const offsetOf = (p) => lines.slice(0, p.line).reduce((n, l) => n + l.length + 1, 0) + p.character;
  return {
    uri: { scheme: "file", fsPath, toString: () => `file://${fsPath}` },
    languageId,
    version: 1,
    edit(changed) {
      text = changed;
      lines = text.split(/\r?\n/);
      this.version++;
    },
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
// the stand-in, with moth.path and moth.languageServer as `settings` says; a warning's buttons go in
// seen.buttons, and it's answered with seen.answer
function standIn(settings = { path: fakeMoth, languageServer: false }) {
  const seen = { diagnostics: new Map(), providers: {}, listeners: {}, commands: {}, terminals: [], messages: [], buttons: [], answer: undefined, opened: [], output: [], triggers: {}, debugging: [], debug: {} };
  const on = (kind) => (f) => ((seen.listeners[kind] = f), { dispose() {} });
  const provider = (kind) => (selector, p, ...triggers) => ((seen.providers[kind] = p), (seen.triggers[kind] = triggers), { dispose() {} });
  const vscode = {
    Position, Range,
    Diagnostic: class { constructor(range, message, severity) { Object.assign(this, { range, message, severity }); } },
    DiagnosticSeverity: { Error: 0, Warning: 1 },
    DiagnosticTag: { Unnecessary: 1 },
    DocumentSymbol: class { constructor(name, detail, kind, range, selectionRange) { Object.assign(this, { name, detail, kind, range, selectionRange, children: [] }); } },
    SymbolKind: { Function: 11 },
    Location: class { constructor(uri, range) { Object.assign(this, { uri, range }); } },
    Hover: class { constructor(contents, range) { Object.assign(this, { contents, range }); } },
    MarkdownString: class { constructor(value) { this.value = value; } },
    CompletionItem: class { constructor(label, kind) { Object.assign(this, { label, kind }); } },
    Uri: { parse: (text) => ({ scheme: text.split(":")[0], toString: () => text }) },
    env: { openExternal: async (uri) => (seen.opened.push(uri.toString()), true) },
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
      registerHoverProvider: provider("hover"),
      registerCompletionItemProvider: provider("completion"),
    },
    workspace: {
      textDocuments: [],
      onDidOpenTextDocument: on("open"),
      onDidChangeTextDocument: on("change"),
      onDidCloseTextDocument: on("close"),
      onDidChangeConfiguration: on("configuration"),
      getConfiguration: () => ({ get: (key) => settings[key] }),
      isTrusted: true,
    },
    window: {
      activeTextEditor: null,
      createTerminal: (options) => (seen.terminals.push(options), { show() {} }),
      createOutputChannel: () => ({ appendLine: (line) => seen.output.push(line), dispose() {} }),
      showInformationMessage: (m) => seen.messages.push(m),
      showWarningMessage: async (m, ...buttons) => (seen.messages.push(m), seen.buttons.push(buttons), seen.answer),
    },
    commands: { registerCommand: (name, f) => ((seen.commands[name] = f), { dispose() {} }) },
    debug: {
      registerDebugAdapterDescriptorFactory: (type, factory) => ((seen.debug.factory = [type, factory]), { dispose() {} }),
      registerDebugConfigurationProvider: (type, provider) => ((seen.debug.provider = [type, provider]), { dispose() {} }),
      startDebugging: async (folder, config) => (seen.debugging.push(config), true),
    },
    EventEmitter: class {
      constructor() {
        this.listeners = [];
        this.event = (f) => (this.listeners.push(f), { dispose() {} });
      }
      fire(value) {
        for (const f of this.listeners) f(value);
      }
      dispose() {}
    },
    DebugAdapterInlineImplementation: class { constructor(adapter) { this.adapter = adapter; } },
  };
  return { vscode, seen };
}
// what VS Code keeps for the extension: its globalState, which lasts from one session to the next
function extensionContext(kept = new Map()) {
  return { subscriptions: [], globalState: { get: (key) => kept.get(key), update: async (key, value) => void kept.set(key, value) } };
}
// the extension, with the stand-in for VS Code, and `client` for client.js if it's given
function loadExtension(vscode, client) {
  const load = Module._load;
  Module._load = function (request, ...rest) {
    if (request === "vscode") return vscode;
    if (request === "./client.js" && client) return client;
    return load.call(this, request, ...rest);
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
  await extension.activate({ subscriptions: [] }); // with moth.languageServer off: the outline found by the lines
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
      assert.equal(found[i].severity, ["error", "fails", "doesn't fit"].includes(p.kind) ? 0 : 1);
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
    const symbols = await seen.providers.symbols.provideDocumentSymbols(document);
    assert.deepEqual(symbols.map((s) => [s.name, s.range.start.line, s.range.end.line, s.children.map((c) => [c.name, c.range.start.line, c.range.end.line])]),
      [["outer", 3, 8, [["inner", 4, 6]]]]);
    const location = await seen.providers.definition.provideDefinition(document, new Position(11, 10)); // outer()
    assert.deepEqual([location.range.start.line, location.range.start.character], [3, 3]);
    assert.equal(await seen.providers.definition.provideDefinition(document, new Position(9, 5)), null); // twice is lib.moth's
    assert.equal(await seen.providers.hover.provideHover(document, new Position(11, 10)), null); // hovers need the server
    assert.equal(await seen.providers.completion.provideCompletionItems(document, new Position(11, 10)), undefined);

    // Run and Debug: moth, started on the file, from its folder
    vscode.window.activeTextEditor = { document };
    await seen.commands["moth.run"]();
    await seen.commands["moth.debug"]();
    assert.deepEqual(seen.terminals.map((t) => [t.shellPath, t.shellArgs, t.cwd]), [[fakeMoth, ["run", "main.moth"], folder]]);
    // Debug: a debugging session on the file, its moth.path filled in, with the debug adapter inside the extension
    assert.deepEqual(seen.debugging, [{ type: "moth", request: "launch", name: "Debug main.moth", program: join(folder, "main.moth") }]);
    const [type, provider] = seen.debug.provider;
    assert.equal(type, "moth");
    assert.deepEqual(provider.resolveDebugConfiguration(undefined, seen.debugging[0]), { ...seen.debugging[0], mothPath: fakeMoth });
    assert.deepEqual(provider.resolveDebugConfiguration(undefined, {}), { type: "moth", request: "launch", name: "Debug this file", program: join(folder, "main.moth"), mothPath: fakeMoth });
    // a launch configuration's own mothPath is kept
    assert.equal(provider.resolveDebugConfiguration(undefined, { ...seen.debugging[0], mothPath: "/elsewhere/moth" }).mothPath, "/elsewhere/moth");
    const { adapter } = seen.debug.factory[1].createDebugAdapterDescriptor();
    const sent = [];
    adapter.onDidSendMessage((m) => sent.push(m));
    adapter.handleMessage({ seq: 1, type: "request", command: "initialize", arguments: { adapterID: "moth" } });
    adapter.handleMessage({ seq: 2, type: "request", command: "pause", arguments: { threadId: 1 } });
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(sent.map((m) => [m.type, m.command ?? m.event, m.success]), [["response", "initialize", true], ["response", "pause", false], ["event", "initialized", undefined]]);
    assert.equal(sent[0].body.supportsConfigurationDoneRequest, true);
    adapter.dispose();
    vscode.window.activeTextEditor = { document: makeDocument(join(folder, "notes.txt"), "hi", "plaintext") };
    await seen.commands["moth.build"]();
    assert.equal(seen.messages.at(-1), "Open a Moth file first.");
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

// A stand-in for client.js: a language server that keeps what it's told of each document, and answers from
// it, so what the extension sends and makes of the answers can be looked at; machine.test.js starts client.js
// on moth lsp itself
function serverStandIn({ fails = false } = {}) {
  const seen = { started: [], told: [], asked: [], docs: new Map(), stopped: false, exits: [] };
  const range = (line, from, to, endLine = line) => ({ start: { line, character: from }, end: { line: endLine, character: to } });
  const answers = {
    "textDocument/documentSymbol": () => [{ name: "outer", detail: "with n", kind: 12, range: range(3, 0, 3, 8), selectionRange: range(3, 3, 8),
      children: [{ name: "inner", detail: "", kind: 12, range: range(4, 4, 7, 6), selectionRange: range(4, 7, 12) }] }, { name: "totl", kind: 13, range: range(1, 0, 13), selectionRange: range(1, 4, 8) }],
    "textDocument/definition": ({ textDocument }) => (textDocument.uri.endsWith("main.moth") ? { uri: "file:///work/lib.moth", range: range(0, 3, 8) } : null),
    // what the server holds of the document, which must be what's in front
    "textDocument/hover": ({ textDocument, position }) => ({ contents: { kind: "markdown", value: `v${seen.docs.get(textDocument.uri).version} ${seen.docs.get(textDocument.uri).text.split("\n")[position.line]}` } }),
    "textDocument/completion": () => [{ label: "twice", kind: 3, detail: "with n" }, { label: "rex", kind: 6 }, { label: "say", kind: 14 }],
  };
  const client = {
    async startServer(command, options) {
      seen.started.push({ command, options });
      if (fails) throw new Error(`moth lsp couldn't start: there's no ${command}`);
      return {
        capabilities: {},
        async request(method, params) {
          seen.asked.push(method);
          return answers[method](params);
        },
        notify(method, params) {
          seen.told.push([method, params.textDocument.uri, params.textDocument.version]);
          if (method === "textDocument/didOpen") seen.docs.set(params.textDocument.uri, { version: params.textDocument.version, text: params.textDocument.text });
          if (method === "textDocument/didChange") seen.docs.set(params.textDocument.uri, { version: params.textDocument.version, text: params.contentChanges.at(-1).text });
          if (method === "textDocument/didClose") seen.docs.delete(params.textDocument.uri);
        },
        on() {},
        onExit: (f) => seen.exits.push(f),
        async stop() {
          seen.stopped = true;
        },
      };
    },
  };
  return { client, seen };
}

test("where moth is installed, the extension asks moth lsp for the outline, definitions, hovers and completion", async () => {
  const { vscode, seen } = standIn({ path: fakeMoth });
  const server = serverStandIn();
  const lib = makeDocument("/work/lib.moth", "to twice with n\n    return n * 2\nend\n");
  vscode.workspace.textDocuments.push(lib, makeDocument("/work/notes.txt", "hi", "plaintext"));
  const extension = loadExtension(vscode, server.client);
  await extension.activate({ subscriptions: [] });
  // started with moth.path, asked not to say problems (the engine's checker does), and told of the open Moth files
  assert.deepEqual(server.seen.started, [{ command: fakeMoth, options: { initializationOptions: { diagnostics: false } } }]);
  assert.deepEqual(server.seen.told, [["textDocument/didOpen", "file:///work/lib.moth", 1]]);
  const source = 'use "lib.moth"\nset totl to 1\nsay twice(totl)\nto outer with n\n    to inner\n        say n\n    end\nend\n';
  const document = makeDocument("/work/main.moth", source);
  await seen.listeners.open(document);
  assert.equal(server.seen.docs.get("file:///work/main.moth").text, source);
  assert.ok(seen.diagnostics.get("file:///work/main.moth").length > 0, "the engine's checker still finds the problems");

  // the outline: the server's, its kinds counted from 0 as VS Code counts them
  const symbols = await seen.providers.symbols.provideDocumentSymbols(document);
  const shown = (s) => [s.name, s.detail, s.kind, s.range.start.line, s.range.end.line, s.selectionRange.start.character, s.children.map(shown)];
  assert.deepEqual(symbols.map(shown), [["outer", "with n", 11, 3, 8, 3, [["inner", "", 11, 4, 6, 7, []]]], ["totl", "", 12, 1, 1, 4, []]]);
  // Go to Definition, in another file
  const location = await seen.providers.definition.provideDefinition(document, new Position(2, 5));
  assert.deepEqual([location.uri.toString(), location.range.start.line, location.range.start.character, location.range.end.character], ["file:///work/lib.moth", 0, 3, 8]);
  assert.equal(await seen.providers.definition.provideDefinition(lib, new Position(0, 4)), null); // the server found nothing
  // each change is sent as it's made, and a change VS Code asks about before saying it is sent first
  document.edit(source.replace("set totl to 1", "set totl to 2"));
  seen.listeners.change({ document });
  assert.deepEqual(server.seen.told.at(-1), ["textDocument/didChange", "file:///work/main.moth", 2]);
  document.edit(source.replace("set totl to 1", "set totl to 3"));
  const hover = await seen.providers.hover.provideHover(document, new Position(1, 5));
  assert.equal(hover.contents.value, "v3 set totl to 3");
  // completion, the trigger the server asks for, and each kind counted from 0
  assert.deepEqual(seen.triggers.completion, ["'"]);
  const items = await seen.providers.completion.provideCompletionItems(document, new Position(2, 4));
  assert.deepEqual(items.map((c) => [c.label, c.kind, c.detail]), [["twice", 2, "with n"], ["rex", 5, undefined], ["say", 13, undefined]]);
  // a closed file is said to be closed, and a file that isn't Moth is never sent
  seen.listeners.close(document);
  assert.deepEqual(server.seen.told.at(-1), ["textDocument/didClose", "file:///work/main.moth", undefined]);
  assert.ok(!server.seen.told.some(([, uri]) => uri.endsWith(".txt")));

  // once the server has ended, the outline and definitions are found by the lines again, and there's no hover
  const asked = server.seen.asked.length;
  for (const f of server.seen.exits) f("it ended with 1");
  await seen.listeners.open(document);
  const own = await seen.providers.symbols.provideDocumentSymbols(document);
  assert.deepEqual(own.map((s) => [s.name, s.children.map((c) => c.name)]), [["outer", ["inner"]]]);
  assert.equal(await seen.providers.hover.provideHover(document, new Position(1, 5)), null);
  assert.equal(server.seen.asked.length, asked);
  assert.ok(seen.output.includes("moth lsp ended: it ended with 1"), seen.output.join("\n"));
  await extension.deactivate();
});

test("without moth, with a moth that has no moth lsp, or with moth.languageServer off, the extension does without the server", async () => {
  const nowhere = join(mothHome, "nowhere", "moth");
  for (const settings of [{ path: nowhere }, { path: fakeMoth }, { path: fakeMoth, languageServer: false }]) {
    const { vscode, seen } = standIn(settings);
    const server = serverStandIn({ fails: true });
    const extension = loadExtension(vscode, server.client);
    await extension.activate(extensionContext());
    assert.deepEqual(server.seen.started.map((s) => s.command), settings.path === fakeMoth && settings.languageServer !== false ? [fakeMoth] : []);
    if (settings.path === nowhere) {
      // one message, that moth isn't where moth.path says, with a button to the releases
      assert.deepEqual(seen.messages, [`moth.path says moth is at ${nowhere}, but it isn't there. Install Moth, or set moth.path to where moth is.`]);
      assert.deepEqual(seen.buttons, [["Get Moth", "Don't Show Again"]]);
    } else {
      assert.deepEqual(seen.messages, []); // nothing in the way: what happened is in the Moth output
    }
    if (server.seen.started.length) assert.match(seen.output.join("\n"), /moth lsp couldn't start: there's no .*\. The outline and Go to Definition find the file's functions by their lines instead/);
    // the problems, the outline and Go to Definition work all the same
    const document = makeDocument("/work/main.moth", "to outer\n    say 1\nend\nouter()\nsay x\n");
    await seen.listeners.open(document);
    assert.equal(seen.diagnostics.get("file:///work/main.moth")[0].message, "'x' has no value yet (give it one with 'set x to ...')");
    assert.deepEqual((await seen.providers.symbols.provideDocumentSymbols(document)).map((s) => s.name), ["outer"]);
    assert.deepEqual((await seen.providers.definition.provideDefinition(document, new Position(3, 2))).range.start, new Position(0, 3));
    assert.equal(await seen.providers.hover.provideHover(document, new Position(3, 2)), null);
  }
});

test("where there's no moth, the extension says so once, with a button to the releases, and Run, Build and Debug say it again", async () => {
  const nowhere = join(mothHome, "nowhere");
  const kept = new Map();
  const { vscode, seen } = standIn({ path: nowhere });
  seen.answer = "Get Moth";
  const extension = loadExtension(vscode, serverStandIn().client);
  await extension.activate(extensionContext(kept));
  await new Promise((r) => setImmediate(r));
  assert.equal(seen.messages.length, 1);
  assert.deepEqual(seen.opened, ["https://github.com/samyyy2423/moth/releases"]);
  // a second Moth file, or the server asked to start again, doesn't say it again
  await seen.listeners.configuration({ affectsConfiguration: (key) => key === "moth.path" });
  assert.equal(seen.messages.length, 1);

  // Run, Build and Debug each say it, as they can't do what was asked, with no terminal and no debugging
  const folder = mkdtempSync(join(tmpdir(), "moth-editor-"));
  try {
    const document = makeDocument(join(folder, "main.moth"), "say 1\n");
    vscode.window.activeTextEditor = { document };
    await seen.commands["moth.run"]();
    await seen.commands["moth.build"]();
    const [, provider] = seen.debug.provider;
    assert.equal(provider.resolveDebugConfiguration(undefined, {}), undefined);
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(seen.terminals, []);
    assert.equal(seen.messages.length, 4);
    assert.deepEqual(seen.buttons.slice(1), [["Get Moth"], ["Get Moth"], ["Get Moth"]]);
    assert.equal(seen.opened.length, 4);
    assert.ok(seen.output.includes(seen.messages[0]), "it's in the Moth output too");
    await extension.deactivate();
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }

  // the message waits for the person, but nothing else does: the extension starts, and Run is done with
  {
    const { vscode, seen } = standIn({ path: nowhere });
    seen.answer = new Promise(() => {}); // never answered
    const extension = loadExtension(vscode, serverStandIn().client);
    assert.equal((await extension.activate(extensionContext())).moth, null);
    vscode.window.activeTextEditor = { document: makeDocument(join(mothHome, "main.moth"), "say 1\n") };
    await seen.commands["moth.run"]();
    assert.equal(seen.messages.length, 2);
  }

  // Don't Show Again is kept: the next session says nothing as it starts, but Run still does
  {
    const { vscode, seen } = standIn({ path: nowhere });
    seen.answer = "Don't Show Again";
    assert.equal(kept.get("moth.missing.quiet"), undefined); // Get Moth was the answer before
    await loadExtension(vscode, serverStandIn().client).activate(extensionContext(kept));
    await new Promise((r) => setImmediate(r));
    assert.deepEqual([seen.messages.length, seen.opened.length, kept.get("moth.missing.quiet")], [1, 0, true]);
  }
  {
    const { vscode, seen } = standIn({ path: nowhere });
    const extension = loadExtension(vscode, serverStandIn().client);
    await extension.activate(extensionContext(kept));
    assert.deepEqual(seen.messages, []);
    vscode.window.activeTextEditor = { document: makeDocument(join(mothHome, "main.moth"), "say 1\n") };
    await seen.commands["moth.run"]();
    assert.equal(seen.messages.length, 1);
  }
});

test("once moth.path is changed, the language server is started again with the moth it now says", async () => {
  const settings = { path: join(mothHome, "nowhere") };
  const { vscode, seen } = standIn(settings);
  const server = serverStandIn();
  const extension = loadExtension(vscode, server.client);
  const api = await extension.activate(extensionContext());
  assert.deepEqual([api.moth, api.languageServer, server.seen.started.length], [null, false, 0]);
  settings.path = join(mothHome, "Program Files", "Moth"); // the folder moth is in will do
  await seen.listeners.configuration({ affectsConfiguration: (key) => key === "moth.path" });
  assert.deepEqual([api.moth, api.languageServer, server.seen.started.map((s) => s.command)], [fakeMoth, true, [fakeMoth]]);
  await seen.listeners.configuration({ affectsConfiguration: (key) => key === "editor.fontSize" }); // not Moth's
  assert.equal(server.seen.started.length, 1);
  settings.languageServer = false;
  await seen.listeners.configuration({ affectsConfiguration: (key) => key === "moth.languageServer" });
  assert.deepEqual([server.seen.stopped, api.languageServer], [true, false]);
  await extension.deactivate();
});

test("moth is found where moth.path says, or on the PATH, as Linux and Windows write them", () => {
  const folder = mkdtempSync(join(tmpdir(), "moth-find-"));
  try {
    const made = (file, mode = 0o755) => (mkdirSync(join(file, ".."), { recursive: true }), writeFileSync(file, ""), chmodSync(file, mode), file);
    const first = made(join(folder, "my tools", "moth"));
    const second = made(join(folder, "bin", "moth"));
    const notMarked = made(join(folder, "downloads", "moth"), 0o644);
    mkdirSync(join(folder, "a folder", "moth"), { recursive: true }); // a folder called moth isn't moth
    const env = (...dirs) => ({ PATH: ["", join(folder, "a folder"), ...dirs].join(":") });
    const linux = (setting, more = {}) => findMoth(setting, { platform: "linux", env: env(), home: folder, ...more });

    // on the PATH: the first folder that has it, for an empty moth.path, or the old default, moth
    for (const setting of ["", undefined, "  ", "moth"]) assert.deepEqual(linux(setting, { env: env(join(folder, "my tools"), join(folder, "bin")) }), { file: first });
    assert.deepEqual(linux("", { env: env(join(folder, "bin"), join(folder, "my tools")) }), { file: second });
    assert.deepEqual(linux("", { env: env(join(folder, "downloads"), join(folder, "bin")) }), { file: second });
    assert.deepEqual(linux("", { env: env(join(folder, "downloads")) }), { file: null, why: "not runnable", tried: notMarked });
    assert.deepEqual(linux(""), { file: null, why: "not on the PATH", tried: "moth" });
    assert.deepEqual(linux("", { env: {} }), { file: null, why: "not on the PATH", tried: "moth" });

    // where moth.path says: the file, the folder it's in, in quotes, from home, from the workspace's folder
    assert.deepEqual(linux(first), { file: first });
    assert.deepEqual(linux(join(folder, "my tools")), { file: first });
    assert.deepEqual(linux(`"${first}"`), { file: first });
    assert.deepEqual(linux("~/my tools/moth"), { file: first });
    assert.deepEqual(linux("my tools/moth", { folder }), { file: first });
    assert.deepEqual(linux("my tools/moth"), { file: null, why: "not there", tried: "my tools/moth" }); // no folder to be from
    assert.deepEqual(linux(join(folder, "nowhere", "moth")), { file: null, why: "not there", tried: join(folder, "nowhere", "moth") });
    assert.deepEqual(linux(notMarked), { file: null, why: "not runnable", tried: notMarked });

    // Windows: moth.exe, Path, ; between folders, folders in quotes, \ or /, and spaces
    const files = new Set(["C:\\Program Files\\Moth\\moth.exe", "D:\\Other Tools\\moth.exe", "C:\\Users\\Sam\\moth\\moth.exe"]);
    const check = (file) => (files.has(file) ? "yes" : "no");
    const windows = (setting, Path = 'C:\\Windows;;"D:\\Other Tools";C:\\Program Files\\Moth') =>
      findMoth(setting, { platform: "win32", env: { Path }, home: "C:\\Users\\Sam", folder: "C:\\Users\\Sam", check });
    assert.deepEqual(windows(""), { file: "D:\\Other Tools\\moth.exe" });
    assert.deepEqual(windows("moth"), { file: "D:\\Other Tools\\moth.exe" });
    assert.deepEqual(windows("", "C:\\Program Files\\Moth\\"), { file: "C:\\Program Files\\Moth\\moth.exe" });
    assert.deepEqual(windows("", "C:\\Windows"), { file: null, why: "not on the PATH", tried: "moth.exe" });
    for (const setting of ["C:\\Program Files\\Moth\\moth.exe", '"C:\\Program Files\\Moth\\moth.exe"', "C:\\Program Files\\Moth\\moth", "C:\\Program Files\\Moth", "C:/Program Files/Moth/moth.exe", "C:\\Program Files\\Moth\\..\\Moth\\moth.exe"]) {
      assert.deepEqual(windows(setting), { file: "C:\\Program Files\\Moth\\moth.exe" }, setting);
    }
    assert.deepEqual(windows("~\\moth"), { file: "C:\\Users\\Sam\\moth\\moth.exe" });
    assert.deepEqual(windows("moth\\moth.exe"), { file: "C:\\Users\\Sam\\moth\\moth.exe" });
    assert.deepEqual(windows("C:\\Moth\\moth.exe"), { file: null, why: "not there", tried: "C:\\Moth\\moth.exe" });

    // and what the person is told
    assert.equal(missingMessage({ why: "not on the PATH" }, "win32"), "Moth's command line, moth.exe, isn't on your PATH. Hovers, completion, Run, Build and the debugger need it; colours, snippets, problems and Format Document work without it. Install it, or set moth.path to where it is.");
    assert.equal(missingMessage({ why: "not there", tried: "/opt/moth" }, "linux"), "moth.path says moth is at /opt/moth, but it isn't there. Install Moth, or set moth.path to where moth is.");
    assert.equal(missingMessage({ why: "not runnable", tried: notMarked }, "linux"), `${notMarked} isn't marked as a program, so it can't be run. Run chmod +x "${notMarked}", then try again.`);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

// ---------- Neovim, Helix and Zed (DESIGN §108) ----------

test("tree-sitter's grammar has VS Code's words, and Neovim's, Helix's and Zed's colours and indenting are VS Code's", () => {
  const keyword = /^\(\?i\)\\b\(\?:(.*)\)\\b$/.exec(grammar.repository.keyword.match)[1].split("|");
  const source = readFileSync(here("editors/tree-sitter-moth/grammar.js"), "utf8");
  assert.deepEqual(eval(`[${/const WORDS = \[([\s\S]*?)\];/.exec(source)[1]}]`), keyword);
  assert.deepEqual(eval(`[${/const CONSTANTS = \[([\s\S]*?)\];/.exec(source)[1]}]`), ["yes", "no", "nothing"]);
  // and the parser made from it (src/, which `tree-sitter generate` makes) has them, in any case
  const made = JSON.parse(readFileSync(here("editors/tree-sitter-moth/src/grammar.json"), "utf8"));
  assert.deepEqual([made.rules.keyword.value.split("|").sort(), made.rules.keyword.flags], [[...keyword].sort(), "i"]);
  assert.deepEqual(made.externals.map((e) => e.name), ["string_content", "_error_sentinel"]); // src/scanner.c's, in its order

  // Neovim's and Zed's colours are the grammar's own; Helix's are those with its names for four of them
  const query = readFileSync(here("editors/tree-sitter-moth/queries/highlights.scm"), "utf8");
  assert.equal(readFileSync(here("editors/neovim/queries/moth/highlights.scm"), "utf8"), query);
  assert.equal(readFileSync(here("editors/zed/languages/moth/highlights.scm"), "utf8"), query);
  const after = (text) => text.slice(text.indexOf("\n\n")); // what's after the comment at the top
  const helixNames = { "@string.escape": "@constant.character.escape", "@number": "@constant.numeric", "@function.call": "@function", "@property": "@variable.other.member" };
  assert.equal(after(readFileSync(here("editors/helix/queries/moth/highlights.scm"), "utf8")),
    after(query).replace(/@[a-z.]+/g, (name) => helixNames[name] ?? name));

  // Zed indents by VS Code's patterns, and Neovim by the same words
  const rules = JSON.parse(readFileSync(here("editors/vscode/language-configuration.json"), "utf8")).indentationRules;
  const zed = readFileSync(here("editors/zed/languages/moth/config.toml"), "utf8");
  assert.equal(JSON.parse(/^increase_indent_pattern = (".*")$/m.exec(zed)[1]), rules.increaseIndentPattern);
  assert.equal(JSON.parse(/^decrease_indent_pattern = (".*")$/m.exec(zed)[1]), rules.decreaseIndentPattern);
  const words = (pattern) => /\(\?:([^)]*)\)/.exec(pattern)[1];
  const lua = readFileSync(here("editors/neovim/lua/moth.lua"), "utf8");
  assert.equal(/local opens = vim\.regex\(\[\[\\v\\C\^\\s\*\(([^)]*)\)/.exec(lua)[1], words(rules.increaseIndentPattern));
  assert.equal(/local closes = vim\.regex\(\[\[\\v\\C\^\\s\*\(([^)]*)\)/.exec(lua)[1], words(rules.decreaseIndentPattern));
});

// Zed and Helix build the grammar from a commit of this repository: the same one, which has the grammar as it
// is here (where git has that commit: a shallow clone, as CI's, may not)
const grammarCommit = /^commit = "([0-9a-f]{40})"$/m.exec(readFileSync(here("editors/zed/extension.toml"), "utf8"))?.[1];
const hasCommit = grammarCommit && spawnSync("git", ["cat-file", "-e", `${grammarCommit}^{commit}`], { cwd: new URL(".", import.meta.url) }).status === 0;
test("Zed and Helix build the grammar as it is here", () => {
  assert.ok(grammarCommit, "editors/zed/extension.toml names no commit");
  assert.match(readFileSync(here("editors/helix/languages.toml"), "utf8"), new RegExp(`rev = "${grammarCommit}", subpath = "editors/tree-sitter-moth"`));
});
test("the grammar at that commit is the grammar here", { skip: hasCommit ? false : "git here doesn't have the commit" }, () => {
  for (const file of ["grammar.js", "src/scanner.c", "src/parser.c", "src/grammar.json"]) {
    const then = spawnSync("git", ["show", `${grammarCommit}:editors/tree-sitter-moth/${file}`], { cwd: new URL(".", import.meta.url), encoding: "utf8", maxBuffer: 1 << 26 });
    assert.ok(then.stdout === readFileSync(here(`editors/tree-sitter-moth/${file}`), "utf8"), `${file} has changed since ${grammarCommit}: commit it, and name the commit in editors/zed/extension.toml and editors/helix/languages.toml`);
  }
});

// ---------- the .vsix ----------

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
  // what's in it is FILES, the list vsce is held to, which .vscodeignore lets through; and the licence is the
  // repository's own
  const inside = [...files.keys()].filter((name) => name.startsWith("extension/")).map((name) => name.slice("extension/".length).replace(/^LICENSE\.txt$/, "LICENSE"));
  assert.deepEqual(inside.sort(), [...FILES].sort());
  const allowed = readFileSync(here("editors/vscode/.vscodeignore"), "utf8").split(/\r?\n/).filter((line) => line.startsWith("!")).map((line) => line.slice(1));
  assert.deepEqual(allowed.flatMap((p) => (p === "engine/**" ? FILES.filter((f) => f.startsWith("engine/")) : [p])).sort(), [...FILES].sort());
  assert.ok(readFileSync(here("editors/vscode/LICENSE")).equals(readFileSync(here("LICENSE"))), "editors/vscode/LICENSE isn't the repository's LICENSE");
  assert.equal(manifest.icon, "images/icon.png");
  const png = read.get("extension/images/icon.png");
  assert.deepEqual([png.subarray(1, 4).toString(), png.readUInt32BE(16), png.readUInt32BE(20)], ["PNG", 128, 128]);
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
