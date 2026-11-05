# Versions, and what they promise

Moth is something to depend on: a program written for Moth 1.0 should run on every Moth 1 that follows, and
a company should know, before it updates, what can change. This is the promise, and how Moth keeps it.

## One version number

Moth has one version, `MAJOR.MINOR.PATCH` (semantic versioning, [semver.org](https://semver.org)), for three
things that are released together, as one `moth` program:

- **the language**, as [SPEC.md](SPEC.md) describes it;
- **the standard library**, the files moth carries so that `use "json.moth"` works anywhere (`math.moth` and
  the libraries in `tools/`);
- **the `moth` command**: its commands, their flags, what they read and write, and the numbers they end
  with.

A release is tagged `vMAJOR.MINOR.PATCH` on GitHub (`v1.11.0`), with `moth-windows.exe`, `moth-linux` and
their SHA-256 sums, and, after 1.11.0, a .deb, an SBOM and a Sigstore signature for each file
([docs/verifying-releases.md](docs/verifying-releases.md)). `package.json` has the same number.

| Release | What it can have | Example |
|:--|:--|:--|
| patch, `1.11.1` | fixes only: bugs, security, documents | `load` reading `1e-7` in 1.8.1 |
| minor, `1.12.0` | anything new that keeps every 1.x program working | a new phrase, a new library, a new command |
| major, `2.0.0` | changes that can stop an old program working, each listed with what to do instead | taking away something deprecated |

A pre-release (`starter-1`, or a tag with `-rc.1` after it) promises nothing.

## What every 1.x release keeps working

From 1.11.0 on, a program that works on one 1.x release works on every later 1.x release, the same way:
it says the same things, writes the same files, ends with the same number and makes the same mistakes,
in the same places. In particular:

- **The language.** Everything SPEC.md calls guaranteed. Moth never reserves a new word in 1.x: a new
  phrase starts with a word that's still a name everywhere else (as `wait 2 seconds` and `run program`
  do), or is written where a program couldn't have anything before, so a line that worked before means
  what it meant. A name a program makes can be any name it could make before.
- **Numbers.** 15 digits, and the same results from the same sums, on every engine and system.
- **The standard library**, used `as` a name (`use "json.moth" as json`): every function its opening
  comment shows, or README.md documents, keeps its name, its inputs and what it does. A new function, or a
  new input with an `or`, can be added. A file's other functions are its own helpers, which can change.
  [The reference](https://samyyy2423.github.io/moth/docs/) shows each library's functions, its helpers left out.
  Used without `as`, a file's names are mixed in with the program's, and a name the file adds in a later
  release could collide with one of the program's, so use the standard library with `as`.
- **The moth command.** Each command and flag keeps doing what it does, and keeps the numbers it ends with:
  0 for success, 1 when something failed (a mistake, a test that failed, a package that changed), 2 when it
  didn't understand what it was asked, and for `moth run` whatever the program ended with.
- **Files moth reads**, which a later 1.x keeps reading: Moth source, `moth.packages`, `moth.sums`, the
  package index's JSON with its advisories, and what `save` writes. A file a later release writes can have
  something an earlier one doesn't know: 1.11 ignores `moth.sums`, and reads `moth.packages` as before.
- **The permission flags.** `--allow-read`, `--allow-write`, `--allow-net`, `--allow-run`,
  `--allow-libraries` and `--allow-all` keep their names and what they allow; what a program may do without
  them never grows in 1.x.
- **Built programs.** A program `moth build` makes is a file of its own that needs no moth, so it keeps
  running as it is; building it again with a later 1.x gives a program that does the same.
- **Systems.** x86-64 Windows 10 (version 1607) and later, and x86-64 Linux; going online on Linux needs
  `curl`, and a C library glibc's dynamic linker. Moth 1 won't drop either system.

### What isn't promised

- **Implementation details**, which SPEC.md marks: speed, memory, limits like how deep a function can call
  itself, the bytes a build makes, and the playground's engines.
- **The words** of a mistake, and of what moth prints. A program should tell its mistakes apart by what it
  gave `fail with`, and a script should go by moth's exit code, not its words. A release can make a
  message clearer at any time.
- **What `moth check` and `moth tidy` find or change.** The checker can learn to find more, so a file
  `moth check` passed can get a warning; `moth tidy` can tidy something it left before. Neither changes
  what a program does.
- **The playground** at samyyy2423.github.io/moth, which runs the newest code on GitHub, not a release.
- **Bugs.** Where moth does something SPEC.md says it doesn't, that's a bug, and a release fixes it, even if
  a program depended on it. The changelog says so.
- **Security fixes.** If keeping something working would leave a hole, the hole is closed, in a patch
  release if it must be. 1.5.1 did that: `use "../secret.txt"` had read a file outside the program's folder,
  and since then it's refused. The changelog and [SECURITY.md](SECURITY.md) say what changed and what to
  do.
- **Packages.** A package's own versions are its own, kept by its tags. `moth.packages` pins each one's
  commit, and `moth.sums` its files, so updating moth never changes a package.

## Deprecating and removing

Nothing is taken away in 1.x. When something should go, because a better way has come or it can't be kept
safe:

1. **A minor release deprecates it.** The changelog lists it under "Deprecated", with what to use instead;
   SPEC.md and README.md mark it; and from that release, `moth check` and `moth build` say so, with the line
   and the replacement, as a warning that doesn't stop the build.
2. **It keeps working through every 1.x release**, as it did.
3. **The next major release can take it away**, no sooner than six months after it was deprecated. Its
   notes list everything taken away, each with what to write instead, and `moth check` from the last 1.x
   finds each use of them.

The same goes for a standard library function, a command, a flag, and a field in a file moth reads.

## Which releases get fixes

| Release | Bug fixes | Security fixes |
|:--|:--|:--|
| the newest 1.x minor release (now 1.11) | yes | yes |
| the minor release before it (now 1.10) | no | for 90 days after the newer one came out |
| older 1.x releases | no | no |
| the last 1.x, once 2.0 is out | no | for 12 months after 2.0 |

A fix comes as a patch release of the newest minor (`1.11.1`), and, for a security fix, of the one before
it while it's covered (`1.10.1`). Since every later 1.x keeps a 1.x program working, the fix for anything
else is to update. [SECURITY.md](SECURITY.md) says how to report a vulnerability.

## Before 1.11

1.0 to 1.10 came out before this promise, in the days Moth was first growing, and some of them changed what
a program did: 1.5 made programs ask before files, 1.5.1 kept `use` in the program's folder, and 1.7 fixed
the naming trap (a function's `set` of a name made below it). The [changelog](CHANGELOG.md) says where.
From 1.11, the promise holds.
