<div align="center">

<h1>Moth</h1>

<p><b>A programming language that reads like plain English.</b><br>
Built from scratch, with no dependencies, into programs for Windows and Linux as fast as C.</p>

<p>
<a href="https://samyyy2423.github.io/moth/"><b>Open the playground</b></a>
&nbsp;·&nbsp;
<a href="https://samyyy2423.github.io/moth/learn.html">Learn Moth</a>
&nbsp;·&nbsp;
<a href="#the-language">The language</a>
&nbsp;·&nbsp;
<a href="DESIGN.md">How it's built</a>
&nbsp;·&nbsp;
<a href="https://github.com/samyyy2423/moth/releases/latest">Download</a>
&nbsp;·&nbsp;
<a href="CONTRIBUTING.md">Help with it</a>
</p>

<p>
<a href="https://github.com/samyyy2423/moth/actions/workflows/test.yml"><img src="https://github.com/samyyy2423/moth/actions/workflows/test.yml/badge.svg" alt="tests"></a>
<a href="https://github.com/samyyy2423/moth/releases/latest"><img src="https://img.shields.io/github/v/release/samyyy2423/moth?color=4f8ff7" alt="latest release"></a>
<img src="https://img.shields.io/badge/dependencies-none-2ea043" alt="no dependencies">
<a href="LICENSE"><img src="https://img.shields.io/github/license/samyyy2423/moth?color=6e7681" alt="Apache 2.0 license"></a>
</p>

<img src="docs/handwriting.gif" width="760" alt="Drawing digits in the playground: a 2, a 7 and a 5, and a neural network written in Moth reads each one">

<sub>A neural network written in Moth, reading digits drawn in the playground.</sub>

</div>

<br>

Moth reads the way you'd say it out loud. It's small enough to learn in an
afternoon, and built like a real language underneath: a compiler written in Moth
itself that makes Windows and Linux programs as fast as C, three engines in the
browser that must agree with it on every result, a debugger that runs backwards,
and a standard library from web servers and databases to pictures and encryption.

<table>
<tr>
<th width="58%">Moth</th>
<th>What it says</th>
</tr>
<tr>
<td valign="top">

```
set fruits to list of "apple", "pear"
add "mango" to fruits

for each fruit in fruits
    say "I like " fruit
end

to area with width and height
    return width * height
end
say "3 by 4 is " area(3, 4)
say item 5 of fruits
```

</td>
<td valign="top">

```text
I like apple
I like pear
I like mango
3 by 4 is 12

line 12: there is no item 5,
the list only has 3 items
```

</td>
</tr>
</table>

<table>
<tr>
<td width="50%" valign="top"><img src="docs/debugger.png" alt="The playground's time-travel debugger, halfway through drawing a tree: the line about to run highlighted, the tree half drawn, and the variables of eight nested calls"></td>
<td width="50%" valign="top"><img src="docs/checker.png" alt="The checker in the playground: wavy lines under five mistakes, listed under Problems, found without running the code"></td>
</tr>
<tr>
<td valign="top"><b>A debugger that goes backwards.</b> It records the whole run, so a slider moves through it either way, showing every variable as it was.</td>
<td valign="top"><b>Mistakes found as you type.</b> Wavy lines mark code that will fail, in the same words as the error it would stop with.</td>
</tr>
</table>

## Start in a minute

**In your browser:** open the [playground](https://samyyy2423.github.io/moth/),
write Moth and press Run, or [learn Moth in an afternoon](https://samyyy2423.github.io/moth/learn.html):
eleven short lessons, each with a program to run and change. There's nothing to
install.

**On your computer:** download Moth from the
[latest release](https://github.com/samyyy2423/moth/releases/latest), one file
with nothing else to install: `moth-windows.exe`, saved as `moth.exe`, or
`moth-linux`, saved as `moth` (then `chmod +x moth`).

```text
moth run hello.moth          runs a program
moth build hello.moth        makes hello.exe (hello on Linux), a program of its own
moth                         the Moth shell: Moth a line at a time
```

<p align="center"><img src="docs/build.gif" width="760" alt="A terminal: fib.moth, a Fibonacci function in plain English, is built by moth build into fib.exe, which works out fib(32) in 16 ms; the same program in Python takes 341 ms"></p>

[The language](#the-language) has all of Moth on one page, and
[CONTRIBUTING.md](CONTRIBUTING.md) says how to help.

## What makes it different

**Numbers and data the way people use them.** Arithmetic is shown and compared
like a spreadsheet, to 15 significant digits, so `0.1 + 0.2` is `0.3`. A number
can carry a unit, and Moth keeps the units straight. A CSV file is one line
away from a table you can filter, total and chart. And a program asks before it
touches your files or goes online.

<table>
<tr>
<th width="58%">Moth</th>
<th>What it says</th>
</tr>
<tr>
<td valign="top">

```
say 0.1 + 0.2 is 0.3
set trip to 5 km + 300 m
say trip " = " trip in miles
say 2 hours + 30 minutes in minutes

set sales to read table "sales.csv"
for each row in sales where price of row is greater than 10
    say name of row
end
say total of price in sales
draw chart of price in sales
say trip + 1 hour
```

</td>
<td valign="top">

```text
yes
5.3 km = 3.29326731885787 miles
150 minutes

Big, red melon
15.75
(a bar chart, saved as an SVG)

line 12: can't use '+' on
a distance and a time
```

</td>
</tr>
</table>

**Engines that agree.** Every program can run on a bytecode virtual machine, on
a JIT that compiles it to JavaScript, or as WebAssembly that Moth writes byte by
byte, and [`moth build`](#command-line) turns it into machine code: a program of
its own. All of them must say, draw and fail exactly alike, and thousands of
randomly broken programs check that they do on every push:

| `npm run bench` | VM | JIT | WebAssembly | Machine code |
|:--|--:|--:|--:|--:|
| a program that only starts | 0.1 ms | 0.1 ms | 3.5 ms | 8.3 ms |
| fib(25), function calls | 64 ms | 8.9 ms | **7.4 ms** | 9.0 ms |
| a million-round loop | 59 ms | 8.1 ms | **3.9 ms** | 8.3 ms |
| primes up to 5,000 | 142 ms | 19 ms | **18 ms** | 22 ms |
| 200,000 records | 92 ms | 18 ms | **7.3 ms** | 19 ms |
| a million bytes, filled and summed | 402 ms | 94 ms | **38 ms** | **38 ms** |
| 200,000 words counted in a dictionary | 102 ms | 29 ms | 24 ms | **18 ms** |

Machine code is timed from start to finish, starting up included, which is most
of these short runs on Windows (the first row); the others inside a program
that's already running. With work big enough that starting up hardly counts, and
taken off, machine code is the quickest of them at all of these but making
records, which WebAssembly doesn't make at all when they don't outlive the loop:

| `npm run bench -- --big` | JIT | WebAssembly | Machine code |
|:--|--:|--:|--:|
| 2,000,000 records, made and read | 169 ms | **57 ms** | 62 ms |
| a list: 3,000,000 added, then summed | 118 ms | 71 ms | **32 ms** |
| a list: `for each` over 3,000,000 | 144 ms | 68 ms | **34 ms** |
| `set item` 5,000,000 times | 234 ms | 101 ms | **24 ms** |
| 2,000,000 words counted in a dictionary | 265 ms | 236 ms | **90 ms** |
| 300,000 records in a list | 110 ms | 79 ms | **32 ms** |
| 200,000 pieces of text joined | 44 ms | 52 ms | **18 ms** |

**A compiler written in Moth.** [`compiler.moth`](compiler.moth) is 2,400
lines of Moth that compile any Moth program, itself included, to exactly the
JavaScript the JIT writes, byte for byte. Compiled by itself, it compiles itself
again, and again, to the same result, which `npm test` checks three stages deep.

**Machine code, from Moth alone.** [`machine.moth`](machine.moth) is a third
back end, written in Moth: it turns a program into a Windows `.exe` or a Linux
program, writing every x86-64 instruction and the file around them byte by
byte, with no assembler, linker or other compiler. So far it takes numbers,
yes, no and nothing, text, lists, records, dictionaries, bytes, variables,
`say`, `if`, the loops, functions (made inside functions and passed around as
values too), `try`, `read` and `write`, `ask`, `arguments`, and the helpers,
which is enough for [`math.moth`](math.moth) and the handwriting network. What
it makes does exactly what the JavaScript engine does, down to how a number is shown, how
two numbers compare to 15 digits, how text sorts, the calls a mistake lists,
and asking before it reads or writes a file, unless `--allow` flags given to
`moth build` let it:

```text
$ moth build fib.moth
compiled fib.moth to machine code for Windows -> fib.exe (50,176 bytes)
$ ./fib.exe
832040
```

Against C, Rust and Python, with the same four programs written in each
([`versus/`](versus)), every one timed from start to finish, it's about as fast
as C and Rust on primes and decimal maths, as fast as C on a plain loop (which
Rust does three times as fast again), 1.25 times as slow as C on function calls
and 1.4 times as slow as Rust, and 20 to 300 times as fast as Python:

| `npm run versus` | C | Rust | Moth, machine code | JavaScript engine | Python |
|:--|--:|--:|--:|--:|--:|
| fib(32): 7 million calls | 20 ms | 18 ms | 25 ms | 281 ms | 521 ms |
| adding 1 to 100,000,000 | 36 ms | 10 ms | 37 ms | 767 ms | 11.1 s |
| primes up to 300,000 | 71 ms | 71 ms | 72 ms | 262 ms | 2.2 s |
| 30,000,000 steps of decimal maths | 48 ms | 51 ms | 49 ms | 357 ms | 4.6 s |

On Windows 11, with MSVC's `cl /O2`, `rustc -O` (Rust 1.89) and Python 3.13,
each program run once to warm up, which Windows' virus checker would otherwise
be timed looking it over. Moth still keeps its
promises in these: numbers are decimals compared to 15 digits, and every step
that could go wrong is checked. machine.moth gets there by knowing, as it
writes the code, what each variable is sure to hold, and leaving out the
checks that can't fail; by working out, across the whole program, what each
function is always given and always gives back, so a call needs no checks
either, and putting a small function's code in line where it's called; by
keeping a loop's busiest variables in the processor's registers; and by running a loop that only works out whole
numbers as 64-bit whole numbers, which goes back to decimals the moment a sum
gets too big to be exact.

**Is Moth standalone yet?** Yes. [`moth.moth`](moth.moth) is Moth's command
line, written in Moth: it reads a program and the files it uses, compiles it
with machine.moth and writes the program it makes. Made into machine code, it's
`moth.exe` (`moth` on Linux), which needs neither JavaScript nor Rust, nor any
other compiler, and builds itself into exactly the bytes Node.js built it into,
in about 9 seconds:

```text
$ moth build moth.moth --allow-read --allow-write --allow-run --include moth-debugger.moth
compiled moth.moth to machine code for Windows -> moth.exe (19,166,208 bytes)
$ moth build tools/wordcount.moth --allow-read
compiled tools/wordcount.moth to machine code for Windows -> tools/wordcount.exe (90,112 bytes)
$ tools/wordcount.exe tools/story.txt 3
290 words, 107 different ones
the  ██████████████████████████████ 45
and  █████████████ 20
it   ███████ 11
```

It builds for the system it runs on, or the other one with `--target windows`
or `--target linux`, and a Linux moth.exe and a Windows one build each other
byte for byte too. The first one comes from Node.js
(`node bootstrap.mjs`) or from
[the releases](https://github.com/samyyy2423/moth/releases); after that, each
builds the next. It takes nearly all of Moth, units, tables, charts, drawing and
apps included. A program that draws shows its picture in a window when it ends,
and an app runs in one, on Windows and on Linux, where the program speaks X11
itself; on Windows a question that starts with "Draw" opens a pad to draw the
answer on, so `moth build handwriting.moth` makes the handwriting demo a program
of its own.

**Neural networks, written in Moth.** [`neural.moth`](neural.moth) learns to
tell apart two moons of dots, after Andrej Karpathy's
[micrograd](https://github.com/karpathy/micrograd): every number it works out is
a record that remembers how it was made, so backpropagation can trace each
weight's share of the blame. Moth has no sine or `exp`, so
[`math.moth`](math.moth) writes them in Moth too, with random numbers that come
out the same every run. From 50% right to 100% in 60
steps:

<p align="center"><img src="docs/neural.svg" width="560" alt="Four pictures of what the network believes: before training it calls almost everything blue; at step 8 and step 20 the boundary bends between the moons; at the end it wraps around both moons exactly. Below, the loss falls from 1.17 to 0.006."></p>

<details>
<summary>Backpropagation, in Moth</summary>

```
for each i from 1 to count
    set v to item (count - i + 1) of order
    set g to grad of v
    set left to a of v
    if op of v is "+"
        set right to b of v
        set grad of left to grad of left + g
        set grad of right to grad of right + g
    else if op of v is "*"
        set right to b of v
        set grad of left to grad of left + data of right * g
        set grad of right to grad of right + data of left * g
    else if op of v is "relu" and data of v is greater than 0
        set grad of left to grad of left + g
    end
end
```

</details>

**It reads your handwriting.** The network at the top of this page learned
from digits Moth drew itself: there's no dataset.
[`digit-shapes.moth`](digit-shapes.moth) holds each digit as pen strokes and
bends them at random, [`digits.moth`](digits.moth) turns strokes into 16×16
pictures and runs the network, and [`digits-train.moth`](digits-train.moth)
trains it on 3,000 pictures in about 5 seconds, then writes what it learned as a
Moth file: 99% right on drawings it hadn't seen.

```bash
moth build digits-train.moth
digits-train > digits-model.moth
```

**Real tools.** [`tools/`](tools) holds programs that do real work with files,
bytes and dictionaries:

<p align="center"><img src="docs/mandelbrot.png" width="560" alt="The Mandelbrot set: a black shape like a beetle, edged with a glow that goes from deep blue to bright cyan, drawn by picture.moth"></p>

- [`picture.moth`](tools/picture.moth) draws the Mandelbrot set above and writes
  it as a BMP file, byte by byte, the header's numbers put together with bit
  operations.
- [`wordcount.moth`](tools/wordcount.moth) counts the words in any file:

  ```text
  $ moth build wordcount.moth --allow-read
  compiled wordcount.moth to machine code for Windows -> wordcount.exe (90,112 bytes)
  $ wordcount story.txt 4
  290 words, 107 different ones
  the   ██████████████████████████████ 45
  and   █████████████ 20
  it    ███████ 11
  moth  ██████ 10
  ```
- **The standard library:** math.moth and the libraries below (not the
  example programs) are built into moth, so `use "json.moth"` works in any
  folder; a file of that name beside the program comes first.
  [`stdlib.moth`](stdlib.moth) holds them, made by `node make-stdlib.mjs`.
- [`json.moth`](tools/json.moth) reads JSON into dictionaries and lists, `\u`
  escapes and emoji included, and [`json.test.moth`](tools/json.test.moth)
  tests it, with Moth's own test runner, on every push.
- [`sqlite.moth`](tools/sqlite.moth) keeps a database in a file through SQLite
  itself, the library Windows and most Linux systems come with: `open`, `run`
  and `query`, each row a dictionary, with `?`s for values.
- [`text.moth`](tools/text.moth) finds, checks and replaces patterns (regular
  expressions, with groups, `|`, counts and `\b`), writes numbers with so many
  decimals (`number_text(3.14159, 2)`) or with commas (`grouped(1234567)`),
  pads text to a width, and reads and writes CSV; and
  [`dates.moth`](tools/dates.moth) reads, adds, counts and writes dates:
  `format_date(d, "dddd D MMMM YYYY")`. Both are in Moth alone, so they work
  on every engine, the playground's too, and test themselves.
- [`server.moth`](tools/server.moth) answers with HTTPS too:
  `serve_secure(443, answer, "cert.pem", "key.pem")`, through OpenSSL 3
  (Linux's own; on Windows, its two DLLs beside the program, such as
  Python's or Git's), and reads bodies sent in chunks.
- [`cores.moth`](tools/cores.moth) does a list's items on every core at once,
  as Python's multiprocessing does: `cores's each_at_once(work, items)`, in
  copies of the program, each a process of its own, sharing the items out in
  turn so slow ones spread evenly; a `cores's work_here(work)` line after the
  functions makes a copy start on its part at once. Workers (`start work(x) on
  another core`) do the same inside one program.
- [`sockets.moth`](tools/sockets.moth) talks over a network as Python's
  `socket` does: `connect("example.com", 80)`, `listen(9000)` and `accept`,
  `send`, `receive`, `receive_line`, `receive_all`, `finish_sending`,
  `wait_at_most` a time, and UDP messages, on Windows' and Linux's own
  sockets, over IPv4 and IPv6 (`listen_on("::", 9000)`). Connections can be
  secure, as Python's `ssl` makes them: `connect_secure("example.com", 443)`
  checks the certificate against the system's own, `secure(c, host)` makes
  one secure after it began (STARTTLS), and `secure_as_server` is the other
  end. `ready(sockets, ms)` says which of many have something to take, as
  `select` does; with tasks, too, one program can talk to many at once.
- [`http.moth`](tools/http.moth) asks web servers as Python's
  `urllib.request` (and the requests package) do: any method, headers of its
  own, bodies of text, bytes or JSON, redirects followed, and answers in
  chunks or gzipped, over HTTP and HTTPS: `http's request("PUT", url, body,
  headers)`, `get`, `post`, `put`, `patch`, `delete`, `get_json`, `check`.
- [`websocket.moth`](tools/websocket.moth) keeps a connection open with a web
  page or another program and carries messages both ways (RFC 6455), as
  both ends: `ws's connect("ws://host:9000/chat")`, `listen` and `accept`,
  `send`, `receive`, `ping` and `close`, over ws:// and wss://.
- [`email.moth`](tools/email.moth) sends mail as Python's `smtplib` and
  `email` do: `mail's message(sender, recipients, subject, text)`, with cc,
  bcc, a page of HTML and files (`attach`), in MIME with UTF-8 headers,
  through a server over SMTP, secure from the start (465) or after
  STARTTLS (587), logged in: `mail's log_in(server, user, password)`, then
  `mail's send(server, m)`. It reads mail too, as `email`, `poplib` and
  `imaplib` do: `read_message(raw)` (MIME, base64 and quoted-printable,
  UTF-8 and Latin-1, encoded headers), and mailboxes over POP3
  (`pop_open`, `pop_count`, `pop_get`, `pop_delete`) and IMAP
  (`imap_open`, `imap_folders`, `imap_select`, `imap_search`, `imap_get`,
  `imap_mark`).
- [`postgres.moth`](tools/postgres.moth) talks to PostgreSQL as Python's
  `psycopg` does, over its own protocol: logged in with SCRAM-SHA-256 or MD5,
  over TLS where asked for, `pg's query(db, "select name from people where
  age > $1", list of 21)` with each value sent apart from the SQL, so none is
  ever read as SQL, rows as dictionaries with each column's type (numbers,
  yes and no, bytes, JSON, arrays), `execute`, `in_transaction(db, work)` and
  `run_script`. [`mysql.moth`](tools/mysql.moth) does the same for MySQL and
  MariaDB, as `PyMySQL` does: `caching_sha2_password` or `sha256_password`
  (the password sent RSA-encrypted where there's no TLS) or
  `mysql_native_password`, and prepared statements with `?`. Both are tested
  against real servers.
- [`redis.moth`](tools/redis.moth) talks to Redis (and Valkey) as Python's
  `redis` does: `get`, `put`, `put_for` a time, `increment`, lists, hashes,
  `keys_like`, any `command`, a `pipeline` of many sent at once, `transaction`
  (MULTI and EXEC), `publish`, `subscribe` and `next_message`, logged in and
  over TLS, in RESP2 or RESP3. All three speak through
  [`wire.moth`](tools/wire.moth): bytes read from a connection a line, a count
  or a number at a time, and written the same way.
- [`s3.moth`](tools/s3.moth) keeps objects in Amazon S3 and the stores that
  speak its language (MinIO, Cloudflare R2, Backblaze B2), as `boto3` does:
  `put_object`, `get_object`, `head_object`, `list_objects` (every page),
  `delete_object`, buckets made and removed, and `presigned_url`s anyone can
  use for a while, each request signed with AWS Signature Version 4, checked
  against AWS's own published signatures and a real MinIO.
- [`jwt.moth`](tools/jwt.moth) makes and checks JSON Web Tokens as `PyJWT`
  does: HS256, HS384 and HS512, and RS256, RS384 and RS512 checked with a PEM
  key, a certificate or a JWK; expiry, not-before, issuer and audience
  checked; and a token's `none` or a switch from RSA to HMAC turned down.
  [`oauth.moth`](tools/oauth.moth) is an OAuth 2 client: `sign_in` with the
  authorization code flow and PKCE, a server of the program's own on
  127.0.0.1 for the browser to come back to, as command-line tools do;
  `client_credentials`; `refresh`; and `discover` for OpenID Connect.
- [`zip.moth`](tools/zip.moth) squeezes bytes and back as gzip and .zip files
  do (DEFLATE, with codes made for each block as zlib's are), and makes and
  reads zip archives, in Moth alone: what it makes, zlib, Python and `tar`
  read, and it reads what they make.
- [`images.moth`](tools/images.moth) reads and writes pictures, as Pillow
  does: PNG of every kind and baseline JPEG, each pixel's red, green, blue and
  opacity, `png_of`, `jpeg_of(image, 85)`, and `cropped`, `resized`,
  `flipped` and `grey`, checked against Pillow pixel by pixel;
  [`charts.moth`](tools/charts.moth) saves bar charts, line charts and a bar
  split into parts as SVG or PNG (`charts's save(chart, "sales.png")`), with
  a legend, clean axis numbers and colours that stay apart for colour-blind
  eyes.
- [`crypto.moth`](tools/crypto.moth) encrypts, as Python's `cryptography`
  does with AESGCM: AES-128, 192 or 256 in GCM, so a changed byte or a wrong
  key is found out; `encrypt(key, message)` with a fresh nonce each time,
  `new_key()`, and `key_from_password` through PBKDF2, matching Python's
  `cryptography` on every case tried.
- [`xml.moth`](tools/xml.moth) reads XML into records, each element's name,
  attributes and what's inside it, finds elements by name, and writes them
  back, in Moth alone, read the same as Python's ElementTree reads it.
- [`big.moth`](tools/big.moth) works with whole numbers of any size, kept as
  text, so `say` shows them and `is` compares them: `big's times(f, 30)`,
  `plus`, `minus`, `divided`, `remainder`, `power` and `compare`, and, as
  Python's `math` has them, `gcd`, `lcm`, `square_root`, `factorial`,
  `choices`, `power_mod` and bases 2 to 36, in Moth alone, tested against
  JavaScript's BigInt; [`fractions.moth`](tools/fractions.moth) keeps
  fractions exactly, as Python's `fractions` does: `"1/3"` plus `"1/6"` is
  `"1/2"`, and `as_decimal` writes one to any number of places.
- [`hash.moth`](tools/hash.moth) gives a text's or bytes' SHA-256, SHA-224,
  SHA-512, SHA-384, SHA-1 or MD5, HMAC with any of them, and PBKDF2, as
  Python's `hashlib` and `hmac` do, in Moth alone;
  [`base64.moth`](tools/base64.moth) writes bytes in base64 (and its URL-safe
  kind) and base32, and back; and [`secrets.moth`](tools/secrets.moth) gives
  bytes, tokens and numbers no one can guess, from the system, as Python's
  `secrets` does.
- [`collections.moth`](tools/collections.moth) counts things, and has a queue
  quick at both ends, a heap that gives the smallest first, and a sorted
  list kept sorted, as Python's `collections`, `heapq` and `bisect` do;
  [`lists.moth`](tools/lists.moth) goes through lists as `itertools` and
  `functools` do: chunks, windows, pairs, every choice and ordering,
  running totals, folding, sorting by a function; and
  [`stats.moth`](tools/stats.moth) has `statistics`' means, medians, modes,
  spread, quantiles, correlation and a straight line through points.
- [`arrays.moth`](tools/arrays.moth) is NumPy's arrays: numbers in a shape,
  and maths on all of them at once, with broadcasting, `matmul`, sums, means
  and the largest along an axis, reshaping, slicing, transposing and softmax.
  In a program moth builds, loops in machine code do the work and give
  exactly what Moth's own give; `arrays's use_blas()` sends matmul through
  OpenBLAS where it's installed.
- [`onnx.moth`](tools/onnx.moth) runs a model trained in PyTorch, or anything
  else that saves ONNX, through ONNX Runtime (Windows 11 has it; elsewhere,
  from its releases): `onnx's run(model, dictionary where "X" is x)`, arrays
  in and arrays out.
- [`python.moth`](tools/python.moth) runs Python inside the program, CPython
  through its C API: code, and the modules installed (NumPy, scikit-learn,
  anything), with numbers, text, lists and dictionaries going across as each
  other, arrays as NumPy's, and Python's mistakes as Moth's.
- [`ai.moth`](tools/ai.moth) asks large language models: Claude through
  Anthropic's Messages API, OpenAI's models, and any server that speaks
  OpenAI's API, such as Ollama. Answers, or each piece as it's written,
  tools the model uses (Moth functions), answers in JSON of a shape you
  give, embeddings, and a search of them by cosine similarity. Keys come only
  from `ANTHROPIC_API_KEY` and `OPENAI_API_KEY`.

  ```text
  use "ai.moth" as ai
  set claude to ai's anthropic("claude-opus-5-5")
  say ai's answer(claude, "Name three moths.")
  set quick to ai's anthropic("claude-haiku-5-5")
  to as_written with piece
      say piece
  end
  ai's stream(quick, "Write a haiku about a moth.", as_written)
  ```
- [`sets.moth`](tools/sets.moth) is Python's set: each thing once, found at
  once, with `union`, `both`, `only_in` and `in_one`, shown as `{1, 2, 3}`;
  it holds numbers and text, as a dictionary's keys can be.
- [`sync.moth`](tools/sync.moth) keeps tasks in step, as Python's `threading`,
  `queue` and `concurrent.futures` do: a lock one task holds at a time, a
  semaphore a few can, a flag tasks wait to see raised, a queue that one task
  sends to and another takes from, waiting while it's empty or full, each with
  a time to give up after, and `run_each(f, things)`, a task for each thing.
- [`zones.moth`](tools/zones.moth) knows the world's time zones, as
  `zoneinfo` does: what time it is in "Asia/Kolkata", with summer time,
  and the moment a time in a zone is, from Windows' own zones or Linux's
  zoneinfo files.
- [`yaml.moth`](tools/yaml.moth) reads the YAML that CI, Kubernetes and
  Docker Compose files are written in, as `yaml.safe_load` does, with YAML
  1.2's types: block and flow style, quotes and escapes, `|` and `>` text,
  comments, documents, anchors, aliases and `<<` merges; and `yaml_of` writes
  it back. It reads the YAML spec's own examples as PyYAML does.
- [`toml.moth`](tools/toml.moth) reads TOML settings files (pyproject.toml,
  Cargo.toml) as Python's `tomllib` does, and writes them;
  [`options.moth`](tools/options.moth) reads a program's command line as
  `argparse` does: options with values, flags, names in order, `--help`;
  and [`log.moth`](tools/log.moth) writes what happened as `logging` does,
  at levels, with the time, to the error output or a file.
- [`system.moth`](tools/system.moth) copies, moves and removes files, makes
  and removes folders, says whether a name is a file or a folder, how big a
  file is and when it changed, adds to the end of a file, reads and sets
  environment variables, and knows the current, home and temporary folders,
  on Windows and Linux.
- [`windows.moth`](tools/windows.moth) makes Windows' own windows and controls,
  written in Moth on user32.dll: buttons, labels, text boxes and areas,
  checkboxes, lists, dropdowns, menus with their keys (`"Save\tCtrl+S"`),
  tabs, tables, progress bars, pictures from PNG and JPEG files, drawings the
  program paints (shapes, lines and words) and clicks on them, timers, message
  boxes and the Open and Save boxes, in Windows' modern look,
  sharp on a screen set larger than 100%. Each calls a function of the
  program's when something happens to it.
- [`linux.moth`](tools/linux.moth) has the same functions on Linux, through
  GTK 3, in the desktop's own theme, and [`ui.moth`](tools/ui.moth) picks
  between the two as the program starts, so a program that uses it works on
  both.
- [`server.moth`](tools/server.moth) is a web server: `web's serve(8080, answer)`
  gives each request (its method, path, query, headers and body) to a function
  of the program's, which gives back a page, JSON, a file, or a record with its
  status, body, type and headers, on Windows' and Linux's own sockets. It
  serves many connections at once on one thread, so a slow client holds up no
  one, keeps them open for the next request (HTTP/1.1 keep-alive), and has
  limits on how long a request takes to arrive and how big it is
  (`set_timeout`, `set_idle_timeout`, `set_most_bytes`, `set_most_connections`);
  `web's serve_on_workers(8080, answer, 4)` answers on 4 workers, each on a
  core of its own (0 for one a core).
- [`tasks.moth`](tools/tasks.moth) runs work in the background: another
  program, or this one again with other arguments (`start_self`), left to run
  while the program, or its window, goes on; `done` says whether it has ended
  without waiting, and `output_of` and `code_of` what it said and ended with.
- [`game.moth`](tools/game.moth) is for games, on Windows and Linux: a window
  drawn again about 60 times a second, `update(seconds)` then `show(canvas)`
  each frame, the keys held (`key_down("Left")`), the mouse, pictures from
  PNG files drawn at any size, and WAV sounds; [`catch.moth`](tools/catch.moth)
  is a game made with it.
- [`notes.moth`](tools/notes.moth) is a notepad made with ui.moth, in under 120
  lines, on Windows and Linux: New, Open, Save and Save as, with their keys, a
  `*` in the title while a note isn't saved, and a question before one is lost.

  ```text
  $ moth build tools/notes.moth --allow-libraries --allow-read --allow-write
  ```

## The language

```
# comments start with #
set name to "Moth"                  # store a value
set fruits to list of "apple", "pear"
add "mango" to fruits               # add to a list, a number, or text
set item 1 of fruits to "kiwi"      # items are counted from 1

say "Hi, " name "!"                 # say joins the pieces exactly as written
set greeting to "Hi, {name}!"       # or put a value in text: a { before a letter or ( starts one
say "{length of fruits} fruits: {join fruits with ", "}"   # a value can have text in it too
say "{(2 * 3)} \{not a value}"      # \{ is a { itself, and so is one before anything else
say "I have " length of fruits " fruits"

if length of fruits is greater than 2
    say "lots of fruit"
else if fruits is empty list
    say "no fruit"
else
    say "some fruit"
end

repeat 3 times
    say "hip hip hooray"
end

set n to 1
repeat while n is less than 100
    set n to n * 2
end

for each fruit in fruits
    say fruit
end
for each i from 1 to 100
    if i is divisible by 7
        stop                        # leave the loop
    end
end
for each i from 10 to 1 by -2       # 10, 8, 6, 4, 2: a step, as Python's range has
    say i
end

match command                       # the first `when` that fits runs
    when "go", "walk"
        say "going"
    when is greater than 100        # any of is's comparisons
        say "a big number"
    else
        say "what?"
end

to area with width and height       # make a function
    return width * height
end
say "area: " area(3, 4)             # use it inside a value with brackets
to circle_area with r as a number   # an input can say what it is: each call checks
    return 3.14159 * r * r
end
to oldest with pets as a list of dogs gives a dog   # and say more, which moth check holds the code to
    return item 1 of pets
end

to greet with person
    say "Hello, " person
end
greet "Sam"                         # or call it on its own line
to welcome with person, greeting or "Hello"   # an input a call can leave out
    say greeting ", " person
end
welcome("Ana")                      # Hello, Ana
welcome("Bo", greeting "Hi")        # an input given by its name: Hi, Bo

kind dog with name, sound or "woof"   # a kind: dog("Rex") makes one, a record
    to speak with self                # each dog's own: rex's speak()
        return self's name + " says " + self's sound
    end
end
set rex to dog("Rex")
say rex's speak()                   # Rex says woof
kind puppy with name from dog(name, sound "yip")   # one kind made from another
    to speak with self
        return dog's speak(self) + "!"   # the kind it's made from's own
    end
end
say kind of puppy("Bit")            # puppy

to squares_to with n
    for each k from 1 to n
        give k * k                  # a value given, one at a time
    end
end
say squares_to(4)                   # [1, 4, 9, 16]: all it gave, as a list

set a, b to 1, 2                    # several names at once
set a, b to b, a                    # a swap
for each name, age in list of (list of "Sam", 20), (list of "Ana", 31)
    say name " is " age             # each item's items
end

set double to function with x gives x * 2   # a function with no name, as a value
say double(21)
set squares to list of n * n for each n in list of 1, 2, 3, 4   # a list built from another
say list of n for each n in squares where n is greater than 5  # [9, 16]: the ones that pass
say items 2 to 3 of squares         # [4, 9]: of a list, text or bytes
say list of 3, 1, 3 without repeats # [3, 1]: each once, where it first is
say 2 to the power of 10            # 1024
say 10 / 4 rounded down             # 2; also rounded up, and rounded (a half away from 0)
say 3.14159 with 2 decimals         # 3.14: text, with exactly that many, as Python's f"{x:.2f}"
say remainder of 17 divided by 5    # 2: what's left over, with the divisor's sign

set sam to record with name "Sam", age 20   # a record keeps named values together
set age of sam to 21
say name of sam " is " age of sam
say sam's name                              # or with 's: sam's name is name of sam
to birthday with person
    set person's age to person's age + 1
end
sam's birthday()                            # a function given the value first: birthday(sam)
to woofs with dog
    return name of dog + " says woof"
end
set rex to record with name "Rex", speak woofs   # a record can hold its own functions
say rex's speak()                           # nothing else is called speak, so it's rex's: woofs(rex)

to check_age with age
    if age is less than 0
        fail with "an age can't be below 0"  # stop with your own message
    end
end

set words to split "the quick fox" by " "   # text: split, join, uppercase, lowercase
say uppercase of item 2 of words " " join words with "-"
say position of "fox" in "the quick fox"    # 11: where it starts, or 0
set age to number of ask "How old are you?" # ask: the answer typed in, as text

use "math.moth"                     # another file's code: random numbers, sine, sqrt, logs, rounding

# drawing: the turtle starts in the middle, facing up, with its pen down
move forward 100                    # or: move back 50
turn right 90                       # or: turn left 45
pen color "tomato"                  # any CSS color name
pen width 3
pen up                              # move without drawing
pen down
```

For real programs: catching mistakes, dictionaries, modules, files, and bytes.

```
try                                         # catch a mistake and carry on
    set age to number of ask "Age?"
if it fails with why
    say "That's not a number: " why
either way                                  # runs however it ends: a mistake, a return, a stop
    say "asked"
end

set ages to dictionary where "Sam" is 20, "Ana" is 31   # look things up by key
set item "Bo" of ages to 7
remove "Ana" from ages
if "Sam" is in ages                         # is in: a list's items, a dictionary's keys, or text
    say item "Sam" of ages
end
for each person in ages                     # a dictionary's keys, in the order they were added
    say person ": " item person of ages
end

use "math.moth" as math                     # another file, its names kept apart as math's ...
say math's sqrt(2)                          # a name used as a file is the file's; any other x's is x's own
use the package "json" as json              # a package moth add fetched: packages/json/json.moth

set notes to read "notes.txt"               # files: read, read bytes, write ... to
write uppercase of notes to "loud.txt"
remove the file "loud.txt"                  # there must be a file of that name
say read the folder "tools"                 # what's in a folder, in order: a folder's name ends in /
for each word in arguments                  # tool a b c, once moth build made tool
    say word
end

say "that went wrong" to the error output   # not the normal output: for what went wrong
set code to run program "git" with (list of "status")   # start a program, wait, and take its number
set answer to run program "git" with (list of "log") keeping its output
say code of answer " " length of output of answer " " mistakes of answer
if code is not 0
    stop the program with 1                 # end the whole program, with a number from 0 to 255
end

use the library "user32"                    # a C library's functions, called as C calls them
    MessageBoxW(a pointer, wide text, wide text, a whole number) gives a whole number
end
MessageBoxW(nothing, "Hello from Moth", "Moth", 0)

set block to 4 bytes                        # memory: bytes from 0 to 255
set byte 1 of block to 0xFF                 # numbers in hex and binary: 0xFF, 0b1010
say block                                   # (4 bytes: 255, 0, 0, 0)
say "hi" as bytes                           # (2 bytes: 104, 105); back again with: as text
set header to ask for 64 bytes              # the input's next 64 bytes, not a line (fewer at its end; built programs only)
say 12 bit and 10 " " shift 1 left by 4     # 8 16; also bit or, bit xor, shift right
say 255 as hex " " 5 as binary              # ff 101

to test_area                                # the test runner runs every function named test_...
    expect area(3, 4) is 12                 # and if it isn't so: expected 13 to be 12
end
```

For data: amounts with units, tables, and charts.

```
set trip to 5 km + 300 m                    # an amount: a number, then its unit
say trip in miles                           # 3.29326731885787 miles
say 3 * 2 hours " " 10 km / 4 " " 10 km / 2 km      # 6 hours 2.5 km 5
say 1 km is 1000 m                          # yes: amounts compare across units
add 700 m to trip
say number of (trip in m)                   # 6000: the number alone

set sales to read table "sales.csv"         # a CSV file: a list of records, one for each row
for each row in sales where price of row is greater than 10
    say name of row                         # the header names the fields, in lower case
end
say total of price in sales                 # also average of, largest of, smallest of;
say average of (list of 2, 4, nothing)      # 3: like a spreadsheet, empty cells are skipped
draw chart of price in sales                # a bar for each row
draw chart of (dictionary where "Mon" is 5, "Tue" is 7)     # the keys label the bars
set prices to read table "https://example.com/prices.csv"   # read can go online too
```

Time, order and saving:

```
say the time " on " the date                # 14:05:09 on 2026-10-30, where it runs
say the weekday                             # also: the year, the month, the day, the hour, the minute, the second
set start to the clock                      # seconds since the program started
wait 2 seconds                              # or: wait 500 milliseconds, wait n minutes
say the clock - start                       # about 2

say scores in order                         # a new list, smallest first; the old one stays as it was
say scores in reverse order                 # largest first
for each p in people in order by age        # records, by a field
    say name of p
end

save scores to "scores.txt"                 # any number, text, list, record or dictionary
set scores to load "scores.txt"             # and back again, as it was

set reply to send (record with name "Sam") to "https://example.com/api"   # as JSON; text goes as it is
set data to json from reply                 # what JSON says: its objects are dictionaries
say scores as json                          # [10,20,30]
set me to read "https://example.com/me" with headers (dictionary where "Authorization" is "Bearer x")

set job to start count_to(1000000)          # a task: the call runs on a thread of its own,
say "counting..."                           # sharing the program's names, while the program goes on
say wait for job                            # waits for it to end, and gives what it gave back
say job has ended                           # yes: whether it's done, without waiting
set w to start count_to(10) on another core # a worker: a core of its own, at the same moment,
say wait for w                              # with copies of what it's given and of the program's names

play note "C" for 0.5 seconds               # middle C; also "C#5", "Bb3", or "rest"
play note 440 for 200 milliseconds          # or a pitch, in hertz
play a beep                                 # each sound starts when the one before ends,
                                            # and the program goes on at once
```

Apps: pictures that answer keys, clicks and time, with buttons, checkboxes,
lists, dropdowns, sliders and boxes to type in. [`apps/snake.moth`](apps/snake.moth) is a whole game in 110 lines,
[`apps/paint.moth`](apps/paint.moth) a paint program in 54, and
[`apps/todo.moth`](apps/todo.moth) a to-do list in 38.
[`apps/guestbook`](apps/guestbook) is a web app with a SQLite database, in
about 160 lines, and [docs/guestbook.md](docs/guestbook.md) walks through
building it.

```
move to 50, -20                             # straight to a spot, drawing if the pen is down
draw box at 0, 0 size 40 by 20              # filled with the pen's color
draw circle at 0, 0 size 10
draw "Score: 3" at -200, 220 size 16
draw picture "cat.png" at 0, 0              # a PNG or BMP, its bottom left corner at 0, 0
draw picture "cat.png" at 50, 0 size 32 by 32    # made bigger or smaller
clear                                       # wipe the picture
say random number from 1 to 6               # a whole number, different each run

when a key is pressed with key              # "left", "space", "a", ...
    say "you pressed " key
end
when the mouse is clicked with x and y      # also: when the mouse is dragged
    draw circle at x, y size 5
end
every 100 milliseconds                      # or: every 2 seconds, every 1 minute
    move forward 1
end

draw button "Add" at 10, 200                # its size comes from its label
draw text box "Name" at -200, 200           # 200 by 30; click it, type, select, copy, paste
when the button "Add" is clicked            # a click on a button is its own
    say the text in the text box "Name"
    clear the text box "Name"               # empties it; plain `clear` keeps it
end
when enter is pressed in the text box "Name" with words
    say "Hello, " words
end

set fruits to list of "apple", "banana", "cherry"
draw checkbox "Dark" at -200, 150           # 20 by 20, its label after it
draw text area "Notes" at -200, -60 size 250 by 100   # lines; 300 by 120 with no size
draw list "Fruits" showing fruits at 100, 0 # a row each; 200 by 144 with no size
tick the checkbox "Dark"                    # or untick it
when the checkbox "Dark" is clicked
    say the checkbox "Dark" is ticked       # yes or no; also: is not ticked
end
when an item is chosen in the list "Fruits" with fruit   # a click, or up and down
    say fruit " " the choice in the list "Fruits"   # the choice is nothing until there is one
end
say the text in the text area "Notes"       # its lines, a new line between each
draw dropdown "Size" showing (list of "S", "M", "L") at 100, 150   # a list that opens; 200 by 30
draw slider "Volume" from 0 to 100 at 100, 100   # a whole number; 200 by 20
set the slider "Volume" to 50               # kept between 0 and 100
when the slider "Volume" is moved with volume   # also: an item is chosen in the dropdown
    say "volume " volume
end
set name to choose a file to open           # or: to save; nothing if none is chosen
```

- **Values:** numbers, amounts like `5 km`, `"text"`, `yes`, `no`, `nothing`,
  lists, records, dictionaries and bytes. Only `no` and `nothing` count as false.
- **Numbers** are worked out the computer's way, but shown, compared and used as
  whole numbers (an item's place, a count of times) to 15 significant digits,
  like a spreadsheet: `0.1 + 0.2` is `0.3`, and `item (0.1 * 30)` is item 3.
  Whole numbers up to 2^53 are always exact.
- **Units:** distances (`mm cm m km`, `inches feet yards miles`, and `metres`
  or `meters` written out), times (`milliseconds` to `weeks`), weights (`mg g
  kg`, `ounces pounds tonnes`, `grams` written out) and volumes (`ml`,
  `litres` or `liters`). A unit's word only counts as one after a number or
  after `in`, so it can still name a variable. Amounts of one measure add,
  subtract, compare and convert with `in`; they're times or over a number, and
  one over another of the same measure is a number. Mixing measures is a
  mistake, which says so.
- **Tables:** after `total of`, `average of`, `largest of`, `smallest of` and
  `draw chart of`, `price in sales` means each row's price; to convert a total,
  bracket it: `(total of trips) in miles`.
- **Inputs** can say what they are: `with name as text, age as a number` (also
  `yes or no`, `a list`, `a record`, `a dictionary`, `bytes`, `a function`), and
  each call checks them. They can say more: `a dog`, a record the kind dog
  makes, and `a list of numbers` (or of `text`, `dogs`, `lists of numbers`...);
  and a function can say what it `gives`: `gives a number`, `gives nothing`,
  `gives a dog or nothing`. A run checks what it cheaply can (`a dog` is a
  record, `a list of numbers` a list), and `moth check`, the playground and the
  editors check the rest before the program runs: `doesn't fit: 'greet' needs
  pet to be a dog, not a cat`. Code that says nothing is checked as it always
  was.
- **Libraries:** `use the library "sqlite3"` (or `"winsqlite3" or "sqlite3"`,
  for the first there is, and `as` a name), then a line for each function the
  program calls, with what it takes and `gives`, as C has it: `a number` is a
  double, `a whole number` an int, `a long whole number` 64 bits, `a pointer` a
  whole number, nothing or bytes, `text` UTF-8, `wide text` wchar_t's, `bytes`
  the program's own memory, for C to fill, `yes or no` an int, and `a float` a
  float. A function whose name Moth has for its own goes in quotes: `"remove"
  as remove_file(text)`. `structure point with x as a whole number, y as a
  whole number` makes `a point` a record C sees as its struct, filled in
  where C changes it; `callback compare(a cell, a cell) gives a whole number`
  makes `a compare` a function of the program's that C calls back, such as a
  window's procedure. Only a program `moth build` makes can call one.
- **Comparisons:** `is`, `is not`, `is less than`, `is greater than`,
  `is at least`, `is at most`, `is divisible by`, `is in`, joined with `and`,
  `or`, `not`.
- **Maths:** `+ - * /` and `to the power of`, a whole power (math.moth's
  `power(x, y)` takes any). `rounded down`, `rounded up` and `rounded` round
  the sum before them, as it's shown, to 15 digits, so `(0.1 * 30) rounded
  down` is 3; `remainder of a divided by b` is exact for whole numbers. Adding
  text to anything joins them into text.
- **Sets:** `xs without repeats` keeps each item once; `x is in xs` finds
  one; and list building does the rest: `list of x for each x in a where x
  is in b` is what's in both, and with `not`, what's only in a. A
  dictionary's keys are a set that finds a key at once, however many.
- **Mistakes of your own kinds:** `fail with` takes any value, so `fail with
  record with kind "missing", file name` is one a `try` can tell from the
  rest by its `kind`, and `fail with why` passes on one it doesn't handle.
  Tasks (`start`, `wait for`) are what async code is for; a generator is a
  function that adds to a list, or a record with its own `next` function.
- **Every core:** `start work(x) on another core` runs the call on a worker,
  a thread with memory of its own: it's given copies of `x` and of the
  program's variables, changes them only for itself, and `wait for` gives a
  copy of what it gave back, or fails with the mistake it ended with. Sharing
  nothing, workers can't race, and in a program `moth build` makes they run
  Moth at the same moment, on as many cores as there are (DESIGN §124). In
  the playground a worker runs when it's started, as a task does.
- **A record's own functions:** `rex's speak()`, where the program makes
  nothing else called `speak`, calls the function rex's `speak` field holds,
  with rex first. So records made by different functions can each answer the
  same call their own way, and one made from another can replace a function
  of its own, keeping the old one to call: what Python's classes do, with
  records.
- **Inputs left out:** `with name, greeting or "Hello"`: after `or`, a value
  written out (or a list of them), which each call that leaves the input out
  gets afresh. Every input after one with `or` needs one too. A call through a
  variable gives them all.
- **Kinds:** `kind dog with name, sound or "woof"`, with functions inside,
  makes `dog`, a function that gives a record of its inputs, its `kind`
  "dog", with each function as a field, so `rex's speak()` calls dog's with
  rex first; `from pet(name)` after the inputs makes it from what that
  gives, and `pet's speak(self)` calls pet's own. Python's classes, with
  records: a kind's functions are called on one, `self's other()` inside.
  A kind's `shown` function says how `say`, and a value in text, show one.
- **give:** a function with `give x` in it gives a list of every value it
  gave, when it returns: a generator, all at once.
- **Inputs by name:** `greet("Sam", mark "?")`, a name and its value, after
  the inputs given in order, for a function made with `to`; the ones left out
  get their `or`. They're worked out in the order of the function's inputs.
- **Variables:** inside a function, `set` (or `add`, `for each`) changes a
  variable the top level, or an enclosing function, made above the function's
  `to` line; otherwise the variable is the function's own. A name a function
  only reads can be set anywhere around it, even below. Functions remember the
  variables around them.
- **Text:** any character but control characters; write `\n` for a new line and
  `\t` for a tab. Upper or lower case doesn't matter in names and words.

Mistakes get a message in plain words that points at the exact spot, with the
right name when you misspell one, the right word when you type a symbol from
another language, and the calls that led there:

```text
line 2: 'totl' has no value yet. Did you mean 'total'?
say "Total: " totl
              ^
line 1: I don't understand '>' (write 'is greater than')
if x > 5
     ^
line 6: can't divide by zero
    return total / length of numbers
                 ^
  in 'average', called from line 10
  in 'report', called from line 13
line 4: 'area' needs height to be a number, not text
say area(3, "4")
    ^
```

<p align="center">
<img src="docs/spiral.svg" height="230" alt="A colour spiral drawn by Moth">
&nbsp;&nbsp;
<img src="docs/tree.svg" height="230" alt="A tree drawn by a Moth function that calls itself">
<br><sub>Drawn by the Spiral and Tree examples, in the playground.</sub>
</p>

## The playground

[The playground](https://samyyy2423.github.io/moth/) runs in any browser, with
nothing to install.

- **Run** works in a background thread, so **Stop** ends even a loop that never
  does. **Engine** picks WebAssembly (the one it starts on, where the browser
  has WebAssembly GC), the JIT or the VM, and the status bar times each run, so
  you can race them.
- **Debug** records the run, then **Back**, **Step**, **End** and a slider move
  through it in either direction: the line about to run, the calls in progress,
  every variable in view, and the output and drawing as they were.
- **Problems** appear as you type. Click one to jump to it, and **Fix** puts a
  misspelled name, or a symbol from another language, right.
- **Compiled** shows what the code became: bytecode, the JIT's JavaScript, the
  JavaScript from the compiler written in Moth, or the WebAssembly module.
- **Share** puts the code in the link, and **Tidy** lays it out the one way
  Moth writes it (Undo brings it back).
- **Apps** keep running once they've set up: click the picture, and your keys,
  clicks and drags go to the program, or to its buttons, checkboxes and lists
  and the box you clicked; the mouse wheel scrolls a list, and a box takes the
  arrows, Shift to select, and copying and pasting. Try **Snake**, **Paint** and **To-do**.
- **Examples** include **Handwriting** (draw on a pad), **Guess** (a
  number-guessing game that asks for answers), **Tune**, **Neural network**,
  and **Moth's own compiler**, running in your browser.

## Command line

`moth` is standalone Moth: a program of its own, with nothing else to install.
Get `moth-windows.exe` (save it as `moth.exe`) or `moth-linux` (save it as
`moth`, then `chmod +x moth`) from
[the releases](https://github.com/samyyy2423/moth/releases), or make it from the
source with Node.js: `node bootstrap.mjs`.

```text
moth                                     the Moth shell: type Moth and see what it does (also moth shell --allow-...)
moth build hello.moth                    compile it to machine code: hello.exe, or hello on Linux
moth build --web hello.moth              or hello.html: a page that runs it in any browser, Moth's engine in it
moth run hello.moth Sam 3                build it beside itself, run it with those arguments, remove it again
moth debug hello.moth Sam 3              the same, stopping at its first line for commands: step, break 12, show x...
moth profile hello.moth Sam 3            the same, then where its time went: each function's, and the slowest lines
moth coverage hello.moth Sam 3           the same, then how many of its lines ran, and which didn't, file by file
moth notebook notes.md                   run each ```moth block of a Markdown file, and write what it said under it
moth kernel                              run cells for Jupyter's Moth kernel (editors/jupyter), each with what the ones before made
moth add github.com/someone/json         fetch a package into packages/ and list it, at its commit, in moth.packages
moth search hello                        the package index's packages with "hello" in their name or what they're for
moth add greeter                         a package by its name in the index
moth get                                 fetch every package moth.packages lists, at its commit (on another computer, say)
moth update                              move the packages to their newest commits (or moth update json, one)
moth remove json                         take a package away; moth packages lists them
moth get --signed                        only packages signed by a key git trusts (also moth add and moth update)
moth audit                               check the packages against the advisories in the package index
moth tidy hello.moth                     write it the one way Moth writes code (--check only says which need it)
moth check hello.moth                    find problems in it without running it, the types it says included
moth lsp                                 the language server an editor starts: problems as you type, tidying, hovers...
moth test hello.test.moth                run every test_ function in it, each in a run of its own
moth test                                the same for every .test.moth file here and in the folders inside
moth build hello.moth --target linux     for the other system: --target linux or --target windows
moth build tool.moth --allow-read        let it read files without asking (also --allow-write, --allow-net, --allow-run, --allow-libraries, --allow-all)
moth build tool.moth --allow-read=data   only the files in data (also --allow-write=out, --allow-net=example.com)
moth build moth.moth --allow-read --allow-write --allow-run --include moth-debugger.moth    moth, built by itself
moth build app.moth --icon app.png --version 1.2.0    a Windows program's icon (.ico or .png) and version
moth build app.moth --include data --include logo.png    files built in: read finds them before the disk
moth build app.moth --installer --name "Notes"   and app-setup.exe, which installs it: a Start menu entry, removable in Settings
moth build app.moth --sign "signtool sign /fd SHA256 /a"   run a command on each program made, its name after it
```

`moth run` is `moth build` and then the program: it builds it into a file
beside the source (`hello-run.exe`, or `hello-run` on Linux), gives it
everything written after the file as its arguments and this terminal's own
input and output, waits for it, removes the file, and ends with the number the
program ended with. If a file of that name is already there, it leaves it
alone and runs nothing. The `--allow` flags go before the file, since what
comes after it is the program's own. `moth tidy` and `moth test` take any
number of files, and `moth test` with none finds every file ending in
`.test.moth` here and in the folders inside, but not hidden ones or
`node_modules`; `moth check` takes one.

### Installers and signing

`moth build app.moth --installer` makes `app-setup.exe` (or `app-setup` on
Linux) beside `app.exe`: one file to give people. Run, it asks, then installs
the program for that person, with no administrator needed:

- **Windows:** into `AppData\Local\Programs\<name>`, with a Start menu
  shortcut and an entry in Settings' installed apps, whose Uninstall takes it
  all away again.
- **Linux:** into `~/.local/opt/<name>`, with an entry in the applications
  menu (and the `--icon` PNG as its icon), and `uninstall.sh` beside it.

`--name "Notes"` is what the menus call it (else the file's name), `--version`
its version. The setup program takes `--uninstall`, `--quiet` (no questions)
and `--into <folder>` (just the folder, no menu entry, for a program carried
on a USB stick).

Windows warns before it runs a program from an unknown publisher ("Windows
protected your PC", or "Publisher: Unknown"). Signing the program says who
made it:

1. Get a code signing certificate: from a certificate authority (DigiCert,
   Sectigo, SSL.com and others sell them, from about $200 a year, and check
   who you are first), or Microsoft's Trusted Signing, a monthly service.
2. Install `signtool`, which comes with the Windows SDK.
3. Build with `--sign`, so moth signs the program, and then the installer
   with the signed program in it:

   ```text
   moth build app.moth --installer --sign "signtool sign /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 /a"
   ```

   `/a` picks the certificate installed on this computer; `/f cert.pfx /p
   <password>` uses one in a file instead. The timestamp (`/tr`) keeps the
   signature good after the certificate runs out.
4. SmartScreen may still warn about a new certificate until enough people
   have run programs signed with it; that's Windows' own reputation, which
   nothing in the program changes.

Linux doesn't ask for signed programs. To let people check a download, give
its SHA-256 with it (`sha256sum app-setup`), or sign it with GPG.

`moth` on its own is the Moth shell: type a line, or a block that runs once its
`end` is typed, and see what it does. A line that's a value shows it.

```text
$ moth
Moth shell. Type Moth code: a block runs once its 'end' is typed, and a value shows itself. 'quit' ends it.
moth> set prices to list of 3, 4.5, 2
moth> to total_of with xs
....>     set sum to 0
....>     for each x in xs
....>         add x to sum
....>     end
....>     return sum
....> end
moth> total_of(prices)
9.5
moth> "{length of prices} prices"
3 prices
moth> quit
```

Each entry is built and run as a program of its own, in about 35 ms, with what
the entries before it left: their functions, and their names' values.
`moth shell --allow-read` (or any `--allow` flag) lets the entries do more
without asking.

`moth debug` runs a program as `moth run` does, built with a debugger in it,
which stops before the first line and takes commands, typed or from the input:
`step` into the next line, `next` over a call, `out` of this call, `go` to a
breakpoint, `break 12` (or `break math.moth 12`) and `clear 12`, `show x` or
`vars` for what the variables hold, `where` for the calls in progress, `list`
for the lines around, `quit`, and `help`. If the input ends, the program runs on
to its end.

```text
$ moth debug area.moth
area.moth:1: to area with w, h
(moth) break 2
breakpoint at area.moth:2
(moth) go
area.moth:2, in 'area': return w * h
(moth) where
  area.moth:2, in 'area'
  area.moth:6
(moth) vars
w is 1
h is 2
total is 0
i is 1
(moth) go
total 12
```

A package is a Git repository of Moth files, whose main file is named after
it. `moth add` fetches one, from a site (`github.com/someone/json` is
`https://github.com/someone/json`) or a folder, into `packages/json`, and
lists it in `moth.packages` with the exact commit it got, so `moth get`
anywhere fetches the same code; a program uses it with `use the package "json"
as json`. If the package lists packages of its own in a `moth.packages`, they
come too, at their commits. A file uses files from its own folder, so a
package's `use "helpers.moth"` is its own helpers, and `use the package` is
always the program's, from wherever it's written. moth runs the system's `git`
to fetch them.

`moth.sums`, beside `moth.packages`, has the SHA-256 of each package's files.
`moth add` and `moth update` write it and `moth get` checks it, so a package
that changed, in `packages/` or where it comes from, is found rather than run:
commit it with `moth.packages`. `--signed` takes only packages whose commit,
or the tag they were asked for at, has a signature git trusts, and `moth
audit` says which of the package index's advisories are about the commits a
program's packages are at, ending with 1 if any are, for CI.
[SECURITY.md](SECURITY.md#packages) has the details.

```text
$ moth add github.com/someone/json
added json at 3f2a9c1, from https://github.com/someone/json
$ moth update
json: 3f2a9c1 -> 8b1d2e0
```

`moth test` runs each test on its own, in a run of its own, so one test can't
spoil another: it builds the file once, then starts it once for each test, and
keeps what the test said to show under it if it fails.

```text
$ moth test tools/json.test.moth
✓ test_values
✓ test_lists_and_objects
✓ test_spaces_and_lines
✓ test_escapes
✓ test_mistakes
5 passed
```

A program moth makes asks before it reads a file, writes one, goes online,
starts another program or uses a library, the way Deno does: at a terminal
you're asked, once for each file, site, program or library (or `a` for all of
them); anywhere else, such as in a script, the answer is no unless it was built
with `--allow-read`, `--allow-write`, `--allow-net`, `--allow-run`,
`--allow-libraries` or `--allow-all`. A library can do anything the program
can, so allowing one allows all of that. The first three
can name what they allow: `--allow-read=data,notes.txt` lets it read those files
and everything in those folders, wherever their links lead;
`--allow-net=example.com` that site. `use` only reads files in the program's own
folder, or folders inside it. A refusal is a mistake the program can catch with
`try`:

```text
$ moth build copy.moth
compiled copy.moth to machine code for Windows -> copy.exe (71,680 bytes)
$ copy
moth: let this program read 'notes.txt'? (y = yes, a = yes to all, n = no) n
copy.moth:1:20: can't read 'notes.txt': this program isn't allowed to read files (start it with --allow-read)
write uppercase of read "notes.txt" to "loud.txt"
                   ^
```

A program reads a site the way it reads a file, `read "https://example.com"`:
on Windows through WinHTTP, with the system's certificates, and on Linux through
the system's `curl`. A site that sends it on to another address is asked about
again there, ten moves at most; any other answer from 300 up is a mistake
(`can't read 'https://example.com/nothing': the site answered 404`), and a site
gets 60 seconds.

`send data to "https://..."` sends data to a site (a POST) and gives back its
reply, as text: text goes as it is, and anything else as JSON. `with headers`
adds headers, a dictionary of text, to a `send` or a `read`, for a site that
wants a key or a token. `scores as json` writes a value as JSON, and
`json from reply` reads JSON back, its objects as dictionaries. Sending is going
online, with the same `--allow-net` rules.

A mistake in a program, and what `moth` itself says went wrong, go to the error
output, so a program's own words stay clean; `moth` ends with 1 for a mistake,
2 when it doesn't understand what it was asked, and for `moth run` with
whatever the program ended with.

Until 1.5 Moth also had a command line written for Node.js, with a shell and
builds to JavaScript and web pages. Those went with the Rust engine; the
debugger and finding problems as you type are the playground's.

## In your editor

`moth lsp` is Moth's language server, for any editor that speaks the Language
Server Protocol: problems as you type, as `moth check` finds them (the types
included), formatting as `moth tidy` writes code, the outline (functions, kinds
and variables), go to definition, in the file or one it `use`s, hovers (what a
name is, what a variable holds, what a function takes and gives) and
completion, after `rex's` too. It goes on knowing a file while a line of it is
half typed, and counts the changes not yet saved in the files it uses. And
[`editors/vscode/debug-adapter.js`](editors/vscode/debug-adapter.js) gives an
editor's debugger `moth debug`: breakpoints, stepping, the calls in progress
and the variables, in VS Code, Neovim, Helix and JetBrains' IDEs.

| Editor | How |
|:--|:--|
| VS Code | [`editors/vscode`](editors/vscode), an extension, below |
| Neovim | [`editors/neovim`](editors/neovim), a plugin folder |
| Helix | [`editors/helix/languages.toml`](editors/helix/languages.toml) |
| Zed | [`editors/zed`](editors/zed), an extension |
| IntelliJ IDEA, PyCharm, WebStorm... | the LSP4IJ plugin, with the VS Code extension's colours |

Zed, Helix and Neovim colour Moth with its tree-sitter grammar,
[`editors/tree-sitter-moth`](editors/tree-sitter-moth). How to set up each, and
any other editor: [editors/README.md](editors/README.md).

[`editors/vscode`](editors/vscode) is an extension for VS Code: colours,
problems as you type from Moth's own checker (with a Quick Fix for a misspelled
name or a symbol from another language), Format Document as `moth tidy` writes
code, snippets, a debugger (through `moth debug`), and Run and Build, which
start `moth` on the file; and, where moth is installed, the outline, Go to
Definition, hovers and completion from `moth lsp`. Make it and install it:

```text
node editors/vscode/make-vsix.mjs
code --install-extension editors/vscode/moth-0.1.0.vsix
```

## In Jupyter

[`editors/jupyter`](editors/jupyter) is a Jupyter kernel: notebooks in
JupyterLab, Jupyter Notebook or VS Code with Moth in their cells. Each cell
has what the cells before it made, a cell whose last line is a value shows
it, one that fails keeps nothing, `ask` asks in the notebook, and stopping a
cell keeps what came before. With `moth` on your PATH and Jupyter installed:

```text
python editors/jupyter/moth/moth_kernel.py install
jupyter lab
```

## Without JavaScript

The playground's engines are written in JavaScript, so a bug in JavaScript
itself could reach them. Standalone Moth has none: [`machine.moth`](machine.moth)
writes x86-64 machine code itself, every instruction and the file around it byte
by byte, with no assembler, linker or other compiler, and
[`moth.moth`](moth.moth), the command line, is written in Moth too. Made into
machine code by machine.moth, the two are `moth.exe`, and it builds itself:

```text
$ moth build moth.moth --allow-read --allow-write --allow-run --include moth-debugger.moth
compiled moth.moth to machine code for Windows -> moth.exe (19,166,208 bytes)
```

That's the same 19,166,208 bytes Node.js made of it, and the moth.exe they make
makes them again. A Windows moth and a Linux one build each other byte for byte
too. What a program in machine code does is what the JavaScript engine does: on
every push, machine.test.js holds hundreds of programs to it, mistakes and all.
How it was built, from the first `say` to the garbage collector: **[DESIGN.md](DESIGN.md)**, §25.

Until 1.5 there was a second way: [`native/`](https://github.com/samyyy2423/moth/tree/v1.5.1/native),
Moth written again from scratch in Rust, which ran programs, built them into
machine code with `rustc`, and built compiler.moth with itself. Standalone Moth
does all of that without Rust, so it's gone.

## How it's built

```text
                                       ┌→ bytecode     → the VM        debugger, shell
                                       ├→ JavaScript   → V8            Run
source → tokens → syntax tree → scope ─┼→ WebAssembly  → V8            the fastest
                                       ├→ machine code → the CPU       moth build
                                       └→ checker      → problems      as you type
```

A tokenizer and a recursive-descent parser make a syntax tree whose every node
remembers where it came from, so errors can point at it. The scope rules give
each variable a slot, once, for every back end, so they can't disagree about
what a name means. Every check and error message lives in one place, `vm.js`,
which all three engines call. The compiler written in Moth repeats the first
four steps and the JIT, in Moth, and machine.moth uses its first four steps to
write machine code.

How each engine was made fast, what didn't work, and why: **[DESIGN.md](DESIGN.md)**.

<details>
<summary>The files</summary>

| File | What it is |
|:--|:--|
| [`moth.js`](moth.js) | Tokenizer, parser, bytecode compiler, and the public API (`run`, `check`, `compile`, `timeline`...) |
| [`scope.js`](scope.js) | Which variable each name means, shared by every back end |
| [`vm.js`](vm.js) | The virtual machine, and every check and error message all three engines use |
| [`jit.js`](jit.js) | The JIT: Moth to JavaScript |
| [`wasm-binary.js`](wasm-binary.js) | WebAssembly's binary format, written byte by byte |
| [`wasm.js`](wasm.js) | Moth to WebAssembly, with escape analysis and unboxed numbers |
| [`checker.js`](checker.js) | Finds mistakes without running the program |
| [`compiler.moth`](compiler.moth) | Moth's compiler, written in Moth |
| [`machine.moth`](machine.moth) | Moth to x86-64 machine code, written in Moth: a Windows .exe or a Linux program, byte by byte |
| [`moth.moth`](moth.moth) | Standalone Moth's command line, in Moth: with machine.moth, it is moth.exe, which builds itself |
| [`moth-debugger.moth`](moth-debugger.moth) | The debugger `moth debug` builds into the program it debugs, in Moth; moth.exe carries it |
| [`editors/vscode/`](editors/vscode) | The VS Code extension, and `make-vsix.mjs`, which packs it with Moth's engine inside |
| [`editors/jupyter/`](editors/jupyter) | The Jupyter kernel, in Python, which runs cells through `moth kernel`, and its tests |
| [`editors/tree-sitter-moth/`](editors/tree-sitter-moth) | Moth's tree-sitter grammar, which Zed, Helix and Neovim colour it with |
| [`editors/`](editors) | Neovim's plugin folder, Helix's settings, Zed's extension, and how to set up each editor with `moth lsp` |
| [`checker-rules.moth`](checker-rules.moth) | What each of the checker's rules does with each type, for `moth check`: made by `make-checker-rules.mjs` |
| [`versus/`](versus) | The same four programs in Moth, C, Rust and Python, and `npm run versus`, which times them |
| [`neural.moth`](neural.moth), [`math.moth`](math.moth) | The neural network, and the maths it needs, in Moth |
| [`digits.moth`](digits.moth), [`digit-shapes.moth`](digit-shapes.moth), [`digits-train.moth`](digits-train.moth), [`handwriting.moth`](handwriting.moth) | Reading handwriting: strokes to pictures, the network, its training, and the program that asks you to draw |
| [`tools/`](tools) | Real tools in Moth: a picture maker, a word counter, a JSON reader and its tests, SQLite, Windows' own controls, and a notepad made with them |
| [`bootstrap.mjs`](bootstrap.mjs) | Makes the first moth.exe from the source, with Node.js |
| [`index.html`](index.html), [`worker.js`](worker.js) | The playground |

</details>

## Tested

`npm test` runs on every push. Tables of programs and mistakes run on all three
engines, and 5,000 randomly broken programs must make all three agree: the same
output, the same drawing, the same error at the same spot, and the same trail of
calls that led there.

<details>
<summary>Everything it checks</summary>

- every playground example, on all three engines
- programs with their exact output, and broken programs with their exact error
  messages and positions, on all three engines
- 5,000 randomly broken programs: each must fail with a proper Moth error, never
  a JavaScript crash, and the three engines must agree on all of them
- 1,500 new programs made from the grammar ([`generate.js`](generate.js)), every
  feature mixed in: the engines must agree, files and trails included, the
  compiler written in Moth must match the JIT, tidying must change nothing they
  do, and the checker must raise no false alarms. Run for longer, it found the
  `else` / `if` bug
- the checker against reality, on 3,000 more: no line it says will fail ever
  runs in a program that finishes, and it predicts 44% of runtime errors with
  no false alarms
- the compiler written in Moth against the JIT, byte for byte, on every example,
  every table program and 3,000 broken ones, and bootstrapping it three stages deep
- the neural network and the handwriting reader, on all three engines
- `stop`, the text helpers, `ask` and `use`, including that `ask` never asks
  twice when a run is handed over, and that a mistake in a used file names it
- `try`, dictionaries, bytes and bits, files and arguments (a run handed over
  reads the same files and writes nothing twice), and modules, whose names stay
  apart even where a function's own names hide them
- WebAssembly's own fast paths for bytes, bits and dictionaries, right at their
  edges (2^31, a shift by 21 or 22, -0, 255 and 256), against the other engines
- `expect` and the test runner, including that each test starts afresh; tidying
  every Moth file here (already tidy) and 2,000 broken programs (each tidied
  without changing a piece, and tidy the second time); and the three tools,
  whose pictures must match byte for byte on every engine
- the WebAssembly encoder against the spec's examples, and the playground's script
- buttons and text boxes: clicks, focus, typing, Backspace and Enter on all three
  engines, an app moved to the VM in the middle keeping what was typed, and the
  same in machine code, whose window must say, fail and draw as the JavaScript
  engine does, with [`apps/todo.moth`](apps/todo.moth) built and driven
- editing what's typed: the cursor, selecting, cutting, a drag and a text area's
  lines on all three engines, through a move to the VM, and in machine code's
  window, whose pixels and clipboard were checked too
- dropdowns, sliders and choosing a file: opening, choosing, the wheel, drags and
  keys on all three engines and in machine code's window, and Windows' Open and
  Save boxes in a real window
- checkboxes, text areas and lists: ticks, choices, the arrow keys, the wheel
  and lines typed on all three engines and through a move to the VM, and in
  machine code's window, which must say, fail and draw as the JavaScript engine
  does
- the window on Linux: every test of the window's, there as on Windows, with
  what Linux draws in memory instead of GDI+; and a real window on an X server,
  sent clicks, keys, drags and the wheel, which said and showed, pixel for
  pixel, what the same events from `MOTH_EVENTS` did
- libraries: C's own functions called with every type, structures C fills in,
  `qsort` calling a Moth function, floats and each mistake, on Windows and
  Linux; SQLite through `tools/sqlite.moth`; and on Windows a window whose
  procedure is a Moth function, and `tools/windows.moth` driving its own
  controls, menus and keys, and its tabs, tables, progress bars, pictures and
  drawings; on Linux `tools/linux.moth` doing the same with GTK's, on CI's
  Xvfb display; `tools/ui.moth` on both; and `tools/server.moth` answering
  another Moth program's reads and sends, on both, keeping connections open,
  answering requests sent together, keeping its time and size limits, and
  answering on workers; and `tools/tasks.moth`
  starting, asking about and stopping programs in the background, on both; and
  `moth build --icon --version --include`, a program moved away from its files
  reading them from inside itself, on both, and Windows' resources read back;
  and `tools/text.test.moth` and `tools/dates.test.moth` on all three engines
  and in machine code, 400 years of the calendar among them; `tools/hash.test.moth`
  against FIPS 180-4's hashes and Node's crypto, the same way; and
  `tools/system.moth` saying the same, word for word, on Windows and Linux; and
  `tools/game.moth` playing itself, a key held and let go and the mouse clicked
  by the system's own messages, at 30 frames a second or more, on both
- the libraries for companies' work: `tools/yaml.test.moth` against the YAML
  spec's examples and PyYAML; `tools/jwt.test.moth` against RFC 7515's tokens
  and PyJWT's, with `none` and HMAC-with-the-public-key turned down;
  `tools/s3.test.moth` against the signatures AWS publishes; SCRAM-SHA-256
  against RFC 7677; and each protocol's messages, byte for byte as Python's
  `struct` makes them, all on the engines and in machine code; then, where CI
  starts them in containers, real PostgreSQL 16, MySQL 8.4, Redis 7 and MinIO
  servers, and an OAuth sign-in with PKCE through a provider and a browser
  the test plays
- machine code against the JavaScript engine: 400 random programs made
  from the part of Moth it takes ([`machine-programs.js`](machine-programs.js)),
  with awkward numbers, every comparison and mistakes on purpose, 120 written for
  what's easy to get wrong, and every test program and 300 broken ones it can
  take, each built for the system the tests run on, which must print, fail and
  exit exactly alike; machine.moth and moth.exe each building themselves into
  the same bytes; every character's upper and lower case; programs that make
  far more than they keep; a tool's files, arguments, answers and `--allow`
  flags against what `moth run` did; amounts, tables and folders read from real
  files, against the JavaScript engine reading the same files from memory; and
  charts and `rgb()` and `hsl()` colours, pixel by pixel in the picture the
  window draws
- the commands moth.exe has: a program it builds that starts another program,
  waits for it and removes a file, and one that keeps what another said, from
  both its outputs, more of it than a pipe holds; `moth run` passing arguments,
  input, output and the number a program ended with through, and leaving
  nothing behind; `moth tidy` on every Moth file here and on programs broken on
  purpose, each tidied to exactly the bytes `format()` makes; `moth check`
  against the checker, its own problems word for word; `moth test` on the
  tests in Moth here, said exactly as `test()` says them; and `moth test` on
  its own, finding the tests in a folder in the order the Node.js command line
  found them; and `moth debug` stopping where it's told, its arguments passed on
- the debugger: three sessions word for word, on Windows and Linux, stepping
  into and out of calls, breakpoints in the program and a file it uses, a
  closure's variables, the calls in progress through recursion and a caught
  mistake, the program's own question answered from the same input, the input
  running out and `quit`; and every test program, built to be debugged and
  told to go, saying, failing and ending exactly as its usual build does
- packages: Git repositories made by the tests, added, run, updated to a new
  commit, fetched again after `packages/` is gone, a package that uses another
  bringing it at its commit, the mistakes, and removed, through moth.exe on
  Windows and Linux; and files in folders and `use the package` on all three
  engines and in the compiler written in Moth
- the VS Code extension: its colours, run through a TextMate tokenizer of the
  tests' own, on the words the playground colours, values in text and every
  example; its indenting; its problems, fixes, tidying, outline, definitions
  and commands, against a stand-in for VS Code's API, and what it asks of
  `moth lsp` and does without it, against a stand-in for that; the .vsix,
  unzipped and compared with the files here; VS Code installing it; and, with
  MOTH_VSCODE=1, the extension in VS Code's own extension host
- the debug adapter, spoken to as an editor speaks to it, on moth.exe's `moth
  debug`: breakpoints in two files, the calls in progress, variables, hovers,
  the debug console, stepping, the program's question answered, a mistake
  stopped at, and a program stopped while it runs, left tidy
- `moth lsp`, spoken to as an editor speaks to it, each message's framing
  checked: the problems as a file opens and as it's typed, against the
  checker's; the outline; definitions in the file and the files it uses; every
  kind of hover; completion; an unsaved change to a file it uses; tidying,
  against `format()`; messages in pieces and two at once; and the VS Code
  extension's own client against it
- the other editors: the tree-sitter grammar's words and the colours' copies
  for Zed, Helix and Neovim against VS Code's, their indenting, and the commit
  Zed and Helix build the grammar from
- types: each kind of input type, `gives`, and every message, word for word;
  and no false alarm in code that says nothing of them, the checker's claims
  held against runs of the lessons, the programs made into machine code, and
  every file of the standard library
- tasks: what they say, fail with and give back, against the JavaScript engine,
  with names shared, thousands of them, tasks starting tasks past the threads
  there are, five threads making far more than they keep, and files read and
  written by tasks at once; a task counting while the program waits for a line
  typed half a second late, running a program, sleeping in a library's
  function while the program counts, `qsort` calling a task back, and a
  window's timer ticking while a task works, on Windows and Linux
- functions put in line and inputs in registers: mistakes inside with the
  trail a call shows, a try around them, called before they're made and at the
  most calls there can be, inputs that say what they must be and ones with no
  value yet, early returns, sums past 2^53, and one to five inputs; and lists,
  text and records where the code is: every number that isn't one of a list's,
  text joined to text and digits in place and not, and records of other shapes
  at the same place; in machine code on Windows and Linux, against the
  JavaScript engine
- the shell: a session typed into moth.exe on Windows and Linux, with values
  shown, functions made earlier called, a function's own names kept apart, a
  file used, a mistake's trail naming the entries, a value that can't be kept,
  a block dropped, and no file left behind
- the Jupyter kernel: `moth kernel` given cells one at a time, byte for byte;
  the Python kernel against a stand-in for it (output in pieces, questions,
  mistakes, a cell stopped, moth kernel stopping) and against moth itself
  (what cells keep, a question, a cell stopped, two kernels in a folder);
  and, where ipykernel is installed, run as Jupyter runs it
- arrays, models and Python: `tools/arrays.test.moth` on all three engines and
  in machine code, whose own loops must give Moth's answers to the last bit;
  matmul through OpenBLAS, an ONNX model the tests write run through ONNX
  Runtime, and Python run inside a program, where each is installed (CI
  installs them)
- `tools/ai.moth` against a server of the tests' own that answers as
  Anthropic's and OpenAI's APIs do: answers, streams read however the bytes
  come, tools, JSON, embeddings and searching them, a refusal another model
  went on from, and keys, wrong, missing and only ever in their own API's
  header; the keys are made up
- sound: every way of writing a note, its pitch and how long it lasts, and the
  mistakes, on all three engines and in the compiler written in Moth; a run
  handed over to the VM playing nothing twice; and machine code's sounds,
  written to a file with MOTH_SOUND, byte for byte the WAV of the JavaScript
  engine's, with each note's pitch measured in its samples
- going online in machine code, against a server of the tests' own on
  127.0.0.1: a page's text and bytes, moves to other addresses, the answers
  that are mistakes, a refused connection, a big page and the `--allow-net`
  rules, in the Rust engine's words; and that a program that never reads is
  the same bytes it was

The tests are tested too: bugs planted on purpose in the VM, the JIT, the
checker, the compiler written in Moth, the neural network and WebAssembly's
unboxed numbers were all caught, some only by the fuzzer.

</details>

## Depending on it

Moth keeps its promises in writing, for anyone who builds on it:

- **[SPEC.md](SPEC.md)**, the language specification: how a program is read,
  every statement and expression with its grammar, values, numbers to 15
  digits, each built-in operation, mistakes, files, packages and the
  permission flags, with what's guaranteed marked apart from what's only how
  it works today.
- **[VERSIONING.md](VERSIONING.md)**, the stability promise. One version for
  the language, the standard library and the `moth` command, by semantic
  versioning. From 1.11, a program that runs on one 1.x release runs the same
  on every later 1.x: no word becomes reserved, the standard library keeps its
  functions, and moth keeps its commands, flags, files and exit codes.
  Something that has to go is deprecated first, with a warning from `moth
  check` and `moth build`, keeps working through 1.x, and can go only in 2.0,
  six months on at least. The newest minor release gets every fix, and the one
  before it security fixes for 90 days.
- **[CHANGELOG.md](CHANGELOG.md)**: what changed in each release.
- **[SECURITY.md](SECURITY.md)**: how to report a vulnerability privately, the
  versions that get fixes, and what the `--allow` flags protect against and
  what they don't.

## Limits

- Tasks take turns: one thread runs Moth at a time, and lets the others run
  every so often and whenever it waits, so a task keeps a program from
  waiting, but doesn't make a sum faster on more cores. On the JavaScript
  engines a task runs to its end when it's started, so one there that waits
  for something the program does after starting it, a lock it holds or a
  queue it sends to, waits for ever. sync.moth's locks and queues wait by
  looking again every millisecond, not by being woken.
- The shell runs each entry as a program of its own, and keeps names' values
  from one to the next by saving them: a value that can't be saved (a function,
  bytes) is nothing in the next entry, two names holding the same list hold
  copies of it after the entry, a task doesn't outlive its entry, and an entry
  that ends with a mistake keeps nothing it set. Ctrl+C ends the shell too.
- A function with `give` in it runs to its end before the list it gives is
  there, so one that never ends never gives anything, where a Python
  generator can be read only as far as it's needed.
- Numbers of any size are big.moth's and fractions.moth's text, worked out
  by calling their functions, not with `+` and `*`; Moth's own numbers are
  64-bit, exact as whole numbers up to 2 to the power of 53.
- A mistake passed on after `either way` is reported where the `try` is, with
  its message (or what `fail with` gave), not where it happened, and with no
  calls under it; `stop the program` in a `try` ends the program without
  running what's after `either way`.
- `moth debug` stops before a line, not inside one. `show` works out sums of
  the variables the line can see (`show x + 1`, `show item 2 of xs`, `show
  rex's age`), but can't call a function. At a mistake it stops
  after the report, with what the line could see, for `show`, `vars`,
  `where` and `list`, and then the program ends as it always does. A program
  built to be debugged is slower: before every line it asks the debugger
  whether to stop, and keeps its loops' variables in memory.
- A program learns about the world through `ask`, its files, the sites it
  reads, its arguments, the clock, and in an app, keys, clicks and timers. In
  the playground, files last for one run, only sites that let any page read
  them can be read, and answering a question runs the program again from the
  start, so a `wait` before it waits again. On Linux a program goes online
  through `curl`, so where curl isn't installed it can't.
- `send` only POSTs: there's no PUT, PATCH or DELETE yet. A `send`, or a `read`
  with headers, doesn't follow a move to another address, so a header like
  Authorization never goes on to another site; in the playground the browser
  follows it, and keeps such headers to the same site itself. JSON's numbers
  are written to 15 digits, as Moth shows numbers.
- `the time` and the rest are the time where the program runs. A program built
  for Linux reads its time zone from /etc/localtime when it starts (not TZ);
  for years past the last change that file lists, it keeps the last one, which
  can be an hour out in summer.
- `save` can't save functions, bytes or amounts with units, and numbers come
  back to 15 digits, as Moth shows and compares them.
- A sound is one plain tone, from 20 to 20,000 hertz, for up to a minute: no
  chords, instruments or sound files. A program `moth build` makes plays its
  sounds on Windows, at a terminal or started from Explorer; on Linux, or with
  its output going to a file or another program, it's silent, and
  `MOTH_SOUND=tune.wav` writes its sounds into that file instead.
- `draw picture` reads PNG and BMP files, up to 4096 by 4096 pixels, not JPEG
  or GIF. In the playground, a program reads the files picked with Files or
  dropped on the page; they stay on the page and aren't kept once it's closed.
- Units go one at a time: there's no speed, like km per hour, yet; dividing a
  distance by a time is a mistake. Temperatures aren't units either.
- A table's cells are numbers, text or nothing: dates stay text.
- An app runs in the playground, and can't `ask` or choose a file once it's
  running. A slider's value is a whole number.
- A text box holds one line of up to 40 letters, and a text area 2,000, drawn a
  letter every 10 pixels in a font whose letters take the same room: there's no
  undo, and no double-click or Ctrl+arrow to go a word at a time. A text area
  doesn't wrap long lines; it scrolls across. A button's size comes from how
  many letters its label has, not how wide they are, so a label of wide letters
  can reach its edges.
- A list chooses one item at a time.
- `use` without `as` puts a file's names in with the program's, where they can
  collide; `use ... as` keeps the file to itself, as if it ran alone, so its
  functions' variables are theirs and the program reaches it only through
  `math's ...`. It only reads files in the program's folder, or folders inside
  it: not `../lib.moth`, and not through a link out. A file it uses uses files
  from its own folder.
- Packages come from Git repositories, through the system's `git`, found by
  where they are or by their name in the package index; one can be asked
  for at a tag, branch or commit (`thing@v1.2`), not a range of versions;
  and `moth.packages` keeps only one of each name, the first, if two packages
  want different commits of a third. A package's sum covers every file in its
  folder, so one with files that differ only in case can't be checked out the
  same on Windows as on Linux, and one with Git LFS files has the sum of what
  LFS fetched.
- In text, a `{` right before a letter or a bracket starts a value, so text
  that means one there as itself, as curl's `%{http_code}` does, needs `\{`.
  One right before a number is itself, as in `"\\d{3}"`, so a value that starts
  with a number goes in brackets: `{(3 * n)}`.
- The handwriting reader learned from shapes, not people, so unusual ways of
  writing a digit can fool it.
- The WebAssembly engine needs WebAssembly GC: Node 22, Chrome 119, Firefox 120,
  Safari 18.2, or later; on an older browser the playground starts on the JIT.
- A program in machine code takes a few milliseconds to start, and on Windows
  more while the virus checker looks it over, which is most of a short
  program's time. It has no limit on its steps, so a loop that never ends runs
  until it's stopped.
- `moth build` makes programs for x86-64 Windows and Linux, not for Macs.
- A library's function takes a structure by where it is, or with `by value`
  as itself (`a point by value`), and gives one either way; a structure's
  fields are whole numbers of 8 to 64 bits (`a byte`, `a short whole
  number`, `an unsigned whole number` and the rest), numbers, floats,
  pointers, text, other structures and callbacks. Its whole numbers are
  exact up to 2^53. C can call a callback on any thread, its own too, while
  the program waits in one of a library's functions, or between its own
  lines (a program with callbacks takes turns as one with tasks does), and
  there can be 64 functions of each kind of callback at once; a mistake in
  one ends the program, as a mistake in an app's handler does. A mistake in a library can
  crash the program. On Linux a program that uses one needs glibc's dynamic linker, as
  nearly every Linux has, and finds a library by its name as the system's
  linker does: `"sqlite3"` is libsqlite3.so, or .so.0 to .so.9. On Windows
  `"user32"` is user32.dll, from System32, or else the program's folder.
- The window only opens at a terminal, or on Windows when started from
  Explorer: with its output going to a file or another program, a program that
  draws ends without showing it. On Linux it needs an X server (Xwayland's
  will do) at `DISPLAY`, on this computer, and draws its text in DejaVu Sans,
  not Segoe UI. It has no clipboard there, so Ctrl+C, Ctrl+X and Ctrl+V do
  nothing; no pad, so a question that starts with "Draw" is asked as any other;
  and no box for choosing a file, which is asking for its name. The window
  knows CSS's colour names, `#` colours, `rgb()`, `rgba()`, `hsl()` and
  `hsla()`, but not `hwb()`, `lab()` or the other newer ones.
- `say ... to the error output`, `stop the program`, `run program` (with or
  without `keeping its output`) and `remove the file` only work in a program
  `moth build` makes: in the playground and the tests, the error output is
  shown as a mistake is and an exit code just ends the run, and starting a
  program is a mistake that says so.
- `moth test` on its own sorts the files it finds as `localeCompare` sorts
  letters, digits and the marks on a keyboard; any other character comes after
  them, by its bytes, which isn't always where `localeCompare` puts it.
- A program ends with a number from 0 to 255, which is all Linux keeps. A
  program `run program` starts gives back the number the system reports: on
  Linux the number it ended with, or 128 and the signal's number if one ended
  it; on Windows whatever it ended with, which for a crash is a huge number, so
  `moth run` ends with 1 instead of passing one of those on. On Linux a program
  that `run program` names without a `/` is looked for in PATH, as a shell looks
  for it, and one it finds but may not run is "no program called that". On
  Windows one named without a folder is looked for in the system's folder, then
  Windows', then PATH, but never beside the program or in the folder it runs
  from: name one there as `./tool.exe`. A `.bat` or `.cmd` file runs in
  cmd.exe, so it can't be given an argument holding `" % ^ & | < > !` or a line
  break, which cmd.exe would read as part of a command.
- `moth check` works the types out as the checker does, and says what it says
  word for word, but leaves out the warnings that rest on a value written out
  (`1 / 0`, `item 0 of x`, `repeat "x" times`), which need the value, not its
  type. The playground's Problems pane, and the VS Code extension, find those
  too.
- JavaScript stops code nested more deeply than its stack allows (about 900
  brackets, or a list held 2,000 deep) with a mistake.

<details>
<summary>The rest</summary>

- These words are part of the language and can't be variable names: `set add
  say if else end repeat while for to return and or not is yes no nothing list
  empty length item move turn pen record fail stop ask use try uppercase
  lowercase split join number position dictionary remove keys in byte bytes as
  shift read write arguments expect clear draw when every`. And `total`,
  `average`, `largest` and `smallest` followed by `of` work something out from a
  list, so a record's field with one of those names can't be read with `of`.
- There's no word yet for asking what kind a value is (a number, text, a list...).
- Bits work on whole numbers from 0 to 2^53 − 1, the most a Moth number holds
  exactly.
- Recursion goes up to 100,000 calls deep.
- The checker only warns when it is sure, so it misses some mistakes: the length
  of a list, and a name used before the line that sets it.
- The playground shows the first 10,000 lines of output, and the debugger
  records the first 10,000 steps.
- The compiler written in Moth gives up on code nested more than about 245
  brackets deep (the JIT goes to about 1,000), and on text holding half an emoji,
  which no file can hold.

</details>

## Run it from the source

```bash
npm test                     # everything above, in a few minutes
npm run bench                # the engines, timed
npm run versus               # Moth against C, Rust and Python
node bootstrap.mjs           # moth.exe (moth on Linux), made from the source
python -m http.server        # then open http://localhost:8000 for the playground
```

[CONTRIBUTING.md](CONTRIBUTING.md) has the rest: how the parts fit together, and
how to make a change.

<br>

<p align="center"><sub>Apache 2.0 licensed (<a href="LICENSE">LICENSE</a>, <a href="NOTICE">NOTICE</a>) · made by <a href="https://github.com/samyyy2423">Samyak Pudke</a> · the letters a Linux window draws are DejaVu's (<a href="LICENSE-DejaVu">licence</a>)</sub></p>
