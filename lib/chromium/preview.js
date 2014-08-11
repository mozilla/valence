/**
 * Object previewers.
 */

const task = require("../util/task");
const value = require("./value");

const OBJECT_PREVIEW_MAX_ITEMS = 10;

/**
 * For a given handle, does any extra RPC needed to generate
 * a complete preview for that object.
 */
exports.loadPreview = task.async(function*(rpc, handle) {
  if (handle.type === "function") {
    let response = yield rpc.request("Debugger.getFunctionDetails", {
      functionId: handle.objectId
    });
    handle.functionDetails = response.details;
    return;
  }

  if (handle.type !== "object") {
    return;
  }

  let response = yield rpc.request("Runtime.getProperties", {
    objectId: handle.objectId,
    ownProperties: true
  });
  
  handle.previewData = {
    ownProperties: response.result
  };
});

/**
 * Generate the actual preview for the object
 */
exports.generatePreview = function(handle, form, ctx) {
  if (handle.type === "function" && handle.functionDetails) {
    form.name = handle.functionDetails.name;
  }
  if (handle.type !== "object") {
    return undefined;
  }

  if (!handle.previewData) {
    return undefined;
  }

  let previewData = {
    kind: "Object",
    ownProperties: {}
  };

  let previewOwn = handle.previewData.ownProperties;
  for (var i = 0; i < previewOwn.length && i < OBJECT_PREVIEW_MAX_ITEMS; i++) {
    let originalProp = previewOwn[i];
    let prop = value.convertProperty(originalProp);
    prop.value = value.gripType.write(prop.value, ctx);
    previewData.ownProperties[originalProp.name] = prop;
  }

  form.previewData = previewData;
}
