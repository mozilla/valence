const { Class } = require("sdk/core/heritage");
const task = require("util/task");
const {EventTarget} = require("sdk/event/target");
const {emit} = require("sdk/event/core");

const win = require("sdk/addon/window");
const WebSocket = win.window.WebSocket;

var TabConnection = Class({
  extends: EventTarget,
  initialize: function(tabJSON) {
    console.log("Tab created: " + tabJSON.url);
    this.json = tabJSON;
    this.requestID = 1;
    this.outstandingRequests = new Map();
  },

  connect: function() {
    if (!this.connecting) {
      this.connecting = new Promise((resolve, reject) => {
        console.log("Connecting...");
        let socket = new WebSocket(this.json.webSocketDebuggerUrl, []);
        this.socket = socket;
        socket.onopen = () => {
          console.log("Connection established.");
          resolve();
        }
        socket.onmessage = this.onMessage.bind(this);
        console.log("Created web socket connection: " + socket.readyState);
      });
    }
    return this.connecting;
  },

  onMessage: function(evt) {
    console.log("GOT A PACKET: " + evt.data + "\n");
    packet = JSON.parse(evt.data);
    if ("id" in packet && this.outstandingRequests.has(packet.id)) {
      this.outstandingRequests.get(packet.id).resolve(packet.result);
      this.outstandingRequests.delete(packet.id);
    } else {
      emit(this, packet.method, packet.params);
    }
  },

  request: task.async(function*(method, params={}) {
    yield this.connect();
    return new Promise((resolve, reject) => {
      let request = {
        id: this.requestID++,
        method: method,
        params: params
      };
      console.log("SENDING: " + JSON.stringify(request));
      this.outstandingRequests.set(request.id, { resolve: resolve, reject: reject });
      this.socket.send(JSON.stringify(request));
    });
  })
});
exports.TabConnection = TabConnection;
