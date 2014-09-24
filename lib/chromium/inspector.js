const task = require("../util/task");

const protocol = require("../devtools-require")("devtools/server/protocol");
const {asyncMethod} = require("../util/protocol-extra");
const {Actor, ActorClass, Pool, method, Arg, Option, RetVal, types, emit} = protocol;
const {ChromiumWalkerActor} = require("./walker");
const {ChromiumPageStyleActor} = require("./styles");
const {ChromiumHighlighterActor} = require("./highlighter");
const {LongStringActor} = require("../devtools-require")("devtools/server/actors/string");
const {getResourceStore} = require("./resource-store");

// Force loading the inspector module that this actor mirrors.
require("../devtools-require")("devtools/server/actors/inspector");

var ChromiumInspectorActor = ActorClass({
  typeName: "chromium_inspector",
  frontType: "inspector",

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
      walker: RetVal("domwalker")
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
      pageStyle: RetVal("pagestyle")
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
    response: { highligter: RetVal("highlighter") }
  }),

  getImageDataFromURL: asyncMethod(function*(url, maxDim) {
    let resourceStore = getResourceStore(this.rpc);
    let urlContent = yield resourceStore.urlContent(url);
    if (!urlContent) {
      return;
    }

    let {content, base64Encoded} = urlContent;
    if (base64Encoded) {
      return {
        data: LongStringActor(this.conn, "data:image/png;base64," + content),
        // Sending empty size information will cause the front-end to load the
        // image to retrieve the dimension.
        size: {}
      }
    }
  }, {
    request: {url: Arg(0), maxDim: Arg(1, "nullable:number")},
    response: RetVal("imageData")
  })
});
exports.ChromiumInspectorActor = ChromiumInspectorActor;
