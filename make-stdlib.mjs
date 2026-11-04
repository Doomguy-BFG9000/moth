// Makes stdlib.moth, the standard library moth carries, from math.moth and the libraries in tools/:
//
//     node make-stdlib.mjs
//
// moth.moth uses it, so a program anywhere can `use "json.moth"`: the file beside the program first, then
// moth's own copy. moth.test.js says when stdlib.moth is behind the files it's made from.
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// the libraries: each file a program uses for what it does, not a program, an example or a test; and the
// profiler `moth profile` builds into a program
export const STANDARD = ["math.moth", "moth-profiler.moth", "moth-coverage.moth", ...["base64", "big", "collections", "cores", "dates", "email", "game", "hash", "http", "json", "linux", "lists", "log", "options", "secrets", "server", "sockets", "sqlite",
  "stats", "sync", "system", "tasks", "text", "toml", "ui", "websocket", "windows", "xml", "zip", "zones"].map((name) => `tools/${name}.moth`)];

// a file's text as a Moth text: \ " and { escaped, line ends and tabs as \n and \t
const literal = (text) => `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\{/g, "\\{").replace(/\n/g, "\\n").replace(/\t/g, "\\t")}"`;

export function stdlib(read = (file) => readFileSync(new URL(`./${file}`, import.meta.url), "utf8")) {
  const lines = [
    "# The standard library, which moth carries, so a program anywhere can use it: `use \"json.moth\"` finds the",
    "# file beside the program first, then this copy. Made by make-stdlib.mjs from math.moth and the libraries in",
    "# tools/: change those, then run it again.",
    "",
    `set standard_names to list of ${STANDARD.map((file) => `"${file.split("/").at(-1)}"`).join(", ")}`,
    "",
    "# a file of the standard library's text, by its name, or nothing if none is called that",
    "to standard_text with name",
  ];
  for (const file of STANDARD) {
    const text = read(file);
    if (/[\r\0-\x08\x0b-\x1f]/.test(text)) throw new Error(`${file} has a control character Moth text can't hold`);
    lines.push(`    if name is "${file.split("/").at(-1)}"`, `        return ${literal(text)}`, "    end");
  }
  lines.push("    return nothing", "end", "");
  return lines.join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const made = stdlib();
  writeFileSync(new URL("./stdlib.moth", import.meta.url), made);
  console.log(`made stdlib.moth: ${STANDARD.length} files, ${made.length.toLocaleString("en")} bytes`);
}
