const {Cu} = require("chrome");

const unload = require("sdk/system/unload");

const {DebuggerClient} = Cu.import("resource://gre/modules/devtools/dbg-client.jsm",  {});
const {Devices} = Cu.import("resource://gre/modules/devtools/Devices.jsm");
let {gDevTools} = Cu.import("resource:///modules/devtools/gDevTools.jsm", {});
let {devtools} = Cu.import("resource://gre/modules/devtools/Loader.jsm", {});
Cu.import("resource://gre/modules/Services.jsm");

const gcli = devtools.require("gcli/index");
const task = require("./util/task");
const server = require("./chromium/server");
const timers = require("sdk/timers");
const { notify } = require("sdk/notifications");

const {ConnectionManager} = devtools.require("devtools/client/connection-manager");
const {USBRuntime} = devtools.require("devtools/webide/runtimes");
const {AppManager} = devtools.require("devtools/webide/app-manager");

let winObserver = function(win, topic) {
  if (topic == "domwindowopened") {
    win.addEventListener("load", function onLoadWindow() {
      win.removeEventListener("load", onLoadWindow, false);
      if (win.document.documentURI == "chrome://webide/content/webide.xul") {
        win.setTimeout(() => onWebIDEWindowOpen(win), 0);
      }
    }, false);
  }
}
Services.ww.registerNotification(winObserver);

let webIDEWindow = Services.wm.getMostRecentWindow("devtools:webide");
if (webIDEWindow) {
  onWebIDEWindowOpen(webIDEWindow);
}

function onWebIDEWindowOpen(window) {

  let promise = window.promise;

  let runtimesToRestore = [...AppManager.runtimeList.custom];

  /** iOS device **/


  // To find iOS devices, we need to use ios_webkit_debug_proxy (works on linux and windows).
  // On port 9221, we can find a list of connected devices.
  // I believe we should build a static version of ios_webkit_debug_proxy
  // and integrate it in the ADB Addon Helper.
  //
  // At the moment, we just assume that a device is plugged and that ios_webkit_debug_proxy
  // is runnning.

  let iOSRuntime = {
    getName: function() {
      return "iOS proxy";
    },
    connect: function(connection) {
      let transport = server.connect("http://localhost:9222");
      connection.connect(transport);
      return promise.resolve();
    },
  }

  AppManager.runtimeList.custom.push(iOSRuntime);


  /** Chrome on Android **/


  let baseCustomRuntimes = AppManager.runtimeList.custom;


  function AndroidRuntime(id) {
    this._usbRuntime = new USBRuntime(id);
    this._usbRuntime.updateNameFromADB().then( () => AppManager.update("runtimelist"));
  }

  AndroidRuntime.prototype = {
    getName: function() {
      return "Google Chrome: " + this._usbRuntime.getName();
    },
    connect: function(connection) {
      let device = Devices.getByName(this._usbRuntime.id);
      let freeLocalPort = ConnectionManager.getFreeTCPPort();
      let local = "tcp:" + freeLocalPort;
      let remote = "localabstract:chrome_devtools_remote";

      return device.forwardPort(local, remote).then(() => {
        let transport = server.connect("http://localhost:" + freeLocalPort);
        connection.connect(transport);
      });
    },
  }

  function scan() {
    AppManager.runtimeList.custom = [...baseCustomRuntimes];
    AppManager.update("runtimelist");
    for (let id of Devices.available()) {
      let device = Devices.getByName(id);
      device.shell("grep -q chrome_devtools_remote /proc/net/unix && echo OK || echo KO").then(stdout => {
        if (stdout.match(/^OK/)) {
          AppManager.runtimeList.custom.push(new AndroidRuntime(id));
          AppManager.update("runtimelist");
        }
      });
    }
  }

  Devices.on("unregister", scan);
  Devices.on("register", scan);
  scan();
  unload.when(function () {
    AppManager.runtimeList.custom = runtimesToRestore;
    AppManager.update("runtimelist");
    Devices.off("unregister", scan);
    Devices.off("register", scan);
  });
}


var openToolbox = task.async(function*(client, form, hostOptions, options={}) {
  let tool = options.tool;
  let targetOptions = {
    client: client,
    form: form,
    chrome: options.chrome || false
  };

  let target = yield devtools.TargetFactory.forRemoteTab(targetOptions);
  if (options.loadURL && target.url != options.loadURL) {
    yield new Promise((resolve, reject) => {
      target.activeTab.navigateTo(options.loadURL, () => {
        target.once("navigate", resolve);
      });
    });
  }
  let hostType = devtools.Toolbox.HostType.WINDOW;
  let toolbox = yield gDevTools.showToolbox(target, tool, hostType, hostOptions);
  toolbox.once("destroyed", function() {
    client.close();
  });
});

const {prefs} = require("sdk/simple-prefs");
if (prefs["enableToolbarButton"]) {
  const ui = require("sdk/ui");
  let action_button = ui.ActionButton({
    id: "ui-button",
    label: "Debug whatever is on port 9222",
    icon: "./icon.png",
    onClick: task.async(function*(state) {
      let response;
      try {
        response = yield tryConnect("http://localhost:9222");
      } catch(ex) {
        notify({
          title: "No browser found.",
          text: "No browser found on port 9222"
        });
        return;
      }

      let client = response.client;
      let resp = response.response;

      let tab = resp.tabs[resp.selected];
      try {
        yield openToolbox(client, tab, {}, {
          tool: "inspector",
        });
      } catch (e) {
        notify({
          title: "Can't debug page",
          text: "A remote debugging connection is not allowed for page " + tab.url
        });
      }
    })
  });
}

function tryConnect(url) {
  let transport = server.connect(url);
  let client = new DebuggerClient(transport);
  return new Promise((resolve, reject) => {
    client.connect((type, traits) => {
      client.listTabs(response => {
        if (response.error) {
          client.close();
          reject(response);
        } else {
          resolve({client: client, response: response});
        }
      });
    });
  });
}


const child_process = require("sdk/system/child_process");

function wait(ms) {
  return new Promise((resolve, reject) => {
    timers.setTimeout(() => {
      resolve();
    }, ms);
  });
}

var connectDebugger = task.async(function*(url, spawn) {
  let response = null;

  try {
    response = yield tryConnect(url);
  } catch(ex) {
    spawn();
  }

  let tries = 25;
  let delay = 100;
  while (!response && tries) {
    yield wait(delay);
    try {
      response = yield tryConnect(url);
    } catch(ex) {}
    tries--;
  }

  return response;
});

var debugChrome = task.async(function*(browserWindow, contentWindow) {
  let response = yield connectDebugger("http://localhost:9225", () => {
    let windowPosition = "--window-position=" + browserWindow.screenX + "," + browserWindow.screenY;
    let windowSize = "--window-size=" + browserWindow.outerWidth + "," + (browserWindow.outerHeight - 200);

    child_process.spawn("/Applications/Google\ Chrome\ Canary.app/Contents/MacOS/Google\ Chrome\ Canary", ["--remote-debugging-port=9225", windowPosition, windowSize]);
  });

  if (!response) {
    // Complain.
    return;
  }

  let top = browserWindow.screenY + browserWindow.outerHeight - 200;
  let left = browserWindow.screenX;
  let height = 200;
  let width = browserWindow.outerWidth;

  let positionArgs = "top=" + top + ",left=" + left + ",outerHeight=" + height + ",outerWidth=" + width;

  let client = response.client;
  response = response.response;

  let tab = response.tabs[response.selected];

  yield openToolbox(client, response.tabs[response.selected], {
    positionArgs: positionArgs
  }, {
    tool: "inspector",
    loadURL: contentWindow.location.toString()
  });
});

var debugIOS = task.async(function*(browserWindow, contentWindow) {
  let response = yield connectDebugger("http://localhost:9230", () => {
    child_process.spawn("/usr/local/bin/ios_webkit_debug_proxy", ["-c", "null:9221,:9230-9240"]);
  });

  let client = response.client;
  response = response.response;

  let tab = response.tabs[response.selected];

  yield openToolbox(client, response.tabs[response.selected], {}, {
    tool: "inspector",
    loadURL: contentWindow.location.toString()
  });
});

var debugAndroid = task.async(function*(browserWindow, contentWindow) {
  let response = yield connectDebugger("http://localhost:9240", () => {
    child_process.spawn("/Users/dcamp/moz/android-sdk-macosx/platform-tools/adb", ["forward", "tcp:9240", "localabstract:chrome_devtools_remote"]);
  });

  let client = response.client;
  response = response.response;

  let tab = response.tabs[response.selected];

  yield openToolbox(client, response.tabs[response.selected], {}, {
    tool: "inspector",
    loadURL: contentWindow.location.toString()
  });
});

// TODO: These commands should eventually be using the new export.items format

var commands = [
  {
    name: 'chrome',
    description: 'Check remotely in Chrome Desktop',

    exec: function(args, context) {
      return debugChrome(context.environment.chromeWindow, context.environment.window);
    }
  },
  {
    name: 'ios',
    description: 'Check remotely on Safari (iOS)',
    exec: function(args, context) {
      return debugIOS(context.environment.chromeWindow, context.environment.window);
    }    
  },
  {
    name: 'android',
    description: 'Check on remotely on Android',
    exec: function(args, context) {
      return debugAndroid(context.environment.chromeWindow, context.environment.window);
    }   
  }
];

gcli.addItems(commands);

unload.when(function () {
  Services.ww.unregisterNotification(winObserver);
  gcli.removeItems(commands);
});
