# Arquitectura

## Visión general

AI Website Agent es un sistema de **tres capas** que permite a un usuario no técnico operar sitios WordPress + Elementor mediante instrucciones en lenguaje natural.

```
┌──────────────────────────────────────────────────────────────────┐
│  Frontend Dashboard  (Next.js 14, App Router, Tailwind)          │
│  - Selector de sitio                                               │
│  - Chat con el agente                                              │
│  - Change Plan + Approve/Reject                                    │
│  - Preview Desktop/Tablet/Mobile                                   │
│  - Audit log + rollback                                            │
└──────────────────────────┬───────────────────────────────────────┘
                           │ HTTPS / JSON
┌──────────────────────────▼───────────────────────────────────────┐
│  AI Orchestrator  (TypeScript, Hono, SQLite)                      │
│  - Multi-provider LLM (Anthropic, OpenAI, Ollama)                 │
│  - Tool registry (JSON Schema por tool)                            │
│  - Planner (genera Change Plan antes de ejecutar)                 │
│  - Executor (aplica tools en orden, con idempotency)              │
│  - Approval gate (nada se ejecuta sin approved)                   │
│  - Context manager (lazy-load: no envía todo al LLM)              │
└──────────────────────────┬───────────────────────────────────────┘
                           │ HTTPS / REST API
┌──────────────────────────▼───────────────────────────────────────┐
│  AI Website Bridge  (Plugin WordPress, PHP 8.1+)                  │
│  - REST API en /wp-json/ai-agent/v1/                              │
│  - Auth por API Key (header X-AI-Agent-Key)                       │
│  - Capability checks (edit_pages, publish_pages)                   │
│  - Elementor Adapter (lee/escribe _elementor_data)                 │
│  - WordPress services (pages, media, templates)                   │
│  - Audit log de cada operación                                    │
│  - Snapshots + rollback                                           │
└──────────────────────────┬───────────────────────────────────────┘
                           │
                ┌──────────┴──────────┐
                ▼                     ▼
        ┌──────────────┐      ┌──────────────┐
        │  WordPress   │      │  Elementor   │
        │     Core     │      │    Data      │
        └──────────────┘      └──────────────┘
```

## Flujo de datos: una operación típica

```
Usuario: "Cambia el título principal a 'Conoce nuestra historia'"
   │
   ▼
Frontend ──POST /chat──▶ Orchestrator
                            │
                            ├─ 1. Carga contexto (sitio, página, design system)
                            ├─ 2. Llama al LLM con tools disponibles
                            ├─ 3. LLM decide: tool=get_elementor_structure
                            ├─ 4. Executor llama a WP REST: GET /pages/2/elementor
                            ├─ 5. LLM decide: tool=update_widget
                            ├─ 6. Orchestrator GENERA un Change Plan
                            │
                            ▼
Frontend recibe Change Plan → muestra botones Approve/Reject
   │
   │  Usuario: "Approve"
   ▼
Frontend ──POST /changes/:id/approve──▶ Orchestrator
                                          │
                                          ├─ 7. Approval gate: OK
                                          ├─ 8. Executor llama a WP REST:
                                          │     PATCH /pages/2/elementor/widgets/abc
                                          ├─ 9. Plugin crea snapshot ANTES
                                          ├─ 10. Plugin escribe cambio
                                          ├─ 11. Plugin registra en audit log
                                          │
                                          ▼
Orchestrator ──200 OK──▶ Frontend → toast "Cambio aplicado"
                                          │
                                          ▼
                                   WordPress DB (vía API)
```

## Principios de diseño

### 1. La IA NUNCA toca la BD directamente
Todas las operaciones pasan por la REST API del plugin. No hay endpoints que ejecuten SQL arbitrario o PHP arbitrario. Ver [SECURITY.md](SECURITY.md).

### 2. Human-in-the-loop por defecto
Cada cambio complejo genera un **Change Plan** que el usuario debe aprobar antes de ejecutarse. El Orchestrator bloquea cualquier tool de escritura hasta que el estado del change sea `approved`. Ver `orchestrator/src/executor/approval-gate.ts`.

### 3. Operaciones atómicas y auditables
Cada modificación se registra como una operación independiente con `before`/`after`. Esto permite auditoría, rollback y debugging. Ver `plugin/includes/class-audit-log.php`.

### 4. Idempotencia
Cada tool acepta un `operation_id` opcional. El Executor registra el ID antes de ejecutar y aborta si ya existe. Esto evita duplicaciones cuando un tool se reintenta. Ver `orchestrator/src/executor/idempotency.ts`.

### 5. Reversibilidad
Antes de cada escritura, el plugin crea un **snapshot** del estado anterior. Si el usuario revierte, el sistema restaura el snapshot. Ver `plugin/includes/class-revision-manager.php`.

### 6. Compatibilidad
El sistema detecta dinámicamente:
- Versión de WordPress
- Versión de Elementor
- Elementor Pro instalado o no
- Widgets disponibles

No asume que todos los widgets existen. Ver `plugin/includes/elementor/class-elementor-validator.php`.

## Capas y stack

| Capa            | Stack                                       |
|-----------------|---------------------------------------------|
| Frontend        | Next.js 14, React 18, TypeScript, Tailwind  |
| Orchestrator    | Node.js 20, TypeScript, Hono, better-sqlite3, zod |
| Plugin          | PHP 8.1+, WordPress 6.x, Elementor 3.x      |
| Storage (Orch.) | SQLite (better-sqlite3)                     |
| Storage (WP)    | MySQL (gestionado por WordPress)            |
| LLM             | Anthropic / OpenAI / Ollama (configurable)  |

## Modelo de datos del Orchestrator

Ver SRS sección 39. Implementado en `orchestrator/src/db/schema.sql` con las tablas:

- **sites**: sitios WordPress conectados (URL, credenciales hasheadas, versión WP/Elementor)
- **conversations**: sesiones de chat con el agente
- **messages**: mensajes de la conversación (incluye tool_calls)
- **changes**: Change Plans con su estado (`draft` → `planned` → `awaiting_approval` → `approved` → `executing` → `completed` / `failed` / `rolled_back`)

## Multi-sitio

La arquitectura soporta múltiples sitios WordPress desde el MVP. Cada sitio tiene credenciales independientes. El Orchestrator mantiene una tabla `sites` y enruta cada tool al sitio correcto.

```
User
 ├── Site A (WordPress A)
 │    └── credenciales A
 ├── Site B (WordPress B)
 │    └── credenciales B
 └── Site C (WordPress C)
      └── credenciales C
```

Ver SRS sección 38.

## Roadmap técnico

| Fase | Alcance |
|------|---------|
| MVP  | Plugin + Orchestrator + Dashboard básico + Docker + tests E2E |
| 2    | SEO, analytics, integración con Google Search Console |
| 3    | WooCommerce, formularios avanzados |
| 4    | SaaS multi-tenant con billing |

Ver SRS sección 47 para la visión completa.
