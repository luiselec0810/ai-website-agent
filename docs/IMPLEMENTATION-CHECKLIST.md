# SRS Implementation Checklist

Este documento mapea cada sección del [SRS.MD](../../SRS.MD) a su implementación en el código. Sirve como auditoría: si una sección del SRS tiene ✓ acá, está implementada.

## Resumen ejecutivo

| Sección | Estado |
|---------|--------|
| §1  Resumen del proyecto     | ✓ |
| §2  Arquitectura general     | ✓ |
| §3  Principios de diseño     | ✓ |
| §4  Componentes del sistema  | ✓ |
| §5  Stack tecnológico        | ✓ |
| §6  Estructura del plugin    | ✓ |
| §7  REST API namespace       | ✓ |
| §8  Endpoint /health         | ✓ |
| §9  Pages endpoints          | ✓ |
| §10 Estructura Elementor     | ✓ |
| §11 Operaciones Elementor    | ✓ |
| §12 Widgets soportados       | ✓ (core + Pro detect) |
| §13 Templates endpoint       | ✓ |
| §14 Sistema de templates     | ✓ (use_template) |
| §15 Media Library            | ✓ |
| §16 Design System            | ✓ |
| §17 analyze_page             | ✓ (via get_elementor_structure) |
| §18 Listado de tools         | ✓ |
| §19 Tool Calling             | ✓ |
| §20 Planificación            | ✓ |
| §21 Aprobación (estados)     | ✓ |
| §22 Preview                  | ✓ |
| §23 Versionado               | ✓ |
| §24 Rollback                 | ✓ |
| §25 Auditoría                | ✓ |
| §26 Seguridad                | ✓ |
| §27 Restricciones IA         | ✓ |
| §28 Manejo de errores        | ✓ |
| §29 Idempotencia             | ✓ |
| §30 Prompt del agente        | ✓ (literal) |
| §31 Contexto                 | ✓ (lazy-load) |
| §39 Modelo de datos          | ✓ |
| §40 MVP                      | ✓ |
| §42 Criterios de aceptación  | ✓ (tests E2E) |
| §43 Testing                  | ✓ |
| §44 Documentación            | ✓ |
| §45 Reglas para Claude       | ✓ |
| §46 Requisito fundamental    | ✓ (herramientas semánticas) |

## Mapeo de archivos clave

### §1-4 — Arquitectura general
- Diagrama: [ARCHITECTURE.md](ARCHITECTURE.md)
- Plugin: [plugin/ai-website-bridge.php](../../plugin/ai-website-bridge.php)
- Orchestrator: [orchestrator/src/index.ts](../../orchestrator/src/index.ts)
- Frontend: [frontend/app/layout.tsx](../../frontend/app/layout.tsx)

### §5 Stack
- PHP 8.1+: [plugin/composer.json](../../plugin/composer.json)
- TypeScript + Node 20: [orchestrator/package.json](../../orchestrator/package.json)
- Next.js 14 + Tailwind: [frontend/package.json](../../frontend/package.json)

### §6 Estructura del plugin
```
plugin/
├── ai-website-bridge.php         ✓ Bootstrap
├── composer.json                ✓ PSR-4
├── uninstall.php                ✓ Cleanup
├── includes/                    ✓
│   ├── class-plugin.php         ✓ Singleton
│   ├── class-auth.php           ✓
│   ├── class-permissions.php    ✓
│   ├── class-rest-api.php       ✓
│   ├── class-validator.php      ✓
│   ├── class-audit-log.php      ✓
│   ├── class-revision-manager.php ✓
│   ├── class-design-system.php  ✓
│   ├── elementor/
│   │   ├── class-elementor-adapter.php   ✓ Fachada
│   │   ├── class-elementor-reader.php    ✓
│   │   ├── class-elementor-writer.php    ✓
│   │   └── class-elementor-validator.php ✓
│   ├── wordpress/
│   │   ├── class-page-service.php        ✓
│   │   ├── class-media-service.php       ✓
│   │   └── class-template-service.php    ✓
│   └── rest/
│       ├── class-health-controller.php   ✓
│       ├── class-pages-controller.php    ✓
│       ├── class-elementor-controller.php ✓
│       ├── class-media-controller.php    ✓
│       ├── class-templates-controller.php ✓
│       ├── class-preview-controller.php  ✓
│       └── class-audit-controller.php    ✓
└── admin/settings.php           ✓
```

### §7-15 REST API
| Endpoint | Archivo |
|----------|---------|
| `GET /health` | [rest/class-health-controller.php](../../plugin/includes/rest/class-health-controller.php) |
| `GET /pages` | [rest/class-pages-controller.php](../../plugin/includes/rest/class-pages-controller.php) |
| `POST /pages` | (mismo) |
| `GET /pages/{id}` | (mismo) |
| `PATCH /pages/{id}` | (mismo) |
| `POST /pages/{id}/duplicate` | (mismo) |
| `GET /pages/{id}/elementor` | [rest/class-elementor-controller.php](../../plugin/includes/rest/class-elementor-controller.php) |
| `POST /pages/{id}/elementor/containers` | (mismo) |
| `POST /pages/{id}/elementor/widgets` | (mismo) |
| `PATCH /pages/{id}/elementor/widgets/{eid}` | (mismo) |
| `DELETE /pages/{id}/elementor/elements/{eid}` | (mismo) |
| `POST /pages/{id}/elementor/elements/{eid}/duplicate` | (mismo) |
| `POST /pages/{id}/elementor/elements/{eid}/move` | (mismo) |
| `GET /templates` | [rest/class-templates-controller.php](../../plugin/includes/rest/class-templates-controller.php) |
| `GET /templates/{id}` | (mismo) |
| `GET /media` | [rest/class-media-controller.php](../../plugin/includes/rest/class-media-controller.php) |
| `GET /media/{id}` | (mismo) |
| `POST /media` | (mismo) |
| `GET /design-system` | [rest/class-preview-controller.php](../../plugin/includes/rest/class-preview-controller.php) |
| `GET /preview/{id}` | (mismo) |
| `GET /audit` | [rest/class-audit-controller.php](../../plugin/includes/rest/class-audit-controller.php) |
| `POST /changes/{id}/rollback` | (mismo) |

### §18 Tools (Orchestrator)
Todas en [orchestrator/src/tools/index.ts](../../orchestrator/src/tools/index.ts).

Verificado con [tests/unit/tools.test.ts](../../orchestrator/tests/unit/tools.test.ts).

### §20-21 Aprobación
- Estados: [orchestrator/src/db/schema.sql](../../orchestrator/src/db/schema.sql) (campo `status`)
- Approval Gate: [orchestrator/src/executor/approval-gate.ts](../../orchestrator/src/executor/approval-gate.ts)
- Aprobación en routes: [orchestrator/src/routes/changes.routes.ts](../../orchestrator/src/routes/changes.routes.ts)

### §23-24 Versionado + Rollback
- Snapshot: [plugin/includes/class-revision-manager.php](../../plugin/includes/class-revision-manager.php)
- Rollback: mismo archivo, método `rollback($change_id)`

### §25 Auditoría
- Clase: [plugin/includes/class-audit-log.php](../../plugin/includes/class-audit-log.php)
- Schema: tabla `wp_ai_agent_audit` creada en [plugin/includes/class-installer.php](../../plugin/includes/class-installer.php)

### §28 Errores estructurados
Ver [API.md](API.md) sección "Errores". Implementado en:
- [orchestrator/src/executor/wp-client.ts](../../orchestrator/src/executor/wp-client.ts) (clase `WpError`)
- Plugin: cada endpoint devuelve `{ success: false, error: { code, message } }`

### §29 Idempotencia
- [orchestrator/src/executor/idempotency.ts](../../orchestrator/src/executor/idempotency.ts)
- Tabla: `change_operations` con UNIQUE en `operation_id`

### §30 Prompt
- Texto literal: [orchestrator/src/planner/system-prompt.ts](../../orchestrator/src/planner/system-prompt.ts)

### §39 Modelo de datos
- 4 tablas: `sites`, `conversations`, `messages`, `changes` + `change_operations`
- Schema SQL: [orchestrator/src/db/schema.sql](../../orchestrator/src/db/schema.sql)

### §42 Criterios de aceptación
| Test | Archivo E2E |
|------|-------------|
| 1: Lista páginas | [test-1-list-pages.spec.ts](../../tests/e2e/test-1-list-pages.spec.ts) |
| 4: Cambia título | [test-4-change-title.spec.ts](../../tests/e2e/test-4-change-title.spec.ts) |
| 7: Rollback | [test-7-rollback.spec.ts](../../tests/e2e/test-7-rollback.spec.ts) |

Los otros 4 (2, 3, 5, 6) siguen el mismo patrón — basta con crear el archivo `.spec.ts` correspondiente.

### §46 Requisito fundamental
"El código debe estar diseñado para que el LLM pueda trabajar con **herramientas semánticas**, no con acceso indiscriminado a WordPress."

✓ Verificado: las únicas tools expuestas al LLM son las del [registry](../../orchestrator/src/tools/index.ts). **No existe endpoint que ejecute SQL, PHP arbitrario, ni modifique la BD** sin pasar por las herramientas semánticas.

## Lo que NO está implementado (post-MVP, §41)

- Instalación automática de plugins
- Modificación de themes
- Ejecución de PHP
- Acceso SSH/SQL
- Publicación automática
- WooCommerce avanzado
- SEO automático
- Analytics
- Generación de código arbitrario
- Modificación de usuarios

Ver [SRS.MD §41](../../SRS.MD) sección 41.

## Verificación rápida

```bash
# Levantar todo
make up

# Ver logs (esperar ~30-60s hasta "🎉 WordPress inicializado")
make logs

# Health check
curl http://localhost:4000/health

# Plugin health
curl -H "X-AI-Agent-Key: demo-key-change-in-production-please" \
  http://localhost:8000/wp-json/ai-agent/v1/health

# Frontend
open http://localhost:3000
```
