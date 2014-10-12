const { Cc, Ci } = require("chrome");

const child_process = require("sdk/system/child_process");
const Runtime = require("sdk/system/runtime");

const { id } = require("@loader/options");
const { get: getPref } = require("sdk/preferences/service");
const { when: unload } = require("sdk/system/unload");
const URL = require("sdk/url");
const ROOT_URI = getPref("extensions." + id + ".sdk.rootURI");
const TOOLS_URI = ROOT_URI + "tools/";

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
          DYLD_FALLBACK_LIBRARY_PATH: libPath
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

  start() {
    this.fixPermissions();
    let proc = child_process.spawn(this.binaryPath,
                                   ["-c", "null:9221,:9230-9240"],
                                   {
                                     env: this.environment
                                   });
    proc.stdout.on('data', function (data) {
      console.log('ios_webkit_debug_proxy: ' + data);
    });

    proc.stderr.on('data', function (data) {
      console.error('ios_webkit_debug_proxy: ' + data);
    });

    proc.on('close', function (code) {
      console.log('ios_webkit_debug_proxy exited with code ' + code);
    });

    unload(() => proc.kill());
  }

};

module.exports = iOSProxy;
