// The installers and the release's files (packaging/, DESIGN §130 and §131): the winget and Scoop manifests
// are what manifests.mjs writes, the SBOM names what's built into moth, the .deb holds moth-linux as it is, and
// install.sh installs only a download whose sum is the release's. All here, with no network; CI's packaging
// workflow does what needs it (the real release, Windows, Docker, the schemas).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { manifests, WINGET_ID } from "./packaging/manifests.mjs";
import { BUILT_IN, sbom } from "./packaging/sbom.mjs";
import { STANDARD } from "./make-stdlib.mjs";

const here = (file) => new URL(`./${file}`, import.meta.url);
const path = (file) => fileURLToPath(here(file));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const linux = process.platform === "linux";
const has = (tool) => spawnSync("sh", ["-c", `command -v ${tool}`]).status === 0;
const scratch = () => mkdtempSync(join(tmpdir(), "moth-packaging-"));

// v1.11.0's moth-windows.exe, as its release gives it
const WINDOWS_1_11_0 = "0d6204ab7a8cc6451a2bb5e70c8366092eb0909113fc778b6b50de9c21929265";

test("the winget and Scoop manifests are what manifests.mjs writes for 1.11.0", () => {
  const made = manifests("1.11.0", WINDOWS_1_11_0, "2026-11-04");
  assert.deepEqual(Object.keys(made).map((p) => p.replaceAll("\\", "/")).sort(), [
    "scoop/moth.json",
    `winget/manifests/s/samyyy2423/Moth/1.11.0/${WINGET_ID}.installer.yaml`,
    `winget/manifests/s/samyyy2423/Moth/1.11.0/${WINGET_ID}.locale.en-US.yaml`,
    `winget/manifests/s/samyyy2423/Moth/1.11.0/${WINGET_ID}.yaml`,
  ]);
  for (const [path, text] of Object.entries(made)) {
    assert.equal(readFileSync(here(`packaging/${path.replaceAll("\\", "/")}`), "utf8"), text, `packaging/${path} isn't what manifests.mjs writes`);
  }
  const scoop = JSON.parse(made["scoop/moth.json"] ?? made["scoop\\moth.json"]);
  assert.equal(scoop.version, "1.11.0");
  assert.equal(scoop.architecture["64bit"].url, "https://github.com/samyyy2423/moth/releases/download/v1.11.0/moth-windows.exe#/moth.exe");
  assert.equal(scoop.architecture["64bit"].hash, WINDOWS_1_11_0);
  assert.equal(scoop.bin, "moth.exe");
  assert.equal(scoop.checkver, "github");
  assert.match(scoop.autoupdate.architecture["64bit"].url, /\/v\$version\/moth-windows\.exe#\/moth\.exe$/);
  assert.match(scoop.autoupdate.architecture["64bit"].hash.url, /\/v\$version\/SHA256SUMS\.txt$/);
  const installer = Object.entries(made).find(([p]) => p.endsWith(".installer.yaml"))[1];
  assert.match(installer, /^InstallerType: portable$/m);
  assert.match(installer, /^Commands:\n- moth$/m);
  assert.match(installer, new RegExp(`^  InstallerSha256: ${WINDOWS_1_11_0.toUpperCase()}$`, "m"));
  for (const text of Object.values(made).filter((t) => !t.startsWith("{"))) assert.match(text, /^ManifestVersion: 1\.28\.0$/m);
});

test("manifests.mjs takes only a version, a SHA-256 and a day", () => {
  assert.throws(() => manifests("1.11", WINDOWS_1_11_0, "2026-11-04"), /isn't a version/);
  assert.throws(() => manifests("1.11.0", "abc", "2026-11-04"), /isn't a SHA-256/);
  assert.throws(() => manifests("1.11.0", WINDOWS_1_11_0, "4 Nov 2026"), /isn't a day/);
});

// a folder with what a release has: two "programs" (any bytes do) and a .deb
function releaseFolder() {
  const dir = scratch();
  writeFileSync(join(dir, "moth-linux"), "linux program");
  writeFileSync(join(dir, "moth-windows.exe"), "windows program");
  writeFileSync(join(dir, "moth_9.8.7_amd64.deb"), "a package");
  return dir;
}

test("the SBOM names the release's files, and every file built into moth, with their sums", () => {
  const dir = releaseFolder();
  try {
    const bom = sbom({ folder: dir, version: "9.8.7", commit: "abc123", epoch: 1_800_000_000 });
    assert.equal(bom.bomFormat, "CycloneDX");
    assert.equal(bom.specVersion, "1.6");
    assert.match(bom.serialNumber, /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(bom.metadata.timestamp, "2027-01-15T08:00:00Z");
    assert.equal(bom.metadata.component.purl, "pkg:github/samyyy2423/moth@v9.8.7");
    const byRef = new Map(bom.components.map((c) => [c["bom-ref"], c]));
    assert.equal(byRef.size, bom.components.length, "two components have the same bom-ref");
    const sumOf = (c) => c.hashes.find((h) => h.alg === "SHA-256").content;
    assert.equal(sumOf(byRef.get("moth-linux")), sha256("linux program"));
    assert.equal(sumOf(byRef.get("moth-windows.exe")), sha256("windows program"));
    assert.equal(sumOf(byRef.get("moth_9.8.7_amd64.deb")), sha256("a package"));
    for (const file of Object.keys(BUILT_IN)) assert.equal(sumOf(byRef.get(`source:${file}`)), sha256(readFileSync(here(file))), file);
    for (const file of STANDARD) assert.equal(sumOf(byRef.get(`stdlib:${file}`)), sha256(readFileSync(here(file))), file);
    // each program is made from the sources and DejaVu's letters, and every reference is to a component
    const deps = new Map(bom.dependencies.map((d) => [d.ref, d.dependsOn]));
    assert.deepEqual(deps.get("moth-linux"), [...Object.keys(BUILT_IN).map((f) => `source:${f}`), "dejavu-glyphs"]);
    assert.deepEqual(deps.get("source:stdlib.moth"), STANDARD.map((f) => `stdlib:${f}`));
    for (const [ref, on] of deps) {
      assert.ok(byRef.has(ref) || ref === bom.metadata.component["bom-ref"], ref);
      for (const r of on) assert.ok(byRef.has(r), `${ref} depends on ${r}, which isn't a component`);
    }
    assert.deepEqual(bom.compositions, [{ aggregate: "complete", assemblies: ["moth-linux", "moth-windows.exe"], dependencies: ["moth-linux", "moth-windows.exe"] }]);
    // the same release, the same SBOM, serial number and all
    assert.deepEqual(sbom({ folder: dir, version: "9.8.7", commit: "abc123", epoch: 1_800_000_000 }), bom);
    assert.notEqual(sbom({ folder: dir, version: "9.8.8", commit: "abc123", epoch: 1_800_000_000 }).serialNumber, bom.serialNumber);
    rmSync(join(dir, "moth-windows.exe"));
    assert.throws(() => sbom({ folder: dir, version: "9.8.7", epoch: 0 }), /there's no moth-windows\.exe/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// what bootstrap.mjs builds moth with is what the SBOM says is built into it
test("the SBOM's sources are the files bootstrap.mjs builds moth from", () => {
  const bootstrap = readFileSync(here("bootstrap.mjs"), "utf8");
  const files = [...bootstrap.match(/const files = \{([^}]*)\}/)[1].matchAll(/"([^"]+)": here\(/g)].map((m) => m[1]);
  // the files built in with --include, written as an object or as a list of names
  const include = [...bootstrap.match(/const include = ([^\n]*)/)[1].matchAll(/"([^"]+\.(?:moth|json))"/g)].map((m) => m[1]);
  assert.deepEqual(Object.keys(BUILT_IN).sort(), ["moth.moth", ...files, ...include].sort());
});

// an x86-64 ELF header and a little more: enough for build-deb.sh, which looks no further
const ELF = Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0x3e, 0]), Buffer.from("the rest of moth")]);

test("build-deb.sh packages moth-linux as /usr/bin/moth, the same bytes each time", { skip: linux && has("dpkg-deb") ? false : "needs dpkg-deb" }, () => {
  const dir = scratch();
  try {
    writeFileSync(join(dir, "moth-linux"), ELF);
    const build = (out) => spawnSync("sh", [path("packaging/debian/build-deb.sh"), join(dir, "moth-linux"), "9.8.7", join(dir, out)],
      { encoding: "utf8", env: { ...process.env, SOURCE_DATE_EPOCH: "1800000000" } });
    const made = build("a");
    assert.equal(made.status, 0, made.stderr);
    const deb = join(dir, "a", "moth_9.8.7_amd64.deb");
    assert.equal(build("b").status, 0);
    assert.ok(readFileSync(deb).equals(readFileSync(join(dir, "b", "moth_9.8.7_amd64.deb"))), "two builds made different .debs");
    const field = (name) => spawnSync("dpkg-deb", ["--field", deb, name], { encoding: "utf8" }).stdout.trim();
    assert.equal(field("Package"), "moth");
    assert.equal(field("Version"), "9.8.7");
    assert.equal(field("Architecture"), "amd64");
    assert.match(field("Maintainer"), /^Samyak Pudke <.+@.+>$/);
    assert.match(field("Description"), /^programming language that reads like plain English\n/);
    assert.equal(field("Depends"), "");
    const listed = spawnSync("dpkg-deb", ["--contents", deb], { encoding: "utf8" }).stdout;
    assert.match(listed, /^-rwxr-xr-x root\/root +\d+ \S+ \S+ \.\/usr\/bin\/moth$/m);
    assert.match(listed, /^-rw-r--r-- root\/root +\d+ .* \.\/usr\/share\/doc\/moth\/copyright$/m);
    assert.doesNotMatch(listed, /^drwx------/m);
    const inside = spawnSync("sh", ["-c", `dpkg-deb --fsys-tarfile "${deb}" | tar -xO ./usr/bin/moth`], { encoding: "buffer" }).stdout;
    assert.ok(inside.equals(ELF), "the .deb's moth isn't moth-linux");
    const copyright = spawnSync("sh", ["-c", `dpkg-deb --fsys-tarfile "${deb}" | tar -xO ./usr/share/doc/moth/copyright`], { encoding: "utf8" }).stdout;
    assert.match(copyright, /^License: Apache-2\.0 and Bitstream-Vera$/m);
    assert.match(copyright, /^ Copyright \(c\) 2003 by Bitstream, Inc\./m);
    // what isn't moth-linux, or isn't a version, is refused
    writeFileSync(join(dir, "moth-windows.exe"), Buffer.from("MZ a Windows program"));
    const wrong = spawnSync("sh", [path("packaging/debian/build-deb.sh"), join(dir, "moth-windows.exe"), "9.8.7", join(dir, "c")], { encoding: "utf8" });
    assert.match(wrong.stderr, /isn't a 64-bit Linux program/);
    const badVersion = spawnSync("sh", [path("packaging/debian/build-deb.sh"), join(dir, "moth-linux"), "9.8.x", join(dir, "c")], { encoding: "utf8" });
    assert.match(badVersion.stderr, /isn't a version/);
    assert.ok(!existsSync(join(dir, "c")));
    // a pre-release's version is Debian's, with ~, so it comes before the release; its file keeps the release's
    const rc = spawnSync("sh", [path("packaging/debian/build-deb.sh"), join(dir, "moth-linux"), "9.8.7-rc.1", join(dir, "rc")], { encoding: "utf8" });
    assert.equal(rc.status, 0, rc.stderr);
    assert.equal(spawnSync("dpkg-deb", ["--field", join(dir, "rc", "moth_9.8.7-rc.1_amd64.deb"), "Version"], { encoding: "utf8" }).stdout.trim(), "9.8.7~rc.1");
    assert.equal(spawnSync("dpkg", ["--compare-versions", "9.8.7~rc.1", "lt", "9.8.7"]).status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// a release on the disk, which install.sh reads through file://, with moth-linux a script that says hello
function fakeRelease(dir, sums) {
  const release = join(dir, "releases", "download", "v9.8.7");
  mkdirSync(release, { recursive: true });
  const program = "#!/bin/sh\necho moth 9.8.7 says hello\n";
  writeFileSync(join(release, "moth-linux"), program);
  writeFileSync(join(release, "SHA256SUMS.txt"), sums ?? `${"1".repeat(64)}  moth-windows.exe\n${sha256(program)}  moth-linux\n`);
  return { releases: `file://${join(dir, "releases")}`, program };
}

function install(dir, releases, args = [], env = {}) {
  const home = join(dir, "home");
  mkdirSync(home, { recursive: true });
  return spawnSync("sh", [path("packaging/install.sh"), "--version", "9.8.7", ...args], {
    encoding: "utf8",
    env: { PATH: "/usr/bin:/bin", HOME: home, SHELL: "/bin/bash", MOTH_RELEASES_URL: releases, MOTH_INSTALL_DIR: join(home, ".local", "bin"), ...env },
  });
}

test("install.sh installs moth-linux once its sum is the release's, and puts it on PATH once", { skip: linux && has("curl") ? false : "needs Linux and curl" }, () => {
  const dir = scratch();
  try {
    const { releases, program } = fakeRelease(dir);
    const first = install(dir, releases);
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /checked: its SHA-256 is [0-9a-f]{64}, as SHA256SUMS\.txt says/);
    const moth = join(dir, "home", ".local", "bin", "moth");
    assert.equal(readFileSync(moth, "utf8"), program);
    assert.equal(spawnSync(moth, [], { encoding: "utf8" }).stdout, "moth 9.8.7 says hello\n");
    const line = 'export PATH="$HOME/.local/bin:$PATH"';
    assert.equal(install(dir, releases).status, 0);
    for (const file of [".profile", ".bashrc"]) {
      const text = readFileSync(join(dir, "home", file), "utf8");
      assert.equal(text.split("\n").filter((l) => l === line).length, 1, `${file} has the line ${text.split(line).length - 1} times`);
    }
    // a login shell finds it
    assert.equal(spawnSync("bash", ["-lc", "command -v moth"], { encoding: "utf8", env: { HOME: join(dir, "home"), PATH: "/usr/bin:/bin" } }).stdout.trim(), moth);
    assert.ok(!readdirSync(join(dir, "home", ".local", "bin")).some((f) => f.startsWith(".moth-new")), "a file was left behind");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("install.sh installs nothing when the download's sum isn't the release's", { skip: linux && has("curl") ? false : "needs Linux and curl" }, () => {
  const dir = scratch();
  try {
    const moth = join(dir, "home", ".local", "bin", "moth");
    const { releases } = fakeRelease(join(dir, "wrong"), `${"2".repeat(64)}  moth-linux\n`);
    const wrong = install(dir, releases);
    assert.equal(wrong.status, 1);
    assert.match(wrong.stderr, /moth-linux's SHA-256 is [0-9a-f]{64}, but SHA256SUMS\.txt says 2{64}: the download isn't the release's, so nothing was installed/);
    assert.ok(!existsSync(moth));
    const { releases: none } = fakeRelease(join(dir, "none"), `${"1".repeat(64)}  moth-windows.exe\n`);
    assert.match(install(dir, none).stderr, /SHA256SUMS\.txt has no sum for moth-linux/);
    assert.match(install(dir, `file://${join(dir, "nowhere")}`).stderr, /couldn't download .*\/moth-linux/);
    assert.ok(!existsSync(moth));
    assert.ok(!existsSync(join(dir, "home", ".profile")), "PATH was changed for nothing");
    // and a version, and options, it doesn't know
    const { releases: good } = fakeRelease(join(dir, "good"));
    assert.match(install(dir, good, ["--version", "1.2;rm"]).stderr, /isn't a version like 1\.11\.0/);
    assert.match(install(dir, good, ["--frobnicate"]).stderr, /I don't know '--frobnicate'/);
    // --no-modify-path touches no startup file
    assert.equal(install(dir, good, ["--no-modify-path"]).status, 0);
    assert.ok(existsSync(moth));
    assert.ok(!existsSync(join(dir, "home", ".profile")) && !existsSync(join(dir, "home", ".bashrc")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
