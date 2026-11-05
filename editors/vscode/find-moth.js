// Where moth, Moth's command line, is: the moth.path setting if it says, or else the first moth (moth.exe on
// Windows) in a folder on the PATH. Run, Build, the debugger and the language server all start the one found
// here. This file doesn't need VS Code, so the tests can try it on folders of their own, and on Windows' ways
// of writing paths from Linux.
const fs = require("fs");
const os = require("os");
const path = require("path");

const RELEASES = "https://github.com/samyyy2423/moth/releases";

// whether a file is there to be run: "yes", "no" (nothing there, or a folder), or "not runnable" (a file on
// Linux that isn't marked as a program, as moth-linux is until chmod +x)
function onDisk(file, platform) {
  try {
    if (!fs.statSync(file).isFile()) return "no";
  } catch {
    return "no";
  }
  if (platform === "win32") return "yes";
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return "yes";
  } catch {
    return "not runnable";
  }
}

// The PATH's folders, in order: Windows calls it Path, separates its folders with ; and may put one in quotes
function pathFolders(env, platform) {
  const key = Object.keys(env).find((k) => (platform === "win32" ? k.toUpperCase() === "PATH" : k === "PATH"));
  const list = key ? String(env[key]) : "";
  return list
    .split(platform === "win32" ? ";" : ":")
    .map((folder) => folder.trim().replace(/^"(.*)"$/, "$1"))
    .filter(Boolean);
}

// Finds moth. `setting` is moth.path: empty (or just moth) to look on the PATH; a name, looked for on the PATH;
// or a path to moth, or to the folder it's in, from `folder` if it doesn't start at the top (~ is
// the home folder, and quotes around it, as Windows' "Copy as path" puts them, are left off). Gives
// { file } where it is, or { file: null, why, tried }: why is "not on the PATH", "not there" (moth.path says
// where, and there's nothing) or "not runnable", and tried is what was looked for.
function findMoth(setting, { env = process.env, platform = process.platform, folder, home = os.homedir(), check = onDisk } = {}) {
  const p = platform === "win32" ? path.win32 : path.posix;
  const exe = (name) => (platform === "win32" && !p.extname(name) ? `${name}.exe` : name);
  let wanted = String(setting ?? "").trim().replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1").trim();
  const isName = !(platform === "win32" ? /[\\/]/ : /\//).test(wanted) && !wanted.startsWith("~") && wanted !== "." && wanted !== "..";

  if (isName) {
    const name = exe(wanted || "moth");
    let notRunnable = null;
    for (const dir of pathFolders(env, platform)) {
      const file = p.join(dir, name);
      const there = check(file, platform);
      if (there === "yes") return { file };
      if (there === "not runnable") notRunnable ??= file;
    }
    return notRunnable ? { file: null, why: "not runnable", tried: notRunnable } : { file: null, why: "not on the PATH", tried: name };
  }

  if (wanted === "~" || wanted.startsWith("~/") || wanted.startsWith("~\\")) wanted = p.join(home, wanted.slice(1));
  if (!p.isAbsolute(wanted)) {
    if (!folder) return { file: null, why: "not there", tried: wanted }; // from a folder, with none (or one not trusted) to be from
    wanted = p.resolve(folder, wanted);
  }
  wanted = p.normalize(wanted);
  // the file itself, the same with .exe on Windows, or moth in the folder it names
  const candidates = [wanted];
  if (platform === "win32" && !p.extname(wanted)) candidates.push(`${wanted}.exe`);
  candidates.push(p.join(wanted, exe("moth")));
  for (const file of candidates) {
    const there = check(file, platform);
    if (there === "yes") return { file };
    if (there === "not runnable") return { file: null, why: "not runnable", tried: file };
  }
  return { file: null, why: "not there", tried: wanted };
}

// What to tell the person when moth can't be found, in a sentence or two
function missingMessage(found, platform = process.platform) {
  if (found.why === "not runnable") return `${found.tried} isn't marked as a program, so it can't be run. Run chmod +x "${found.tried}", then try again.`;
  if (found.why === "not there") return `moth.path says moth is at ${found.tried}, but it isn't there. Install Moth, or set moth.path to where moth${platform === "win32" ? ".exe" : ""} is.`;
  return `Moth's command line, moth${platform === "win32" ? ".exe" : ""}, isn't on your PATH. Hovers, completion, Run, Build and the debugger need it; colours, snippets, problems and Format Document work without it. Install it, or set moth.path to where it is.`;
}

module.exports = { findMoth, missingMessage, pathFolders, RELEASES };
