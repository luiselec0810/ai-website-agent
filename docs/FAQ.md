# FAQ — Preguntas Frecuentes

## General

### ¿Qué es AI Website Agent?

Es un sistema de tres componentes (Plugin WordPress + Orchestrator IA + Dashboard) que permite a un usuario no técnico operar sitios WordPress/Elementor mediante lenguaje natural, con seguridad y aprobación humana.

### ¿Puedo usarlo sin LLM?

Sí, puedes usar el Plugin WordPress independientemente como una REST API para integrar tu propio backend. El Orchestrator solo se necesita si quieres chat conversacional con IA.

### ¿Funciona con Elementor Pro?

Sí. El plugin detecta automáticamente si Elementor Pro está instalado y expone los widgets Pro en la lista de widgets disponibles.

## Configuración

### ¿Qué proveedor LLM debería usar?

- **Anthropic Claude**: recomendado para tool calling estructurado y planificación.
- **OpenAI GPT**: también compatible, especialmente bueno con function calling.
- **Ollama (local)**: ideal para entornos donde no puedes enviar datos a la nube.

### ¿Cómo cambio de proveedor?

Edita `LLM_PROVIDER` y `LLM_MODEL` en `.env` y reinicia el Orchestrator. No requiere cambios de código.

### ¿Dónde se guardan las API keys de WordPress?

Se almacenan hasheadas con `wp_hash_password` (bcrypt) en `wp_options.ai_agent_api_keys`. Nunca se guardan en texto plano.

## Seguridad

### ¿La IA puede borrar mi sitio?

No. El plugin no expone endpoints para eliminar el sitio o páginas (excepto `delete_element` que opera sobre un elemento específico de Elementor, no la página completa). Además, toda operación de escritura pasa por approval gate.

### ¿Y si el LLM alucina?

El `ElementorValidator` verifica que cada `element_id` exista antes de aplicar el cambio. Si no existe, devuelve error estructurado. El `ToolExecutor` reintenta hasta 3 veces solo para tools de lectura, luego pregunta al usuario.

### ¿Qué pasa si apruebo un cambio por error?

Puedes revertirlo con el endpoint `POST /changes/{id}/rollback`, que restaura el snapshot anterior.

## Privacidad

### ¿Mis conversaciones se almacenan en la nube del LLM?

Depende del proveedor:
- **Anthropic / OpenAI**: sí, se envían al API. Consulta sus políticas.
- **Ollama local**: no, todo es local.

Las conversaciones se guardan en SQLite local (`orchestrator.db`) y los snapshots/audit logs en WordPress.

## Desarrollo

### ¿Cómo pruebo un cambio sin afectar producción?

Usa `docker-compose up`. Eso crea un WordPress aislado con páginas de ejemplo.

### ¿Puedo agregar un widget nuevo de Elementor?

Agrega el tipo al array `CORE_WIDGETS` o `PRO_WIDGETS` en `plugin/includes/elementor/class-elementor-validator.php`. El plugin también lo detecta dinámicamente desde `widgets_manager`.

### ¿Cómo agrego una nueva tool al agente?

1. Agrega el handler en `orchestrator/src/tools/index.ts`.
2. Define su JSON Schema.
3. Implementa la llamada al endpoint REST correspondiente.
4. Marca como read-only en `approval-gate.ts` si no debe requerir aprobación.
5. Agrega un test en `orchestrator/tests/unit/tools.test.ts`.
6. Documenta el tool en `docs/API.md` (extremo) y en el system prompt si es relevante.

### ¿Cómo funciona el rollback?

Antes de cada operación de escritura, el plugin crea un snapshot del estado anterior (`_elementor_data`, `post_content`, `post_title`, post_meta relevante). El endpoint `POST /changes/{id}/rollback` restaura ese snapshot usando `wp_update_post` y `update_post_meta`.

## Troubleshooting

### El plugin no aparece en WordPress

Verifica que el archivo esté en `wp-content/plugins/ai-website-bridge/` y que el header del archivo principal esté correcto.

### Health endpoint devuelve `elementor_installed: false`

Elementor no está instalado o activado. Ejecuta `init-wordpress.sh` o instálalo desde el admin.

### El LLM devuelve errores 401 / 4013

API key inválida o expirada. Genera una nueva en la consola del proveedor y actualízala en `.env`.

### Frontend no se conecta al Orchestrator

Verifica que el contenedor esté corriendo (`docker-compose ps`) y que la red `ai-agent-net` los conecta. El frontend usa rewrites de Next.js (`next.config.js`), así que debería funcionar si ambos están en el mismo docker-compose.

### Los tests E2E fallan con timeout

El stack no está corriendo, o el LLM es muy lento. Aumenta el timeout en `playwright.config.ts`.
