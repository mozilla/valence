const {Class} = require("sdk/core/heritage");
const task = require("../util/task");

const protocol = require("../devtools-require")("devtools/server/protocol");
const {asyncMethod, ActorClass, types} = require("../util/protocol-extra");
const {Actor, Pool, method, Arg, Option, RetVal, emit} = protocol;
const values = require("./value");
const preview = require("./preview");

const {JSTermHelpers, JSPropertyProvider} = require("./console-utils");

types.addDictType("chromium_consolemsg", {
  "arguments": "array:chromium_grip"
  // XXX: Figure out objects.
});

var ChromiumConsoleActor = ActorClass({
  typeName: "chromium_console",

  toString: function() { return "[ConsoleActor:" + this.actorID + "]" },

  events: {
    "ConsoleAPI": {
      type: "consoleAPICall",
      message: Arg(0, "chromium_consolemsg")
    },
    "PageError": {
      type: "pageError",
      message: Arg(0, "chromium_consolemsg")
    }
  },

  initialize: function(tab) {
    Actor.prototype.initialize.call(this, tab.conn);
    this.rpc = tab.rpc;

    this.rpc.on("Console.messageAdded", this.onMessage.bind(this));
    this.rpc.on("Console.messageRepeatCountUpdated",
      this.onMessageCountUpdated.bind(this));

    this.enabledListeners = new Set();
    this.messageCache = {};
    this.clearMessagesCache();
  },

  cacheOrSend: task.async(function*(type, payload) {
    if (this.enabledListeners.has(type)) {
      // Make sure each payload argument can be previewed
      for (let handle of payload.arguments) {
        yield preview.loadPreview(this.rpc, handle);
      }

      emit(this, type, payload);
    } else {
      // XXX: Maybe we should limit the size of this cache?
      this.messageCache[type].push(payload);
    }
  }),

  toGeneric: function(msg) {
    let payload = {
      "level": msg.level,
      "arguments": msg.parameters,
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

    if (msg.stackTrace) {
      let frame = msg.stackTrace[0];
      payload.functionName = frame.functionName;
    } else {
      payload.functionName = "";
    }

    return payload;
  },

  toConsoleAPIMessage: function(msg) {
//     type ( optional enumerated string [ "assert" , "clear" , "dir" , 
// "dirxml" , "endGroup" , "log" , "profile" , "profileEnd" , "startGroup" ,
// "startGroupCollapsed" , "table" , "timing" , "trace" ] ) 
    let payload;
    switch(msg.type) {
      case "assert":
        msg.level = "assert"
        // fall through.
      default:
        payload = this.toGeneric(msg);
    }

    return {
      type: "ConsoleAPI",
      payload: payload
    }
  },

  toJavaScriptMessage: function(msg) {
    let payload = {
      errorMessage: msg.text, // XXX: use a long string
      sourceName: msg.url,
      lineText: "",
      lineNumber: msg.line,
      columnNumber: msg.column,
      category: "content javascript",
      timeStamp: msg.timestamp,
      warning: false,
      error: false,
      exception: msg.level == "error",
      strict: false, // XXX: Dunno if we can tell that from this proto?
      private: false, // XXX: Dunno if we can tell that from this proto?
      _type: "PageError",
    };

    return {
      type: "PageError",
      payload: payload
    }
  },

  toEvent: function(msg) {
    //  source ( enumerated string [ "appcache" , "console-api" , "css" ,
    // "deprecation" , "javascript" , "network" , "other" , "rendering" ,
    // "security" , "storage" , "xml" ] )
    switch (msg.source) {
      case "console-api":
        return this.toConsoleAPIMessage(msg);
      case "javascript":
        return this.toJavaScriptMessage(msg);
      default:
        console.log("Received " + msg.source + " event that don't know how to handle!\n");
    }
    return null;
  },

  onMessage: function(params) {
    let evt = this.toEvent(params.message);
    if (!evt) {
      return;
    }

    this.currentEvent = evt;
    this.cacheOrSend(evt.type, evt.payload);
  },

  onMessageCountUpdated: function(params) {
    if (this.currentEvent) {
      this.cacheOrSend(this.currentEvent.type, this.currentEvent.payload);
    }
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

    if (this.enabledListeners.size < 1) {
      let response = yield this.rpc.request("Console.disable");
    }
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

  evaluateJS: asyncMethod(function*(expression) {
    let response = yield this.rpc.request("Runtime.evaluate", {
      expression: expression,
      includeCommandLineAPI: true, // XXX: hrm?
    });

    yield preview.loadPreview(this.rpc, response.result);

    let result, exception = null, exceptionMessage;
    if (response.wasThrown) {
      exception = response.result;
      exceptionMessage = response.result.description;
    } else {
      result = response.result;
    }

    return {
      input: expression,
      timestamp: Date.now(),
      exception: exception,
      exceptionMessage: exceptionMessage,
      helperResult: null,
      result: result,
    }
  }, {
    request: {
      text: Arg(0, "string")
    },
    response: RetVal(types.addDictType("chromium_evalJSResponse", {
      result: "nullable:chromium_grip"
    }))
  }),

  autocomplete: asyncMethod(function*(text, cursor) {
    // TODO: support the case of a paused debugger.
    let { result: handle } = yield this.rpc.request("Runtime.evaluate", {
      expression: "this"
    });
    let obj = values.grip(handle, this);
    let result = (yield JSPropertyProvider(this, obj, text, cursor)) || {};
    let matches = result.matches || [];
    let reqText = text.substr(0, cursor);

    // We consider '$' as alphanumeric because it is used in the names of some
    // helper functions.
    let lastNonAlphaIsDot = /[.][a-zA-Z0-9$]*$/.test(reqText);
    if (!lastNonAlphaIsDot) {
      if (!this._jstermHelpersCache) {
        let helpers = {
          sandbox: Object.create(null)
        };
        JSTermHelpers(helpers);
        this._jstermHelpersCache = Object.getOwnPropertyNames(helpers.sandbox);
      }
      matches = matches.concat(this._jstermHelpersCache.filter(n => n.startsWith(result.matchProp)));
    }

    return {
      matches: matches.sort(),
      matchProp: result.matchProp,
    };
  }, {
    request: {
      text: Arg(0, "string"),
      cursor: Arg(1, "number")
    },
    response: RetVal("json")
  }),

  getPreferences: method(function() {}, {
    request: {},
    response: {}
  }),

  setPreferences: method(function() {}, {
    request: {},
    response: {}
  }),

  sendHTTPRequest: method(function() {}, {
    request: {},
    response: {}
  })
});

exports.ChromiumConsoleActor = ChromiumConsoleActor;
