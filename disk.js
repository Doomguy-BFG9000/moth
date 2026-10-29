// What a program run from the command line can reach: the files where it runs, and sites, each only once
// it's allowed to. `moth run`, `moth test` and a program made by `moth build` ask before a program reads a
// file, writes one, or goes online, the way Deno does: a person at a terminal is asked, once for each file
// or site (or for all of them, with 'a'); anywhere else the answer is no, unless moth was started with
// --allow-read, --allow-write, --allow-net or --allow-all. The first three can say what they allow:
// --allow-read=data,notes.txt (those files, and everything in those folders), --allow-net=example.com
// (that site). moth-native does the same (native/src/main.rs). `moth build` copies this file into the
// program it makes, so it imports Node under names nothing else there uses.
import * as nodeFs from "node:fs";
import * as nodePath from "node:path";
import * as nodeChild from "node:child_process";

// for each kind of thing a program may do: how a question puts it, how a refusal puts it, and the flag
export const PERMISSIONS = {
  read: ["read", "read files", "--allow-read"],
  write: ["write", "write files", "--allow-write"],
  net: ["go online to", "go online", "--allow-net"],
};

// `--allow-read`, `--allow-write=out`, `--allow-all`... added to `allowed` (each kind's names, or true for
// all of them); whether it was one of those flags
export function addAllow(allowed, flag) {
  const [, kind, list] = /^--allow-(read|write|net|all)(?:=(.*))?$/s.exec(flag) ?? [];
  if (!kind || (kind === "all" && list !== undefined)) return false;
  const names = list === undefined ? true : list.split(",").filter((name) => name !== "");
  for (const k of kind === "all" ? Object.keys(PERMISSIONS) : [kind]) {
    const before = allowed.get(k) ?? [];
    allowed.set(k, before === true || names === true ? true : [...before, ...names]);
  }
  return true;
}

// Where a file really is, its links followed, so a link can't lead outside what's allowed; for a file that
// isn't there yet, where its folder really is. null for a link that leads nowhere, or a missing folder.
function realOf(name) {
  let there = true;
  try {
    nodeFs.lstatSync(name);
  } catch {
    there = false;
  }
  try {
    return there ? nodeFs.realpathSync.native(name) : nodePath.join(nodeFs.realpathSync.native(nodePath.dirname(name)), nodePath.basename(name));
  } catch {
    return null;
  }
}

// whether the file `name` is the file `folder`, or anywhere inside the folder `folder`
export function within(folder, name) {
  const [base, real] = [realOf(folder), realOf(name)];
  if (base === null || real === null) return false;
  const rel = nodePath.relative(base, real);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${nodePath.sep}`) && !nodePath.isAbsolute(rel));
}

export const isSite = (name) => /^https?:\/\//i.test(name);
const lowerAscii = (text) => text.replace(/[A-Z]/g, (c) => c.toLowerCase()); // only A to Z, as moth-native does

// A site's host (example.com:8080) and its name without the port, from its address; null if the address is
// written in any odd way, so a name given to --allow-net can't match it by mistake
function hostOf(url) {
  const rest = url.replace(/^https?:\/\//i, "");
  const host = lowerAscii(rest.slice(0, rest.search(/[/?#\\]|$/)));
  if (!/^(?:[a-z0-9.-]+|\[[0-9a-f:.]+\])(?::[0-9]+)?$/.test(host)) return null;
  return [host, host.replace(/:[0-9]+$/, "")];
}

// whether `allowed` lets the program do this (a kind) to this file or site without asking
function allows(allowed, kind, what) {
  const rule = allowed.get(kind);
  if (rule === true) return true;
  if (!rule?.length) return false;
  if (kind === "net") {
    const host = hostOf(what);
    return host !== null && rule.some((name) => host.includes(lowerAscii(name)));
  }
  return rule.some((name) => within(name, what));
}

// a file or site's name as a question shows it: nothing in it can move the cursor or turn the text around
// (control characters, zero-width ones, and those that change the text's direction)
const HIDDEN = [[0x00, 0x1f], [0x7f, 0x9f], [0x200b, 0x200f], [0x2028, 0x202e], [0x2066, 0x2069]];
const shownName = (name) => [...name].map((c) => (HIDDEN.some(([low, high]) => c.codePointAt(0) >= low && c.codePointAt(0) <= high) ? "?" : c)).join("");

// What decides: `permit(kind, what)` returns if the program may, and otherwise throws why not, after asking
// a person at a terminal (a line from `readLine`) if there is one
export function permissions(allowed, readLine) {
  const asked = new Map();
  const person = process.stdin.isTTY && process.stderr.isTTY;
  return (kind, what) => {
    if (allows(allowed, kind, what)) return;
    const key = `${kind} ${what}`;
    if (!asked.has(key) && person) {
      process.stderr.write(`moth: let this program ${PERMISSIONS[kind][0]} '${shownName(what)}'? (y = yes, a = yes to all, n = no) `);
      const answer = (readLine() ?? "").trim().toLowerCase();
      if (answer === "a" || answer === "all") allowed.set(kind, true);
      asked.set(key, ["y", "yes", "a", "all"].includes(answer));
    }
    if (!allows(allowed, kind, what) && !asked.get(key)) throw new Error(`this program isn't allowed to ${PERMISSIONS[kind][1]} (start it with ${PERMISSIONS[kind][2]})`);
  };
}

// What `read` and `write` use: the files in the folder moth runs in
export function readDisk(name, asBytes) {
  try {
    const data = nodeFs.readFileSync(name);
    return asBytes ? new Uint8Array(data) : data.toString("utf8"); // a copy: a Buffer's slice() wouldn't copy
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

// A site's page, as `read` gets a file: fetched by another Node, so this one can wait for it. A site that
// sends the program on to another address is asked about again, there.
const FETCH = [
  "try {",
  "  const reply = await fetch(process.argv[1], { redirect: 'manual' });",
  "  const to = reply.headers.get('location');",
  "  if (reply.status >= 300 && reply.status < 400 && to) {",
  "    process.stdout.write(new URL(to, process.argv[1]).href);",
  "    process.exitCode = 4;",
  "  } else {",
  "    if (!reply.ok) throw new Error(`the site answered ${reply.status}`);",
  "    process.stdout.write(Buffer.from(await reply.arrayBuffer()));",
  "  }",
  "} catch (err) {",
  "  process.stderr.write(err.message === 'fetch failed' ? `couldn't reach it (${err.cause?.message ?? 'no answer'})` : err.message);",
  "  process.exitCode = 3;",
  "}",
].join("\n");
export function fetchSync(url, asBytes, permit) {
  for (let moves = 0; ; moves++) {
    const ran = nodeChild.spawnSync(process.execPath, ["--input-type=module", "-e", FETCH, url], { maxBuffer: 1 << 30 });
    if (ran.status !== 4) {
      if (ran.status !== 0) throw new Error(ran.stderr.toString("utf8").trim() || "couldn't reach it");
      return asBytes ? new Uint8Array(ran.stdout) : ran.stdout.toString("utf8");
    }
    const next = ran.stdout.toString("utf8");
    if (moves === 10) throw new Error("it moved too many times");
    if (!isSite(next)) throw new Error(`it moved to '${shownName(next)}', which isn't a site`);
    try {
      permit("net", next);
    } catch (err) {
      throw new Error(`it moved to '${shownName(next)}', and ${err.message}`);
    }
    url = next;
  }
}

// The files where the program runs, and sites, each read or written only once `permit` lets it
export const guardedDisk = (permit) => ({
  read: (name, asBytes) => {
    permit(isSite(name) ? "net" : "read", name);
    return isSite(name) ? fetchSync(name, asBytes, permit) : readDisk(name, asBytes);
  },
  write: (name, data) => {
    permit("write", name);
    nodeFs.writeFileSync(name, data);
  },
});
