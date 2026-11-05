# Moth in your editor

Moth's language server, `moth lsp`, gives any editor that speaks the
[Language Server Protocol](https://microsoft.github.io/language-server-protocol/) what the VS Code
extension has:

- **problems as you type**, as `moth check` finds them: a name with no value, a line that can never run, a
  variable never used, and the types: `area("wide", 2)` when `area` says `with w as a number`;
- **formatting**, as `moth tidy` writes code;
- **the outline**: each function, kind (with its own functions in it) and variable;
- **go to definition**, in the file or a file it `use`s, and on a `use` line, the file itself;
- **hover**: what a name is, what a variable holds (`a number`, `a dog`, `a list of text`), what a function
  takes and gives, with the comment above it;
- **completion** of the names the program makes and Moth's words, and after `rex's`, what rex has.

It needs `moth` on your PATH: from [the releases](https://github.com/samyyy2423/moth/releases), or made from
the repository with `node bootstrap.mjs`. The colours come from the editor: VS Code's and JetBrains' from
`vscode/syntaxes/moth.tmLanguage.json`, and Zed's, Helix's and Neovim's from the tree-sitter grammar in
`tree-sitter-moth/`.

| Editor | Problems, tidying, outline, definitions, hover, completion | Colours |
| --- | --- | --- |
| VS Code | [the extension](vscode/README.md) | the extension |
| Neovim 0.10 and later | `neovim/`, a plugin folder | tree-sitter, once its parser is built |
| Helix | `helix/languages.toml` | tree-sitter, built by `hx --grammar build` |
| Zed | `zed/`, an extension | tree-sitter, built by Zed |
| IntelliJ IDEA, PyCharm, WebStorm and the rest | the LSP4IJ plugin | the TextMate grammar |
| Any other | `moth lsp`, over its input and output | |

## VS Code

See [vscode/README.md](vscode/README.md). The extension finds problems and tidies with Moth's engine,
built into it, and asks `moth lsp` for the rest where moth is installed.

## Neovim

`neovim/` is a plugin folder: it makes `.moth` files Moth, with `#` comments and Moth's indenting, starts
`moth lsp` for them, and colours them with tree-sitter once the parser is built. Add it to your config:

```lua
-- with lazy.nvim
{ dir = "/path/to/moth/editors/neovim" }
-- or by hand, in init.lua
vim.opt.runtimepath:append("/path/to/moth/editors/neovim")
```

Then `K` shows what a name is, `CTRL-]` goes to where it's made, `:lua vim.lsp.buf.format()` tidies,
`:lua vim.lsp.buf.document_symbol()` (`gO` in Neovim 0.11) lists what the file makes, and completion is
`<C-x><C-o>` (or your completion plugin's). Set `vim.g.moth_path` if moth isn't on your PATH, or `vim.g.moth_lsp = false` to start
the server yourself, for instance with Neovim 0.11's `vim.lsp.config`:

```lua
vim.lsp.config("moth", { cmd = { "moth", "lsp" }, filetypes = { "moth" }, root_markers = { "moth.packages", ".git" } })
vim.lsp.enable("moth")
```

For the colours, build the parser into the plugin folder's `parser/` with the
[tree-sitter CLI](https://tree-sitter.github.io/tree-sitter/creating-parsers/1-getting-started.html)
(and a C compiler):

```bash
cd editors/tree-sitter-moth
npx tree-sitter-cli build -o ../neovim/parser/moth.so    # moth.dll on Windows
```

With nvim-treesitter you can register the grammar there instead: it's in `editors/tree-sitter-moth` of this
repository, and the colours are `neovim/queries/moth/highlights.scm`.

## Helix

Add [helix/languages.toml](helix/languages.toml) to your `languages.toml` (`~/.config/helix/languages.toml`,
or `%AppData%\helix\languages.toml` on Windows), and copy `helix/queries/moth/highlights.scm` to
`runtime/queries/moth/highlights.scm` beside it. Then build the grammar, and check:

```bash
hx --grammar fetch
hx --grammar build
hx --health moth
```

`space k` shows what a name is, `gd` goes to where it's made, `:format` tidies, `space s` lists what the file
makes, and completion comes as you type.

## Zed

Zed takes a language as an extension. Install `zed/` as a dev extension: in Zed, open the command palette,
run **zed: install dev extension**, and choose the `editors/zed` folder. Zed builds it, with
[Rust](https://rustup.rs) installed through rustup, and the grammar with it. If moth isn't on your PATH, say
where it is in your settings:

```json
{ "lsp": { "moth": { "binary": { "path": "C:/tools/moth.exe" } } } }
```

## JetBrains IDEs

Install the [LSP4IJ](https://plugins.jetbrains.com/plugin/23257-lsp4ij) plugin (it works in every
JetBrains IDE, the free ones too). Then:

1. **Colours**: Settings, Editor, TextMate Bundles, **+**, and choose the `editors/vscode` folder.
2. **The server**: Settings, Languages & Frameworks, Language Servers, **+**. On the Server tab, name it
   Moth and give the command `moth lsp` (the whole path to moth if it isn't on your PATH). On the Mappings
   tab, under File name patterns, add `*.moth` with the language id `moth`. A file name pattern, rather than a
   file type, keeps the TextMate colours.

## Debugging

`moth debug` runs a program stopping at its first line and takes commands (`step`, `break 12`, `show x`...).
[vscode/debug-adapter.js](vscode/debug-adapter.js) is a Debug Adapter Protocol adapter for it, so an editor's
debugger can set breakpoints in a program and the files it uses, step in, over and out, show the calls in
progress and the variables, work out what's typed in the debug console or under the pointer, and stop at the
mistake that ends a program. While the program runs, a line typed in the debug console answers its `ask`.
It needs moth, and Node.js to run it (VS Code runs it inside the extension). Its launch configuration takes
`program`, `args`, `allow` (the `--allow` flags), `stopOnEntry` and `mothPath`.

- **VS Code**: *Moth: Debug this file*, or F5 in a Moth file. A `launch.json` entry is `{ "type": "moth",
  "request": "launch", "name": "Debug", "program": "${file}" }`.
- **Neovim**: with [nvim-dap](https://github.com/mfussenegger/nvim-dap) installed, `neovim/` sets it up:
  `:DapToggleBreakpoint`, then `:DapContinue`. Set `vim.g.moth_debug_adapter` if the plugin folder isn't
  beside `vscode/`.
- **Helix**: take the `#` off the debugger lines at the end of [helix/languages.toml](helix/languages.toml),
  with where this repository is; then `:debug-start launch` (or `space G l`).
- **JetBrains IDEs**: LSP4IJ runs debug adapters too: Run, Edit Configurations, **+**, Debug Adapter
  Protocol. The command is `node /path/to/moth/editors/vscode/debug-adapter.js`, the file name pattern
  `*.moth`, and the launch configuration `{ "type": "moth", "request": "launch", "program": "${file}" }`.
- **Any other** editor's DAP client: start `node debug-adapter.js` and launch with `program`.

`moth debug` can only be told things while the program is stopped, so a breakpoint set while it runs counts
from where it next stops, and pausing a running program isn't something it can do.

## Any other editor

Start `moth lsp`, with nothing after it, and speak the Language Server Protocol to it over its input and
output. Its language id is `moth`, and its files end in `.moth`. It keeps each open document's text as the
editor sends it (all of it each time) and reads the files a document uses from there, or else from the disk.
An editor that finds the problems itself can ask for none with `"initializationOptions": { "diagnostics":
false }`. For instance, Emacs's Eglot:

```elisp
(define-derived-mode moth-mode prog-mode "Moth" (setq-local comment-start "# "))
(add-to-list 'auto-mode-alist '("\\.moth\\'" . moth-mode))
(with-eval-after-load 'eglot (add-to-list 'eglot-server-programs '(moth-mode "moth" "lsp")))
```

## The tree-sitter grammar

`tree-sitter-moth/grammar.js` reads each line as Moth's tokenizer does; `src/scanner.c` says whether a `{` in
text starts a value. After changing either, make `src/` again, and check every Moth file still reads:

```bash
cd editors/tree-sitter-moth
npx tree-sitter-cli generate
```

Zed and Helix build it from a commit of this repository (`commit` in `zed/extension.toml`, `rev` in
`helix/languages.toml`), so a change to it needs a new commit named there.
