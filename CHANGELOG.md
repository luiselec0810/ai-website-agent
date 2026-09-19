# Changelog

Todos los cambios notables de este proyecto se documentan aquí.

El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/),
y este proyecto adhiere a [Semantic Versioning](https://semver.org/lang/es/).

## [Unreleased]

### Added
- Plugin WordPress "AI Website Bridge" con REST API completa
- AI Orchestrator (TypeScript) multi-provider (Anthropic, OpenAI, Ollama, **Minimax M3**)
- Frontend Dashboard (Next.js + Tailwind + shadcn-style)
- Soporte para todas las operaciones del SRS §18 (tools)
- Sistema de Change Plans con aprobación humana (SRS §20)
- Snapshots antes de cada escritura y endpoint de rollback (SRS §23-24)
- Audit log completo de cada operación del agente (SRS §25)
- Aprobación human-in-the-loop en el Executor (SRS §3.2)
- Health endpoint que detecta WP + Elementor + Elementor Pro dinámicamente
- Idempotencia con `operation_id` (SRS §29)
- docker-compose stack completo para dev
- 7 documentos (ARCHITECTURE, API, SECURITY, DEVELOPMENT, TESTING, ELEMENTOR, PROVIDERS)
- Tests unitarios del orchestrator (Vitest)
- Tests unitarios del plugin (PHPUnit)
- Tests E2E (Playwright) cubriendo SRS §42

### Changed
- **Minimax M3 OpenAI-compatible provider**: agregado como 4to provider. Variables nuevas: `MINIMAX_API_KEY`, `MINIMAX_BASE_URL`. Ver [docs/PROVIDERS.md](docs/PROVIDERS.md).
- **LLM default actualizado a Gemini 3.1 Pro** (`gemini-3.1-pro-preview`) en `orchestrator/.env` y `.env.example`. El provider Gemini ya estaba implementado y registrado en `factory.ts`; solo se actualizó el ID del modelo y los comentarios/docs. Listas de modelos recomendadas actualizadas en `docs/PROVIDERS.md` y `orchestrator/src/llm/gemini-provider.ts`.
- **Sidebar "Library" y "Apps" funcionales**: los items del sidebar de `/sites/[id]` ahora son `<Disclosure>` colapsables. "Library" muestra un grid 2-col con thumbnails del media library del sitio; "Apps" lista los sitios conectados con pills WP/Elementor, status badge y kebab menu (Probar conexión funciona contra `POST /api/sites/:id/test`; Editar API key y Eliminar aparecen deshabilitados con tooltip "Próximamente" — los endpoints `PUT`/`DELETE` para sitios aún no están implementados en el orchestrator). Implementado en `frontend/components/sidebar/{LibraryPanel,AppsPanel}.tsx` y `frontend/components/AppSidebar.tsx`.
- **`mediaApi.list(siteId, params?)` agregado al frontend**: wrapper que lista el media library reusando `GET /api/sites/:siteId/inventory` y extrayendo el campo `media` (no expone un endpoint nuevo del orchestrator — el inventario ya está cacheado en memoria y se considera source-of-truth). Soporta `?refresh=1` para forzar refetch ignorando el cache del orchestrator.
- **Right panel del chat rediseñado**: la card `ModelInfoCard` ahora es más prominente (avatar `w-24 h-24` + size `2xl` añadido a `Avatar`, título `text-lg font-semibold`, descripción de 3 líneas con copy real). Las stats grid (`Context window`, `Training data`) son ahora mini-cards con `border border-panel-border rounded-card bg-surface` y label `text-xs uppercase tracking-wide`. Los "Successfully generated responses" usan `<Pill variant="success">` con ✓. La sección placeholder "SEARCHED FOR: Aún no se consultaron externos." se eliminó completamente (era un stub feo). "Token usage & operations" pasó a `<details>` con 3 bullets numerados en `text-accent`. Implementado en `frontend/components/RightPanel.tsx` + `Avatar.tsx`.
- **Quick actions del chat más grandes**: los chips pasan de `text-xs px-2.5 py-1` a `text-sm font-medium px-4 py-2.5` con `rounded-card` (en vez de pill) e iconos 16px. Layout cambia de `overflow-x-auto` a `flex-wrap` con grid 3-col en `sm:` (los chips ya no se cortan horizontalmente — si no caben, hacen wrap a la siguiente fila). Hover más evidente con `bg-accent-soft transition-all`. Implementado en `frontend/components/QuickActions.tsx`.
- **Textarea del chat auto-grow**: pasa de altura fija (`min-h-[96px] max-h-48`) a altura dinámica vía JS (`useLayoutEffect` que ajusta `style.height` entre 60px (mín) y 200px (máx) usando `scrollHeight`). `transition-[height] duration-150 ease-out` para que no salte visualmente cuando se borran/agregan líneas. El botón Send ahora usa `self-stretch` para seguir la altura del textarea. Toolbar decorativo B/I/s/T removido (era pura decoración, no tenía handler). Implementado en `frontend/components/Chat.tsx`.
- **SiteInventoryBadge reubicado como FAB flotante**: el badge que estaba en el header del chat (entre el selector de conversación y el modelo) se movió a un FAB en la esquina inferior derecha del chat (`absolute bottom-4 right-4`). Click → expande popover con edad del cache + botón "Refresh"; click outside o Escape lo cierra. Mantiene accesibilidad (`aria-expanded`, `aria-controls`). Implementado en `frontend/components/SiteInventoryFloatingButton.tsx`.

### Not yet in MVP (SRS §41)
- Instalación automática de plugins
- Modificación de themes
- Ejecución de PHP
- Acceso SSH/SQL
- Publicación automática
- WooCommerce, SEO, analytics avanzados

### Fixed
- **Plugin `use_template` only returned top-level element IDs in `new_element_ids`**,
  breaking subsequent operations that referenced inner widgets via
  `{{element_id:N}}` (e.g. `update_widget`, `replace_image`, `delete_element`).
  The orchestrator would either look up the wrong ID via `lastContainerId`
  fallback, or send the literal `{{element_id:N}}` string to the plugin.
  Result: the page was created and the template applied, but the inner
  widgets kept their default state with no visible error.
  - Plugin: `Elementor_Adapter::use_template` now uses a new public helper
    `collect_ids_recursive()` that flattens the cloned tree in DFS pre-order,
    so callers receive every cloned ID (containers + widgets).
  - **Defensive `update_widget` validation**: the adapter now rejects with
    `WP_Error('NOT_A_WIDGET', ...)` when a `container`/`section`/`column` is
    targeted with widget-only keys (`image`, `video_type`, `hosted_url`,
    `youtube_url`, `vimeo_url`, `dailymotion_url`, `poster`, `gallery`,
    `slides`, `html`, `icon`, `social_icon`). Previously the writer wrote
    those keys into the container's settings and returned 200 OK, leaving
    the orchestrator reporting `success` while the actual widgets kept
    their default placeholders.
  - Orchestrator: `pickElementId` no longer falls back to `lastContainerId`
    when the requested index is out of range in `elementIds`. The unresolved
    placeholder is now logged as a `logger.warn` with full context and is
    propagated raw to the plugin so it returns a clear HTTP error instead of
    silently applying the change to the wrong element.
  - Tests: added `ElementorAdapterTest` (PHPUnit, 7 tests) covering DFS
    flattening; added a Vitest regression test in `approve-placeholder.test.ts`
    that mocks the buggy single-ID payload and asserts the placeholder reaches
    the plugin verbatim + warning is logged.
  - **Deploy note (2026-09-17)**: el fix del adapter NO estaba en el archivo
    desplegado en LocalWP — el source tenía la versión con `collect_ids_recursive`
    (21355 bytes, mtime Sep 16 21:51) pero `~/Local Sites/elementor-ia/app/public/wp-content/plugins/ai-website-bridge/includes/elementor/elementor-adapter.php`
    tenía la versión vieja (19485 bytes, mtime Sep 16 01:55). Después de copiar
    el archivo al path de LocalWP, el endpoint `use_template` pasa de devolver
    2 IDs a 4 IDs en DFS, validado por curl en vivo. **Importante:** tras
    cualquier cambio al adapter, hay que copiar también el archivo al path
    de LocalWP porque no hay un `make deploy` automático para ese entorno.

## [1.0.0] - 2026-09-11

### Added
- Versión inicial del proyecto según SRS.MD sección 40 (MVP).
