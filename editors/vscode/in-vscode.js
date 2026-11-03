// Run inside VS Code's extension host by editor.test.js (with MOTH_VSCODE=1): opens a Moth file, and writes what
// the extension did with it, for the test to look at
const vscode = require("vscode");
const fs = require("fs");
exports.run = async () => {
  const result = {};
  try {
    const doc = await vscode.workspace.openTextDocument(process.env.MOTH_HOST_FILE);
    await vscode.window.showTextDocument(doc);
    for (let i = 0; i < 100 && vscode.languages.getDiagnostics(doc.uri).length === 0; i++) await new Promise((r) => setTimeout(r, 100));
    result.language = doc.languageId;
    result.diagnostics = vscode.languages.getDiagnostics(doc.uri).map((d) => [d.range.start.line, d.range.start.character, d.severity, d.source, d.message]);
    const fixes = await vscode.commands.executeCommand("vscode.executeCodeActionProvider", doc.uri, vscode.languages.getDiagnostics(doc.uri)[1].range);
    result.fixes = (fixes ?? []).map((a) => a.title);
    const edits = await vscode.commands.executeCommand("vscode.executeFormatDocumentProvider", doc.uri, { tabSize: 4, insertSpaces: true });
    const edit = new vscode.WorkspaceEdit();
    for (const e of edits ?? []) edit.replace(doc.uri, e.range, e.newText);
    await vscode.workspace.applyEdit(edit);
    result.formatted = doc.getText();
    const symbols = await vscode.commands.executeCommand("vscode.executeDocumentSymbolProvider", doc.uri);
    result.symbols = (symbols ?? []).map((s) => [s.name, (s.children ?? []).map((c) => c.name)]);
    result.commands = (await vscode.commands.getCommands(true)).filter((c) => c.startsWith("moth."));
  } catch (e) {
    result.error = String(e.stack ?? e);
  }
  fs.writeFileSync(process.env.MOTH_HOST_OUT, JSON.stringify(result, null, 2));
};
