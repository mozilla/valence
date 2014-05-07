const {Class} = require("sdk/core/heritage");
const {emit} = require("devtools/sdk/event/core"); // Needs to share a loader with protocol.js, boo.
const task = require("util/task");

const protocol = require("devtools/server/protocol");
const {asyncMethod} = require("util/protocol-extra");
const {Actor, ActorClass, Pool, method, Arg, Option, RetVal} = protocol;

protocol.types.addDictType("chromium_consolemsg", {
  // XXX: Figure out objects.
});

function toConsoleAPIMessage(msg) {
  let payload = {
    "level": msg.level,
    "arguments": [
      msg.text
    ],
    "counter": null,
    "filename": msg.url,
    "lineNumber": msg.line,
    "timeStamp": msg.timestamp,
    "groupName": "",
    "private": false, // XXX: Dunno if we can tell that from this proto?
    "styles": [],
    "timer": null, // hrm?
    "_type": "ConsoleAPI",
  };

  payload.parameters = [];

  if (msg.stackTrace) {
    let frame = msg.stackTrace[0];
    payload.functionName = frame.functionName;
  } else {
    payload.functionName = "";
  }

  return {
    type: "ConsoleAPI",
    payload: payload
  }
}

function toEvent(msg) {
//  source ( enumerated string [ "appcache" , "console-api" , "css" , "deprecation" , "javascript" , "network" , "other" , "rendering" , "security" , "storage" , "xml" ] ) 

  if (msg.source === "console-api") {
    return toConsoleAPIMessage(msg)
  }
  return null;
}

var ChromiumConsoleActor = ActorClass({
  typeName: "chromium_console",

  toString: function() { return "[ConsoleActor:" + this.actorID + "]" },

  events: {
    "ConsoleAPI": {
      type: "consoleAPICall",
      message: Arg(0, "chromium_consolemsg")
    }
  },

  initialize: function(tab) {
    Actor.prototype.initialize.call(this, tab.conn);
    this.rpc = tab.rpc;

    this.rpc.on("Console.messageAdded", this.onMessage.bind(this));

    this.enabledListeners = new Set();
    this.messageCache = {};
    this.clearMessagesCache();
  },

  cacheOrSend: function(type, payload) {
    if (this.enabledListeners.has(type)) {
      emit(this, type, payload);
    } else {
      // XXX: Maybe we should limit the size of this cache?
      this.messageCache[type].push(payload);
    }
  },

  onMessage: function(params) {
    let evt = toEvent(params.message);
    if (!evt) {
      return;
    }
    this.cacheOrSend(evt.type, evt.payload);
  },

  startListeners: asyncMethod(function*(listeners) {
    // Enable the request.  While this is waiting.
    let response = yield this.rpc.request("Console.enable");

    for (let listener of listeners) {
      this.enabledListeners.add(listener);
    }

    this.listening = false;
    return {
      startedListeners: listeners,
      nativeConsoleAPI: true // XXX: Not sure what this is for.
    }
  }, {
    request: {
      listeners: Arg(0, "array:string")
    },
    response: RetVal("json")
  }),

  stopListeners: asyncMethod(function*(listeners) {
    for (let listener of listeners) {
      this.enabledListeners.delete(listener);
    }
    let response = yield this.rpc.request("Console.disable");
    return {
      stoppedListeners: listeners
    }
  }, {
    request: {
      listeners: Arg(0, "array:string")
    },
    response: RetVal("json")
  }),

  getCachedMessages: method(function(messageTypes) {
    let messages = [];
    for (let type of messageTypes) {
      messages = messages.concat(this.messageCache[type]);
    }
    return messages;
  }, {
    request: {
      messageTypes: Arg(0, "array:string")
    },
    response: {
      messages: RetVal("array:chromium_consolemsg")
    }
  }),

  clearMessagesCache: method(function() {
    for (let msg of ["ConsoleAPI", "PageError", "NetworkActivity", "FileActivity"]) {
      this.messageCache[msg] = [];
    }
  }, {
    request: {},
    response: {},
  }),

  evaluateJS: method(function() {

  }, {
    request: {},
    response: {}
  }),


  getPreferences: method(function() {

  }, {
    request: {},
    response: {}
  }),

  setPreferences: method(function() {

  }, {
    request: {},
    response: {}
  }),

  sendHTTPRequest: method(function() {

  }, {
    request: {},
    response: {}
  })

});

exports.ChromiumConsoleActor = ChromiumConsoleActor;
