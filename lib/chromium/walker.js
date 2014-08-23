const { Ci } = require("chrome");

const {emit} = require("../devtools/event"); // Needs to share a loader with protocol.js, boo.
const task = require("../util/task");

const protocol = require("../devtools/server/protocol");
const {asyncMethod, todoMethod, todoMethodSilent} = require("../util/protocol-extra");
const {Actor, ActorClass, Pool, method, Arg, Option, RetVal, types} = protocol;
const {ChromiumPageStyleActor} = require("./styles");
const {ChromiumHighlighterActor} = require("./highlighter");
const {LongStringActor} = require("../devtools/server/actors/string");

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

types.addDictType("chromium_imageData", {
  // The image data
  data: "nullable:longstring",
  // The original image dimensions
  size: "json"
});

var NodeActor = protocol.ActorClass({
  typeName: "chromium_domnode",

  get conn() { return this.walker.conn; },

  initialize: function(walker, handle) {
    this.walker = walker;
    this.actorID = this.conn.allocID("node" + this.walker.generation + "-" + handle.nodeId + "-");
    this.handle = handle;
    this.sent = false; // This will be cleared whenever the node is sent across the protocol.
    this.parent = null;
    Actor.prototype.initialize.call(this);
  },

  get rpc() { return this.walker.rpc },

  form: function(detail) {
    if (detail === "actorid") {
      return this.actorID;
    }

    this.sent = true;

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

    if (this.parent && this.parent.documentElement === this) {
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

  isDocument: function() {
    return this.handle.nodeType == Ci.nsIDOMNode.DOCUMENT_NODE;
  },

  isElement: function() {
    return this.handle.nodeType == Ci.nsIDOMNode.ELEMENT_NODE;
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

  getImageData: todoMethod({
    request: {maxDim: Arg(0, "nullable:number")},
    response: RetVal("chromium_imageData")
  }),

  getEventListenerInfo: todoMethod({
    request: {},
    response: { events: RetVal("json") }
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
  }),

  getFontFamilyDataURL: todoMethod({
    request: {font: Arg(0, "string"), fillStyle: Arg(1, "nullable:string")},
    response: RetVal("chromium_imageData")
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

const traversalMethod = {
  request: {
    node: Arg(0, "chromium_domnode"),
    whatToShow: Option(1)
  },
  response: {
    node: RetVal("nullable:chromium_domnode")
  }
}

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
    this.orphaned = [];
    this.tab = tab;

    this.generation = 0;

    this.rpc.on("DOM.setChildNodes", this.onSetChildNodes.bind(this));
    this.rpc.on("DOM.inspectNodeRequested", this.onInspectNodeRequested.bind(this));
    this.rpc.on("DOM.attributeRemoved", this.onAttributeRemoved.bind(this));
    this.rpc.on("DOM.attributeModified", this.onAttributeModified.bind(this));
    this.rpc.on("DOM.characterDataModified", this.onCharacterDataModified.bind(this));
    this.rpc.on("DOM.childNodeRemoved", this.onChildNodeRemoved.bind(this));
    this.rpc.on("DOM.childNodeInserted", this.onChildNodeInserted.bind(this));
    this.rpc.on("DOM.childNodeCountUpdated", this.onChildNodeCountUpdated.bind(this));

    this.rpc.on("Page.frameNavigated", this.onFrameNavigated.bind(this));
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

    ref.handle = handle;

    // Make sure any children of this handle are returned.
    if ("children" in handle) {
      this.updateChildren(ref, handle.children);
    }

    return ref;
  },

  updateChildren: function(node, children) {
    node.children = [];
    if (node.isDocument()) {
      node.documentElement = null;
    }
    node.documentElement = null;
    for (let child of children) {
      let childRef = this.ref(child);
      childRef.parent = node;
      if (node.isDocument() && !node.documentElement && node.isElement()) {
        node.documentElement = node;
      }
      node.children.push(childRef);
    }
  },

  onSetChildNodes: function(params) {
    let parent = this.refMap.get(params.parentId);
    this.updateChildren(parent, params.nodes);
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

    if (mutation.type !== "newRoot" && mutation.type !== "documentUnload") {
      let target = this.get(mutation.target);
      if (!target || !target.sent) {
        // This hasn't been sent across the wire, don't worry about it.
        return;
      }
    }

    let needEvent = this.pendingMutations.length == 0;
    this.pendingMutations.push(mutation);

    if (needEvent) {
      emit(this, "new-mutations");
    }
  },

  getSentNode: function(nodeId) {
    if (!this.refMap.has(nodeId)) {
      return null;
    }
    let node = this.refMap.get(nodeId);
    if (!node.sent) {
      return null;
    }

    return node;
  },

  onAttributeRemoved: function(params) {
    let node = this.getSentNode(params.nodeId);
    if (!node) {
      return;
    }
    this.queueMutation({
      type: "attributes",
      target: node.actorID,
      attributeName: params.name,
    });
  },

  onAttributeModified: function(params) {
    let node = this.getSentNode(params.nodeId);
    if (!node) {
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
    let node = this.getSentNode(params.nodeId);
    if (!node) {
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

  onChildNodeRemoved: function(params) {
    let node = this.refMap.get(params.nodeId);
    if (!node) {
      return;
    }

    this.orphaned.push(node);

    if (!node.sent) {
      return;
    }

    let parent = node.parent;

    if (!parent.sent) {
      return;
    }

    if (parent.children) {
      parent.children = parent.children.filter(child => {
        return child.handle.nodeId != params.nodeId;
      });
    } else {
      console.warning("Why are the parent's children not filled in?");
    }

    this.queueMutation({
      type: "childList",
      target: node.parent.actorID,
      removed: [node.actorID],
      added: [],
      numChildren: node.parent.children.length
    });
  },

  onChildNodeInserted: function(params) {
    let parent = this.refMap.get(params.parentNodeId);
    // If we don't know about the parent, we don't care about its children.
    if (!parent) {
      return;
    }

    let node = this.ref(params.node);
    if (!parent.children) {
      parent.children = [];
    }
    let idx = 0;
    if (params.previousNodeId) {
      idx = parent.children.findIndex(item => item.handle.nodeId === params.previousNodeId);
      idx++;
    }
    node.parent = parent;

    parent.children.splice(idx, 0, node);

    this.queueMutation({
      type: "childList",
      target: parent.actorID,
      removed: [],
      added: node.seen ? [node.actorID] : [],
      numChildren: node.parent.children.length
    });
  },

  onChildNodeCountUpdated: function(params) {
    let parent = this.refMap.get(params.nodeId);
    if (!parent || !parent.sent) {
      return;
    }

    this.queueMutation({
      type: "childList",
      target: parent.actorID,
      removed: [],
      added: [],
      numChildren: params.childNodeCount
    });
  },

  onFrameNavigated: task.async(function(params) {
    if (!params.frame.parentId) {
      // Urgh, should probably block further communication during this
      // XXX
      this.queueMutation({
        type: "documentUnload",
        target: this.root.actorID
      });

      this.releaseNode(this.root);
      this.generation++;
      let result = yield this.rpc.request("DOM.getDocument");
      this.root = this.ref(result.root);


      this.queueMutation({
        type: "newRoot",
        target: this.root.form()
      });
    }
  }),

  form: function(detail) {
    return {
      actor: this.actorID,
      root: this.root.form()
    }
  },

  document: method(function(node) {
    while (node) {
      if (node.handle.nodeType === Ci.nsIDOMNode.DOCUMENT_NODE) {
        break;
      }
      node = node.parent;
    }
    if (!node) {
      node = this.root;
    }

    return node;
  }, {
    request: { node: Arg(0, "nullable:chromium_domnode") },
    response: { node: RetVal("chromium_domnode") },
  }),

  documentElement: asyncMethod(function*(node) {
    let doc = this.document(node);
    if (!doc.documentElement) {
      yield this.rpc.request("DOM.requestChildNodes", {
        nodeId: doc.handle.nodeId,
      });
    }

    return doc.documentElement;
  }, {
    request: {
      node: Arg(0, "nullable:chromium_domnode")
    },
    response: {
      node: RetVal("chromium_domnode")
    }
  }),

  parents: todoMethod({
    request: {
      node: Arg(0, "chromium_domnode"),
      sameDocument: Option(1)
    },
    response: {
      nodes: RetVal("array:chromium_domnode")
    }
  }),

  retainNode: asyncMethod(function(node) {
    console.error("Chromium backend does not support retained nodes");
    // XXX: Turn this into a thrown error once the frontend is capable of
    // dealing with it.
  }, {
    request: { node: Arg(0, "chromium_domnode") }
  }),

  unretainNode: asyncMethod(function(node) {
    console.error("Chromium backend does not support retained nodes");
    // XXX: Turn this into a thrown error once the frontend is capable of
    // dealing with it.
  }, {
    request: { node: Arg(0, "chromium_domnode") }
  }),

  releaseNode: method(function(node) {
    if (node.children) {
      let children = node.children;
      for (let child of children) {
        this.releaseNode(child);
      }
    }
    this.unmanage(node);
  }, {
    request: { node: Arg(0, "chromium_domnode") }
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

  siblings: todoMethod(nodeArrayMethod),

  nextSibling: todoMethod(traversalMethod),
  previousSibling: todoMethod(traversalMethod),

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

    if (!response.nodeId) {
      return {}
    }

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

  querySelectorAll: todoMethod({
    request: {
      node: Arg(0, "chromium_domnode"),
      selector: Arg(1)
    },
    response: {
//      list: RetVal("chromium_domnodelist")
    }
  }),

  getSuggestionsForQuery: todoMethod({
    request: {
      query: Arg(0),
      completing: Arg(1),
      selectorState: Arg(2)
    },
    response: {
      list: RetVal("array:array:string")
    }
  }),

  addPseudoClassLock: todoMethod({
    request: {
      node: Arg(0, "chromium_domnode"),
      pseudoClass: Arg(1),
      parents: Option(2)
    },
    response: {}
  }),

  removePseudoClassLock: todoMethod({
    request: {
      node: Arg(0, "chromium_domnode"),
      pseudoClass: Arg(1),
      parents: Option(2)
    },
    response: {}
  }),

  clearPseudoClassLocks: todoMethodSilent({
  }, {
    request: {
      node: Arg(0, "nullable:chromium_domnode")
    },
    response: {}
  }),


  hideNode: todoMethod({
    request: { node: Arg(0, "chromium_domnode") }
  }),

  showNode: todoMethod({
    request: { node: Arg(0, "chromium_domnode") }
  }),

  innerHTML: todoMethod({
    request: { node: Arg(0, "chromium_domnode") },
    response: { value: RetVal("longstring") }
  }),

  outerHTML: todoMethod({
    request: { node: Arg(0, "chromium_domnode") },
    response: { value: RetVal("longstring") }
  }),

  setOuterHTML: todoMethod({
    request: {
      node: Arg(0, "chromium_domnode"),
      value: Arg(1),
    },
    response: {}
  }),

  removeNode: asyncMethod(function(node) {
    yield this.rpc.request("DOM.removeNode", {
      nodeId: node.handle.nodeId
    });
  }, {
    request: { node: Arg(0, "chromium_domnode") }
  }),

  insertBefore: todoMethod({
    request: {
      node: Arg(0, "chromium_domnode"),
      parent: Arg(1, "chromium_domnode"),
      sibling: Arg(2, "nullable:chromium_domnode")
    },
    response: {}
  }),

  getMutations: method(function(options={}) {
    let pending = this.pendingMutations || [];
    this.pendingMutations = [];

    if (options.cleanup) {
      for (let node of this.orphaned) {
        this.releaseNode(node);
      }
    }

    return pending;
  }, {
    request: { cleanup: Option(0) },
    response: {
      mutations: RetVal("array:chromium_dommutation")
    }
  }),

  isInDOMTree: todoMethod({
    request: { node: Arg(0, "chromium_domnode") },
    response: { attached: RetVal("boolean") }
  }),

  getNodeActorFromObjectActor: todoMethod({
    request: {
      objectActorID: Arg(0, "string")
    },
    response: {
      nodeFront: RetVal("nullable:chromium_disconnectedNode")
    }
  }),

  getStyleSheetOwnerNode: todoMethod({
    request: {
      styleSheetActorID: Arg(0, "string")
    },
    response: {
      ownerNode: RetVal("nullable:chromium_disconnectedNode")
    }
  }),
});
exports.ChromiumWalkerActor = ChromiumWalkerActor;
