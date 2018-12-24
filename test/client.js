/**
 * A simple client object for a protocol.js connection.
 */

const protocol = require("../lib/devtools-require")("devtools/server/protocol");
const {emit} = protocol;
const {Class} = require("sdk/core/heritage");
const task = require("../lib/util/task");

var ProtocolClient = Class({
  extends: protocol.Pool,

  initialize(transport) {
    protocol.Pool.prototype.initialize.call(this, this);
    this._transport = transport;
    this._transport.hooks = this;
    this.pools = new Set();
  },

  ready() {
    if (!this.rootPromise) {
      this.rootPromise = new Promise((resolve, reject) => {
        this.rootPromiseResolve = resolve;
        this.rootPromiseReject = reject;
      });
      this._transport.ready();
    }
    return this.rootPromise;
  },

  /**
   * DebuggerTransport hooks
   */
  onPacket(packet) {
    if (!this.root) {
      this.root = new RootFront(this);
      this.root.actorID = "root";
      this.root.form(packet);
      this.root.manage(this.root);

      this.rootPromiseResolve(this.root);
      return;
    }

    let front = this.getActor(packet.from);
    if (!front) {
      console.error("Packet from unknown actor: " + JSON.stringify(packet));
      return;
    }
    try {
      front.onPacket(packet);
    } catch(ex) {
      console.exception(ex);
    }
  },

  onBulkPacket(packet) {
    throw new Error("Bulk packets not supported by this client type.");
  },

  onClosed(status) {
    emit(this, "closed");
  },

  /**
   * protocol.js connection methods.
   */
  addActorPool(pool) {
    this.pools.add(pool);
  },

  removeActorPool(pool) {
    this.pools.delete(pool);
  },

  getActor(actorID) {
    let pool = this.poolFor(actorID);
    return pool ? pool.get(actorID) : null;
  },

  poolFor(actorID) {
    for (let pool of this.pools) {
      if (pool.has(actorID)) return pool;
    }
    return null;
  },
});
exports.ProtocolClient = ProtocolClient;

/**
 * Fronts - for items that don't have fronts in the main browser, create
 * fronts using the protocol descriptions we provide for chromium.
 */

const {ChromiumRootActor, ChromiumTabActor} = require("../lib/chromium/root");

var RootFront = protocol.FrontClass(ChromiumRootActor, {
  form: function(v) {
    this.greeting = v;
  },

  getSelectedTab: task.async(function*() {
    let tabs = yield this.listTabs();
    return tabs.tabs[tabs.selected];
  })
});

var TabFront = protocol.FrontClass(ChromiumTabActor, {
  form: function(v) {
    this.formData = v;
  },

  getFormFront(actorID, factory) {
    if (this.has(actorID)) {
      return this.actor(actorID);
    }
    let front = factory();
    front.actorID = actorId;
    this.manage(front);
    return front;
  }

  getInspector() {
    return this.getFormFront(this.formData.inspectorActor, () => {
      const {InspectorFront} = require("../lib/devtools-require")("devtools/server/actors/inspector");
      let front = InspectorFront(this.formData);
      // InspectorFronts are (badly) self-managed right now, fix that up here.
      front.unmanage(front);
      return front;
    })
  },

  navigate(url) {
    return new Promise((resolve, reject) => {
      let checker = function(eventUrl, state) {
        if (state == "stop") {
          this.off("tab-navigated", checker);
          resolve(true);
        }
      }
      this.on("tab-navigated", checker);
      this.navigateTo(url);
    });
  }
});

const {ChromiumThreadActor} = require("../lib/chromium/thread");
protocol.FrontClass(ChromiumThreadActor, {});

