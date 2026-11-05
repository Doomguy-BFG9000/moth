// The standard library's reference, docs/ on the site (DESIGN §128): made by make-docs.mjs from the libraries'
// own comments, so it must be what make-docs.mjs makes of them as they are, and every public function must
// have a comment to make it from.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { docs, pageOf, undocumented, readLibrary, signatureOf, summaryOf, KEPT } from "./make-docs.mjs";

test("docs/ is what make-docs.mjs makes of the standard library as it is", () => {
  const made = docs();
  const folder = new URL("./docs/", import.meta.url);
  for (const [file, html] of Object.entries(made)) {
    let kept = null;
    try {
      kept = readFileSync(new URL(file, folder), "utf8");
    } catch {}
    assert.ok(kept === html, `docs/${file} is behind: run node make-docs.mjs`);
  }
  const stray = readdirSync(folder).filter((file) => file.endsWith(".html") && !(file in made) && !KEPT.includes(file));
  assert.deepEqual(stray, [], "a page for a library that isn't there: run node make-docs.mjs");
});

test("every public function of the standard library says what it does", () => {
  assert.deepEqual(undocumented(), [], "write a comment above each, or name it as a helper in make-docs.mjs's HELPERS");
});

test("the reference reads a library's functions, inputs and examples as they're written", () => {
  assert.deepEqual(signatureOf("to search with index, query, k or 5"), { inputs: [{ name: "index", type: null, default: null },
    { name: "query", type: null, default: null }, { name: "k", type: null, default: "5" }], gives: null });
  assert.deepEqual(signatureOf("to area with width as a number and height as a number gives a number # the area"), { inputs: [
    { name: "width", type: "a number", default: null }, { name: "height", type: "a number", default: null }], gives: "a number" });
  assert.deepEqual(signatureOf('to f with on as yes or no or no, name or "a, b"'), { inputs: [{ name: "on", type: "yes or no", default: "no" },
    { name: "name", type: null, default: '"a, b"' }], gives: null });
  assert.deepEqual(signatureOf("to copy_file with from, to_path").inputs.map((i) => i.name), ["from", "to_path"]);
  assert.deepEqual(signatureOf("kind puppy with name from dog(name)").inputs.map((i) => i.name), ["name"]);
  assert.equal(summaryOf("the average: their sum divided by how many there are"), "The average: their sum divided by how many there are");
  assert.equal(summaryOf("Reads JSON. Then more."), "Reads JSON.");

  // a library of helpers and public functions, its example from its tests, cut down to what it needs
  const files = {
    "tools/stats.moth": "# Statistics.\n#\n#   use \"stats.moth\" as stats\n#   say stats's mean(list of 1, 2)   # 1.5\n\n# the average\nto mean with numbers\n    return stats_sum(numbers) / length of numbers\nend\n\nto stats_sum with numbers\n    set sum to 0\n    for each x in numbers\n        set sum to sum + x\n    end\n    return sum\nend\n\n# the largest less the smallest\nto spread with numbers\n    return (largest of numbers) - (smallest of numbers)\nend\n",
    "tools/stats.test.moth": "use \"stats.moth\" as s\n\nto test_spread\n    set xs to list of 1, 5\n    set ys to list of 2\n    add 9 to xs\n    expect s's spread(xs) is 8\nend\n",
  };
  const lib = readLibrary("tools/stats.moth", (file) => files[file]);
  assert.deepEqual(lib.functions.map((fn) => fn.name), ["mean", "spread"]);
  const page = pageOf("tools/stats.moth", (file) => files[file] ?? readFileSync(new URL(`./${file}`, import.meta.url), "utf8"));
  assert.match(page, /<p>the average<\/p>/);
  assert.match(page, /class="says"><code>1\.5<\/code>/);
  // the `set` of xs and the `add` that changes it are kept, ys isn't, and `expect` is said
  const spread = page.split('id="spread"')[1].split("</section>")[0];
  const code = /<pre><code>([^]*?)<\/code><\/pre>/.exec(spread)[1].replace(/<[^>]+>/g, "").replace(/&quot;/g, '"');
  assert.equal(code, "use \"stats.moth\" as stats\nset xs to list of 1, 5\nadd 9 to xs\nsay stats's spread(xs)");
  assert.match(spread, /class="says"><code>8<\/code>/);
  assert.doesNotMatch(page, /stats_sum\(numbers\)<\/code><\/a>/, "a helper has no entry of its own");
});
