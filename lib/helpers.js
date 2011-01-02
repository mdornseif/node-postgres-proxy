(function() {
  var SQLstringify, _, field_value_mapper, sys;
  sys = require("sys");
  _ = require(__dirname + "/../lib/underscore/underscore.js");
  exports.decodeBase64Authorization = function(authheader) {
    var auth, ret, value;
    if (!authheader) {
      return null;
    }
    value = authheader.match("^Basic\\s([A-Za-z0-9+/=]+)$");
    if (value) {
      auth = new Buffer(value[1] || "", "base64").toString("ascii");
      ret = {
        username: auth.slice(0, auth.indexOf(":")),
        password: auth.slice(auth.indexOf(":") + 1, auth.length)
      };
      return ret;
    } else {
      return null;
    }
  };
  exports.sendError = function(resp, error, status) {
    console.log('# error: ' + error + ': ' + status);
    resp.writeHead(status || 500, {
      'Content-Type': 'application/json; encoding=utf-8'
    });
    resp.end(JSON.stringify({
      'success': false,
      'error': error
    }));
    return false;
  };
  exports.sendError = function(resp, error, status) {
    console.log("# error: " + error + ": " + status);
    resp.writeHead(status || 500, {
      'Content-Type': "application/json"
    });
    resp.end(JSON.stringify({
      success: false,
      error: error
    }));
    return false;
  };
  exports.parseJSON = function(data) {
    try {
      return JSON.parse(data);
    } catch (error) {
      console.log(error);
      return undefined;
    }
  };
  exports.buildSqlInsert = function(table, data) {
    var fields, mapper, values;
    if (data === undefined || !data.conditions || !data.values) {
      return '';
    }
    fields = [];
    values = [];
    mapper = function(value, field) {
      fields.push(field);
      return values.push(SQLstringify(value));
    };
    _.each(data.conditions, mapper);
    _.each(data.values, mapper);
    return "INSERT INTO " + table + " (" + fields.join(", ") + ") VALUES (" + values.join(",") + ")";
  };
  exports.buildSqlUpdate = function(table, data) {
    var conditions, values;
    conditions = _.map(data.conditions, field_value_mapper).join(' AND ');
    values = _.map(data.values, field_value_mapper).join(',');
    if (data === undefined || !data.conditions || !data.values) {
      return '';
    }
    return 'UPDATE "' + table + '" SET ' + values + ' WHERE ' + conditions;
  };
  exports.execSqlCount = function(client, table, query, callback) {
    var conditions;
    conditions = _.map(query.conditions, field_value_mapper).join(' AND ');
    query = "SELECT COUNT(*) FROM " + table + " WHERE " + conditions;
    return client.query(query, function(err, rs) {
      var rowCnt;
      rowCnt = 0;
      if (!err) {
        rowCnt = rs.rows[0].count;
      }
      return callback(err, rowCnt);
    });
  };
  SQLstringify = function(value) {
    switch (typeof value) {
      case 'string':
        return "'" + value.replace("'", "''") + "'";
      case 'number':
      case 'boolean':
      case 'null':
        return String(value);
      default:
        return String(value);
    }
  };
  field_value_mapper = function(value, field) {
    return field + "=" + SQLstringify(value);
  };
}).call(this);
