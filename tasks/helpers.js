var fs = require("fs");
var prompt = require("prompt");

const CONFIG_FILE = "site-config.json";

module.exports = function(grunt) {
  var exports = {
    CONFIG_FILE: CONFIG_FILE,

    readConfig: function() {
      try {
        return grunt.file.readJSON(CONFIG_FILE);
      } catch(ex) {
        return {};
      }
    },
    writeConfig: function(config) {
      grunt.file.write(CONFIG_FILE, JSON.stringify(config, null, 2));
    },
    setConfig: function(prop, value) {
      grunt.config.set("siteConfig." + prop, value);
    },

    promptPath: function(id, name, possiblePaths, done) {
      var existingPaths = possiblePaths.filter(fs.existsSync);

      prompt.start();
      prompt.message = "";
      prompt.delimiter = "";

      prompt.get({
        name: "path",
        description: "Path to " + name + ": ",
        type: "string",
        default: existingPaths[0],
        message: "Path does not exist.",
        conform: function(value) {
          if (fs.existsSync(value)) {
            return true;
          }
          return false;
        }
      }, function(err, result) {
        if (result.path) {
          this.setConfig(id + "Enabled", true);
          this.setConfig(id + "Path", result.path);
        }
        done();
      }.bind(this));
    },

    promptBrowser: function(id, name, possiblePaths, done) {
      prompt.start();
      prompt.message = "";
      prompt.delimiter = "";

      prompt.get({
        name: "enable",
        message: "Test on " + name + "?",
        validator: /y[es]*|n[o]?/,
        warning: 'Must respond yes or no',
        default: 'yes'
      }, function(err, result) {
        if (result.enable[0] != 'y') {
          this.setConfig(id + "Enabled", false);
          done();
          return;
        }

        this.promptPath(id, name, possiblePaths, done);
      }.bind(this));
    }
  };

  return exports;
}
