function evalSomething() {
  eval("document.queryElement('body').style.backgroundColor = 'green'");
  var foo = "document.queryElement('body')" + ".style.backgroundColor = " + "#f06";
  eval(foo);
}

function debuggerStatement() {
  debugger;
  console.log("Got here!");
}
