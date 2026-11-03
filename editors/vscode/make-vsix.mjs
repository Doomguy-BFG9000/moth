// Packs the extension into moth-<version>.vsix, which VS Code installs:
//
//     node editors/vscode/make-vsix.mjs
//     code --install-extension editors/vscode/moth-0.1.0.vsix
//
// A .vsix is a zip of the extension, under extension/, with a manifest and a list of content types beside
// it. Moth's engine goes in too, as engine/, so the extension needs nothing else: the same moth.js the
// playground runs, whose checker finds problems as you type and whose format() tidies.
import { readFileSync, writeFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";

const here = (file) => new URL(file, import.meta.url);
const repo = (file) => new URL(`../../${file}`, import.meta.url);
const manifest = JSON.parse(readFileSync(here("package.json"), "utf8"));
export const ENGINE = ["moth.js", "vm.js", "scope.js", "jit.js", "wasm.js", "wasm-binary.js", "checker.js", "pictures.js"];
const OWN = ["package.json", "extension.js", "language-configuration.json", "syntaxes/moth.tmLanguage.json", "snippets/moth.json", "README.md"];

// every file in the package, by its name there
export function contents() {
  const files = new Map();
  for (const file of OWN) files.set(`extension/${file}`, readFileSync(here(file)));
  files.set("extension/LICENSE.txt", readFileSync(repo("LICENSE")));
  for (const file of ENGINE) files.set(`extension/engine/${file}`, readFileSync(repo(file)));
  files.set("extension/engine/package.json", Buffer.from('{ "type": "module" }\n')); // the engine's files are modules
  const escape = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  files.set("extension.vsixmanifest", Buffer.from(`<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Language="en-US" Id="${manifest.name}" Version="${manifest.version}" Publisher="${manifest.publisher}" />
    <DisplayName>${escape(manifest.displayName)}</DisplayName>
    <Description xml:space="preserve">${escape(manifest.description)}</Description>
    <Tags>moth,programming language</Tags>
    <Categories>${manifest.categories.join(",")}</Categories>
    <GalleryFlags>Public</GalleryFlags>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="${manifest.engines.vscode}" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionPack" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="workspace" />
    </Properties>
    <License>extension/LICENSE.txt</License>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code" />
  </Installation>
  <Dependencies />
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.License" Path="extension/LICENSE.txt" Addressable="true" />
  </Assets>
</PackageManifest>
`));
  files.set("[Content_Types].xml", Buffer.from(`<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension=".json" ContentType="application/json" />
  <Default Extension=".js" ContentType="application/javascript" />
  <Default Extension=".md" ContentType="text/markdown" />
  <Default Extension=".txt" ContentType="text/plain" />
  <Default Extension=".vsixmanifest" ContentType="text/xml" />
</Types>
`));
  return files;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// A zip of the files, each deflated, its time 1980-01-01 so the same files make the same bytes
export function zip(files) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const [name, data] of files) {
    const packed = deflateRawSync(data, { level: 9 });
    const nameBytes = Buffer.from(name, "utf8");
    const crc = crc32(data);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4); // the version needed to read it
    head.writeUInt16LE(0x0800, 6); // names in UTF-8
    head.writeUInt16LE(8, 8); // deflated
    head.writeUInt16LE(0, 10);
    head.writeUInt16LE(0x21, 12); // 1980-01-01
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(packed.length, 18);
    head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(nameBytes.length, 26);
    head.writeUInt16LE(0, 28);
    parts.push(head, nameBytes, packed);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt16LE(0, 12);
    entry.writeUInt16LE(0x21, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(packed.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBytes);
    offset += head.length + nameBytes.length + packed.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.size, 8);
  end.writeUInt16LE(files.size, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directory, end]);
}

if (process.argv[1] && new URL(import.meta.url).pathname.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  const out = here(`moth-${manifest.version}.vsix`);
  const bytes = zip(contents());
  writeFileSync(out, bytes);
  console.log(`made moth-${manifest.version}.vsix (${bytes.length.toLocaleString("en")} bytes)`);
}
