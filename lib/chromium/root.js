
/**
 * Implementation of the root and tab actors for the Chromium debugging server.
 */

const request = require("sdk/request");

const task = require("../util/task");

const protocol = require("../devtools-require")("devtools/server/protocol");
const {Actor, method, Arg, Option, RetVal, emit} = protocol;
const {asyncMethod, types} = require("../util/protocol-extra");

const {ChromiumConsoleActor} = require("./webconsole");
const {ChromiumInspectorActor} = require("./inspector");
const {ChromiumReflowActor} = require("./reflow");
const {ChromiumStyleSheetsActor} = require("./styles");
const {ChromiumThreadActor} = require("./thread")

const sheets = require("./sheet-store");
const resources = require("./resource-store");

types.addDictType("chromium_tablist", {
  selected: "number",
  tabs: "array:chromium_tab"
});

function requestTabs(url) {
  return new Promise((resolve, reject) => {
    let tabsRequest = request.Request({
      url: url,
      onComplete: function(response) {
        if (response.status === 200) {
          resolve(response.json);
        } else {
          reject(response.statusText);
        }
      }
    });
    tabsRequest.get();
  });
}

exports.requestTabs = requestTabs;

var ChromiumRootActor = protocol.ActorClass({
  typeName: "chromium_root",

  initialize: function(conn, url) {
    this.actorID = "root";
    Actor.prototype.initialize.call(this, conn);
    this.tabActors = new Map();
  },

  sayHello: function() {
    this.conn.send({
      from: this.actorID,
      applicationType: "browser",
      // There's work to do here.
      traits: {
        sources: false,
        editOuterHTML: true,
        highlightable: true,
        urlToImageDataResolver: true,
        networkMonitor: false,
        storageInspector: false,
        storageInspectorReadOnly: false,
        conditionalBreakpoints: false,
        addNewRule: true,
        noBlackBoxing: true,
        noPrettyPrinting: true
      }
    });
  },

  listTabs: asyncMethod(function*() {
    let jsonTabs = yield requestTabs(this.conn.url + "/json");

    let response = {
      tabs: []
    };

    for (let json of jsonTabs) {
      // json.webSocketDebuggerUrl disappears if some client is already
      // connected to that page. To ensure we still show all tabs in the list,
      // we don't filter on this, but it's possible attaching to such a tab will
      // fail if it was some client other than us that did so.
      response.tabs.push(this.tabActorFor(json));
      if (!("selected" in response) && json.type == "page") {
        response.selected = response.tabs.length - 1;
      }
    }

    if (!("selected" in response)) {
      response.selected = 0;
    }

    return response;
  }, {
    request: {},
    response: RetVal("chromium_tablist")
  }),

  protocolDescription: method(function() {
    return protocol.dumpProtocolSpec();
  }, {
    request: {},
    response: RetVal("json")
  }),

  echo: method(function(str) {
    return str;
  }, {
    request: {
      string: Arg(0, "string")
    },
    response: {
      string: RetVal("string")
    }
  }),

  destroy: function() {
    for (let actor of this.tabActors.values()) {
      actor.destroy();
    }
  },

  tabActorFor: function(json) {
    // Safari on IOS doesn't give its tabs ids. Let's use
    // its socket url as a unique ID.
    let uuid = json.id || json.webSocketDebuggerUrl;

    if (this.tabActors.has(uuid)) {
      return this.tabActors.get(uuid);
    }

    let actor = ChromiumTabActor(this, json);
    this.tabActors.set(uuid, actor);
    return actor;
  }
});

exports.ChromiumRootActor = ChromiumRootActor;

var ChromiumTabActor = protocol.ActorClass({
  typeName: "chromium_tab",

  events: {
    "tab-navigated": {
      type: "tabNavigated",
      url: Arg(0, "string"),
      state: Arg(1, "string"),
      nativeConsoleAPI: true, // I dont't like that this is piggybacking here.
    }
  },

  initialize: function(root, json) {
    const rpc = require("./rpc");
    let conn = root.conn;

    Actor.prototype.initialize.call(this, conn);
    this.root = root;
    this.json = json;
    this.rpc = rpc.TabConnection(json);

    this.rpc.on("Page.frameNavigated", this.onPageNavigated.bind(this));

    this.consoleActorID = conn.manageLazy(this, conn.allocID(), () => {
      return ChromiumConsoleActor(this);
    });
    this.inspectorActorID = conn.manageLazy(this, conn.allocID(), () => {
      return ChromiumInspectorActor(this);
    });
    this.reflowActorID = conn.manageLazy(this, conn.allocID(), () => {
      return ChromiumReflowActor(this);
    });
    this.styleSheetsActorID = conn.manageLazy(this, conn.allocID(), () => {
      return ChromiumStyleSheetsActor(this);
    });
  },

  form: function(detail) {
    // Change chrome-specific URLs to something that Firefox can handle.
    let url = this.json.url.replace(/^chrome:\/\//, "http://chrome-");
    return {
      actor: this.actorID,
      title: this.json.title,
      url: url,
      consoleActor: this.consoleActorID,
      inspectorActor: this.inspectorActorID,
      reflowActor: this.reflowActorID,
      styleSheetsActor: this.styleSheetsActorID
    }
  },

  onPageNavigated: function(params) {
    // XXX: We only send tabNavigated for toplevel frame loads.
    // Which is a weakness of the fxdevtools protocol, look in to that.
    if (params.frame.parentId) {
      return;
    }

    // XXX: send the start event here because I don't know how to get
    // the start even of only the top-level page.
    // `frameStartedLoading` is the right event but there's no way to
    // detect that it's the top-level page.
    emit(this, "tab-navigated", this.currentURL, "start");

    this.rootFrameId = params.frame.id;
    this.currentURL = params.frame.url;

    emit(this, "tab-navigated", params.frame.url, "stop");
  },

  /**
   * Subscribe to tab navigation events and enable inspection.
   */
  attach: asyncMethod(function*() {
    yield this.rpc.request("Inspector.enable");
    // The DOM agent should also be enabled at this stage. Chrome > 39 requires
    // it when the CSSStore is initialized.
    try {
      yield this.rpc.request("DOM.enable");
    } catch (e) {
      // This fails on ios, but ios doesn't require the agent to be enabled.
    }

    this.resources = resources.getResourceStore(this.rpc);
    this.sheets = sheets.getCSSStore(this.rpc);

    yield this.resources.init();
    yield this.sheets.init();

    this.rootFrameId = this.resources.frameTree.frame.id;
    this.currentURL = this.resources.frameTree.frame.url;

    this.thread = ChromiumThreadActor(this);
    return this.thread;
  }, {
    request: {},
    response: {
      type: "tabAttached",
      threadActor: RetVal("chromium_thread#actorid")
    }
  }),

  navigateTo: asyncMethod(function*(url) {
    yield this.rpc.request("Page.navigate", {
      url: url
    });
  }, {
    request: {
      url: Arg(0, "string")
    }
  }),

  reload: asyncMethod(function*(options) {
    yield this.rpc.request("Page.reload", {
      ignoreCache: options.force
    });
  }, {
    request: {
      options: Arg(0, "nullable:json")
    }
  }),

  reconfigure: method(function(options) {
    if (typeof options.cacheDisabled !== "undefined") {
      yield this.rpc.request("Network.setCacheDisabled", {
        cacheDisabled: options.cacheDisabled
      });
    }

    if (options.performReload) {
      this.reload({ force: options.cacheDisabled });
    }
  }, {
    request: {
      options: Arg(0, "nullable:json")
    },
    response: {}
  }),

  destroy: function() {
    this.detach();
    this.rpc.close();
    this.sheets.destroy();
    this.sheets = null;

    this.resources.destroy();
    this.resources = null;
    Actor.prototype.destroy.call(this);
  },

  /**
   * Unsubscribe from tab navigation events.
   */
  detach: asyncMethod(function*() {
    yield this.rpc.request("Page.disable");
    yield this.rpc.request("Inspector.disable");
  }, {
    request: {},
    response: {}
  })
});
