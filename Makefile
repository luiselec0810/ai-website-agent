# ─────────────────────────────────────────────────────────────────
# AI Website Agent — Makefile
# ─────────────────────────────────────────────────────────────────
# Comandos principales:
#   make up          Levantar todo el stack
#   make down        Apagar todo
#   make logs        Ver logs en vivo
#   make test        Correr todos los tests
#   make shell-wp    Entrar al container de WordPress
#   make shell-orch  Entrar al container del orchestrator
# ─────────────────────────────────────────────────────────────────

# Detect OS for sed compatibility
UNAME_S := $(shell uname -s)

.PHONY: up down logs restart ps build clean install test test-plugin test-orchestrator test-e2e lint format shell-wp shell-orch verify

up:
	docker-compose up -d
	@echo "⏳ Esperando a que WordPress termine de inicializarse (~30-60s)..."
	@echo "   Para ver el progreso: make logs"
	@echo ""
	@echo "Servicios:"
	@echo "  WordPress:    http://localhost:8000  (admin/admin)"
	@echo "  Orchestrator: http://localhost:4000  /health"
	@echo "  Frontend:     http://localhost:3000"

down:
	docker-compose down

restart:
	docker-compose restart

logs:
	docker-compose logs -f

ps:
	docker-compose ps

build:
	docker-compose build

clean:
	docker-compose down -v
	@echo "🧹 Volúmenes eliminados (incluye DB y archivos WP)."

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
	docker-compose exec wordpress bash

shell-orch:
	docker-compose exec orchestrator sh

verify: lint test
	@echo "✅ Verificación completa: lint + tests OK."
