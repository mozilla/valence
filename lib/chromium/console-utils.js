const DevToolsUtils = require("../devtools/toolkit/DevToolsUtils");

// Provide an easy way to bail out of even attempting an autocompletion
// if an object has way too many properties. Protects against large objects
// with numeric values that wouldn't be tallied towards MAX_AUTOCOMPLETIONS.
const MAX_AUTOCOMPLETE_ATTEMPTS = exports.MAX_AUTOCOMPLETE_ATTEMPTS = 100000;

// Prevent iterating over too many properties during autocomplete suggestions.
const MAX_AUTOCOMPLETIONS = exports.MAX_AUTOCOMPLETIONS = 1500;

const STATE_NORMAL = 0;
const STATE_QUOTE = 2;
const STATE_DQUOTE = 3;

const OPEN_BODY = "{[(".split("");
const CLOSE_BODY = "}])".split("");
const OPEN_CLOSE_BODY = {
  "{": "}",
  "[": "]",
  "(": ")",
};

const noop = () => {};

/**
 * Analyses a given string to find the last statement that is interesting for
 * later completion.
 *
 * @param   string aStr
 *          A string to analyse.
 *
 * @returns object
 *          If there was an error in the string detected, then a object like
 *
 *            { err: "ErrorMesssage" }
 *
 *          is returned, otherwise a object like
 *
 *            {
 *              state: STATE_NORMAL|STATE_QUOTE|STATE_DQUOTE,
 *              startPos: index of where the last statement begins
 *            }
 */
function findCompletionBeginning(aStr)
{
  let bodyStack = [];

  let state = STATE_NORMAL;
  let start = 0;
  let c;
  for (let i = 0; i < aStr.length; i++) {
    c = aStr[i];

    switch (state) {
      // Normal JS state.
      case STATE_NORMAL:
        if (c == '"') {
          state = STATE_DQUOTE;
        }
        else if (c == "'") {
          state = STATE_QUOTE;
        }
        else if (c == ";") {
          start = i + 1;
        }
        else if (c == " ") {
          start = i + 1;
        }
        else if (OPEN_BODY.indexOf(c) != -1) {
          bodyStack.push({
            token: c,
            start: start
          });
          start = i + 1;
        }
        else if (CLOSE_BODY.indexOf(c) != -1) {
          var last = bodyStack.pop();
          if (!last || OPEN_CLOSE_BODY[last.token] != c) {
            return {
              err: "syntax error"
            };
          }
          if (c == "}") {
            start = i + 1;
          }
          else {
            start = last.start;
          }
        }
        break;

      // Double quote state > " <
      case STATE_DQUOTE:
        if (c == "\\") {
          i++;
        }
        else if (c == "\n") {
          return {
            err: "unterminated string literal"
          };
        }
        else if (c == '"') {
          state = STATE_NORMAL;
        }
        break;

      // Single quote state > ' <
      case STATE_QUOTE:
        if (c == "\\") {
          i++;
        }
        else if (c == "\n") {
          return {
            err: "unterminated string literal"
          };
        }
        else if (c == "'") {
          state = STATE_NORMAL;
        }
        break;
    }
  }

  return {
    state: state,
    startPos: start
  };
}

/**
 * Provides a list of properties, that are possible matches based on the passed
 * array of property descriptors and inputValue.
 *
 * @param object aRpc
 *        The RPC request handler for communications via the external protocol.
 * @param array aPropDescArray
 *        An array of property descriptors from the original object.
 * @param string aInputValue
 *        Value that should be completed.
 * @param number [aCursor=aInputValue.length]
 *        Optional offset in the input where the cursor is located. If this is
 *        omitted then the cursor is assumed to be at the end of the input
 *        value.
 * @returns null or object
 *          If no completion valued could be computed, null is returned,
 *          otherwise a object with the following form is returned:
 *            {
 *              matches: [ string, string, string ],
 *              matchProp: Last part of the inputValue that was used to find
 *                         the matches-strings.
 *            }
 */
function* JSPropertyProvider(aRpc, aPropDescArray, aInputValue, aCursor)
{
  if (aCursor === undefined) {
    aCursor = aInputValue.length;
  }

  let inputValue = aInputValue.substring(0, aCursor);

  // Analyse the inputValue and find the beginning of the last part that
  // should be completed.
  let beginning = findCompletionBeginning(inputValue);

  // There was an error analysing the string.
  if (beginning.err) {
    return null;
  }

  // If the current state is not STATE_NORMAL, then we are inside of an string
  // which means that no completion is possible.
  if (beginning.state != STATE_NORMAL) {
    return null;
  }

  let completionPart = inputValue.substring(beginning.startPos);

  // Don't complete on just an empty string.
  if (completionPart.trim() == "") {
    return null;
  }

  let lastDot = completionPart.lastIndexOf(".");
  if (lastDot > 0 &&
      (completionPart[0] == "'" || completionPart[0] == '"') &&
      completionPart[lastDot - 1] == completionPart[0]) {
    // We are completing a string literal.
    let matchProp = completionPart.slice(lastDot + 1);

    let { result: stringProto } = yield aRpc.request("Runtime.evaluate", {
      expression: "String.prototype"
    });

    let { result: propDescArray } = yield aRpc.request("Runtime.getProperties", {
      objectId: stringProto.objectId,
      ownProperties: true
    });

    return getMatchedPropsInObject(propDescArray, matchProp);
  }

  // We are completing a variable / a property lookup.
  let properties = completionPart.split(".");
  let matchProp = properties.pop().trimLeft();

  // TODO: make it work for properties as well.

  return getMatchedPropsInObject(aPropDescArray, matchProp);
}

/**
 * Get all properties in the given object (and its parent prototype chain) that
 * match a given prefix.
 *
 * @param mixed aObj
 *        Object whose properties we want to filter.
 * @param string aMatch
 *        Filter for properties that match this string.
 * @return object
 *         Object that contains the matchProp and the list of names.
 */
function getMatchedProps(aObj, aMatch)
{
  if (typeof aObj != "object") {
    aObj = aObj.constructor.prototype;
  }
  let propDescArray = Object.getOwnPropertyNames(aObj).map(name => {
    let desc = Object.getOwnPropertyDescriptor(aObj, name);
    desc.name = name;
    return desc;
  });
  return getMatchedPropsInObject(propDescArray, aMatch);
}

/**
 * Get all properties in the given array of property descriptors that match a
 * given prefix.
 *
 * @param array propDescArray
 *        An array of property descriptors from the original object.
 * @param string aMatch
 *        Filter for properties that match this string.
 * @return object
 *         Object that contains the matchProp and the list of names.
 */
function getMatchedPropsInObject(propDescArray, aMatch)
{
  let matches = new Set();
  let numProps = 0;

  // TODO: We need to go up the prototype chain.
  let props = propDescArray.map(e => e.name);
  numProps += props.length;

  for (let i = 0; i < props.length; i++) {
    let prop = props[i];
    if (prop.indexOf(aMatch) != 0) {
      continue;
    }

    // If it is an array index, we can't take it.
    // This uses a trick: converting a string to a number yields NaN if
    // the operation failed, and NaN is not equal to itself.
    if (+prop != +prop) {
      matches.add(prop);
    }

    if (matches.size >= MAX_AUTOCOMPLETIONS) {
      break;
    }
  }

  return {
    matchProp: aMatch,
    matches: [...matches],
  };
}

exports.JSPropertyProvider = DevToolsUtils.makeInfallible(JSPropertyProvider);

/**
 * JSTerm helper functions.
 *
 * Defines a set of functions ("helper functions") that are available from the
 * Web Console but not from the web page.
 *
 * A list of helper functions used by Firebug can be found here:
 *   http://getfirebug.com/wiki/index.php/Command_Line_API
 *
 * @param object aOwner
 *        The owning object.
 */
function JSTermHelpers(aOwner)
{
  aOwner.sandbox.$ = noop;
  aOwner.sandbox.$$ = noop;
  aOwner.sandbox.$_ = noop; // TODO: this probably needs local implementation.
  aOwner.sandbox.$0 = noop;
  aOwner.sandbox.$1 = noop;
  aOwner.sandbox.$2 = noop;
  aOwner.sandbox.$3 = noop;
  aOwner.sandbox.$4 = noop;
  aOwner.sandbox.$x = noop;
  aOwner.sandbox.clear = noop;
  aOwner.sandbox.copy = noop;
  aOwner.sandbox.debug = noop;
  aOwner.sandbox.dir = noop;
  aOwner.sandbox.dirxml = noop;
  aOwner.sandbox.inspect = noop;
  aOwner.sandbox.getEventListeners = noop;
  aOwner.sandbox.keys = noop;
  aOwner.sandbox.monitor = noop;
  aOwner.sandbox.monitorEvents = noop;
  aOwner.sandbox.profile = noop;
  aOwner.sandbox.profileEnd = noop;
  aOwner.sandbox.table = noop;
  aOwner.sandbox.undebug = noop;
  aOwner.sandbox.unmonitor = noop;
  aOwner.sandbox.unmonitorEvents = noop;
  aOwner.sandbox.values = noop;
}

exports.JSTermHelpers = JSTermHelpers;
