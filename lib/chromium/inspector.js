const {Class} = require("sdk/core/heritage");
const {emit} = require("devtools/sdk/event/core"); // Needs to share a loader with protocol.js, boo.
const task = require("util/task");

const protocol = require("devtools/server/protocol");
const {asyncMethod} = require("util/protocol-extra");
const {Actor, ActorClass, Pool, method, Arg, Option, RetVal} = protocol;

var NodeActor = protocol.ActorClass({
  typeName: "chromium_domnode",

  get conn() { return this.walker.conn; },

  initialize: function(walker, ref) {
    this.walker = walker;
    this.actorID = this.conn.allocID("node" + ref.nodeId + "-");
    this.ref = ref;
    Actor.prototype.initialize.call(this);
  },

  isDocumentElement: function() {
    return false; // XXX
  },

  form: function(detail) {
    console.log("MY ACTORID IS: " + this.actorID + "\n");

    if (detail === "actorid") {
      return this.actorID;
    }

    let form = {
      actor: this.actorID,
      baseURI: this.ref.baseURL,
      parent: undefined,
      nodeType: this.ref.nodeType,
      namespaceURI: "http://www.w3.org/1999/xhtml",
      nodeName: this.ref.nodeName,
      numChildren: this.ref.childNodeCount,

      // doctype attributes
      name: this.ref.name,
      publicId: this.ref.publicId,
      systemId: this.ref.systemId,

      attrs: []
    }

    if (this.isDocumentElement()) {
      form.isDocumentElement = true;
    }

    if (this.ref.nodeValue) {
      // XXX: summarize.
      form.nodeValue = this.ref.nodeValue;
      // Summary crap.
    }

    return form;
  }
});

var WalkerActor = protocol.ActorClass({
  typeName: "chromium_domwalker",

  events: {
    "new-mutations" : {
      type: "newMutations"
    },
  },

  /**
   * Create the WalkerActor
   * @param DebuggerServerConnection conn
   *    The server connection.
   */
  initialize: function(tab, options) {
    Actor.prototype.initialize.call(this, tab.conn);
    this.rpc = tab.rpc;
  },

  init: task.async(function*() {
    if (this.root) {
      return;
    }

    let result = yield this.rpc.request("DOM.getDocument");
    this.root = NodeActor(this, result.root);

    return this;
  }),

  form: function(detail) {
    return {
      actor: this.actorID,
      root: this.root.form()
    }
  }
});

var ChromiumPageStyleActor = ActorClass({
  typeName: "chromium_pagestyle",

  get conn() { return this.inspector.conn; },

  initialize: function(inspector) {
    Actor.prototype.initialize.call(this);
    this.inspector = inspector;
  },

  init: task.async(function*() {
    return this;
  })
});

var ChromiumInspectorActor = ActorClass({
  typeName: "chromium_inspector",

  initialize: function(tab) {
    Actor.prototype.initialize.call(this, tab.conn);
    this.tab = tab;
    this.rpc = tab.rpc;
  },

  getWalker: method(function(options={}) {
    if (!this.walkerPromise) {
      this.walker = WalkerActor(this.tab, options);
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
      this.pageStylePromise = this.pageStyle.init();
    }
    return this.pageStylePromise;
  }, {
    request: {},
    response: {
      pageStyle: "chromium_pagestyle"
    },
  })
});
exports.ChromiumInspectorActor = ChromiumInspectorActor;
