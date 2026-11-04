; Moth's colours, as VS Code's extension has them, in Helix's names: editors/tree-sitter-moth/queries/highlights.scm
; with numbers, escapes, calls and fields as Helix calls them (editor.test.js says when the two differ).

(comment) @comment

(keyword) @keyword

(constant) @constant.builtin

(number) @constant.numeric

(string) @string

(escape_sequence) @constant.character.escape

(interpolation
  "{" @punctuation.special
  "}" @punctuation.special)

(function_definition
  name: (identifier) @function)

(kind_definition
  name: (identifier) @type)

(call
  name: (identifier) @function)

((possessive) @operator
  .
  (identifier) @variable.other.member)

(operator) @operator

(punctuation) @punctuation.delimiter

[
  "("
  ")"
] @punctuation.bracket
