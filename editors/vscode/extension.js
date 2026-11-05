// Moth in VS Code. The colours are syntaxes/moth.tmLanguage.json's. This adds problems as you type, from Moth's
// own checker, with a fix where it has one, and Format Document, as moth tidy writes code: both from Moth's
// engine, built into the extension, so they need nothing else. Where moth is installed, Moth's language server
// (`moth lsp`, client.js starts it) gives the outline, Go to Definition, in the file or one it uses, what a name
// is when the pointer is on it, and what can come next as you type; without it, the outline and Go to Definition
// find the file's functions by their lines. Run and Build start moth on the file, and Debug a debugging session,
// through debug-adapter.js, which says `moth debug`'s commands for VS Code's breakpoints, stepping and variables.
// Each of those starts the moth that find-moth.js finds: moth.path's, or the PATH's; where there's none, the
// extension says so once, with a button to the releases, and the colours, snippets, problems and Format
// Document go on without it.
const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { startServer } = require("./client.js");
const { findMoth, missingMessage, RELEASES } = require("./find-moth.js");
const { MothDebugSession } = require("./debug-adapter.js");

// Moth's engine, the one the playground runs: copied into engine/ when the extension is packaged (see
// make-vsix.mjs), or the repository's own while it's worked on there
let engine = null;
function loadEngine() {
  const packaged = path.join(__dirname, "engine", "moth.js");
  const file = fs.existsSync(packaged) ? packaged : path.join(__dirname, "..", "..", "moth.js");
  engine ??= import(pathToFileURL(file).href);
  return engine;
}

// what a file the program uses holds: the editor's copy if it's open there, or else the file on the disk,
// from the folder of the file that uses it, as moth reads them
function filesFor(document) {
  if (document.uri.scheme !== "file") return () => undefined;
  const folder = path.dirname(document.uri.fsPath);
  return (name) => {
    const file = path.resolve(folder, name);
    const open = vscode.workspace.textDocuments.find((d) => d.uri.scheme === "file" && path.resolve(d.uri.fsPath) === file);
    if (open) return open.getText();
    try {
      return fs.readFileSync(file, "utf8");
    } catch {
      return undefined;
    }
  };
}

const SEVERE = new Set(["error", "fails", "doesn't fit"]); // red: what makes moth check end with 1; the others are warnings

// where a problem is: the word at its column, or the one character there
function rangeAt(document, line, col) {
  const at = new vscode.Position(Math.max(line - 1, 0), Math.max(col - 1, 0));
  const word = document.getWordRangeAtPosition(at);
  return word && word.start.isEqual(at) ? word : new vscode.Range(at, at.translate(0, 1));
}

// The problems Moth's checker finds in a document. One in a file it uses that stops it running is shown
// on the line that uses that file; the file's other problems show when it's opened itself.
async function problemsOf(document) {
  const moth = await loadEngine();
  const text = document.getText();
  const made = [];
  for (const problem of moth.check(text, { files: filesFor(document) })) {
    let range = null;
    let message = problem.message;
    if (!problem.file) range = rangeAt(document, problem.line, problem.col);
    else if (SEVERE.has(problem.kind)) {
      const line = text.split(/\r?\n/).findIndex((l) => l.includes(`"${problem.file}"`) || l.includes(`"${path.basename(path.dirname(problem.file))}"`));
      range = document.lineAt(Math.max(line, 0)).range;
      message = `${problem.file}:${problem.line}:${problem.col}: ${problem.message}`;
    }
    if (!range) continue;
    const diagnostic = new vscode.Diagnostic(range, message, SEVERE.has(problem.kind) ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning);
    diagnostic.source = "moth";
    if (problem.kind === "unused" || problem.kind === "never runs") diagnostic.tags = [vscode.DiagnosticTag.Unnecessary];
    made.push(diagnostic);
  }
  return made;
}

// Each function a document makes, `to name with ...` up to its `end`, the functions made inside it among
// its children: found by their lines, so it works on code with a mistake in it too. What the outline is
// when there's no language server.
function functionsIn(document) {
  const top = [];
  const open = []; // the functions not ended yet, innermost last
  const lines = document.getText().split(/\r?\n/);
  lines.forEach((text, i) => {
    const indent = /^\s*/.exec(text)[0].length;
    if (/^\s*end\b/i.test(text)) {
      const k = open.findLastIndex((f) => f.indent === indent);
      if (k >= 0) {
        for (const f of open.splice(k)) f.symbol.range = new vscode.Range(f.symbol.range.start, new vscode.Position(i, text.length));
      }
    }
    const made = /^(\s*)(to)(\s+)([A-Za-z_][A-Za-z0-9_]*)(.*)$/i.exec(text);
    if (!made) return;
    const col = made[1].length + made[2].length + made[3].length;
    const name = new vscode.Range(new vscode.Position(i, col), new vscode.Position(i, col + made[4].length));
    const symbol = new vscode.DocumentSymbol(made[4], made[5].trim(), vscode.SymbolKind.Function, new vscode.Range(new vscode.Position(i, 0), new vscode.Position(i, text.length)), name);
    (open.length ? open[open.length - 1].symbol.children : top).push(symbol);
    open.push({ indent, symbol });
  });
  return top;
}

const allOf = (symbols) => symbols.flatMap((s) => [s, ...allOf(s.children)]);

// ---------- what the language server says, as VS Code has it ----------
// The protocol counts its kinds of symbol and of completion from 1, VS Code's enums from 0.

const rangeOf = (r) => new vscode.Range(new vscode.Position(r.start.line, r.start.character), new vscode.Position(r.end.line, r.end.character));
const placeOf = (p) => ({ line: p.line, character: p.character });
function symbolOf(s) {
  const symbol = new vscode.DocumentSymbol(s.name, s.detail ?? "", Math.max((s.kind ?? 13) - 1, 0), rangeOf(s.range), rangeOf(s.selectionRange ?? s.range));
  symbol.children = (s.children ?? []).map(symbolOf);
  return symbol;
}
function locationsOf(found) {
  if (!found) return null;
  return (Array.isArray(found) ? found : [found]).map((l) => new vscode.Location(vscode.Uri.parse(l.uri ?? l.targetUri), rangeOf(l.range ?? l.targetSelectionRange)));
}
function hoverOf(found) {
  if (!found?.contents) return null;
  const said = typeof found.contents === "string" ? found.contents : found.contents.value ?? "";
  return new vscode.Hover(new vscode.MarkdownString(said), found.range ? rangeOf(found.range) : undefined);
}
function completionsOf(found) {
  const items = Array.isArray(found) ? found : found?.items ?? [];
  return items.map((c) => {
    const item = new vscode.CompletionItem(c.label, Math.max((c.kind ?? 1) - 1, 0));
    if (c.detail) item.detail = c.detail;
    return item;
  });
}

// ---------- finding moth ----------

// moth, as moth.path says or from the PATH, looked for afresh each time, so one installed since is found:
// { file } or { file: null, why, tried } (see find-moth.js)
// A moth.path that doesn't start at the top is from the workspace's folder, if it's one the person trusts.
function whereIsMoth() {
  const trusted = vscode.workspace.isTrusted !== false;
  const folder = trusted ? vscode.workspace.workspaceFolders?.find((f) => f.uri.scheme === "file")?.uri.fsPath : undefined;
  return findMoth(vscode.workspace.getConfiguration("moth").get("path"), { folder });
}

// Tells the person moth isn't there, with a button to the releases: when they ask for something that needs
// it (Run, Build, Debug), and once a session as the extension starts, unless they've said not to again. Its
// promise is done once they've answered, or closed the message, which nothing waits for but the tests.
const QUIET = "moth.missing.quiet";
let told = false;
async function tellMissing(found, { context, output, asked = false }) {
  const message = missingMessage(found);
  output?.appendLine(message);
  if (!asked && (told || context?.globalState?.get(QUIET))) return;
  told = true;
  const buttons = asked ? ["Get Moth"] : ["Get Moth", "Don't Show Again"];
  const chosen = await vscode.window.showWarningMessage(message, ...buttons);
  if (chosen === "Get Moth") await vscode.env.openExternal(vscode.Uri.parse(RELEASES));
  else if (chosen === "Don't Show Again") await context?.globalState?.update(QUIET, true);
}

// ---------- the language server ----------

// Moth's language server for the documents VS Code has open: started with the extension, told of each Moth
// document as it's opened, changed and closed, and asked what it knows. It finds the problems too, but the
// extension asks it not to say them: the engine's checker finds those, and the ones that rest on a value
// written out (1 / 0) as well, which moth check leaves to it. `server` is nothing until it has started, and
// again if it can't or once it ends; the providers then do without it.
function languageServer(output, context) {
  const state = { server: null, sent: new Map() }; // each document's version as the server has it, by its address
  const document = (d) => ({ uri: d.uri.toString(), languageId: "moth", version: d.version ?? 0, text: d.getText() });
  const opened = (d) => {
    if (!state.server || d.languageId !== "moth" || state.sent.has(d.uri.toString())) return;
    state.sent.set(d.uri.toString(), d.version ?? 0);
    state.server.notify("textDocument/didOpen", { textDocument: document(d) });
  };
  const changed = (d) => {
    if (!state.server || d.languageId !== "moth") return;
    if (!state.sent.has(d.uri.toString())) return opened(d);
    state.sent.set(d.uri.toString(), d.version ?? 0);
    state.server.notify("textDocument/didChange", { textDocument: { uri: d.uri.toString(), version: d.version ?? 0 }, contentChanges: [{ text: d.getText() }] });
  };
  const closed = (d) => {
    if (!state.server || !state.sent.delete(d.uri.toString())) return;
    state.server.notify("textDocument/didClose", { textDocument: { uri: d.uri.toString() } });
  };
  // what the server says to a request about a document (null for nothing there), or undefined if there's no
  // server or it failed, for the provider to do without it
  const ask = async (method, d, more = {}) => {
    if (!state.server) return undefined;
    if (state.sent.get(d.uri.toString()) !== (d.version ?? 0)) changed(d); // a change not yet sent
    try {
      return await state.server.request(method, { textDocument: { uri: d.uri.toString() }, ...more });
    } catch (err) {
      output.appendLine(`moth lsp: ${method}: ${err.message}`);
      return undefined;
    }
  };
  const start = async () => {
    if (state.server || vscode.workspace.getConfiguration("moth").get("languageServer") === false) return;
    const found = whereIsMoth();
    if (!found.file) {
      output.appendLine("The outline and Go to Definition find the file's functions by their lines instead of with moth lsp.");
      tellMissing(found, { context, output }); // not waited for: the message waits for the person
      return;
    }
    const command = found.file;
    try {
      const server = await startServer(command, { initializationOptions: { diagnostics: false } });
      server.on("window/showMessage", (m) => vscode.window.showWarningMessage(m.message));
      server.on("window/logMessage", (m) => output.appendLine(m.message));
      server.onExit((why) => {
        output.appendLine(`moth lsp ended: ${why}`);
        if (state.server !== server) return; // one stopped to start another
        state.server = null;
        state.sent.clear();
      });
      state.server = server;
      output.appendLine(`moth lsp started (${command})`);
      vscode.workspace.textDocuments.forEach(opened);
    } catch (err) {
      output.appendLine(`${err.message}. The outline and Go to Definition find the file's functions by their lines instead; hovers, completion and definitions in other files need a moth with moth lsp in it, one newer than 1.11.`);
    }
  };
  const stop = async () => {
    const server = state.server;
    state.server = null;
    state.sent.clear();
    await server?.stop();
  };
  // moth.path or moth.languageServer changed: the server stopped, and started again as they now say
  const restart = async () => {
    await stop();
    await start();
  };
  return { state, start, stop, restart, opened, changed, closed, ask };
}

// `moth run` or `build` on the file in front, saved first, in a terminal of its own: moth is the terminal's
// program, not a command typed into a shell, so a path with spaces in it needs no quotes
async function start(command, context, output) {
  const document = vscode.window.activeTextEditor?.document;
  if (!document || document.languageId !== "moth") return vscode.window.showInformationMessage("Open a Moth file first.");
  if (document.isUntitled) return vscode.window.showInformationMessage("Save the file first, so moth can find it.");
  const found = whereIsMoth();
  if (!found.file) {
    tellMissing(found, { context, output, asked: true });
    return undefined;
  }
  if (document.isDirty) await document.save();
  const file = document.uri.fsPath;
  const terminal = vscode.window.createTerminal({ name: `moth ${command} ${path.basename(file)}`, cwd: path.dirname(file), shellPath: found.file, shellArgs: [command, path.basename(file)] });
  terminal.show();
  return terminal;
}

// `moth debug`, for VS Code's debugger: the debug adapter, inside the extension
class InlineAdapter {
  constructor() {
    this.emitter = new vscode.EventEmitter();
    this.onDidSendMessage = this.emitter.event;
    this.session = new MothDebugSession((message) => this.emitter.fire(message));
  }
  handleMessage(message) {
    this.session.handle(message);
  }
  dispose() {
    this.session.stop();
    this.emitter.dispose();
  }
}

// A debugging session's configuration, filled in: with none (F5 with no launch.json), the file in front; and
// moth, the launch configuration's mothPath if it says, or else the one moth.path or the PATH has. Gives
// null for no file, and { missing } where there's no moth.
function debugConfiguration(config) {
  if (!config.type && !config.request && !config.name) {
    const document = vscode.window.activeTextEditor?.document;
    if (document?.languageId !== "moth") return null;
    config = { type: "moth", request: "launch", name: "Debug this file", program: document.uri.fsPath };
  }
  if (!config.program) return null;
  if (config.mothPath) return config;
  const found = whereIsMoth();
  return found.file ? { ...config, mothPath: found.file } : { missing: found };
}

// Debug: the file in front, saved first, in a debugging session
async function debugFile() {
  const document = vscode.window.activeTextEditor?.document;
  if (!document || document.languageId !== "moth") return vscode.window.showInformationMessage("Open a Moth file first.");
  if (document.isUntitled) return vscode.window.showInformationMessage("Save the file first, so moth can find it.");
  if (document.isDirty) await document.save();
  return vscode.debug.startDebugging(undefined, { type: "moth", request: "launch", name: `Debug ${path.basename(document.uri.fsPath)}`, program: document.uri.fsPath });
}

let running = null; // the language server, for deactivate

function activate(context) {
  const diagnostics = vscode.languages.createDiagnosticCollection("moth");
  const output = vscode.window.createOutputChannel("Moth");
  const lsp = languageServer(output, context);
  running = lsp;
  const waiting = new Map(); // a document's next check, a moment after the last change
  const check = async (document) => {
    if (document.languageId !== "moth") return;
    diagnostics.set(document.uri, await problemsOf(document));
  };
  const soon = (document) => {
    if (document.languageId !== "moth") return;
    clearTimeout(waiting.get(document.uri.toString()));
    waiting.set(document.uri.toString(), setTimeout(() => check(document), 250));
  };
  const selector = { language: "moth" };
  context.subscriptions.push(
    diagnostics,
    output,
    { dispose: () => lsp.stop() },
    vscode.workspace.onDidOpenTextDocument((document) => {
      lsp.opened(document);
      return check(document);
    }),
    vscode.workspace.onDidChangeTextDocument((e) => {
      lsp.changed(e.document);
      soon(e.document);
    }),
    vscode.workspace.onDidCloseTextDocument((document) => {
      lsp.closed(document);
      diagnostics.delete(document.uri);
    }),
    vscode.workspace.onDidChangeConfiguration((e) => (e.affectsConfiguration("moth.path") || e.affectsConfiguration("moth.languageServer") ? lsp.restart() : undefined)),
    vscode.languages.registerDocumentFormattingEditProvider(selector, {
      async provideDocumentFormattingEdits(document) {
        const moth = await loadEngine();
        const text = document.getText();
        let tidy;
        try {
          tidy = moth.format(text);
        } catch (err) {
          vscode.window.showWarningMessage(`Moth can't tidy this until its mistake is put right: ${err.message}`);
          return [];
        }
        if (tidy === text) return [];
        return [vscode.TextEdit.replace(new vscode.Range(document.positionAt(0), document.positionAt(text.length)), tidy)];
      },
    }),
    vscode.languages.registerCodeActionsProvider(selector, {
      async provideCodeActions(document, range, context) {
        const moth = await loadEngine();
        const actions = [];
        for (const diagnostic of context.diagnostics) {
          if (diagnostic.source !== "moth") continue;
          const at = diagnostic.range.start;
          const fix = moth.suggestedFix(document.getText(), { line: at.line + 1, col: at.character + 1, reason: diagnostic.message });
          if (!fix) continue;
          const action = new vscode.CodeAction(`Change to '${fix.text}'`, vscode.CodeActionKind.QuickFix);
          action.edit = new vscode.WorkspaceEdit();
          const from = new vscode.Position(fix.line - 1, fix.col - 1);
          action.edit.replace(document.uri, new vscode.Range(from, from.translate(0, fix.length)), fix.text);
          action.diagnostics = [diagnostic];
          action.isPreferred = true;
          actions.push(action);
        }
        return actions;
      },
    }),
    vscode.languages.registerDocumentSymbolProvider(selector, {
      async provideDocumentSymbols(document) {
        const found = await lsp.ask("textDocument/documentSymbol", document);
        return found === undefined ? functionsIn(document) : (found ?? []).map(symbolOf);
      },
    }),
    vscode.languages.registerDefinitionProvider(selector, {
      async provideDefinition(document, position) {
        const found = await lsp.ask("textDocument/definition", document, { position: placeOf(position) });
        if (found !== undefined) return locationsOf(found)?.[0] ?? null;
        const word = document.getWordRangeAtPosition(position); // without the server: a function this file makes
        if (!word) return null;
        const name = document.getText(word).toLowerCase(); // Moth's names don't care about case
        const made = allOf(functionsIn(document)).find((s) => s.name.toLowerCase() === name);
        return made ? new vscode.Location(document.uri, made.selectionRange) : null;
      },
    }),
    vscode.languages.registerHoverProvider(selector, {
      async provideHover(document, position) {
        return hoverOf(await lsp.ask("textDocument/hover", document, { position: placeOf(position) }));
      },
    }),
    vscode.languages.registerCompletionItemProvider(selector, {
      async provideCompletionItems(document, position) {
        const found = await lsp.ask("textDocument/completion", document, { position: placeOf(position) });
        return found ? completionsOf(found) : undefined;
      },
    }, "'"),
    vscode.commands.registerCommand("moth.run", () => start("run", context, output)),
    vscode.commands.registerCommand("moth.debug", debugFile),
    vscode.debug.registerDebugAdapterDescriptorFactory("moth", {
      createDebugAdapterDescriptor: () => new vscode.DebugAdapterInlineImplementation(new InlineAdapter()),
    }),
    vscode.debug.registerDebugConfigurationProvider("moth", {
      resolveDebugConfiguration(folder, config) {
        const made = debugConfiguration(config);
        if (!made) vscode.window.showInformationMessage("Open a Moth file first, or say which with \"program\".");
        if (made?.missing) {
          tellMissing(made.missing, { context, output, asked: true });
          return undefined;
        }
        return made ?? undefined;
      },
    }),
    vscode.commands.registerCommand("moth.build", () => start("build", context, output)),
  );
  vscode.workspace.textDocuments.forEach(check);
  // what the extension gives other extensions, and its tests: where moth is, and whether moth lsp is running
  const api = {
    get moth() {
      return whereIsMoth().file;
    },
    get languageServer() {
      return Boolean(lsp.state.server);
    },
  };
  return lsp.start().then(() => api);
}

function deactivate() {
  return running?.stop();
}

module.exports = { activate, deactivate };
