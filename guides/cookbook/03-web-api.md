# Call a web API

`read` reads a site as well as a file. With `json's parse`, that's a JSON API in two lines. A program that
reaches the network asks first, unless it runs with `--allow-net`: `moth run --allow-net stars.moth`.

```moth
use "json.moth" as json

set repo to json's parse(read "https://api.github.com/repos/samyyy2423/moth")
say item "full_name" of repo + " has " + item "stargazers_count" of repo + " stars"
```

For more than a GET (other methods, headers, a body of JSON, a status to check), `http.moth` has them all.
It runs on sockets of its own, so it needs `--allow-libraries` too:

```moth
use "http.moth" as http

set answer to http's post("https://httpbin.org/post", record with name "Sam", score 91)
http's check(answer)
say status of answer
say text of answer
```
