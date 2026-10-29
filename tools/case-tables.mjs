// Writes the tables machine.moth's `uppercase of` and `lowercase of` use, between the two lines that mark
// them in machine.moth, from what this Node.js's toUpperCase and toLowerCase do to every character past
// ASCII, so machine code changes case exactly as `moth run` does:
//
//     node tools/case-tables.mjs
//
// A run is a first character, a last one, a step (1 or 2) and what to add to each; a special character
// becomes more than one; and the cased and case-ignorable ranges decide whether a Σ ends a word.
import { readFileSync, writeFileSync } from "node:fs";

const file = new URL("../machine.moth", import.meta.url);
const START = "# ---------- Unicode's cases: made by tools/case-tables.mjs ----------";
const END = "# ---------- the end of Unicode's cases ----------";

function runsOf(pairs) {
  const runs = [];
  for (const [cp, to] of pairs) {
    const r = runs[runs.length - 1];
    const delta = to - cp;
    if (r && r.delta === delta && (r.count === 1 ? cp - r.start <= 2 : cp === r.last + r.stride)) {
      if (r.count === 1) r.stride = cp - r.start;
      r.last = cp;
      r.count++;
    } else runs.push({ start: cp, last: cp, stride: 1, delta, count: 1 });
  }
  return runs.flatMap((r) => [r.start, r.last, r.stride, r.delta]);
}

const characters = function* () {
  for (let cp = 0x80; cp <= 0x10ffff; cp++) if (cp < 0xd800 || cp > 0xdfff) yield cp;
};

function cases(change) {
  const simple = [], special = [];
  for (const cp of characters()) {
    const s = String.fromCodePoint(cp), t = change(s);
    if (t === s) continue;
    const cps = [...t].map((c) => c.codePointAt(0));
    if (cps.length === 1) simple.push([cp, cps[0]]);
    else special.push(cp, cps.length, ...cps);
  }
  return { runs: runsOf(simple), special };
}

function ranges(re) {
  const out = [];
  for (let cp = 0; cp <= 0x10ffff; cp++) {
    if (cp >= 0xd800 && cp <= 0xdfff) continue;
    if (!re.test(String.fromCodePoint(cp))) continue;
    if (out.length && out[out.length - 1] === cp - 1) out[out.length - 1] = cp;
    else out.push(cp, cp);
  }
  return out;
}

// `set name to list of ...`, ten numbers to a line
const moth = (name, numbers) => {
  const lines = [];
  for (let i = 0; i < numbers.length; i += 10) lines.push(numbers.slice(i, i + 10).join(", "));
  return `set ${name} to list of ${lines.join(",\n    ")}`;
};

const upper = cases((s) => s.toUpperCase()), lower = cases((s) => s.toLowerCase());
const block = [
  START,
  `# What \`uppercase of\` and \`lowercase of\` do to each character past ASCII, as JavaScript's toUpperCase and`,
  `# toLowerCase do (Unicode ${process.versions.unicode}): runs of a first character, a last, a step and what to add; special`,
  `# characters, each with how many it becomes and those; and the ranges of cased and case-ignorable ones.`,
  moth("case_upper_runs", upper.runs),
  moth("case_upper_special", upper.special),
  moth("case_lower_runs", lower.runs),
  moth("case_lower_special", lower.special),
  moth("case_cased", ranges(/\p{Cased}/u)),
  moth("case_ignorable", ranges(/\p{Case_Ignorable}/u)),
  END,
].join("\n");

const source = readFileSync(file, "utf8");
const from = source.indexOf(START), to = source.indexOf(END);
if (from < 0 || to < 0) throw new Error("machine.moth has no place marked for Unicode's cases");
writeFileSync(file, source.slice(0, from) + block + source.slice(to + END.length));
console.log(`Unicode ${process.versions.unicode}: ${upper.runs.length / 4} and ${lower.runs.length / 4} runs, written to machine.moth`);
