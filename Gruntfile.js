module.exports = function(grunt) {
  // If there is no site configuration file, enqueue a task to generate
  // that configuration.
  try {
    var siteConfig = grunt.file.readJSON("site-config.json");
  } catch(ex) {
    var siteConfig = {}
  }

  console.log("siteConfig.nightlyPath: " + siteConfig.nightlyPath);

  grunt.initConfig({
    pkg: grunt.file.readJSON('package.json'),
    siteConfig: siteConfig,

    shell: {
      xpi: {
        command: "cfx xpi --strip-sdk"
      },
      run: {
        command: "cfx run --strip-sdk -b <%= siteConfig.nightlyPath %>"
      }
    },

    browserTests: {
      tests: ['test/*.js']
    },

    // Will be filled in by the configuration tasks.
    webdriver: {}
  });

  grunt.loadTasks('tasks');
  grunt.registerTask("config", ["config-firefox", "config-chrome"]);
  grunt.loadNpmTasks('grunt-webdriver');
  grunt.loadNpmTasks('grunt-shell');
  grunt.registerTask("xpi", ["shell:xpi"]);
  grunt.registerTask("run", ["shell:run"]);

  grunt.registerTask("default", ["xpi"]);

  // Let tasks that write to site-config.json affect the grunt configuration
  // before running other tasks.
  grunt.task.run("firefox-site-config");
  grunt.task.run("chrome-site-config");
  grunt.task.run("firefox-regen-profile");

  grunt.registerTask("save-site-config", function() {
    grunt.file.write("site-config.json", JSON.stringify(grunt.config.get("siteConfig", null, 2)));
  });

  grunt.task.run("save-site-config");
};
