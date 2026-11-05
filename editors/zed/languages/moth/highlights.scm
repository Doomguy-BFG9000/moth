; Moth's colours, as VS Code's extension has them (editors/vscode/syntaxes/moth.tmLanguage.json), in the names
; Neovim and tree-sitter use. Zed's and Helix's copies (editors/zed, editors/helix) are this with their names.

(comment) @comment

(keyword) @keyword

(constant) @constant.builtin

(number) @number

(string) @string

(escape_sequence) @string.escape

(interpolation
  "{" @punctuation.special
  "}" @punctuation.special)

(function_definition
  name: (identifier) @function)

(kind_definition
  name: (identifier) @type)

(call
  name: (identifier) @function.call)

((possessive) @operator
  .
  (identifier) @property)

(operator) @operator

(punctuation) @punctuation.delimiter

[
  "("
  ")"
] @punctuation.bracket
