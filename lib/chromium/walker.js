const { Ci, Cu, Cc } = require("chrome");

const task = require("../util/task");

const protocol = require("../devtools-require")("devtools/server/protocol");
const {asyncMethod, todoMethod, todoMethodSilent, types} = require("../util/protocol-extra");
const {Actor, Pool, method, Arg, Option, RetVal, emit} = protocol;
const {ChromiumPageStyleActor} = require("./styles");
const {LongStringActor} = require("../devtools-require")("devtools/server/actors/string");
const {getResourceStore} = require("./resource-store");
Cu.importGlobalProperties(["URL"]);

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
      // If the node is a frame, it'll have a contentDocument handle property,
      // which we need to consider as a child node.
      numChildren: this.handle.contentDocument ? 1 : this.handle.childNodeCount,

      // doctype attributes
      name: this.handle.nodeName,
      publicId: this.handle.publicId,
      systemId: this.handle.systemId,

      attrs: this.writeAttrs(),

      pseudoClassLocks: this.lockedClasses ? [...this.lockedClasses] : undefined,
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

  isDocument() {
    return this.handle.nodeType == Ci.nsIDOMNode.DOCUMENT_NODE;
  },

  isElement() {
    return this.handle.nodeType == Ci.nsIDOMNode.ELEMENT_NODE;
  },

  getAttr(name) {
    let attrs = this.handle.attributes;
    for (let i = 0; i < attrs.length; i += 2) {
      if (attrs[i] == name) {
        return attrs[i + 1];
      }
    }
    return null;
  },

  writeAttrs() {
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

  pseudoLock(cls) {
    if (!this.lockedClasses) {
      this.lockedClasses = new Set();
      this.walker.pseudoLockedNodes.add(this);
    }
    this.lockedClasses.add(cls);
  },

  pseudoUnlock(cls) {
    this.lockedClasses.delete(cls);
    if (this.lockedClasses.size == 0) {
      this.pseudoClear();
    }
  },

  pseudoClear() {
    this.lockedClasses = undefined;
    this.walker.pseudoLockedNodes.delete(this);
  },

  writePseudoClassLocks() {
    return this.lockedClasses ? [...this.lockedClasses] : undefined;
  },

  getNodeValue: method(function() {
    return new LongStringActor(this.conn, this.handle.nodeValue);
  }, {
    request: {},
    response: { value: RetVal("longstring") }
  }),

  setNodeValue: asyncMethod(function*(value) {
    yield this.rpc.request("DOM.setNodeValue", {
      nodeId: this.handle.nodeId,
      value: value
    });
  }, {
    request: { value: Arg(0) },
    response: {}
  }),

  /**
   * Get the base URL of this node's parent document.
   * @return {URL}
   */
  _getBaseURL() {
    let node = this;
    while (node.parent) {
      node = node.parent;
    }
    return new URL(node.handle.baseURL);
  },

  /**
   * Given a URL, return its absolute version, based on this node's document
   * base URL.
   * @param {String} url
   * @return {String}
   */
  _getAbsoluteURL(url) {
    let baseURL = this._getBaseURL();

    if (url.startsWith("//")) {
      // Missing protocol
      url = baseURL.protocol + url;
    } else if (url.startsWith("/")) {
      // Absolute url
      url = baseURL.origin + url;
    } else if (!url.startsWith(baseURL.protocol)) {
      // Relative path
      let path = baseURL.pathname.substring(0, baseURL.pathname.lastIndexOf("/") + 1);
      url = baseURL.origin + path + url;
    }

    return url;
  },

  getImageData: asyncMethod(function*() {
    let url = this.getAttr("src");
    if (!url) {
      return;
    }

    url = this._getAbsoluteURL(url);
    if (!url) {
      return;
    }

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
      };
    }
  }, {
    request: { maxDim: Arg(0, "nullable:number") },
    response: RetVal("chromium_imageData")
  }),

  getEventListenerInfo: todoMethod({
    request: {},
    response: { events: RetVal("json") }
  }, "getEventListenerInfo"),

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
  }, "getFontFamilyDataURL"),

  /**
   * Execute any function declaration with 'this' being the current node.
   * @param {String} functionDeclaration A function declaration string which
   * will be executed. In this function, 'this' will be the DOM node.
   * @param {Array} functionArgs Optional array of arguments for the function.
   * @return {Array} An array of properties for the returned object
   */
  callFunction: task.async(function*(functionDeclaration, functionArgs=[]) {
    // Get the runtime object for this dom node
    response = yield this.rpc.request("DOM.resolveNode", {
      nodeId: this.handle.nodeId
    });

    // Execute the function on the resolved runtime object
    response = yield this.rpc.request("Runtime.callFunctionOn", {
      objectId: response.object.objectId,
      functionDeclaration: functionDeclaration,
      arguments: functionArgs
    });

    // Get all the properties from the returned object
    response = yield this.rpc.request("Runtime.getProperties", {
      objectId: response.result.objectId
    });

    return response.result;
  })
});


var NodeListActor = protocol.ActorClass({
  typeName: "chromium_domnodelist",

  get conn() { return this.walker.conn; },

  initialize: function(walker, nodeList) {
    protocol.Actor.prototype.initialize.call(this);
    this.walker = walker;
    this.nodeList = nodeList;
  },

  // Items returned by this actor are owned by the parent walker.
  marshallPool: function() {
    return this.walker;
  },

  form: function() {
    return {
      actor: this.actorID,
      length: this.nodeList.length
    }
  },

  item: method(function(item) {
    return this.walker.attachElement(this.nodeList[item]);
  }, {
    request: { item: Arg(0) },
    response: RetVal("chromium_disconnectedNode")
  }),

  items: method(function(start=0, end=this.nodeList.length) {
    let nodes = this.nodeList.slice(start, end).map(item => this.walker.ref(item));
    let newParents = new Set();
    nodes.forEach(node => this.walker.ensurePathToRoot(node, newParents));
    return {
      nodes: nodes,
      newParents: [...newParents]
    }
  }, {
    request: {
      start: Arg(0, "nullable:number"),
      end: Arg(1, "nullable:number")
    },
    response: RetVal("chromium_disconnectedNode")
  }),

  release: method(function() {}, { release: true })
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

const pseudoClassMethod = {
  request: {
    node: Arg(0, "chromium_domnode"),
    pseudoClass: Arg(1),
    parents: Option(2)
  },
  response: {}
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
    this.orphaned = [];
    this.tab = tab;

    this.generation = 0;

    this.pseudoLockedNodes = new Set();

    // Element picked event, for Chrome
    this.rpc.on("DOM.inspectNodeRequested", this.onInspectNodeRequested.bind(this));
    // And iOS
    this.rpc.on("Inspector.inspect", this.onInspectorInspect.bind(this));

    // This is the event via which the actor receives handles for nodes.
    // The protocol fires this event when the backend wants to provide us with
    // the missing DOM structure for any given nodeId. This happens upon most of
    // the calls requesting node ids.
    this.rpc.on("DOM.setChildNodes", this.onSetChildNodes.bind(this));

    // Markup mutation events
    this.rpc.on("DOM.attributeRemoved", this.onAttributeRemoved.bind(this));
    this.rpc.on("DOM.attributeModified", this.onAttributeModified.bind(this));
    this.rpc.on("DOM.characterDataModified", this.onCharacterDataModified.bind(this));
    this.rpc.on("DOM.childNodeRemoved", this.onChildNodeRemoved.bind(this));
    this.rpc.on("DOM.childNodeInserted", this.onChildNodeInserted.bind(this));
    this.rpc.on("DOM.childNodeCountUpdated", this.onChildNodeCountUpdated.bind(this));

    // Frame navigation events
    this.rpc.on("Page.frameNavigated", this.onFrameNavigated.bind(this));
    this.rpc.on("Page.loadEventFired", this.onPageLoad.bind(this));
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
    if (handle.children) {
      this.updateChildren(ref, handle.children);
    }

    // And if the handle is an iframe, make sure its contentDocument is returned.
    if (handle.contentDocument) {
      this.updateChildren(ref, [handle.contentDocument]);
    }

    return ref;
  },

  updateChildren: function(node, children) {
    if (node.isDocument()) {
      node.documentElement = null;
    }
    node.children = [];
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

  /**
   * The chromium's version of "a node was selected" event where |params|
   * has the nodeId directly.
   */
  onInspectNodeRequested: function(params) {
    emit(this, "picker-node-picked", this.attachElement(params.nodeId));
  },

  /**
   * The iOS's version of "a node was selected" event where |params| gives us a
   * runtime objectId from which the nodeId can be retrieved.
   */
  onInspectorInspect: task.async(function*(params) {
    let result = yield this.rpc.request("DOM.requestNode", {
      objectId: params.object.objectId
    });

    this.onInspectNodeRequested(result);
  }),

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
      // XXX removed attributes are expected to have a null newValue property
      // by the WalkerFront. See bug 1069834.
      newValue: null
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

    node.handle.nodeValue = params.characterData;

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
      // Node hasn't been sent to the toolbox yet, so no need to queue a mutation
      // but make sure to keep the cached parent's children list updated.
      let index = node.parent.children.findIndex(n => n.handle.nodeId === params.nodeId);
      node.parent.children.splice(index, 1);
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
    if (parent.children === undefined) {
      // XXX: Is there a case where we want to send a childList notification
      // but we haven't seen the children yet?
      return;
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

  onFrameNavigated: function(params) {
    if (!params.frame.parentId) {
      // Urgh, should probably block further communication during this
      // XXX
      this.queueMutation({
        type: "documentUnload",
        target: this.root.actorID
      });

      this.releaseNode(this.root);
      this.hasNavigated = true;
    }
  },

  onPageLoad: task.async(function(params) {
    if (this.hasNavigated) {
      this.hasNavigated = false;

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

  parents: method(function(node, options={}) {
    let parents = [];
    let parent = node.parent;
    while (parent) {
      parents.push(parent);
      if (options.sameDocument && parent.isDocument()) {
        break;
      }
      parent = parent.parent;
    }
    return parents;
  }, {
    request: {
      node: Arg(0, "chromium_domnode"),
      sameDocument: Option(1)
    },
    response: {
      nodes: RetVal("array:chromium_domnode")
    }
  }),

  editTagName: asyncMethod(function*(node, tagName) {
    let response = yield this.rpc.request("DOM.setNodeName", {
      nodeId: node.handle.nodeId,
      name: tagName
    });
  }, {
    request: {
      node: Arg(0, "chromium_domnode"),
      tagName: Arg(1, "string")
    },
    response: {}
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

  release: method(function() {
  }, {
    request: {},
    response: {}
  }),

  ensurePathToRoot: function(node, newParents = new Set()) {
    // XXX: This won't work on BackendNodeId nodes.
    // Test on a deep querySelector.
    let parent = node.parent;
    while (parent && !parent.sent) {
      newParents.add(parent);
      parent = parent.parent;
    }

    return newParents;
  },

  attachElement: function(nodeId) {
    let node = this.refMap.get(nodeId);
    return {
      node: node,
      newParents: [...this.ensurePathToRoot(node)]
    }
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

  siblings: method(function(node, options={}) {
    let parent = node.parent;
    if (!parent) {
      return {
        hasFirst: true,
        hasLast: true,
        nodes: [node]
      }
    }

    if (!(options.start || options.center)) {
      options.center = node;
    }

    return this.children(node, options);
  }, nodeArrayMethod),

  sibling: task.async(function*(node, diff) {
    let parent = node.parent;
    if (!parent) {
      return null;
    }

    if (!parent.children) {
      yield this.rpc.request("DOM.requestChildNodes", {
        nodeId: node.handle.nodeId,
        depth: 1
      });
    }

   idx = parent.children.findIndex(item => item.handle.nodeId === node.nodeId);
   return parent.children[idx + diff];
  }),

  nextSibling: asyncMethod(function*(node) {
    return yield this.sibling(node, 1);
  }, traversalMethod),

  previousSibling: asyncMethod(function*(node) {
    return yield this.sibling(node, 1);
  }, traversalMethod),

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

    return this.attachElement(response.nodeId);
  }, {
    request: {
      node: Arg(0, "chromium_domnode"),
      selector: Arg(1, "nullable:string")
    },
    response: RetVal("chromium_disconnectedNode")
  }),

  querySelectorAll: asyncMethod(function*(baseNode, selector) {
    let response = yield this.rpc.request("DOM.querySelectorAll", {
      nodeId: baseNode.handle.nodeId,
      selector: selector
    });

    return NodeListActor(this, response.nodeIds);
  }, {
    request: {
      node: Arg(0, "chromium_domnode"),
      selector: Arg(1)
    },
    response: {
      list: RetVal("chromium_domnodelist")
    }
  }),

  getActorsForSelector: function*(selector) {
    let {nodeIds} = yield this.rpc.request("DOM.querySelectorAll", {
      nodeId: this.root.handle.nodeId,
      selector: selector
    });
    return nodeIds.map(id => this.refMap.get(id));
  },

  getSuggestionsForQuery: asyncMethod(function*(query, completing, selectorState) {
    let suggestions = new Map();

    if (selectorState === "class") {
      for (let actor of yield this.getActorsForSelector(query || "[class]")) {
        let classes = actor.getAttr("class");
        if (classes) {
          for (let className of classes.split(" ")) {
            if (className.startsWith(completing)) {
              suggestions.set("." + className,
                              (suggestions.get("." + className)|0) + 1);
            }
          }
        }
      }
    } else if (selectorState === "tag") {
      for (let actor of yield this.getActorsForSelector(query || "*")) {
        let tag = actor.handle.nodeName.toLowerCase();
        if ((new RegExp("^" + completing + ".*", "i")).test(tag)) {
          suggestions.set(tag, (suggestions.get(tag)|0) + 1);
        }
      }
    } else if (selectorState === "id") {
      for (let actor of yield this.getActorsForSelector(query || "[id]")) {
        let id = actor.getAttr("id");
        if (id && id.startsWith(completing)) {
          suggestions.set("#" + id, 1);
        }
      }
    } else if (selectorState === "null") {
      for (let actor of yield this.getActorsForSelector(query)) {
        let id = actor.getAttr("id");
        if (id) {
          suggestions.set("#" + id, 1);
        }

        let tag = actor.handle.nodeName.toLowerCase();
        suggestions.set(tag, (suggestions.get(tag)|0) + 1);

        let classes = actor.getAttr("class");
        if (classes) {
          for (let className of classes.split(" ")) {
            suggestions.set("." + className,
                            (suggestions.get("." + className)|0) + 1);
          }
        }
      }
    }

    let result = [...suggestions];

    // Sort alphabetically in increaseing order.
    result = result.sort();
    // Sort based on count in decreasing order.
    result = result.sort(function(a, b) {
      return b[1] - a[1];
    });

    result.slice(0, 25);

    return {
      query: query,
      suggestions: result
    };
  }, {
    request: {
      query: Arg(0),
      completing: Arg(1),
      selectorState: Arg(2)
    },
    response: {
      list: RetVal("array:array:string")
    }
  }),

  _applyPseudoClassLock: task.async(function*(node) {
    let response = yield this.rpc.request("CSS.forcePseudoState", {
      nodeId: node.handle.nodeId,
      forcedPseudoClasses: (node.writePseudoClassLocks() || []).map(item => item.slice(1))
    });
    this.queueMutation({
      target: node.actorID,
      type: "pseudoClassLock",
      pseudoClassLocks: node.writePseudoClassLocks()
    });
  }),

  _pseudoNodes: function*(node, options) {
    yield node;
    if (options.parents) {
      let parent = node.parent;
      while (parent && !parent.isDocument()) {
        yield parent;
        parent = parent.parent;
      }
    }
  },

  addPseudoClassLock: method(function(node, pseudoClass, options={}) {
    let responses = [];
    for (let applyNode of this._pseudoNodes(node, options)) {
      applyNode.pseudoLock(pseudoClass);
      responses.push(this._applyPseudoClassLock(applyNode));
    }
    return Promise.all(responses);
  }, pseudoClassMethod),

  removePseudoClassLock: method(function(node, pseudoClass, options={}) {
    let responses = [];
    for (let applyNode of this._pseudoNodes(node, options)) {
      applyNode.pseudoUnlock(pseudoClass);
      responses.push(this._applyPseudoClassLock(applyNode));
    }
    return Promise.all(responses);
  }, pseudoClassMethod),

  clearPseudoClassLocks: method(function(node) {
    let responses = [];
    for (let clearNode of (node ? [node] : this.pseudoLockedNodes)) {
      clearNode.pseudoClear();
      responses.push(this._applyPseudoClassLock(clearNode));
    }
    return Promise.all(responses);
  }, {
    request: {
      node: Arg(0, "nullable:chromium_domnode")
    },
    response: {}
  }),

  hideNode: todoMethod({
    request: { node: Arg(0, "chromium_domnode") }
  }, "hideNode"),

  showNode: todoMethod({
    request: { node: Arg(0, "chromium_domnode") }
  }, "showNode"),

  innerHTML: asyncMethod(function*(node) {
    // XXX: The protocol doesn't support getInnerHTML, so use the outerHTML,
    // parse it, and get the innerHTML from that.
    let {outerHTML} = yield this.rpc.request("DOM.getOuterHTML", {
      nodeId: node.handle.nodeId
    });

    let DOMParser = Cc["@mozilla.org/xmlextras/domparser;1"].createInstance(
      Ci.nsIDOMParser);

    let el = DOMParser.parseFromString(outerHTML, "text/html");

    // The HTML parser wraps the node in <html><body> except if the node is
    // <html>, <body, <head>, <title>, ...
    let htmlGetters = {
      "html": el => el.head.outerHTML + el.body.outerHTML,
      "body": el => el.body.innerHTML,
      "head": el => el.head.innerHTML,
      "title": el => el.head.children[0].innerHTML,
      "meta": el => el.head.children[0].innerHTML,
      "default": el => el.body.children[0].innerHTML
    };

    let tagName = node.handle.nodeName.toLowerCase();
    let htmlGetter = htmlGetters[tagName] || htmlGetters.default;

    return new LongStringActor(this.conn, htmlGetter(el));
  }, {
    request: { node: Arg(0, "chromium_domnode") },
    response: { value: RetVal("longstring") }
  }),

  outerHTML: asyncMethod(function*(node) {
    let response = yield this.rpc.request("DOM.getOuterHTML", {
      nodeId: node.handle.nodeId
    });

    return new LongStringActor(this.conn, response.outerHTML);
  }, {
    request: { node: Arg(0, "chromium_domnode") },
    response: { value: RetVal("longstring") }
  }),

  setOuterHTML: asyncMethod(function*(node, value) {
    yield this.rpc.request("DOM.setOuterHTML", {
      nodeId: node.handle.nodeId,
      outerHTML: value
    });
  }, {
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
  }, "insertBefore"),

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

  isInDOMTree: asyncMethod(function*(node) {
    // Reaching the top of tree
    let current = node;
    while (current.parent) {
      current = current.parent;
    }

    // Checking if the top is the walker's root
    return current === this.root;
  }, {
    request: { node: Arg(0, "chromium_domnode") },
    response: { attached: RetVal("boolean") }
  }),

  getNodeActorFromObjectActor: asyncMethod(function*(objectActorID) {
    let objectActor = this.conn.getActor(objectActorID);

    let {nodeId} = yield this.rpc.request("DOM.requestNode", {
      objectId: objectActor.handle.objectId
    });

    return this.attachElement(nodeId);
  }, {
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
  }, "getStyleSheetOwnerNode"),
});
exports.ChromiumWalkerActor = ChromiumWalkerActor;
