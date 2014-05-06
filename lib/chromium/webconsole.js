const {Class} = require("sdk/core/heritage");
const task = require("util/task");

const protocol = require("devtools/server/protocol");
const {Actor, ActorClass, Pool, method, Arg, Option, RetVal} = protocol;

function currentTimestamp() {
  return Date.now();
}

function toConsoleAPIMessage(msg) {
  let message = {
    "level": msg.level,
    "filename": msg.url,
    "lineNumber": msg.line,
    "timeStamp": currentTimestamp(),
    "private": false, // XXX: Dunno if we can tell that from this proto?
  };

  message.parameters = [];

  if (msg.stackTrace) {
    let frame = msg.stackTrace[0];
    message.functionName = frame.functionName;
  } else {
    message.functionName = "";
  }

  return {
    type: "message",
    message: message
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

  initialize: function(tab) {
    Actor.prototype.initialize.call(this, tab.conn);
    this.rpc = tab.rpc;

    this.enabledListeners = new Set();

    this.rpc.on("Console.messageAdded", this.onMessage.bind(this));
    this.listening = false;

    this.cachedMessages = {
      "PageError": [],
      "ConsoleAPI": []
    };
  },

  onMessage: function(params) {
    let evt = toEvent(params);
    console.log("GOT A MESSAGE: " + JSON.stringify(params));
  },

  startListeners: method(task.async(function*(listeners) {
    for (let listener of listeners) {
      this.enabledListeners.add(listener);
    }
    let response = yield this.rpc.request("Console.enable");
    this.listening = false;
    return {
      startedListeners: listeners,
      nativeConsoleAPI: false // XXX: Not sure what this is for.
    }
  }), {
    request: {
      listeners: Arg(0, "array:string")
    },
    response: RetVal("json")
  }),

  stopListeners: method(task.async(function*(listeners) {
    for (let listener of listeners) {
      this.enabledListeners.remove(listener);
    }
    let response = yield this.rpc.request("Console.disable");
    return {
      stoppedListeners: listeners
    }
  }), {
    request: {
      listeners: Arg(0, "array:string")
    },
    response: RetVal("json")
  }),

  getCachedMessages: method(function() {

  }, {
    request: {},
    response: {}
  }),

  evaluateJS: method(function() {

  }, {
    request: {},
    response: {}
  }),

  clearMessagesCache: method(function() {
  }, {
    request: {},
    response: {},
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
