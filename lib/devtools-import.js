"use strict";

const { Cu } = require("chrome");

// In Firefox 44 and later, many DevTools modules were relocated.
// See https://bugzil.la/912121
const PATH_RENAMES = [
  {
    regex: /^resource:\/\/devtools\/client\/framework\//,
    replacements: [
      "resource:///modules/devtools/client/framework/",
      "resource:///modules/devtools/",
    ],
  },
  {
    regex: /^resource:\/\/devtools\/shared\/apps\//,
    replacements: [
      "resource://gre/modules/devtools/shared/apps/",
      "resource://gre/modules/devtools/",
    ],
  },
  {
    regex: /^resource:\/\/devtools\/shared\//,
    replacements: [
      "resource://gre/modules/devtools/shared/",
      "resource://gre/modules/devtools/",
    ],
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
    for (let { regex, replacements } of PATH_RENAMES) {
      if (!path.match(regex)) {
        continue;
      }
      for (let replacement of replacements) {
        try {
          return scopedImport(path.replace(regex, replacement));
        } catch(e) {
          // Continue trying other replacements
        }
      }
    }
  }
}

module.exports = devtoolsImport;
