(function() {
  var ProxyServer, _, crypto, elf, fs, h, http, pg, sys, url;
  sys = require('sys');
  fs = require('fs');
  http = require('http');
  url = require('url');
  crypto = require('crypto');
  require.paths.unshift(__dirname + '/../lib/node-elf-logger/lib/');
  elf = require("elf-logger");
  h = require(__dirname + '/../lib/helpers.js');
  _ = require(__dirname + '/../lib/underscore/underscore.js');
  pg = require(__dirname + '/../lib/node-postgres/lib');
  pg.defaults.poolSize = 10;
  exports.createProxy = function(configFilenameOrConfiguration, callback) {
    return new ProxyServer(configFilenameOrConfiguration, callback);
  };
  ProxyServer = function(configFilenameOrConfiguration, callback) {
    var self;
    if (typeof (configFilenameOrConfiguration) === 'object') {
      this.config = configFilenameOrConfiguration;
      return this.startServer(callback);
    } else {
      self = this;
      return fs.readFile(configFilenameOrConfiguration, function(err, data) {
        if (err) {
          throw err;
        }
        self.config = JSON.parse(data);
        return self.startServer(callback);
      });
    }
  };
  ProxyServer.prototype.startServer = function(callback) {
    var host, inst, port, server;
    host = this.config.host || 'localhost';
    port = parseInt(this.config.port || '7070');
    inst = this;
    server = http.createServer(function(req, resp) {
      var action, credentials, dbName, parts;
      credentials = inst.config.users || {};
      if (inst.hasValidCredentials(req, resp)) {
        parts = url.parse(req.url).pathname.split('/').splice(1);
        action = parts[0];
        dbName = parts[1];
        if (action === undefined || dbName === undefined) {
          return h.sendError(resp, "invalid action or database '" + action + "'/'" + dbName + "'", 404);
        } else {
          switch (req.method) {
            case 'GET':
              return inst.handleGET(req, resp, action, dbName);
            case 'POST':
              return inst.handlePOST(req, resp, action, dbName);
            default:
              return h.sendError(resp, 'Method Not Allowed: ' + sys.inspect(req.method), 405);
          }
        }
      }
    });
    server.listen(port, host);
    console.log('listening on ' + host + ':' + port);
    elf.createLogger(server, {
      'stream': process.stdout
    });
    return callback ? callback(server) : null;
  };
  ProxyServer.prototype.hasValidCredentials = function(req, resp) {
    var _i, _len, _ref, auth, creds, digest, encoding, hmac, secret, secrets;
    digest = req.headers['x-sig'];
    secrets = this.config.secrets;
    if (digest && secrets) {
      _ref = secrets;
      for (_i = 0, _len = _ref.length; _i < _len; _i++) {
        secret = _ref[_i];
        hmac = crypto.createHmac('sha1', secret);
        hmac.update(req.url);
        if (digest === hmac.digest(encoding = 'hex')) {
          return true;
        }
      }
    }
    auth = req.headers['authorization'];
    creds = h.decodeBase64Authorization(auth);
    if (!creds) {
      h.sendError(resp, 'missing credentials', 403);
      return false;
    }
    if (this.config.users[creds.username] !== creds.password) {
      h.sendError(resp, 'invalid credentials', 403);
      return false;
    }
    return true;
  };
  ProxyServer.prototype.handleGET = function(req, resp, action, dbName) {
    var clientData, query, self;
    self = this;
    query = url.parse(req.url, true).query;
    clientData = '';
    if (query) {
      clientData = query.sql;
    }
    return clientData === '' || action !== 'sql' ? h.sendError(resp, "'sql' Parameter missing on GET request or path does not start with '/sql/'", 400) : self.databaseConnection(dbName, function(err, client) {
      return err ? h.sendError(resp, 'problem connectiong to the database: ' + sys.inspect(err), 500) : self.handleSQLquery(self, client, resp, clientData);
    });
  };
  ProxyServer.prototype.handlePOST = function(req, resp, action, dbName) {
    var clientData, self;
    self = this;
    clientData = '';
    req.on('data', function(data) {
      return clientData += data;
    });
    return req.on('end', function() {
      return self.databaseConnection(dbName, function(err, client) {
        if (err) {
          return h.sendError(resp, err.message, err.status);
        } else {
          switch (action) {
            case 'sql':
              return !/text-plain/.test(req.headers['content-type']) ? h.sendError(resp, "encode SQL as text/plain", 415) : self.handleSQLquery(self, client, resp, clientData);
            case 'json':
            case 'upsert':
              return self.handleJSONquery(self, client, resp, clientData);
            default:
              return h.sendError(resp, "invalid action '" + action + "' found", 404);
          }
        }
      });
    });
  };
  ProxyServer.prototype.handleJSONquery = function(self, client, resp, clientData) {
    var _i, _len, _ref, _result, query;
    query = h.parseJSON(clientData);
    if (!query || !query.table || !query.data) {
      return h.sendError(resp, 'invalid query JSON found: ' + clientData, 400);
    } else {
      _result = []; _ref = query.data;
      for (_i = 0, _len = _ref.length; _i < _len; _i++) {
        (function() {
          var row = _ref[_i];
          return _result.push(h.execSqlCount(client, query.table, row, function(err, rowCnt) {
            var res, sql;
            if (err) {
              return h.sendError(resp, 'Database Error: ', 500);
            } else {
              if (rowCnt > 0) {
                sql = h.buildSqlUpdate(query.table, row);
              } else {
                sql = h.buildSqlInsert(query.table, row);
              }
              return (res = client.query(sql, function(err, rs) {
                var headers;
                if (err) {
                  client.query('rollback');
                  h.sendError(resp, 'Database Error: ' + err.message + ' - SQL: ' + sql, 500);
                } else {

                }
                headers = {
                  'Content-Type': 'application/json; encoding=utf-8'
                };
                resp.writeHead(200, _.extend(self.config.responseHeaders || {}, headers));
                return resp.end('{"success": true}');
              }));
            }
          }));
        })();
      }
      return _result;
    }
  };
  ProxyServer.prototype.handleSQLquery = function(self, client, resp, query) {
    return client.query(query, function(err, rs) {
      var headers;
      if (err) {
        client.query('rollback');
        return h.sendError(resp, err.message + ' - SQL: ' + query, 500);
      } else {
        client.query('commit');
        rs.success = true;
        headers = {
          'Content-Type': 'application/json; encoding=utf-8'
        };
        resp.writeHead(200, _.extend(self.config.responseHeaders || {}, headers));
        return resp.end(JSON.stringify(rs));
      }
    });
  };
  ProxyServer.prototype.databaseConnection = function(dbName, callback) {
    var database;
    if (!(dbName in this.config['databases'])) {
      return callback({
        status: 404,
        message: 'configuration for database "' + dbName + '" does not exist'
      });
    } else {
      database = this.config['databases'][dbName];
      return pg.connect('pg://' + database, callback);
    }
  };
}).call(this);
