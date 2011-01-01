/**
 * simple postgresql proxy taking queries via HTTP, then returning
 * the result as a JSON object
 * (c) 2010 Axel Schlueter
 */

var sys = require('sys');

// If you don't have a robust respawning infrastructure lile monit or daemontools,
// install a default error handler for all execptions not caught otherwise
//process.on('uncaughtException', function (err) {
//  sys.puts('uncaught exception found: ' + err);
//});

// then start the proxy itself
var proxy = require('./lib/node-postgres-proxy');
proxy.createProxy('./settings.json');

console.log("Started node-postgres-proxy")
