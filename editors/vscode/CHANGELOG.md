# Changelog

What changed in each version of Moth for VS Code, newest first. What changed in Moth itself, the language and
the `moth` command line, is in [Moth's changelog](https://github.com/samyyy2423/moth/blob/main/CHANGELOG.md).

## 0.1.0

The first version on the Visual Studio Marketplace and Open VSX.

- **Colours** for `.moth` files, including the values inside text, `"Hi {name}!"`.
- **Problems as you type**, from Moth's own checker, built into the extension, with a **Quick Fix** for a
  misspelled name or a symbol from another language.
- **Format Document**, as `moth tidy` writes code.
- **The outline, Go to Definition, hovers and completion**, from Moth's language server, `moth lsp`, where moth
  is installed; without it, the outline and Go to Definition find the file's functions by their lines.
- **A debugger**, through `moth debug`: breakpoints, stepping, the calls in progress and the variables.
- **Run and Build**, which start `moth run` or `moth build` on the file as a task, whose terminal keeps what the
  program said once it has ended, and answers its questions; and `"type": "moth"` tasks in tasks.json.
- **Snippets** for `to`, `if`, `repeat`, `for each`, `try` and a test.
- **Finding moth**: from the `moth.path` setting, or else the PATH (`moth.exe` on Windows, `moth` on Linux).
  Where there's none, one message says so, with a button to Moth's releases.
