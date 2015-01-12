const { Cc, Ci } = require("chrome");
const { makeInfallible } = require("../devtools-require")("devtools/toolkit/DevToolsUtils");

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

let iOSProxy = {

  get binaryPath() {
    let uri;

    switch(Runtime.OS) {
      case "Darwin":
        uri = TOOLS_URI + "mac64/ios_webkit_debug_proxy";
        break;
      case "Linux":
        let platform;
        if (Runtime.XPCOMABI.indexOf("x86_64") === 0) {
          platform = "linux64";
        } else {
          platform = "linux32";
        }
        uri = TOOLS_URI + platform + "/ios_webkit_debug_proxy";
        break;
      // TODO: Enable below sections as we package more binaries
      /* case "WINNT":
        uri = TOOLS_URI + "win32/ios_webkit_debug_proxy.exe";
        break; */
      default:
        throw new Error("iOS proxy not yet supported on " + Runtime.OS);
    }

    return URL.toFilename(uri);
  },

  get environment() {
    let libPath;
    switch(Runtime.OS) {
      case "Darwin":
        libPath = this.binaryPath.replace("ios_webkit_debug_proxy", "");
        return {
          DYLD_LIBRARY_PATH: libPath
        };
      case "Linux":
        libPath = this.binaryPath.replace("ios_webkit_debug_proxy", "");
        return {
          LD_LIBRARY_PATH: libPath
        };
      default:
        return {};
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
    if (!running) {
      this.spawn();
    }

    let bound = yield this.waitUntilBound();
    if (!bound) {
      this.stop();
      throw new Error("No iOS device found");
    }
  }),

  checkIfRunning() {
    // Check for any currently running instances of ios_webkit_debug_proxy.
    let running = false;
    let cmd = "/usr/bin/pgrep";
    let name = "ios_webkit_debug_proxy";
    let args = ["-x"];
    switch(Runtime.OS) {
      case "Linux": // fall-through
        // "pgrep -x" only matches against the first 15 characters on Linux.
        name = name.slice(0, 15);
      case "Darwin":
        args.push(name);
        break;
      default:
        // XXX: how do we do this on Windows?
        return Promise.resolve(false);
    }

    return new Promise((resolve, reject) => {
      let proc = child_process.spawn(cmd, args);
      proc.stdout.on("data", data => {
        console.log(cmd + ": " + data);
        if (!Number.isNaN(parseInt(data))) {
          running = true;
          // XXX: notification that an instance is already running?
        }
      });

      proc.stderr.on("data", data => console.error(cmd + ": " + data));

      proc.on("close", code => {
        console.log(cmd + " exited with code " + code);
        resolve(running);
      });
    });
  },

  spawn() {
    proxyProcess = child_process.spawn(this.binaryPath,
                                   ["-c", "null:9221,:9230-9240", "-F"],
                                   {
                                     env: this.environment
                                   });
    proxyProcess.stdout.on("data", makeInfallible(function (data) {
      console.log("ios_webkit_debug_proxy: " + data);
    }, "proxyProcess.stdout.on callback"));

    proxyProcess.stderr.on("data", makeInfallible(function (data) {
      console.error("ios_webkit_debug_proxy: " + data);
    }, "proxyProcess.stderr.on callback"));

    proxyProcess.on("close", makeInfallible(function (code) {
      console.log("ios_webkit_debug_proxy exited with code " + code);
    }, "proxyProcess.on callback"));

    unload(() => proxyProcess && proxyProcess.kill());
  },

  checkIfBound: task.async(function*() {
    console.log("Checking if proxy is bound to port 9230");
    let args = [], command = "lsof -i:9230";
    // Run the command through a shell command in order to support non absolute
    // paths.
    // On Windows the `ComSpec` env variable is going to refer to cmd.exe. On
    // Linux and Mac, the SHELL env variable should refer to the user-chosen
    // shell program.
    // We do not check for OS, as on Windows, with Cygwin, ComSpec isn't set.
    let envService = Cc["@mozilla.org/process/environment;1"].getService(Ci.nsIEnvironment);
    let shell = envService.get("ComSpec") || envService.get("SHELL");
    args.unshift(command);

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
          environment: [ "PATH=$PATH:/usr/sbin:/usr/bin" ],

          stdout: data =>
            console.log("lsof: " + data),
          stderr: data =>
            console.error("lsof: " + data),

          done: result => {
            console.log("lsof: Terminated with error code: " + result.exitCode);
            resolve(!result.exitCode);
          }
        });
      });
    } catch (e) {
      throw new Error("Unable to run lsof command '" + command + "' " +
                      args.join(" ") + ":\n" + (e.message || e));
    }
    return result;
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

  stop() {
    if (proxyProcess) {
      proxyProcess.kill();
      proxyProcess = null;
    }
  }

};

module.exports = iOSProxy;
