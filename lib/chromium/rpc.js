const { Class } = require("sdk/core/heritage");
const task = require("../util/task");
const {EventTarget} = require("sdk/event/target");
const {emit} = require("sdk/event/core");

const win = require("sdk/addon/window");
const WebSocket = win.window.WebSocket;

const debugTruncate = 320;

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
        console.log("Connecting to " + this.json.webSocketDebuggerUrl + "...");
        let socket = new WebSocket(this.json.webSocketDebuggerUrl, []);
        this.socket = socket;
        socket.onopen = () => {
          console.log("Connection established.");
          resolve();
        }
        socket.onmessage = this.onMessage.bind(this);
        socket.onclose = e => console.log("Web socket closed: " + e.code + "/" + e.reason);
        socket.oncerror = e => console.error("Error occurred in web socket: " + e);
        console.log("Created web socket connection: " + socket.readyState);
      });
    }
    return this.connecting;
  },

  close: function() {
    console.log("Closing web socket connection.");
    this.socket.close();
  },

  onMessage: function(evt) {
    console.log("GOT A PACKET: " + evt.data.substring(0, debugTruncate));
    let packet = JSON.parse(evt.data);
    if ("id" in packet && this.outstandingRequests.has(packet.id)) {
      let p = this.outstandingRequests.get(packet.id);
      this.outstandingRequests.delete(packet.id);
      if (packet.error) {
        p.reject(packet.error);
      } else {
        p.resolve(packet.result);
      }
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
      console.log("SENDING: " + JSON.stringify(request).substring(0, debugTruncate));
      this.outstandingRequests.set(request.id, { resolve: resolve, reject: reject });
      this.socket.send(JSON.stringify(request));
    });
  })
});
exports.TabConnection = TabConnection;
