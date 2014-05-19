module.exports = function(grunt) {
  grunt.initConfig({
    pkg: grunt.file.readJSON('package.json'),

    browserTests: {
      tests: ['test/*.js']
    },

    webdriver: {}
  });

  grunt.loadTasks('tasks');
  grunt.loadNpmTasks('grunt-webdriver');

  grunt.registerTask("config", ["config-firefox", "config-chrome"]);

  // If there is no site configuration file, enqueue a task to generate
  // that configuration.
  try {
    grunt.file.readJSON("site-config.json");
  } catch(ex) {
    console.log("No site configuration found.");
    grunt.task.run("config");
  }

  // Let tasks that write to site-config.json affect the grunt configuration
  // before running other tasks.
  grunt.task.run("chrome-site-config");
  grunt.task.run("firefox-site-config");
  grunt.task.run("firefox-regen-profilee");

  return;
};
