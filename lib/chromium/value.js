/**
 * Value grips.
 */

const protocol = require("../devtools-require")("devtools/server/protocol");
const {Actor, method, Arg, Option, RetVal} = protocol;
const {asyncMethod, types, ActorClass} = require("../util/protocol-extra");

exports.convertProperty = function(chrProp) {
  return {
    enumerable: chrProp.enumerable,
    configurable: chrProp.configurable,
    writable: chrProp.writable, // different spelling, tricky.

    // These are all relying on the marshaller to convert.
    get: chrProp.get,
    set: chrProp.set,
    value: chrProp.value
  }
}


// Value grips are marshalled special.  Marshalls a grip from a chromium
// object handle into an object actor.
exports.gripType = types.addType("chromium_grip", {
  category: "grip",

  read: function() {
    console.assert(false, "I NEVER LEARNED HOW TO READ");
  },

  /**
   * Take a handle and write it to the wire.  Can also take premade object
   * grips, giving the actor a chance to fill in object summaries.
   */
  write: function(handle, ctx, detail) {
    if (handle instanceof Actor) {
      return handle.form(detail, ctx);
    }

    // className
    // description
    // objectId (optional, objects only)
    // subtype (optional, objects only)
    // type  [ x"boolean" , x"function" , x"number" , "object" , x"string" , x"undefined" ]
    // value (primitive only)
    let value = handle.value;
    switch (handle.type) {
      case "boolean":
      case "string": // XXX: need longstrings.
        return value;
      case "number":
        if (typeof(value) === "string") {
          return { type: value };
        }
        return value;
      case "undefined":
        return { type: "undefined" };
      case "object":
      case "function":
        if (handle.subtype === "null") {
          return { type: "null" };
        }
        let grip = objectGrip(handle, ctx);
        return grip.form(detail, ctx);
    }
    throw new Error("Unknown handle type: " + handle.type)
  }
});

types.addDictType("chromium_property", {
  "value": "nullable:chromium_grip",
  "get": "nullable:chromium_grip",
  "set": "nullable:chromium_grip"
});

types.addUniformDictType("chromium_propertylist", "chromium_property");

var ObjectGrip = ActorClass({
  typeName: "chromium_objectgrip",

  initialize: function(conn, rpc, handle) {
    Actor.prototype.initialize.call(this, conn);
    this.rpc = rpc;
    this.handle = handle;
  },

  form: function(detail, ctx) {
    const preview = require("./preview");

    let f = {
      actor: this.actorID,
      type: "object",
      class: this.handle.className,
      extensible: true, // ?
      frozen: false,  // ?
      sealed: false, // ?
    };

    preview.generatePreview(this.handle, f, ctx);

    return f;
  },

  definitionSite: method(function() {

  }, {
    request: {},
    response: {}
  }),

  parameterNames: method(function() {
  }, {
    request: {},
    response: {}
  }),

  prototypeAndProperties: asyncMethod(function*() {
    const preview = require("./preview");
    let response = yield this.rpc.request("Runtime.getProperties", {
      objectId: this.handle.objectId,
      ownProperties: true
    });

    let ret = {
      prototype: { type: "object", subtype: "null"},
      ownProperties: {},
      safeGetterValues: {}
    };

    for (let prop of response.result) {
      if ("value" in prop) {
        yield preview.loadPreview(this.rpc, prop.value);
      }
      if (prop.name === "__proto__") {
        ret.prototype = prop.value;
        continue;
      }

      ret.ownProperties[prop.name] = exports.convertProperty(prop);
    }

    return ret;
  }, {
    request: {},
    response: RetVal(types.addDictType("chromium_prototypeAndPropertiesResponse", {
      prototype: "nullable:chromium_grip",
      ownProperties: "chromium_propertylist"
    }))
  }),

  prototype: method(function() {

  }, {
    request: {},
    response: {}
  }),

  property: method(function() {

  }, {
    request: {},
    response: {}
  }),

  displayString: asyncMethod(function*() {
    let displayString = yield stringify(this.handle, this.rpc);
    return {
      displayString: displayString
    };
  }, {
    request: {},
    response: RetVal("json")
  }),

  ownPropertyNames: method(function() {

  }, {
    request: {},
    response: {}
  }),

  decompile: method(function() {

  }, {
    request: {},
    response: {}
  }),

  release: asyncMethod(function*() {
    yield this.rpc.request("Runtime.releaseObject", {
      objectId: this.handle.objectId
    });
  }, {
    release: true,
    request: {},
    response: {}
  }),

  scope: method(function() {

  }, {
    request: {},
    response: {}
  })
});

function objectGrip(handle, ctx, detail) {
  let actorID = ctx.actorID + "." + handle.objectId;
  if (ctx.has(actorID)) {
    return ctx.get(actorID);
  }

  let grip = ObjectGrip(ctx.conn, ctx.rpc, handle);
  grip.actorID = actorID;
  ctx.marshallPool().manage(grip);
  return grip;
}

function grip(handle, ctx) {
  if (!handle.objectId) {
    // Not an object, let it through.
    return handle;
  }

  let grip = objectGrip(handle, ctx);
  // XXX: fill in enough details.
  return grip;
}
exports.grip = grip;

/**
 * Determine if a given value is non-primitive.
 *
 * @param Any value
 *        The value to test.
 * @return Boolean
 *         Whether the value is non-primitive.
 */
function isObject(value) {
  const type = typeof value;
  return type == "object" ? value !== null : type == "function";
}

/**
 * Create a function that can safely stringify objects of a given
 * builtin type.
 *
 * @param Function ctor
 *        The builtin class constructor.
 * @return Function
 *         The stringifier for the class.
 */
function createBuiltinStringifier(ctor) {
  let fn = "function() {" +
           "  return " + ctor.name + ".prototype.toString.call(this)" + ";" +
           "}";

  return function* (handle, rpc) {
    let response = yield rpc.request("Runtime.callFunctionOn", {
      objectId: handle.objectId,
      functionDeclaration: fn
    });

    if (response.wasThrown) {
      throw new Error(response.result.description);
    }

    return response.result.value;
  }
}

/**
 * Stringify an Error instance.
 *
 * @param Object handle
 *        The handle to stringify.
 * @return String
 *         The stringification of the object.
 */
function* errorStringify(handle, rpc) {
  const preview = require("./preview");

  let {result} = yield rpc.request("Runtime.getProperties", {
    objectId: handle.objectId
  });
  let name = preview.getProperty(result, "name").value;

  if (name === "" || name === undefined) {
    name = handle.className;
  } else if (isObject(name)) {
    name = yield stringify(name, rpc);
  }

  let message = preview.getProperty(result, "message").value;
  if (isObject(message)) {
    message = yield stringify(message, rpc);
  }

  if (message === "" || message === undefined) {
    return name;
  }
  return name + ": " + message;
}

/**
 * Stringify a handle based on its class.
 */
function* stringify(handle, rpc) {
  const stringifier = stringifiers[handle.className] || stringifiers.Object;

  let str;
  try {
    str = yield stringifier(handle, rpc);
  } catch (e) {
    console.error(e);
    str = "<failed to stringify object>";
  }
  return str;
}

// Used to prevent infinite recursion when an array is found inside itself.
let seen = null;

let stringifiers = {
  Error: errorStringify,
  EvalError: errorStringify,
  RangeError: errorStringify,
  ReferenceError: errorStringify,
  SyntaxError: errorStringify,
  TypeError: errorStringify,
  URIError: errorStringify,
  Boolean: createBuiltinStringifier(Boolean),
  Function: createBuiltinStringifier(Function),
  Number: createBuiltinStringifier(Number),
  RegExp: createBuiltinStringifier(RegExp),
  String: createBuiltinStringifier(String),
  Object: handle => "[object " + handle.className + "]",
  Array: function* (handle, rpc) {
    // If we're at the top level then we need to create the Set for tracking
    // previously stringified arrays.
    const topLevel = !seen;
    if (topLevel) {
      seen = new Set();
    } else if (seen.has(handle)) {
      return "";
    }

    seen.add(handle);

    const preview = require("./preview");

    let {result} = yield rpc.request("Runtime.getProperties", {
      objectId: handle.objectId
    });
    const len = preview.getProperty(result, "length").value;

    let string = "";

    // The following check is only required because the debuggee could possibly
    // be a Proxy and return any value. For normal objects, array.length is
    // always a non-negative integer.
    if (typeof len == "number" && len > 0) {
      for (let i = 0; i < len; i++) {
        let itemHandle = preview.getProperty(result, i + "");
        if ("value" in itemHandle) {
          string += itemHandle.value;
        } else {
          string += yield stringify(itemHandle, rpc);
        }

        if (i < len - 1) {
          string += ",";
        }
      }
    }

    if (topLevel) {
      seen = null;
    }

    return string;
  },
  DOMException: function* (handle, rpc) {
    const preview = require("./preview");

    let {result} = yield rpc.request("Runtime.getProperties", {
      objectId: handle.objectId
    });

    const message = preview.getProperty(result, "message").value || "<no message>";
    const resultProp = (+preview.getProperty(result, "result").value).toString(16);
    const code = preview.getProperty(result, "code").value;
    const name = preview.getProperty(result, "name").value || "<unknown>";

    return '[Exception... "' + message + '" ' +
           'code: "' + code +'" ' +
           'nsresult: "0x' + resultProp + ' (' + name + ')"]';
  },
  Promise: function* (handle, rpc) {
    const preview = require("./preview");

    let {internalProperties} = yield rpc.request("Runtime.getProperties", {
      objectId: handle.objectId
    });

    let state, value;
    for (let prop of internalProperties) {
      if (prop.name == "[[PromiseStatus]]") {
        state = prop.value.value;
      } else if (prop.name == "[[PromiseValue]]") {
        value = prop.value;
      } else {
        console.warn("Unexpected promise internal property: " + prop.name);
      }
    }

    let statePreview = state;
    if (state != "pending") {
      statePreview += ": " + (value.type == "object" && value.value !== null
                              ? yield stringify(value, rpc)
                              : value.value);
    }
    return "Promise (" + statePreview + ")";
  },
};
