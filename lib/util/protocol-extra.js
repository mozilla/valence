let { method, types, ActorClass } = require("../devtools-require")("devtools/server/protocol");
let task = require("./task");
let unload = require("sdk/system/unload");

exports.asyncMethod = function(...args) {
  return method(task.async(args[0]), ...args.slice(1));
}

// Add a todo method that will throw an error when unimplemented.
exports.todoMethod = function(spec, methodName) {
  return method(function() {
    let msg = methodName ? "Method " + methodName : "A method";
    msg += " on actor " + this.typeName + " is not yet implemented";
    throw new Error(msg);
  }, spec);
}

// Add a todo method that will just silently not do anything.
exports.todoMethodSilent = function(spec) {
  return method(function() {
  }, spec);
}

/**
 * Protocol.js registration functions that properly unregister themselves
 * on addon unload
 */

var myTypes = new Set();

exports.ActorClass = function(proto) {
  let type = ActorClass(proto);
  myTypes.add(proto.typeName);
  return type;
}

exports.types = {};

[
  "addType",
  "addArrayTpe",
  "addDictType",
  "addNullableType",
  "addActorType",
  "addActorDetail",
].forEach(registrator => {
  exports.types[registrator] = function(...args) {
    let type = types[registrator](...args);
    myTypes.add(type.name);
    return type;
  }
});

unload.when(() => {
  for (let name of myTypes) {
    types.removeType(name);
  }
});

exports.types.addLifetime = function(name, attribute) {
  types.addLifetime(name, attribute);
  unload.when(() => {
    types.removeLifetime(name);
  });
}

exports.types.addUniformDictType = function(name, subtype) {
  subtype = types.getType(subtype);
  let type = types.addType(name, {
    category: "uniformdict",
    subtype: subtype,
    read: (v, ctx) => {
     let ret = {};
      for (let prop in v) {
        ret[prop] = subtype.read(v[prop], ctx);
      }
      return ret;
    },
    write: (v, ctx) => {
      let ret = {};
      for (let prop in v) {
        ret[prop] = subtype.write(v[prop], ctx);
      }
      return ret;
    }
  });

  unload.when(() => {
    types.removeType(name);
  });

  return type;
}
