// What run.mjs and screenshots.mjs both do before they start VS Code: the .vsix to use, unpacked as VS Code
// installs it; a folder of Moth programs, with a space in its name; moth, where Windows would have it; and a
// profile of VS Code's own for each run, with its settings.
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { downloadAndUnzipVSCode } from "@vscode/test-electron";
import { unzip } from "../make-vsix.mjs";

export const here = dirname(fileURLToPath(import.meta.url));
export const extensionFolder = join(here, "..");
const windows = process.platform === "win32";

// the .vsix named, or the newest moth-*.vsix in the extension's folder
export function findVsix(named) {
  const vsix = named ?? readdirSync(extensionFolder).filter((f) => /^moth-.*\.vsix$/.test(f)).map((f) => join(extensionFolder, f)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
  if (!vsix || !existsSync(vsix)) throw new Error("There's no .vsix: make one with npx vsce package, or name one.");
  return vsix;
}

// the extension's folder, as the .vsix has it, in `top`
export function unpack(vsix, top) {
  for (const [name, data] of unzip(readFileSync(vsix))) {
    if (!name.startsWith("extension/")) continue;
    const file = join(top, name);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, data);
  }
  return join(top, "extension");
}

// `files`, by name, in top/my programs
export function programs(top, files) {
  const folder = join(top, "my programs");
  mkdirSync(folder, { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(folder, name), text);
  return folder;
}

// moth: MOTH's, or the repository's own (node bootstrap.mjs makes it), copied to top/Program Files/Moth; or null
export function copyMoth(top) {
  const given = process.env.MOTH || join(extensionFolder, "..", "..", windows ? "moth.exe" : "moth");
  if (process.env.MOTH && !existsSync(process.env.MOTH)) throw new Error(`MOTH says moth is at ${process.env.MOTH}, but it isn't there.`);
  if (!existsSync(given)) return null;
  const moth = join(top, "Program Files", "Moth", windows ? "moth.exe" : "moth");
  mkdirSync(dirname(moth), { recursive: true });
  copyFileSync(given, moth);
  chmodSync(moth, 0o755);
  return moth;
}
export const nowhere = (top) => join(top, "no moth here", windows ? "moth.exe" : "moth");

// a profile for VS Code in `folder`, with these settings over a quiet VS Code's: its arguments
export function profile(folder, settings) {
  mkdirSync(join(folder, "data", "User"), { recursive: true });
  writeFileSync(join(folder, "data", "User", "settings.json"), JSON.stringify({
    "workbench.startupEditor": "none",
    "workbench.tips.enabled": false,
    "update.mode": "none",
    "extensions.autoCheckUpdates": false,
    "telemetry.telemetryLevel": "off",
    "git.enabled": false,
    ...settings,
  }, null, 2));
  return [`--user-data-dir=${join(folder, "data")}`, `--extensions-dir=${join(folder, "extensions")}`, "--disable-extensions"];
}

// VS Code, MOTH_VSCODE_VERSION's (stable, the newest, if it isn't set), kept in .vscode-test for next time
export const vscodeVersion = process.env.MOTH_VSCODE_VERSION || "stable";
export const downloadVSCode = () => downloadAndUnzipVSCode({ version: vscodeVersion, cachePath: join(extensionFolder, ".vscode-test") });
