// A load test for tools/server.moth (DESIGN §118): builds a small site with it, runs it, and asks it from
// Node with many connections at once, on raw sockets, so nothing of Node's own pools or limits is measured.
//
//     node tools/load-test.mjs [server.moth] [--workers n] [--seconds s] [--connections c]
//
// It says, for each test: requests answered, per second, the slowest and the typical time to an answer,
// and connections that failed.
//   steady:  c connections, each asking again as soon as it has its answer, for s seconds; on one connection
//            each (keep-alive) when the server keeps it open, or a new one each time when it doesn't
//   burst:   c connections opened at once, each asking once
//   slow:    50 connections that send half a request and stop, then 200 requests from others; how many of
//            those are answered, and how long they wait
//   heavy:   c connections asking for a page that takes the server about a millisecond of work, for s seconds
import { spawn } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { machineCompiler } from "../moth.js";

const args = process.argv.slice(2);
const option = (name, otherwise) => {
  const at = args.indexOf(name);
  if (at < 0) return otherwise;
  const [value] = args.splice(at, 2).slice(1);
  return Number(value);
};
const workers = option("--workers", 0);
const seconds = option("--seconds", 5);
const connections = option("--connections", 200);
const serverFile = args[0] ?? new URL("./server.moth", import.meta.url);
const here = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const target = process.platform === "win32" ? "windows" : "linux";
const port = 24000 + (process.pid % 2000);

const serve = workers ? `web's serve_on_workers(${port}, answer, ${workers})` : `web's serve(${port}, answer)`;
const site = `use "server.moth" as web
to answer with request
    if path of request is "/heavy"
        set sum to 0
        for each i from 1 to 2000000
            add i to sum
        end
        return "worked " + sum
    end
    return "Hello from Moth"
end
${serve}`;

const dir = mkdtempSync(join(tmpdir(), "moth-load-"));
const exe = join(dir, target === "windows" ? "site.exe" : "site");
const machine = machineCompiler(here("machine.moth"), here("compiler.moth"));
writeFileSync(exe, machine(site, { target, name: "site.moth", allow: ["--allow-libraries"], files: { "server.moth": readFileSync(serverFile, "utf8") } }));
if (target === "linux") chmodSync(exe, 0o755);
const running = spawn(exe, [], { cwd: dir, stdio: ["ignore", "ignore", "pipe"] });
let said = "";
running.stderr.on("data", (d) => (said += d));
for (let waited = 0; !said.includes("listening") && waited < 10000; waited += 20) await new Promise((r) => setTimeout(r, 20));

// One connection asking `path` again and again until `until`, or once: each answer read to its length.
// Gives the times each answer took, in ms, and whether the connection failed.
function asker(path, until, once = false) {
  return new Promise((done) => {
    const times = [];
    let socket = null;
    let failed = false;
    let buffer = Buffer.alloc(0);
    let started = 0;
    let keep = true;
    const ask = () => {
      if (!socket || socket.destroyed || !keep) open();
      started = performance.now();
      socket.write(`GET ${path} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n`);
    };
    const finish = () => {
      if (socket) socket.destroy();
      done({ times, failed });
    };
    const open = () => {
      if (socket) socket.destroy();
      buffer = Buffer.alloc(0);
      keep = true;
      socket = net.connect(port, "127.0.0.1");
      socket.setNoDelay(true);
      socket.on("error", () => {
        failed = true;
        finish();
      });
      socket.on("data", (d) => {
        buffer = Buffer.concat([buffer, d]);
        const end = buffer.indexOf("\r\n\r\n");
        if (end < 0) return;
        const head = buffer.subarray(0, end).toString();
        const length = Number(/content-length: *(\d+)/i.exec(head)?.[1] ?? 0);
        if (buffer.length < end + 4 + length) return;
        buffer = buffer.subarray(end + 4 + length);
        times.push(performance.now() - started);
        keep = !/connection: *close/i.test(head);
        if (!keep) socket.destroy();
        if (once || performance.now() >= until) finish();
        else ask();
      });
    };
    ask();
  });
}

const summary = (name, results, ms) => {
  const times = results.flatMap((r) => r.times).sort((a, b) => a - b);
  const failed = results.filter((r) => r.failed).length;
  const pick = (f) => (times.length ? times[Math.min(times.length - 1, Math.floor(f * times.length))].toFixed(1) : "-");
  console.log(`${name.padEnd(8)} ${String(times.length).padStart(7)} answered ${String(Math.round((times.length * 1000) / ms)).padStart(7)}/s   typical ${pick(0.5).padStart(7)} ms   99% within ${pick(0.99).padStart(7)} ms   slowest ${pick(1).padStart(7)} ms   failed ${failed}`);
};

async function steady(name, path) {
  const begun = performance.now();
  const until = begun + seconds * 1000;
  const results = await Promise.all(Array.from({ length: connections }, () => asker(path, until)));
  summary(name, results, performance.now() - begun);
}

async function burst() {
  const begun = performance.now();
  const results = await Promise.all(Array.from({ length: connections }, () => asker("/", 0, true)));
  summary("burst", results, performance.now() - begun);
}

// connections that say half a request, and then nothing, while others ask
async function slow() {
  const stalled = [];
  for (let i = 0; i < 50; i++) {
    const s = net.connect(port, "127.0.0.1");
    s.on("error", () => {});
    s.write("GET / HTTP/1.1\r\nHost: 127.0");
    stalled.push(s);
  }
  await new Promise((r) => setTimeout(r, 200));
  const begun = performance.now();
  const results = await Promise.race([
    Promise.all(Array.from({ length: 200 }, () => asker("/", 0, true))),
    new Promise((r) => setTimeout(() => r([{ times: [], failed: true }]), 10000)),
  ]);
  summary("slow", results, performance.now() - begun);
  for (const s of stalled) s.destroy();
}

console.log(`${workers ? `${workers} workers` : "one worker"}, ${connections} connections, ${seconds} s each`);
try {
  await steady("steady", "/");
  await burst();
  await slow();
  await steady("heavy", "/heavy");
} finally {
  running.kill();
  await new Promise((r) => setTimeout(r, 200));
  rmSync(dir, { recursive: true, force: true });
}
