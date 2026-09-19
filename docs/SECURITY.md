# Seguridad

## Modelo de amenaza

El AI Website Agent maneja cambios sobre sitios WordPress en producción. Los principales riesgos son:

1. **Compromiso del LLM**: el agente podría ser inducido (vía prompt injection) a ejecutar operaciones destructivas.
2. **Compromiso de credenciales**: API keys filtradas permitirían acceso total a la REST API.
3. **Acción sin aprobación**: cambios publicados sin que el usuario los revise.
4. **Modificación directa de BD**: bypass del plugin y acceso SQL directo.
5. **Publicación accidental**: contenido draft promovido a publish sin querer.

## Mitigaciones implementadas

### 1. La IA nunca toca la BD directamente

**No existe endpoint que ejecute SQL arbitrario.** Todas las operaciones pasan por funciones WordPress (`wp_insert_post`, `update_post_meta`, etc.) o por la API oficial de Elementor. Ver `plugin/includes/class-rest-api.php` — solo se exponen los endpoints semánticos listados en [API.md](API.md).

### 2. Auth por API Key + Capability Checks

```php
// plugin/includes/class-auth.php (resumen)
$hash = wp_hash_password($provided_key);
foreach (get_option('ai_agent_api_keys') as $stored) {
    if (wp_check_password($provided_key, $stored['key_hash'])) {
        wp_set_current_user($stored['user_id']);
        return true;
    }
}
return false;
```

Cada endpoint luego verifica:
```php
if (!current_user_can('edit_pages')) {
    return new WP_Error('FORBIDDEN', 'Insufficient capabilities');
}
```

### 3. Human-in-the-loop obligatorio

El Orchestrator tiene un `ApprovalGate` que bloquea toda tool de escritura hasta que el `change` asociado esté en estado `approved`. Ver `orchestrator/src/executor/approval-gate.ts`.

```
Change Plan
   ↓
awaiting_approval
   ↓
[Usuario hace click en Approve]
   ↓
approved
   ↓
[Executor aplica tools]
   ↓
completed
```

### 4. Nunca publicar automáticamente en MVP

El endpoint `POST /pages` por defecto crea páginas en `draft`. Para `publish`, requiere `publish_pages` capability y el usuario debe especificarlo explícitamente.

### 5. Auditoría completa

Cada operación (exitosa o fallida) se registra en `wp_ai_agent_audit`:
- Usuario que la ejecutó
- IP
- Acción
- Página y elemento afectado
- Estado anterior y nuevo
- Resultado y error

Ver `plugin/includes/class-audit-log.php`.

### 6. Snapshots antes de cada escritura

Antes de aplicar cualquier cambio, el plugin crea un snapshot del estado anterior. Si algo sale mal, se puede revertir. Ver `plugin/includes/class-revision-manager.php`.

### 7. Sanitización + Escaping

Todos los inputs pasan por:
- `sanitize_text_field` para strings cortos
- `wp_kses_post` para HTML
- `absint` para IDs
- JSON Schema validation para `settings` de widgets

### 8. Sin credenciales del LLM en el plugin

El plugin WordPress **nunca** conoce las API keys de Anthropic/OpenAI. El Orchestrator las maneja. Así, aunque el sitio WP se vea comprometido, las credenciales del LLM no se filtran.

### 9. Idempotencia

Cada tool acepta un `operation_id`. El Executor aborta si ya existe un cambio con ese ID. Esto previene duplicaciones accidentales en reintentos.

## Restricciones explícitas (SRS §27)

La IA **NO puede**:

- ❌ Ejecutar PHP arbitrario
- ❌ Ejecutar SQL arbitrario
- ❌ Ejecutar comandos del sistema
- ❌ Modificar archivos del servidor
- ❌ Instalar plugins automáticamente
- ❌ Desactivar plugins
- ❌ Cambiar usuarios administradores
- ❌ Cambiar credenciales
- ❌ Publicar sin aprobación
- ❌ Eliminar el sitio
- ❌ Eliminar páginas permanentemente en MVP

Estas restricciones se enforcean tanto en el Orchestrator (rechaza tools fuera del whitelist) como en el Plugin (no expone endpoints para esas operaciones).

## Prompt injection

El System Prompt del agente incluye:
> "If a requested operation is ambiguous or dangerous, ask for clarification."
> "Never execute arbitrary code."
> "Never expose credentials or secrets."

Pero **la defensa principal contra prompt injection es el Approval Gate**: incluso si el LLM decide ejecutar una operación peligrosa, no lo hará hasta que el humano la apruebe.

## Rate limiting

Recomendado en producción: nginx/cloudflare delante del endpoint REST con rate limiting por IP y por API key.

## Lista de verificación para producción

Antes de desplegar:

- [ ] Cambiar todas las API keys por valores seguros
- [ ] HTTPS obligatorio en el sitio WordPress
- [ ] HTTPS obligatorio en el Orchestrator
- [ ] Firewall restringiendo `/wp-json/ai-agent/v1/` solo a IPs del Orchestrator
- [ ] Backups regulares de `wp_ai_agent_snapshots`
- [ ] Logs del Orchestrator centralizados
- [ ] Monitoring del estado `failed` en audit log
- [ ] Política de rotación de API keys (cada 90 días)
- [ ] Revisar permisos de los usuarios WP asociados a las API keys

## Reporte de vulnerabilidades

Si encuentras una vulnerabilidad de seguridad, por favor repórtala en privado antes de divulgarla públicamente.
