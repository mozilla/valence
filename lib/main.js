const task = require("util/task");
const server = require("chromium/server");

const {Cu} = require("chrome");
const {DebuggerClient} = Cu.import("resource://gre/modules/devtools/dbg-client.jsm",  {});

function promiseCallback(obj, fn, ...args) {
  return new Promise((resolve, reject) => {
    fn.call(obj, ...args, resolve);
  });
}

const ui = require("sdk/ui");
let action_button = ui.ActionButton({
  id: "ui-button",
  label: "Debug Chrome Like a Boss",
  icon: "./icon.png",
  onClick: function(state) {
    let transport = server.connect("http://localhost:9222");
    let client = new DebuggerClient(transport);

    client.connect(task.async(function*(type, traits) {
      let response = yield promiseCallback(client, client.listTabs);
      let selectedTab = response.tabs[response.selected];
      yield promiseCallback(
        client,
        client.attachConsole,
        selectedTab.consoleActor,
        ["PageError", "ConsoleAPI", "NetworkActivity", "FileActivity"]
      );
    }));
  }
});

