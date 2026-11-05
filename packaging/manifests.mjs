// Writes the winget manifests and the Scoop manifest for a release of moth, from its version, the SHA-256 of
// its moth-windows.exe and the day it came out:
//
//     node packaging/manifests.mjs 1.11.0 0d6204ab...29265 2026-11-04 [folder]
//
// into packaging/ (or the folder): winget/manifests/s/samyyy2423/Moth/<version>/, the three files a pull
// request to microsoft/winget-pkgs adds (docs/installers.md), and scoop/moth.json. The release workflow runs
// it for each new release, and packaging.test.js checks that the files here are what it writes.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const REPO = "https://github.com/samyyy2423/moth";
export const WINGET_ID = "samyyy2423.Moth";
export const WINGET_SCHEMA = "1.28.0";

const DESCRIPTION = "A programming language that reads like plain English.";
const LONG = [
  "Moth is a programming language that reads like plain English: small enough to learn in an afternoon, with",
  "a compiler written in Moth itself that makes Windows and Linux programs as fast as C. moth runs a program,",
  "builds it into a program of its own, and has a shell, a debugger, tests, packages, a language server and a",
  "standard library from web servers and databases to pictures and encryption. It is one file, with nothing",
  "else to install.",
].join(" ");

const download = (version, file) => `${REPO}/releases/download/v${version}/${file}`;

// the folder in winget-pkgs (and here) that a version's manifests go in
export const wingetFolder = (version) => join("winget", "manifests", "s", "samyyy2423", "Moth", version);

// each file's name and its text
export function winget(version, sha256, date) {
  const header = (kind) => `# yaml-language-server: $schema=https://aka.ms/winget-manifest.${kind}.${WINGET_SCHEMA}.schema.json\n\n`;
  const top = `PackageIdentifier: ${WINGET_ID}\nPackageVersion: ${version}\n`;
  const end = (kind) => `ManifestType: ${kind}\nManifestVersion: ${WINGET_SCHEMA}\n`;
  return {
    [`${WINGET_ID}.yaml`]: header("version") + top + "DefaultLocale: en-US\n" + end("version"),
    [`${WINGET_ID}.installer.yaml`]: header("installer") + top
      + "InstallerType: portable\n"
      + "Commands:\n- moth\n"
      + `ReleaseDate: ${date}\n`
      + "Installers:\n"
      + "- Architecture: x64\n"
      + `  InstallerUrl: ${download(version, "moth-windows.exe")}\n`
      + `  InstallerSha256: ${sha256.toUpperCase()}\n`
      + end("installer"),
    [`${WINGET_ID}.locale.en-US.yaml`]: header("defaultLocale") + top
      + "PackageLocale: en-US\n"
      + "Publisher: Samyak Pudke\n"
      + "PublisherUrl: https://github.com/samyyy2423\n"
      + `PublisherSupportUrl: ${REPO}/issues\n`
      + "Author: Samyak Pudke\n"
      + "PackageName: Moth\n"
      + `PackageUrl: ${REPO}\n`
      + "License: Apache-2.0\n"
      + `LicenseUrl: ${REPO}/blob/v${version}/LICENSE\n`
      + "Copyright: Copyright 2026 Samyak Pudke\n"
      + `ShortDescription: ${DESCRIPTION}\n`
      + `Description: |-\n  ${LONG}\n`
      + "Moniker: moth\n"
      + "Tags:\n" + ["compiler", "education", "english", "language", "plain-english", "programming-language"].map((tag) => `- ${tag}\n`).join("")
      + `ReleaseNotesUrl: ${REPO}/releases/tag/v${version}\n`
      + "Documentations:\n"
      + "- DocumentLabel: Learn Moth\n"
      + "  DocumentUrl: https://samyyy2423.github.io/moth/learn.html\n"
      + "- DocumentLabel: The language\n"
      + `  DocumentUrl: ${REPO}/blob/v${version}/SPEC.md\n`
      + end("defaultLocale"),
  };
}

// Scoop's manifest: this version, and how Scoop's checkver finds and writes the next (autoupdate takes the
// sum from the release's SHA256SUMS.txt)
export function scoop(version, sha256) {
  const manifest = {
    version,
    description: DESCRIPTION,
    homepage: REPO,
    license: "Apache-2.0",
    notes: "Run 'moth' for the Moth shell, or 'moth run hello.moth'.",
    architecture: {
      "64bit": { url: `${download(version, "moth-windows.exe")}#/moth.exe`, hash: sha256.toLowerCase() },
    },
    bin: "moth.exe",
    checkver: "github",
    autoupdate: {
      architecture: {
        "64bit": {
          url: `${REPO}/releases/download/v$version/moth-windows.exe#/moth.exe`,
          hash: { url: `${REPO}/releases/download/v$version/SHA256SUMS.txt` },
        },
      },
    },
  };
  return JSON.stringify(manifest, null, 4) + "\n";
}

// every file, by where it goes under packaging/
export function manifests(version, sha256, date) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`'${version}' isn't a version like 1.11.0`);
  if (!/^[0-9a-fA-F]{64}$/.test(sha256)) throw new Error(`'${sha256}' isn't a SHA-256`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`'${date}' isn't a day like 2026-11-04`);
  const files = { [join("scoop", "moth.json")]: scoop(version, sha256) };
  for (const [name, text] of Object.entries(winget(version, sha256, date))) files[join(wingetFolder(version), name)] = text;
  return files;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [version, sha256, date, folder = dirname(fileURLToPath(import.meta.url))] = process.argv.slice(2);
  if (!date) throw new Error("usage: node packaging/manifests.mjs <version> <sha256 of moth-windows.exe> <yyyy-mm-dd> [folder]");
  for (const [path, text] of Object.entries(manifests(version, sha256, date))) {
    mkdirSync(dirname(join(folder, path)), { recursive: true });
    writeFileSync(join(folder, path), text);
    console.log(`wrote ${join(folder, path)}`);
  }
}
