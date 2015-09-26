"use strict";

const { Cu } = require("chrome");

// In Firefox 44 and later, many DevTools modules were relocated.
// See https://bugzil.la/912121
const PATH_RENAMES = [
  {
    regex: /^resource:\/\/\/modules\/devtools\/client\/framework\//,
    replacement: "resource:///modules/devtools/"
  },
  {
    regex: /^resource:\/\/gre\/modules\/devtools\/shared\/apps\//,
    replacement: "resource://gre/modules/devtools/"
  },
  {
    regex: /^resource:\/\/gre\/modules\/devtools\/shared\//,
    replacement: "resource://gre/modules/devtools/"
  },
];

function scopedImport(path) {
  let scope = {};
  Cu.import(path, scope);
  return scope;
}

function devtoolsImport(path) {
  try {
    return scopedImport(path);
  } catch (e) {
    // Attempt known renames for 43 and earlier
    for (let { regex, replacement } of PATH_RENAMES) {
      path = path.replace(regex, replacement);
    }
    return scopedImport(path);
  }
}

module.exports = devtoolsImport;
