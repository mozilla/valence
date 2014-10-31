/**
 * Object previewers.
 */

const task = require("../util/task");
const value = require("./value");

const OBJECT_PREVIEW_MAX_ITEMS = 10;

/**
 * Preview data loaders are async functions responsible for gathering data about
 * a specific object (known by its handle) and storing this data on the handle.
 * 'typeXxxx' functions are for anything that's not an object, for object types,
 * 'objectSubTypeXxxx' functions are used.
 */
let PreviewDataLoaders = {
  typeFunction: function*(handle, rpc, recurse) {
    // May fail for native functions
    try {
      let response = yield rpc.request("Debugger.getFunctionDetails", {
        functionId: handle.objectId
      });
      // XXX For some reason we need to make sure className if "Function" here
      handle.className = "Function";
      handle.preview = response.details;
    } catch (e) {}
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
    let locationObjectId = getProperty(result, "location").objectId;
    response = yield rpc.request("Runtime.getProperties", {
      objectId: locationObjectId
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
      yield this.default(handle, rpc, recurse);
    }
  },

  classNameStyleSheetList: function*(handle, rpc, recurse) {
    yield this.objectSubTypeArray(handle, rpc, recurse);
  },

  classNameCSSRuleList: function*(handle, rpc, recurse) {
    yield this.objectSubTypeArray(handle, rpc, recurse);
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
    // Transform the map into a {key:value} object
    let getKeysAndValuesFn = "function() {" +
                             "  var values = {};" +
                             "  for (var keyValue of this) {" +
                             "    values[keyValue[0]] = keyValue[1];" +
                             "  }" +
                             "  return values;" +
                             "}";
    let properties = yield callFunctionOn(rpc, handle.objectId, getKeysAndValuesFn);

    // And treat i like an object structure
    handle.preview = {
      kind: "Object",
      ownProperties: {}
    }

    for (let i = 0; i < properties.length && i < OBJECT_PREVIEW_MAX_ITEMS; i ++) {
      let propHandle = properties[i].value;
      if (!propHandle) {
        continue;
      }
      yield loadPreview(rpc, propHandle, false);
      handle.preview.ownProperties[properties[i].name] = propHandle;
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

  classNameSyntaxError: function*(handle, rpc, recurse) {
    yield this.classNameError(handle, rpc, recurse);
  },
  classNameEvalError: function*(handle, rpc, recurse) {
    yield this.classNameError(handle, rpc, recurse);
  },
  classNameRangeError: function*(handle, rpc, recurse) {
    yield this.classNameError(handle, rpc, recurse);
  },
  classNameReferenceError: function*(handle, rpc, recurse) {
    yield this.classNameError(handle, rpc, recurse);
  },
  classNameTypeError: function*(handle, rpc, recurse) {
    yield this.classNameError(handle, rpc, recurse);
  },
  classNameURIError: function*(handle, rpc, recurse) {
    yield this.classNameError(handle, rpc, recurse);
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

/**
 * For a given handle, does any extra RPC needed to generate a complete preview
 * for that object.
 */
let loadPreview = exports.loadPreview = task.async(function*(rpc, handle, recurse=true) {
  let {type, subType, className} = getTypes(handle);

  // Check if there is a corresponding type or subType previewer. If there is,
  // call it, let it store what extra information it needs on the handle.
  if (PreviewDataLoaders["type" + type]) {
    yield PreviewDataLoaders["type" + type](handle, rpc, recurse);
  } else if (handle.type === "object" && PreviewDataLoaders["objectSubType" + subType]) {
    yield PreviewDataLoaders["objectSubType" + subType](handle, rpc, recurse);
  } else if (PreviewDataLoaders["className" + className]) {
    yield PreviewDataLoaders["className" + className](handle, rpc, recurse);
  } else if (handle.type === "object") {
    yield PreviewDataLoaders.default(handle, rpc, recurse);
  }
});

/**
 * Preview data generators are functions that receive a handle that previously
 * went thtough a PreviewDataLoaders and should generator the right preview
 * data on the form object that will be sent to the console client.
 */
let PreviewDataGenerators = {
  typeFunction(handle, form, ctx) {
    form.name = handle.preview.name || handle.preview.functionName;
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

  classNameStyleSheetList(handle, form, ctx) {
    this.objectSubTypeArray(handle, form, ctx);
  },

  classNameCSSRuleList(handle, form, ctx) {
    this.objectSubTypeArray(handle, form, ctx);
  },

  classNameSet(handle, form, ctx) {
    this.objectSubTypeArray(handle, form, ctx);
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

/**
 * Generates the actual preview for the object.
 */
exports.generatePreview = function(handle, form, ctx) {
  let {type, subType, className} = getTypes(handle);

  // Check if preview data has been loaded before and if there is a
  // corresponding type or subType generator.
  if (handle.preview) {
    if (PreviewDataGenerators["type" + type]) {
      PreviewDataGenerators["type" + type](handle, form, ctx);
    } else if (handle.type === "object" && PreviewDataGenerators["objectSubType" + subType]) {
      PreviewDataGenerators["objectSubType" + subType](handle, form, ctx);
    } else if (PreviewDataGenerators["className" + className]) {
      PreviewDataGenerators["className" + className](handle, form, ctx);
    } else if (handle.type === "object") {
      PreviewDataGenerators.default(handle, form, ctx);
    }
  }
}

/**
 * Given a list of properties (as returned by Runtime.getProperties), get a
 * property by its name.
 * @param {String} propertyName.
 * @return {Object} The property object if found, undefined otherwise.
 */
function getProperty(properties, propertyName) {
  for (let {name, value} of properties) {
    if (propertyName === name) {
      return value;
    }
  }
}

/**
 * Get the various types information from a given runtime object handle. Types
 * will be capitalized so they can be used to find matching functions in
 * PreviewDataLoaders and PreviewDataGenerators.
 * @param {Object} handle The runtime objet.
 * @return {Objec} A {type, subType, className} object.
 */
function getTypes(handle) {
  let capitalize = s => s ? s.substring(0,1).toUpperCase() + s.substring(1) : s;

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
