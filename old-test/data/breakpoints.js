function evalSomething() {
  eval("document.queryElement('body').style.backgroundColor = 'green'");
  var foo = "document.queryElement('body')" + ".style.backgroundColor = " + "#f06";
  eval(foo);
}

function debuggerStatement() {
  debugger;
  console.log("Got here!");
}

function debugDeeply() {
  console.log("c");
  console.log("d");
}

function debugMe() {
  console.log("a");
  console.log("b");
  debugDeeply();
  console.log("e");
}
