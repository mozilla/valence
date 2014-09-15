var { Class } = require("sdk/core/heritage");
var { EventTarget } = require("sdk/event/target");
var { emit } = require("sdk/event/core");
var task = require("../util/task");


function normalize(url) {
  // XXX: Yeucch.
  if (url.indexOf("#") !== -1) {
    return url.slice(0, url.indexOf("#"));
  }
  return url;
}
exports.normalize = normalize;


var ResourceStore = Class({
  extends: EventTarget,
  initialize: function(rpc) {
    EventTarget.prototype.initialize.call(this);
    this.rpc = rpc;
  },

  init: task.async(function*() {
    if (this.initialized) {
      return;
    }
    this.initialized = true;

    this.onFrameNavigated = this.onFrameNavigated.bind(this);
    this.rpc.on("Page.frameNavigated", this.onFrameNavigated);

    // Before we go crazy getting notifications, let's make sure we know
    // our root frame ID.
    let resources = yield this.rpc.request("Page.getResourceTree");
    this.setFrameTree(resources.frameTree);

    this.currentURL = resources.frameTree.frame.url;

    yield this.rpc.request("Page.enable");
  }),

  destroy: function() {
    if (!this.initialized) {
      return;
    }
    this.initialized = false;

    this.rpc.off("Page.frameNavigated", this.onFrameNavigated);
  },

  setFrameTree: function(frameTree) {
    this.frameTree = frameTree;
    this.frames = new Set();
    this.frames.add(frameTree);
    for (let item of this.frames) {
      for (let child of item.childFrames || []) {
        this.frames.add(child);
      }
      item.frame.url = normalize(item.frame.url);
      for (let resource of item.resources || []) {
        resource.url = normalize(resource.url);
      }
    }
  },

  onFrameNavigated: task.async(function*(params) {
    // I'm not sure this is good enough.
    let resources = yield this.rpc.request("Page.getResourceTree");
    this.setFrameTree(resources.frameTree);
  }),

  urlContent: task.async(function*(url) {
    url = normalize(url);

    for (let frame of this.frames) {
      if (frame.frame.url === url) {
        return yield this.frameContent(frame.frame);
      }
      for (let resource of frame.resources || []) {
        if (resource.url === url) {
          return yield this.frameUrlContent(frame.frame, url);
        }
      }
    }

    return null;
  }),

  frameContent: task.async(function*(frame) {
    return yield this.rpc.request("Page.getResourceContent", {
      frameId: frame.id,
      url: frame.url
    });
  }),

  frameUrlContent: task.async(function*(frame, url) {
    return yield this.rpc.request("Page.getResourceContent", {
      frameId: frame.id,
      url: url
    });
  }),

  frameForUrl: function(url) {
    for (let frame of this.frames) {
      console.log(" checking for: " + frame.frame.url);
      if (frame.frame.url === url) {
        console.log("returning frame");
        return frame.frame;
      }
      for (let resource of frame.resources || []) {
        console.log("checking: " + resource.url);
        if (resource.url === url) {
          console.log("returning frame");
          return frame.frame;
        }
      }
    }
    return null;
  },
});

var storeMap = new Map();
exports.getResourceStore = function(rpc) {
  if (storeMap.has(rpc)) {
    return storeMap.get(rpc);
  }
  let store = new ResourceStore(rpc);
  storeMap.set(rpc, store);
  return store;
};
