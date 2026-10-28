// Runs one Moth program off the page's main thread, so a loop that never ends can't freeze the page:
// the page just ends this worker when Stop is pressed.
import { run, excerpt, MothError } from "./moth.js";

// shortcut: past these, output and drawing are dropped rather than paged; raise them if programs need more
const MAX_LINES = 10_000;
const MAX_DRAWN = 100_000;

onmessage = ({ data: source }) => {
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
  try {
    run(source, (line) => {
      if (++said <= MAX_LINES) lines.push(line);
      else if (said === MAX_LINES + 1) lines.push(`(only the first ${MAX_LINES.toLocaleString("en")} lines are shown)`);
      due();
    }, {
      draw: (line) => {
        if (++total <= MAX_DRAWN) drawn.push(line);
        due();
      },
    });
    flush();
    postMessage({ done: true, empty: said === 0 && total === 0 });
  } catch (err) {
    flush();
    postMessage({ error: err instanceof MothError ? `Error: ${err.message}\n${excerpt(source, err)}` : `Moth itself crashed: ${err.message}` });
  }
};
