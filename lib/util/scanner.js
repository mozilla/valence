const { Cu } = require("chrome");
const EventEmitter =
  require("../devtools-require")("devtools/shared/event-emitter");
const task = require("./task");
const { Devices } =
  require("../devtools-import")("resource://devtools/shared/apps/Devices.jsm");
const Runtimes =
  require("../devtools-require")("devtools/client/webide/modules/runtimes");
const server = require("../chromium/server");

let Scanner = {

  _runtimes: [],

  enable: function() {
    this._updateRuntimes = this._updateRuntimes.bind(this);
    Devices.on("register", this._updateRuntimes);
    Devices.on("unregister", this._updateRuntimes);
    Devices.on("addon-status-updated", this._updateRuntimes);
    this._updateRuntimes();
  },

  disable: function() {
    Devices.off("register", this._updateRuntimes);
    Devices.off("unregister", this._updateRuntimes);
    Devices.off("addon-status-updated", this._updateRuntimes);
  },

  _emitUpdated: function() {
    this.emit("runtime-list-updated");
  },

  _updateRuntimes: function() {
    if (this._updatingPromise) {
      return this._updatingPromise;
    }
    this._runtimes = [];
    this._addStaticRuntimes();
    let promises = [];
    for (let id of Devices.available()) {
      let device = Devices.getByName(id);
      promises.push(this._detectAdbRuntimes(device));
    }
    this._updatingPromise = Promise.all(promises);
    this._updatingPromise.then(() => {
      this._emitUpdated();
      this._updatingPromise = null;
    }, () => {
      this._updatingPromise = null;
    });
    return this._updatingPromise;
  },

  _addStaticRuntimes: function() {
    this._runtimes.push(ChromeDesktopRuntime);
    this._runtimes.push(iOSRuntime);
  },

  _detectAdbRuntimes: task.async(function*(device) {
    let model;
    if (device.getModel) {
      model = yield device.getModel();
    }
    let detectedRuntimes = yield ChromeOnAndroidRuntime.detect(device, model);
    this._runtimes.push(...detectedRuntimes);
  }),

  scan: function() {
    return this._updateRuntimes();
  },

  listRuntimes: function() {
    return this._runtimes;
  }

};

EventEmitter.decorate(Scanner);

var ChromeDesktopRuntime = {
  type: Runtimes.RuntimeTypes.OTHER,
  connect: task.async(function*(connection) {
    let url = "http://localhost:9222";
    try {
      yield server.ping(url);
    } catch (e) {
      return Promise.reject(new Error("Chrome Desktop not found"));
    }
    let transport = server.connect(url);
    connection.connect(transport);
  }),
  get id() {
    return "chromedesktop";
  },
  get name() {
    return "Chrome Desktop";
  },
};

var iOSRuntime = {
  type: Runtimes.RuntimeTypes.OTHER,
  connect: task.async(function*(connection) {
    const { Connection } =
      require("../devtools-require")("devtools/shared/client/connection-manager");
    const iOSProxy = require("./ios-proxy");
    yield iOSProxy.start();
    console.log("Connecting to http://localhost:9230");
    let transport = server.connect("http://localhost:9230");
    connection.once(Connection.Events.DISCONNECTED, () => iOSProxy.stop());
    connection.connect(transport);
  }),
  get id() {
    return "ios";
  },
  get name() {
    return "Safari, Firefox, and other WebViews on iOS";
  },
};

function AdbRuntime(device, model, socketType, socketPath) {
  this.device = device;
  this._model = model;
  this._socketType = socketType;
  this._socketPath = socketPath;
}

AdbRuntime.prototype = {
  type: Runtimes.RuntimeTypes.USB,
  connect: function(connection) {
    const { ConnectionManager } =
      require("../devtools-require")("devtools/shared/client/connection-manager");
    let port = ConnectionManager.getFreeTCPPort();
    let local = "tcp:" + port;
    let remote = this._socketType + ":" + this._socketPath;
    return this.device.forwardPort(local, remote).then(() => {
      let transport = server.connect("http://localhost:" + port);
      connection.connect(transport);
    });
  },
  get id() {
    return this.device.id + "|" + this._socketPath;
  },
};

function ChromeOnAndroidRuntime(device, model) {
  AdbRuntime.call(this, device, model, "localabstract",
                  "chrome_devtools_remote");
}

ChromeOnAndroidRuntime.detect = task.async(function*(device, model) {
  let runtimes = [];
  let query = "cat /proc/net/unix";
  let reply = yield device.shell(query);
  // XXX: Sometimes we get an empty response back.  Likely a bug in our shell
  // code in ADB Helper.
  for (let attempts = 3; attempts > 0; attempts--) {
    reply = yield device.shell(query);
    if (reply.length == 3) {
      break;
    }
  }
  if (/chrome_devtools_remote/.test(reply)) {
    let runtime = new ChromeOnAndroidRuntime(device, model);
    console.log("Found " + runtime.name);
    runtimes.push(runtime);
  }
  return runtimes;
});

ChromeOnAndroidRuntime.prototype = Object.create(AdbRuntime.prototype);

Object.defineProperty(ChromeOnAndroidRuntime.prototype, "name", {
  get: function() {
    return "Chrome on Android (" + (this._model || this.device.id) + ")";
  }
});

exports.register = function() {
  // Only register our |Scanner| if the API exists
  if (Runtimes && Runtimes.RuntimeScanners) {
    // Add our scanner
    Runtimes.RuntimeScanners.add(Scanner);
    const { when: unload } = require("sdk/system/unload");
    unload(() => {
      Runtimes.RuntimeScanners.remove(Scanner);
    });
  }
};
