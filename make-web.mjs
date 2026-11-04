// Makes webpage.moth, the page `moth build --web` writes a program into: the playground (index.html) with
// Moth's engine in it, so the page needs nothing else, from a file or from any site:
//
//     node make-web.mjs
//
// Each of the engine's modules is in the page as text, and made a module from a blob: URL when it's first
// imported, its own imports pointing at the others' (mothModule, below). moth.test.js says when webpage.moth
// is behind the files it's made from.
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// what the page and its worker import, and what those import
export const MODULES = ["vm.js", "pictures.js", "scope.js", "jit.js", "wasm-binary.js", "wasm.js", "checker.js", "moth.js", "examples.js", "worker.js"];
export const PLACE = "/*MOTH_APP*/null"; // where moth puts the program, its name and the files it uses, as JSON

// text that's safe inside a <script>: no "</script" or "<!--" in it
const scripted = (text) => text.replace(/<\/(script)/gi, "<\\/$1").replace(/<!--/g, "<\\!--");

// the page, with the modules in it
export function webpage(read = (file) => readFileSync(new URL(`./${file}`, import.meta.url), "utf8")) {
  // without the site's own parts, marked "site only": its motion, which loads GSAP from the web, and which a
  // program's page, needing nothing else, goes without
  let html = read("index.html").replace(/\n[ \t]*<!-- site only[^]*?<!-- \/site only -->/g, "");
  const swap = (from, to) => {
    if (!html.includes(from)) throw new Error(`index.html has no ${from}`);
    html = html.replace(from, () => to); // a function, so a $ in `to` is itself
  };
  const imports = /import \{([^}]*)\} from "\.\/moth\.js";/.exec(html);
  if (!imports) throw new Error("index.html doesn't import moth.js as make-web.mjs expects");
  swap(imports[0], `const {${imports[1]}} = await import(mothModule("moth.js"));`);
  swap('import examples from "./examples.js";', 'const examples = (await import(mothModule("examples.js"))).default;');
  swap('new Worker("./worker.js", { type: "module" })', 'new Worker(mothModule("worker.js"), { type: "module" })');
  swap('<link rel="icon" href="docs/moth.svg" type="image/svg+xml">',
    `<link rel="icon" href="data:image/svg+xml;base64,${Buffer.from(read("docs/moth.svg")).toString("base64")}" type="image/svg+xml">`);
  const sources = Object.fromEntries(MODULES.map((name) => [name, read(name)]));
  const loader = [
    "  <script>",
    `    window.MOTH_APP = ${PLACE};`,
    `    const mothSources = ${scripted(JSON.stringify(sources))};`,
    "    const mothUrls = {};",
    "    // a module of the engine's, made from its text the first time it's asked for, its imports made so too",
    "    function mothModule(name) {",
    "      if (!mothUrls[name]) {",
    "        const text = mothSources[name].replace(/from \"\\.\\/([\\w.-]+\\.js)\"/g, (_, used) => `from \"${mothModule(used)}\"`);",
    "        mothUrls[name] = URL.createObjectURL(new Blob([text], { type: \"text/javascript\" }));",
    "      }",
    "      return mothUrls[name];",
    "    }",
    "  </script>",
  ].join("\n");
  swap("  <script type=\"module\">", `${loader}\n  <script type="module">`);
  if (html.split(PLACE).length !== 2) throw new Error(`the page must have ${PLACE} once`);
  return html;
}

// the page as a Moth text, for moth.moth: \ " and { escaped, line ends and tabs as \n and \t
const literal = (text) => `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\{/g, "\\{").replace(/\n/g, "\\n").replace(/\t/g, "\\t")}"`;

export function webpageMoth(read) {
  const html = webpage(read);
  if (/[\r\0-\x08\x0b-\x1f]/.test(html)) throw new Error("the page has a control character Moth text can't hold");
  return [
    "# The page `moth build --web` writes a program into: the playground, with Moth's engine in it, in app mode",
    "# (see index.html). Made by make-web.mjs from index.html and the engine's modules: change those, then run",
    "# it again.",
    "",
    `set page_place to "${PLACE}" # where the program goes, as JSON`,
    "",
    "to page_text",
    `    return ${literal(html)}`,
    "end",
    "",
  ].join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const made = webpageMoth();
  writeFileSync(new URL("./webpage.moth", import.meta.url), made);
  console.log(`made webpage.moth: ${made.length.toLocaleString("en")} bytes`);
}
