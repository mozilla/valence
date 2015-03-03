const {Cu} = require("chrome");
const {gDevToolsBrowser} = Cu.import("resource:///modules/devtools/gDevTools.jsm");

// Add runtime entries to WebIDE
gDevToolsBrowser.isWebIDEInitialized.promise.then(() => {
  const scanner = require("./util/scanner");
  scanner.register();
});
