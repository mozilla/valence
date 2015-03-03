const {Cu} = require("chrome");
Cu.import("resource://gre/modules/Services.jsm");
Services.obs.addObserver(registerScanner, "webide-initialized", false);

// Add runtime entries to WebIDE
function registerScanner() {
  Services.obs.removeObserver(registerScanner, "webide-initialized");
  const scanner = require("./util/scanner");
  scanner.register();
}
