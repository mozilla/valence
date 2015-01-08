/**
 * Previewing objects works in 2 phases:
 * - phase 1 is async: |loadPreview| retrieves any property that will later be
 *   needed to construct the preview to an object.
 * - phase 2 is sync: |generatePreview| formats the outgoing form object so that
 *   clients can display the object.
 */

const task = require("../util/task");
const value = require("./value");

// How many items maximum are previewed in collections (arrays, objects, maps, ...)
const OBJECT_PREVIEW_MAX_ITEMS = 10;

/**
 * Uses the right PreviewDataLoaders function to retrieve properties that will
 * be needed to generate a preview.
 */
let loadPreview = exports.loadPreview = task.async(function*(rpc, handle, recurse=true) {
  let fn = getHandleTypeMatchingFunctionIn(PreviewDataLoaders, handle);
  if (fn) {
    yield fn(handle, rpc, recurse);
  }
});

/**
 * Uses the right PreviewDataGenerators to generate the actual preview for the
 * object based on the properties retrieved at load time.
 */
exports.generatePreview = function(handle, form, ctx) {
  if (handle.preview) {
    let fn = getHandleTypeMatchingFunctionIn(PreviewDataGenerators, handle);
    if (fn) {
      fn(handle, form, ctx);
    }
  }
}

/**
 * Preview data loaders are async functions responsible for gathering data about
 * a specific object (known by its handle) and storing this data on the handle's
 * preview property.
 * |loadPreview| calls these functions depending on the types of the handle.
 * A handle has 3 types: type, subType and className. Here's how the functions
 * are matched:
 * - If a |typeAbc| function exists for type abc, it is called,.
 * - If type is object and a |objectSubTypeAbc| exists for subType abc, it is
 *   called.
 * - Else, if a |classNameAbc| function exists for className abc, it is called.
 */
let PreviewDataLoaders = {
  typeFunction: function*(handle, rpc, recurse) {
    // XXX Need to make sure className is "Function" here.
    handle.className = "Function";

    let {result} = yield rpc.request("Runtime.getProperties", {
      objectId: handle.objectId
    });
    let name = getProperty(result, "name").value;

    let {details} = yield rpc.request("Debugger.getFunctionDetails", {
      functionId: handle.objectId
    });
    if (!details) {
      handle.preview = {name};
      return;
    }

    let functionName = details.functionName;
    let inferredName = details.inferredName;
    let displayName = details.displayName;

    handle.preview = {name, functionName, inferredName, displayName};
  },

  objectSubTypeArray: function*(handle, rpc, recurse) {
    let response = yield rpc.request("Runtime.getProperties", {
      objectId: handle.objectId
    });
    let properties = response.result;
    let length = getProperty(properties, "length").value;

    handle.preview = {
      kind: "ArrayLike",
      length: length
    };

    if (recurse) {
      handle.preview.items = [];
      for (let i = 0; i < length && i < OBJECT_PREVIEW_MAX_ITEMS; i ++) {
        let itemHandle = getProperty(properties, i + "");
        yield loadPreview(rpc, itemHandle, false);
        handle.preview.items.push(itemHandle);
      }
    }
  },

  objectSubTypeNode: function*(handle, rpc, recurse) {
    // XXX Missing preview for nsIDOMDocumentFragment

    let response = yield rpc.request("Runtime.getProperties", {
      objectId: handle.objectId
    });
    let properties = response.result;

    handle.preview = {
      kind: "DOMNode",
      nodeName: getProperty(properties, "nodeName").value.toLowerCase(),
      nodeType: getProperty(properties, "nodeType").value
    }

    if (handle.preview.nodeType === 1) {
      // Element
      handle.preview.attributes = {};

      let attributesObjectId = getProperty(properties, "attributes").objectId;
      response = yield rpc.request("Runtime.getProperties", {
        objectId: attributesObjectId
      });
      let attributes = response.result;

      handle.preview.attributeLength = getProperty(attributes, "length").value;
      for (let i = 0;
           i < handle.preview.attributeLength && i < OBJECT_PREVIEW_MAX_ITEMS;
           i ++) {
        let attributeObjectId = getProperty(attributes, i + "").objectId;
        response = yield rpc.request("Runtime.getProperties", {
          objectId: attributeObjectId
        });
        let attribute = response.result;

        handle.preview.attributes[getProperty(attribute, "name").value] =
          getProperty(attribute, "value").value;
      }
    } else if (handle.preview.nodeType === 2) {
      // Attribute
      handle.preview.value = getProperty(properties, "value").value;
    } else if (handle.preview.nodeType === 3 || handle.preview.nodeType === 8) {
      // Text and comment nodes
      handle.preview.textContent = getProperty(properties, "textContent").value;
    } else if (handle.preview.nodeType === 9) {
      // Document
      let locationObjectId = getProperty(properties, "location").objectId;
      response = yield rpc.request("Runtime.getProperties", {
        objectId: locationObjectId
      });
      handle.preview.location = getProperty(response.result, "href").value;
    }
  },

  classNameWindow: function*(handle, rpc, recurse) {
    handle.preview = {
      kind: "ObjectWithURL"
    };

    let {result} = yield rpc.request("Runtime.getProperties", {
      objectId: handle.objectId
    });

    let location = getProperty(result, "location");
    if (!location) {
      handle.preview.url = "<location missing>";
      return;
    }

    response = yield rpc.request("Runtime.getProperties", {
      objectId: location.objectId
    });

    handle.preview.url = getProperty(response.result, "href").value;
  },

  classNameCSSStyleSheet: function*(handle, rpc, recurse) {
    let {result} = yield rpc.request("Runtime.getProperties", {
      objectId: handle.objectId
    });

    let href = getProperty(result, "href");
    if (href && href.value) {
      handle.preview = {
        kind: "ObjectWithURL",
        url: href.value
      };
    } else {
      yield PreviewDataLoaders.default(handle, rpc, recurse);
    }
  },

  classNameSet: function*(handle, rpc, recurse) {
    // Transform the set into a [value] array
    let getValuesFn = "function() {" +
                      "  var values = [];" +
                      "  for (var value of this) {" +
                      "    values.push(value);" +
                      "  }" +
                      "  return values;" +
                      "}";
    let properties = yield callFunctionOn(rpc, handle.objectId, getValuesFn);
    let length = getProperty(properties, "length").value;

    // And treat it like an ArrayLike structure
    handle.preview = {
      kind: "ArrayLike",
      length: length
    };

    if (recurse) {
      handle.preview.items = [];
      for (let i = 0; i < length && i < OBJECT_PREVIEW_MAX_ITEMS; i ++) {
        let itemHandle = getProperty(properties, i + "");
        yield loadPreview(rpc, itemHandle, false);
        handle.preview.items.push(itemHandle);
      }
    }
  },

  classNameMap: function*(handle, rpc, recurse) {
    // Transform the map into a [key1,value1,key2,value2,...,keyN,valueN] array
    // so that each key and value can be accessed directly with no extra RPC
    // call.
    let getKeysAndValuesFn = "function() {" +
                             "  var values = [];" +
                             "  for (var keyValue of this) {" +
                             "    values.push(keyValue[0]);" +
                             "    values.push(keyValue[1]);" +
                             "  }" +
                             "  return values;" +
                             "}";
    let properties = yield callFunctionOn(rpc, handle.objectId, getKeysAndValuesFn);

    let length = getProperty(properties, "length").value / 2;
    handle.preview = {
      kind: "MapLike",
      size: length,
      entries: []
    }

    for (let i = 0; i < length && i < OBJECT_PREVIEW_MAX_ITEMS; i ++) {
      let keyHandle = properties[i * 2].value;
      yield loadPreview(rpc, keyHandle, false);

      let valueHandle = properties[1 + i * 2].value;
      yield loadPreview(rpc, valueHandle, false);

      handle.preview.entries.push([keyHandle, valueHandle]);
    }
  },

  classNameError: function*(handle, rpc, recurse) {
    let getErrorDetailsFn = "function() {" +
                            "  return {" +
                            "    stack: this.stack," +
                            "    name: this.name," +
                            "    message: this.message," +
                            "    fileName: this.fileName," +
                            "    lineNumber: this.lineNumber," +
                            "    columnNumber: this.columnNumber" +
                            "  };" +
                            "}";
    let properties = yield callFunctionOn(rpc, handle.objectId, getErrorDetailsFn);
    handle.preview = {
      kind: "Error",
      stack: getProperty(properties, "stack").value,
      name: getProperty(properties, "name").value,
      message: getProperty(properties, "message").value,
      fileName: getProperty(properties, "fileName").value,
      lineNumber: getProperty(properties, "lineNumber").value,
      columnNumber: getProperty(properties, "columnNumber").value
    };
  },

  default: function*(handle, rpc, recurse) {
    if (handle.subtype === "null" || !recurse) {
      return;
    }

    let {result} = yield rpc.request("Runtime.getProperties", {
      objectId: handle.objectId,
      ownProperties: true
    });

    handle.preview = {
      kind: "Object",
      ownProperties: {}
    }

    for (let i = 0; i < result.length && i < OBJECT_PREVIEW_MAX_ITEMS; i ++) {
      let propHandle = result[i].value;
      // XXX properties with no values have accessors, for now skipping them.
      if (!propHandle) {
        continue;
      }
      yield loadPreview(rpc, propHandle, false);
      handle.preview.ownProperties[result[i].name] = propHandle;
    }
  }
};

PreviewDataLoaders.classNameStyleSheetList = PreviewDataLoaders.objectSubTypeArray;

PreviewDataLoaders.classNameCSSRuleList = PreviewDataLoaders.objectSubTypeArray;

PreviewDataLoaders.classNameSyntaxError = PreviewDataLoaders.classNameError;
PreviewDataLoaders.classNameEvalError = PreviewDataLoaders.classNameError;
PreviewDataLoaders.classNameRangeError = PreviewDataLoaders.classNameError;
PreviewDataLoaders.classNameReferenceError = PreviewDataLoaders.classNameError;
PreviewDataLoaders.classNameTypeError = PreviewDataLoaders.classNameError;
PreviewDataLoaders.classNameURIError = PreviewDataLoaders.classNameError;

/**
 * Preview data generators are functions that receive a handle that previously
 * went through a PreviewDataLoaders and should generate the right preview
 * data on the form object that will be sent to the console client.
 */
let PreviewDataGenerators = {
  typeFunction(handle, form, ctx) {
    form.name = handle.preview.displayName ||
                handle.preview.inferredName ||
                handle.preview.functionName ||
                handle.preview.name;
  },

  objectSubTypeArray(handle, form, ctx) {
    if (handle.preview.items) {
      handle.preview.items.forEach((item, index) => {
        if (item.objectId) {
          let grip = value.grip(item, ctx);
          handle.preview.items[index] = grip.form(null, ctx);
        } else {
          handle.preview.items[index] = item.value;
        }
      });
    }
    form.preview = handle.preview;
  },

  classNameMap(handle, form, ctx) {
    for (let entry of handle.preview.entries) {
      for (let i = 0; i < entry.length; i ++) {
        if (entry[i].objectId) {
          let grip = value.grip(entry[i], ctx);
          entry[i] = grip.form(null, ctx);
        } else {
          entry[i] = entry[i].value;
        }
      }
    }
    form.preview = handle.preview;
  },

  default(handle, form, ctx) {
    if (handle.preview.ownProperties) {
      let props = Object.keys(handle.preview.ownProperties);
      for (let name of props) {
        let property = handle.preview.ownProperties[name];
        if (property.objectId) {
          let grip = value.grip(property, ctx);
          handle.preview.ownProperties[name] = value.convertProperty({value: grip.form(null, ctx)});
        } else {
          handle.preview.ownProperties[name] = value.convertProperty(property);
        }
      }
    }
    form.preview = handle.preview;
  }
};

PreviewDataGenerators.classNameStyleSheetList = PreviewDataGenerators.objectSubTypeArray;
PreviewDataGenerators.classNameCSSRuleList = PreviewDataGenerators.objectSubTypeArray;
PreviewDataGenerators.classNameSet = PreviewDataGenerators.objectSubTypeArray;

/**
 * Given a list of properties (as returned by Runtime.getProperties), get a
 * property by its name.
 * @param {String} propertyName.
 * @return {Object} The property object if found, null otherwise.
 */
let getProperty = exports.getProperty = function (properties, propertyName) {
  for (let {name, value} of properties) {
    if (propertyName === name) {
      return value;
    }
  }
  return null;
}

let capitalize = s => s ? s.substring(0,1).toUpperCase() + s.substring(1) : s;

/**
 * Get the various types information from a given runtime object handle. Types
 * will be capitalized so they can be used to find matching functions in
 * PreviewDataLoaders and PreviewDataGenerators.
 * @param {Object} handle The runtime objet.
 * @return {Objec} A {type, subType, className} object.
 */
function getTypes(handle) {
  return {
    type: capitalize(handle.type),
    subType: capitalize(handle.subtype),
    className: capitalize(handle.className)
  };
}

/**
 * Generator function that executes code on a given runtime object.
 * @param {Object} rpc
 * @param {String} objectId The ID of the runtime object to execute the function
 * on.
 * @param {String} declaration The function declaration to be executed. 'this'
 * in the function body will be the object itself.
 * @param {Array} args Arguments to pass to the function
 * @return The list of properties of the object returned by the function.
 */
function* callFunctionOn(rpc, objectId, declaration, args=[]) {
  let response = yield rpc.request("Runtime.callFunctionOn", {
    objectId: objectId,
    functionDeclaration: declaration,
    arguments: args
  });

  if (response.wasThrown) {
    throw new Error(response.result.description);
  }

  response = yield rpc.request("Runtime.getProperties", {
    objectId: response.result.objectId,
    ownProperties: true
  });

  return response.result;
}

/**
 * Given an object containing functions and a handle, find out the types of the
 * handle and return the right function from the object.
 * @param {Object} functions All functions
 * @param {Object} handle
 * @return {Function} The right function to be called depending on the handle
 * type, or null if none match.
 */
function getHandleTypeMatchingFunctionIn(functions, handle) {
  let {type, subType, className} = getTypes(handle);
  if (functions["type" + type]) {
    return functions["type" + type];
  }
  if (handle.type === "object" && functions["objectSubType" + subType]) {
    return functions["objectSubType" + subType];
  }
  if (functions["className" + className]) {
    return functions["className" + className];
  }
  if (handle.type === "object") {
    return functions.default;
  }
  return null;
}
