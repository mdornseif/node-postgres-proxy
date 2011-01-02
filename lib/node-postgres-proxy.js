/**
 *postgresql proxy taking queries via HTTP, then returning the result as a JSON object
 * (c) 2010, 2011 Axel Schlueter, Maximillian Dornseif for HUDORa
 */

var sys = require('sys'),
    fs = require('fs'),
    http = require('http'),
    url = require('url'),
    crypto = require('crypto');


require.paths.unshift(__dirname + '/../lib/node-elf-logger/lib/');
var elf = require("elf-logger");

var pg = require(__dirname + '/../lib/node-postgres/lib');
pg.defaults.poolSize = 10;

var _ = require(__dirname + '/../lib/underscore/underscore.js'),
    h = require(__dirname + '/../lib/helpers.js');


// create and return a new proxy instance
exports.createProxy = function (configFilenameOrConfiguration, callback) {
  return new ProxyServer(configFilenameOrConfiguration, callback);
};

// proxy class constructor, read the configuration file, then start the server
function ProxyServer(configFilenameOrConfiguration, callback) {
  if(typeof(configFilenameOrConfiguration) == 'object') {
    this.config = configFilenameOrConfiguration;
    this.startServer(callback);
  }
  else {
    var self = this;
    fs.readFile(configFilenameOrConfiguration, function (err, data) {
      if(err) throw err;
      self.config = JSON.parse(data);
      self.startServer(callback);
    });
  }
}

// initialize the HTTP server, then start it
ProxyServer.prototype.startServer = function(callback) {
  var host = this.config.host || 'localhost';
  var port = parseInt(this.config.port || '7070');
  var inst = this;

  var server = http.createServer(function (req, resp) {
    var credentials = inst.config.users || {};
    if(inst.hasValidCredentials(req, resp)) {
      var parts = url.parse(req.url).pathname.split('/').splice(1);
      var action = parts[0];
      var dbName = parts[1];
      if(action == undefined || dbName == undefined) {
        h.sendError(resp, "invalid action or database '" + action + "'/'" + dbName + "'", 404);
      }
      else {
        switch(req.method) {
          case 'GET':
            inst.handleGET(req, resp, action, dbName);
            break;
          case 'POST':
            inst.handlePOST(req, resp, action, dbName);
            break;
          default:
            h.sendError(resp, 'Method Not Allowed: ' + sys.inspect(req.method), 405);
        };
      };
    }
  });

  server.listen(port, host);
  console.log('listening on ' + host + ':' + port);
  elf.createLogger(server, {'stream': process.stdout});
  if(callback)
    callback(server);
};

// check the request for a valid username/password combination. Or is 
// signed with a valid HMAC. If not successfull a HTTP 403 Forbidden 
// status gets generated and false will be returned. Otherwise the 
// function returns true.
ProxyServer.prototype.hasValidCredentials = function (req, resp) {
  // die we get a valid HMAC digest credential?
  var digest = req.headers['x-sig'],
      secrets = this.config.secrets;
  if(digest && secrets)
    for(i in secrets) {
      hmac = crypto.createHmac('sha1', secrets[i]);
      hmac.update(req.url);
      if(digest == hmac.digest(encoding='hex'))
        return true;
    }

  // but maybe we did get some HTTP BASIC AUTH credentials?
  var auth = req.headers['authorization'],
      creds = h.decodeBase64Authorization(auth);
  if(!creds) {
    h.sendError(resp, 'missing credentials', 403);
    return false;
  }

  // are these valid credentials?
  if(this.config.users[creds.username] != creds.password) {
    h.sendError(resp, 'invalid credentials', 403);
    return false;
  }

  // yes, everything's fine, let's move on
  return true;
}

// called to handle a single HTTP request
ProxyServer.prototype.handleGET = function (req, resp, action, dbName) {
  self = this;
  // get GET data if we got nothing via post so far
  query = url.parse(req.url, true).query
  clientData = '';
  if(query)
    clientData = query.sql;
  if (clientData == '' || action != 'sql')
     h.sendError(resp, "'sql' Parameter missing on GET request or path does not start with '/sql/'", 400);
  else {
    self.databaseConnection(dbName, function(err, client) {
      if (err) {
          h.sendError(resp, 'problem connectiong to the database: ' + sys.inspect(err), 500);
      }
      else {
          self.handleSQLquery(self, client, resp, clientData);
      };
    });
  };
};

ProxyServer.prototype.handlePOST = function (req, resp, action, dbName) {
  var self = this, clientData = '';
  // collect the parts of the POST query message
  req.on('data', function (data) {
    clientData += data;
  });
  
  // then execute the query on the database
  req.on('end', function () {
    self.databaseConnection(dbName, function(err, client) {
      if(err)
        h.sendError(resp, err.message, err.status);
      switch(action) {
        case 'sql':
          if(!/text-plain/.test(req.headers['content-type'])) {
            h.sendError(resp, "encode SQL as text/plain", 415);
          }
          else {
              self.handleSQLquery(self, client, resp, clientData);
          };
          break;
        case 'json':
        case 'upsert':
          self.handleJSONquery(self, client, resp, clientData);
          break;
        default:
          h.sendError(resp, "invalid action '" + action + "' found", 404);
      };
    });
  });
};

// called to handle a data merge
ProxyServer.prototype.handleJSONquery = function (self, client, resp, clientData) {
  var query = h.parseJSON(clientData);
  if(!query || !query.table || !query.data) {
    h.sendError(resp, 'invalid query JSON found: ' + clientData, 400);
    return;
  }
  
  for(i in query.data) {
    h.execSqlCount(client, query.table, query.data[i], function(err, rowCnt) {
      if(err) {
        h.sendError(resp, 'Database Error: ', 500);
      }
      else {
        if(rowCnt>0)
          sql = h.buildSqlUpdate(query.table, query.data[i]);
        else
          sql = h.buildSqlInsert(query.table, query.data[i]);
       
        if(err) {
          client.query('rollback');
          h.sendError(resp, 'Database Error: ' + err.message + ' - SQL: ' + sql, 500);
        }
        else {
          var headers = {'Content-Type': 'application/json; encoding=utf-8'};
          resp.writeHead(200, _.extend(self.config.responseHeaders || {}, headers));
          resp.end('{"success": true}');
        }; // else
      }; // if / else
    }); // function
  }; // for
}; // function

// called to handle a single query
ProxyServer.prototype.handleSQLquery = function (self, client, resp, query) {
  client.query(query, function(err, rs) {
    if(err) {
      client.query('rollback');
      h.sendError(resp, err.message + ' - SQL: ' + query, 500);
    }
    else {
      client.query('commit');
      rs.success = true;
      var headers = {'Content-Type': 'application/json; encoding=utf-8'};
      resp.writeHead(200, _.extend(self.config.responseHeaders || {}, headers));
      resp.end(JSON.stringify(rs));
    }
  });
};

// get the matching database connection for the request, either from
// the connection pool or create a new connection if none was found
ProxyServer.prototype.databaseConnection = function(dbName, callback) {
  // do we have a configuration for this database?
  if(!(dbName in this.config['databases'])) {
      callback({status: 404, message: 'configuration for database "' + dbName + '" does not exist'});
      return
  };

  // get a database connection from the pool and execute the query
  var database = this.config['databases'][dbName];
  pg.connect('pg://' + database, callback);
};

