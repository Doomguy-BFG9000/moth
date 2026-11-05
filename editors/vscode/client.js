// Moth's language server, `moth lsp`, as the extension speaks to it: started as a program of its own, and spoken
// to over its input and output with the Language Server Protocol's messages, each JSON after a Content-Length
// line and an empty line. This file doesn't need VS Code, so the tests start it against moth itself.
const { spawn } = require("child_process");

// Starts `command lsp` and asks it to begin. Gives a promise of the server, once it has answered: its
// capabilities, request(method, params) (a promise of its answer), notify(method, params), on(method, f) for
// what it tells the editor, onExit(f), and stop(). It fails if the server can't be started, ends before it
// answers (a moth from before moth lsp), or takes longer than `wait` milliseconds to.
function startServer(command, { args = ["lsp"], cwd, initializationOptions, wait = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(command, args, { cwd, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    } catch (err) {
      return reject(err);
    }
    const waiting = new Map(); // each request not yet answered, by its id
    const handlers = new Map(); // what to do with each thing the server tells, by its method
    const exits = [];
    let next = 1;
    let ended = null;
    let buffer = Buffer.alloc(0);
    let stderr = "";
    const send = (message) => {
      if (ended) return;
      const body = Buffer.from(JSON.stringify(message), "utf8");
      child.stdin.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "ascii"), body]));
    };
    const request = (method, params) => {
      if (ended) return Promise.reject(new Error(`moth lsp has ended (${ended})`));
      const id = next++;
      return new Promise((done, fail) => {
        waiting.set(id, { done, fail });
        send({ jsonrpc: "2.0", id, method, params });
      });
    };
    const notify = (method, params) => send({ jsonrpc: "2.0", method, params });
    const received = (message) => {
      if (message.id !== undefined && message.method === undefined) {
        const asked = waiting.get(message.id);
        if (!asked) return;
        waiting.delete(message.id);
        if (message.error) asked.fail(Object.assign(new Error(message.error.message), { code: message.error.code }));
        else asked.done(message.result ?? null);
      } else if (message.id !== undefined) {
        send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: `the extension doesn't do ${message.method}` } });
      } else handlers.get(message.method)?.(message.params);
    };
    child.stdout.on("data", (data) => {
      buffer = Buffer.concat([buffer, data]);
      for (;;) {
        const head = buffer.indexOf("\r\n\r\n");
        if (head < 0) return;
        const length = /content-length:\s*(\d+)/i.exec(buffer.subarray(0, head).toString("ascii"));
        if (!length) {
          buffer = buffer.subarray(head + 4); // a header with no length: nothing can be read from it
          continue;
        }
        const end = head + 4 + Number(length[1]);
        if (buffer.length < end) return;
        const body = buffer.subarray(head + 4, end).toString("utf8");
        buffer = buffer.subarray(end);
        try {
          received(JSON.parse(body));
        } catch {
          // a message that isn't JSON is left out
        }
      }
    });
    child.stderr.on("data", (data) => (stderr = (stderr + data).slice(-4000)));
    const finish = (why) => {
      if (ended) return;
      ended = why;
      for (const { fail } of waiting.values()) fail(new Error(`moth lsp has ended (${why})`));
      waiting.clear();
      for (const f of exits) f(why);
      reject(new Error(`moth lsp couldn't start: ${why}${stderr ? `: ${stderr.trim()}` : ""}`));
    };
    child.on("error", (err) => finish(err.code === "ENOENT" ? `there's no ${command}` : err.message));
    child.on("exit", (code) => finish(`it ended with ${code}`));
    child.stdin.on("error", () => {}); // writing to a server that has ended: its exit says so
    const timer = setTimeout(() => {
      finish(`it didn't answer in ${wait / 1000} seconds`);
      child.kill();
    }, wait);
    request("initialize", { processId: process.pid, rootUri: null, capabilities: {}, initializationOptions, clientInfo: { name: "moth for VS Code" } })
      .then((answer) => {
        clearTimeout(timer);
        notify("initialized", {});
        resolve({
          capabilities: answer?.capabilities ?? {},
          request,
          notify,
          on: (method, f) => handlers.set(method, f),
          onExit: (f) => exits.push(f),
          get running() {
            return !ended;
          },
          async stop() {
            if (ended) return;
            try {
              await Promise.race([request("shutdown", null), new Promise((r) => setTimeout(r, 2000))]);
            } catch {
              // ended already
            }
            notify("exit", null);
            setTimeout(() => ended || child.kill(), 2000).unref?.();
          },
        });
      })
      .catch((err) => {
        clearTimeout(timer);
        finish(err.message);
        child.kill();
      });
  });
}

module.exports = { startServer };
