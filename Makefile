.PHONY: init services services-stop build test lint typecheck format check pack-check example docs

init: ## Install toolchain (mise) and dependencies
	brew bundle
	mise install
	pnpm install

services: ## Start memcached test services (plain :11211, TLS-only :21211)
	pnpm test:services:start

services-stop: ## Stop memcached test services
	pnpm test:services:stop

build: ## Build ESM + CJS bundles and type declarations
	pnpm build

test: ## Run integration tests with coverage (requires `make services`)
	pnpm test

lint: ## Lint and check formatting
	pnpm lint

typecheck: ## Type-check without emitting
	pnpm typecheck

format: ## Auto-fix lint and formatting issues
	pnpm format

check: typecheck lint test build ## Run every quality gate
	pnpm check:exports

pack-check: ## Show exactly what would be published to npm
	npm pack --dry-run

example: build ## Run the demo app (requires `make services`)
	pnpm --filter next-memcached-example dev

docs: ## Preview docs as GitHub renders them (http://localhost:6419)
	pnpm docs
