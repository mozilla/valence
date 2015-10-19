"use strict";

const { devtools } =
  require("./devtools-import")("resource://devtools/shared/Loader.jsm");

// In Firefox 44 and later, many DevTools modules were relocated.
// See https://bugzil.la/912121
const ID_RENAMES = [
  {
    regex: /^devtools\/client\/webide\/modules\//,
    replacement: "devtools/webide/"
  },
  {
    regex: /^devtools\/shared\/client\//,
    replacement: "devtools/client/"
  },
  {
    regex: /^devtools\/shared\/styleinspector\//,
    replacement: "devtools/styleinspector/"
  },
  {
    regex: /^devtools\/shared\//,
    replacement: "devtools/toolkit/"
  },
];

function devtoolsRequire(id) {
  try {
    return devtools.require(id);
  } catch (e) {
    // Attempt known renames for 43 and earlier
    for (let { regex, replacement } of ID_RENAMES) {
      id = id.replace(regex, replacement);
    }
    return devtools.require(id);
  }
}

module.exports = devtoolsRequire;
