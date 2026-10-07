# Ollama Cloud Usage — monorepo build tooling
#
# Layout (see top-level README.md):
#   cli/    source of truth for the usage pipeline (gjs modules)
#   gnome/  GNOME Shell extension; imports cli/ via the gnome/cli symlink
#   dist/   build output (extension zips)
#
# Targets:
#   make test           run the gnome/ test suite
#   make schemas        (re)compile GSettings schemas
#   make install        install the GNOME extension as a symlink to the repo
#   make enable         enable the GNOME extension via gnome-extensions
#   make zip            build a distributable GNOME extension zip (bakes cli/ in)
#   make bin            ~/.local/bin wrapper for the CLI (used by plasma discovery)
#   make install-plasma install the Plasma widget (kpackagetool5 copy)
#   make panel-add      place the Plasma widget on the first panel
#   make panel-remove   remove Plasma widget instance(s) from panels/desktops
#   make uninstall-plasma  kpackagetool5 removal (run panel-remove first)
#   make zip-plasma     build a distributable Plasma package zip
#   make test-plasma    node unit tests for the Plasma widget helpers
#   make clean          remove build output

UUID               := ollama-cloud-usage-tracker@aquelehugo.github.io
ROOT               := $(CURDIR)
GNOME              := $(ROOT)/gnome
CLI                := $(ROOT)/cli
PLASMA             := $(ROOT)/plasma
PLASMA_ID          := ollama.cloud.usage.tracker
DIST               := $(ROOT)/dist
EXTROOT            := $(HOME)/.local/share/gnome-shell/extensions
EXTDIR             := $(EXTROOT)/$(UUID)
PLASMAROOT         := $(HOME)/.local/share/plasma/plasmoids
INSTALLEDPLASMA    := $(PLASMAROOT)/$(PLASMA_ID)
SCHEMAXML           := $(GNOME)/schemas/org.gnome.shell.extensions.ollama-cloud-usage-tracker.gschema.xml

.PHONY: help test schemas install enable zip clean bin install-plasma uninstall-plasma panel-add panel-remove zip-plasma test-plasma check-deps

# Verify the shared CLI core can actually run on this machine: shell
# binaries and the GJS typelibs (GLib/Gio/Soup/Secret) the CLI needs.
# Friendly, per-item reporting with install hints. Fails make on problems.
check-deps:
	@missing=""; \
	for b in gjs python3 openssl; do \
		command -v $$b >/dev/null 2>&1 || { echo "MISSING: $$b"; missing="$$missing $$b"; }; \
	done; \
	if command -v gjs >/dev/null 2>&1; then \
		tmp=$$(mktemp /tmp/ollama-depcheck-XXXXXX.js); \
		printf 'import GLib from "gi://GLib"; import Gio from "gi://Gio"; import Soup from "gi://Soup"; import Secret from "gi://Secret"; print("typelibs OK");\n' > "$$tmp"; \
		if ! gjs -m "$$tmp" >/dev/null 2>&1; then \
			echo "MISSING: gjs GIO typelibs (libsecret-1 / libsoup3 introspection)"; \
			echo "  → Debian/Ubuntu: sudo apt install gjs libsecret-1-0 libsoup-3.0-0"; \
			missing="$$missing gjs-typelibs"; \
		fi; \
		rm -f "$$tmp"; \
	else \
		echo "MISSING: gjs — the shared usage core (cli/) is a gjs program"; \
		echo "  → Debian/Ubuntu: sudo apt install gjs libsecret-1-0"; \
	fi; \
	if [ -n "$$missing" ]; then echo "Fix the above, then re-run."; exit 1; fi; \
	echo "Deps OK: gjs (GLib/Gio/Soup/Secret typelibs), python3, openssl"

help:
	@sed -n '2,19p' Makefile

test:
	cd $(GNOME) && bash tests/run-all.sh

schemas: $(SCHEMAXML)
	glib-compile-schemas $(GNOME)/schemas

# Install for development: the extensions dir holds a symlink to the
# repo checkout, so edits take effect on the next shell reload ("make
# install" again does nothing stale). The runtime needs the shared
# modules relative to the extension dir — that resolves through
# gnome/cli -> ../cli inside the checkout.
install: schemas
	@mkdir -p $(EXTROOT); \
	if [ -L "$(EXTDIR)" ]; then \
		rm -f "$(EXTDIR)"; \
	elif [ -e "$(EXTDIR)" ]; then \
		bak="$(EXTDIR).bak-$$(date +%Y%m%d%H%M%S)"; \
		echo "Existing directory-copy install found; moving to $$bak"; \
		mv "$(EXTDIR)" "$$bak"; \
	fi; \
	ln -s "$(GNOME)" "$(EXTDIR)"; \
	echo "Installed: $(EXTDIR) -> $(GNOME)"; \
	echo "If it was already running, restart GNOME Shell (Wayland: log out/in; X11: Alt+F2 → r)"

enable:
	gnome-extensions enable $(UUID)

# Distribution bundle. The extension zip must be self-contained, so the
# shared cli/ modules are baked in at the path gnome/scraper.js imports:
# <extdir>/cli/usage.js. Tests are dev-only and stay out of the zip.
zip: schemas
	@mkdir -p $(DIST); \
	stage=$$(mktemp -d); \
	trap 'rm -rf $$stage' EXIT; \
	ext=$$stage/$(UUID); \
	mkdir -p $$ext/cli; \
	cp $(GNOME)/bar.js $(GNOME)/extension.js $(GNOME)/metadata.json \
		$(GNOME)/prefs.js $(GNOME)/scraper.js $(GNOME)/README.md \
		$(GNOME)/LICENSE $$ext/; \
	cp -r $(GNOME)/schemas $$ext/schemas; \
	cp -L $(CLI)/usage.js $(CLI)/cookies.js $(CLI)/crypto.js $(CLI)/pbkdf2.js $$ext/cli/; \
	( cd $$ext && zip -q -r $(DIST)/$(UUID).zip . ); \
	echo "Built $(DIST)/$(UUID).zip:"; \
	unzip -l $(DIST)/$(UUID).zip

clean:
	rm -rf $(DIST)

# ---------------------------------------------------------------------------
# Plasma widget (plasma/)
# ---------------------------------------------------------------------------

# Put the CLI on ~/.local/bin so the Plasma widget (and everything else)
# can find it by PATH even outside the repo checkout.
#
# This is a wrapper script, NOT a symlink: gjs's ESM loader derives the
# import base directory from the module's own path, and a .js-less name
# makes './usage.js' resolve to <dir>/usage.js (missing). Gjs needs the
# real .js path via -m (verified live from the Plasma tray).
bin:
	mkdir -p $(HOME)/.local/bin
	chmod +x $(CLI)/ollama-usage.js
	rm -f $(HOME)/.local/bin/ollama-usage
	printf '#!/bin/sh\nexec gjs -m "$(CLI)/ollama-usage.js" "$$@"\n' > $(HOME)/.local/bin/ollama-usage
	chmod +x $(HOME)/.local/bin/ollama-usage
	@echo "Installed CLI wrapper: $(HOME)/.local/bin/ollama-usage -> gjs -m $(CLI)/ollama-usage.js"

# Dev install — ONE command covers everything:
#   1. dependency check (fails with install hints if gjs/python3/openssl/
#      GIO typelibs are missing)
#   2. CLI wrapper at ~/.local/bin/ollama-usage (bin)
#   3. package copy via kpackagetool5 (+ hicolor icon)
#   4. a cli/ COPY baked inside the installed package, so the widget's
#      CLI auto-detect works even with a clean PATH (KPackage discovery
#      ignores symlinked plasmoid dirs — verified live; build-artefact
#      duplication is allowed by the source-of-truth rule)
# Re-run after edits; it upgrades the installed copy.
install-plasma: check-deps bin
	kpackagetool5 -t Plasma/Applet -u $(PLASMA) 2>/dev/null \
		|| kpackagetool5 -t Plasma/Applet -i $(PLASMA)
	@icdir="$(HOME)/.local/share/icons/hicolor/192x192/apps"; \
	mkdir -p "$$icdir"; \
	if command -v convert >/dev/null 2>&1; then \
		convert $(PLASMA)/contents/images/ollama-icon.png -resize 192x192 "$$icdir/ollama-cloud-usage.png"; \
	else \
		cp $(PLASMA)/contents/images/ollama-icon.png "$$icdir/ollama-cloud-usage.png"; \
	fi; \
	mkdir -p "$(INSTALLEDPLASMA)/cli"; \
	cp -L $(CLI)/ollama-usage.js $(CLI)/usage.js $(CLI)/cookies.js \
		$(CLI)/crypto.js $(CLI)/pbkdf2.js "$(INSTALLEDPLASMA)/cli/"; \
	echo "Installed $(PLASMA_ID) (kpackagetool5 copy + in-package cli/ + hicolor icon)"; \
	echo "Place it on a panel: make panel-add (or right-click panel → Add Widgets)"

uninstall-plasma:
	@kpackagetool5 -t Plasma/Applet -r $(PLASMA_ID)
	@echo "Note: uninstalling the package does not purge placement entries —"
	@echo "use 'make panel-remove' first if the widget is on a panel."

# Idempotent: adds to the first panel only if no instance exists yet.
panel-add:
	@kpackagetool5 -t Plasma/Applet -l 2>/dev/null | grep -q "^$(PLASMA_ID)" \
		|| { echo "Package not installed — run 'make install-plasma' first."; exit 1; }
	@qdbus org.kde.plasmashell /PlasmaShell org.kde.PlasmaShell.evaluateScript \
		'var n = 0; desktops().concat(panels()).forEach(function (c) { c.widgets().forEach(function (w) { if (w.type === "$(PLASMA_ID)") n++; }); }); if (n > 0) { print("already placed (" + n + ") — no change"); } else { var p = panels(); if (p.length > 0) { p[0].addWidget("$(PLASMA_ID)"); print("added to panel " + p[0]); } else { print("NO PANEL FOUND"); } }'
	@echo "Drag the widget to taste; right-click for context menu."

panel-remove:
	@qdbus org.kde.plasmashell /PlasmaShell org.kde.PlasmaShell.evaluateScript \
	'var n = 0; desktops().concat(panels()).forEach(function (c) { c.widgets().forEach(function (w) { if (w.type === "$(PLASMA_ID)") { w.remove(); n++; } }); }); print("removed " + n);'

# Distributable package: KPackage layout (metadata.json + contents/) at the
# zip root; tests stay out.
zip-plasma:
	@mkdir -p $(DIST); \
	( cd $(PLASMA) && zip -q -r $(DIST)/$(PLASMA_ID).plasmoid contents metadata.json README.md ); \
	echo "Built $(DIST)/$(PLASMA_ID).plasmoid"

# Unit tests for the pure-JS helpers + structural validation of the
# package metadata/config.
test-plasma:
	@node $(PLASMA)/tests/test-logic.js
	@python3 -c "import json; m=json.load(open('$(PLASMA)/metadata.json')); assert m['KPlugin']['Id']=='$(PLASMA_ID)'; print('OK: metadata.json valid, id', m['KPlugin']['Id'])"
	@python3 -c "import xml.etree.ElementTree as ET; ET.parse('$(PLASMA)/contents/config/main.xml'); print('OK: contents/config/main.xml parses')"