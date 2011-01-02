node-postgres-proxy - a simple HTTP proxy for PostgreSQL in node.js
===================================================================


Installation and configuration
------------------------------

* the proxy was developed with node v0.2.5, download it from http://nodejs.org/
* to use the proxy you have to install all required dependencies via `make dependencies`
* copy `settings.json.sample` to `settings.json`, then edit the configuration of the proxy.
  You should at least configure one database, because without a database configuration
  the proxy isn't exactly useful :)
* you can preconfigure headers to be included in the HTTP response to a query, e.g. a
  `Server`-header or `Cache-Control` to modify the caching behaviour of proxy clients.
  Currently it is not possible to configure dynamic headers, e.g. a timestamp or a value
  based on the incoming request.
* The original Sourcecode is written in [CoofeeScript 1.0][1]. Install it and run 
  `make default` to recompile the CoffeeScript into JAvascritp. This step is only needed,
  if you want to change the source.

[1]: http://jashkenas.github.com/coffee-script/
  

Authentication
--------------

You can configure some usernames and passwords in `settings.json` to allow access to the server. The
credentials must be send by the caller via HTTP BASIC AUTH. It is strongly suggested that you add a
HTTPS/SSL/TLS layer, e.g. by using the nginx proxy to protect the HTTP BASIC AUTH credentials.

You can also provide some HMAC authentication secrets in the `settings.json` so that no plaintext passwords
have to be send via BASIC AUTH. To generate the HMAC key for a request the caller has to compute the HMAC
SHA1 digest from the request URL and one of the preconfigured secrets. The digest must then be send in the
`X-sig` HTTP request header.

Header generation looks like this in Python:

    import hashlib, hmac, urllib, simplejson
    args_encoded = urllib.urlencode({'q': simplejson.dumps(args)})
    path = "/sql?" + args_encoded
    digest = hmac.new("sekrit_password", path, hashlib.sha1).hexdigest()
    huTools.http.fetch('http://ecample.com:8080' + path, headers={'X-sig': digest})

The HMAC signature hinders an attacker which can bserve arbritary requests to inject new requests. It does
not inhibit replay attacks and does not provide confidentiality. You might want to add an HTTPS/SSL/TLS
layer for that.


Querying a database
-------------------
  
Each configured database is available under its own endpoint URL, i.e. the database
`foobar` will be accessible under `http://localhost:7070/[action]/foobar`. The `action`
part of the path can either be `sql` or `upsert`, depending on the query format.

To execute a `sql` action query send SQL command via a GET request to the proxy:

    curl -u "top:secret" -G -data-urlencode "sql=SELECT COUNT(*) FROM persons" \
        http://localhost:7070/sql/node
    {'success': true,
     'rows': [ {'id': 1, 'name': 'Pierre Niemans'},
               {'id': 2, 'name': 'Max Kerkerian'},
               {'id': 3, 'name': 'Fanny Ferreira'}
             ]}

If you want non-idempotent semantics use POST with `text/pain` content:

    curl -u "top:secret" --data SELECT COUNT(*) FROM persons \
        --header "Content-Type: text-plain" http://localhost:7070/sql/node

You can also send a JSON formatted [UPSERT][2] (INSERT or UPDATE) to the `json` action. The JSON format
supports multiple rows to be inserted in a single request. The proxy will check if a row with the given
conditions exists and update it. If it doesn't exist an insert SQL query will be generated:

    curl -u "top:secret"
         -X POST --data '{"table": "persons",
                          "data": [{"conditions": {"id": 6, "age": 16},
                                    "values": {"name": "Judith Hérault"}},
                                   {"conditions": {"id": 5, "age": 7},
                                    "values": {"name": "Rémy Caillois", "age": 20}}]}'
         http://localhost:7070/json/node
    {'success': true}

All Request return the result as a JSON-formatted message. If the query was successful the field `success`
will contain the boolean value `true`. In case of an error `success` will be `false` and the field `error`
contains a textual error message. The return field `rows` contains the queried rows, if any.

[2]: http://en.wikipedia.org/wiki/Upsert

Unit testing
------------

There a few unit tests via the http://vowsjs.org unittesting framework. To execute the`tests` make target you
have to install vows:

      $ curl http://npmjs.org/install.sh | sh
      $ npm install vows
      $ make tests
