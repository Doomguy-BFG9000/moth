// Runs the extension's tests (suite.js) in VS Code itself, downloaded by @vscode/test-electron, on the extension
// as a .vsix has it: once with moth, and once without.
//
//     cd editors/vscode
//     npm ci
//     npx vsce package
//     node e2e/run.mjs                          (xvfb-run -a node e2e/run.mjs on Linux with no display)
//
// It takes the newest moth-*.vsix here, or the one it's given. moth is MOTH's, or the repository's own (made by
// node bootstrap.mjs); it's copied into a folder with spaces in its name, as Program Files has, and moth.path
// set to it. Without one, only the tests that need no moth run. MOTH_VSCODE_VERSION picks VS Code's version
// (stable, the newest, if it isn't set), which is kept in .vscode-test/ for next time.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTests } from "@vscode/test-electron";
import { copyMoth, downloadVSCode, findVsix, here, nowhere, profile, programs, unpack, vscodeVersion } from "./setup.mjs";

const vsix = findVsix(process.argv[2]);
const top = mkdtempSync(join(tmpdir(), "moth e2e "));
try {
  const extension = unpack(vsix, top);
  const folder = programs(top, {
    "broken.moth": "say (1\n",
    "typo.moth": "set totl to 1\nsay total\n",
    "messy.moth": "to   area with w,h\nreturn w*h\n  end\nsay area(2,3)\n",
    "calls.moth": 'use "lib.moth"\nto outer\n    to inner\n        say 1\n    end\n    inner()\nend\nouter()\nsay twice(3)\n',
    "lib.moth": "# twice: n doubled\nto twice with n\n    return n * 2\nend\n",
    "hello.moth": 'set name to "Moth"\nsay "Hi {name}!"\nset n to 2\nsay n * 21\n',
  });
  const moth = copyMoth(top);
  if (!moth) console.log("There's no moth here, so only the tests that need no moth run: make one with node bootstrap.mjs, or say where one is with MOTH.");

  const vscodeExecutablePath = await downloadVSCode();
  let failed = 0;
  for (const run of moth ? [moth, null] : [null]) {
    const args = profile(join(top, run ? "with moth" : "without moth"), { "moth.path": run ?? nowhere(top) });
    console.log(`\n${run ? "With moth" : "Without moth"}, in VS Code ${vscodeVersion}, from ${vsix}:`);
    try {
      await runTests({
        vscodeExecutablePath,
        extensionDevelopmentPath: extension,
        extensionTestsPath: join(here, "suite.js"),
        launchArgs: [folder, ...args],
        extensionTestsEnv: { MOTH_E2E_FOLDER: folder, MOTH_E2E_MOTH: run ?? "" },
      });
    } catch (err) {
      console.error(err.message);
      failed++;
    }
  }
  process.exitCode = failed ? 1 : 0;
} finally {
  rmSync(top, { recursive: true, force: true, maxRetries: 5 });
}
