const {emit} = require("../devtools/event"); // Needs to share a loader with protocol.js, boo.
const task = require("../util/task");

const protocol = require("../devtools/server/protocol");
const {asyncMethod} = require("../util/protocol-extra");
const {Actor, ActorClass, Pool, method, Arg, Option, RetVal, types} = protocol;
const {ChromiumWalkerActor} = require("./walker");
const {ChromiumPageStyleActor} = require("./styles");
const {ChromiumHighlighterActor} = require("./highlighter");

var ChromiumInspectorActor = ActorClass({
  typeName: "chromium_inspector",

  initialize: function(tab) {
    Actor.prototype.initialize.call(this, tab.conn);
    this.tab = tab;
    this.rpc = tab.rpc;
  },

  getWalker: asyncMethod(function(options={}) {
    if (!this.walkerPromise) {
      this.walker = ChromiumWalkerActor(this.tab, options);
      this.walkerPromise = this.walker.init();
    }
    return this.walkerPromise;
  }, {
    request: {},
    response: {
      walker: RetVal("chromium_domwalker")
    }
  }),

  getPageStyle: method(function(options={}) {
    if (!this.pageStylePromise) {
      this.pageStyle = ChromiumPageStyleActor(this);
    }
    return this.pageStyle;
  }, {
    request: {},
    response: {
      pageStyle: RetVal("chromium_pagestyle")
    },
  }),

  getHighlighter: asyncMethod(function*(autohide) {
    if (!this.highlighter) {
      yield this.getWalker();
      this.highlighter = ChromiumHighlighterActor(this, autohide);
    }

    return this.highlighter;
  }, {
    request: { autohide: Arg(0, "boolean") },
    response: { highligter: RetVal("chromium_highlighter") }
  })
});
exports.ChromiumInspectorActor = ChromiumInspectorActor;
