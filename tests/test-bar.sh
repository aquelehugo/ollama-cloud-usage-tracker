#!/bin/bash
# Run the bar test with the right typelib and library paths. The
# gnome-shell St/Clutter/Meta typelibs live in /usr/lib/gnome-shell
# and the corresponding shared libraries in /usr/lib/gnome-shell
# and /usr/lib/x86_64-linux-gnu/mutter-14.
set -e
cd "$(dirname "$0")/.."
LD_LIBRARY_PATH=/usr/lib/gnome-shell:/usr/lib/x86_64-linux-gnu/mutter-14 \
GI_TYPELIB_PATH=/usr/lib/gnome-shell:/usr/lib/x86_64-linux-gnu/girepository-1.0:/usr/lib/x86_64-linux-gnu/mutter-14 \
    gjs -m tests/test-bar.js
