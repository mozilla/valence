var { Class } = require("sdk/core/heritage");
var { EventTarget } = require("sdk/event/target");
var { emit } = require("sdk/event/core");
var task = require("../util/task");

var CSSStore = Class({
  extends: EventTarget,

  initialize(rpc) {
    EventTarget.prototype.initialize.call(this);
    this.rpc = rpc;
    this.sheets = {};

    this.navigatingPromise = Promise.resolve();

    this.rpc.on("CSS.styleSheetAdded", this.onStyleSheetAdded.bind(this));
    this.rpc.on("CSS.styleSheetRemoved", this.onStyleSheetRemoved.bind(this));
    this.rpc.on("Page.frameNavigated", this.onNavigated.bind(this));
  },

  init: task.async(function*() {
    if (this.initialized) {
      return;
    }
    this.initialized = true;

    yield this.rpc.request("CSS.enable");
  }),

  destroy: task.async(function*() {
    if (!this.initialized) {
      return;
    }

    this.initialized = false;

    yield this.rpc.request("CSS.disable");
  }),

  onNavigated(event) {
    if (event.parentId) {
      return;
    }

    // Create a promise that resolves only when the content is fully loaded so
    // that the response to getStyleSheets can be delayed until we're sure to
    // have all stylesheets.
    this.navigatingPromise = new Promise((resolve, reject) => {
      this.rpc.once("Page.domContentEventFired", resolve);
    });
  },

  getStyleSheets: task.async(function*() {
    yield this.navigatingPromise;

    // Earlier protocol versions do not support styleSheetAdded events so we
    // need to call getAllStyleSheets.
    try {
      let response = yield this.rpc.request("CSS.getAllStyleSheets", {});
      if (response && response.headers.length) {
        this.sheets = {};
        for (let header of response.headers) {
          this.onStyleSheetAdded({header});
        }
      }
    } catch(e) {}

    return [for (key of Object.keys(this.sheets)) this.sheets[key]];
  }),

  get(styleSheetId) {
    return this.sheets[styleSheetId];
  },

  onStyleSheetAdded(params) {
    this.sheets[params.header.styleSheetId] = params.header;
    emit(this, "style-sheet-added", params.header);
  },

  onStyleSheetRemoved(params) {
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
