let { method, types } = require("devtools/server/protocol");
let task = require("util/task");

exports.asyncMethod = function(...args) {
  return method(task.async(args[0]), ...args.slice(1));
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
        console.log("converting prop " + prop);
        ret[prop] = subtype.write(v[prop], ctx);
      }
      return ret;
    }
  })
}
