# ─────────────────────────────────────────────────────────────────
# AI Website Agent — Makefile
# ─────────────────────────────────────────────────────────────────
# Comandos principales:
#   make up              Levantar stack DEV (localhost, plugin live-mount)
#   make prod-up         Levantar stack PROD (Dokploy, plugin bakeado)
#   make prod-config     Validar sintaxis del compose de producción
#   make prod-build      Buildear imágenes de producción
#   make down            Apagar dev
#   make prod-down       Apagar prod
#   make logs            Ver logs en vivo (dev)
#   make test            Correr todos los tests
#   make shell-wp        Entrar al container de WordPress
#   make shell-orch      Entrar al container del orchestrator
# ─────────────────────────────────────────────────────────────────

# Detect OS for sed compatibility
UNAME_S := $(shell uname -s)

# Compose files
DEV_COMPOSE  := docker-compose -f docker-compose.dev.yml
PROD_COMPOSE := docker-compose -f docker-compose.yml

.PHONY: up down logs restart ps build clean install test test-plugin test-orchestrator test-e2e lint format shell-wp shell-orch verify prod-build prod-up prod-down prod-logs prod-config

up:
	$(DEV_COMPOSE) up -d
	@echo "⏳ Esperando a que WordPress termine de inicializarse (~30-60s)..."
	@echo "   Para ver el progreso: make logs"
	@echo ""
	@echo "Servicios (dev):"
	@echo "  WordPress:    http://localhost:8000  (admin/admin)"
	@echo "  Orchestrator: http://localhost:4000  /health"
	@echo "  Frontend:     http://localhost:3000"

down:
	$(DEV_COMPOSE) down

restart:
	$(DEV_COMPOSE) restart

logs:
	$(DEV_COMPOSE) logs -f

ps:
	$(DEV_COMPOSE) ps

build:
	$(DEV_COMPOSE) build

clean:
	$(DEV_COMPOSE) down -v
	@echo "🧹 Volúmenes eliminados (incluye DB y archivos WP)."

# ─────────────────────────────────────────────────────────────────
# Producción / Dokploy
# ─────────────────────────────────────────────────────────────────
prod-config:
	@echo "🔍 Validando docker-compose.yml..."
	$(PROD_COMPOSE) config -q && echo "✅ Compose válido."

prod-build:
	$(PROD_COMPOSE) build

prod-up:
	$(PROD_COMPOSE) up -d
	@echo "⏳ Esperando init de WordPress (~60-90 s)..."
	@echo "   Para ver el progreso: make prod-logs"
	@echo ""
	@echo "Servicios (prod, requieren dokploy-network y vars de host):"
	@echo "  WordPress:    https://\$${WP_HOST}"
	@echo "  Orchestrator: interno (no expuesto — vía /api/* del frontend)"
	@echo "  Frontend:     https://\$${FRONT_HOST}"

prod-down:
	$(PROD_COMPOSE) down

prod-logs:
	$(PROD_COMPOSE) logs -f

# ─────────────────────────────────────────────────────────────────
# Install / Test / Lint (sin cambios)
# ─────────────────────────────────────────────────────────────────
install:
	@echo "📦 Instalando dependencias de Orchestrator..."
	cd orchestrator && npm install
	@echo "📦 Instalando dependencias de Frontend..."
	cd frontend && npm install
	@echo "📦 Instalando dependencias de Tests E2E..."
	cd tests/e2e && npm install

test: test-orchestrator test-plugin test-e2e
	@echo ""
	@echo "✅ Todos los tests pasaron."

test-orchestrator:
	cd orchestrator && npm install && npm test

test-plugin:
	cd plugin && bash tests/integration/run-all.sh

test-e2e:
	@echo "⚠️  Los tests E2E requieren docker-compose up corriendo."
	cd tests/e2e && npx playwright test

lint:
	@echo "🔍 Lint del Orchestrator..."
	cd orchestrator && npx tsc --noEmit
	@echo "🔍 Lint del Frontend..."
	cd frontend && npx tsc --noEmit

format:
	@echo "No formatter configurado todavía (TODO)."

shell-wp:
	$(DEV_COMPOSE) exec wordpress bash

shell-orch:
	$(DEV_COMPOSE) exec orchestrator sh

verify: lint test
	@echo "✅ Verificación completa: lint + tests OK."
