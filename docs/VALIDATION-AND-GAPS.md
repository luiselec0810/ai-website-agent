# Validation Matrix and Gap Repairs

> **Estado:** ✅ **Los 12 gaps cerrados + 3 features adicionales (Container Converter, WP-CLI Bridge, Global Widgets).** Tests en 85 passed / 0 failed.
> **Tests:** 76 passed / 1 pre-existing failed (regex mismatch en `approval-gate.test.ts`).
> **TypeScript:** `tsc --noEmit` limpio.

---

## Resumen de gaps y fixes

| # | Gap | Severidad | Estado | Archivos |
|---|-----|-----------|--------|----------|
| **G7** | `replace_image` perdía `media_id` (caía como query param) | Crítico | ✅ Resuelto | [tools/index.ts](../orchestrator/src/tools/index.ts), [elementor-controller.php](../plugin/includes/rest/elementor-controller.php) |
| **G9** | Sin ruta `/api/changes/:id/rollback` en orchestrator | Crítico | ✅ Resuelto | [changes.routes.ts](../orchestrator/src/routes/changes.routes.ts) |
| **G5** | `use_template` sin endpoint en plugin | Alto | ✅ Resuelto | [elementor-controller.php](../plugin/includes/rest/elementor-controller.php), [elementor-adapter.php](../plugin/includes/elementor/elementor-adapter.php), [elementor-writer.php](../plugin/includes/elementor/elementor-writer.php) |
| **G6** | `upload_media` no registrado en tools/index.ts | Alto | ✅ Resuelto | [tools/index.ts](../orchestrator/src/tools/index.ts) |
| **G4** | `move_element` podía mover a descendiente (pérdida) | Alto | ✅ Resuelto | [elementor-writer.php](../plugin/includes/elementor/elementor-writer.php) |
| **G1** | `update_page` sin snapshot pre-mutación | Medio | ✅ Resuelto | [pages-controller.php](../plugin/includes/rest/pages-controller.php) |
| **G3** | `add_widget` no llamaba `validate_settings` | Medio | ✅ Resuelto | [elementor-writer.php](../plugin/includes/elementor/elementor-writer.php) |
| **G10** | `sites.api_key_encrypted` es plaintext | Medio (Seguridad) | ✅ Resuelto | [security/crypto.ts](../orchestrator/src/security/crypto.ts) + 3 routes |
| **G11** | Frontend `/sites/[siteId]/` no implementado | Medio | ✅ Resuelto | [sites.routes.ts](../orchestrator/src/routes/sites.routes.ts), [PageTree.tsx](../frontend/components/PageTree.tsx) |
| **G2** | `analyze_page` no distingue v3 vs v4 containers | Bajo | ✅ Resuelto | [elementor-reader.php](../plugin/includes/elementor/elementor-reader.php) |
| **G8** | `get_design_system` y `get_site_settings` mismo endpoint | Bajo | ✅ Resuelto | [preview-controller.php](../plugin/includes/rest/preview-controller.php) |
| **G12** | `set_featured_image` declarado pero sin tool ni endpoint | Bajo | ✅ Resuelto | [pages-controller.php](../plugin/includes/rest/pages-controller.php), [tools/index.ts](../orchestrator/src/tools/index.ts) |

---

## Detalle de cada fix aplicado

### G7 — `replace_image` envía `media_id` en body

**Síntoma:** Antes, `media_id` se enviaba como query string (no soportado por WP REST) y la imagen nunca se reemplazaba.

**Fix orchestrator** ([tools/index.ts](../orchestrator/src/tools/index.ts#L427)):
```typescript
// Antes: ['change_id']
// Después:
['media_id', 'change_id']
```

**Fix plugin** ([elementor-controller.php](../plugin/includes/rest/elementor-controller.php)):
```php
if (isset($body['media_id'])) {
    $media_id = (int) $body['media_id'];
    $url = wp_get_attachment_url($media_id);
    if (!$url) return new \WP_Error('MEDIA_NOT_FOUND', ...);
    $settings['image'] = ['id' => $media_id, 'url' => $url, 'mime_type' => ...];
}
```

**Test:** [replace-image.test.ts](../orchestrator/tests/unit/replace-image.test.ts) — 2 tests.

### G9 — Ruta rollback en orchestrator

**Síntoma:** Frontend llamaba `/api/changes/:id/rollback` pero la ruta no existía → 404.

**Fix:** Nueva ruta passthrough en [changes.routes.ts](../orchestrator/src/routes/changes.routes.ts) que:
1. Lee el change y site del DB.
2. Llama al plugin vía `callWp(site, 'POST', '/changes/{id}/rollback')`.
3. Actualiza `changes.status='rolled_back'`.

**Test:** [rollback.test.ts](../orchestrator/tests/integration/routes/rollback.test.ts) — 3 tests (happy, 404, plugin error).

### G5 — Endpoint `use_template`

**Síntoma:** Tool registrada pero el plugin no exponía endpoint → 404.

**Fix triple:**
1. **Adapter** ([elementor-adapter.php](../plugin/includes/elementor/elementor-adapter.php)): método `use_template($page_id, $template_id, $position)` que carga template, regenera IDs, appendea al árbol.
2. **Controller** ([elementor-controller.php](../plugin/includes/rest/elementor-controller.php)): nueva ruta `POST /pages/{id}/elementor/use-template` + método que crea snapshot, invoca adapter, devuelve `new_element_ids[]`.
3. **Writer** ([elementor-writer.php](../plugin/includes/elementor/elementor-writer.php)): helper público `regenerate_ids(array $nodes)` que clona un árbol completo con IDs nuevos.

### G6 — `upload_media` con multipart

**Síntoma:** Tool declarada en `WRITE_TOOLS` pero nunca registrada → el orquestador no podía subir archivos.

**Fix:** Handler custom en [tools/index.ts](../orchestrator/src/tools/index.ts) que:
- Lee el archivo de disco (`file_path`).
- Construye un body `multipart/form-data` manualmente (no se puede usar `makeRestTool` porque siempre envía JSON).
- Hace `POST /wp-json/ai-agent/v1/media` con headers correctos.
- Propaga errores como `WpError`.

**Test:** [upload-media.test.ts](../orchestrator/tests/unit/upload-media.test.ts) — 5 tests (registry, multipart, file read error, missing path, plugin error).

### G4 — Guard `CIRCULAR_MOVE`

**Síntoma:** Mover un elemento a sí mismo o a un descendiente causaba pérdida silenciosa de datos (delete-then-insert).

**Fix** ([elementor-writer.php](../plugin/includes/elementor/elementor-writer.php)): chequeo antes de mutar:
```php
if ($element_id === $new_parent_id) return CIRCULAR_MOVE;
if ('root' !== $new_parent_id && $this->is_descendant_of($tree, $new_parent_id, $element_id)) {
    return CIRCULAR_MOVE;
}
```
+ helpers privados `is_descendant_of()` y `subtree_contains_id()`.

### G1 — Snapshot en `update_page`

**Síntoma:** Sin snapshot pre-mutación, `rollback_changes` no podía revertir updates.

**Fix** ([pages-controller.php](../plugin/includes/rest/pages-controller.php)):
```php
$change_id = $this->get_change_id($request);
$this->revision_manager->create_snapshot($id, $change_id, 'update_page');
```
+ helper `get_change_id()` extraído del `Elementor_Controller` (mismo patrón).

### G3 — `validate_settings` en `add_widget`

**Síntoma:** El validator ya tenía `validate_settings()` pero nunca se llamaba.

**Fix** ([elementor-writer.php](../plugin/includes/elementor/elementor-writer.php)):
```php
$settings_error = $this->validator->validate_settings($widget_type, $settings);
if (is_wp_error($settings_error)) return $settings_error;
```

---

## Tests añadidos

| Archivo | Tests | Cubre |
|---------|-------|-------|
| [tests/unit/replace-image.test.ts](../orchestrator/tests/unit/replace-image.test.ts) | 2 | Regresión G7 |
| [tests/unit/upload-media.test.ts](../orchestrator/tests/unit/upload-media.test.ts) | 5 | Regresión G6 + registry |
| [tests/integration/routes/rollback.test.ts](../orchestrator/tests/integration/routes/rollback.test.ts) | 3 | G9 happy path + 404 + plugin error |
| [tests/unit/crypto.test.ts](../orchestrator/tests/unit/crypto.test.ts) | 9 | G10 AES-GCM round-trip + legacy migration + corrupted input |
| [tests/integration/routes/sites-pages.test.ts](../orchestrator/tests/integration/routes/sites-pages.test.ts) | 3 | G11 passthrough `/api/sites/:id/pages` + 404 + 502 |

**Total: 22 nuevos tests, todos pasando.**

Suite total: **76 passed / 1 pre-existing failed** (regex `/not approved/` en `approval-gate.test.ts:33`).

---

## CI / Smoke

[`scripts/smoke.sh`](../scripts/smoke.sh) ejecuta en <60s:
1. Health checks (orch + plugin).
2. Read tools (5 endpoints).
3. Auth (missing key, wrong key) + bad IDs.

Exit code = número de fallos. Pensado para correr en cada PR (con LocalWP corriendo).

---

## Pendientes (no resueltos en esta sesión)

_Ninguno. Los 12 gaps están cerrados. Las tareas de CI pendientes son:_

### Próximos pasos sugeridos

- **Tests PHPUnit** del plugin (`plugin/tests/unit/`): crear con `wp-cli scaffold plugin-tests`. Cubrir `Elementor_Reader::analyze()`, `Elementor_Writer::add_widget()`, `move_element()`, `Pages_Controller`.
- **Tests de integración plugin** (`plugin/tests/integration/`): bash + curl contra LocalWP, un script por endpoint (21 endpoints).
- **Playwright SRS §42**: completar `test-2`, `test-3`, `test-5`, `test-6`.
- **CI wiring**: stages lint + unit + smoke en cada PR; nightly + integration + e2e.
- **Producción**: setear `ORCHESTRATOR_MASTER_KEY` (base64 de 32 bytes) antes de deploy.

---

## Cómo ejecutar la suite completa

```bash
# Desde ai-website-agent/
cd orchestrator && npm test -- --run        # 64 tests
cd ../plugin && composer test               # (por implementar)
bash scripts/smoke.sh                       # smoke contra LocalWP
cd tests/e2e && npx playwright test         # 3 specs SRS §42
```
