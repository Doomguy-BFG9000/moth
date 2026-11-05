// The extension's tests in VS Code itself: run in its extension host by run.mjs, on the extension as the .vsix
// has it, in a folder of Moth files run.mjs makes. MOTH_E2E_MOTH is the moth run.mjs gave it (in a folder with
// spaces in its name), or empty when it's to have none, and the tests check what works either way.
const vscode = require("vscode");
const assert = require("assert/strict");
const fs = require("fs");
const path = require("path");

const folder = process.env.MOTH_E2E_FOLDER;
const moth = process.env.MOTH_E2E_MOTH || null;
const uri = (name) => vscode.Uri.file(path.join(folder, name));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// what `get` gives, once `ok` says it'll do, or what it last gave, after `seconds`
async function until(get, ok = Boolean, seconds = 20) {
  let value;
  for (const end = Date.now() + seconds * 1000; Date.now() < end; await sleep(100)) {
    value = await get();
    if (ok(value)) return value;
  }
  return value;
}
const open = async (name) => {
  const document = await vscode.workspace.openTextDocument(uri(name));
  await vscode.window.showTextDocument(document);
  return document;
};
const problems = (document) => until(() => vscode.languages.getDiagnostics(document.uri), (d) => d.length > 0);

const tests = [];
const test = (name, f, { needsMoth = false, withoutMoth = false } = {}) => {
  if ((needsMoth && !moth) || (withoutMoth && moth)) return;
  tests.push({ name, f });
};

let api;
test("it starts for a Moth file, and finds moth where there is one", async () => {
  const document = await open("broken.moth");
  assert.equal(document.languageId, "moth");
  const extension = vscode.extensions.getExtension("samyyy2423.moth");
  assert.ok(extension, "the extension isn't installed");
  api = await until(() => extension.isActive && extension.exports);
  assert.ok(extension.isActive, "it didn't start");
  assert.equal(api.moth, moth);
  // with moth, its language server starts; without it, nothing does
  assert.equal(await until(() => api.languageServer, (running) => running === Boolean(moth)), Boolean(moth));
  const commands = await vscode.commands.getCommands(true);
  assert.deepEqual(commands.filter((c) => /^moth\.(run|debug|build)$/.test(c)).sort(), ["moth.build", "moth.debug", "moth.run"]);
});

test("a broken file gets a problem", async () => {
  const document = await open("broken.moth");
  const [problem, ...more] = await problems(document);
  assert.deepEqual(more, []);
  assert.deepEqual([problem.range.start.line, problem.range.start.character], [1, 0]);
  assert.equal(problem.severity, vscode.DiagnosticSeverity.Error);
  assert.equal(problem.source, "moth");
  assert.equal(problem.message, "expected ')' but found the end of the code");
});

test("a misspelled name gets a problem as it's typed, and a Quick Fix", async () => {
  const document = await open("typo.moth");
  const editor = vscode.window.activeTextEditor;
  assert.equal((await problems(document)).length, 2); // 'totl' never used, and 'total' with no value
  await editor.edit((edit) => edit.insert(new vscode.Position(2, 0), "say totl\n"));
  const found = await until(() => vscode.languages.getDiagnostics(document.uri), (d) => d.length === 1); // 'totl' is used now
  assert.deepEqual(found.map((d) => [d.range.start.line, d.range.start.character, d.severity, d.message]),
    [[1, 4, vscode.DiagnosticSeverity.Error, "'total' has no value yet. Did you mean 'totl'?"]]);
  const fixes = await vscode.commands.executeCommand("vscode.executeCodeActionProvider", document.uri, found[0].range);
  assert.ok(fixes.some((a) => a.title === "Change to 'totl'"), fixes.map((a) => a.title).join(", "));
  await vscode.commands.executeCommand("workbench.action.files.revert");
});

test("Format Document writes the code as moth tidy does", async () => {
  const document = await open("messy.moth");
  await vscode.commands.executeCommand("editor.action.formatDocument");
  assert.equal(await until(() => document.getText(), (text) => !text.startsWith("to   ")), "to area with w, h\n    return w * h\nend\nsay area(2, 3)\n");
  await vscode.commands.executeCommand("workbench.action.files.revert");
});

test("Go to Definition goes to the function, and the outline has it", async () => {
  const document = await open("calls.moth");
  const [found] = await vscode.commands.executeCommand("vscode.executeDefinitionProvider", document.uri, new vscode.Position(7, 1)); // outer()
  assert.equal(found.uri?.fsPath ?? found.targetUri.fsPath, document.uri.fsPath);
  const range = found.range ?? found.targetSelectionRange;
  assert.deepEqual([range.start.line, range.start.character], [1, 3]);
  // where Go to Definition goes when the editor does it
  vscode.window.activeTextEditor.selection = new vscode.Selection(7, 1, 7, 1);
  await vscode.commands.executeCommand("editor.action.revealDefinition");
  assert.deepEqual(await until(() => vscode.window.activeTextEditor.selection.active.line, (line) => line === 1), 1);
  const symbols = await vscode.commands.executeCommand("vscode.executeDocumentSymbolProvider", document.uri);
  const outer = symbols.find((s) => s.name === "outer");
  assert.deepEqual(outer.children.filter((c) => c.name === "inner").length, 1);
});

test("the snippets are there", async () => {
  const document = await open("calls.moth");
  const list = await vscode.commands.executeCommand("vscode.executeCompletionItemProvider", document.uri, new vscode.Position(9, 0));
  const snippets = list.items.filter((item) => item.kind === vscode.CompletionItemKind.Snippet).map((item) => (typeof item.label === "string" ? item.label : item.label.label));
  for (const prefix of ["to", "if", "repeat", "foreach", "try"]) assert.ok(snippets.includes(prefix), `no ${prefix} snippet in ${snippets.join(", ")}`);
});

test("without moth, Go to Definition stays in the file, and there's no hover", async () => {
  const document = await open("calls.moth");
  const found = await vscode.commands.executeCommand("vscode.executeDefinitionProvider", document.uri, new vscode.Position(8, 5)); // twice, lib.moth's
  assert.deepEqual(found, []);
  const hovers = await vscode.commands.executeCommand("vscode.executeHoverProvider", document.uri, new vscode.Position(8, 5));
  assert.deepEqual(hovers, []);
}, { withoutMoth: true });

test("with moth, Go to Definition goes into a file it uses, and hovers and completion come from moth lsp", async () => {
  const document = await open("calls.moth");
  const [found] = await vscode.commands.executeCommand("vscode.executeDefinitionProvider", document.uri, new vscode.Position(8, 5)); // twice
  assert.equal((found.uri ?? found.targetUri).fsPath, uri("lib.moth").fsPath);
  assert.equal((found.range ?? found.targetSelectionRange).start.line, 1);
  const hovers = await vscode.commands.executeCommand("vscode.executeHoverProvider", document.uri, new vscode.Position(8, 5));
  const said = hovers.flatMap((h) => h.contents.map((c) => (typeof c === "string" ? c : c.value))).join("\n");
  assert.match(said, /twice/);
  assert.match(said, /n doubled/); // the comment above it
  const list = await vscode.commands.executeCommand("vscode.executeCompletionItemProvider", document.uri, new vscode.Position(8, 5));
  const labels = list.items.map((item) => (typeof item.label === "string" ? item.label : item.label.label));
  for (const name of ["twice", "outer"]) assert.ok(labels.includes(name), `no ${name} in ${labels.slice(0, 30).join(", ")}`);
}, { needsMoth: true });

// how a task of the extension's ended, by its name: its exit code
const ended = (name) => new Promise((resolve) => {
  const listening = vscode.tasks.onDidEndTaskProcess((e) => {
    if (e.execution.task.name !== name) return;
    listening.dispose();
    resolve(e.exitCode);
  });
});
const within = (promise, seconds, what) => Promise.race([promise, sleep(seconds * 1000).then(() => Promise.reject(new Error(`${what} took more than ${seconds} seconds`)))]);

test("Build and Run start moth on the file, from the moth with spaces in its path, and what it said stays", async () => {
  await open("hello.moth");
  const made = path.join(folder, process.platform === "win32" ? "hello.exe" : "hello");
  let end = ended("build hello.moth");
  await vscode.commands.executeCommand("moth.build");
  assert.equal(await within(end, 120, "moth build"), 0);
  assert.ok(fs.existsSync(made), `moth build didn't make ${made}`);
  end = ended("run hello.moth");
  await vscode.commands.executeCommand("moth.run");
  assert.equal(await within(end, 120, "moth run"), 0);
  await sleep(1000);
  const names = vscode.window.terminals.map((t) => t.name);
  assert.ok(names.some((name) => name.includes("run hello.moth")), `the terminal with what it said has gone: ${names.join(", ")}`);
}, { needsMoth: true });

test("a program that's run can ask, and be answered in its terminal", async () => {
  await open("ask.moth");
  const end = ended("run ask.moth");
  await vscode.commands.executeCommand("moth.run");
  const terminal = await until(() => vscode.window.terminals.find((t) => t.name.includes("run ask.moth")));
  assert.ok(terminal, vscode.window.terminals.map((t) => t.name).join(", "));
  await sleep(3000); // built, and asking
  terminal.sendText("Sam");
  assert.equal(await within(end, 120, "moth run ask.moth"), 0);
}, { needsMoth: true });

test("a moth task in tasks.json runs moth", async () => {
  const [task] = (await vscode.tasks.fetchTasks({ type: "moth" })).filter((t) => t.name === "say hello");
  assert.ok(task, "VS Code didn't find the task");
  const end = ended("say hello");
  await vscode.tasks.executeTask(task);
  assert.equal(await within(end, 120, "the task"), 0);
}, { needsMoth: true });

test("the debugger stops at a breakpoint, and shows the variables", async () => {
  const document = await open("hello.moth");
  const said = [];
  const tracker = vscode.debug.registerDebugAdapterTrackerFactory("moth", { createDebugAdapterTracker: () => ({ onDidSendMessage: (m) => said.push(m) }) });
  vscode.debug.addBreakpoints([new vscode.SourceBreakpoint(new vscode.Location(document.uri, new vscode.Position(3, 0)))]);
  try {
    await vscode.commands.executeCommand("moth.debug");
    const stopped = await until(() => said.find((m) => m.type === "event" && m.event === "stopped"), Boolean, 120);
    assert.ok(stopped, `it didn't stop: ${JSON.stringify(said.slice(-5))}`);
    const session = vscode.debug.activeDebugSession;
    const { stackFrames } = await session.customRequest("stackTrace", { threadId: 1 });
    assert.deepEqual([path.basename(stackFrames[0].source.path), stackFrames[0].line], ["hello.moth", 4]);
    const { variables } = await session.customRequest("variables", { variablesReference: 1 });
    assert.deepEqual(variables.filter((v) => v.name === "n").map((v) => v.value), ["2"]);
    await session.customRequest("continue", { threadId: 1 });
    assert.ok(await until(() => said.some((m) => m.event === "terminated" || m.event === "exited"), Boolean, 60), "it didn't end");
    const output = said.filter((m) => m.event === "output").map((m) => m.body.output).join("");
    assert.match(output, /Hi Moth!/);
    assert.match(output, /42/);
  } finally {
    tracker.dispose();
    vscode.debug.removeBreakpoints(vscode.debug.breakpoints);
  }
}, { needsMoth: true });

exports.run = async () => {
  const failed = [];
  for (const { name, f } of tests) {
    try {
      await f();
      console.log(`ok - ${name}`);
    } catch (err) {
      failed.push(name);
      console.log(`not ok - ${name}\n${String(err.stack ?? err).replace(/^/gm, "    ")}`);
    }
  }
  console.log(`${tests.length - failed.length} of ${tests.length} passed (${moth ? `with moth, ${moth}` : "without moth"})`);
  if (failed.length) throw new Error(`${failed.length} failed: ${failed.join("; ")}`);
};
