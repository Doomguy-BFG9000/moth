// Moth for tree-sitter (DESIGN §108): what Zed, Helix and Neovim colour Moth with. It reads each line as Moth's
// tokenizer does, its words, names, numbers, text and comments, with the values in text, the brackets, a call
// and `x's` kept as parts of their own; what a statement means is for moth lsp to know. The words are the
// playground's, as the VS Code extension's colours have them (editor.test.js says when they differ), and Moth's
// words don't care about case.
//
//     npx tree-sitter-cli generate      # src/, from this file, after it changes
//     npx tree-sitter-cli build         # moth.so (moth.dll on Windows), for Neovim
const WORDS = [
  "set", "add", "say", "if", "else", "end", "repeat", "while", "for", "to", "return", "and", "or", "not", "is",
  "list", "empty", "length", "item", "move", "turn", "pen", "record", "dictionary", "where", "remove", "keys",
  "byte", "bytes", "as", "hex", "binary", "shift", "bit", "xor", "read", "write", "arguments", "expect",
  "clear", "draw", "box", "circle", "button", "random", "when", "every", "milliseconds", "seconds", "pressed",
  "clicked", "dragged", "mouse", "key", "fail", "stop", "ask", "use", "try", "fails", "uppercase", "lowercase",
  "split", "join", "number", "position", "by", "times", "each", "in", "from", "with", "than", "at", "least",
  "most", "divisible", "of", "forward", "back", "left", "right", "up", "down", "color", "width", "table",
  "total", "average", "largest", "smallest", "chart", "picture", "play", "note", "beep", "send", "json",
  "headers", "checkbox", "tick", "untick", "area", "showing", "choice", "ticked", "dropdown", "slider", "moved",
  "choose", "library", "gives", "package", "function", "power", "items", "rounded", "remainder", "divided",
  "without", "repeats",
];
const CONSTANTS = ["yes", "no", "nothing"];

// one pattern for a list of words, any case, the longest first so `forward` isn't read as `for`
const anyCase = (words) => new RegExp([...words].sort((a, b) => b.length - a.length).join("|"), "i");

module.exports = grammar({
  name: "moth",

  // spaces, tabs and comments come anywhere; a new line ends a line, as it ends a statement
  extras: ($) => [/[^\S\n]/, $.comment],

  // the text between the values in "Hi {name}!", which src/scanner.c reads
  externals: ($) => [$.string_content, $._error_sentinel],

  rules: {
    source_file: ($) => seq(optional($.line), repeat(seq($._newline, optional($.line)))),

    // A line, which may start by making a function (`to area with w, h`) or a kind (`kind dog with name`): their
    // `to` and `kind` come first here, so at the start of a line they're read so, and anywhere else as the word
    // or the name they are there
    line: ($) => choice(seq(choice($.function_definition, $.kind_definition), repeat($._item)), repeat1($._item)),
    function_definition: ($) => seq(alias($._to, $.keyword), field("name", $._name)),
    kind_definition: ($) => seq(alias($._kind, $.keyword), field("name", $._name)),
    _to: (_) => /to/i,
    _kind: (_) => /kind/i,

    _item: ($) => choice($.keyword, $.constant, $.number, $.string, $.call, $.identifier, $.possessive, $.group, $.operator, $.punctuation),

    _newline: (_) => "\n",

    comment: (_) => token(seq("#", /[^\n]*/)),

    // the words, before the names: a word and a name as long as it are the word (`set`), and a longer name
    // is the name (`settings`)
    keyword: (_) => anyCase(WORDS),
    constant: (_) => anyCase(CONSTANTS),

    number: (_) => /0[xX][0-9A-Fa-f]+|0[bB][01]+|[0-9]+(\.[0-9]+)?/,

    // a name with ( straight after it, as compiling has it: a call. A function or a kind can be called what
    // one of the words is (`area`), as VS Code's colours have it.
    call: ($) => seq(field("name", $._name), $.arguments),
    arguments: ($) => seq(token.immediate("("), repeat(choice($._item, $._newline)), ")"),
    group: ($) => seq("(", repeat(choice($._item, $._newline)), ")"),
    _name: ($) => choice($.identifier, alias($.keyword, $.identifier), alias($.constant, $.identifier)),

    identifier: (_) => /[A-Za-z_][A-Za-z0-9_]*/,

    // rex's age
    possessive: (_) => token(seq("'", /[sS]/)),

    // Text: "Hi {name}!". A { before a letter, _ or ( starts a value, read as code, to its }; any other {
    // is itself, as \{ is.
    string: ($) => seq('"', repeat(choice($.string_content, $.escape_sequence, $.interpolation)), '"'),
    escape_sequence: (_) => token.immediate(seq("\\", /[^\n]/)),
    interpolation: ($) => seq(token.immediate("{"), repeat($._item), "}"),

    operator: (_) => /[-+*\/<>=!&|^%~]/,

    // whatever else is written: a comma, a full stop, a bracket of another language's
    punctuation: (_) => /[^\sA-Za-z0-9_"#()\-+*\/<>=!&|^%~]/,
  },
});
