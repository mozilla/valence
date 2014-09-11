Firefox Developer Tools Adapter
===============================

This add-on provides the ability for you to debug various remote targets from the Firefox Developer Tools. The idea is that you can use one solid set of developer tools to debug all the things you need. This is the dream, anyhow. We're going to try and make this happen.

This module sort of works, but it probably won't do all the things you need to do as a web developer - yet.  You're curious though, so here is some basic information to get started.  Curiosity is good, it is how we move forward as a people.

How to Interact With The Thing
------------------------------

There are two ways to interact with this tool right now: a button, or some Developer Toolbar commands.

Running this stuff will add a (weirdly ambiguous) new icon to your browser. When you click it, it will attempt to connect the Firefox DevTools to whatever is on port 9222. For example, if you start an instance of Chrome Canary on port 9222 (use flag --remote-debugging-port=9222), it will try and connect to that.

If you want things to be a bit more automagical, use the commands `chrome`, `android` and `ios` from the Developer Toolbar. These should automatically launch a browser for you and connect appropriately - assuming you've met the installation requirements below.


Installation for All Y'all
------------------

Before you can build and run the extension, here are a few things you'll need to do:

1. `git clone git@github.com:campd/fxdt-adapters.git`

2. Make sure you have an updated copy of Firefox Nightly installed. If you need to install Nightly, you can get it [here](https://nightly.mozilla.org/).

3. Make sure you have node (and subsequently npm) installed. Instructions for that are [here](http://nodejs.org/download/).

4. Install jpm with `npm install -g jpm`. jpm is a node utility for developing browser add-ons.

Then from your extension folder you can use `jpm run -v`, with the`-b` option to use your recent Firefox Nightly, to run a new Firefox process with the extension installed.

Now that you've done that, you can follow the instructions below for each applicable debug target/browser.


Debugging Chrome on Desktop
-----------------

Clicking the button on the Firefox toolbar will connect to the debug target on port 9222.  To debug Chrome on Desktop, the process must have remote debugging enabled and set to this port.

The important flag is `--remote-debugging-port=9222`.  There is a page with information on how to [run the Chrome process with these flags](http://www.chromium.org/developers/how-tos/run-chromium-with-flags).

There are some other flags that can be helpful if you'd like to run this alongside another Chrome profile.  By running with `--no-first-run`, `--no-default-browser-check`, and `--user-data-dir` you can run this process alongside another Chrome profile.

For example, on OSX, you could run the following command to start a debuggable copy of Chrome:

    > /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222 --no-first-run --no-default-browser-check --user-data-dir=$(mktemp -d -t 'chrome-remote_data_dir')

If you click on the toolbar button and nothing happens, you most likely don't have anything running on port 9222.  Check the [Browser Console](https://developer.mozilla.org/en-US/docs/Tools/Browser_Console) to see what has gone wrong.

Debugging Chrome on Android
-----------------

In addition to the installation instructions, follow [these instructions](https://developer.chrome.com/devtools/docs/remote-debugging-legacy) to turn on remote debugging and set up adb.

* Note: It would be nice if we could figure out the new connection stuff chrome uses.

Debugging Safari on iOS
-------------

In addition to the installation instructions, you will need to enable developer support on your device. Follow the instructions on [this page](https://developer.apple.com/library/mac/documentation/AppleApplications/Conceptual/Safari_Developer_Guide/GettingStarted/GettingStarted.html) (in the "To enable Web Inspector on iOS" section) to get started.  Note: you can also use the iOS simulator if you have Xcode installed.

You will also need to install and run [ios_webkit_debug_proxy](https://github.com/google/ios-webkit-debug-proxy).

Run the debug bridge from the command line with `ios_webkit_debug_proxy`.

* Note: Even more broken than Chrome on Android, but whatever, we're going to roll with it and soon enough it will not be broken.

Why did you start this project?
-------------------------------

We realized that debugging individual browsers in their respective vendor silos is painful, frustrating, and at times downright demoralizing. We wanted to make better tools so that web developers are relieved of this anguish (as much as possible). You should test this thing as it becomes more stable, and let us know how we can make the cross-platform debugging experience better.

Notes
-----

Note that this project should be treated as _ALPHA_ software - implementation is far from finished.

The UI for interacting with this project will change soon - the commands will likely stick around but the ambiguous button in your browser will probably not. Eventually there will even be nicer buttons than any of this. Dare to dream.

If you notice that the install or usage instructions should be different, please help us by sending a PR for this README. This project is changing fast and so information here may be out of date.
