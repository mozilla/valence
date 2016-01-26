const { gDevToolsBrowser } =
  require("./devtools-import")("resource://devtools/client/framework/gDevTools.jsm");

// Add runtime entries to WebIDE
function registerScanner() {
  const scanner = require("./util/scanner");
  scanner.register();
}
// In Firefox 39+ registration can be deferred until WebIDE is open
if (gDevToolsBrowser.isWebIDEInitialized) {
  gDevToolsBrowser.isWebIDEInitialized.promise.then(registerScanner);
} else {
  registerScanner();
}
