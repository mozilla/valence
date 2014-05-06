/**
 * Implementation of the root and tab actors for the Chromium debugging server.
 */

const request = require("sdk/request");

const protocol = require("devtools/server/protocol");
const {Actor, ActorClass, method, Arg, Option, RetVal} = protocol;
const {asyncMethod} = require("util/protocol-extra");

const {ChromiumConsoleActor} = require("chromium/webconsole");

protocol.types.addDictType("chromium_tablist", {
  selected: "number",
  tabs: "array:chromium_tab"
});

function requestTabs(url) {
  return new Promise((resolve, reject) => {
    let tabsRequest = request.Request({
      url: url,
      onComplete: function(response) {
        resolve(response.json);
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
        highlightable: false,
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

    return response;
  }, {
    request: {},
    response: RetVal("chromium_tablist")
  }),

  tabActorFor: function(json) {
    if (this.tabActors.has(json.id)) {
      return this.tabActors.get(json.id);
    }

    let actor = ChromiumTabActor(this.conn, json);
    this.tabActors.set(json.id, actor);
    return actor;
  }
});

exports.ChromiumRootActor = ChromiumRootActor;

var ChromiumTabActor = ActorClass({
  typeName: "chromium_tab",

  initialize: function(conn, json) {
    Actor.prototype.initialize.call(this, conn);
    this.json = json;
    const rpc = require("chromium/rpc");
    this.rpc = rpc.TabConnection(json);

    this.consoleActorID = conn.manageLazy(this, conn.allocID(), () => {
      return ChromiumConsoleActor(this);
    });
  },

  form: function(detail) {
    return {
      actor: this.actorID,
      title: this.json.title,
      url: this.json.url,
      consoleActor: this.consoleActorID
    }
  }
});
