const {emit} = require("devtools/sdk/event/core"); // Needs to share a loader with protocol.js, boo.
const task = require("util/task");

const protocol = require("devtools/server/protocol");
const {asyncMethod} = require("util/protocol-extra");
const {Actor, ActorClass, Pool, method, Arg, Option, RetVal, types} = protocol;
const {ChromiumPageStyleActor} = require("./styles");
const {ChromiumHighlighterActor} = require("./highlighter");
const {LongStringActor} = require("devtools/server/actors/string");

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

types.addDictType("chromium_dommutation", {});

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

  get rpc() { return this.walker.rpc },

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
  },

  getNodeValue: method(function() {
    return new LongStringActor(this.conn, this.handle.nodeValue);
  }, {
    request: {},
    response: { value: RetVal("longstring") }
  }),

  setNodeValue: asyncMethod(function(value) {
    yield this.rpc.request("DOM.setNodeValue", {
      nodeId: this.handle.nodeId,
      value: value
    });
  }, {
    request: { value: Arg(0) },
    response: {}
  }),

  modifyAttributes: asyncMethod(function*(modifications) {
    for (let mod of modifications) {
      if (mod.newValue === undefined || mod.newValue === null) {
        yield this.rpc.request("DOM.removeAttribute", {
          nodeId: this.handle.nodeId,
          name: mod.attributeName
        });
      } else {
        yield this.rpc.request("DOM.setAttributeValue", {
          nodeId: this.handle.nodeId,
          name: mod.attributeName,
          value: mod.newValue
        });
      }
    }
  }, {
    request: { modifications: Arg(0, "array:json") }
  })
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

var ChromiumWalkerActor = protocol.ActorClass({
  typeName: "chromium_domwalker",

  events: {
    "new-mutations" : {
      type: "newMutations"
    },

   "picker-node-picked" : {
      type: "pickerNodePicked",
      node: Arg(0, "chromium_disconnectedNode")
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
    this.pendingMutations = [];

    this.rpc.on("DOM.setChildNodes", this.onSetChildNodes.bind(this));
    this.rpc.on("DOM.inspectNodeRequested", this.onInspectNodeRequested.bind(this));
    this.rpc.on("DOM.attributeRemoved", this.onAttributeRemoved.bind(this));
    this.rpc.on("DOM.attributeModified", this.onAttributeModified.bind(this));
    this.rpc.on("DOM.characterDataModified", this.onCharacterDataModified.bind(this));
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
    parent.children = [];
    for (let handle of params.nodes) {
      let childNode = this.ref(handle);
      childNode.parent = parent;
      parent.children.push(childNode);
    }
  },

  onInspectNodeRequested: function(params) {
    let node = this.refMap.get(params.nodeId);
    emit(this, "picker-node-picked", {
      node: node,
      newParents: this.ensurePathToRoot(node)
    });
  },

  queueMutation: function(mutation) {
    if (!this.actorID) {
      // Already destroyed, don't bother queueing.
      return;
    }

    let needEvent = this.pendingMutations.length == 0;
    this.pendingMutations.push(mutation);

    if (needEvent) {
      emit(this, "new-mutations");
    }
  },

  onAttributeRemoved: function(params) {
    if (!this.refMap.has(params.nodeId)) {
      return;
    }
    let node = this.refMap.get(params.nodeId);
    if (!node.sent) {
      return;
    }
    this.queueMutation({
      type: "attributes",
      target: node.actorID,
      attributeName: params.name,
    });
  },

  onAttributeModified: function(params) {
    if (!this.refMap.has(params.nodeId)) {
      return;
    }
    let node = this.refMap.get(params.nodeId);
    if (!node.sent) {
      return;
    }
    this.queueMutation({
      type: "attributes",
      target: node.actorID,
      attributeName: params.name,
      newValue: params.value
    });
  },

  onCharacterDataModified: function(params) {
    if (!this.refMap.has(params.nodeId)) {
      return;
    }
    let node = this.refMap.get(params.nodeId);
    if (!node.sent) {
      return;
    }

    let mutation = {
      type: "characterData",
      target: node.actorID,
    };

    if (params.characterData.length > SUMMARY_VALUE_LENGTH) {
      mutation.newValue = params.characterData.substring(0, SUMMARY_VALUE_LENGTH);
      mutation.incompleteValue = true;
    } else {
      mutation.newValue = params.characterData;
    }

    this.queueMutation(mutation);
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
  }, nodeArrayMethod),

  getMutations: method(function(options={}) {
    let pending = this.pendingMutations || [];
    this.pendingMutations = [];

    // XXX: orphaning etc.

    return pending;
  }, {
    request: { cleanup: Option(0) },
    response: {
      mutations: RetVal("array:chromium_dommutation")
    }
  })
});
exports.ChromiumWalkerActor = ChromiumWalkerActor;
