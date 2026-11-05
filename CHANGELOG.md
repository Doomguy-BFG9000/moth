# Changelog

What changed in each release of Moth, newest first. Each version links to its release on GitHub, which has
the downloads and their SHA-256 sums. [VERSIONING.md](VERSIONING.md) says what a version number promises,
and [DESIGN.md](DESIGN.md) has the reasons behind each change, a section for each.

## Not released yet

- **Workers: every core.** `start work(x) on another core` runs the call on a worker, a thread with memory of
  its own, given copies of what it's called with and of the program's variables; `wait for` gives a copy of
  what it gave back, or fails with its mistake. In a program `moth build` makes, workers run at the same
  moment on as many cores as there are, on Windows and Linux; in the playground, as tasks do, one after
  another, giving the same.
- **A web server for many people.** `server.moth` serves many connections at once, so a slow client holds up
  no one, keeps them open for the next request (HTTP/1.1 keep-alive), answers requests sent together in
  order, and limits how long a request takes and how big it is (`set_timeout`, `set_idle_timeout`,
  `set_most_bytes`, `set_most_connections`, `set_most_requests`, `set_keep_alive`). A request now has its
  `version`. `serve_on_workers(8080, answer, 4)`, or `set_workers(4)`, answers on 4 workers. From 10,500
  requests a second to 85,000, on one thread.
- **Trusted packages.** `moth.sums`, beside `moth.packages`, keeps the SHA-256 of each package's files.
  `moth add` and `moth update` write it and `moth get` checks it, so a package changed in `packages/`, or
  changed where it comes from, is found. A package's own `moth.sums` is checked for the packages it brings.
  A `moth.packages` with no sums gets them from the next `moth get`.
- **Signed packages.** `moth add`, `moth get` and `moth update` take `--signed`, which accepts only a
  package whose commit, or the tag it was asked for at, has a signature git trusts.
- **`moth audit`** checks a program's packages against the advisories in the package index and says which
  are about the commits they're at.
- **Packages are checked out the same way everywhere.** moth tells git to keep line ends as they were
  committed and to write a symbolic link as a small file, whatever the system or the person's own git
  settings, so a package's files, and their sum, are the same on Windows and Linux.
- **Documents for depending on Moth:** a language specification ([SPEC.md](SPEC.md)), a stability promise
  ([VERSIONING.md](VERSIONING.md)), a security policy ([SECURITY.md](SECURITY.md)) and this changelog.
- **Types you can add.** An input can be `a dog` (a record the kind dog makes) or `a list of numbers` (or of
  `text`, `dogs`, `lists of numbers`...), and a function can say what it `gives`. A run checks what it
  always could; `moth check`, the playground and the editors check the rest before the program runs, as
  "doesn't fit", in red. They also know what a function returns, so `f() + 1`, where f gives nothing, will
  fail. Code that says nothing is checked as it was, and `gives` stays a name.
- **`moth check` works the types out**, as the playground's checker does, and says what it says word for
  word, but for what rests on a value written out (`1 / 0`).
- **`moth lsp`, a language server**, for any editor: problems as you type, formatting as `moth tidy` writes,
  the outline, go to definition in the file or a file it uses, hovers that say what a variable holds and
  what a function takes and gives, and completion, after `rex's` too.
- **Every major editor.** The VS Code extension asks `moth lsp` for the outline, definitions, hovers and
  completion where moth is installed. New: a plugin folder for Neovim, settings for Helix, an extension for
  Zed, a tree-sitter grammar for their colours, and how to use JetBrains' IDEs through LSP4IJ
  ([editors/README.md](editors/README.md)).
- **`ask for 64 bytes`** gives the input's next 64 bytes without waiting for a line's end, in programs moth
  builds.
- **A debugger in your editor.** A debug adapter for `moth debug` gives VS Code (*Moth: Debug this file*, or
  F5), Neovim, Helix and JetBrains' IDEs breakpoints, stepping, the calls in progress and the variables.
- **Libraries for a company's work.** `postgres.moth` and `mysql.moth` query PostgreSQL and MySQL over their
  own protocols, each value sent apart from the SQL, and `redis.moth` talks to Redis, all three on
  `wire.moth`. `s3.moth` keeps objects in S3 and the stores that speak its language, `jwt.moth` makes and
  checks JSON Web Tokens, `oauth.moth` signs a person in with OAuth 2 and PKCE, and `yaml.moth` reads and
  writes YAML. CI tests them against real PostgreSQL, MySQL, Redis and MinIO servers.
- **Fixes.** A package can use the standard library: `use "text.moth"` in a package, or in a file it uses,
  is moth's own `text.moth` unless the package has one, so a package no longer needs copies of its own.

## [1.11.0](https://github.com/samyyy2423/moth/releases/tag/v1.11.0) (2026-11-04)

A standard library like Python's, secure networking, every core at once, and a faster web.

- **The standard library goes everywhere.** moth carries it, so `use "json.moth"` works in any folder. New
  since 1.10: `http.moth`, `websocket.moth`, `sockets.moth` with TLS and IPv6, HTTPS for `server.moth`,
  `email.moth` (SMTP, POP3 and IMAP), `zip.moth`, `xml.moth`, `toml.moth`, `options.moth`, `log.moth`,
  `collections.moth`, `lists.moth`, `stats.moth`, `zones.moth`, `base64.moth`, `secrets.moth`, `big.moth`,
  `fractions.moth`, `sets.moth`, `images.moth`, `crypto.moth` and `charts.moth`.
- **The language.** Inputs a call can leave out, functions with no name, lists built from lists,
  `items 2 to 4 of xs`, `to the power of`, `rounded down` and `rounded up`, `remainder of 17 divided by 5`,
  `x with 2 decimals`, a record's own functions, lists as sets, `either way` (like Python's `finally`),
  inputs by name, unpacking, `match`, steps in `for each`, kinds with `give`, and how a kind is shown.
- **Every core at once.** `tools/cores.moth` shares a list's items out between copies of the program, a core
  each. `job has ended` asks whether a task is done, and `sync.moth` has locks, semaphores, flags and queues.
- **Tools.** `moth profile`, `moth coverage` and `moth notebook`. `moth debug` stops at a mistake. Packages
  can be asked for at a version (`github.com/someone/thing@v1.2`), and `moth search` reads a package index.
- **Shipping.** `moth build --web` makes a page that runs the program in a browser. `moth build --installer`
  makes a setup program, and `--sign` signs each program built.
- **More of C.** Small and unsigned whole numbers, structures by value, and callbacks from any thread.
- **A faster web.** The playground runs programs on WebAssembly GC where the browser has it, up to 5 times as
  fast as 1.10 on lists, records and text.
- **Fixes.** A task's thread could crash on a Linux computer with one core. The profiler reports however a
  program ends. Reading text a letter at a time no longer counts from the start each time.
- **License.** Moth is under the Apache License 2.0 from this release. Earlier releases stay under MIT.

## [1.10.0](https://github.com/samyyy2423/moth/releases/tag/v1.10.0) (2026-11-03)

C libraries, the system's own controls, a shell, tasks and faster machine code.

- **The Moth shell.** `moth` on its own reads Moth a line at a time.
- **C libraries.** `use the library "sqlite3" ... end` calls a C library's functions, with structures,
  callbacks and floats, on Windows and Linux (`--allow-libraries`). `tools/sqlite.moth` keeps a database.
- **The system's own controls.** `tools/windows.moth` (Windows) and `tools/linux.moth` (GTK), with
  `tools/ui.moth` picking the right one.
- **More tools.** `server.moth`, `tasks.moth`, `text.moth`, `dates.moth`, `system.moth`, `hash.moth`
  (SHA-256) and `game.moth`.
- **Tasks.** `set job to start count(10)` runs a call on a thread of its own, and `wait for job` gives what
  it returned.
- **Values in text.** `"Hi, {name}!"`, with any value inside the braces.
- **A value's own functions and fields.** `rex's bark()` is `bark(rex)`, and `rex's name` is `name of rex`.
- **`moth debug`** stops a built program before each line, on command.
- **Packages.** `moth add`, `get`, `update`, `remove` and `packages`, and `use the package "json"`. A package
  is a Git repository, pinned at its commit in `moth.packages`.
- **VS Code.** `editors/vscode`: colours, problems as you type, Quick Fixes, formatting, the outline, and
  Run, Debug and Build.
- **Shipping a program.** `moth build --icon app.png --version 1.2.0 --include data`.
- **Faster machine code.** Small functions are put in line, inputs go in registers, and lists, text and
  records are worked on where the code is. fib(32) takes 1.25 times C's time.

## [1.9.0](https://github.com/samyyy2423/moth/releases/tag/v1.9.0) (2026-10-30)

Apps with real controls, and a window on Linux.

- **A window on Linux.** Drawings and apps show in a window on any X server, Xwayland and WSLg included,
  with nothing to install. Linux has no clipboard, drawing pad or file boxes yet.
- **Checkboxes, text areas, lists, dropdowns and sliders**, with handlers for each.
- **Choosing a file.** `choose a file to open` (or `to save`).
- **Editing what's typed**: the cursor, selecting, and cut, copy and paste.
- **Sending and JSON.** `send data to "https://..."`, `with headers`, `x as json` and `json from`.
- **Faster records.** A record made in one go is one block of memory.
- **Fixed:** in the Windows window, a button's handler also ran every 10 ms as if it were a timer.

## [1.8.1](https://github.com/samyyy2423/moth/releases/tag/v1.8.1) (2026-10-30)

Security fixes for Windows. Update if you use 1.8 or earlier on Windows.

- **DLLs only from System32.** A file called `winhttp.dll`, `winmm.dll` or `gdiplus.dll` beside `moth.exe`,
  or beside a program it built, would have run inside it.
- **`run program` never runs a program from beside the running one.** A name with no folder is looked for in
  System32, then the Windows folder, then PATH, skipping empty entries.
- **No commands slipped into a batch file.** An argument to a `.bat` or `.cmd` file holding any of
  `" % ^ & | < > !` or a line break is refused, as cmd.exe would read it as a command (the same problem as
  Rust's CVE-2024-24576).
- **`load` reads very small and very large numbers** written with an exponent, in built programs.

## [1.8.0](https://github.com/samyyy2423/moth/releases/tag/v1.8.0) (2026-10-30)

The time, saving, sound, buttons and pictures, and all of Moth in machine code.

- **The time and waiting.** `the time`, `the date`, `the clock`, `wait 2 seconds` and the rest.
- **Putting things in order.** `scores in order`, `in reverse order`, and `people in order by age`.
- **Saving and loading.** `save scores to "scores.txt"` and `load "scores.txt"`.
- **Sound.** `play note "C4" for 0.5 seconds`, a pitch in hertz, and `play a beep`.
- **Buttons and text boxes**, with handlers for clicks and Enter.
- **Pictures from files.** `draw picture "cat.png" at 0, 0`, PNG or BMP.
- **All of Moth in machine code.** Units, tables, charts, colours, folders and going online.
- **`moth test` finds the tests itself** when no file is named.
- **Speed.** About as fast as C and Rust, except on function calls, and 10 to 200 times as fast as Python.

## [1.7.0](https://github.com/samyyy2423/moth/releases/tag/v1.7.0) (2026-10-30)

Drawing, random numbers and the whole moth command.

- **Drawing, apps and the handwriting pad in machine code**, in a window of their own on Windows.
- **Random numbers in machine code**, the same as the playground's for the same seed (`MOTH_SEED`).
- **The whole moth command.** `moth run`, `moth tidy`, `moth check` and `moth test`, written in Moth.
- **New phrases.** `say ... to the error output`, `stop the program with 2`, `run program ... with ...`
  (and `keeping its output`), and `remove the file`. `--allow-run` lets a program start another without
  asking.
- **`expect` in machine code.**
- **The naming trap, fixed.** A `set` in a function changes a variable outside it only if that variable is
  made above the function. This can change what an old program does.
- **Fixes.** `stop the program` in an app's handler ends the program. A file used as two names keeps both
  copies' functions.

## [1.6.0](https://github.com/samyyy2423/moth/releases/tag/v1.6.0) (2026-10-30)

Moth on its own: `moth` is a program of its own for Windows and Linux, which needs nothing else installed.

- **It builds itself.** `moth.moth` and `machine.moth`, made into machine code, are moth, and moth makes
  them again into exactly the same bytes. A Windows moth and a Linux moth build each other byte for byte.
- **Machine code takes nearly all of Moth**: functions inside functions and as values, files, `ask`,
  arguments and the `--allow` flags, and upper and lower case for every Unicode character.
- **A garbage collector.**
- **The handwriting network runs as a program of its own.**
- **Gone:** the Rust engine (`moth-native`) and the Node.js command line. Both are still in 1.5.1. The
  playground keeps its JavaScript engine.

## [starter-1](https://github.com/samyyy2423/moth/releases/tag/starter-1) (2026-10-29, pre-release)

The first standalone moth, built from commit 44c1dd5: a program of its own for Windows and Linux on x86-64
that compiles a Moth program into one, kept so that a moth can always build the next one.

## [1.5.1](https://github.com/samyyy2423/moth/releases/tag/v1.5.1) (2026-10-29)

Closes five gaps in asking before files and going online.

- **`use` stays in the program's folder**, and a link inside it that leads out is refused.
- **`moth test` asks** as `moth run` does, and takes the same `--allow` flags.
- **Programs made by `moth build` ask too**, with the flags given to the build built in.
- **Flags can name what they allow**: `--allow-read=data,notes.txt`, `--allow-write=out`,
  `--allow-net=example.com`. A file is checked where it really is.
- **Redirects are asked about**, ten at most.

## [1.5.0](https://github.com/samyyy2423/moth/releases/tag/v1.5.0) (2026-10-29)

Numbers and data the way people use them.

- **Numbers like a spreadsheet**, shown and compared to 15 significant digits, so `0.1 + 0.2` is `0.3`.
- **Units**: distances, times, weights and volumes, metric and imperial.
- **Tables and charts.** `read table "sales.csv"`, `total of`, `average of` and `draw chart of`.
- **Inputs that say what they are.** `to area with width as a number, ...` checks every call.
- **Asks before it touches your files.** A program asks before it reads a file, writes one or goes online,
  unless it was started with `--allow-read`, `--allow-write`, `--allow-net` or `--allow-all`. This changed
  how scripts run.
- **Reading websites.** `read "https://..."`.
- **Fix buttons** in the playground for misspelled names.

## [1.4.0](https://github.com/samyyy2423/moth/releases/tag/v1.4.0) (2026-10-29)

Moth without JavaScript.

- **moth-native**, Moth written again in Rust with no libraries, making the same bytecode as the JavaScript
  engines, and building into one WebAssembly file that needs only WASI.
- **Moth builds itself without JavaScript**: compiler.moth writes bytecode, byte for byte what the Rust
  compiler makes.
- **Bytecode files** (`.mothc`).
- **A new website** for the playground.

## [1.3.0](https://github.com/samyyy2423/moth/releases/tag/v1.3.0) (2026-10-29)

Apps: programs that answer keys, clicks and time.

- **Events and timers**: `when a key is pressed`, `when the mouse is clicked`, `every 100 milliseconds`.
- **More to draw with**: `move to`, filled boxes and circles, text, and `clear`.
- **Random numbers.**
- **The playground runs apps live**, with Snake and Paint as examples.
- **`moth build --web`** makes one HTML file that runs the program.

## [1.2.0](https://github.com/samyyy2423/moth/releases/tag/v1.2.0) (2026-10-29)

Tools for writing real programs.

- **Error trails** show the calls that led to a mistake.
- **`expect` and `moth test`.**
- **`moth fmt`**, and a Tidy button in the playground.
- **Faster WebAssembly** for bytes and dictionaries.
- **Real tools in `tools/`**: a Mandelbrot picture, a word counter and a JSON reader.
- **Fixed:** a built program names the right file for a mistake inside a file it uses.

## [1.1.0](https://github.com/samyyy2423/moth/releases/tag/v1.1.0) (2026-10-28)

What real programs need.

- **Catching mistakes** with `try ... if it fails with why ... end`.
- **Dictionaries**, `keys of`, and `x is in y`.
- **Modules**: `use "math.moth" as math`.
- **Files and arguments**: `read`, `read bytes`, `write ... to` and `arguments`.
- **Bytes and bits**: `100 bytes`, `bit and`, `shift x left by 2`, `0xFF` and `255 as hex`.

## [1.0.0](https://github.com/samyyy2423/moth/releases/tag/v1.0.0) (2026-10-28)

The first release: a programming language that reads like plain English, written from scratch in JavaScript.

- **The language**: variables, lists, records, functions and closures, `if`, `repeat`, `for each`, `stop`,
  `fail with`, text helpers, `ask`, `use` and turtle drawing, with mistakes explained in plain words.
- **Three engines that must agree**: a bytecode virtual machine, a JIT to JavaScript, and a WebAssembly
  compiler.
- **A compiler written in Moth** that compiles itself to exactly the JIT's JavaScript.
- **Neural networks written in Moth**, and a handwriting reader.
- **Tools**: a checker, a time-travel debugger, the playground, and the `moth` command.
