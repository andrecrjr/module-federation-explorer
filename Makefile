NPM ?= npm
NPX ?= npx --no-install
VSCODE ?= code

.PHONY: help setup run watch format format-check lint lint-fix typecheck compile test test-ui bundle vsce package install check

help:
	@printf '%s\n' \
		'make setup          Install locked dependencies' \
		'make run            Launch the Extension Development Host' \
		'make watch          Rebuild while source files change' \
		'make format         Format the repository with oxfmt' \
		'make lint           Run oxlint' \
		'make check          Run format check, lint, typecheck, and tests' \
		'make vsce           Build and package the extension as a VSIX' \
		'make install        Install the generated VSIX in VS Code'

setup:
	$(NPM) ci

run: compile
	$(VSCODE) --extensionDevelopmentPath="$(CURDIR)" --extensionDevelopmentKind=ui

watch:
	$(NPM) run watch

format:
	$(NPM) run format

format-check:
	$(NPM) run format:check

lint:
	$(NPM) run lint

lint-fix:
	$(NPM) run lint:fix

typecheck:
	$(NPM) run typecheck

compile:
	$(NPM) run compile

test:
	$(NPM) run test:headless

test-ui:
	$(NPM) run test:ui:headless

bundle:
	$(NPM) run package

vsce:
	$(NPX) vsce package

package: vsce

install: vsce
	$(VSCODE) --install-extension mf-explorer-*.vsix --force

check: format-check lint typecheck test
