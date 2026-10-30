// Makes the first moth.exe (moth on Linux) from the source, with Node.js and the JavaScript engine, for when
// there is no moth yet to build moth with (the releases have one too):
//
//     node bootstrap.mjs [windows|linux]
//
// It makes the same bytes moth makes of itself, so after this moth builds moth:
//
//     moth build moth.moth --allow-read --allow-write
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { machineCompiler } from "./moth.js";

const here = (file) => readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
const target = process.argv[2] ?? (process.platform === "win32" ? "windows" : "linux");
if (target !== "windows" && target !== "linux") throw new Error("usage: node bootstrap.mjs [windows|linux]");
const machine = machineCompiler(here("machine.moth"), here("compiler.moth"));
const files = { "machine.moth": here("machine.moth"), "compiler.moth": here("compiler.moth") };
const bytes = machine(here("moth.moth"), { files, target, name: "moth.moth", allow: ["--allow-read", "--allow-write"] });
const out = new URL(target === "windows" ? "./moth.exe" : "./moth", import.meta.url);
writeFileSync(out, bytes);
if (target === "linux") chmodSync(out, 0o755);
console.log(`made ${target === "windows" ? "moth.exe" : "moth"} for ${target === "windows" ? "Windows" : "Linux"} (${bytes.length.toLocaleString("en")} bytes)`);
