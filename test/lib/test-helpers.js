var connect = require("connect");
var path = require("path");

var volcan = require("volcan");
var Port = require("volcan/port");

var Promise = require("es6-promise").Promise;

// Set up an http server from which to load the test files.
var datadir = path.normalize(__dirname + "/../data");
console.log("Hosting " + datadir + " as http://localhost:8910");

connect().use(connect.static(datadir)).listen(8910);

/**
 * Connects a client to the test debugger server.
 */
exports.connect = function() {
  var port = new Port.Port(9223, "localhost");
  return volcan.connect(port);
}

function connectTab(browser, url) {
  exports.adapt(browser);

  var root;
  return exports.connect().then(function(root_) {
    root = root_;
    return browser.url(url).promise();
  }).then(function() {
    return root.listTabs();
  }).then(function(response) {
    return {
      root: root,
      tab: response.tabs[response.selected]
    }
  });
}
exports.connectTab = connectTab;

exports.adapt = function(webdriver) {
  if ("promise" in webdriver) {
    return webdriver;
  }

  webdriver.___promises = [];
  webdriver.promise = function() {
    console.log("promise called");
    this.___promise();
    return new Promise(function(resolve, reject) {
      console.log("adding a promise: " + this);
      this.___promises.push({ resolve: resolve, reject: reject });
    }.bind(this));
  }
  webdriver.addCommand("___promise", function(cb) {
    console.log("consuming a promise: " + this);
    var promise = this.___promises.shift()
    promise.resolve();
    cb();
  });
}
