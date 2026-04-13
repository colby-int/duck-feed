.PHONY: dev dev-server dev-client stop logs logs-api logs-worker \
       db-migrate db-reset db-seed db-studio verify-prod-invariants \
       stream-api-key-list stream-api-key-create stream-api-key-revoke \
       stream-check stream-check-quick link-check \
       build deploy test test-watch lint lint-fix typecheck \
       backup restore seed-admin ingest seed-test-audio

PROD_LOCAL_COMPOSE_FILE := docker-compose.prod.local.yml
PROD_LOCAL_COMPOSE := $(if $(wildcard $(PROD_LOCAL_COMPOSE_FILE)),-f $(PROD_LOCAL_COMPOSE_FILE),)
PROD_COMPOSE_FILES := -f docker-compose.yml -f docker-compose.prod.yml $(PROD_LOCAL_COMPOSE)

# === Development ===

dev: ## Start all services in dev mode
	@if [ -f client/package.json ]; then \
		docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build; \
	else \
		echo "client/ not scaffolded yet; starting backend + stream stack only"; \
		docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build postgres server ingest-worker liquidsoap icecast nginx; \
	fi

dev-server: ## Start API + Postgres + worker only
	docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build postgres server ingest-worker

dev-client: ## Start React dev server only
	@if [ -f client/package.json ]; then \
		docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build client; \
	else \
		echo "client/ not scaffolded yet"; \
		exit 1; \
	fi

stop: ## Stop all services
	docker compose -f docker-compose.yml -f docker-compose.dev.yml down

logs: ## Tail all service logs
	docker compose logs -f

logs-api: ## Tail API server logs
	docker compose logs -f server

logs-worker: ## Tail ingest worker logs
	docker compose logs -f ingest-worker

# === Database ===

db-migrate: ## Run pending migrations
	cd server && npm run db:migrate

db-reset: ## Drop and recreate DB + run migrations
	docker compose exec postgres psql -U $${POSTGRES_USER:-duckfeed} -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
	$(MAKE) db-migrate

db-seed: ## Seed initial admin user + sample data
	cd server && npx tsx scripts/seed.ts

db-studio: ## Open Drizzle Studio (DB browser)
	cd server && npx drizzle-kit studio

# === Ingest ===

ingest: ## Copy a file to dropzone (usage: make ingest FILE=path/to/file.mp3)
ifndef FILE
	$(error FILE is required. Usage: make ingest FILE=path/to/file.mp3)
endif
	cp "$(FILE)" ./volumes/dropzone/
	@echo "File copied to dropzone. Worker will pick it up."

seed-test-audio: ## Generate a 60s test tone in volumes/library for stream verification
	docker compose -f docker-compose.yml -f docker-compose.dev.yml run --rm --no-deps \
	  --entrypoint ffmpeg ingest-worker \
	  -f lavfi -i "sine=frequency=440:duration=60" \
	  -ar 44100 -ac 2 -ab 192k -y /var/lib/duckfeed/library/test-tone.mp3
	@echo "Test tone written to volumes/library/test-tone.mp3"

# === Build & Deploy ===

verify-prod-invariants: ## Fail fast if the public deployment template drifted
	bash scripts/verify-prod-invariants.sh

stream-api-key-list: ## List stream metadata API keys from the running server container
	docker compose exec -T server node dist/cli/manage-stream-api-keys.js list

stream-api-key-create: ## Create a stream metadata API key (usage: make stream-api-key-create LABEL="Partner app")
ifndef LABEL
	$(error LABEL is required. Usage: make stream-api-key-create LABEL="Partner app")
endif
	docker compose exec -T server node dist/cli/manage-stream-api-keys.js create "$(LABEL)"

stream-api-key-revoke: ## Revoke a stream metadata API key (usage: make stream-api-key-revoke ID=<uuid>)
ifndef ID
	$(error ID is required. Usage: make stream-api-key-revoke ID=<uuid>)
endif
	docker compose exec -T server node dist/cli/manage-stream-api-keys.js revoke "$(ID)"

stream-check: ## Deep public stream validation with tone detection and spectrogram capture
	node scripts/check-public-stream.mjs

stream-check-quick: ## Fast public stream validation for deploy smoke checks
	node scripts/check-public-stream.mjs --quick

link-check: ## Validate tracked Markdown links and embedded assets
	node scripts/check-markdown-links.mjs

build: ## Build all Docker images
	docker compose $(PROD_COMPOSE_FILES) build

deploy: ## Push, pull on prod, build, deploy containers + frontend
	bash scripts/deploy.sh

deploy-backend: ## Deploy backend only (no frontend)
	bash scripts/deploy.sh --backend

deploy-frontend: ## Deploy frontend only (Cloudflare Pages)
	bash scripts/deploy.sh --frontend

deploy-dry-run: ## Preflight checks only — no changes
	bash scripts/deploy.sh --dry-run

# === Testing ===

test: ## Run all tests
	cd server && npm test
	@if [ -f client/package.json ]; then \
		cd client && npm test; \
	else \
		echo "Skipping client tests: client/ not scaffolded yet"; \
	fi

test-watch: ## Run tests in watch mode
	cd server && npm run test:watch

lint: ## ESLint + Prettier check
	cd server && npm run lint
	@if [ -f client/package.json ]; then \
		cd client && npm run lint; \
	else \
		echo "Skipping client lint: client/ not scaffolded yet"; \
	fi

lint-fix: ## ESLint + Prettier auto-fix
	cd server && npm run lint:fix
	@if [ -f client/package.json ]; then \
		cd client && npm run lint:fix; \
	else \
		echo "Skipping client lint fix: client/ not scaffolded yet"; \
	fi

typecheck: ## TypeScript type checking
	cd server && npm run typecheck
	@if [ -f client/package.json ]; then \
		cd client && npx tsc --noEmit; \
	else \
		echo "Skipping client typecheck: client/ not scaffolded yet"; \
	fi

# === Operations ===

backup: ## Manual DB backup
	./scripts/backup.sh

restore: ## Restore DB from backup (usage: make restore FILE=path/to/backup.dump)
ifndef FILE
	$(error FILE is required. Usage: make restore FILE=path/to/backup.dump)
endif
	./scripts/restore.sh "$(FILE)"

seed-admin: ## Create/reset admin user
	cd server && npx tsx scripts/seed.ts

# === Help ===

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-15s\033[0m %s\n", $$1, $$2}'

.DEFAULT_GOAL := help
