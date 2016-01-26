const {Cc, Ci, Cu} = require("chrome");

const protocol = require("../devtools-require")("devtools/server/protocol");
const {Actor, method, Arg, Option, RetVal, emit} = protocol;
const {asyncMethod, todoMethod, todoMethodSilent, types} = require("../util/protocol-extra");
const {LongStringActor} = require("../devtools-require")("devtools/server/actors/string");
const {CssLogic} = require("../devtools-require")("devtools/shared/styleinspector/css-logic");
const task = require("../util/task");

protocol.types.addActorType("chromium_domnode");
protocol.types.addActorType("chromium_domstylerule");

types.addDictType("chromium_appliedstyle", {
  rule: "chromium_domstylerule#actorid",
  inherited: "nullable:chromium_domnode#actorid"
});

types.addDictType("chromium_matchedselector", {
  rule: "chromium_domstylerule#actorid",
  selector: "string",
  value: "string",
  status: "number"
});

const STYLE_RULE = 1;
const ELEMENT_RULE = 100;
// Maps pseudoIds to actual pseudo elements names.
// See RenderStyleConstants.h in webkit.
const PSEUDO_ID_MAPPING = [
  "",
  ":first-line",
  ":first-letter",
  ":before",
  ":after",
  ":selection"
];

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

  setPropertyText: task.async(function*(rule, prop, value={}) {
    // If this is updating an existing property, provide the range of that
    // property so it can be replaced. Otherwise define an empty range for the
    // insertion point if this is a new property.
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

    // Actually set the new property text (depends on the protocol capabilities)
    let response;
    if (this.protocolStyle === "new") {
      response = yield this.setPropertyTextRequestNew(rule, prop, range, value);
    } else {
      response = yield this.setPropertyTextRequestOld(rule, prop, range, value);
    }

    this.updateStyleRef(rule, response.style);
  }),

  buildPropertyTextValue: function(value) {
    // XXX: Handle !important properties
    if (!value || !value.name || !value.value) {
      return "";
    }
    let text = value.name + ":" + value.value;
    if (value.priority === "important") {
      text += " !important";
    }
    text += ";";
    return text;
  },

  setPropertyTextRequestNew: function(rule, prop, range, value) {
    return this.rpc.request("CSS.setPropertyText", {
      styleSheetId: rule.style.styleSheetId,
      range: range,
      text: this.buildPropertyTextValue(value)
    });
  },

  setPropertyTextRequestOld: function(rule, prop, range, value) {
    return this.rpc.request("CSS.setPropertyText", {
      styleId: rule.style.styleId,
      propertyIndex: prop ? prop.index : 0,
      text: this.buildPropertyTextValue(value),
      overwrite: !!prop
    });
  },

  getComputed: asyncMethod(function*(node, options) {
    // For onlyMatched properties, we need to know all the applied rules
    // properties so we can filter computed styles.
    let matchingPropertyNames = new Set;

    if (options.onlyMatched) {
      let {entries} = yield this.getApplied(node, {filter: options.filter});
      let domUtils = DOMUtils();

      for (let entry of entries) {
        if (entry.pseudoElement) {
          continue;
        }

        // For each matching rule, get the whole list of property names + their
        // sub property names too.
        for (let property of entry.rule.style.cssProperties) {
          matchingPropertyNames.add(property.name);
          // getSubpropertiesForCSSProperty throws for unsuported property names
          // which will happen for unknown vendor-prefixed properties.
          let subProperties = [];
          try {
            subProperties = domUtils.getSubpropertiesForCSSProperty(property.name);
          } catch (e) {}
          for (let subProperty of subProperties) {
            matchingPropertyNames.add(subProperty);
          }
        }
      }
    }

    let {computedStyle} = yield this.rpc.request("CSS.getComputedStyleForNode", {
      nodeId: node.handle.nodeId
    });

    computedStyle = computedStyle.filter(({name, value}) => {
      // Filter down the list if asked to
      return options.onlyMatched ? matchingPropertyNames.has(name) : true;
    });

    let ret = {};
    for (let {name, value} of computedStyle) {
      // XXX: matched depends on the markMatched option which we ignore for now
      ret[name] = {value, matched: true};
    }
    return ret;
  }, {
    request: {
      node: Arg(0, "chromium_domnode"),
      markMatched: Option(1, "boolean"), // XXX ignored for now
      onlyMatched: Option(1, "boolean"),
      filter: Option(1, "string")
    },
    response: {
      computed: RetVal("json")
    }
  }),

  getMatchedSelectors: asyncMethod(function*(node, property, options) {
    // Not interested in the rules and sheets normally returned by getApplied
    // since we will filter down the matching entries and get rules and sheets
    // from there instead.
    let {entries} = yield this.getApplied(node, options);

    let matched = [];
    let rules = new Set;
    let sheets = new Set;

    let foundBestMatch = false;

    for (let entry of entries) {
      // Skip pseudo-element matches
      if (entry.pseudoElement) {
        continue;
      }

      // Only care about the provided property
      let matchedProperties = entry.rule.style.cssProperties.filter(p => {
        return p.name === property;
      });
      if (!matchedProperties.length) {
        continue;
      }
      let matchedProperty = matchedProperties[0];

      // Rules are sorted, consider the first match as the best match.
      let status = entry.inherited ? CssLogic.STATUS.PARENT_MATCH : CssLogic.STATUS.MATCHED;
      if (!foundBestMatch) {
        status = CssLogic.STATUS.BEST;
        foundBestMatch = true;
      }

      matched.push({
        rule: entry.rule,
        sourceText: entry.matchedSelectors[0],
        selector: entry.matchedSelectors[0],
        name: matchedProperty.name,
        value: matchedProperty.value,
        status: status
      });

      rules.add(entry.rule);
      if (entry.rule.handle.styleSheetId) {
        sheets.add(this.sheetRef(entry.rule.handle.styleSheetId));
      }
    }

    return {
      matched: matched,
      rules: [...rules],
      sheets: [...sheets]
    };
  }, {
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
  }, "getMatchedSelectors"),

  getApplied: asyncMethod(function*(node, options) {
    let result = {
      entries: [],
      sheets: new Set(),
      rules: new Set()
    };

    // Helper function that adds matches, rules and sheets to the result object.
    let addStyle = (rule, matchingSelectors, pseudoElement, inherited) => {
      let isSystem = rule.handle.origin == "user-agent";
      if (isSystem && options.filter != "ua") {
        return;
      }

      let matchedSelectors = [];
      if (matchingSelectors && rule.handle.selectorList) {
        for (let i of matchingSelectors) {
          let selector = rule.handle.selectorList.selectors[i];
          matchedSelectors.push(selector.value || selector);
        }
      }

      result.entries.push({rule, matchedSelectors, pseudoElement, inherited});
      if (rule.handle.styleSheetId) {
        result.sheets.add(this.sheetRef(rule.handle.styleSheetId));
      }
      result.rules.add(rule);
    }

    // Retrieve the node's inline styles first.
    let {inlineStyle} = yield this.rpc.request("CSS.getInlineStylesForNode", {
      nodeId: node.handle.nodeId
    });
    let rule = this.styleRef({ style: inlineStyle });
    rule.type = ELEMENT_RULE;
    addStyle(rule);

    // Retrieve the matched styles for the node + inherited styles + pseudos,
    // all at once.
    let {matchedCSSRules, inherited, pseudoElements} = yield this.rpc.request(
      "CSS.getMatchedStylesForNode", {
      nodeId: node.handle.nodeId,
      // The iOS protocol requires explicit include for pseudos and inherited
      // styles, while the chrome protocol requires explicit excludes.
      includePseudo: true,
      includeInherited: true
    });

    // Process matched styles
    for (let match of matchedCSSRules.reverse() || []) {
      let ruleHandle = match.rule;
      let rule = this.styleRef(ruleHandle);
      addStyle(rule, match.matchingSelectors);
    }

    // Inherited styles
    let inheritedParent = node;
    for (let {matchedCSSRules} of inherited) {
      inheritedParent = inheritedParent.parent;
      for (let match of matchedCSSRules.reverse() || []) {
        let ruleHandle = match.rule;
        let rule = this.styleRef(ruleHandle);
        addStyle(rule, match.matchingSelectors, null, inheritedParent);
      }
    }

    // Pseudo elements
    for (let {matches, pseudoId} of pseudoElements) {
      let pseudoName = PSEUDO_ID_MAPPING[pseudoId] || "";
      for (let match of matches) {
        let ruleHandle = match.rule;
        let rule = this.styleRef(ruleHandle);
        addStyle(rule, match.matchingSelectors, pseudoName);
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

  getLayoutFromBoxModel: function(model) {
    function readQuad(quad) {
      return {
        TL: { x: quad[0], y: quad[1] },
        TR: { x: quad[2], y: quad[3] },
        BR: { x: quad[4], y: quad[5] },
        BL: { x: quad[6], y: quad[7] },
      }
    }

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
  },

  getLayoutFromComputedStyle: function*(node, computedStyle) {
    let layout = {};

    // Determine the content box width and height
    let properties = yield node.callFunction(
      "function() {return this.getBoundingClientRect()}");
    properties.forEach(({name, value}) => {
      if (name === "width" || name === "height") {
        layout[name] = Math.round(value.value);
      }
    });

    for (let prop of [
      "position",
      "margin-top",
      "margin-right",
      "margin-bottom",
      "margin-left",
      "padding-top",
      "padding-right",
      "padding-bottom",
      "padding-left",
      "border-top-width",
      "border-right-width",
      "border-bottom-width",
      "border-left-width"
    ]) {
      layout[prop] = getComputedStyleValue(computedStyle, prop);
    }

    // XXX: auto margins.
    layout.autoMargins = {};

    return layout;
  },

  getLayout: asyncMethod(function*(node) {
    // iOS doesn't support the DOM.getBoxModel request, so on iOS we use
    // getComputedStyleForNode (which is what WebkitInspector does too).
    try {
      let response = yield this.rpc.request("DOM.getBoxModel", {
        nodeId: node.handle.nodeId,
      });

      return this.getLayoutFromBoxModel(response.model);
    } catch (e) {
      let response = yield this.rpc.request("CSS.getComputedStyleForNode", {
        nodeId: node.handle.nodeId
      });

      return yield this.getLayoutFromComputedStyle(node, response.computedStyle);
    }
  }, {
    request: {
      node: Arg(0, "chromium_domnode"),
      autoMargins: Option(1, "boolean")
    },
    response: RetVal("json")
  }),

  /**
   * Create a new stylesheet in the node's owner document to add new rules.
   * Note that the RPC command used here doesn't work with the ios protocol,
   * but this isn't a problem because the addRule command creates its own
   * special stylesheet on ios.
   */
  createHelperStylesheet: task.async(function*(node) {
    let frameId = undefined;
    while (!frameId && node) {
      frameId = node.handle.frameId;
      node = node.parent;
    }
    if (!frameId) {
      frameId = this.inspector.tab.rootFrameId;
    }
    let response = {};
    try {
      response = yield this.rpc.request("CSS.createStyleSheet", {
        frameId: frameId
      });
    } catch (e) {}
    return response.styleSheetId;
  }),

  getHelperStylesheet(node) {
    if (!this.helperStylesheetPromise) {
      this.helperStylesheetPromise = this.createHelperStylesheet(node);
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
      selector = "." + className.split(" ")[0];
    } else {
      selector = node.handle.nodeName.toLowerCase();
    }

    let location = { startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 };

    let helperSheetId = yield this.getHelperStylesheet(node);
    let ruleText = selector + " {}";

    let response;
    if (helperSheetId) {
      // helperSheetId exists, we're talking to Chrome's protocol that requires
      // a stylesheet to insert a new rule.
      response = yield this.rpc.request("CSS.addRule", {
        styleSheetId: helperSheetId,
        ruleText: ruleText,
        location: location
      });
    } else {
      // Otherwise, use iOS' CSS.addRule's signature which doesn't require a
      // stylesheet and will create one itself.
      response = yield this.rpc.request("CSS.addRule", {
        contextNodeId: node.handle.nodeId,
        selector: selector
      });
      helperSheetId = response.rule.style.styleId.styleSheetId;

      // However, do force a sheet-store update since iOS doesn't send events
      // when new stylesheets are created.
      yield this.sheets.getStyleSheets();
    }

    let rule = this.styleRef(response.rule);

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
  }, "toggleDisabled"),

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
      // originalSources: RetVal("nullable:array:originalsource")
    }
  }, "getOriginalSources"),

  getOriginalLocation: method(function(line, column) {
    // XXX return original location for source maps
    return {
      line: line,
      column: column,
      source: this.header.sourceURL
    }
  }, {
    request: {
      line: Arg(0, "number"),
      column: Arg(1, "number")
    },
    response: RetVal(types.addDictType("chromium_originallocationresponse", {
      source: "string",
      line: "number",
      column: "number"
    }))
  }, "getOriginalLocation"),

  getMediaRules: todoMethod({
    request: {},
    response: {
      // mediaRules: RetVal("nullable:array:mediarule")
    }
  }, "getMediaRules"),

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

    let styleSheetId = this.handle.style.styleSheetId;
    if (styleSheetId && this.handle.selectorList) {
      let start = this.handle.selectorList.selectors[0];
      form.line = start.startLine;
      form.column = start.startColumn;
    }

    if (this.handle.parent) {
      form.parentRule = undefined;
    }

    if (styleSheetId) {
      form.parentStyleSheet = this.pageStyle.sheetRef(styleSheetId).actorID;
    }

    if (this.handle.sourceURL) {
      form.href = this.handle.sourceURL;
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
      if (prop.name === mod.name) {
        foundProp = prop;
        // The old CSS.setPropertyText implementation requires the property
        // index to work, so let's set it here.
        foundProp.index = index;
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
      yield this.pageStyle.setPropertyText(this, foundProp);
    }
  }),

  modifySelector: todoMethod({
    request: { selector: Arg(0, "string") },
    response: { isModified: RetVal("boolean") },
  }, "modifySelector"),
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
    let sheets = yield this.sheets.getStyleSheets();
    return sheets.map((header, i) => {
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

function getComputedStyleValue(computedStyle, propertyName) {
  for (let {name, value} of computedStyle) {
    if (propertyName === name) {
      return value;
    }
  }
  return "";
}
