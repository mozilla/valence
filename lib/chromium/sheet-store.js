var { Class } = require("sdk/core/heritage");
var { EventTarget } = require("sdk/event/target");
var { emit } = require("sdk/event/core");
var task = require("util/task");

var CSSStore = Class({
  extends: EventTarget,
  initialize: function(rpc) {
    EventTarget.prototype.initialize.call(this);
    this.rpc = rpc;
    this.rpc.on("CSS.styleSheetAdded", this.onStyleSheetAdded.bind(this));
    this.rpc.on("CSS.styleSheetRemoved", this.onStyleSheetRemoved.bind(this));
    this.sheets = {};
  },

  init: task.async(function*() {
    if (this.initialized) {
      return;
    }
    this.initialized = true;

    yield this.rpc.request("CSS.enable");

    if (Object.keys(this.sheets).length < 1) {
      // We don't appear to have received any onStyleSheetAdded messages.
      // Maybe this is an earlier protocol version and we need getAllStyleSheets.
      try {
        let response = yield this.rpc.request("CSS.getAllStyleSheets", {});
        if (response) {
          for (let header of response.headers) {
            this.onStyleSheetAdded({header: header});
          }
        }
      } catch(e) {
        console.error(e);
      }
    }

  }),

  destroy: task.async(function*() {
    if (!this.initialized) {
      return;
    }

    this.initialized = false;
    yield this.rpc.request("CSS.disable");
  }),

  getStyleSheets: function() {
    return [for (key of Object.keys(this.sheets)) this.sheets[key]];
  },

  get: function(styleSheetId) {
    return this.sheets[styleSheetId];
  },

  onStyleSheetAdded: function(params) {
    this.sheets[params.header.styleSheetId] = params.header;
    emit(this, "style-sheet-added", params.header);
  },
  onStyleSheetRemoved: function(params) {
    delete this.sheets[params.styleSheetId];
    emit(this, "style-sheet-removed", params.styleSheetId);
  }
})

var storeMap = new Map();
exports.getCSSStore = function(rpc) {
  if (storeMap.has(rpc)) {
    return storeMap.get(rpc);
  }
  let store = new CSSStore(rpc);
  storeMap.set(rpc, store);
  return store;
}
