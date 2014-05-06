const { Class } = require("sdk/core/heritage");
const promise = require("sdk/core/promise");
const task = require("util/task");
const ws = require("util/ws");
const {EventTarget} = require("sdk/event/target");
const {emit} = require("sdk/event/core");

var TabConnection = Class({
  extends: EventTarget,
  initialize: function(tabJSON) {
    console.log("Tab created: " + tabJSON.url);
    this.json = tabJSON;
    this.requestID = 1;
    this.outstandingRequests = new Map();
  },

  connect: function() {
    console.log("Connecting...");
    let socket = new ws.WebSocket(this.json.webSocketDebuggerUrl, []);
    this.socket = socket;
    let deferred = promise.defer();
    socket.onopen = () => {
      console.log("Connection established.");
      deferred.resolve();
    }
    socket.onmessage = this.onMessage.bind(this);
    console.log("Created web socket connection: " + socket.readyState);
    return deferred.promise;
  },

  onMessage: function(evt) {
    dump("GOT A PACKET: " + evt.data + "\n");
    packet = JSON.parse(evt.data);
    if ("id" in packet && this.outstandingRequests.has(packet.id)) {
      this.outstandingRequests.get(packet.id).resolve(packet.result);
      this.outstandingRequests.delete(packet.id);
    } else {
      emit(this, evt.method, evt.params);
    }
  },

  request: task.async(function*(method, params={}) {
    yield this.connect();
    let deferred = promise.defer();
    let request = {
      id: this.requestID++,
      method: method,
      params: params
    };
    console.log("SENDING: " + JSON.stringify(request));
    this.outstandingRequests.set(request.id, deferred);
    this.socket.send(JSON.stringify(request));
    return deferred.promise;
  })
});
exports.TabConnection = TabConnection;
