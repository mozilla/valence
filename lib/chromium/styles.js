const {Cc, Ci, Cu} = require("chrome");

const protocol = require("../devtools/server/protocol");
const {Actor, ActorClass, Pool, method, Arg, Option, RetVal, types} = protocol;
const {asyncMethod, todoMethod, todoMethodSilent} = require("../util/protocol-extra");
const {LongStringActor} = require("../devtools/server/actors/string");
const task = require("../util/task");
const {emit} = require("../devtools/event"); // Needs to share a loader with protocol.js, boo.

try {
  types.getType("chromium_domnode");
} catch(ex) {
  types.addActorType("chromium_domnode");
}

types.addActorType("chromium_domstylerule");

types.addDictType("chromium_appliedstyle", {
  rule: "chromium_domstylerule#actorid",
  inherited: "nullable:chromium_domnode#actorid"
});

const STYLE_RULE = 1;
const ELEMENT_RULE = 100;

function DOMUtils() {
  return Cc["@mozilla.org/inspector/dom-utils;1"].getService(Ci.inIDOMUtils);
}

var ChromiumPageStyleActor = protocol.ActorClass({
  typeName: "chromium_pagestyle",

  initialize: function(inspector) {
    Actor.prototype.initialize.call(this, null);
    this.inspector = inspector;
    if (!this.inspector.walker) {
      throw new Error("The inspector's WalkerActor must be created before creating a PageStyleActor.");
    }

    this.walker = inspector.walker;

    this.refMap = new Map();

    // New until proven otherwise.
    this.protocolStyle = "new";
  },

  get conn() { return this.inspector.conn; },
  get rpc() { return this.inspector.rpc; },
  get sheets() { return this.inspector.tab.sheets; },

  styleRef: function(handle) {
    let key = this.styleKey(handle);
    // XXX: hash that key.
    if (this.refMap.has(key)) {
      return this.refMap.get(key);
    }

    let rule = new ChromiumStyleRuleActor(this, handle);
    this.refMap.set(key, rule);
    return rule;
  },

  styleKey: function(handle) {
    if (handle.style.styleId) {
      this.protocolStyle = "old";
      let styleId = handle.style.styleId;
      return styleId.styleSheetId + "-" + styleId.ordinal;
    } else {
      return JSON.stringify(handle);
    }
  },

  updateStyleRef: function(rule, newStyle) {
    let key = this.styleKey(rule.handle);
    this.refMap.delete(key);
    rule.handle.style = newStyle;
    rule.style = newStyle;
    key = this.styleKey(rule.handle);
    this.refMap.set(key, rule);
  },

  sheetRef: function(styleSheetId) {
    if (this.refMap.has(styleSheetId)) {
      return this.refMap.get(styleSheetId);
    };

    let header = this.sheets.get(styleSheetId);
    let actor = new ChromiumStyleSheetActor(this, header);
    this.manage(actor);
    this.refMap.set(styleSheetId, actor);
    return actor;
  },

  /**
   * I truly hate this method.
   */
  setPropertyText: task.async(function*(rule, prop, value) {
    let range;
    if (prop) {
      range = prop.range;
    } else {
      let endLine = rule.style.range.startLine;
      let endColumn = rule.style.range.startColumn;
      range = {
        startLine: endLine,
        startColumn: endColumn,
        endLine: endLine,
        endColumn: endColumn
      };
    }

    let response = yield this.propertyTextRequest(rule, prop, range, value);
    this.updateStyleRef(rule, response.style);

    // Find the new range for the property.
    let newRange;
    let newName = value.name || prop.name;
    for (let newProp of rule.style.cssProperties) {
      if (newProp.name === value.name && newProp.range) {
        newRange = newProp.range;
        break;
      }
    }

    if (!newRange) {
      // We must have deleted the property.  Give an empty range starting
      // at the old range's start point.
      newRange = {
        startLine: range.startLine,
        startColumn: range.startColumn,
        endLine: range.endLine,
        endColumn: range.endColumn
      };
    }

    this.doAwfulRangeFixup(rule, range, newRange);
  }),

  doAwfulRangeFixup(rule, oldRange, newRange) {
    // OK AND HERE'S THE SHITTY PART.
    // We changed ranges around!  Everything's out of sync!
    // Let's try to fix it all up.  It might not work.
    // I'd love to hear better suggestions for this.

    let newRefMap = new Map();
    for (let [key, ref] of this.refMap) {
      if (!(ref instanceof ChromiumStyleRuleActor) ||
          ref === rule ||
          ref.handle.styleSheetId != rule.styleSheetId) {
        newRefMap.set(key, ref);
        continue;
      }

      // Urgh.
      ref.updateRanges(oldRange, newRange);
      newRefMap.set(this.styleKey(ref.handle), ref);
    }
    this.refMap = newRefMap;
  },

  propertyTextRequest: task.async(function*(rule, prop, range, value) {
    if (this.protocolStyle === "new") {
      return this.propertyTextRequestNew(rule, prop, range, value)
    } else {
      return this.propertyTextRequestOld(rule, prop, range, value)
    }
  }),

  propertyText: function(value) {
    // XXX: important.
    // I would like to clarify the previous comment: I meant "Handle
    // important properties", not "This fixme comment is important".
    if (!value) {
      return "";
    }
    let text = value.name + ":" + value.value;
    if (value.priority) {
      text += " " + value.priority;
    }
    text += ";";
    return text;
  },

  propertyTextRequestNew: function(rule, prop, range, value) {
    return this.rpc.request("CSS.setPropertyText", {
      styleSheetId: rule.style.styleSheetId,
      range: range,
      text: this.propertyText(value)
    });
  },

  propertyTextRequestOld: function(rule, prop, range, value) {
    if (!prop && !value) {
      // unnecessary.
      return;
    }

    let text = value ? value.name + ":" + value.value + ";" : "";

    return this.rpc.request("CSS.setPropertyText", {
      styleId: rule.style.styleId,
      propertyIndex: prop ? prop.index : 0,
      text: this.propertyText(value),
      overwrite: !!prop
    });
  },

  getComputed: asyncMethod(function*(node, options) {
    let response = yield this.rpc.request("CSS.getComputedStyleForNode", {
      nodeId: node.handle.nodeId
    });
    let ret = {};
    for (let computed of response.computedStyle) {
      ret[computed.name] = {
        value: computed.value,
        // XXX: important?
        // XXX: matched
        matched: true
      };
    }
    return ret;
  }, {
    request: {
      node: Arg(0, "chromium_domnode"),
      markMatched: Option(1, "boolean"),
      onlyMatched: Option(1, "boolean"),
      filter: Option(1, "string")
    },
    response: {
      computed: RetVal("json")
    }
  }),

  getMatchedSelectors: todoMethod({
    request: {
      node: Arg(0, "chromium_domnode"),
      property: Arg(1, "string"),
      filter: Option(2, "string")
    },
    response: RetVal(types.addDictType("chromium_matchedselectorresponse", {
      rules: "array:chromium_domstylerule",
      sheets: "array:chromium_stylesheet",
      matched: "array:chromium_matchedselector"
    }))
  }),

  getApplied: asyncMethod(function*(node, options) {
    let result = {
      entries: [],
      sheets: new Set(),
      rules: new Set()
    };

    yield this.addElementRules(node, undefined, options, result);

    if (options.inherited) {
      let parent = node.parent;
      while (parent && parent.handle.nodeType === Ci.nsIDOMNode.ELEMENT_NODE) {
        yield this.addElementRules(parent, true, options, result)
        parent = parent.parent;
      }
    }

    return {
      entries: result.entries,
      sheets: [...result.sheets],
      rules: [...result.rules],
    }
  }, {
    request: {
      node: Arg(0, "chromium_domnode"),
      inherited: Option(1, "boolean"),
      matchedSelectors: Option(1, "boolean"),
      filter: Option(1, "string")
    },
    response: RetVal(types.addDictType("chromium_appliedStylesReturn", {
      entries: "array:chromium_appliedstyle",
      rules: "array:chromium_domstylerule",
      sheets: "array:chromium_stylesheet"
    }))
  }),

  addElementRules: task.async(function(node, inherited, options, result) {
    var addStyle = function(style, matchingSelectors) {
      if (inherited && !style.hasInheritedProps()) {
        return;
      }

      let isSystem = style.handle.origin == "user-agent";
      if (isSystem && options.filter != "ua") {
        return;
      }

      let matchedSelectors = [];
      if (matchingSelectors && style.selectorList) {
        matchedSelectors = [for (i of matchingSelectors) style.selectorList.selectors[i].value ];
      }

      result.entries.push({
        rule: style,
        inherited: inherited ? node : undefined,
        matchedSelectors: matchedSelectors
      });

      if (style.handle.styleSheetId) {
        result.sheets.add(this.sheetRef(style.handle.styleSheetId));
      }
      result.rules.add(style);
    }.bind(this);

    let response = yield this.rpc.request("CSS.getInlineStylesForNode", {
      nodeId: node.handle.nodeId
    });

    if (response.inlineStyle) {
      let style = this.styleRef({ style: response.inlineStyle });
      style.type = ELEMENT_RULE;
      addStyle(style);
    }

    response = yield this.rpc.request("CSS.getMatchedStylesForNode", {
      nodeId: node.handle.nodeId,
      includePseudo: true,
      inherited: false
    });

    for (let match of response.matchedCSSRules || []) {
      let ruleHandle = match.rule;
      let style = this.styleRef(ruleHandle);
      addStyle(style, match.matchingSelectors);
    }

    // XXX: Pseudo elements.
  }),

  getLayout: asyncMethod(function*(node) {
    response = yield this.rpc.request("DOM.getBoxModel", {
      nodeId: node.handle.nodeId,
    });

    function readQuad(quad) {
      return {
        TL: { x: quad[0], y: quad[1] },
        TR: { x: quad[2], y: quad[3] },
        BR: { x: quad[4], y: quad[5] },
        BL: { x: quad[6], y: quad[7] },
      }
    }

    let model = response.model;
    let margin = readQuad(model.margin);
    let border = readQuad(model.border);
    let padding = readQuad(model.padding);
    let content = readQuad(model.content);


    let layout = {
      "width": model.width,
      "height": model.height,
    };

    function writeQuad(prefix, postfix, outer, inner) {
      layout[prefix + "top" + postfix] = inner.TL.y - outer.TL.y;
      layout[prefix + "right" + postfix] = inner.TL.x - inner.TL.x;
      layout[prefix + "bottom" + postfix] = outer.BR.y - inner.BR.y;
      layout[prefix + "left" + postfix] = outer.BR.x - inner.BR.x;
    }

    writeQuad("margin-", "", margin, border);
    writeQuad("border-", "-width", border, padding);
    writeQuad("padding-", "", padding, content);

    // XXX: auto margins.
    layout.autoMargins = {};

    return layout;
  }, {
    request: {
      node: Arg(0, "chromium_domnode"),
      autoMargins: Option(1, "boolean")
    },
    response: RetVal("json")
  }),

  createHelperStylesheet: task.async(function*(node) {
    let frameId = undefined;
    while (!frameId && node) {
      frameId = node.handle.frameId;
      node = node.parent;
    }
    if (!frameId) {
      frameId = this.inspector.tab.rootFrameId;
    }
    let response = yield this.rpc.request("CSS.createStyleSheet", {
      frameId: frameId
    });
    return response.styleSheetId;
  }),

  getHelperStylesheet(node) {
    if (!this.helperStylesheetPromise) {
      this.helperStylesheetPromise = this.createHelperStylesheet();
    }
    return this.helperStylesheetPromise;
  },

  addNewRule: asyncMethod(function*(node) {
    let id = node.getAttr("id");
    let className = node.getAttr("class");
    let selector;
    if (id) {
      selector = "#" + id;
    } else if (className) {
      selector = "." + className;
    } else {
      selector = node.handle.nodeName.toLowerCase();
    }

    let location = { startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 };

    let helperSheetId = yield this.getHelperStylesheet(node);
    let ruleText = selector + " {  } "
    let response = yield this.rpc.request("CSS.addRule", {
      styleSheetId: helperSheetId,
      ruleText: ruleText,
      location: location
    });

    let rule = this.styleRef(response.rule);

    this.doAwfulRangeFixup(rule, location, {
      startLine: 0, startColumn: 0, endLine: 0, endColumn: ruleText.length
    });

    return {
      entries: [{
        rule: rule,
        inherited: null
      }],
      sheets: [this.sheetRef(helperSheetId)],
      rules: [rule]
    }
  }, {
    request: {
      node: Arg(0, "chromium_domnode")
    },
    response: RetVal("chromium_appliedStylesReturn")
  })
});
exports.ChromiumPageStyleActor = ChromiumPageStyleActor;

var ChromiumStyleSheetActor = protocol.ActorClass({
  typeName: "chromium_stylesheet",

  initialize: function(parent, header) {
    Actor.prototype.initialize.call(this);
    this.parent = parent;
    this.header = header;
  },

  get conn() { return this.parent.conn },
  get rpc() { return this.parent.rpc },

  form: function(detail) {
    if (detail === "actorid") {
      return this.actorID;
    }

    return {
      actor: this.actorID,
      href: this.header.sourceURL || "",
      disabled: !!this.header.disabled,
      title: this.header.title,
      system: this.header.origin == "user-agent",
      styleSheetIndex: -1
    }
  },

  toggleDisabled: todoMethod({
    response: { disabled: RetVal("boolean")}
  }),

  getText: asyncMethod(function*() {
    let response = yield this.rpc.request("CSS.getStyleSheetText", {
      styleSheetId: this.header.styleSheetId
    });
    return LongStringActor(this.conn, response.text);
  }, {
    response: {
      text: RetVal("longstring")
    }
  }),

  getOriginalSources: todoMethod({
    request: {},
    response: {
//      originalSources: RetVal("nullable:array:originalsource")
    }
  }),

  getOriginalLocation: todoMethod({
    request: {
      line: Arg(0, "number"),
      column: Arg(1, "number")
    },
    response: RetVal(types.addDictType("chromium_originallocationresponse", {
      source: "string",
      line: "number",
      column: "number"
    }))
  }),

  getMediaRules: todoMethod({
    request: {},
    response: {
//      mediaRules: RetVal("nullable:array:mediarule")
    }
  }),

  update: asyncMethod(function*(text, transition) {
    yield this.rpc.request("CSS.setStyleSheetText", {
      styleSheetId: this.header.styleSheetId,
      text: text
    })
  }, {
    request: {
      text: Arg(0, "string"),
      transition: Arg(1, "boolean")
    }
  })
});

var ChromiumStyleRuleActor = protocol.ActorClass({
  typeName: "chromium_domstylerule",

  initialize: function(pageStyle, handle) {
    Actor.prototype.initialize.call(this, null);
    this.pageStyle = pageStyle;
    this.handle = handle;
    // Handle will be null for newly-created rules that haven't
    // actually been created yet.
    this.style = handle.style;
  },

  get conn() { return this.pageStyle.conn; },

  get marshallPool() { return this.pageStyle; },

  form: function(detail) {
    if (detail === "actorid") {
      return this.actorID;
    }

    let form = {
      actor: this.actorID,
      type: this.type || STYLE_RULE
    }

    if (this.handle.styleSheetId && this.handle.selectorList) {
      let start = this.handle.selectorList.selectors[0];
      form.line = start.startLine;
      form.column = start.startColumn;
    }

    if (this.handle.parent) {
      form.parentRule = undefined;
    }

    if (this.handle.styleSheetId) {
      form.parentStyleSheet = this.pageStyle.sheetRef(this.handle.styleSheetId).actorID;
    } else {
      form.href = "http://idontknowwhatimdoing/"
    }

    if (this.handle.selectorList) {
      form.selectors = [];
      for (let selector of this.handle.selectorList.selectors) {
        if (typeof(selector) === "string") {
          form.selectors.push(selector);
        } else {
          form.selectors.push(selector.value);
        }
      }
    }

    if (this.handle.cssText) {
      form.cssText = this.handle.cssText;
    } else {
      form.cssText = "";
      for (let property of this.style.cssProperties) {
        if (!property.range) {
          continue;
        }
        form.cssText += property.name + ": " + property.value;
        if (property.important) {
          form.cssText += " !important"
        }
        form.cssText += "; ";
      }
    }

    return form;
  },

  updateRanges: function(oldRange, newRange) {
    if (!this.style.range) {
      return;
    }

    if (oldRange.startLine != newRange.startLine || oldRange.startColumn != newRange.startColumn) {
      throw new Error("Violated expectation that first column wouldn't change!");
    }

    if (this.handle.selectorList) {
      for (let selector of this.handle.selectorList.selectors) {
        this.updateRange(oldRange, newRange, selector.range);
      }
    }
    if (this.updateRange(oldRange, newRange, this.style.range)) {
      for (let prop of this.style.cssProperties) {
        this.updateRange(oldRange, newRange, prop.range);
      }
    }
  },

  updateRange: function(oldRange, newRange, range) {
    if (!range) {
      return false;
    }

    let point = this.adjustPoint(oldRange, newRange, range.startLine, range.startColumn);
    range.startLine = point.line;
    range.startColumn = point.column;

    let point = this.adjustPoint(oldRange, newRange, range.endLine, range.endColumn);
    range.startLine = point.line;
    range.startColumn = point.column;

    return true;
  },

  /**
   * I'm overwriting this because I keep screwing it up.
   */
  adjustPoint: function(oldRange, newRange, line, col) {
    if (oldRange.startLine > line) {
      return { line: line, column: col };
    }

    if (oldRange.startLine === line) {
      if (oldRange.startColumn > col) {
        return { line: line, column: col };
      }

      if (oldRange.endColumn > col) {
        throw new Error("Unexpected overlap in range editing!");
      }

      // Return a point that has changed the same amount as the range.
      return {
        line: line + (newRange.endLine - oldRange.endLine),
        column: col + (newRange.endColumn - oldRange.endColumn)
      }
    }

    return {
      line: line + (newRange.endLine - oldRange.endLine),
      column: col
    }
  },

  hasInheritedProps: function() {
    let utils = DOMUtils();
    for (let prop of this.style.cssProperties) {
      if (prop.value === "initial") {
        continue;
      }

      if (utils.isInheritedProperty(prop.name)) {
        return true;
      }
    }
    return false;
  },

  modifyProperties: asyncMethod(function*(modifications) {
    for (let mod of modifications) {
      yield this.modifyProperty(mod);
    }
    return this;
  }, {
    request: { modifications: Arg(0, "array:json") },
    response: { rule: RetVal("chromium_domstylerule") }
  }),

  modifyProperty: task.async(function*(mod) {
    let foundProp;
    this.style.cssProperties.forEach((prop, index) => {
      prop.index = index;
      if (prop.name === mod.name) {
        foundProp = prop;
      }
    });

    if (mod.type === "set") {
      if (foundProp && foundProp.value === mod.value) {
        return;
      }


      let range;
      if (foundProp && foundProp.range) {
        range = foundProp.range;
      } else {
        if (mod.value === "") {
          // XXX: Chrome duplicates strangely in this case.
          return;
        }
      }

      yield this.pageStyle.setPropertyText(this, foundProp, mod);
    } else if (mod.type === "remove") {
      if (!foundProp || !foundProp.range) {
        return;
      }
      yield this.pageStyle.setPropertyText(this, foundProp, null);
    }
  }),

  modifySelector: todoMethod({
    request: { selector: Arg(0, "string") },
    response: { isModified: RetVal("boolean") },
  }),
});

// XXX: Don't do the media change actor yet.

var ChromiumStyleSheetsActor = protocol.ActorClass({
  typeName: "chromium_stylesheets",

  initialize: function(tab) {
    Actor.prototype.initialize.call(this);
    this.tab = tab;
    this.refMap = new Map();
  },

  get conn() { return this.tab.conn },
  get rpc() { return this.tab.rpc },
  get sheets() { return this.tab.sheets },

  sheetRef: function(header) {
      if (this.refMap.has(header.styleSheetId)) {
      return this.refMap.get(header.styleSheetId);
    }

    let sheet = ChromiumStyleSheetActor(this, header);
    this.refMap.set(header.styleSheetId, header);
    return sheet;
  },

  getStyleSheets: asyncMethod(function*() {
    return this.sheets.getStyleSheets().map((header, i) => {
      let ref = this.sheetRef(header);
      ref.styleSheetIndex = i;
      return ref;
    });
  }, {
    request: {},
    response: {
      styleSheets: RetVal("array:chromium_stylesheet")
    }
  }),

  addStyleSheet: asyncMethod(function*(text) {
    let response = yield this.rpc.request("CSS.createStyleSheet", {
      frameId: this.tab.rootFrameId
    });
    yield this.rpc.request("CSS.setStyleSheetText", {
      styleSheetId: response.styleSheetId,
      text: text
    });

    return this.sheetRef(this.sheets.get(response.styleSheetId));
  }, {
    request: { text: Arg(0, "string") },
    response: { styleSheet: RetVal("chromium_stylesheet") }
  })
});
exports.ChromiumStyleSheetsActor = ChromiumStyleSheetsActor;
