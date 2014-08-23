
exports["test page load"] = function(assert) {
  assert.ok(true, "assert true works");
}

console.log("about to run!");
require("sdk/test").run(exports);
