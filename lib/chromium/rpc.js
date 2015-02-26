const { Class } = require("sdk/core/heritage");
const task = require("../util/task");
const {EventTarget} = require("sdk/event/target");
const {emit} = require("sdk/event/core");
const {prefs} = require("sdk/simple-prefs");

const win = require("sdk/addon/window");
const WebSocket = win.window.WebSocket;

var TabConnection = Class({
  extends: EventTarget,
  initialize: function(tabJSON) {
    this.json = tabJSON;
    this.requestID = 1;
    this.outstandingRequests = new Map();
  },

  connect: function() {
    if (!this.connecting) {
      this.connecting = new Promise((resolve, reject) => {
        if (prefs["logDeviceProtocolTraffic"]) {
          console.log("<<<<<< Connecting to " + this.json.webSocketDebuggerUrl + "...");
        }
        // TODO: remove this workaround for issue #136 when bug 1137008 is fixed.
        const {Cu} = require("chrome");
        Cu.import("resource://gre/modules/Services.jsm");
        Services.prefs.setBoolPref("network.websocket.extensions.permessage-deflate", false);

        let socket = new WebSocket(this.json.webSocketDebuggerUrl, []);
        this.socket = socket;
        socket.onopen = () => {
          if (prefs["logDeviceProtocolTraffic"]) {
            console.log(">>>>>> Connection established");
          }
          resolve();
        }
        socket.onmessage = this.onMessage.bind(this);
        socket.onclose = e => {
          if (prefs["logDeviceProtocolTraffic"]) {
            console.log(">>>>>> Web socket closed: " + e.code + "/" + e.reason);
          }

          // TODO: remove this workaround for issue #136 when bug 1137008 is fixed.
          const {Cu} = require("chrome");
          Cu.import("resource://gre/modules/Services.jsm");
          Services.prefs.clearUserPref("network.websocket.extensions.permessage-deflate");
        }
        socket.oncerror = e => console.error("Error occurred in web socket: " + e);
      });
    }
    return this.connecting;
  },

  close: function() {
    this.socket.close();
  },

  prepareOutput: function(output) {
    if(prefs["logMessageThreshold"] > 0) {
      return output.slice(0, prefs["logMessageThreshold"]);
    }
    return output;
  },

  onMessage: function(evt) {
    if (prefs["logDeviceProtocolTraffic"]) {
      console.log(">>>>>> Received from device\n" +
                  this.prepareOutput(evt.data.toString()));
    }
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
      if (prefs["logDeviceProtocolTraffic"]) {
        console.log("<<<<<< Sent to device\n" +
                    this.prepareOutput(JSON.stringify(request)));
      }
      this.outstandingRequests.set(request.id, { resolve: resolve, reject: reject });
      this.socket.send(JSON.stringify(request));
    });
  })
});
exports.TabConnection = TabConnection;
