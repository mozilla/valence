/**
 * Implementation of the root and tab actors for the Chromium debugging server.
 */

const request = require("sdk/request");

const task = require("util/task");

const {emit} = require("devtools/sdk/event/core"); // Needs to share a loader with protocol.js, boo.
const protocol = require("devtools/server/protocol");
const {Actor, ActorClass, method, Arg, Option, RetVal} = protocol;
const {asyncMethod} = require("util/protocol-extra");

const {ChromiumConsoleActor} = require("./webconsole");
const {ChromiumInspectorActor} = require("./inspector");
const {ChromiumStyleSheetsActor} = require("./styles");
const {ChromiumThreadActor} = require("./thread")

const sheets = require("./sheet-store");
const resources = require("./resource-store");

protocol.types.addDictType("chromium_tablist", {
  selected: "number",
  tabs: "array:chromium_tab"
});

function requestTabs(url) {
  console.log("Requesting tabs from: " + url);
  return new Promise((resolve, reject) => {
    let tabsRequest = request.Request({
      url: url,
      onComplete: function(response) {
        if (response.status === 200 && response.json.length > 0) {
          console.log("response: " + JSON.stringify(response.json));
          resolve(response.json);
        } else {
          reject(response.statusText);
        }
      }
    });
    tabsRequest.get();
  });
}

var ChromiumRootActor = ActorClass({
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
        editOuterHTML: false,
        highlightable: true,
        urlToImageDataResolver: false,
        networkMonitor: false,
        storageInspector: false,
        storageInspectorReadOnly: false,
        conditionalBreakpoints: false
      }
    });
  },

  listTabs: asyncMethod(function*() {
    let jsonTabs = yield requestTabs(this.conn.url + "/json");

    console.log("tabs: " + JSON.stringify(jsonTabs));

    let response = {
      tabs: []
    };

    for (let json of jsonTabs) {
      if (!json.webSocketDebuggerUrl) {
        continue;
      }
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


  tabActorFor: function(json) {
    if (!json.id) { // Safari on IOS doesn't give its tabs ids.
      this.iosID = this.iosID || 1;
      json.id = this.iosID++;
    }
    if (this.tabActors.has(json.id)) {
      return this.tabActors.get(json.id);
    }

    let actor = ChromiumTabActor(this, json);
    this.tabActors.set(json.id, actor);
    return actor;
  }
});

exports.ChromiumRootActor = ChromiumRootActor;

var ChromiumTabActor = ActorClass({
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
    const rpc = require("chromium/rpc");
    let conn = root.conn;

    Actor.prototype.initialize.call(this, conn);
    this.root = root;
    this.json = json;
    this.rpc = rpc.TabConnection(json);

    this.rpc.on("Page.frameStartedLoading", this.onFrameStartedLoading.bind(this));
    this.rpc.on("Page.frameNavigated", this.onPageNavigated.bind(this));

    this.consoleActorID = conn.manageLazy(this, conn.allocID(), () => {
      return ChromiumConsoleActor(this);
    });
    this.inspectorActorID = conn.manageLazy(this, conn.allocID(), () => {
      return ChromiumInspectorActor(this);
    });
    this.styleSheetsActorID = conn.manageLazy(this, conn.allocID(), () => {
      return ChromiumStyleSheetsActor(this);
    });
  },

  form: function(detail) {
    return {
      actor: this.actorID,
      title: this.json.title,
      url: this.json.url,
      consoleActor: this.consoleActorID,
      inspectorActor: this.inspectorActorID,
      styleSheetsActor: this.styleSheetsActorID
    }
  },

  onFrameStartedLoading: task.async(function*(params) {
    if (params.frameId != this.rootFrameId) {
      return;
    }

    emit(this, "tab-navigated", this.currentURL, "start");
  }),

  onPageNavigated: function(params) {
    // XXX: We only send tabNavigated for toplevel frame loads.
    // Which is a weakness of the fxdevtools protocol, look in to that.
    if (params.frame.parentId) {
      return;
    }

    this.rootFrameId = params.frame.id;
    this.currentURL = params.frame.url;

    emit(this, "tab-navigated", params.frame.url, "stop");
  },

  /**
   * Subscribe to tab navigation events and enable inspection.
   */
  attach: asyncMethod(function*() {
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

  /**
   * Unsubscribe from tab navigation events.
   */
  detach: asyncMethod(function*() {
    yield this.rpc.request("Page.disable");
    this.sheets.destroy();
    this.sheets = null;

    this.resources.destroy();
    this.resources = null;
  }, {
    request: {},
    response: {}
  })
});
