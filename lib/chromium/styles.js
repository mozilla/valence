const protocol = require("devtools/server/protocol");
const {Actor, ActorClass, Pool, method, Arg, Option, RetVal, types} = protocol;
const {asyncMethod} = require("util/protocol-extra");
const task = require("util/task");

types.addActorType("chromium_domnode");

types.addDictType("chromium_appliedstyle", {
  rule: "chromium_domstylerule#actorid",
  inherited: "nullable:chromium_domnode"
});

const STYLE_RULE = 1;
const ELEMENT_RULE = 100;

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
  },

  get conn() { return this.inspector.conn; },
  get rpc() { return this.inspector.rpc; },

  styleRef: function(handle) {
    let key = JSON.stringify(handle);
    // XXX: hash that key.
    if (this.refMap.has(key)) {
      return this.refMap.get(key);
    }

    let rule = new ChromiumStyleRuleActor(this, handle);
    this.refMap.set(key, rule);
    return rule;
  },

  sheetRef: function(styleSheetId) {
    if (this.refMap.has(styleSheetId)) {
      return this.refMap.get(styleSheetId);
    };

    let actor = new ChromiumStyleSheetActor(this.conn, styleSheetId);
    this.manage(actor);
    this.refMap.set(styleSheetId, actor);
    return actor;
  },

  getApplied: asyncMethod(function*(node, options) {
    let response = yield this.rpc.request("CSS.getMatchedStylesForNode", {
      nodeId: node.handle.nodeId,
      includePseudo: true,
      inherited: options.inherited
    });

    let entries = [];
    let rules = new Set();
    let styleSheets = new Set();

    for (let match of response.matchedCSSRules || []) {
      let ruleHandle = match.rule;
      let matchingSelectors = match.matchingSelectors;
      let style = this.styleRef(ruleHandle);
      styleSheets.add(this.sheetRef(ruleHandle.styleSheetId));
      rules.add(style);

      entries.push({
        rule: style,
        matchedSelectors: [for (i of matchingSelectors) match.rule.selectorList.selectors[i].value ]
      });
    }

    // XXX: Deal with inherited rules.
    for (let match of response.inherited || []) {
//      rules.push(this.styleRef(match.rule));
     }

    return {
      entries: entries,
      sheets: [...styleSheets],
      rules: [...rules],
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
});
exports.ChromiumPageStyleActor = ChromiumPageStyleActor;

var ChromiumStyleSheetActor = protocol.ActorClass({
  typeName: "chromium_stylesheet",

  initialize: function(conn, styleSheetId) {
    Actor.prototype.initialize.call(this, conn);
    this.styleSheetId = styleSheetId;
  },

  form: function(detail) {
    if (detail === "actorid") {
      return this.actorID;
    }

    return {
      actor: this.actorID,
      href: "http://hellifiknow/foo.css",
      disabled: false,
      title: "a stylesheet",
      system: false,
      styleSheetIndex: -1
    }
  }
});

var ChromiumStyleRuleActor = protocol.ActorClass({
  typeName: "chromium_domstylerule",

  initialize: function(pageStyle, handle) {
    console.log("handle: " + handle);
    Actor.prototype.initialize.call(this, null);
    this.pageStyle = pageStyle;
    this.handle = handle;
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
      type: this.handle.styleSheetId ? STYLE_RULE : ELEMENT_RULE,
    }

    if (this.handle.styleSheetId) {
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

    form.selectors = [];
    for (let selector of this.handle.selectorList.selectors) {
      form.selectors.push(selector.value);
    }

    if (this.handle.cssText) {
      form.cssText = this.handle.cssText;
    } else {
      form.cssText = "";
      for (let property of this.style.cssProperties) {
        form.cssText += property.name + ": " + property.value;
        if (property.important) {
          form.cssText += " !important"
        }
        form.cssText += "; ";
      }
    }

    return form;
  }
});
