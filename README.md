Fever Dream
===========

This module doesn't work.  But you're curious, so I'm going to give you some
basic information.  Curiosity is good, it is how we move forward as a people.

This adds a button to your Firefox toolbar.  It's an icon that I took from
a sample addon Jeff Griffiths did.  I don't know where he got the icon.

Chrome
------

* Install jpm
-   npm install -g jpm
* Start a recent Canary build with --remote-debugging-port=9222
* Navigate to the page you want to look at - I don't have navigation working yet.
* "jpm run -v"
  - use the -b option to point it at a recent Firefox Nightly if necessary.
* Press the little button that was added to your toolbar.

Troubleshooting:
* If you don't see a new toolbar button, something is broken.  Maybe console
spew will help.
* If you click on the toolbar button and nothing happens, you either
  - don't have canary running with --remote-debugging-port=9222 or
  - your canary isn't new enough[1]

Chrome on Android
-----------------

* This currently only works on Chrome Beta on android (see [1]).
* Same as above, but also turn on debugging and set up adb as described in
https://developer.chrome.com/devtools/docs/remote-debugging-legacy

* It would be nice if we could figure out the new connection stuff chrome uses.
* Run the addon as usual, it should debug your chrome instance now.

Safari on iOS
-------------

Even more broken than Chrome on Android.

* Same as the chrome setup, but install and run ios_webkit_debug_bridge.

Why did you start this project?
-------------------------------

If I answer that I won't actually get around to checking this file in.

Notes
-----

[1] There was a bug in chrome's websocket implementation that prevented
Firefox from connecting to it.  They fixed the bug quickly, but you need a
a recent canary.
