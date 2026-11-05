# Moth for VS Code

[Moth](https://github.com/samyyy2423/moth) is a programming language that reads like plain English:
`set total to price * 2`, `for each pet in pets`, `say "Hi {name}!"`. Its command line, `moth`, builds a program
into a small, fast program of its own for Windows or Linux, with nothing else to install.

This extension gives `.moth` files colours, problems as you type, Format Document, the outline, Go to
Definition, hovers, completion, snippets, a debugger, and Run and Build.

## Install Moth itself

Colours, snippets, problems and Format Document work as soon as the extension is installed: Moth's checker is
built into it. Hovers, completion, Go to Definition into other files, Run, Build and the debugger need `moth`,
Moth's command line, which runs on Windows and Linux:

1. Download it from [Moth's latest release](https://github.com/samyyy2423/moth/releases/latest):
   - **Windows:** `moth-windows.exe`, saved as `moth.exe`;
   - **Linux:** `moth-linux`, saved as `moth`, then `chmod +x moth`.
2. Put it in a folder on your PATH, or set **`moth.path`** to where it is (File, Preferences, Settings, and
   search for *moth*).

The extension looks where `moth.path` says first, then on the PATH. If there's no moth, it says so once, with a
button to the releases:

![A notification in VS Code: Moth's command line, moth, isn't on your PATH, with Get Moth and Don't Show Again buttons](https://github.com/samyyy2423/moth/raw/HEAD/editors/vscode/images/missing-moth.png)

Hovers, completion and Go to Definition into other files come from Moth's language server, `moth lsp`, and the
debugger from `moth debug`: both need a moth newer than 1.11.0. With an older one, Run and Build work, and the
outline and Go to Definition find the file's own functions by their lines. What the extension does with moth is
in the **Moth** output (View, Output).

## What it does

### Problems as you type, and Quick Fixes

Moth's own checker finds mistakes without running the program: a name with no value, a line that can never
run, a variable that's never used, and code that goes against what it says it is (`area("wide", 2)` when
`area` takes `w as a number`). Red is a mistake that stops the program, yellow the rest. A misspelled name, or
a symbol from another language (`>=` for `is at least`), gets a Quick Fix.

![Typing cots for cost: a red wavy line appears under it, its hover says 'cots' has no value yet, did you mean 'cost'?, and the Quick Fix changes it to cost](https://github.com/samyyy2423/moth/raw/HEAD/editors/vscode/images/problems.gif)

### Format Document

Format Document (Shift+Alt+F, or Ctrl+Shift+I on Linux) writes the code the one way `moth tidy` does.

![Badly indented Moth code, Format Document chosen from the Command Palette, and the code laid out tidily](https://github.com/samyyy2423/moth/raw/HEAD/editors/vscode/images/format.gif)

### The outline

The Outline view, the breadcrumbs and Go to Symbol (Ctrl+Shift+O) list the file's functions, kinds (with their
own functions in them) and variables.

![The Outline view: the kind basket, its function total with its variables, and change_for, shopping and cost](https://github.com/samyyy2423/moth/raw/HEAD/editors/vscode/images/outline.png)

### Go to Definition

Go to Definition (F12) and Peek Definition (Alt+F12) go to where a function or variable is made, in the file or
in a file it `use`s; on a `use` line, to the file itself.

![Peek Definition on price_of in shop.moth shows its definition in prices.moth, inline](https://github.com/samyyy2423/moth/raw/HEAD/editors/vscode/images/definition.png)

### Hovers

A hover says what a name is: what a variable holds (`a number`, `a dog`, `a list of text`), and what a function
takes and gives, with the comment above it.

![A hover on change_for: to change_for with paid as a number, cost as a number gives a number, and its comment](https://github.com/samyyy2423/moth/raw/HEAD/editors/vscode/images/hover.png)

### Completion and snippets

Completion offers the names the program makes and Moth's words, and after `rex's`, what rex has. Snippets write
`to`, `if`, `repeat`, `for each`, `try` and a `test_` function for you.

![After shopping's, completion offers things and total, the basket's, and then Moth's snippets](https://github.com/samyyy2423/moth/raw/HEAD/editors/vscode/images/completion.png)

### The debugger

*Moth: Debug this file* (or F5) debugs the file through `moth debug`: breakpoints in the file and the files it
uses, stepping in, over and out, the calls in progress, the variables, what's under the pointer or typed in the
Debug Console, and the mistake that ends a program.

![Stopped at a breakpoint in total: the variables self, sum, thing, shopping and cost, and the calls in progress](https://github.com/samyyy2423/moth/raw/HEAD/editors/vscode/images/debugger.png)

### Run and Build

*Moth: Run this file* runs it with `moth run`, and *Moth: Build this file* makes it a program of its own with
`moth build`, from the Command Palette (Ctrl+Shift+P); Run and Debug are on the editor's run button too, at the
top right. The file is saved first. What the program says stays in the terminal once it ends, and it can ask
questions there.

![The terminal after Run: Your basket comes to £6.85, Your change: £13.15](https://github.com/samyyy2423/moth/raw/HEAD/editors/vscode/images/run.png)

A task in `.vscode/tasks.json` can do the same, to give it a key or run it before something else:

```json
{
  "version": "2.0.0",
  "tasks": [{ "type": "moth", "command": "build", "file": "app.moth", "label": "build the app" }]
}
```

## Commands

| Command | What it does |
| --- | --- |
| **Moth: Run this file** (`moth.run`) | `moth run` on the file in front, in a terminal |
| **Moth: Debug this file** (`moth.debug`) | debugs the file in front; F5 does too, where there's no launch.json |
| **Moth: Build this file** (`moth.build`) | `moth build` on the file in front: `app.exe` on Windows, `app` on Linux |

## Settings

| Setting | Default | What it does |
| --- | --- | --- |
| `moth.path` | empty | Where moth is: the path to `moth.exe` on Windows or `moth` on Linux, or to the folder it's in. Empty means the moth on your PATH. |
| `moth.languageServer` | `true` | Start `moth lsp` for the outline, Go to Definition, hovers and completion. Off, the outline and Go to Definition find the file's functions by their lines. |

In a folder you haven't trusted (VS Code's Restricted Mode), the extension uses `moth.path` from your own
settings only, never the folder's, so opening a folder can't choose a program for it to run.

## Debugging with a launch.json

F5 with no launch.json debugs the file in front. For more, add a configuration of type `moth`:

```json
{
  "type": "moth",
  "request": "launch",
  "name": "Debug the app",
  "program": "${workspaceFolder}/app.moth",
  "args": ["Sam", "3"],
  "allow": ["--allow-read"],
  "stopOnEntry": false
}
```

`allow` is what the program may do without asking (`--allow-read`, `--allow-write`, `--allow-net`,
`--allow-run`, `--allow-libraries` or `--allow-all`), and `mothPath` a moth other than `moth.path`'s.

## More

- [Learn Moth](https://samyyy2423.github.io/moth/learn.html) in an afternoon, or try it in the
  [playground](https://samyyy2423.github.io/moth/), in your browser.
- [The language](https://github.com/samyyy2423/moth#the-language) on one page.
- Moth in [Neovim, Helix, Zed and JetBrains' IDEs](https://github.com/samyyy2423/moth/blob/main/editors/README.md).
- [Report a problem](https://github.com/samyyy2423/moth/issues), or see
  [what's changed](https://github.com/samyyy2423/moth/blob/main/editors/vscode/CHANGELOG.md).

Moth and this extension are under the [Apache License 2.0](https://github.com/samyyy2423/moth/blob/main/LICENSE).
