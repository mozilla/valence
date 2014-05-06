const hiddenFrames = require("sdk/frame/hidden-frame");
const promise = require("sdk/core/promise");

const win = require("sdk/addon/window");

exports.WebSocket = win.window.WebSocket;

// A hidden frame for getting a WebSocket constructor.
var framePromise = null;
function frame()
{
  if (framePromise) {
    return framePromise;
  }

  let deferred = promise.defer();

  hiddenFrames.add(hiddenFrames.HiddenFrame({
    onReady: function() {
      deferred.resolve(this.element.contentWindow);
    }
  }));

  framePromise = deferred.promise;
  return deferred.promise;
}

exports.createWebSocket = function(url, protocols) {
  return frame().then(win => {
    console.log("url is: " + url);
    return new win.WebSocket(url, protocols);
  });
}
