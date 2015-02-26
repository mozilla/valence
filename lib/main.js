const {Cu} = require("chrome");

const unload = require("sdk/system/unload");

const {DebuggerClient} = Cu.import("resource://gre/modules/devtools/dbg-client.jsm",  {});
let {gDevTools} = Cu.import("resource:///modules/devtools/gDevTools.jsm", {});
let {devtools} = Cu.import("resource://gre/modules/devtools/Loader.jsm", {});
Cu.import("resource://gre/modules/Services.jsm");

const gcli = devtools.require("gcli/index");
const task = require("./util/task");
const iOSProxy = require("./util/ios-proxy");
const server = require("./chromium/server");
const timers = require("sdk/timers");
const { notify } = require("sdk/notifications");
const scanner = require("./util/scanner");

// Add runtime entries to WebIDE
scanner.register();

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
        if (response.error || response.tabs.length === 0) {
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
    iOSProxy.start();
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
  gcli.removeItems(commands);
});
