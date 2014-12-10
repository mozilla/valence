/**
 * Stringify a handle based on its class.
 */
exports.stringify = function* stringify(handle, rpc) {
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
