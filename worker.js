// Runs one Moth program off the page's main thread, so a loop that never ends can't freeze the page:
// the page just ends this worker when Stop is pressed.
import { run, excerpt, MothError } from "./moth.js";

const MAX_LINES = 10_000; // shortcut: later lines are dropped rather than paged; raise it if programs need more

onmessage = ({ data: source }) => {
  let lines = [];
  let count = 0;
  let sent = performance.now();
  const flush = () => {
    if (lines.length) postMessage({ lines });
    lines = [];
    sent = performance.now();
  };
  try {
    run(source, (line) => {
      if (++count <= MAX_LINES) lines.push(line);
      else if (count === MAX_LINES + 1) lines.push(`(only the first ${MAX_LINES.toLocaleString("en")} lines are shown)`);
      if (performance.now() - sent > 50) flush(); // stream output while the program keeps running
    });
    flush();
    postMessage({ done: true, empty: count === 0 });
  } catch (err) {
    flush();
    postMessage({ error: err instanceof MothError ? `Error: ${err.message}\n${excerpt(source, err)}` : `Moth itself crashed: ${err.message}` });
  }
};
