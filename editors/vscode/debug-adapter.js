// Moth's debugger, `moth debug`, for any editor that speaks the Debug Adapter Protocol (DESIGN §109): VS Code runs
// it inside the extension, and Neovim (nvim-dap), Helix and JetBrains' IDEs (LSP4IJ) start it as a program:
//
//     node debug-adapter.js
//
// It starts `moth debug` on the program, which builds the debugger into it (moth-debugger.moth), and says the
// debugger's commands for the editor's requests: step, next, out and go; break and clear; where, vars and show.
// The debugger answers on the program's own output, after which it asks for the next command with "(moth)"; a
// command it reads is said back after that, as any answer is when the input isn't a terminal. What the program
// says between a command that runs it and the line it stops at, the last before "(moth)", is the program's own
// output. It needs nothing but Node.js and moth.
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const PROMPT = "(moth) "; // what ask says, the space after its question included
// where the debugger stopped: `prog.moth:5, in 'bump': add 1 to count`, or after a mistake that ends the program,
// `stopped at the mistake, at prog.moth:12, in 'risky': fail with "none left"`
const STOPPED = /^(stopped at the mistake, at )?(.+?):(\d+)(?:, in '(.*?)')?: (.*)$/;
const FRAME = /^ {2}(.+?):(\d+)(?:, in '(.*)')?$/; // a line `where` says
const QUIET = 200; // how long the program says nothing before what it said so far is shown, in milliseconds

class MothDebugSession {
  // `send` takes each message for the editor: responses and events
  constructor(send) {
    this.send = send;
    this.seq = 1;
    this.child = null;
    this.folder = "";
    this.program = ""; // the program's file's name, as the debugger names it
    this.text = ""; // what the program has said that's not dealt with yet
    this.running = false; // whether the program runs on, after go, step, next or out, or hasn't stopped yet
    this.waiting = null; // what's to happen when the debugger next asks "(moth)": resolves with what came before
    this.echo = null; // the command the debugger will say back first
    this.wanted = new Map(); // the breakpoints the editor has set, each file's lines, by the debugger's name for it
    this.set = new Map(); // the ones the debugger has
    this.started = false; // whether the editor has said its configuration is done
    this.entry = null; // where the program stopped first, before its first line, until it's begun
    this.begun = false;
    this.stopOnEntry = false;
    this.lastResume = "step";
    this.stoppedAt = null;
    this.queue = Promise.resolve(); // what's said to the debugger, one thing at a time
    this.timer = null;
    this.ended = false;
  }

  // ---------- to the editor ----------

  event(event, body) {
    this.send({ seq: this.seq++, type: "event", event, ...(body && { body }) });
  }
  respond(request, body, message) {
    this.send({ seq: this.seq++, type: "response", request_seq: request.seq, command: request.command, success: !message, ...(message && { message }), ...(body && { body }) });
  }
  output(text, category = "stdout") {
    if (text) this.event("output", { category, output: text });
  }

  // ---------- from the editor ----------

  async handle(request) {
    if (request.type !== "request") return;
    try {
      const answer = await this.answer(request);
      if (answer !== undefined) this.respond(request, answer ?? undefined);
    } catch (err) {
      this.respond(request, undefined, err.message);
    }
  }

  async answer({ command, arguments: args = {} }) {
    switch (command) {
      case "initialize":
        setImmediate(() => this.event("initialized"));
        return { supportsConfigurationDoneRequest: true, supportsEvaluateForHovers: true, supportsTerminateRequest: true, exceptionBreakpointFilters: [] };
      case "launch":
        return this.launch(args);
      case "setBreakpoints":
        return this.setBreakpoints(args);
      case "setExceptionBreakpoints":
        return null; // it stops at a mistake that ends the program whatever's asked
      case "configurationDone":
        this.started = true;
        this.begin();
        return null;
      case "threads":
        return { threads: [{ id: 1, name: path.basename(this.program) || "moth" }] };
      case "stackTrace":
        return this.stackTrace(args);
      case "scopes":
        return { scopes: args.frameId === 0 ? [{ name: "Variables", variablesReference: 1, expensive: false }] : [] };
      case "variables":
        return this.variables(args);
      case "evaluate":
        return this.evaluate(args);
      case "continue":
        this.resume("go");
        return { allThreadsContinued: true };
      case "next":
        this.resume("next");
        return null;
      case "stepIn":
        this.resume("step");
        return null;
      case "stepOut":
        this.resume("out");
        return null;
      case "pause":
        throw new Error("moth debug stops only at a line it's told to: set a breakpoint there");
      case "disconnect":
      case "terminate":
        this.stop();
        return null;
      default:
        throw new Error(`moth debug doesn't do ${command}`);
    }
  }

  // `program` the file, `args` its arguments, `allow` the --allow flags, `mothPath` moth, `stopOnEntry`
  launch({ program, args = [], allow = [], mothPath = "moth", stopOnEntry = false }) {
    if (!program) throw new Error("say which program to debug: \"program\": \"${file}\"");
    this.folder = path.dirname(path.resolve(program));
    this.program = path.basename(program);
    this.stopOnEntry = stopOnEntry;
    return new Promise((resolve, reject) => {
      let child;
      try {
        // a group of its own, so the program moth starts can be ended with it (see stop)
        child = spawn(mothPath, ["debug", ...allow, this.program, ...args], { cwd: this.folder, windowsHide: true, detached: process.platform !== "win32" });
        this.launchedAt = Date.now();
      } catch (err) {
        return reject(err);
      }
      this.child = child;
      this.running = true;
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (data) => this.said(data));
      child.stderr.on("data", (data) => this.output(data, "stderr"));
      child.stdin.on("error", () => {}); // a program that has ended: its exit says so
      child.on("error", (err) => {
        this.ended = true;
        reject(new Error(err.code === "ENOENT" ? `there's no ${mothPath}: install moth, or say where it is with "mothPath"` : err.message));
      });
      child.on("spawn", () => resolve(null));
      child.on("close", (code) => this.exited(code)); // once all it said has been read, too
      // the debugger stops before the first line runs: there, it's given the breakpoints, once the editor has them
      this.waiting = (said) => {
        this.running = false;
        const lines = said.split("\n").filter(Boolean);
        this.output(lines.slice(0, -1).map((line) => `${line}\n`).join(""));
        this.entry = STOPPED.exec(lines.at(-1) ?? "") ?? [];
        this.begin();
      };
    });
  }

  // once the program has stopped at its first line and the editor's configuration is done: the breakpoints,
  // then on to the first of them, or stopped there if asked to
  begin() {
    if (!this.started || !this.entry || this.begun || this.ended) return;
    this.begun = true;
    this.stoppedAt = { file: this.entry[2], line: Number(this.entry[3]) };
    this.inOrder(() => this.applyBreakpoints()).then(() => {
      if (this.stopOnEntry) this.event("stopped", { reason: "entry", threadId: 1 });
      else this.resume("go");
    });
  }

  // the debugger's name for a file: the program's own, or a file it uses, from the program's folder
  nameOf(file) {
    return path.relative(this.folder, path.resolve(file)).split(path.sep).join("/");
  }
  pathOf(name) {
    return path.resolve(this.folder, name);
  }

  setBreakpoints({ source, breakpoints = [] }) {
    const name = this.nameOf(source.path);
    this.wanted.set(name, new Set(breakpoints.map((b) => b.line)));
    if (!this.running && this.stoppedAt) this.inOrder(() => this.applyBreakpoints());
    return { breakpoints: breakpoints.map((b) => ({ verified: true, line: b.line })) };
  }

  // the debugger's breakpoints made what the editor wants: cleared where there's one too many, and set where
  // there's one too few
  async applyBreakpoints() {
    if (this.running || this.ended) return; // it can be told only while it's stopped
    for (const [name, lines] of this.wanted) {
      const had = this.set.get(name) ?? new Set();
      for (const line of had) if (!lines.has(line)) await this.ask(`clear ${name} ${line}`);
      for (const line of lines) if (!had.has(line)) await this.ask(`break ${name} ${line}`);
      this.set.set(name, new Set(lines));
    }
  }

  async stackTrace() {
    const lines = await this.inOrder(() => this.ask("where"));
    const frames = [];
    for (const line of lines) {
      const m = FRAME.exec(line);
      if (!m) continue;
      frames.push({ id: frames.length, name: m[3] ?? "the program", source: { name: path.basename(m[1]), path: this.pathOf(m[1]) }, line: Number(m[2]), column: 1 });
    }
    return { stackFrames: frames, totalFrames: frames.length };
  }

  async variables({ variablesReference }) {
    if (variablesReference !== 1) return { variables: [] };
    const lines = await this.inOrder(() => this.ask("vars"));
    const variables = [];
    for (const line of lines) {
      const value = / is (.*)$/.exec(line);
      const none = / has no value yet$/.exec(line);
      if (value) variables.push({ name: line.slice(0, value.index), value: value[1], variablesReference: 0 });
      else if (none) variables.push({ name: line.slice(0, none.index), value: "no value yet", variablesReference: 0 });
    }
    return { variables };
  }

  // What the debug console, a hover or a watch asks: `show` it, while the program is stopped. While it runs,
  // the debug console's line is the program's input, as for `ask`. The debugger's own commands that only look
  // (where, list, breaks, help) are said as they are.
  async evaluate({ expression, context }) {
    if (this.running || !this.stoppedAt) {
      if (context !== "repl" || !this.child || this.ended) throw new Error("the program isn't stopped");
      this.child.stdin.write(`${expression}\n`);
      return { result: "", variablesReference: 0 };
    }
    const looking = /^(where|w|list|l|breaks|help|h)$/i.test(expression.trim());
    const lines = await this.inOrder(() => this.ask(looking ? expression.trim() : `show ${expression}`));
    if (looking) return { result: lines.join("\n"), variablesReference: 0 };
    const said = lines.join("\n");
    const prefix = `${expression.trim()} is `;
    if (lines.length === 1 && said.startsWith(prefix)) return { result: said.slice(prefix.length), variablesReference: 0 };
    throw new Error(said.replace(/^can't work out .*?: /, ""));
  }

  // The program ended: by `quit` while it's stopped, as moth then takes away the program it built. While it
  // runs, it can't be told anything, so moth and the program are ended, and the program moth built (prog-debug
  // beside prog.moth, prog-debug.exe on Windows) is taken away here, if this session made it.
  stop() {
    if (!this.child || this.ended) return;
    if (!this.running && !this.waiting) {
      this.child.stdin.write("quit\n");
      setTimeout(() => this.ended || this.kill(), 2000).unref?.();
    } else this.kill();
  }
  kill() {
    const { pid } = this.child;
    try {
      if (process.platform === "win32") spawn("taskkill", ["/pid", String(pid), "/t", "/f"], { windowsHide: true });
      else process.kill(-pid, "SIGKILL");
    } catch {
      this.child.kill("SIGKILL");
    }
    this.child.once("close", () => {
      const built = path.join(this.folder, `${this.program.replace(/\.moth$/i, "")}-debug${process.platform === "win32" ? ".exe" : ""}`);
      setTimeout(() => {
        try {
          if (fs.statSync(built).mtimeMs >= this.launchedAt - 1000) fs.rmSync(built, { force: true });
        } catch {
          // it isn't there: moth took it away, or never made it
        }
      }, process.platform === "win32" ? 500 : 0); // Windows lets go of a program's file a moment after it ends
    });
  }

  // ---------- with the debugger ----------

  // something said to the debugger after what's being said now
  inOrder(f) {
    const next = this.queue.then(f);
    this.queue = next.catch(() => {});
    return next;
  }

  // a command that only looks: what the debugger says, its lines, once it asks again
  ask(command) {
    if (this.ended) return Promise.reject(new Error("the program has ended"));
    if (this.running) return Promise.reject(new Error("the program isn't stopped"));
    return new Promise((resolve) => {
      this.echo = `${command}\n`;
      this.waiting = (said) => resolve(said.split("\n").filter((line, i, all) => line || i < all.length - 1));
      this.child.stdin.write(`${command}\n`);
    });
  }

  // a command that runs the program on: what it says is shown as it comes, and where it stops is said
  resume(command) {
    this.inOrder(async () => {
      await this.applyBreakpoints();
      if (this.ended || this.running) return; // already running on: it can't be told anything until it stops
      this.running = true;
      this.lastResume = command;
      this.echo = `${command}\n`;
      this.waiting = (said) => this.stopped(said);
      this.child.stdin.write(`${command}\n`);
    });
  }

  // what the program's output brought
  said(data) {
    this.text += data;
    if (this.echo && this.text.length >= this.echo.length) {
      if (this.text.startsWith(this.echo)) this.text = this.text.slice(this.echo.length);
      this.echo = null;
    } else if (this.echo && this.echo.startsWith(this.text)) return; // the rest of what it says back is to come
    const at = this.text.length - PROMPT.length;
    if (at >= 0 && this.text.endsWith(PROMPT) && (at === 0 || this.text[at - 1] === "\n")) {
      clearTimeout(this.timer);
      const before = this.text.slice(0, at);
      this.text = "";
      const waiting = this.waiting;
      this.waiting = null;
      waiting?.(before);
      return;
    }
    if (!this.running) return;
    // While it runs, each line is shown as it comes, but for the last: that may be where it stops, if "(moth)"
    // comes next. What's left is shown once the program has said nothing for a moment.
    const lines = this.text.split("\n");
    if (lines.length > 2) {
      this.output(lines.slice(0, -2).join("\n") + "\n");
      this.text = lines.slice(-2).join("\n");
    }
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (!this.running || !this.text || PROMPT.startsWith(this.text.split("\n").at(-1)) && this.text.split("\n").at(-1)) return;
      this.output(this.text);
      this.text = "";
    }, QUIET);
  }

  // what came before "(moth)" after a command that ran the program: what it said, then where it stopped
  stopped(said) {
    this.running = false;
    const lines = said.split("\n");
    if (lines.at(-1) === "") lines.pop();
    const where = lines.pop() ?? "";
    if (lines.length) this.output(lines.join("\n") + "\n");
    const m = STOPPED.exec(where);
    if (!m) {
      this.output(`${where}\n`);
      this.stoppedAt = "somewhere";
      return this.event("stopped", { reason: "pause", threadId: 1 });
    }
    const [, mistake, file, line] = m;
    this.stoppedAt = { file, line: Number(line) };
    let reason = this.lastResume === "go" ? "breakpoint" : "step";
    if (mistake) reason = "exception";
    else if (this.set.get(file)?.has(Number(line)) && this.lastResume === "go") reason = "breakpoint";
    this.event("stopped", { reason, threadId: 1, allThreadsStopped: true, ...(mistake && { description: "Stopped at the mistake", text: m[5] }) });
  }

  exited(code) {
    clearTimeout(this.timer);
    this.ended = true;
    if (this.text) this.output(this.text);
    this.text = "";
    this.event("exited", { exitCode: code ?? 1 });
    this.event("terminated");
  }
}

// ---------- as a program of its own: the protocol on the input and output ----------

function serve(input, output) {
  const session = new MothDebugSession((message) => {
    const body = Buffer.from(JSON.stringify(message), "utf8");
    output.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "ascii"), body]));
  });
  let buffer = Buffer.alloc(0);
  input.on("data", (data) => {
    buffer = Buffer.concat([buffer, data]);
    for (;;) {
      const head = buffer.indexOf("\r\n\r\n");
      if (head < 0) return;
      const length = /content-length:\s*(\d+)/i.exec(buffer.subarray(0, head).toString("ascii"));
      const end = head + 4 + (length ? Number(length[1]) : 0);
      if (buffer.length < end) return;
      const body = buffer.subarray(head + 4, end).toString("utf8");
      buffer = buffer.subarray(end);
      try {
        session.handle(JSON.parse(body));
      } catch {
        // a message that isn't JSON is left out
      }
    }
  });
  input.on("end", () => session.stop());
  return session;
}

if (require.main === module) serve(process.stdin, process.stdout);

module.exports = { MothDebugSession, serve };
