// Checks the .vsix vsce made, before it's tested or published: what vsce ls says it packs is FILES, make-vsix.mjs's
// list, no more and no less; the .vsix holds those files, the engine as the repository has it; its manifest is
// package.json's; its README's pictures come from the web, as the Marketplace shows them; and it's small.
//
//     npx vsce package
//     node check-package.mjs [moth-0.1.0.vsix]
import { readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { FILES, ENGINE, unzip } from "./make-vsix.mjs";

const here = (file) => new URL(file, import.meta.url);
const manifest = JSON.parse(readFileSync(here("package.json"), "utf8"));
const vsix = process.argv[2] ?? `moth-${manifest.version}.vsix`;
const LIMIT = 1024 * 1024; // the extension and its engine are under 200 KB packed: a megabyte means something got in
const wrong = [];
const sameSet = (what, got, want) => {
  const extra = got.filter((f) => !want.includes(f));
  const missing = want.filter((f) => !got.includes(f));
  if (extra.length) wrong.push(`${what} has what it shouldn't: ${extra.join(", ")}`);
  if (missing.length) wrong.push(`${what} is missing ${missing.join(", ")}`);
};

// what vsce packs, from this folder as .vscodeignore leaves it
const vsce = spawnSync(process.execPath, [new URL("./node_modules/@vscode/vsce/vsce", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"), "ls"], { cwd: here("."), encoding: "utf8" });
if (vsce.status !== 0) {
  console.error(`vsce ls failed:\n${vsce.stdout}${vsce.stderr}`);
  process.exit(1);
}
const listed = vsce.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
sameSet("vsce ls", listed, FILES);

// the .vsix: those files, under extension/, with the names a .vsix gives a readme, changelog and licence
const size = statSync(vsix).size;
if (size > LIMIT) wrong.push(`${vsix} is ${size.toLocaleString("en")} bytes, more than ${LIMIT.toLocaleString("en")}`);
const files = unzip(readFileSync(vsix));
const named = { "README.md": "readme.md", "CHANGELOG.md": "changelog.md", LICENSE: "LICENSE.txt" };
sameSet(vsix, [...files.keys()], ["extension.vsixmanifest", "[Content_Types].xml", ...FILES.map((f) => `extension/${named[f] ?? f}`)]);
for (const file of ENGINE) {
  if (!files.get(`extension/engine/${file}`)?.equals(readFileSync(new URL(`../../${file}`, import.meta.url)))) wrong.push(`engine/${file} isn't the repository's ${file}`);
}
const packed = JSON.parse(files.get("extension/package.json") ?? "{}");
for (const key of ["name", "publisher", "version", "icon"]) if (packed[key] !== manifest[key]) wrong.push(`its package.json's ${key} is ${packed[key]}, not ${manifest[key]}`);
const vsixManifest = String(files.get("extension.vsixmanifest") ?? "");
for (const want of [`Id="${manifest.name}" Version="${manifest.version}" Publisher="${manifest.publisher}"`, "<Icon>extension/images/icon.png</Icon>", 'EnableMarketplaceQnA" Value="false"', `Branding.Color" Value="${manifest.galleryBanner.color}"`]) {
  if (!vsixManifest.includes(want)) wrong.push(`its manifest doesn't say ${want}`);
}
// the README's pictures, and its links, are on the web: none of the .vsix's own but the icon
const readme = String(files.get("extension/readme.md") ?? "");
for (const [, link] of readme.matchAll(/\]\(([^)\s]+)/g)) if (!/^(https:\/\/|#|mailto:)/.test(link)) wrong.push(`the README links to ${link}, which isn't on the web`);
for (const [, src] of readme.matchAll(/<img[^>]*\ssrc="([^"]+)"/g)) if (!src.startsWith("https://")) wrong.push(`the README shows ${src}, which isn't on the web`);

if (wrong.length) {
  console.error(`${vsix} isn't right:\n${wrong.map((w) => `- ${w}`).join("\n")}`);
  process.exit(1);
}
console.log(`${vsix}: ${files.size} files, ${size.toLocaleString("en")} bytes, as FILES says`);
