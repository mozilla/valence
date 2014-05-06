const promise = require("util/promise");
const task = require("util/task");
const server = require("chromium/server");

const {Cu} = require("chrome");
const {DebuggerClient} = Cu.import("resource://gre/modules/devtools/dbg-client.jsm",  {});

const ui = require("sdk/ui");
let action_button = ui.ActionButton({
  id: "ui-button",
  label: "Debug Chrome Like a Boss",
  icon: "./icon.png",
  onClick: function(state) {
    let transport = server.connect("http://localhost:9222");
    let client = new DebuggerClient(transport);

    client.connect(task.async(function*(type, traits) {
      let deferred = promise.defer();
      client.listTabs(deferred.resolve);
      response = yield deferred.promise;
      let selectedTab = response.tabs[response.selected];
      deferred = promise.defer();
      client.attachConsole(selectedTab.consoleActor, ["PageError", "ConsoleAPI", "NetworkActivity", "FileActivity"], deferred.resolve);
      response = yield deferred.promise;
    }));
  }
});
