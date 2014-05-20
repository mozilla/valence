const {Class} = require("sdk/core/heritage");
const {emit} = require("devtools/sdk/event/core"); // Needs to share a loader with protocol.js, boo.
const task = require("util/task");

const protocol = require("devtools/server/protocol");
const {asyncMethod} = require("util/protocol-extra");
const {Actor, ActorClass, Pool, method, Arg, Option, RetVal, types} = protocol;

const SUMMARY_VALUE_LENGTH = 50;

/**
 * Returned from any call that might return a node that isn't connected to root by
 * nodes the child has seen, such as querySelector.
 */
types.addDictType("chromium_disconnectedNode", {
  // The actual node to return
  node: "chromium_domnode",

  // Nodes that are needed to connect the node to a node the client has already seen
  newParents: "array:chromium_domnode"
});

var NodeActor = protocol.ActorClass({
  typeName: "chromium_domnode",

  get conn() { return this.walker.conn; },

  initialize: function(walker, handle) {
    this.walker = walker;
    this.actorID = this.conn.allocID("node" + handle.nodeId + "-");
    this.handle = handle;
    this.sent = false; // This will be cleared whenever the node is sent across the protocol.
    this.parent = null;
    Actor.prototype.initialize.call(this);
  },

  isDocumentElement: function() {
    return false; // XXX
  },

  form: function(detail) {
    this.sent = true;

    if (detail === "actorid") {
      return this.actorID;
    }

    let form = {
      actor: this.actorID,
      baseURI: this.handle.baseURL,
      parent: this.parent ? this.parent.actorID : undefined,
      nodeType: this.handle.nodeType,
      namespaceURI: "http://www.w3.org/1999/xhtml",
      nodeName: this.handle.nodeName,
      numChildren: this.handle.childNodeCount,

      // doctype attributes
      name: this.handle.name,
      publicId: this.handle.publicId,
      systemId: this.handle.systemId,

      attrs: this.writeAttrs()
    }

    if (this.isDocumentElement()) {
      form.isDocumentElement = true;
    }

    if (this.handle.nodeValue) {
      let v = this.handle.nodeValue;
      if (v.length > SUMMARY_VALUE_LENGTH) {
        form.shortValue = v.substring(0, SUMMARY_VALUE_LENGTH);
        form.incompleteValue = true;
      } else {
        form.shortValue = v;
      }
    }

    return form;
  },

  writeAttrs: function() {
    let attrs = this.handle.attributes;
    if (!attrs) {
      return undefined;
    }
    let ret = [];
    for (let i = 0; i < attrs.length; i += 2) {
      ret.push({ name: attrs[i], value: attrs[i + 1] });
    }
    return ret;
  }
});


const nodeArrayMethod = {
  request: {
    node: Arg(0, "chromium_domnode"),
    maxNodes: Option(1, "number"),
    center: Option(1, "chromium_domnode"),
    start: Option(1, "chromium_domnode"),
    whatToShow: Option(1)
  },
  response: RetVal(types.addDictType("chromium_domtraversalarray", {
    nodes: "array:chromium_domnode"
  }))
};

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
    this.refMap = new Map();
    this.rpc = tab.rpc;
    this.rpc.on("DOM.setChildNodes", this.onSetChildNodes.bind(this));
  },

  init: task.async(function*() {
    if (this.root) {
      return;
    }

    let result = yield this.rpc.request("DOM.getDocument");
    this.root = this.ref(result.root);

    return this;
  }),

  ref: function(handle) {
    let ref = null;
    if (this.refMap.has(handle.nodeId)) {
      ref = this.refMap.get(handle.nodeId);
    } else {
      ref = NodeActor(this, handle);
      this.manage(ref);
      this.refMap.set(handle.nodeId, ref);
    }

    // Make sure any children of this handle are returned.
    if ("children" in handle) {
      ref.children = [];
      for (let child of handle.children) {
        let childRef = this.ref(child);
        childRef.parent = ref;
        ref.children.push(childRef);
      }
    }

    return ref;
  },

  onSetChildNodes: function(params) {
    let parent = this.refMap.get(params.parentId);
    // XXX: do something with orphaned nodes.
    parent.children = [];
    for (let handle of params.nodes) {
      let childNode = this.ref(handle);
      childNode.parent = parent;
      parent.children.push(childNode);
    }
  },

  form: function(detail) {
    return {
      actor: this.actorID,
      root: this.root.form()
    }
  },

  documentElement: asyncMethod(function*(node) {
    // XXX: broken.
    return this.root;
  }, {
    request: {
      node: Arg(0, "nullable:chromium_domnode")
    },
    response: {
      node: RetVal("chromium_domnode")
    }
  }),

  ensurePathToRoot: function(node) {
    // XXX: This won't work on BackendNodeId nodes.
    // Test on a deep querySelector.
    let newParents = [];
    let parent = node.parent;
    while (parent && !parent.sent) {
      newParents.push(parent);
      parent = parent.parent;
    }

    return newParents;
  },

  querySelector: asyncMethod(function*(baseNode, selector) {
    if (!baseNode) {
      baseNode = this.root;
    }

    if (!selector) {
      return {};
    }

    let response = yield this.rpc.request("DOM.querySelector", {
      nodeId: baseNode.handle.nodeId,
      selector: selector
    });

    let ref = this.refMap.get(response.nodeId);

    return {
      node: ref,
      newParents: this.ensurePathToRoot(ref)
    }
  }, {
    request: {
      node: Arg(0, "chromium_domnode"),
      selector: Arg(1, "nullable:string")
    },
    response: RetVal("chromium_disconnectedNode")
  }),

  children: asyncMethod(function*(node, options={}) {
    // XXX: We don't handle node subsetting here.

    if (!node.children) {
      // Update the cached children.  This will need more work for large
      // nodes.
      let result = yield this.rpc.request("DOM.requestChildNodes", {
        nodeId: node.handle.nodeId,
        depth: 1
      });
    }

    return {
      nodes: node.children,
      hasFirst: true, // XXX
      hasLast: true   // XXX
    }
  }, nodeArrayMethod)
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
