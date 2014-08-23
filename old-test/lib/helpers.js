// Helper methods for testing Firefox Adapters
const { Cu } = require("chrome");
const { startServerAsync } = require("sdk/test/httpd");
const task = require("lib/util/task");
const { Class } = require("sdk/core/heritage");
const unload = require("sdk/system/unload");

// For the firefox tests.
Cu.import("resource://gre/modules/devtools/Loader.jsm");
Cu.import("resource://gre/modules/devtools/dbg-client.jsm");
Cu.import("resource://gre/modules/devtools/dbg-server.jsm");
