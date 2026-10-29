// Runs one Moth program off the page's main thread, so a loop that never ends can't freeze the page:
// the page just ends this worker when Stop is pressed.
import { run, memoryDisk, seeded, excerpt, describeTrail, MothError } from "./moth.js";

// shortcut: past these, output and drawing are dropped rather than paged; raise them if programs need more
const MAX_LINES = 10_000;
const MAX_DRAWN = 100_000;

// Thrown by `ask` when the page hasn't answered yet: this run stops, the page asks the person, and runs the
// program again from the start with every answer so far. It says and draws the same things up to there.
class Waiting {}

onmessage = ({ data: { source, engine, answers = [], files = {}, seed = 1 } }) => {
  let lines = [];
  let drawn = [];
  let said = 0;
  let total = 0;
  let sent = performance.now();
  const flush = () => {
    if (lines.length || drawn.length) postMessage({ lines, drawn });
    lines = [];
    drawn = [];
    sent = performance.now();
  };
  const due = () => performance.now() - sent > 50 && flush(); // stream while the program keeps running
  const say = (line) => {
    if (++said <= MAX_LINES) lines.push(line);
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
    flush();
    postMessage({ question });
    throw new Waiting();
  };
  const start = performance.now();
  try {
    run(source, say, {
      draw: (line) => {
        if (++total <= MAX_DRAWN) drawn.push(line);
        due();
      },
      engine,
      ask,
      files: (name) => files[name],
      disk: memoryDisk(), // a page has no files of its own: `write` makes them, for this run
      random: seeded(seed), // the page picks a seed for each Run, so running again for an answer gets the same numbers
    });
    flush();
    postMessage({ done: true, empty: said === 0 && total === 0, ms: performance.now() - start });
  } catch (err) {
    if (err instanceof Waiting) return; // the page asks, and runs it again
    flush();
    const trail = err instanceof MothError && err.trail.length ? `\n${describeTrail(err.trail)}` : ""; // the calls that led there
    postMessage({ error: err instanceof MothError ? `Error: ${err.message}\n${excerpt(err.file ? files[err.file] ?? "" : source, err)}${trail}` : `Moth itself crashed: ${err.message}` });
  }
};
