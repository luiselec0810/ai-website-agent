# Elementor Debugging Guide — Quick Reference

Use when something doesn't work in the agent's Elementor operations.

## Check the plugin can read/write

```bash
curl -H "X-AI-Agent-Key: YOUR_KEY" \
  http://localhost:10010/wp-json/ai-agent/v1/health/
```

Should include:

```json
{"success":true, "data":{"wordpress_version":"...","elementor_installed":true,...}}
```

If `elementor_installed: false`, install via WP Admin → Plugins → Add New.

## Check what IDs the plugin generates

Each call to `add_container` / `add_widget` returns the new ID in `data.new_element_id`:

```json
{
  "success": true,
  "data": {
    "id": "cea8767",
    "elType": "container",
    "settings": [],
    "elements": [],
    "result": "cea8767",
    "new_element_id": "cea8767"
  }
}
```

ID format: **7-char lowercase hex** (`/^[a-f0-9]{7}$/`).

If you see `id: "main-container"` or `id: 0` in a tool response, the LLM **invented** the ID and the plugin rejected the call.

## Verify the change plan

When a change shows "Falló" in the UI:

1. Open WP Admin → Settings → AI Agent
2. Scroll to "Cambios pendientes" or "Completados"
3. Click the change to see the operation results

In results:
- `status: "success"` → tool worked
- `status: "failed"` with `error.code` and `error.message` → tool call failed

Common failure patterns:

| Code | Meaning | Fix |
|------|---------|-----|
| `HTTP 500 WRITE_FAILED` | `page_id: 0` or no such page | The LLM should have used `"{{page_id}}"` |
| `HTTP 404` | Endpoint doesn't exist | Plugin deactivated or route not registered |
| `HTTP 403 FORBIDDEN` | API key wrong or capability missing | Check X-AI-Agent-Key header |
| `FOREIGN KEY constraint failed` | Orchestrator DB issue | Reset DB by deleting `data/orchestrator.db` |

## Read Elementor data directly

```bash
curl -H "X-AI-Agent-Key: YOUR_KEY" \
  http://localhost:10010/wp-json/ai-agent/v1/pages/14/elementor/
```

Should return the Elementor tree for page ID 14.

If `_elementor_data` is `[]` or `null`, the page is "blank Elementor". Elementor renders content from the in-memory tree only when the editor saves.

To verify edits, open the page in Elementor:
- WP Admin → Pages → click "Edit with Elementor"

The visual editor will show the container/widget structure.

## Common Elementor v3 quirks

- **`_elementor_data` is JSON, not array** when serialized. Sometimes it's stored as a *string* of JSON, not an actual array. Our plugin handles both (`json_decode` vs raw array).
- **Per-widget settings**: every widget has its own valid keys. `heading` uses `title`, `header_size`. `button` uses `text`, `link`, `align`. Using the wrong key shows a default.
- **Global vs local styles**: Elementor prefers global colors. Avoid hardcoded hex codes; let the system pick the global.
- **Section vs Container**: Elementor 3.x uses `container` (the new "section" replacement) and `widget`. Older pages may still have `section` + `column` (legacy v2 layout).
- **Version**: `_elementor_version` is in post meta. The plugin handles parsing of v3 format; v2 may need adjustments.

If you see:
```
"Cannot read properties of undefined (reading 'settings')"
```
in `error.log`, it's usually a v2 page being edited by v3 code. Re-save with Elementor or upgrade the parser.

## Debugging prompt issues

If the agent keeps hallucinating IDs (`0`, `"abc"`, etc.) even after the system-prompt fix, check:

```bash
curl -s http://localhost:4100/health | jq .llm_model
# → "gemini-3.6-flash"
```

Some older versions of Gemini Flash produced this. If you switch models:

1. Update `LLM_MODEL=gemini-2.5-flash` (more constrained)
2. Restart orchestrator: `pkill -f "tsx watch" && npm run dev`
3. Test: send "List pages" → should answer cleanly with page objects.

## Audit log

Every change creates audit entries in:
- `wp_ai_agent_audit` (WordPress) — details per Elementor operation
- `change_operations` (orchestrator SQLite) — full plan and per-tool result

```sql
-- In WP via wp-cli:
wp db query "SELECT action, success, error_message FROM wp_ai_agent_audit ORDER BY id DESC LIMIT 10"

-- In orchestrator (open the DB):
sqlite3 data/orchestrator.db
SELECT tool_name, status, error_code, error_message FROM change_operations ORDER BY id DESC LIMIT 10;
```

If the same operation fails in both logs, the bug is in the PHP plugin. If only the orchestrator's log shows a failure, the bug is in the executor (placeholder resolution, ID validation, etc.).
