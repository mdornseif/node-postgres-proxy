# some generic helper functions for the PostgreSQL proxy
# (c) 2010, 2011 Axel Schlueter, Maximillian Dornseif for HUDORA

sys = require("sys") 
_ = require(__dirname + "/../lib/underscore/underscore.js")


exports.decodeBase64Authorization = (authheader) ->
    if !authheader
        return null
    value = authheader.match("^Basic\\s([A-Za-z0-9+/=]+)$")
    if value
        auth = new Buffer(value[1] or "", "base64").toString("ascii")
        ret =
            username: auth.slice(0, auth.indexOf(":"))
            password: auth.slice(auth.indexOf(":") + 1, auth.length)
        return ret
    else
        return null


# create an error message for the caller
exports.sendError = (resp, error, status) ->
  console.log('# error: ' + error + ': ' + status);
  resp.writeHead(status || 500, {'Content-Type': 'application/json; encoding=utf-8'});
  resp.end(JSON.stringify({'success': false, 'error': error}));
  return false


exports.sendError = (resp, error, status)->
  console.log("# error: " + error + ": " + status)
  resp.writeHead(status or 500, 'Content-Type': "application/json")
  resp.end(JSON.stringify(success: false, error: error))
  return false


#try to parse the given data as a JSON object, then return it
# as a Javascript object. If the input is invalid, `undefined` will returned.
exports.parseJSON = (data) ->
    try 
        return JSON.parse(data)
    catch error
        console.log(error)
        return undefined


# helper function, convert the given query object from the UPSERT command into an SQL update 
exports.buildSqlInsert = (table, data) ->
    if data == undefined || !data.conditions || !data.values
       return ''
    fields = []
    values = []
    mapper = (value, field) ->
        fields.push(field)
        values.push(SQLstringify(value))
    _.each(data.conditions, mapper)
    _.each(data.values, mapper)
    return "INSERT INTO " + table + " ("+ fields.join(", ") + ") VALUES ("+ values.join(",")+ ")"


# convert the given query object from the upsert command into an SQL update
exports.buildSqlUpdate = (table, data)->
  conditions = _.map(data.conditions, field_value_mapper).join(' AND ')
  values = _.map(data.values, field_value_mapper).join(',')
  if(data == undefined || !data.conditions || !data.values)
      return ''
  return 'UPDATE "' + table + '" SET ' + values + ' WHERE ' + conditions


# build a SQL count(*) statement for the given table and conditions
exports.execSqlCount = (client, table, query, callback) ->
  conditions = _.map(query.conditions, field_value_mapper).join(' AND ')
  query = "SELECT COUNT(*) FROM " + table + " WHERE " + conditions
  client.query(query, (err, rs) ->
    rowCnt = 0
    if !err
      rowCnt = rs.rows[0].count
    callback(err, rowCnt)
  )


SQLstringify = (value) ->
  switch typeof value
    when 'string' then return "'" + value.replace("'", "''") + "'"
    when 'number', 'boolean', 'null'
      return String(value);
    else
      return String(value);


field_value_mapper = (value, field) ->
  return field + "=" + SQLstringify(value)
