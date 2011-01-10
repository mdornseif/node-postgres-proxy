# postgresql proxy taking queries via HTTP, then returning the result as a JSON object
#  (c) 2010, 2011 Axel Schlueter, Maximillian Dornseif for HUDORA

sys = require('sys')
fs = require('fs')
http = require('http')
url = require('url')
crypto = require('crypto')
require.paths.unshift(__dirname + '/../lib/node-elf-logger/lib/')
elf = require("elf-logger")
h = require(__dirname + '/../lib/helpers.js')
_ = require(__dirname + '/../lib/underscore/underscore.js')

pg = require(__dirname + '/../lib/node-postgres/lib')
pg.defaults.poolSize = 10

query_counter = 0
query_error_counter = 0
upsert_counter = 0
upsert_row_counter = 0
upsert_error_counter = 0
update_counter = 0
insert_counter = 0


# create and return a new proxy instance
exports.createProxy = (configFilenameOrConfiguration, callback) ->
    return new ProxyServer(configFilenameOrConfiguration, callback)

# proxy class constructor, read the configuration file, then start the server
ProxyServer = (configFilenameOrConfiguration, callback) ->
    if typeof(configFilenameOrConfiguration) == 'object'
        this.config = configFilenameOrConfiguration
        this.startServer(callback)
    else
        self = this
        fs.readFile(configFilenameOrConfiguration, (err, data) ->
            if(err)
                throw err
            self.config = JSON.parse(data)
            self.startServer(callback)
        )

# initialize the HTTP server, then start it
ProxyServer.prototype.startServer = (callback) ->
    host = this.config.host || 'localhost'
    port = parseInt(this.config.port || '7070')
    inst = this

    server = http.createServer((req, resp) ->
        credentials = inst.config.users || {}
        if url.parse(req.url).pathname == '/stats'
            stats = 
               'query_counter':        query_counter
               'query_error_counter':  query_error_counter
               'upsert_counter':       upsert_counter
               'upsert_row_counter':   upsert_row_counter
               'upsert_error_counter': upsert_error_counter
               'update_counter':       update_counter
               'insert_counter':       insert_counter
            resp.writeHead(200, {'Content-Type': 'application/json'})
            resp.end(JSON.stringify(stats))
        else
            if inst.hasValidCredentials(req, resp)
                parts = url.parse(req.url).pathname.split('/').splice(1)
                action = parts[0]
                dbName = parts[1]
                if action == undefined || dbName == undefined
                    h.sendError(resp, "invalid action or database '" + action + "'/'" + dbName + "'", 404)
                else 
                    switch req.method
                      when 'GET'
                        inst.handleGET(req, resp, action, dbName)
                      when 'POST'
                        inst.handlePOST(req, resp, action, dbName);
                      else
                        h.sendError(resp, 'Method Not Allowed: ' + sys.inspect(req.method), 405)
    )

    server.listen(port, host)
    console.log('listening on ' + host + ':' + port)
    elf.createLogger(server, {'stream': process.stdout})
    if callback
      callback(server)


# check the request for a valid username/password combination or being
# signed with a valid HMAC. If not successfull a HTTP 403 Forbidden 
# status gets generated and false will be returned. Otherwise the 
# function returns true.
ProxyServer.prototype.hasValidCredentials = (req, resp) ->
    # did we get a valid HMAC digest credential?
    digest = req.headers['x-sig']
    secrets = this.config.secrets
    if digest && secrets
        for secret in secrets
            hmac = crypto.createHmac('sha1', secret)
            hmac.update(req.url)
            if digest == hmac.digest(encoding='hex')
              return true

    # but maybe we did get some HTTP BASIC AUTH credentials?
    auth = req.headers['authorization']
    creds = h.decodeBase64Authorization(auth)
    if !creds
        h.sendError(resp, 'missing credentials', 403)
        return false
    
    # are these valid credentials?
    if this.config.users[creds.username] != creds.password
        h.sendError(resp, 'invalid credentials', 403)
        return false
    
    # yes, everything's fine, let's move on
    return true


# called to handle a single HTTP request
ProxyServer.prototype.handleGET = (req, resp, action, dbName) ->
    self = this
    # get GET data if we got nothing via post so far
    query = url.parse(req.url, true).query
    clientData = ''
    if query
      clientData = query.sql
    if clientData == '' || action != 'sql'
       h.sendError(resp, "'sql' Parameter missing on GET request or path does not start with '/sql/'", 400)
    else
        self.databaseConnection(dbName, (err, client) ->
            if err
                h.sendError(resp, 'problem connectiong to the database: ' + sys.inspect(err), 500)
            else
                self.handleSQLquery(self, client, resp, clientData)
        )

ProxyServer.prototype.handlePOST = (req, resp, action, dbName) ->
    self = this
    clientData = ''
    # collect the parts of the POST query message
    req.on('data', (data) -> clientData += data)
    
    # then execute the query on the database
    req.on('end', -> 
        self.databaseConnection(dbName, (err, client) ->
            if err
                h.sendError(resp, err.message, err.status)
            else
                switch action
                    when 'sql'
                        if not /text-plain/.test(req.headers['content-type'])
                            h.sendError(resp, "encode SQL as text/plain", 415)
                        else
                            self.handleSQLquery(self, client, resp, clientData)
                    when 'json', 'upsert'
                      self.handleJSONquery(self, client, resp, clientData)
                    else
                      h.sendError(resp, "invalid action '" + action + "' found", 404)
        )
    )


# called to handle UPSERT
ProxyServer.prototype.handleJSONquery = (self, client, resp, clientData) ->
    upsert_counter = upsert_counter + 1
    query = h.parseJSON(clientData)
    if !query || !query.table || !query.data
        h.sendError(resp, 'invalid query JSON found: ' + clientData, 400);
    else
        for row in query.data
            upsert_row_counter = upsert_row_counter + 1
            h.execSqlCount(client, query.table, row, (err, rowCnt) ->
                if err
                    upsert_error_counter = upsert_error_counter + 1
                    h.sendError(resp, 'Database Error: ', 500);
                else
                  if rowCnt > 0
                      update_counter =  update_counter + 1
                      sql = h.buildSqlUpdate(query.table, row);
                  else
                      insert_counter = insert_counter + 1
                      sql = h.buildSqlInsert(query.table, row);
                  res = client.query(sql, (err, rs) ->
                        if err
                            upsert_error_counter = upsert_error_counter + 1
                            client.query('rollback')
                            h.sendError(resp, 'Database Error: ' + err.message + ' - SQL: ' + sql, 500)
                        else
                        headers = {'Content-Type': 'application/json; encoding=utf-8'}
                        resp.writeHead(200, _.extend(self.config.responseHeaders || {}, headers))
                        resp.end('{"success": true}')
                  )
            )


# called to handle a single query
ProxyServer.prototype.handleSQLquery = (self, client, resp, query) ->
    query_counter = query_counter + 1
    client.query(query, (err, rs) ->
        if err
            query_error_counter = query_error_counter + 1
            client.query('rollback')
            h.sendError(resp, err.message + ' - SQL: ' + query, 500)
        else
            client.query('commit')
            rs.success = true
            headers = {'Content-Type': 'application/json; encoding=utf-8'}
            resp.writeHead(200, _.extend(self.config.responseHeaders || {}, headers))
            resp.end(JSON.stringify(rs))
    )


# get the matching database connection for the request, either from
# the connection pool or create a new connection if none was found
ProxyServer.prototype.databaseConnection = (dbName, callback) ->
    # do we have a configuration for this database?
    if not (dbName of this.config['databases'])
        callback({status: 404, message: 'configuration for database "' + dbName + '" does not exist'})
    else
        # get a database connection from the pool and execute the query
        database = this.config['databases'][dbName]
        pg.connect('pg://' + database, callback)

