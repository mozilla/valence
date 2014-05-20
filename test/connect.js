'use strict';

var assert = require('assert');

var volcan = require("volcan");
var Port = require("volcan/port");

var helpers = require('./lib/test-helpers');

// This is just a temp test while I set up the thing.
describe('connect tab test', function () {
  it('checks if we can load and connect to a tab', function(done) {
    helpers.connectTab(browser, "http://localhost:8910/traversal.html").then(function(items) {
      assert(items.tab.url, "http://localhost:8910/traversal.html");
    }).then(done);
  });
});
