const { Cc, Ci } = require("chrome");
const { makeInfallible } = require("../devtools-require")("devtools/shared/DevToolsUtils");

const child_process = require("sdk/system/child_process");
const Subprocess = require("sdk/system/child_process/subprocess");
const Runtime = require("sdk/system/runtime");
const task = require("./task");

const { id } = require("@loader/options");
const { get: getPref } = require("sdk/preferences/service");
const { when: unload } = require("sdk/system/unload");
const URL = require("sdk/url");
const ROOT_URI = getPref("extensions." + id + ".sdk.rootURI");
const TOOLS_URI = ROOT_URI + "tools/";

let proxyProcess;
let binaryName = "ios_webkit_debug_proxy";
if (Runtime.OS == "WINNT") {
  binaryName = "ios-webkit-debug-proxy.exe";
}

let iOSProxy = {

  get binaryPath() {
    let uri;

    switch(Runtime.OS) {
      case "Darwin":
        uri = TOOLS_URI + "mac64/" + binaryName;
        break;
      case "Linux":
        let platform;
        if (Runtime.XPCOMABI.indexOf("x86_64") === 0) {
          platform = "linux64";
        } else {
          platform = "linux32";
        }
        uri = TOOLS_URI + platform + "/" + binaryName;
        break;
      case "WINNT":
        uri = TOOLS_URI + "win32/" + binaryName;
        break;
      default:
        throw new Error("iOS proxy not yet supported on " + Runtime.OS);
    }

    return URL.toFilename(uri);
  },

  get options() {
    let libPath = this.binaryPath.replace(binaryName, "");
    switch(Runtime.OS) {
      case "Darwin":
        return {
          env: {
            DYLD_LIBRARY_PATH: libPath
          }
        };
      case "Linux":
        return {
          env: {
            LD_LIBRARY_PATH: libPath
          }
        };
      case "WINNT":
        return {
          cwd: libPath
        };
      default:
        throw new Error("iOS proxy not yet supported on " + Runtime.OS);
    }
  },

  // JPM throws away Unix permissions, so we'll fix them up
  fixPermissions() {
    switch(Runtime.OS) {
      case "Darwin":
      case "Linux":
        let binary = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
        binary.initWithPath(this.binaryPath);
        binary.permissions = parseInt("555", 8);
        break;
      default:
        return;
    }
  },

  start: task.async(function*() {
    this.fixPermissions();

    let running = yield this.checkIfRunning();
    // XXX: notification that an instance is already running?
    if (!running) {
      this.spawn();
    }

    let bound = yield this.waitUntilBound();
    if (!bound) {
      this.stop();
      throw new Error("No iOS device found");
    }
  }),

  checkIfRunning: task.async(function*() {
    // Check for any currently running instances of ios_webkit_debug_proxy.
    let running = false;
    let cmd = "/usr/bin/pgrep -x ";
    let name = binaryName;
    switch(Runtime.OS) {
      case "Linux": // fall-through
        // "pgrep -x" only matches against the first 15 characters on Linux.
        name = name.slice(0, 15);
      case "Darwin":
        cmd += name;
        break;
      case "WINNT":
        // "ps" only matches the file name without extension on Windows.
        name = name.slice(0, -4);
        cmd = `PowerShell -Command ps ${name}`;
        break;
      default:
        throw new Error("iOS proxy not yet supported on " + Runtime.OS);
    }

    return this.runInShell(cmd);
  }),

  spawn() {
    let devicePortConfig = "null:9221,:9230-9240";
    let args = ["-c", devicePortConfig, "--no-frontend"];
    proxyProcess = child_process.spawn(this.binaryPath, args, this.options);
    proxyProcess.stdout.on("data", makeInfallible(function (data) {
      console.log(binaryName + ": " + data);
    }, "proxyProcess.stdout.on callback"));

    proxyProcess.stderr.on("data", makeInfallible(function (data) {
      console.error(binaryName + ": " + data);
    }, "proxyProcess.stderr.on callback"));

    proxyProcess.on("close", makeInfallible(function (code) {
      console.log(binaryName + " exited with code " + code);
    }, "proxyProcess.on callback"));

    unload(() => proxyProcess && proxyProcess.kill());
  },

  checkIfBound: task.async(function*() {
    if (Runtime.OS == "WINNT") {
      // Windows has no reasonably simple way to make this work.
      return Promise.resolve(true);
    }
    console.log("Checking if proxy is bound to port 9230");
    return this.runInShell("lsof -i:9230");
  }),

  waitUntilBound: task.async(function*() {
    for (let attempts = 10; attempts > 0; attempts--) {
      let bound = yield this.checkIfBound();
      if (bound) {
        return true;
      }
    }
    return false;
  }),

  /**
   * Run the specified command through a shell command in order to support
   * non absolute paths.
   * On Windows the `ComSpec` env variable is going to refer to cmd.exe. On
   * Linux and Mac, the SHELL env variable should refer to the user-chosen
   * shell program.
   * We do not check for OS, as on Windows, with Cygwin, ComSpec isn't set.
   *
   * @param string command
   *        The command to execute in the shell.
   */
  runInShell: task.async(function*(command) {
    let envService = Cc["@mozilla.org/process/environment;1"].getService(Ci.nsIEnvironment);
    let shell = envService.get("ComSpec") || envService.get("SHELL");
    let env = "PATH=" + envService.get("PATH");
    let args = [command];

    // For cmd.exe, we have to pass the `/C` option,
    // but for unix shells we need -c.
    // That to interpret next argument as a shell command.
    if (envService.exists("ComSpec")) {
      args.unshift("/C");
    } else {
      args.unshift("-c");
    }

    let result = false;
    try {
      result = yield new Promise(resolve => {
        Subprocess.call({
          command: shell,
          arguments: args,
          environment: [ env ],
          stdout: data => console.log(command + ": " + data),
          stderr: data => console.error(command + ": " + data),
          done: result => {
            console.log(command + ": Terminated with error code: " + result.exitCode);
            resolve(!result.exitCode);
          }
        });
      });
    } catch (e) {
      throw new Error("Unable to run command '" + command + "' " +
                      args.join(" ") + ":\n" + (e.message || e));
    }
    return result;
  }),

  stop() {
    if (proxyProcess) {
      try {
        proxyProcess.kill();
      } catch (e) {
        console.log("Ignoring error while killing process:", e);
      }
      proxyProcess = null;
    }
  }

};

module.exports = iOSProxy;
