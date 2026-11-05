// Takes the README's pictures in VS Code itself (screenshots-suite.js has each), into images/, with the extension
// as a .vsix has it and the repository's moth (node bootstrap.mjs makes it, or say where one is with MOTH). On
// Linux, with ImageMagick, on a display of its own, the size the pictures are cut from:
//
//     cd editors/vscode
//     npx vsce package
//     xvfb-run -a -s "-screen 0 2600x1700x24" node e2e/screenshots.mjs
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTests } from "@vscode/test-electron";
import { copyMoth, downloadVSCode, extensionFolder, findVsix, here, profile, programs, unpack } from "./setup.mjs";

const vsix = findVsix(process.argv[2]);
const top = mkdtempSync(join(tmpdir(), "moth shots "));
try {
  const extension = unpack(vsix, top);
  const shop = readFileSync(join(here, "shop.moth"), "utf8");
  const prices = readFileSync(join(here, "prices.moth"), "utf8");
  const folder = programs(top, { "shop.moth": shop, "prices.moth": prices });
  const moth = copyMoth(top);
  if (!moth) throw new Error("There's no moth: make one with node bootstrap.mjs, or say where one is with MOTH.");
  const vscodeExecutablePath = await downloadVSCode();
  const look = {
    "workbench.colorTheme": "Default Dark Modern",
    "window.titleBarStyle": "native",
    "window.menuBarVisibility": "hidden",
    "workbench.layoutControl.enabled": false,
    "workbench.secondarySideBar.defaultVisibility": "hidden",
    "chat.disableAIFeatures": true,
    "editor.minimap.enabled": false,
    "editor.fontSize": 14,
    "editor.hover.delay": 100000, // a hover only when it's asked for
    "terminal.integrated.fontSize": 14,
    "debug.toolBarLocation": "docked",
  };
  // with moth for all but one picture; and without it, on a PATH with none, for the message that says so
  for (const run of [moth, null]) {
    const args = profile(join(top, run ? "with moth" : "without moth"), { ...look, "moth.path": run ?? "" });
    await runTests({
      vscodeExecutablePath,
      extensionDevelopmentPath: extension,
      extensionTestsPath: join(here, "screenshots-suite.js"),
      launchArgs: [folder, ...args, "--force-device-scale-factor=2"],
      extensionTestsEnv: { MOTH_SHOTS_FOLDER: folder, MOTH_SHOTS_OUT: join(extensionFolder, "images"), MOTH_SHOTS_MOTH: run ?? "", PATH: run ? process.env.PATH : "/usr/bin:/bin" },
    });
  }
} finally {
  rmSync(top, { recursive: true, force: true, maxRetries: 5 });
}
