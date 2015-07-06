const task = require("../util/task");

const protocol = require("../devtools-require")("devtools/server/protocol");
const {asyncMethod, types} = require("../util/protocol-extra");
const {Actor, Pool, method, Arg, Option, RetVal, emit} = protocol;
const {setTimeout, clearTimeout} = require("sdk/timers");

/**
 * The reflow actor groups a few of the CSS and Page domain events from the
 * chrome remote debugging protocol into a "reflows" event that is sent to the
 * front-end so that consumers can refresh.
 * One such consumer is the layout-view sidebar panel in the inspector.
 */

const EVENT_BATCHING_DELAY = 300; // ms
const LAYOUT_INVALIDATION_EVENTS = [
  // XXX: some of these events aren't available on IOS, but since DOM.getBoxModel
  // isn't available either (see styles.js) the layout-view panel won't work
  // anyway.
  "CSS.mediaQueryResultChanged",
  "CSS.styleSheetAdded",
  "CSS.styleSheetChanged",
  "CSS.styleSheetRemoved",
  "DOM.inlineStyleInvalidated",
  "Page.frameResized"
];

var ChromiumReflowActor = protocol.ActorClass({
  typeName: "chromium_reflow",

  events: {
    /**
     * The reflows event is emitted when reflows have been detected. The event
     * is sent with an array of reflows that occured since the last event, as
     * events are sent at most every EVENT_BATCHING_DELAY ms.
     */
    "reflows" : {
      type: "reflows",
      reflows: Arg(0, "array:json")
    }
  },

  initialize(tab) {
    Actor.prototype.initialize.call(this, tab.conn);
    this.tab = tab;
    this.rpc = tab.rpc;

    this.onReflow = this.onReflow.bind(this);

    this._isStarted = false;
  },

  start: method(function() {
    if (!this._isStarted) {
      this._isStarted = true;
      this._reflows = [];

      for (let event of LAYOUT_INVALIDATION_EVENTS) {
        this.rpc.on(event, this.onReflow);
      }
    }
  }, {oneway: true}),

  stop: method(function() {
    if (this._isStarted) {
      clearTimeout(this.eventBatchingTimeout);
      this.eventBatchingTimeout = null;

      for (let event of LAYOUT_INVALIDATION_EVENTS) {
        this.rpc.off(event, this.onReflow);
      }

      this._reflows = [];
      this._isStarted = false;
    }
  }, {oneway: true}),

  onReflow(event) {
    // Note that for now, we just consider any of the observed event to cause a
    // reflow.

    // XXX On Firefox, we actually can listen to reflows and get a start/end
    // time and know if it was interruptible or not. On Chrome, we can't do that
    // and instead we listen to a few different events, so the reflow objects
    // sent are empty, but since only the layout-view uses the events and
    // doesn't require start/end/isInterruptible, this isn't going to be an
    // issue.
    this._reflows.push({});

    if (!this.eventBatchingTimeout) {
      this.eventBatchingTimeout = setTimeout(this._sendBatchedEvents.bind(this),
                                             EVENT_BATCHING_DELAY);
    }
  },

  _sendBatchedEvents() {
    if (this._reflows.length) {
      emit(this, "reflows", this._reflows);
      this._reflows = [];
      this.eventBatchingTimeout = null;
    }
  }
});

exports.ChromiumReflowActor = ChromiumReflowActor;
