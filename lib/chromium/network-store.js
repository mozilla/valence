var { Class } = require("sdk/core/heritage");
var { EventTarget } = require("sdk/event/target");
var { emit } = require("sdk/event/core");
var task = require("../util/task");


var NetworkStore = Class({
  extends: EventTarget,
  initialize: function(rpc) {
    EventTarget.prototype.initialize.call(this);
    this.rpc = rpc;
    this.requests = new Map(this.requests);
  },

  init: task.async(function*() {
    if (this.initialized) {
      return;
    }
    this.initialized = true;

    this.onResponseReceived = this.onResponseReceived.bind(this);
    this.rpc.on("Network.responseReceived", this.onResponseReceived);

    yield this.rpc.request("Network.enable");
  }),

  destroy: task.async(function*() {
    if (!this.initialized) {
      return;
    }
    this.initialized = false;

    yield this.rpc.request("Network.disable");
  }),

  onResponseReceived: function(params) {
    
  },
})

var storeMap = new Map();
exports.getNetworkStore = function(rpc) {
  if (storeMap.has(rpc)) {
    return storeMap.get(rpc);
  }
  let store = new NetworkStore(rpc);
  storeMap.set(rpc, store);
  return store;
}
