// Makes the site's cookbook and examples pages, from guides/:
//
//     node make-guides.mjs
//
// docs/cookbook/index.html, from each recipe in guides/cookbook/ (Markdown: a # title, prose, ```moth blocks
// and ```output blocks), and docs/examples.html, from each program in guides/examples/ (its opening comment's
// first line is its title, the rest what it is). A ```moth block followed by an ```output block is run on the
// JavaScript engine and must say exactly that; any other ```moth block (one that needs a site, a server, a
// database or a window) must have no problems that moth check finds. guides.test.js holds them to it, and
// says when the pages are behind what they're made from.
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { page, prose, codeBlock, escape, highlight, libraryFiles, summaryOf } from "./make-docs.mjs";
import { run, check, memoryDisk } from "./moth.js";

const here = (file) => readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
const list = (folder, ending) => readdirSync(new URL(`./${folder}/`, import.meta.url)).filter((f) => f.endsWith(ending)).sort();

// the standard library's files, for a `use` in a recipe or an example
const library = (name) => (libraryFiles.has(name) ? here(libraryFiles.get(name)) : undefined);

// What a piece of code says on the JavaScript engine, as text, with files kept in memory; or the mistake it
// makes, thrown
export function sayOf(code) {
  const said = [];
  run(code, (line) => said.push(String(line)), { maxSteps: 50_000_000, files: library, disk: memoryDisk(), printError: () => {},
    exit: () => {}, ask: () => "7", draw: () => {} });
  return said.join("\n");
}

// the problems moth check finds in code, as "line: message"
export function problemsOf(code) {
  return check(code, { files: library }).filter((p) => p.kind === "error").map((p) => `${p.line}: ${p.message}`);
}

// A recipe: { slug, title, parts }, each part { prose } or { code, output } (output null for code that's only
// checked), from its Markdown
export function readRecipe(file, read = here) {
  const lines = read(`guides/cookbook/${file}`).replace(/\r\n/g, "\n").split("\n");
  const title = /^# (.+)$/.exec(lines[0])?.[1];
  if (!title) throw new Error(`guides/cookbook/${file} doesn't start with a # title`);
  const parts = [];
  let paragraph = [];
  const endParagraph = () => {
    if (paragraph.length) parts.push({ prose: paragraph.join(" ") });
    paragraph = [];
  };
  for (let at = 1; at < lines.length; at++) {
    const fence = /^```(\w+)?\s*$/.exec(lines[at]);
    if (!fence) {
      if (lines[at].trim() === "") endParagraph();
      else paragraph.push(lines[at].trim());
      continue;
    }
    endParagraph();
    const block = [];
    for (at++; at < lines.length && lines[at] !== "```"; at++) block.push(lines[at]);
    if (fence[1] === "output") {
      const last = parts.at(-1);
      if (!last || last.code === undefined || last.output !== null) throw new Error(`guides/cookbook/${file}: an output block after something that isn't code`);
      last.output = block.join("\n");
    } else if (fence[1] === "moth") parts.push({ code: block.join("\n"), output: null });
    else throw new Error(`guides/cookbook/${file}: a block of ${fence[1] ?? "nothing"}; only moth and output`);
  }
  endParagraph();
  return { slug: file.replace(/^\d+-/, "").replace(/\.md$/, ""), title, parts };
}

// An example program: { slug, title, about, code }, its title and what it is from its opening comment
export function readExample(file, read = here) {
  const code = read(`guides/examples/${file}`).replace(/\r\n/g, "\n").replace(/\n+$/, "");
  const opening = [];
  for (const line of code.split("\n")) {
    if (!line.startsWith("#")) break;
    opening.push(line.replace(/^# ?/, ""));
  }
  if (!opening.length) throw new Error(`guides/examples/${file} has no opening comment`);
  return { slug: file.replace(/^\d+-/, "").replace(/\.moth$/, ""), title: opening[0], about: opening.slice(1).join(" ").trim(), code };
}

// the playground, from docs/, with the code in its address, as its Share button makes it
const playground = (code) => `../index.html#code=${encodeURIComponent(code)}`;

function cookbookPage(recipes) {
  const sections = recipes.map((r) => `      <section class="fn recipe" id="${r.slug}">
        <h2><a href="#${r.slug}">${escape(r.title)}</a></h2>
${r.parts.map((p) => (p.code !== undefined ? `        ${codeBlock(p.code, p.output)}` : `        <p>${prose(p.prose)}</p>`)).join("\n")}
      </section>`).join("\n");
  const hero = `      <p class="eyebrow">The cookbook</p>
      <h1>Recipes for <em>real work</em>.</h1>
      <p>Short, complete answers to the things programs are for: files, JSON and CSV, web APIs and servers, the
        command line, numbers and charts, dates, every core of the machine, and tests. Every recipe here is run, or
        checked, each time Moth changes, so none of them goes stale.</p>`;
  const body = `  <div class="layout wrap">
    <nav class="toc" aria-label="The recipes">
      <h2>${recipes.length} recipes</h2>
      <ol>${recipes.map((r) => `<li><a href="#${r.slug}">${escape(r.title)}</a></li>`).join("")}</ol>
      <p class="more"><a href="../">The standard library</a> · <a href="../examples.html">Examples</a></p>
    </nav>
    <main class="prose">
${sections}
    </main>
  </div>`;
  return page({ title: "The Moth cookbook", description: "Short, tested recipes for real work in Moth: files, JSON, CSV, web APIs, servers, the command line, data, dates, every core and tests.", root: "../../", current: "Cookbook", hero, body });
}

function examplesPage(examples) {
  const cards = examples.map((e) => `      <section class="fn example" id="${e.slug}">
        <h2><a href="#${e.slug}">${escape(e.title)}</a></h2>
        <p>${prose(e.about)}</p>
        <p class="written"><a class="run" href="${escape(playground(e.code))}">Run it in the playground</a> · <a href="https://github.com/samyyy2423/moth/blob/main/guides/examples/${e.file}">The source</a></p>
        ${codeBlock(e.code)}
      </section>`).join("\n");
  const hero = `      <p class="eyebrow">Examples</p>
      <h1>Whole programs, <em>ready to run</em>.</h1>
      <p>Small complete programs that show what Moth is like to write: each runs in the playground with a click,
        and each is run every time Moth changes. To practise, the <a href="https://github.com/samyyy2423/moth/tree/main/exercises">exercises</a>
        have tests to make pass, from hello world up.</p>`;
  const body = `  <div class="layout wrap">
    <nav class="toc" aria-label="The examples">
      <h2>${examples.length} programs</h2>
      <ol>${examples.map((e) => `<li><a href="#${e.slug}">${escape(e.title)}</a></li>`).join("")}</ol>
      <p class="more"><a href="cookbook/">The cookbook</a> · <a href="https://github.com/samyyy2423/moth/tree/main/exercises">Exercises</a></p>
    </nav>
    <main class="prose">
${cards}
    </main>
  </div>`;
  return page({ title: "Moth examples", description: summaryOf("Small complete Moth programs, each ready to run in the playground."), root: "../", current: "Examples", hero, body });
}

export function recipes(read = here) {
  return list("guides/cookbook", ".md").map((file) => readRecipe(file, read));
}

export function examples(read = here) {
  return list("guides/examples", ".moth").map((file) => ({ ...readExample(file, read), file }));
}

// the pages, by their place under docs/
export function guides(read = here) {
  return { "cookbook/index.html": cookbookPage(recipes(read)), "examples.html": examplesPage(examples(read)) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  mkdirSync(new URL("./docs/cookbook/", import.meta.url), { recursive: true });
  const made = guides();
  for (const [file, html] of Object.entries(made)) writeFileSync(new URL(`./docs/${file}`, import.meta.url), html);
  console.log(`made docs/cookbook/index.html (${recipes().length} recipes) and docs/examples.html (${examples().length} programs)`);
}
