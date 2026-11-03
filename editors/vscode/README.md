# Moth for VS Code

[Moth](https://github.com/samyyy2423/moth) is a programming language that reads like plain English. This
extension gives `.moth` files:

- **Colours**, including the values inside text, `"Hi {name}!"`.
- **Problems as you type**, found by Moth's own checker without running the program: a mistake, a name
  with no value, a line that can never run, a variable that's never used. A misspelled name or a symbol
  from another language gets a **Quick Fix**.
- **Format Document**, which writes the code the one way `moth tidy` writes it.
- **The outline** of the file's functions, and **Go to Definition** for a call.
- **Snippets** for `to`, `if`, `repeat`, `for each`, `try` and a `test_` function.
- **Run, Debug and Build** (in the editor's Run menu, and as *Moth: Run this file* and the others),
  which start `moth run`, `moth debug` or `moth build` on the file in a terminal. Set `moth.path` if
  moth isn't on your PATH.

The checker and the tidying are Moth's own engine, built into the extension; Run, Debug and Build need
[moth](https://github.com/samyyy2423/moth/releases).

## Installing

From the repository:

```bash
node editors/vscode/make-vsix.mjs
code --install-extension editors/vscode/moth-0.1.0.vsix
```
