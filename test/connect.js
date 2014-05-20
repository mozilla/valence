'use strict';

var assert = require('assert');

var volcan = require("volcan");
var Port = require("volcan/port");

// This is just a temp test while I set up the thing.
describe('grunt-webdriverjs test', function () {
    it('checks if we can connect to a debugger server', function(done) {
        var port = new Port.Port(9223, "localhost");
        volcan.connect(port).then(function(root) {
            return root.echo("hello");
        }).then(function(greeting) {
            assert(greeting === "hello");
        }).then(done);
    });
});
