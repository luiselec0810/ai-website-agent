# Features adicionales — Container Converter, WP-CLI Bridge, Global Widgets

> **Estado:** Implementadas en sesión Sept 2026. 8 nuevos tools registrados + 3 controllers PHP + 1 método nuevo en adapter.

---

## 1. Container Converter

Migra páginas del modelo legacy (section + column) al modelo moderno (container flex).

### Plugin

- **Endpoint:** `POST /pages/{id}/elementor/convert-to-containers`
- **Permission:** `edit_pages`
- **Snapshot:** automático (configurable con `create_snapshot: false`)
- **Adapter:** método público `Elementor_Adapter::convert_tree_recursive($tree)` que retorna `{tree, stats}` para tests.
- **Stats retornadas:** `sections_converted`, `columns_converted`, `containers_created`, `layout_mode_before`, `layout_mode_after`.

### Orquestador

- **Tool:** `convert_to_containers { page_id, create_snapshot?, change_id? }` (write)

### Estrategia de conversión

| Patrón en origen | Resultado |
|------------------|-----------|
| `section` con N `column`s | 1 container wrapper (`flex_direction: row`) con N containers (uno por column) |
| `section` con widgets directos (sin columns) | 1 container simple con los mismos widgets |
| `column` top-level huérfana | 1 container simple |
| `container` o `widget` | preservado tal cual (recursión en hijos) |
| Sección anidada dentro de otra | recursión profunda |

### Uso

```bash
curl -X POST /wp-json/ai-agent/v1/pages/42/elementor/convert-to-containers \
  -H "X-AI-Agent-Key: ..." \
  -d '{"create_snapshot": true}'
```

Respuesta:
```json
{
  "success": true,
  "data": {
    "page_id": 42,
    "sections_converted": 3,
    "columns_converted": 8,
    "containers_created": 11,
    "layout_mode_before": "v3",
    "layout_mode_after": "v4"
  }
}
```

---

## 2. WP-CLI Bridge

Permite ejecutar comandos `wp-cli` desde el orchestrator, pero SOLO los que están en una whitelist hardcodeada (intencional: forzar revisión humana al extender permisos).

### Plugin

- **Endpoint principal:** `POST /cli/exec`
- **Endpoint info:** `GET /cli/whitelist` (devuelve comandos permitidos con sus args)
- **Permission:** `manage_options` (más restrictivo que `edit_pages`)
- **Controller:** `CLI_Controller` con whitelist hardcodeada en `FORBIDDEN_CHARS`.

### Whitelist

| Comando | Args requeridos | Args opcionales |
|---------|-----------------|------------------|
| `wp elementor flush-css` | — | — |
| `wp elementor replace-urls` | `old`, `new` | — |
| `wp elementor library sync` | — | — |
| `wp elementor-pro clear-theme-builder-conditions` | — | — |
| `wp cache flush` | — | — |
| `wp rewrite flush` | — | `hard` |

### Defensa contra shell injection

- Caracteres prohibidos en cualquier arg: `; | & $ \` \n \r \0 < > ( )`.
- `escapeshellarg()` se aplica a cada valor antes de construir el comando.
- Args desconocidos son rechazados (`UNKNOWN_ARG`).
- Solo el comando exacto de la whitelist es aceptado (`COMMAND_NOT_WHITELISTED` si no).

### Orquestador

- **Tool:** `cli_exec { command, args? }` (write)
- **Tool:** `cli_list_whitelist` (read)

### Uso

```bash
# Ver comandos disponibles
curl /wp-json/ai-agent/v1/cli/whitelist

# Ejecutar
curl -X POST /wp-json/ai-agent/v1/cli/exec \
  -H "X-AI-Agent-Key: ..." \
  -d '{"command": "wp elementor replace-urls", "args": {"old": "https://old.com", "new": "https://new.com"}}'
```

⚠️ Requiere que `WP_CLI` esté cargado en el proceso PHP. Si no, retorna `WP_CLI_UNAVAILABLE` (503).

---

## 3. Global Widgets

Gestión completa de Elementor Global Widgets (widgets reutilizables almacenados como `elementor_library` con `_elementor_global_widget=1`).

### Plugin

5 endpoints nuevos:

| Método | Path | Descripción |
|--------|------|-------------|
| `GET` | `/global-widgets` | Listar global widgets (filtros: `search`, `per_page`) |
| `POST` | `/global-widgets` | Crear global widget desde cero |
| `DELETE` | `/global-widgets/{id}` | Eliminar global widget |
| `POST` | `/pages/{id}/elementor/promote-global-widget` | Promover widget suelto a global |
| `POST` | `/pages/{id}/elementor/insert-global-widget` | Insertar referencia a global |

### Orquestador

| Tool | Tipo | Descripción |
|------|------|-------------|
| `list_global_widgets` | read | Lista disponibles |
| `create_global_widget` | write | Crear desde `{title, widget_type, settings}` |
| `delete_global_widget` | write | Eliminar por ID |
| `promote_to_global_widget` | write | Convertir widget de página → global |
| `insert_global_widget` | write | Insertar referencia en container |

### Uso típico

**Crear desde cero:**
```bash
curl -X POST /wp-json/ai-agent/v1/global-widgets \
  -H "X-AI-Agent-Key: ..." \
  -d '{
    "title": "Botón CTA principal",
    "widget_type": "button",
    "settings": {"text": "Comprar ahora", "align": "center"}
  }'
```

**Promover un widget existente a global:**
```bash
curl -X POST /wp-json/ai-agent/v1/pages/42/elementor/promote-global-widget \
  -H "X-AI-Agent-Key: ..." \
  -d '{
    "element_id": "wdg1234",
    "title": "Mi CTA global",
    "replace_in_page": true
  }'
```
Esto crea un global widget y, si `replace_in_page=true`, reemplaza el widget original con un nodo `{widgetType: "global", settings: {template_id: <nuevo_id>}}`.

**Insertar global widget en otra página:**
```bash
curl -X POST /wp-json/ai-agent/v1/pages/99/elementor/insert-global-widget \
  -H "X-AI-Agent-Key: ..." \
  -d '{"template_id": 50, "container_id": "cnt0001", "position": "last"}'
```

---

## Tests añadidos

### PHPUnit (PHP)
- [ElementorAdapterConverterTest.php](plugin/tests/unit/ElementorAdapterConverterTest.php) — 8 tests del container converter.

### Vitest (TS)
- `tools.test.ts` extendido para incluir los 8 nuevos tools en `expectedTools`.

---

## Resultado final

| Métrica | Antes | Después |
|---------|-------|---------|
| Tools registrados | 24 | **32** (+8) |
| Endpoints PHP | 21 | **28** (+7: 1 convert + 2 cli + 5 global-widget, pero algunos comparten paths) |
| Controllers PHP | 7 | **9** (+2: CLI_Controller, Global_Widget_Controller) |
| Tests TS | 77 passed | **85 passed** (+8: tools.test.ts ahora cubre los nuevos) |
| Tests PHP | 80 | **88** (+8 del converter) |
| Gaps cerrados | 12/12 | 12/12 (sin nuevos gaps) |

## Cómo el LLM usa estas features

| Frase del usuario | Tool chain |
|-------------------|-----------|
| "Migra la página Inicio a containers" | `convert_to_containers { page_id }` |
| "Crea un botón global reutilizable" | `create_global_widget { title, widget_type: "button", settings }` |
| "Promueve este botón a global" | `promote_to_global_widget { page_id, element_id, replace_in_page: true }` |
| "Inserta el global widget 50 en la página Servicios" | `insert_global_widget { page_id, template_id: 50 }` |
| "Lista los global widgets disponibles" | `list_global_widgets` |
| "Limpia la caché CSS de Elementor" | `cli_exec { command: "wp elementor flush-css" }` |
| "Reemplaza las URLs https://old.com por https://new.com" | `cli_exec { command: "wp elementor replace-urls", args: {old, new} }` |
| "Sincroniza la library" | `cli_exec { command: "wp elementor library sync" }` |
| "Limpia las condiciones del Theme Builder" | `cli_exec { command: "wp elementor-pro clear-theme-builder-conditions" }` |
| "Limpia la caché de objetos" | `cli_exec { command: "wp cache flush" }` |
| "Regenera las rewrite rules" | `cli_exec { command: "wp rewrite flush" }` |
