const { Cu } = require("chrome");
const { devtools } = Cu.import("resource://gre/modules/devtools/Loader.jsm", {});
module.exports = devtools.require("devtools/toolkit/transport/transport");
