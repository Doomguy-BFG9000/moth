// The cookbook, the examples and the exercises (DESIGN §129): the pages are what make-guides.mjs makes of
// guides/, every recipe says what its page says it does (or, where it needs a site, a server or a library,
// has no problem moth check finds), every example runs, and every exercise's tests pass with its example
// solution and fail with the file a learner starts from.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { guides, recipes, examples, sayOf, problemsOf } from "./make-guides.mjs";
import { test as testMoth } from "./moth.js";

test("docs/cookbook/ and docs/examples.html are what make-guides.mjs makes of guides/", () => {
  for (const [file, html] of Object.entries(guides())) {
    let kept = null;
    try {
      kept = readFileSync(new URL(`./docs/${file}`, import.meta.url), "utf8");
    } catch {}
    assert.ok(kept === html, `docs/${file} is behind: run node make-guides.mjs`);
  }
});

test("every recipe in the cookbook says what it shows, or has no problems where it can't run here", () => {
  const all = recipes();
  assert.ok(all.length >= 10);
  for (const recipe of all) {
    const blocks = recipe.parts.filter((p) => p.code !== undefined);
    assert.ok(blocks.length, `${recipe.slug} has no code`);
    for (const block of blocks) {
      assert.deepEqual(problemsOf(block.code), [], `${recipe.slug}:\n${block.code}`);
      if (block.output !== null) assert.equal(sayOf(block.code), block.output, `${recipe.slug}:\n${block.code}`);
    }
  }
});

test("every example runs, with no problems, and its link opens it in the playground", () => {
  const all = examples();
  assert.ok(all.length >= 8);
  const page = guides()["examples.html"];
  for (const example of all) {
    assert.deepEqual(problemsOf(example.code), [], example.file);
    assert.ok(sayOf(example.code).length > 0, `${example.file} says nothing`);
    const link = `../index.html#code=${encodeURIComponent(example.code)}`.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
    assert.ok(page.includes(`href="${link}"`), `${example.file}'s link`);
  }
});

test("every exercise's tests pass with its example solution, and fail with the file a learner starts from", () => {
  const root = new URL("./exercises/practice/", import.meta.url);
  const config = JSON.parse(readFileSync(new URL("./exercises/config.json", import.meta.url), "utf8"));
  const slugs = readdirSync(root).sort();
  assert.deepEqual(config.exercises.practice.map((e) => e.slug).sort(), slugs, "config.json lists every exercise");
  assert.equal(new Set(config.exercises.practice.map((e) => e.uuid)).size, slugs.length, "each exercise has a uuid of its own");
  for (const slug of slugs) {
    const snake = slug.replaceAll("-", "_");
    const read = (file) => readFileSync(new URL(`${slug}/${file}`, root), "utf8");
    const meta = JSON.parse(read(".meta/config.json"));
    assert.deepEqual(meta.files, { solution: [`${snake}.moth`], test: [`${snake}.test.moth`], example: [".meta/example.moth"] }, slug);
    assert.match(read(".docs/instructions.md"), /^# /, `${slug}'s instructions`);
    const tests = read(`${snake}.test.moth`);
    const run = (solution) => testMoth(tests, { files: (name) => (name === `${snake}.moth` ? solution : undefined) });
    const withExample = run(read(".meta/example.moth"));
    assert.ok(withExample.length > 0, slug);
    assert.deepEqual(withExample.filter((r) => r.error).map((r) => `${r.name}: ${r.error.message}`), [], `${slug} with its example`);
    assert.deepEqual(run(read(`${snake}.moth`)).filter((r) => !r.error).map((r) => r.name), [], `${slug}'s starting file passes a test`);
  }
});
