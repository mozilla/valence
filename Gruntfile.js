module.exports = function(grunt) {
  // If there is no site configuration file, enqueue a task to generate
  // that configuration.
  try {
    var siteConfig = grunt.file.readJSON("site-config.json");
  } catch(ex) {
  }

  grunt.initConfig({
    pkg: grunt.file.readJSON('package.json')
  });

  // Load the configuration tasks.
  grunt.loadTasks('tasks');
  grunt.registerTask("config", ["config-firefox", "config-chrome", "save-site-config"]);
  grunt.registerTask("save-site-config", function() {
    grunt.file.write("site-config.json", JSON.stringify(grunt.config.get("siteConfig", null, 2)));
  });

  if (!siteConfig) {
    console.log("No configuration, run 'grunt config' to generate a configuration.");
    grunt.registerTask("default", "config");
    return;
  }
  grunt.config.merge({
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

    test: {}
  });

  grunt.loadNpmTasks('grunt-webdriver');
  grunt.loadNpmTasks('grunt-shell');

  grunt.registerTask("xpi", ["shell:xpi"]);
  grunt.registerTask("run", ["shell:run"]);
  grunt.registerTask("default", ["xpi"]);

  grunt.renameTask("webdriver", "test");

  // Queue up the tasks that will fill in the webdriver configuration.
  grunt.task.run("xpi");
  grunt.task.run("merge-firefox-config");
  grunt.task.run("merge-chrome-config");
};
