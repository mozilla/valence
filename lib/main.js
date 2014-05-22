const {Cu} = require("chrome");

const {DebuggerClient} = Cu.import("resource://gre/modules/devtools/dbg-client.jsm",  {});
let {gDevTools} = Cu.import("resource:///modules/devtools/gDevTools.jsm", {});
let {devtools} = Cu.import("resource://gre/modules/devtools/Loader.jsm", {});

const task = require("util/task");
const server = require("chromium/server");

function promiseCallback(obj, fn, ...args) {
  return new Promise((resolve, reject) => {
    fn.call(obj, ...args, resolve);
  });
}

function openToolbox(client, form, tool="webconsole", chrome=false) {
  let options = {
    client: client,
    form: form,
    chrome: chrome
  };
  devtools.TargetFactory.forRemoteTab(options).then((target) => {
    let hostType = devtools.Toolbox.HostType.WINDOW;
    gDevTools.showToolbox(target, tool, hostType).then((toolbox) => {
      toolbox.once("destroyed", function() {
        gClient.close();
      });
    });
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
      openToolbox(client, response.tabs[response.selected], "styleeditor");
    }));
  }
});

//server.listen(9223, "http://localhost:9222");


