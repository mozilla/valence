'use strict';

var assert = require('assert');

var volcan = require("volcan");
var Port = require("volcan/port");

// This is just a temp test while I set up the thing.
describe('grunt-webdriverjs test', function () {
    it('checks if title contains the search query', function(done) {
        return;
        var port = new Port.Port(8123, "localhost");
        console.log("testing...");
        volcan.connect(port).then(function(root) {
            console.log("connected...");
            return root.echo("hello");
        }).then(function(greeting) {
            console.log("got a greeting");
            assert(greeting === "hello");
        });//.then(done);
    });

});
