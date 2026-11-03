// Moth in VS Code. The colours are syntaxes/moth.tmLanguage.json's; this adds problems as you type, from
// Moth's own checker, with a fix where it has one; Format Document, as moth tidy writes code; each function
// in the outline, and Go to Definition for one; and Run, Debug and Build, which start moth on the file.
const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

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

const SEVERE = new Set(["error", "fails"]); // red, as the playground shows them; the others are warnings

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
// its children: found by their lines, so it works on code with a mistake in it too
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

// `moth run`, `debug` or `build` on the file in front, saved first, in a terminal of its own
async function start(command) {
  const document = vscode.window.activeTextEditor?.document;
  if (!document || document.languageId !== "moth") return vscode.window.showInformationMessage("Open a Moth file first.");
  if (document.isUntitled) return vscode.window.showInformationMessage("Save the file first, so moth can find it.");
  if (document.isDirty) await document.save();
  const moth = vscode.workspace.getConfiguration("moth").get("path") || "moth";
  const file = document.uri.fsPath;
  const terminal = vscode.window.createTerminal({ name: `moth ${command} ${path.basename(file)}`, cwd: path.dirname(file), shellPath: moth, shellArgs: [command, path.basename(file)] });
  terminal.show();
  return terminal;
}

function activate(context) {
  const diagnostics = vscode.languages.createDiagnosticCollection("moth");
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
    vscode.workspace.onDidOpenTextDocument(check),
    vscode.workspace.onDidChangeTextDocument((e) => soon(e.document)),
    vscode.workspace.onDidCloseTextDocument((document) => diagnostics.delete(document.uri)),
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
    vscode.languages.registerDocumentSymbolProvider(selector, { provideDocumentSymbols: functionsIn }),
    vscode.languages.registerDefinitionProvider(selector, {
      provideDefinition(document, position) {
        const word = document.getWordRangeAtPosition(position);
        if (!word) return null;
        const name = document.getText(word).toLowerCase(); // Moth's names don't care about case
        const found = allOf(functionsIn(document)).find((s) => s.name.toLowerCase() === name);
        return found ? new vscode.Location(document.uri, found.selectionRange) : null;
      },
    }),
    vscode.commands.registerCommand("moth.run", () => start("run")),
    vscode.commands.registerCommand("moth.debug", () => start("debug")),
    vscode.commands.registerCommand("moth.build", () => start("build")),
  );
  vscode.workspace.textDocuments.forEach(check);
}

function deactivate() {}

module.exports = { activate, deactivate };
