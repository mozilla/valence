const {Class} = require("sdk/core/heritage");
const task = require("../util/task");

const protocol = require("../devtools-require")("devtools/server/protocol");
const {asyncMethod, types} = require("../util/protocol-extra");
const {Actor, Pool, method, Arg, Option, RetVal, emit} = protocol;
const values = require("./value");
const preview = require("./preview");

const {JSTermHelpers, JSPropertyProvider} = require("./console-utils");

types.addDictType("chromium_consolemsg", {
  "arguments": "array:chromium_grip",
  "stacktrace": "array:json",
  "styles": "array:chromium_grip"
});
types.addDictType("chromium_pageerror", {
  // XXX: should be longstring, but it doesn't get properly marshalled on reload
  "errorMessage": "string",
});

var ChromiumConsoleActor = protocol.ActorClass({
  typeName: "chromium_console",

  toString: function() { return "[ConsoleActor:" + this.actorID + "]" },

  events: {
    "ConsoleAPI": {
      type: "consoleAPICall",
      message: Arg(0, "chromium_consolemsg")
    },
    "PageError": {
      type: "pageError",
      pageError: Arg(0, "chromium_pageerror")
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
      if (payload.arguments) {
        for (let handle of payload.arguments) {
          yield preview.loadPreview(this.rpc, handle);
        }
      }

      emit(this, type, payload);
    } else {
      // XXX: Maybe we should limit the size of this cache?
      this.messageCache[type].push(payload);
    }
  }),

  toConsoleAPIMessage: function(msg) {
//     type ( optional enumerated string [ "assert" , "clear" , "dir" ,
// "dirxml" , "endGroup" , "log" , "profile" , "profileEnd" , "startGroup" ,
// "startGroupCollapsed" , "table" , "timing" , "trace" ] )
    let payload = {
      "level": msg.level == "warning" ? "warn" : msg.level,
      "arguments": msg.parameters ||
                   [{ type: "string", value: msg.text }] || // "text" is not a grip
                   [],
      "counter": null,
      "filename": msg.url,
      "lineNumber": msg.line,
      "timeStamp": msg.timestamp * 1000, // Convert from sec to msec.
      "groupName": msg.type == "startGroup" ? msg.text : "",
      "private": false, // XXX: Dunno if we can tell that from this proto?
      "styles": [],
      "timer": null,
      "_type": "ConsoleAPI",
    };

    if (msg.type == "dir" || msg.type == "trace" || msg.type == "table") {
      payload.level = msg.type;
    } else if (msg.type == "startGroup") {
      payload.level = "group";
    } else if (msg.type == "startGroupCollapsed") {
      payload.level = "groupCollapsed";
    } else if (msg.type == "endGroup") {
      payload.level = "groupEnd";
    }

    if (msg.stackTrace) {
      payload.functionName = msg.stackTrace[0].functionName;
      payload.stacktrace = [];
      for (let frame of msg.stackTrace) {
        payload.stacktrace.push({
          language: 2, // JS
          lineNumber: frame.lineNumber,
          columnNumber: frame.columnNumber,
          functionName: frame.functionName,
          filename: frame.url
        });
      }
    } else {
      payload.functionName = "";
    }

    return {
      type: "ConsoleAPI",
      payload: payload
    }
  },

  toGenericEvent: function(msg) {
    return payload = {
      errorMessage: msg.text,
      sourceName: msg.url,
      lineText: "",
      lineNumber: msg.line,
      columnNumber: msg.column,
      timeStamp: msg.timestamp * 1000, // Convert from sec to msec.
      warning: msg.level == "warning",
      error: msg.level == "error",
      exception: false,
      strict: false, // XXX: Dunno if we can tell that from this proto?
      private: false, // XXX: Dunno if we can tell that from this proto?
      _type: "PageError",
    };
  },

  toEvent: function(msg) {
    let payload = null;

    switch (msg.source) {
      case "javascript":
        payload = this.toGenericEvent(msg);
        payload.category = "content javascript";
        payload.exception = msg.level == "error";
        payload.error = false;
        break;
      case "css":         // fall-through
      case "rendering":
        payload = this.toGenericEvent(msg);
        payload.category = "CSS Parser";
        break;
      case "security":
        payload = this.toGenericEvent(msg);
        // We could use any one of the Gecko security categories here.
        payload.category = "CSP";
        break;
      case "appcache":    // fall-through
      case "deprecation": // fall-through
      case "network":     // fall-through
      case "other":       // fall-through
      case "storage":     // fall-through
      case "xml":
        payload = this.toGenericEvent(msg);
        // The JavaScript category is the default for our console.
        payload.category = "content javascript";
        break;
      case "console-api":
        // Console API has a different packet format, so return early.
        return this.toConsoleAPIMessage(msg);
      default:
        console.error("Received " + msg.source + " event that don't know how to handle!");
        return null;
    }

    return {
      type: "PageError",
      payload: payload
    }
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
    for (let listener of listeners) {
      this.enabledListeners.add(listener);
    }

    // Enable the messages after enabledListeners is set, as it will be
    // consulted even before this response is sent.
    let response = yield this.rpc.request("Console.enable");

    this.listening = false;
    return {
      startedListeners: listeners,
      nativeConsoleAPI: true
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
      result = {
        type: "undefined"
      };
      exceptionMessage = response.result.description;
      exception = response.result;
      if (response.exceptionDetails) {
        exception.preview.fileName = exception.preview.fileName ||
                                     response.exceptionDetails.url;
        exception.preview.lineNumber = exception.preview.lineNumber ||
                                     response.exceptionDetails.line;
        exception.preview.columnNumber = exception.preview.columnNumber ||
                                     response.exceptionDetails.column;
      }
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
      result: "nullable:chromium_grip",
      exception: "nullable:chromium_grip"
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
