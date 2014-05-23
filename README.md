Fever Dream
===========

This module doesn't work.  But you're curious, so I'm going to give you some
basic information.  Curiosity is good, it is how we move forward as a people.

This adds a button to your Firefox toolbar.  It's an icon that I took from
a sample addon Jeff Griffiths did.  I don't know where he got the icon.

Chrome
------

* Get the addon-sdk and activate it
* Get FirefoxNightly and make sure addon-sdk is using it.
* Start a recent Canary build with --remote-debugging-port=9222
* Navigate to the page you want to look at - I don't have navigation working yet.
* "cfx run"
  - use the -b option to point it at Firefox Nightly if necessary.
  - as of this writing, you also need to pass -o because of reasons.
* Press the little button that was added to your toolbar.

Troubleshooting:
* If you don't see a new toolbar button, something is broken.  Maybe console
spew will help.
* If you click on the toolbar button and nothing happens, you either
  - don't have canary running with --remote-debugging-port=9222 or
  - your canary isn't new enough[1]

Chrome on Android
-----------------

This is even more broken than chrome desktop right now.

* Same as above, but also turn on debugging and set up adb as described in
https://developer.chrome.com/devtools/docs/remote-debugging-legacy EXCEPT
use 9223 as your port, not 9222.  Because of reasons.

* It would be nice if we could figure out the new connection stuff chrome uses.
* run 'npm install' to add some of the extra crap we need for this next step
* run 'node proxy.js'
* Run the addon as usual, it should debug your chromium instance now.
* Read the code for proxy.js and curse my name.  Read [2] for more info.

Safari on iOS
-------------

* Same as the chrome setup, but install and run ios_webkit_debug_bridge.

Why did you start this project?
-------------------------------

If I answer that I won't actually get around to checking this file in.

Notes
-----

[1] There was a bug in chrome's websocket implementation that prevented
Firefox from connecting to it.  They fixed the bug quickly, but you need a
a recent canary.

[2] Same bug as [1], but the fix hasn't propagated to android yet, so proxy.js
just acts as a mediator between two websocket implementations that don't quite
get along.
