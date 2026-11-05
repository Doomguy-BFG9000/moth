# Read, change and write JSON

`json's parse` turns JSON into Moth's own values: an object becomes a dictionary, an array a list, true and
false yes and no, and null nothing. `as json` turns any of them back.

```moth
use "json.moth" as json

set order to json's parse("\{\"id\": 7, \"items\": [\{\"name\": \"tea\", \"price\": 3.5}, \{\"name\": \"cake\", \"price\": 4.25}]}")
set total to 0
for each thing in item "items" of order
    set total to total + item "price" of thing
end
say "order " + item "id" of order + " costs " + total

set item "total" of order to total
write order as json to "order.json"
say read "order.json"
```

```output
order 7 costs 7.75
{"id":7,"items":[{"name":"tea","price":3.5},{"name":"cake","price":4.25}],"total":7.75}
```

A mistake in the JSON is a `fail with` that says where it is, so `try` can catch it:

```moth
use "json.moth" as json

try
    set data to json's parse("\{\"name\": \"Sam\",}")
if it fails with why
    say "not JSON: " + why
end
```

```output
not JSON: JSON, letter 16: expected a key in quotes but found }
```
