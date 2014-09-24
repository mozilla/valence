let { method, types } = require("../devtools-require")("devtools/server/protocol");
let task = require("./task");

exports.asyncMethod = function(...args) {
  return method(task.async(args[0]), ...args.slice(1));
}

// Add a todo method that will throw an error when unimplemented.
exports.todoMethod = function(spec) {
  return method(function() {
    throw new Error("This method is not yet implemented.")
  }, spec);
}

// Add a todo method that will just silently not do anything.
exports.todoMethodSilent = function(spec) {
  return method(function() {
  }, spec);
}


exports.addUniformDictType = function(name, subtype) {
  subtype = types.getType(subtype);
  return types.addType(name, {
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
  })
}
