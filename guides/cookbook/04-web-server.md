# A web API with a database

`server.moth` gives each request to a function of the program's, which says what to send back: text, a list
or dictionary as JSON, or a record with a status. `sqlite.moth` keeps the data in a file. Together they're a
small API that lists and saves notes:

```moth
use "server.moth" as web
use "sqlite.moth" as sqlite

set db to sqlite's open("notes.db")
sqlite's run(db, "create table if not exists notes (id integer primary key, text text)")

to answer with request
    if path of request is "/notes" and method of request is "GET"
        return sqlite's query(db, "select id, text from notes order by id")
    end
    if path of request is "/notes" and method of request is "POST"
        sqlite's run_with(db, "insert into notes (text) values (?)", list of body of request)
        return record with status 201, body "saved"
    end
    return record with status 404, body "There's nothing at " + path of request
end

web's serve(8080, answer)
```

Run it with `moth run --allow-libraries --allow-read --allow-write notes.moth`, then try it:
`curl -d "buy milk" localhost:8080/notes` saves a note, and `curl localhost:8080/notes` lists them as JSON.

The server answers many people at once, and `web's serve_on_workers(8080, answer, 4)` answers on 4 cores.
`moth build notes.moth --allow-libraries --allow-read --allow-write` makes it a program of its own, to copy
to a server and run.
