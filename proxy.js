var WebSocket = require('ws');
var http = require('http');
var request = require('request');
var url = require("url");

var server = http.createServer(function (req, res) {
  var path = url.parse(req.url).pathname
  console.log("REQUEST: " + path);
  request('http://localhost:9223' + path, function (error, response, body) {
    if (!error) {
      body = body.replace(/9223/gi, "9224");
      res.writeHead(response.statusCode, response.headers);
      res.end(body);
    }
  });
}).listen(9222);

var wss = new WebSocket.Server({
  port: 9224
});

wss.on('connection', function(ws) {
  console.log("web socket connection on: " + ws.upgradeReq.url);

  var childName = "ws://localhost:9223" + url.parse(ws.upgradeReq.url).pathname;
  console.log("conencting to " + childName);
  var childSocket = new WebSocket(childName);


  var queued = [];

  ws.on('message', function(message) {
    console.log("forwarding " + message + " client->phone")

    if (queued === undefined) {
      childSocket.send(message);
    } else {
      queued.push(message);
    }
  });

  childSocket.on('open', function() {
    for (var i = 0; i < queued.length; i++) {
      console.log("forwarding queued" + queued[i] + " client->phone");
      childSocket.send(queued[i]);
    }
    queued = undefined;

    console.log("opened connection!");
    childSocket.on('message', function(message) {
      console.log("forwarding " + message + " phone->client");
      ws.send(message);
    })
  });
});

