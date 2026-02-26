const { env } = require('sdk/system/environment');
const main = require('../lib/main');
const task = require("../lib/util/task");
const { ProtocolClient } = require("./client");

const prefs = require("sdk/preferences/service");

prefs.set("devtools.debugger.log", true);

// XXX: We need to move runtime definition around a bit in main.js

let FirefoxRuntime = {
  getName: function() {
    "Local Firefox"
  },
  connect: function(connection) {
    const { DebuggerServer } = require("resource://gre/modules/devtools/dbg-server.jsm");
    if (!DebuggerServer.initialized) {
      DebuggerServer.init();
      DebuggerServer.addBrowserActors();
    }

    return DebuggerServer.connectPipe();
  }
}

exports.connect = task.async(function*() {
  console.log("BEGINNING CONNECT");
  let transport = FirefoxRuntime.connect();
  let client = new ProtocolClient(transport);
  yield client.ready();
  console.log("ENDING CONNECT");
  return client;
});

