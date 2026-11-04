// Makes checker-rules.moth: what each of the checker's rules (RULES in checker.js) does with a value of each
// type, for `moth check`, which works the types out as checker.js does but can't run vm.js (DESIGN §103).
//
//     node make-checker-rules.mjs
//
// Each line is a rule, what's fixed at its spot, and a type for each operand (a letter each: CODES), then what
// the rule does on SAMPLES' values of those types: the operands whose value (not just type) can change that, by
// place, and the message it stops with, if it does, by its number in the messages, which come after, a line
// each. A line for "type" gives what `+`, `-`, `*` or `/` gives. A name in a message (a field's) is @NAME@.
// moth.test.js says when the file is behind.
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { RULES, FINE, outcome, dependsOn, resultTypeOf, sampleOf } from "./checker.js";
import { BUILTINS, COMPARE_OPS, TURTLE_ACTIONS, UNITS, MEASURE_TYPES } from "./vm.js";

const TYPES = ["number", "text", "yes/no", "nothing", "list", "record", "dictionary", "bytes", ...MEASURE_TYPES];
export const CODES = { number: "n", text: "t", "yes/no": "y", nothing: "0", list: "l", record: "r", dictionary: "d", bytes: "b", distance: "D",
  time: "T", weight: "W", volume: "V" };
const NAME = "@NAME@";
const TIMES = UNITS.filter((u) => u[2] === 1).map((u) => u[3] * 1000); // how long a unit of time is, in milliseconds
// each rule's operands, and each set of what's fixed at its spot that it can have
const SHAPES = {
  setItem: [1, [[]]], add: [2, [[NAME]]], count: [2, [[]]], each: [1, [[]]], every: [1, TIMES.map((u) => [u])], exit: [1, [[]]],
  remove: [1, [[]]], compare: [2, COMPARE_OPS.filter((op) => op !== "is").map((op) => [op])], write: [1, [[]]], removeFile: [1, [[]]],
  wait: [1, TIMES.map((u) => [u])], setField: [1, [[NAME]]], note: [1, [[]]], play: [2, TIMES.map((u) => [u])], picture: [1, [[]]],
  turtle: [1, TURTLE_ACTIONS.map((_, i) => [i]).filter(([i]) => TURTLE_ACTIONS[i] !== "picture")], math: [2, ["+", "-", "*", "/"].map((op) => [op])],
  negate: [1, [[]]], field: [1, [[NAME]]], length: [1, [[]]], random: [2, [[]]], read: [1, [[false], [true]]], readFolder: [1, [[]]],
  item: [1, [[]]],
};
for (const name of Object.keys(RULES)) if (name !== "builtin" && !SHAPES[name]) throw new Error(`make-checker-rules.mjs doesn't know the rule ${name}`);

// checker-rules.moth's text, and how many rules it has
export function checkerRules() {
  const [lines, messages] = [[], new Map()];
  const numbered = (message) => (message ? messages.get(message) ?? messages.set(message, messages.size + 1).get(message) : "");
  const codes = (types) => types.map((t) => CODES[t]).join("");
  const typeLists = (n) => (n === 0 ? [[]] : typeLists(n - 1).flatMap((ts) => TYPES.map((t) => [...ts, t])));
  let skipped = 0;
  function add(name, args, types) {
    let said;
    try {
      said = outcome(name, args, types.map((t, i) => FINE[name]?.[i]?.[t] ?? sampleOf(t)));
    } catch {
      skipped++; // a value no program gives there: a unit's word that isn't one, say
      return;
    }
    const depends = dependsOn(name, args, types).map((d, i) => (d ? i + 1 : "")).join("");
    if (said || depends) lines.push(`${[name, ...args, codes(types)].join("|")}=${depends}|${numbered(said)}`);
  }
  for (const [name, [n, argSets]] of Object.entries(SHAPES)) for (const args of argSets) for (const types of typeLists(n)) add(name, args, types);
  for (const builtin of BUILTINS) for (const types of typeLists(builtin.needs.length)) add("builtin", [builtin.name], types);
  for (const op of ["+", "-", "*", "/"]) {
    for (const a of TYPES) for (const b of TYPES) {
      const type = resultTypeOf(op, a, b);
      if (type) lines.push(`type|${op}|${codes([a, b])}=${type}`);
    }
  }
  // what each builtin gives, what each unit measures, and the turtle's actions, in TURTLE_ACTIONS' order
  for (const builtin of BUILTINS) if (builtin.gives) lines.push(`gives|${builtin.name}=${builtin.gives}`);
  for (const [one, many, measure] of UNITS) for (const word of new Set([one, many])) lines.push(`unit|${word}=${MEASURE_TYPES[measure]}`);
  lines.push(`actions=${TURTLE_ACTIONS.join("|")}`);

  // the lines, as Moth text: a backslash, quote and brace written with a backslash before them, a new line as \n
  const moth = (text) => `"${text.replace(/[\\"{\n]/g, (c) => (c === "\n" ? "\\n" : `\\${c}`))}"`;
  const chunks = (all) => {
    const out = [];
    for (let i = 0; i < all.length; i += 60) out.push(`    add ${moth(all.slice(i, i + 60).join("\n") + "\n")} to made`);
    return out;
  };
  const made = [
    "# Made by make-checker-rules.mjs from checker.js's RULES and vm.js: what each rule the checker checks does",
    "# with a value of each type, for moth check (DESIGN §103). Don't change it by hand: change those, then run",
    "# node make-checker-rules.mjs.",
    "",
    "# the rules, a line each: \"math|-|tn=|12\" is that text - a number fails with message 12",
    "to rules_text",
    '    set made to ""',
    ...chunks(lines),
    "    return made",
    "end",
    "",
    "# the messages, a line each, from 1",
    "to messages_text",
    '    set made to ""',
    ...chunks([...messages.keys()]),
    "    return made",
    "end",
    "",
  ].join("\n");
  return { made, count: lines.length, skipped };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { made, count, skipped } = checkerRules();
  writeFileSync(new URL("./checker-rules.moth", import.meta.url), made);
  console.log(`made checker-rules.moth: ${count.toLocaleString("en")} rules, ${made.length.toLocaleString("en")} bytes (${skipped} left out)`);
}
