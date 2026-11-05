// Writes the SBOM of a release: a CycloneDX 1.6 JSON file that names each file the release gives (moth-linux,
// moth-windows.exe and the .deb, with their sums) and everything built into moth, which is Moth's own source:
// each file moth.moth is compiled with, the files the standard library and the web page are made from, and
// the DejaVu letters in machine.moth, the only part someone else made. moth links no library, so that's all:
//
//     node packaging/sbom.mjs <folder with the release's files> <version> [the commit]
//
// It writes <folder>/moth-<version>.cdx.json. The sources are read from this checkout, so run it on the commit
// the release was built from; the time in it is SOURCE_DATE_EPOCH's (else the commit's), and its serial number
// comes from what it says, so the same release makes the same SBOM.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { STANDARD } from "../make-stdlib.mjs";
import { MODULES } from "../make-web.mjs";

const REPO = "https://github.com/samyyy2423/moth";
const root = new URL("../", import.meta.url);
const read = (file) => readFileSync(new URL(file, root));

// what moth.moth is compiled with (as bootstrap.mjs, and moth build moth.moth --include moth-debugger.moth, do),
// and what each is
export const BUILT_IN = {
  "moth.moth": "the moth command: build, run, test, check, tidy, debug, the shell and packages",
  "machine.moth": "the compiler's back end, which writes x86-64 machine code as Windows' PE and Linux's ELF, and the runtime every program carries",
  "compiler.moth": "the compiler written in Moth: reading a program, its names and its checks",
  "stdlib.moth": "the standard library moth carries, made by make-stdlib.mjs from math.moth and tools/",
  "webpage.moth": "the page moth build --web writes a program into, made by make-web.mjs from the playground and its engines",
  "checker-rules.moth": "the types moth check works out, made by make-checker-rules.mjs from checker.js and vm.js",
  "tools/hash.moth": "SHA-256, for the sums of packages' files in moth.sums",
  "moth-debugger.moth": "the debugger moth debug builds into a program, built into moth with --include",
};
const WEB = ["index.html", "docs/moth.svg", ...MODULES];

const sha = (bytes, algorithm) => createHash(algorithm).update(bytes).digest("hex");
const hashes = (bytes) => [{ alg: "SHA-256", content: sha(bytes, "sha256") }, { alg: "SHA-512", content: sha(bytes, "sha512") }];
const apache = [{ license: { id: "Apache-2.0" } }];

// a UUID made from the SBOM's own text, in the form of a random one (version 4, RFC 4122's variant)
function uuidOf(text) {
  const h = sha(text, "sha256").slice(0, 32).split("");
  h[12] = "4";
  h[16] = "89ab"[parseInt(h[16], 16) % 4];
  const s = h.join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

export function sbom({ folder, version, commit, epoch }) {
  const tag = `v${version}`;
  const purl = `pkg:github/samyyy2423/moth@${tag}`;
  const source = (file, type, description, kind = "source") => ({
    type, "bom-ref": `${kind}:${file}`, name: file, version, description, hashes: hashes(read(file)), licenses: apache,
    externalReferences: [{ type: "vcs", url: `${REPO}/blob/${commit ?? tag}/${file}` }],
  });
  const dejavu = {
    type: "data", "bom-ref": "dejavu-glyphs", name: "DejaVu Sans and DejaVu Sans Mono glyph tables",
    description: "the letters a Linux program draws text with, drawn from DejaVu's fonts into machine.moth by tools/glyph-tables.py; the only part of moth someone else made",
    copyright: "Copyright (c) 2003 by Bitstream, Inc. All Rights Reserved. DejaVu changes are in public domain.",
    licenses: [{ license: { id: "Bitstream-Vera" } }],
    externalReferences: [{ type: "website", url: "https://dejavu-fonts.github.io/" }, { type: "license", url: `${REPO}/blob/${commit ?? tag}/LICENSE-DejaVu` }],
  };

  const programs = [
    ["moth-linux", "moth for Linux on x86-64: one static ELF program that loads no library"],
    ["moth-windows.exe", "moth for Windows on x64: one PE program that loads only Windows' own DLLs, from System32"],
  ].map(([name, description]) => {
    const path = join(folder, name);
    if (!existsSync(path)) throw new Error(`there's no ${name} in ${folder}`);
    return { type: "application", "bom-ref": name, name, version, description: `${description}, built by moth from the sources this SBOM lists`, hashes: hashes(readFileSync(path)), licenses: apache, purl: `${purl}#${name}` };
  });
  const deb = `moth_${version}_amd64.deb`;
  const packages = existsSync(join(folder, deb))
    ? [{ type: "application", "bom-ref": deb, name: deb, version, description: "the Debian and Ubuntu package of moth-linux, as /usr/bin/moth", hashes: hashes(readFileSync(join(folder, deb))), licenses: apache, purl: `pkg:deb/moth@${version}?arch=amd64` }]
    : [];

  const sources = Object.entries(BUILT_IN).map(([file, description]) => source(file, "file", description));
  const library = STANDARD.map((file) => source(file, "library", `part of the standard library: use "${file.split("/").at(-1)}"`, "stdlib"));
  const page = WEB.map((file) => source(file, "file", "part of the page moth build --web writes", "webpage"));
  const refs = (list) => list.map((c) => c["bom-ref"]);
  const madeFrom = [...refs(sources), dejavu["bom-ref"]];

  const bom = {
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    serialNumber: "",
    version: 1,
    metadata: {
      timestamp: new Date(epoch * 1000).toISOString().replace(/\.000Z$/, "Z"),
      lifecycles: [{ phase: "build" }],
      tools: { components: [{ type: "application", name: "packaging/sbom.mjs", description: "Moth's SBOM writer", externalReferences: [{ type: "vcs", url: `${REPO}/blob/${commit ?? tag}/packaging/sbom.mjs` }] }] },
      component: {
        type: "application", "bom-ref": purl, name: "moth", version,
        description: "A programming language that reads like plain English: the moth command, which builds Moth programs into Windows and Linux programs of their own",
        supplier: { name: "Samyak Pudke", url: ["https://github.com/samyyy2423"] },
        authors: [{ name: "Samyak Pudke" }],
        copyright: "Copyright 2026 Samyak Pudke",
        licenses: apache,
        purl,
        externalReferences: [
          { type: "vcs", url: `${REPO}.git` },
          { type: "website", url: REPO },
          { type: "distribution", url: `${REPO}/releases/tag/${tag}` },
          { type: "release-notes", url: `${REPO}/releases/tag/${tag}` },
          { type: "issue-tracker", url: `${REPO}/issues` },
          { type: "security-contact", url: `${REPO}/security/advisories/new` },
        ],
        ...(commit ? { properties: [{ name: "moth:commit", value: commit }] } : {}),
      },
    },
    components: [...programs, ...packages, ...sources, ...library, ...page, dejavu],
    dependencies: [
      { ref: purl, dependsOn: refs([...programs, ...packages]) },
      ...programs.map((p) => ({ ref: p["bom-ref"], dependsOn: madeFrom })),
      ...packages.map((p) => ({ ref: p["bom-ref"], dependsOn: ["moth-linux"] })),
      ...sources.map((s) => ({
        ref: s["bom-ref"],
        dependsOn: s.name === "stdlib.moth" ? refs(library) : s.name === "webpage.moth" ? refs(page) : s.name === "machine.moth" ? [dejavu["bom-ref"]] : [],
      })),
      ...[...library, ...page, dejavu].map((c) => ({ ref: c["bom-ref"], dependsOn: [] })),
    ],
    // the list of what's in each program is complete: there's nothing else in them
    compositions: [{ aggregate: "complete", assemblies: refs(programs), dependencies: refs(programs) }],
  };
  bom.serialNumber = `urn:uuid:${uuidOf(JSON.stringify(bom))}`;
  return bom;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [folder, version, given] = process.argv.slice(2);
  if (!version) throw new Error("usage: node packaging/sbom.mjs <folder with the release's files> <version> [commit]");
  const git = (...args) => { try { return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim(); } catch { return undefined; } };
  const commit = given ?? git("rev-parse", "HEAD");
  const epoch = Number(process.env.SOURCE_DATE_EPOCH ?? git("log", "-1", "--format=%ct") ?? Math.floor(Date.now() / 1000));
  const out = join(folder, `moth-${version}.cdx.json`);
  const made = sbom({ folder, version, commit, epoch });
  writeFileSync(out, JSON.stringify(made, null, 2) + "\n");
  console.log(`wrote ${out}: ${made.components.length} components`);
}
