let { method } = require("devtools/server/protocol");
let task = require("util/task");

exports.asyncMethod = function(...args) {
  return method(task.async(args[0]), ...args.slice(1));
}
