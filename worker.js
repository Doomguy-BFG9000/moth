// Runs one Moth program off the page's main thread, so a loop that never ends can't freeze the page:
// the page just ends this worker when Stop is pressed. An app (a program with `when` or `every`) keeps the
// worker going after it has set up: the worker runs its timers, and the page sends it keys and clicks.
// A line said to the error output goes to the page as { error: line }, among the others, and `stop the
// program` ends the run (or the app) with the number it gave, which the page shows.
import { run, memoryDisk, seeded, excerpt, describeTrail, MothError } from "./moth.js";
import { realClock } from "./vm.js";

// shortcut: past these, output and drawing are dropped rather than paged; raise them if programs need more.
// Drawing counts from the last `clear`, so an app that draws every frame can go on for ever.
const MAX_LINES = 10_000;
const MAX_DRAWN = 100_000;
const FASTEST = 10; // milliseconds: an `every` faster than this runs this often

// Thrown by `ask` when the page hasn't answered yet: this run stops, the page asks the person, and runs the
// program again from the start with every answer so far. It says and draws the same things up to there.
class Waiting {}

let app = null; // the running app, once the program has set it up
let lines = [];
let drawn = [];
let sent = 0;
const flush = () => {
  if (lines.length || drawn.length) postMessage({ lines, drawn });
  lines = [];
  drawn = [];
  sent = performance.now();
};
const due = () => performance.now() - sent > 50 && flush(); // stream while the program keeps running

let source = "";
let files = {};
// A mistake ends the program, or the app; anything else that goes wrong is Moth's own.
// A page has no files of its own: `write` makes them, for this run. `read "https://..."` reads a site, if the
// site lets pages read it; the browser keeps the program to what any page can do.
function pageDisk() {
  const files = memoryDisk();
  return {
    read: (name, asBytes) => {
      if (!/^https?:\/\//i.test(name)) return files.read(name, asBytes);
      const request = new XMLHttpRequest(); // a worker may wait for it
      request.open("GET", name, false);
      if (asBytes) request.overrideMimeType("text/plain; charset=x-user-defined");
      try {
        request.send();
      } catch {
        throw new Error("couldn't reach it (the site may not let pages read it)");
      }
      if (request.status === 0) throw new Error("couldn't reach it (the site may not let pages read it)");
      if (request.status >= 400) throw new Error(`the site answered ${request.status}`);
      if (!asBytes) return request.responseText;
      return Uint8Array.from(request.responseText, (c) => c.charCodeAt(0) & 0xff);
    },
    write: files.write,
    remove: files.remove,
    folder: files.folder,
  };
}

function failed(err) {
  if (err instanceof Waiting) {
    flush();
    postMessage({ error: "Error: an app can't ask a question once it's running" });
    app = null;
    return;
  }
  flush();
  const trail = err instanceof MothError && err.trail.length ? `\n${describeTrail(err.trail)}` : ""; // the calls that led there
  postMessage({
    error: err instanceof MothError ? `Error: ${err.message}\n${excerpt(err.file ? files[err.file] ?? "" : source, err)}${trail}` : `Moth itself crashed: ${err.message}`,
    mistake: err instanceof MothError && !err.file ? { line: err.line, col: err.col, reason: err.reason } : undefined, // for a Fix button
  });
  app = null;
}

// one event for the app: its handlers run, then what they said and drew goes to the page
function handle(run) {
  if (!app) return;
  try {
    run();
    flush();
    if (app.stopped !== undefined) { // a handler stopped the program: the app is over
      postMessage({ stopped: app.stopped });
      app = null;
    }
  } catch (err) {
    failed(err);
  }
}

onmessage = ({ data }) => {
  if (data.event) return handle(() => app.send(data.event, data.inputs)); // a key or a click, from the page
  ({ source, files = {} } = data);
  const { engine, answers = [], seed = 1 } = data;
  let said = 0;
  let total = 0;
  let pictured = 0; // drawn since the last clear
  const say = (line) => {
    if (++said <= MAX_LINES) lines.push(line);
    else if (said === MAX_LINES + 1) lines.push(`(only the first ${MAX_LINES.toLocaleString("en")} lines are shown)`);
    due();
  };
  let stopped; // the number `stop the program` gave, if it ran
  const sayError = (line) => { // a line said to the error output, which the page shows in the colour of a mistake
    if (++said <= MAX_LINES) lines.push({ error: line });
    else if (said === MAX_LINES + 1) lines.push(`(only the first ${MAX_LINES.toLocaleString("en")} lines are shown)`);
    due();
  };
  let asked = 0;
  const ask = (question) => {
    if (asked < answers.length) {
      const { text, shown = text } = answers[asked++]; // a drawing is shown as "(a drawing)", not its points
      say(`${question} ${shown}`); // the question and its answer, as a line of output
      return text;
    }
    if (app) throw new Waiting(); // too late to stop and ask
    flush();
    postMessage({ question });
    throw new Waiting();
  };
  const start = performance.now();
  const clock = realClock();
  try {
    app = run(source, say, {
      draw: (d) => {
        total++;
        if (d.clear) pictured = 0;
        if (++pictured <= MAX_DRAWN) drawn.push(d);
        due();
      },
      engine,
      ask,
      files: (name) => files[name],
      disk: pageDisk(), // a page has no files of its own: `write` makes them, for this run
      random: seeded(seed), // the page picks a seed for each Run, so running again for an answer gets the same numbers
      clock: { ...clock, sleep: (ms) => (flush(), clock.sleep(ms)) }, // the real time; what was said and drawn shows before a wait
      printError: sayError,
      exit: (code) => (stopped = code),
    }) ?? null;
    flush();
    postMessage({ done: true, app: app?.waits, empty: said === 0 && total === 0, ms: performance.now() - start, stopped });
    app?.waits.forEach((wait, i) => wait.event === "every" && setInterval(() => handle(() => app.handle(i)), Math.max(FASTEST, wait.interval)));
  } catch (err) {
    if (err instanceof Waiting) return; // the page asks, and runs it again
    failed(err);
  }
};
