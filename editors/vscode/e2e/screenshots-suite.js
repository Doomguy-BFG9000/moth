// The README's pictures, taken in VS Code itself: run in its extension host by screenshots.mjs, which starts VS
// Code on a display of its own. Each scene is put on the screen with VS Code's API, as a person would by hand,
// and the screen is taken with ImageMagick's import, cut to what the picture is of. MOTH_SHOTS_OUT is where they
// go, and MOTH_SHOTS_MOTH says whether this VS Code has moth: the picture of moth missing is taken without it.
const vscode = require("vscode");
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const folder = process.env.MOTH_SHOTS_FOLDER;
const out = process.env.MOTH_SHOTS_OUT;
const frames = path.join(out, "frames");
const scale = 2; // VS Code runs with --force-device-scale-factor=2: each point is 2 pixels
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const file = (name) => vscode.Uri.file(path.join(folder, name));
async function until(get, ok = Boolean, seconds = 20) {
  let value;
  for (const end = Date.now() + seconds * 1000; Date.now() < end; await sleep(100)) {
    value = await get();
    if (ok(value)) return value;
  }
  return value;
}
const run = (command, ...args) => vscode.commands.executeCommand(command, ...args);
async function open(name, line = 0, character = 0) {
  const editor = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file(name)), { preview: false });
  editor.selection = new vscode.Selection(line, character, line, character);
  editor.revealRange(new vscode.Range(line, 0, line, 0), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  return editor;
}
async function typeText(text, pause = 60) {
  for (const character of text) {
    await run("type", { text: character });
    await sleep(pause);
  }
}

// The screen, cut to x, y, width and height, in VS Code's points, into out/name.png; or into frames/ for a GIF
function shot(name, [x, y, width, height], into = out) {
  fs.mkdirSync(into, { recursive: true });
  const target = path.join(into, `${name}.png`);
  execFileSync("import", ["-window", "root", "-crop", `${width * scale}x${height * scale}+${x * scale}+${y * scale}`, "+repage", target]);
  return target;
}
// frames, each shown for its hundredths of a second, as out/name.gif
function gif(name, shown) {
  const args = ["-loop", "0"];
  for (const [frame, hundredths] of shown) args.push("-delay", String(hundredths), frame);
  execFileSync("convert", [...args, "-layers", "Optimize", path.join(out, `${name}.gif`)]);
}
const settle = () => sleep(1200);

// where things are on a 1300 by 850 screen, VS Code filling it, below its title bar
const EDITOR = [0, 35, 1300, 630]; // the editor, with the activity bar
const WINDOW = [0, 35, 1300, 815];

const withMoth = [
  async function problems() {
    // a misspelling typed: the squiggle as it's typed, what it says, the Quick Fix, and the code put right
    const editor = await open("shop.moth", 25, 0);
    const line = editor.document.lineAt(25);
    const at = line.text.indexOf("cost)");
    editor.selection = new vscode.Selection(25, at, 25, at + 4);
    await run("deleteLeft");
    await settle();
    const shown = [[shot("problems-0", EDITOR, frames), 120]];
    await typeText("cots");
    await sleep(900);
    shown.push([shot("problems-1", EDITOR, frames), 150]);
    editor.selection = new vscode.Selection(25, at + 1, 25, at + 1);
    await run("editor.action.showHover");
    await settle();
    shown.push([shot("problems-2", EDITOR, frames), 300]);
    await run("editor.action.quickFix");
    await settle();
    shown.push([shot("problems-3", EDITOR, frames), 220]);
    await run("acceptSelectedCodeAction");
    await sleep(400);
    if (editor.document.lineAt(25).text.includes("cots")) await run("editor.action.codeAction", { kind: "quickfix", apply: "first" });
    await run("cursorEnd");
    await run("editor.action.hideHover").then(undefined, () => {});
    await settle();
    shown.push([shot("problems-4", EDITOR, frames), 250]);
    gif("problems", shown);
    await run("workbench.action.files.revert");
  },

  async function formatting() {
    // prices.moth written any old way, then Format Document
    const editor = await open("prices.moth");
    const messy = [
      "# price_of: what one of an item costs, in pounds",
      "to  price_of with thing as text gives a number",
      "match thing",
      "  when \"apples\"",
      "      return 2.4",
      "  when \"bread\"",
      "     return 1.35",
      "        when \"tea\"",
      "  return 3.1",
      "  else",
      "   fail with \"we don't sell {thing}\"",
      "end",
      "    end",
      "",
      "to test_price_of",
      "expect price_of( \"tea\" ) is 3.1",
      "  end",
      "",
    ].join("\n");
    await editor.edit((e) => e.replace(new vscode.Range(0, 0, editor.document.lineCount, 0), messy));
    await settle();
    const before = shot("format-0", EDITOR, frames);
    await run("workbench.action.quickOpen", ">Format Document");
    await settle();
    const asking = shot("format-1", EDITOR, frames);
    await run("workbench.action.closeQuickOpen");
    await run("editor.action.formatDocument");
    await settle();
    const after = shot("format-2", EDITOR, frames);
    gif("format", [[before, 200], [asking, 120], [after, 300]]);
    await run("workbench.action.files.revert");
  },

  async function outline() {
    // the Explorer with only the outline in it
    await open("shop.moth", 15, 3);
    await run("workbench.view.explorer");
    for (const view of ["workbench.explorer.fileView", "timeline"]) await run(`${view}.removeView`).then(undefined, () => {});
    await run("outline.focus");
    await run("outline.expand").then(undefined, () => {});
    await settle();
    shot("outline", [0, 35, 1000, 630]);
    await run("workbench.action.closeSidebar");
  },

  async function definition() {
    // Go to Definition, peeked: price_of, in the file shop.moth uses
    const editor = await open("shop.moth", 8, 18);
    await run("workbench.action.closeSidebar");
    await until(() => run("vscode.executeDefinitionProvider", editor.document.uri, new vscode.Position(8, 18)), (d) => d?.length > 0);
    await run("editor.action.peekDefinition");
    await settle();
    shot("definition", EDITOR);
    await run("closeReferenceSearch");
  },

  async function hover() {
    await open("shop.moth", 25, 24); // change_for
    await sleep(500);
    await run("editor.action.showHover");
    await settle();
    shot("hover", EDITOR);
    await run("editor.action.hideHover").then(undefined, () => {});
  },

  async function completion() {
    await open("shop.moth", 26, 0);
    await typeText("say shopping's ");
    await sleep(300);
    await run("editor.action.triggerSuggest");
    await settle();
    shot("completion", EDITOR);
    await run("hideSuggestWidget");
    await run("workbench.action.files.revert");
  },

  async function debugging() {
    // a breakpoint in total, and the debugger stopped there: the variables, the calls, and the line
    const editor = await open("shop.moth", 8, 0);
    vscode.debug.addBreakpoints([new vscode.SourceBreakpoint(new vscode.Location(editor.document.uri, new vscode.Position(8, 0)))]);
    const stopped = new Promise((resolve) => {
      const tracker = vscode.debug.registerDebugAdapterTrackerFactory("moth", {
        createDebugAdapterTracker: () => ({ onDidSendMessage: (m) => m.event === "stopped" && (tracker.dispose(), resolve()) }),
      });
    });
    await run("moth.debug");
    await Promise.race([stopped, sleep(90_000).then(() => Promise.reject(new Error("the debugger didn't stop at the breakpoint")))]);
    await sleep(800);
    await run("workbench.debug.action.focusVariablesView");
    await sleep(500);
    await run("list.focusFirst");
    await run("list.expand");
    await settle();
    shot("debugger", WINDOW);
    await vscode.debug.stopDebugging();
    vscode.debug.removeBreakpoints(vscode.debug.breakpoints);
    await run("workbench.action.closeSidebar");
    await run("workbench.action.closePanel");
  },

  async function running() {
    await open("shop.moth", 25, 0);
    const ended = new Promise((resolve) => vscode.tasks.onDidEndTaskProcess((e) => e.execution.task.name === "run shop.moth" && resolve()));
    await run("moth.run");
    await Promise.race([ended, sleep(90_000)]);
    await sleep(1500);
    shot("run", [0, 300, 1300, 550 - 35]);
  },
];

const withoutMoth = [
  async function missing() {
    // the one message, as the extension starts with no moth to be found
    await run("notifications.clearAll");
    await sleep(500);
    await open("shop.moth");
    await settle();
    shot("missing-moth", [400, 560, 900, 290 - 35]);
  },
];

exports.run = async () => {
  await run("notifications.clearAll");
  await run("workbench.action.closeSidebar");
  await run("workbench.action.closePanel");
  for (const scene of process.env.MOTH_SHOTS_MOTH ? withMoth : withoutMoth) {
    await run("notifications.clearAll");
    console.log(`taking ${scene.name}`);
    await scene();
  }
  fs.rmSync(frames, { recursive: true, force: true });
};
