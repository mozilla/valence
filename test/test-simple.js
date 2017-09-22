const connection = require("./connection");
const task = require("../lib/util/task");

exports.testSimple = function*(assert) {
  console.log("\n\n\n\n\nstarting connect");
  let client = yield connection.connect();
  console.log("\n\n\n\nending connect");

  console.log("I was able to handle this");
  let tab = yield client.root.getSelectedTab();
  console.log("got a selected tab!");

  console.log("parent for " + tab + " is " + tab.parent());

  yield tab.attach();

  yield tab.navigate("http://www.mozilla.org");

};

console.log("Is generator: " + exports.testSimple.isGenerator());

require('sdk/test').run(exports);
