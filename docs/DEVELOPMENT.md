# Desarrollo

## Requisitos

- **Node.js** >= 20
- **npm** >= 10
- **Docker** + Docker Compose
- **PHP** 8.1+ (solo si quieres ejecutar tests del plugin sin Docker)
- **Composer** (solo si quieres ejecutar tests del plugin sin Docker)
- **Git**

## Setup inicial

```bash
# Clonar (o ya está clonado si vienes del SRS.MD)
git clone <repo-url>
cd ai-website-agent

# Variables de entorno
cp .env.example .env
# Editar .env: agregar API key del proveedor LLM que quieras usar

# Levantar todo
docker-compose up -d

# Esperar a que termine la inicialización de WordPress
docker-compose logs -f wordpress-init
# Cuando veas "🎉 WordPress inicializado correctamente", está listo.

# Abrir el dashboard
open http://localhost:3000
```

## Convenciones del código

### Plugin (PHP)

- **PSR-4** autoload via Composer (`AIWebsiteBridge\` → `includes/`).
- **WordPress Coding Standards** (WPCS). Verificar con:
  ```bash
  cd plugin && composer phpcs
  ```
- **PHP 8.1+ features**: enums, readonly properties, named arguments, `match`.
- **Type declarations** siempre que sea posible.
- **No acceso directo a `$wpdb`** salvo en `class-revision-manager.php` y `class-audit-log.php` para crear las tablas en activation. Todo lo demás pasa por funciones WP.
- **Prefijos**: todas las funciones y tablas usan el prefijo `ai_agent_` o `wp_ai_agent_`.
- **Capacidades**: verificar siempre `current_user_can(...)` antes de escribir.
- **Sanitización**: nunca confiar en input; `sanitize_text_field`, `absint`, `wp_kses_post`.

### Orchestrator (TypeScript)

- **Strict mode** en `tsconfig.json`.
- **ESM modules** (`"type": "module"` en package.json).
- **Hono** para HTTP (más ligero y tipado que Express).
- **better-sqlite3** para DB local.
- **zod** para validación de env y de inputs de tools.
- **Errores estructurados**: nunca `throw new Error('algo')`, siempre un objeto con `code`, `message`, `details`.
- **Logger**: usar `pino` (no `console.log`).

### Frontend (Next.js)

- **App Router** (Next.js 14+).
- **Server Components** por defecto, **Client Components** solo donde haya estado/interactividad.
- **shadcn/ui** para componentes base (Button, Card, Dialog, Input).
- **Tailwind** para estilos (sin CSS modules).
- **fetch** nativo para llamadas al Orchestrator.
- **Tipado estricto** — interfaces para todas las respuestas del Orchestrator.

## Flujo de trabajo

### Crear una feature nueva

1. **Crear rama**:
   ```bash
   git checkout -b feat/nueva-feature
   ```

2. **Desarrollar en el componente correcto**:
   - ¿Es endpoint nuevo? → `plugin/includes/rest/class-XXX-controller.php`
   - ¿Es operación Elementor nueva? → `plugin/includes/elementor/class-elementor-writer.php`
   - ¿Es tool nueva para el LLM? → `orchestrator/src/tools/XXX.tools.ts`
   - ¿Es componente UI nuevo? → `frontend/components/XXX.tsx`

3. **Tests**:
   - Plugin: PHPUnit en `plugin/tests/unit/`
   - Orchestrator: Vitest en `orchestrator/tests/unit/`
   - E2E: Playwright en `tests/e2e/`

4. **Verificación manual**:
   ```bash
   # Si cambiaste el plugin:
   docker-compose restart wordpress
   # El plugin se recargará automáticamente (volumen montado)
   
   # Si cambiaste el orchestrator:
   docker-compose restart orchestrator
   
   # Si cambiaste el frontend:
   docker-compose restart frontend
   ```

5. **Commit** (mensaje siguiendo Conventional Commits):
   ```
   feat(plugin): add /preview endpoint
   feat(orchestrator): add design-system tools
   fix(frontend): fix preview iframe sizing
   docs(api): document /preview endpoint
   ```

## Estructura de tests

```
plugin/tests/unit/                     # PHPUnit (PHP)
orchestrator/tests/unit/                # Vitest (TS)
orchestrator/tests/integration/         # mockea WP REST API
frontend/tests/                         # Vitest para componentes
tests/e2e/                              # Playwright contra docker-compose
```

Ver [TESTING.md](TESTING.md) para más detalle.

## Debug

### Plugin

```bash
# Logs de WordPress
docker-compose logs wordpress

# Activar WP_DEBUG
docker-compose exec wordpress bash -c "echo 'define(\"WP_DEBUG\", true);' >> /var/www/html/wp-config.php"
docker-compose restart wordpress
```

### Orchestrator

```bash
# Logs del orchestrator
docker-compose logs -f orchestrator

# Entrar al container
docker-compose exec orchestrator sh
```

### Frontend

```bash
# DevTools del browser (F12)
# Los logs de Next.js aparecen en:
docker-compose logs -f frontend
```

## Performance

- **WordPress**: las operaciones Elementor se serializan/deserializan como JSON. Para páginas grandes (>500 elementos), considerar paginar la respuesta de `/elementor`.
- **Orchestrator**: el contexto del LLM se carga lazy. Cada tool pide solo lo que necesita. No enviar toda la web al LLM.
- **Frontend**: usar React Server Components para listas largas. Streaming del chat con `ReadableStream`.

## Seguridad en desarrollo

- **Nunca** commitear `.env`. Está en `.gitignore`.
- **Nunca** hardcodear API keys en el código.
- Usar **API keys de prueba** separadas para dev y prod.
- El plugin nunca toca las API keys del LLM.

## Próximos pasos sugeridos

- Configurar CI/CD (GitHub Actions) para correr PHPUnit + Vitest + Playwright en cada PR.
- Configurar pre-commit hooks con `husky` + `lint-staged`.
- Internacionalización del frontend (i18n).
- Métricas con OpenTelemetry.
