Web Anywhere (Fever Dream)
===========

This add-on provides the ability for you to debug various remote targets from the Firefox Developer Tools. The idea is that you can use one solid set of developer tools to debug all the things you need. This is the dream, anyhow. We're going to try and make this happen.

This module sort of works, but it probably won't do all the things you need to do as a web developer - yet.  You're curious though, so here is some basic information to get started.  Curiosity is good, it is how we move forward as a people.

How to Interact With The Thing
------------------------------

There are two ways to interact with this tool right now: a button, or some Developer Toolbar commands.

Running this stuff will add a (weirdly ambiguous) new icon to your browser. When you click it, it will attempt to connect the Firefox DevTools to whatever is on port 9222. For example, if you start an instance of Chrome Canary on port 9222 (use flag --remote-debugging-port=9222), it will try and connect to that.

If you want things to be a bit more automagical, use the commands `chrome`, `android` and `ios` from the Developer Toolbar. These should automatically launch a browser for you and connect appropriately - assuming you've met the installation requirements below.


Installation for All Y'all
------------------

You should have a copy of Firefox Nightly installed, as well as node (and subsequently npm). Then:

1. Make sure you have an updated copy of Firefox Nightly installed. If you need to install Nightly, you can get it [here](https://nightly.mozilla.org/).

2. Make sure you have node (and subsequently npm) installed. Instructions for that are [here](http://nodejs.org/download/).

3. Install jpm with `npm install -g jpm`. jpm is a node utility for developing browser add-ons.

4. Follow instructions below for each applicable debug target/browser.

Debugging Chrome on Desktop
-----------------

Use the button to connect to a suitable debug target on port 9222, .
`jpm run -v"`
_Note_: use the -b option to point it at a recent Firefox Nightly if necessary.

Open the developer toolbar and execute the `chrome` command, or if you have Chrome waiting on port 9222, click the toolbar button.

If you click on the toolbar button and nothing happens, you either don't have have something running on port 9222, or your canary isn't new enough[1]

Debugging Chrome on Android
-----------------

This currently only works on Chrome Beta on Android. There was a bug in chrome's websocket implementation that prevented Firefox from connecting to it.  They fixed the bug quickly, but you need a recent canary.

In addition to the instructions for Chrome Desktop above, turn on debugging and set up adb as described in https://developer.chrome.com/devtools/docs/remote-debugging-legacy

* It would be nice if we could figure out the new connection stuff chrome uses.

Debugging Safari on iOS
-------------

Even more broken than Chrome on Android, but whatever, we're going to roll with it and soon enough it will not be broken.

Follow the setup for Chrome Desktop above, but also install and run [ios_webkit_debug_proxy](https://github.com/google/ios-webkit-debug-proxy).

Run the debug bridge from the command line with `ios_webkit_debug_proxy`.

Why did you start this project?
-------------------------------

We realized that debugging individual browsers in their respective vendor silos is painful, frustrating, and at times downright demoralizing. We wanted to make better tools so that web developers are relieved of this anguish (as much as possible). You should test this thing as it becomes more stable, and let us know how we can make the cross-platform debugging experience better.

Notes
-----

Note that this project should be treated as _ALPHA_ software - implementation is far from finished.

The UI for interacting with this project will change soon - the commands will likely stick around but the ambiguous button in your browser will probably not. Eventually there will even be nicer buttons than any of this. Dare to dream.

If you notice that the install or usage instructions should be different, please help us by sending a PR for this README. This project is changing fast and so information here may be out of date.
