# Ollama Cloud Usage — monorepo build tooling
#
# Layout (see top-level README.md):
#   cli/    source of truth for the usage pipeline (gjs modules)
#   gnome/  GNOME Shell extension; imports cli/ via the gnome/cli symlink
#   dist/   build output (extension zips)
#
# Targets:
#   make test      run the gnome/ test suite
#   make schemas   (re)compile GSettings schemas
#   make install   install the extension as a symlink to the repo checkout
#   make enable    enable the extension via gnome-extensions
#   make zip       build a distributable extension zip (bakes cli/ modules in)
#   make clean     remove build output

UUID      := ollama-cloud-usage-tracker@aquelehugo.github.io
ROOT      := $(CURDIR)
GNOME     := $(ROOT)/gnome
CLI       := $(ROOT)/cli
DIST      := $(ROOT)/dist
EXTROOT   := $(HOME)/.local/share/gnome-shell/extensions
EXTDIR    := $(EXTROOT)/$(UUID)
SCHEMAXML := $(GNOME)/schemas/org.gnome.shell.extensions.ollama-cloud-usage-tracker.gschema.xml

.PHONY: help test schemas install enable zip clean

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