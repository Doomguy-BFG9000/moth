# Moth for VS Code

[Moth](https://github.com/samyyy2423/moth) is a programming language that reads like plain English. This
extension gives `.moth` files:

- **Colours**, including the values inside text, `"Hi {name}!"`.
- **Problems as you type**, found by Moth's own checker without running the program: a mistake, a name
  with no value, a line that can never run, a variable that's never used, and code that goes against what
  it says it is (`to area with w as a number`, then `area("wide", 2)`). A misspelled name or a symbol from
  another language gets a **Quick Fix**.
- **Format Document**, which writes the code the one way `moth tidy` writes it.
- **The outline** of the file: its functions, kinds and variables.
- **Go to Definition**, in the file or a file it `use`s, and on a `use` line, the file itself.
- **Hovers**: what a name is, what a variable holds (`a number`, `a dog`, `a list of text`), and what a
  function takes and gives, with the comment above it.
- **Completion** of the names the program makes and Moth's words; after `rex's`, what rex has.
- **Snippets** for `to`, `if`, `repeat`, `for each`, `try` and a `test_` function.
- **Run, Debug and Build** (in the editor's Run menu, and as *Moth: Run this file* and the others),
  which start `moth run`, `moth debug` or `moth build` on the file in a terminal.

The checker and the tidying are Moth's own engine, built into the extension. The outline, Go to
Definition, hovers and completion come from Moth's language server, `moth lsp`, which the extension starts
where [moth](https://github.com/samyyy2423/moth/releases) is installed; without it, the outline and Go to
Definition find the file's functions by their lines. Set `moth.path` if moth isn't on your PATH, and
`moth.languageServer` to `false` not to start it. What it does is in the Moth output (View, Output).

## Installing

From the repository:

```bash
node editors/vscode/make-vsix.mjs
code --install-extension editors/vscode/moth-0.1.0.vsix
```

Other editors use `moth lsp` directly: see [editors/README.md](../README.md).
