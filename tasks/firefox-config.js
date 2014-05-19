/**
 * Tasks for managing configuration for the current machine.
 */
var deepmerge = require("deepmerge");


// Should grab the search list from addon-sdk
const FIREFOX_SEARCH_PATHS = [
  "/Applications/Firefox.app/Contents/MacOS/firefox",
];

const NIGHTLY_SEARCH_PATHS = [
  "/Applications/FirefoxNightly.app/Contents/MacOS/firefox"
];

module.exports = function(grunt) {
  var helpers = require("./helpers")(grunt);
  grunt.registerTask("firefox-regen-profile", function() {
    var done = this.async();

  });

  grunt.registerTask("config-firefox", function() {
    console.log("configging firefox");
    var done = this.async();
    helpers.promptPath("nightly", "Nightly", NIGHTLY_SEARCH_PATHS, function() {
      helpers.promptBrowser("firefox", "Firefox", FIREFOX_SEARCH_PATHS, done);
    });
  });

  grunt.registerTask("merge-firefox-config", function() {
    var cfg = grunt.config.get("siteConfig");
    var done = this.async();

    if (cfg.firefoxEnabled) {
      var FirefoxProfile = require("firefox-profile");
      var fxProfile = new FirefoxProfile();
      fxProfile.setPreference("devtools.debugger.remote-enabled", true);
      fxProfile.setPreference("devtools.debugger.remote-port", 8123);
      fxProfile.setPreference("devtools.adapters.chrome-port", 8124);

      fxProfile.addExtension("fxdevtools-adapters.xpi", function() {
        fxProfile.encoded(function(encodedProfile) {
          grunt.config.merge({
            test: {
              firefox: deepmerge(grunt.config.get("browserTests"), {
                options: {
                  desiredCapabilities: {
                    browserName: "firefox",
                    firefox_binary: cfg.firefoxPath,
                    firefox_profile: encodedProfile
                  }
                },
              })
            }
          });
          done();
        });
      });
    } else {
      done();
    }
  });
  grunt.registerTask("merge-site-config", ["firefox-site-config"]);
};

