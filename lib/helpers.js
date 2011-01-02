/**
 * some generic helper functions for the PostgreSQL proxy
 * (c) 2010 Axel Schlueter
 */

var sys = require('sys'),
    _ = require(__dirname + '/../lib/underscore/underscore.js');


// helper function, deconstruct a base64 auth string into username and password
exports.decodeBase64Authorization = function(str) {
  if(!str)
    return null;
  var value;
  if(value = str.match("^Basic\\s([A-Za-z0-9+/=]+)$")) {
    var auth = (new Buffer(value[1] || "", "base64")).toString("ascii");
    return {
      username : auth.slice(0, auth.indexOf(':')),
      password : auth.slice(auth.indexOf(':') + 1, auth.length)
    };
  }
  else
    return null;
};

// helper function, create an error message for the caller
exports.sendError = function(resp, error, status) {
  console.log('# error: ' + error + ': ' + status);
  resp.writeHead(status || 500, {'Content-Type': 'application/json; encoding=utf-8'});
  resp.end(JSON.stringify({'success': false, 'error': error}));
  return false;
}

// helper function, try to parse the given data as a JSON object, then return it
// as a Javascript object. If the input is invalid, `undefined` will returned.
exports.parseJSON = function(data) {
  try {
    return JSON.parse(data);
  }
  catch(error) {
    return undefined;
  }
}

// helper function, convert the given query object from the upsert
// command into an SQL update 
exports.buildSqlInsert = function(table, data) {
  if(data == undefined || !data.conditions || !data.values)
    return '';
  var fields = [], values = [],
      mapper = function(value, field) {
        fields.push(field);
        values.push(SQLstringify(value));
      };

  _.each(data.conditions, mapper);
  _.each(data.values, mapper);
  return 'insert into '
    + table
    + ' ('
    + fields.join(', ')
    + ') values ('
    + values.join(',')
    + ')';
}

// convert the given query object from the upsert command into an SQL update 
exports.buildSqlUpdate = function(table, data) {
  if(data == undefined || !data.conditions || !data.values)
    return '';
  var conditions = _.map(data.conditions, field_value_mapper).join(' AND '),
      values = _.map(data.values, field_value_mapper).join(',');
  return 'UPDATE "' + table + '" SET ' + values + ' WHERE ' + conditions;
}

// build a SQL count(*) statement for the given table and conditions
exports.execSqlCount = function(client, table, query, callback) {
  var conditions = _.map(query.conditions, field_value_mapper).join(' AND ');
  var query = 'SELECT COUNT(*) FROM "' + table + '" WHERE ' + conditions;
  client.query(query, function(err, rs) {
    var rowCnt = 0;
    if(!err)
        rowCnt = rs.rows[0].count;
    callback(err, rowCnt);
  });
}

SQLstringify = function(value) {
  switch (typeof value) {
    case 'string':
      return "'" + value.replace("'", "''") + "'";
    case 'number':
    case 'boolean':
    case 'null':
    default:
      // If the value is a number, boolean or null, convert it to a string.
      return String(value);
    };
};

function field_value_mapper(value, field) {
  return field + "=" + SQLstringify(value);
}
