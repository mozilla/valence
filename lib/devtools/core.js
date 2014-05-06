const { Cu } = require("chrome");
const { devtools } = Cu.import("resource://gre/modules/devtools/Loader.jsm", {});
const { gDevTools } = Cu.import("resource:///modules/devtools/gDevTools.jsm", {});
const unload = require("sdk/system/unload");
const { Class } = require("sdk/core/heritage");
const { merge } = require("sdk/util/object");

exports.devtoolsRequire = function(id) {
  return devtools.require(id);
}
