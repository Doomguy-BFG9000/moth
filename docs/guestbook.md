# Building a web app in Moth: a guestbook

This walks through [`apps/guestbook`](../apps/guestbook), a small web app written in Moth: a page where
people leave a message, kept in a SQLite database, with the messages as JSON too. It's about 160 lines, and
`moth build` turns it into one program of 1.3 MB that needs nothing installed, on Windows or Linux.

<p align="center"><img src="guestbook.png" width="640" alt="The guestbook in a browser: a form with a name and a message, a button that says Sign the guestbook, and three messages from Ada, Alan and Grace"></p>

## Run it

[Download Moth](https://github.com/samyyy2423/moth/releases/latest), then, in `apps/guestbook`:

```text
moth build guestbook.moth --allow-libraries --allow-read --allow-write
guestbook.exe                 (./guestbook on Linux)
```

Open http://localhost:8080/ and sign it. Give a port after it, `guestbook.exe 9000`, for another one. The
`--allow` flags are what the program may do, decided when it's built: use C libraries (the sockets and SQLite),
and read and write files (its database).

## Two files

- [`book.moth`](../apps/guestbook/book.moth) does the guestbook's own work: the database, the page, and what
  each request does. It never touches the network, so it can be tested without one.
- [`guestbook.moth`](../apps/guestbook/guestbook.moth) serves it, in 20 lines.

Everything else comes from Moth's standard library, which is built into `moth`: `server.moth` for the web
server, `sqlite.moth` for the database, `http.moth` for reading a form, `dates.moth` for the time, and
`text.moth` for patterns.

## The database

```
to open_book with path
    set db to sqlite's open(path)
    sqlite's run(db, "create table if not exists entries (id integer primary key autoincrement, name text not null, message text not null, signed text not null)")
    return db
end

to entries_of with db
    return sqlite's query(db, "select id, name, message, signed from entries order by id desc limit 100")
end
```

`sqlite's open` makes the file the first time. A query gives a list of rows, and each row is a dictionary of
its columns, so `item "name" of entry` is a name. SQLite comes with Windows (`winsqlite3.dll`) and with Linux,
so there's nothing to install.

## Reading what a form sends

A browser sends a form as `name=Ada+Lovelace&message=Hi%21`. `form_fields` splits it at each `&` and `=`, and
`http's decoded` turns `+` and `%21` back into a space and `!`:

```
to form_fields with body
    set fields to empty dictionary
    for each pair in split body by "&"
        set parts to split pair by "="
        if length of parts is 2
            set item (http's decoded(item 1 of parts)) of fields to http's decoded(item 2 of parts)
        end
    end
    return fields
end
```

## Signing, carefully

`sign` checks the entry, then adds it. It gives back `nothing` when it worked, or what's wrong, in words a
person can read:

```
    if name is ""
        return "Please write your name."
    end
    ...
    set signed to dates's format_date(dates's now(), "D MMM YYYY, hh:mm")
    sqlite's run_with(db, "insert into entries (name, message, signed) values (?, ?, ?)", list of name, message, signed)
    return nothing
```

The values go to SQLite as parameters, the `?`s, never as part of the SQL. So a name like
`Robert'); drop table entries; --` is just a name, stored as it was written. The tests sign exactly that.

## Showing it safely

Anything someone writes is shown as text, never as part of the page. `html_of` turns the five characters HTML
cares about into entities, so a "name" of `<script>...</script>` shows up as those letters and does nothing:

```
to html_of with words
    set made to empty list
    for each c in words
        if c is "&"
            add "&amp;" to made
        else if c is "<"
            add "&lt;" to made
        ...
    end
    return join made with ""
end
```

## Answering each request

`answer_with` is the whole app's map, one `if` for each address:

```
to answer_with with request, db
    set where to path of request
    if where is "/" and method of request is "GET"
        return page(entries_of(db), nothing, "", "")
    end
    if where is "/sign" and method of request is "POST"
        set fields to form_fields(body of request)
        set problem to sign(db, fields)
        if problem is nothing
            return record with status 303, headers (dictionary where "location" is "/"), body ""
        end
        ...
        return record with status 400, body page(entries_of(db), problem, name, message)
    end
    if where is "/api/entries" and method of request is "GET"
        return entries_of(db)
    end
    return record with status 404, body ...
end
```

- Text that starts with `<` is sent as a page.
- After signing, a `303` sends the browser back to `/`, so pressing Reload doesn't sign twice.
- A refused entry comes back as a `400` with the page again, the problem at the top, and what the person typed
  still in the form.
- A list is sent as JSON, so `/api/entries` is an API with no extra work:

  ```text
  $ curl http://localhost:8080/api/entries
  [{"id":3,"name":"Ada","message":"Hello from the first programmer!","signed":"4 Nov 2026, 21:52"}, ...]
  ```

## Serving it

```
use "server.moth" as web
use "book.moth" as book

set guestbook_port to 8080
if length of arguments is at least 1
    set guestbook_port to number of item 1 of arguments
end
set guestbook_db to book's open_book("guestbook.db")

to answer with request
    return book's answer_with(request, guestbook_db)
end

say "The guestbook is at http://localhost:" + guestbook_port + "/ (Ctrl+C stops it)"
web's serve(guestbook_port, answer)
```

`web's serve` gives each request to `answer`, as a record of its method, path, query, headers and body, and
sends back what it gives. It answers this computer alone; `serve_everywhere` answers every network it's on,
and `serve_secure` answers with HTTPS.

## Testing it

[`book.test.moth`](../apps/guestbook/book.test.moth) tests the guestbook with no network: reading forms,
escaping, every refusal, the SQL injection above, and each address, by calling `answer_with` with a request
made by hand.

```text
moth test book.test.moth --allow-libraries --allow-read --allow-write
✓ test_form_fields
✓ test_html_of
✓ test_signing
✓ test_answers
4 passed
```

Moth's own test suite goes further: it builds the guestbook with `moth.exe`, runs it, and signs it and reads
it over HTTP, as a browser would.

Writing those tests found a bug in Moth itself: in `text.moth`, a pattern like `^\s+|\s+$` didn't match
its first part when its last part repeated, so names kept their spaces at the start. It's fixed, with a test.

## Make it yours

- Let people delete their own messages, or show 20 at a time with a link to the next 20.
- Answer with HTTPS: `web's serve_secure(443, answer, "cert.pem", "key.pem")`.
- `moth build guestbook.moth --installer` makes a setup program that installs it like any other app.
- Or start from the [Learn Moth](https://samyyy2423.github.io/moth/learn.html) lessons, and come back.
