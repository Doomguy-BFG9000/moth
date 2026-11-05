# Helping with Moth

Thank you for looking. Moth is a programming language that reads like plain English, and help of every size
is welcome: a bug report, a clearer error message, an example, a package, or a change to the compiler.

## Ways to help

- **Try it and say what went wrong.** Open an issue with the program (as short as you can make it), what Moth
  said, and what you expected. Say which you used: the [playground](https://samyyy2423.github.io/moth/),
  `moth run`, or a program `moth build` made, and on which system.
- **Make an error message clearer.** Moth's mistakes are meant to read like a person explaining them. If one
  puzzled you, that's a bug.
- **Write a package.** A package is a Git repository of Moth files; the
  [package index](https://github.com/samyyy2423/moth-packages) says how to publish one so `moth add` finds it.
- **Improve the docs and examples.** The README, DESIGN.md, and the programs in `apps/` and `tools/`.
- **Change the language or its engines.** Read on.

## Getting set up

You need [Node.js](https://nodejs.org/) 22 or later and Git. Moth has no other dependencies.

```bash
git clone https://github.com/samyyy2423/moth.git
cd moth
node bootstrap.mjs           # makes moth.exe (moth on Linux) from the source
npm test                     # every test: the VM, the JIT, WebAssembly and machine code
python -m http.server        # then open http://localhost:8000 for the playground
```

On Linux the tests for GTK windows need a display: CI runs `xvfb-run -a npm test`.

## How it fits together

The README's [How it's built](README.md#how-its-built) has the map of the files, and
[DESIGN.md](DESIGN.md) has every decision: why it was made, what was tried, and how it's tested. A few rules
keep it working:

- **Every engine says the same thing.** A program must say, draw and fail exactly alike on the VM, the JIT,
  WebAssembly and in machine code. Every check and error message lives once, in `vm.js`, and the tests run
  each program on all of them.
- **The compiler written in Moth matches the JIT byte for byte.** `compiler.moth` writes the same JavaScript
  as `jit.js`, so a change to what the JIT writes is made in both. Changes to the JIT's helpers and to
  `wasm.js` need nothing in `compiler.moth`.
- **Some files are made from others.** After changing `tools/`, run `node make-stdlib.mjs`; after changing
  `index.html` or an engine, `node make-web.mjs`; after changing `moth.moth` or `machine.moth`,
  `node bootstrap.mjs`. The tests say when one is out of date.
- **The VS Code extension is tested in VS Code.** `editors/vscode` has tools of its own, for packing and testing
  it: `npm ci` there, then `npx @vscode/vsce package` and `xvfb-run -a node e2e/run.mjs` (CI runs both).
  [docs/publishing-the-extension.md](docs/publishing-the-extension.md) says how it's published to the Visual
  Studio Marketplace and Open VSX.
- **Moth files are tidy.** `moth tidy --check file.moth` says whether a file is laid out the one way Moth
  writes code, and `moth tidy file.moth` lays it out.
- **A name can't be a word Moth uses.** `set`, `item`, `list`, `to`, `every`, `number`, `bytes` and `read`
  are some of them, and Moth says so when one is used.

## Making a change

1. Keep it to one thing, and say in the pull request what it changes and why.
2. Add a test that fails without the change.
3. If it changes what Moth does, add a section to DESIGN.md (why, what it does, how it's tested), and put
   anything a person using Moth would see in the README.
4. If it changes the language, the standard library or the `moth` command, change [SPEC.md](SPEC.md) to
   match, add a line under "Not released yet" in [CHANGELOG.md](CHANGELOG.md), and check it keeps
   [VERSIONING.md](VERSIONING.md)'s promise: nothing a 1.x program does may change. A security problem goes
   to [SECURITY.md](SECURITY.md)'s private report, not a pull request.
5. Run `npm test`. CI runs it again on Linux for every pull request, and it must pass.

By sending a pull request you agree that your change is under the [Apache License 2.0](LICENSE), as the rest
of Moth is.

## Being kind

Be patient and generous with each other, especially with people new to programming: Moth is made for them.
