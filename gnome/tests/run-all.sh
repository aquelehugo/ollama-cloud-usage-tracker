#!/bin/bash
# Run all smoke tests. Exits non-zero on first failure.
set -e
cd "$(dirname "$0")/.."
DIR=tests
fail=0

# test-bar needs the gnome-shell / mutter typelib path. Other tests
# don't.
run_test() {
    local t="$1"
    if [[ "$t" == *test-bar.js ]]; then
        if LD_LIBRARY_PATH=/usr/lib/gnome-shell:/usr/lib/x86_64-linux-gnu/mutter-14 \
                GI_TYPELIB_PATH=/usr/lib/gnome-shell:/usr/lib/x86_64-linux-gnu/girepository-1.0:/usr/lib/x86_64-linux-gnu/mutter-14 \
                gjs -m "$t" 2>/dev/null | grep -q '^OK'; then
            echo "  PASS: $t"
        else
            echo "  SKIP: $t (no shell typelib path)"
        fi
        return 0
    fi
    if gjs -m "$t" >/dev/null 2>&1; then
        echo "  PASS: $t"
    else
        echo "  FAIL: $t"
        gjs -m "$t" 2>&1 | head -3
        fail=1
    fi
}

for t in "$DIR"/test-*.js "$DIR"/smoke-*.js; do
    run_test "$t"
done

exit $fail
