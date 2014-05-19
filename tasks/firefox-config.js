/**
 * Tasks for managing configuration for the current machine.
 */
var deepmerge = require("deepmerge");


// Should grab the search list from addon-sdk
const FIREFOX_SEARCH_PATHS = [
  "/Applications/Firefox.app/Contents/MacOS/firefox",
  "/Applications/FirefoxBeta.app/Contents/MacOS/firefox",
  "/Applications/FirefoxAurora.app/Contents/MacOS/firefox",
  "/Applications/FirefoxNightly.app/Contents/MacOS/firefox"
];

module.exports = function(grunt) {
  var helpers = require("./helpers")(grunt);
  grunt.registerTask("firefox-regen-profile", function() {
    var done = this.async();

    var FirefoxProfile = require("firefox-profile");
    var fxProfile = new FirefoxProfile();
    fxProfile.setPreference("devtools.debugger.remote-enabled", true);
    fxProfile.setPreference("devtools.debugger.remote-port", 8123);

    fxProfile.encoded(function(encodedProfile) {
      helpers.setConfig("firefoxProfile", encodedProfile);
      done();
    });
  });

  grunt.registerTask("config-firefox", function() {
    var done = this.async();
    helpers.promptPath("nightly", "Nightly", FIREFOX_SEARCH_PATHS.reverse(), function() {
      helpers.promptBrowser("firefox", "Firefox", FIREFOX_SEARCH_PATHS, done);
    });
  });

  grunt.registerTask("firefox-site-config", function() {
    var cfg = grunt.config.get("siteConfig");
    if (!("firefoxEnabled" in cfg)) {
      grunt.task.run(["config-firefox", "firefox-site-config"]);
      return;
    }
    if (cfg.firefoxEnabled) {
      grunt.config.merge({
        webdriver: {
          firefox: deepmerge(grunt.config.get("browserTests"), {
            options: {
              desiredCapabilities: {
                browserName: "firefox",
                firefox_binary: cfg.firefoxPath
              }
            },
          })
        }
      });
    }
  });
  grunt.registerTask("merge-site-config", ["firefox-site-config"]);
};

