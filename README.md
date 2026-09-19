# AI Website Agent

Un agente de IA que opera sitios WordPress + Elementor de forma **segura, semántica, reversible y con aprobación humana**.

La IA **nunca** toca la base de datos de WordPress directamente. Solo invoca herramientas controladas expuestas por un plugin (REST API) y cada cambio pasa por un flujo `proponer → aprobar → ejecutar → auditar`.

## Componentes

```
┌──────────────────────────────┐
│   Frontend Dashboard         │  Next.js + Tailwind + shadcn/ui
│   (chat, preview, approve)   │
└──────────────┬───────────────┘
               │ HTTPS
┌──────────────▼───────────────┐
│   AI Orchestrator            │  TypeScript + Hono + SQLite
│   (LLM multi-provider,       │  Tools, planning, approval gate
│    tool calling)             │
└──────────────┬───────────────┘
               │ HTTPS
┌──────────────▼───────────────┐
│   AI Website Bridge          │  Plugin WordPress (PHP 8.1+)
│   (REST API + Elementor      │  Auth, capabilities, audit,
│    Adapter, snapshots)       │  rollback
└──────────────┬───────────────┘
               │
       ┌───────┴────────┐
       ▼                ▼
┌──────────────┐  ┌──────────────┐
│  WordPress   │  │  Elementor   │
│     Core     │  │    Data      │
└──────────────┘  └──────────────┘
```

## Quick start

```bash
# 1. Clonar y entrar al proyecto
cd ai-website-agent

# 2. Copiar variables de entorno
cp .env.example .env
# Editar .env y agregar al menos una API key de un proveedor LLM

# 3. Levantar todo el stack
docker-compose up -d

# 4. Esperar a que WordPress termine de inicializarse (~30-60s)
docker-compose logs -f wordpress-init

# 5. Abrir el dashboard
open http://localhost:3000

# WordPress admin está en http://localhost:8000/wp-admin
# El plugin AI Website Bridge ya está activado.
```

## Servicios disponibles

| Servicio       | URL                   | Credenciales por defecto |
|----------------|-----------------------|--------------------------|
| Frontend       | http://localhost:3000 | -                        |
| Orchestrator   | http://localhost:4000 | -                        |
| WordPress      | http://localhost:8000 | admin / admin             |
| WordPress REST | http://localhost:8000/wp-json/ai-agent/v1/ | header `X-AI-Agent-Key` |
| MySQL          | localhost:3306        | wordpress / wordpress    |

## LLM Providers soportados

Edita `.env` para elegir tu proveedor:

| `LLM_PROVIDER` | Modelos sugeridos       | Configuración extra        |
|----------------|--------------------------|----------------------------|
| `anthropic`    | `claude-sonnet-4-5`     | `ANTHROPIC_API_KEY`        |
| `openai`       | `gpt-4o`                | `OPENAI_API_KEY`           |
| `ollama`       | `llama3.1` (local)      | `OLLAMA_BASE_URL`          |
| `minimax`      | `MiniMax-M3` (u otro)             | `MINIMAX_API_KEY`, `MINIMAX_BASE_URL` |

Ver [docs/PROVIDERS.md](docs/PROVIDERS.md) para más detalle.

## Estructura

```
ai-website-agent/
├── plugin/           # Plugin WordPress (PHP 8.1+)
├── orchestrator/     # Servicio de IA (TypeScript)
├── frontend/         # Dashboard (Next.js)
├── docs/             # Documentación
└── tests/            # Tests E2E
```

## Documentación

- [Arquitectura](docs/ARCHITECTURE.md)
- [API REST](docs/API.md)
- [Seguridad](docs/SECURITY.md)
- [Desarrollo](docs/DEVELOPMENT.md)
- [Testing](docs/TESTING.md)
- [Elementor Adapter](docs/ELEMENTOR.md)

## Estado

Implementación del **MVP** descrito en [SRS.MD](../SRS.MD). Consulta la sección 40 del SRS para el alcance exacto.
