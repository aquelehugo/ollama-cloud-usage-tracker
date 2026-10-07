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
#   make install        install the Gnome extension as a symlink to the repo
#   make enable         enable the Gnome extension via gnome-extensions
#   make zip            build a distributable Gnome extension zip (bakes cli/ in)
#   make bin            symlink the CLI into ~/.local/bin (used by plasma auto-detect)
#   make install-plasma install the Plasma widget as a symlink to the repo
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
SCHEMAXML           := $(GNOME)/schemas/org.gnome.shell.extensions.ollama-cloud-usage-tracker.gschema.xml

.PHONY: help test schemas install enable zip clean bin install-plasma uninstall-plasma zip-plasma test-plasma

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
bin:
	mkdir -p $(HOME)/.local/bin
	chmod +x $(CLI)/ollama-usage.js
	ln -sfn $(CLI)/ollama-usage.js $(HOME)/.local/bin/ollama-usage
	@echo "Installed CLI shortcut: $(HOME)/.local/bin/ollama-usage -> $(CLI)/ollama-usage.js"

# Dev install: kpackagetool5 makes a real copy under
# ~/.local/share/plasma/plasmoids/<id> (KPackage discovery does NOT read
# symlinked plasmoid dirs, unlike GNOME Shell — this was verified live).
# Re-run this target after edits; it upgrades the installed copy.
install-plasma:
	kpackagetool5 -t Plasma/Applet -u $(PLASMA) 2>/dev/null \
		|| kpackagetool5 -t Plasma/Applet -i $(PLASMA)
	icdir="$(HOME)/.local/share/icons/hicolor/192x192/apps"; \
	mkdir -p "$$icdir"; \
	if command -v convert >/dev/null 2>&1; then \
		convert $(PLASMA)/contents/images/ollama-icon.png -resize 192x192 "$$icdir/ollama-cloud-usage.png"; \
	else \
		cp $(PLASMA)/contents/images/ollama-icon.png "$$icdir/ollama-cloud-usage.png"; \
	fi; \
	echo "Installed $(PLASMA_ID) (kpackagetool5 copy) + hicolor icon"; \
	echo "Restart plasmashell to reload: systemctl --user restart plasma-plasmashell.service"

uninstall-plasma:
	kpackagetool5 -t Plasma/Applet -r $(PLASMA_ID)

# Distributable package: KPackage layout (metadata.json + contents/) at the
# zip root; tests stay out.
zip-plasma:
	@mkdir -p $(DIST); \
	( cd $(PLASMA) && zip -q -r $(DIST)/$(PLASMA_ID).plasmoid contents metadata.json README.md ); \
	echo "Built $(DIST)/$(PLASMA_ID).plasmoid"

# Unit tests for the pure-JS helpers + structural validation of the
# package metadata/config.
test-plasma:
	node $(PLASMA)/tests/test-logic.js
	python3 -c "import json; m=json.load(open('$(PLASMA)/metadata.json')); assert m['KPlugin']['Id']=='$(PLASMA_ID)'; print('OK: metadata.json valid, id', m['KPlugin']['Id'])"
	python3 -c "import xml.etree.ElementTree as ET; ET.parse('$(PLASMA)/contents/config/main.xml'); print('OK: contents/config/main.xml parses')"