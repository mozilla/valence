/**
 * Value grips.
 */

const protocol = require("devtools/server/protocol");
const {Actor, ActorClass, method, Arg, Option, RetVal} = protocol;
const {asyncMethod, addUniformDictType} = require("util/protocol-extra");

// Value grips are marshalled special.  Marshalls a grip from a chromium
// object handle into an object actor.
protocol.types.addType("chromium_grip", {
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
      return handle.form(detail);
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
        return grip.form(detail);
    }
    throw new Error("Unknown handle type: " + handle.type)
  }
});

protocol.types.addDictType("chromium_property", {
  "value": "chromium_grip",
  "get": "nullable:chromium_grip",
  "set": "nullable:chromium_grip"
});

addUniformDictType("chromium_propertylist", "chromium_property");

var ObjectGrip = ActorClass({
  typeName: "chromium_objectgrip",

  initialize: function(conn, rpc, handle) {
    Actor.prototype.initialize.call(this, conn);
    this.rpc = rpc;
    this.handle = handle;
  },

  form: function(detail) {
    let f = {
      actor: this.actorID,
      type: "object",
      class: this.handle.className,
      extensible: true, // ?
      frozen: false,  // ?
      sealed: false, // ?
    };
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

  convertProperty: function(chrProp) {
    return {
      enumerable: chrProp.enumerable,
      configurable: chrProp.configurable,
      writable: chrProp.writable, // different spelling, tricky.

      // These are all relying on the marshaller to convert.
      get: chrProp.get,
      set: chrProp.set,
      value: chrProp.value
    }
  },

  prototypeAndProperties: asyncMethod(function*() {
    let response = yield this.rpc.request("Runtime.getProperties", {
      objectId: this.handle.objectId,
      ownProperties: true
    });

    let ret = {
      prototype: { type: "object", subtype: "null"},
      ownProperties: {}
    }

    for (let prop of response.result) {
      if (prop.name === "__proto__") {
        ret.prototype = prop.value;
        continue;
      }
      ret.ownProperties[prop.name] = this.convertProperty(prop);
    }

    console.log("returning: " + JSON.stringify(ret, null, 2));

    return ret;
  }, {
    request: {},
    response: RetVal(protocol.types.addDictType("chromium_prototypeAndPropertiesResponse", {
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

  displayString: method(function() {

  }, {
    request: {},
    response: {}
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

  release: method(function() {

  }, {
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

/**
 * Return promise of a local grip for the handle.  For non-objects
 * this will be a native javascript value.  For objects it will be an
 * ObjectGrip actor.
 */
function grip(handle, ctx) {
  return new Promise((resolve, reject) => {
    if (!handle.objectId) {
      // Not an object, let it through.
      return handle;
    }

    let grip = objectGrip(handle, ctx);
    // XXX: fill in enough details.
    return grip;
  });
}
exports.grip = grip;

