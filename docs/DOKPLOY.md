# Desplegar `ai-website-agent` en Dokploy

Guía operativa paso a paso para producción. La configuración vive en `docker-compose.yml` (raíz); el dev local sigue funcionando con `docker-compose.dev.yml` y `make up`.

---

## 1. Prerrequisitos

### 1.1 DNS wildcard

Si vas a usar `app.example.com` + `wp.app.example.com`, necesitás un registro DNS tipo A wildcard:

```
*.app.example.com.    A    <IP_PUBLICA_DOKPLOY>
```

Verificación antes de continuar:

```bash
dig wp.app.example.com +short     # debe devolver la IP de Dokploy
dig app.example.com  +short       # debe devolver la IP de Dokploy
```

### 1.2 Firewall

Puertos 80 y 443 abiertos hacia la IP del servidor Dokploy (son los únicos que Traefik necesita para Let's Encrypt HTTP-01).

### 1.3 Panel Dokploy

Acceso al panel (URL, usuario y password). Necesitás permisos de crear proyectos.

---

## 2. ⚠️ Rotar secretos expuestos (HACER ANTES DEL DEPLOY)

El repo git actual tiene **3 secretos con valor real** commiteados en su historial:

| Variable            | Valor expuesto (resumido)        | Acción                                                                                  |
|---------------------|----------------------------------|-----------------------------------------------------------------------------------------|
| `MINIMAX_API_KEY`   | `sk-api-fH831urpy…`             | Revocar en [console.minimax.io](https://console.minimax.io/) y generar nueva             |
| `DEFAULT_WP_API_KEY`| `aiw_ZrOPFYwg…` (en root `.env`) | Regenerar con `openssl rand -base64 48` (prefijo `aiw_`) y revocar la anterior en WP    |
| `GEMINI_API_KEY`    | `AIzaSy…` (en `orchestrator/.env`, local pero riesgo) | Revocar en [aistudio.google.com](https://aistudio.google.com/apikey) y regenerar |

> Las claves reales del historial de git siguen siendo válidas hasta que se revocan explícitamente en el panel del proveedor. Aunque limpies `.env`, las claves pasadas siguen activas.

Una vez revocadas, las nuevas NO deben commitease al repo. Se pegan únicamente en el panel de Dokploy (sección "Environment Variables") o en un `.env` local fuera del repo.

---

## 3. Crear el proyecto en Dokploy

### 3.1 Crear proyecto + service

1. **Projects → Create Project** → nombre: `ai-website-agent`.
2. Dentro del proyecto → **Create Service → Docker Compose**.
3. **Source**: apuntar al repo (puede ser GitHub, GitLab o un tarball local):
   - Si ya está en GitHub: pegar la URL del repo `luiselec0810/ai-website-agent`.
   - Branch: `main` (o el branch de release).
   - **Docker Compose File Path**: `docker-compose.yml` (NO `.dev.yml`).
4. **Build Context**: `.` (raíz del repo).
5. **Watch** (opcional): deshabilitado por ahora para no reconstruir en cada push.

### 3.2 Crear la red `dokploy-network` (si no existe)

Dokploy normalmente la crea automáticamente al asignar el primer dominio. Si `docker compose up` falla con "network dokploy-network not found":

1. Project → Settings → Networks → **Create Network** con nombre exacto `dokploy-network` y driver `bridge`.

### 3.3 Asignar dominios

Asignar 2 dominios a 2 servicios:

| Domain                    | Service        | Port interno |
|---------------------------|----------------|--------------|
| `wp.app.example.com`      | `wordpress`    | 80           |
| `app.example.com`         | `frontend`     | 3000         |

> Si usás sólo un dominio (ej. `app.example.com` con wildcard), asignale `*.app.example.com` al frontend con un router catch-all y un router separado para `wp.app.example.com` apuntando a wordpress.

### 3.4 Variables de entorno

En la sección **Environment Variables** del servicio, pegar todas las del `.env.example` (raíz) sección "DOKPLOY / PRODUCCIÓN" + las del orchestrator (`LLM_PROVIDER`, `LLM_MODEL`, etc.) **con valores reales**.

Mínimo requerido:

```bash
# Hosts
WP_HOST=wp.app.example.com
FRONT_HOST=app.example.com

# WP admin
WP_ADMIN_USER=admin
WP_ADMIN_PASSWORD=<password_fuerte>
WP_ADMIN_EMAIL=ops@example.com

# MySQL
MYSQL_ROOT_PASSWORD=<password_fuerte>
MYSQL_PASSWORD=<password_fuerte>

# API key plugin AI Website Bridge (la misma en DEFAULT_WP_API_KEY de compose y .env del orchestrator)
DEFAULT_WP_API_KEY=aiw_<48_caracteres_aleatorios>

# LLM provider (uno de los 5)
LLM_PROVIDER=gemini
LLM_MODEL=gemini-3.1-pro-preview
GEMINI_API_KEY=<nueva_key_revocada>

# Secreto orchestrator
ORCHESTRATOR_MASTER_KEY=$(openssl rand -base64 32)
```

> **Importante**: `NEXT_PUBLIC_*` NO se pasan como env vars — vienen del `build.args` del compose, que se interpolan desde `${FRONT_HOST}`, `${LLM_MODEL}`, `${WP_HOST}`. No hay que hacer nada extra.

### 3.5 Deploy

1. Click **Deploy**.
2. Dokploy hace git pull → build de las 3 imágenes (`wordpress`, `wordpress-init`, `orchestrator`, `frontend`) → push a su registry interno → start.
3. La build tarda ~3-8 min la primera vez (depende de la red).
4. Mientras: ver logs en vivo del servicio `wordpress-init` hasta ver:
   ```
   🎉 WordPress inicializado.
   URL pública: https://wp.app.example.com
   API Key: aiw_****xxxx
   ```

---

## 4. Verificación post-deploy

### 4.1 Smoke tests (curl)

```bash
# 1. WordPress responde en HTTPS
curl -fsSL -o /dev/null -w '%{http_code}\n' https://wp.app.example.com/wp-login.php
# → 200

# 2. REST API del plugin responde con la key
curl -fsSL -H "X-AI-Agent-Key: $DEFAULT_WP_API_KEY" \
  https://wp.app.example.com/wp-json/ai-agent/v1/health
# → {"success": true, ...}

# 3. Frontend carga
curl -fsSL -o /dev/null -w '%{http_code}\n' https://app.example.com/
# → 200

# 4. Rewrite /api/* → orchestrator funciona
curl -fsSL https://app.example.com/api/health
# → {"success":true,"service":"ai-website-orchestrator",...}
```

Si (4) falla con 502 o timeout: el orchestrator no arrancó. Ver logs en Dokploy → service `orchestrator`.

### 4.2 Verificación desde el navegador

1. `https://wp.app.example.com/wp-admin` → login con `admin` / `${WP_ADMIN_PASSWORD}`.
2. **AI Bridge → API Keys** → debe haber una key llamada "Default Agent Key". El hash coincide con `${DEFAULT_WP_API_KEY}` (verificá comparando con `wp eval` desde terminal del container).
3. `https://app.example.com/` → dashboard del Next.js carga, el LLM badge muestra el modelo correcto, el chat funciona.

### 4.3 Verificar SSL

Let's Encrypt emite los certs al primer deploy. Forzar:

```bash
# Verificar cert
echo | openssl s_client -servername wp.app.example.com -connect wp.app.example.com:443 2>/dev/null | openssl x509 -noout -subject -dates
```

Si el cert es self-signed o de Dokploy staging, el certresolver no se llamó correctamente. Revisar labels Traefik en Dokploy → Service → Labels.

---

## 5. Actualizar el plugin AI Website Bridge

El plugin está bakeado en la imagen `wordpress`, así que cualquier cambio en `plugin/` requiere:

1. Commit + push de los cambios.
2. En Dokploy → Service → **Rebuild & Deploy** (sólo la imagen `wordpress` rebuildea, las demás se cachean).
3. `wp_data` se preserva: uploads, posts, opciones, API keys sobreviven.

> Si el cambio de plugin incluye migración de schema (nuevas tablas, nuevas options), agregar el script de migración a `docker/init-wordpress.sh` antes de rebuildear. El script es idempotente y se re-ejecuta en cada redeploy.

---

## 6. Rollback

- **Datos**: `wp_data`, `mysql_data`, `orchestrator_data` son volúmenes nombrados. `compose down` NO los borra (sólo `down -v`).
- **Código**: rebuild desde el commit previo en el branch. Si Dokploy guarda imágenes taggeadas, también se puede hacer rollback a una imagen anterior.

```bash
# Rollback completo (mantiene datos):
docker compose -f docker-compose.yml down
git checkout <commit_previo>
docker compose -f docker-compose.yml up -d --build
```

---

## 7. Troubleshooting

### Mixed-content warnings en el navegador

WordPress carga assets vía HTTP en vez de HTTPS.

- Verificar `${WP_URL}` en env vars del compose (debe ser `https://${WP_HOST}`).
- Forzar recarga: borrar `wp_options` siteurl/home (las escribe el init en cada run):
  ```php
  wp option get siteurl   // debe devolver https://wp.app.example.com
  wp option get home      // idem
  ```

### API key inválida desde el orchestrator

```bash
# Dentro del container orchestrator:
docker exec -it ai-agent-orchestrator sh
# No hay wp-cli acá. Verificar logs:
docker logs ai-agent-orchestrator | grep -i 'api\|auth'
```

Si la key cambió en WP pero no en `${DEFAULT_WP_API_KEY}` del orchestrator, sincronizarlas en el panel de Dokploy y redeploy.

### Orchestrator crashes con "zod error" o "API key missing"

Falta una env var del LLM provider elegido. Verificar:

```bash
docker exec ai-agent-orchestrator printenv | grep -E 'API_KEY|MODEL|PROVIDER'
```

### Plugin no aparece en `wp plugin list`

```bash
docker exec -it ai-agent-wordpress bash
wp plugin list --allow-root
```

Si `ai-website-bridge` no aparece: el COPY en `docker/Dockerfile.wordpress` falló. Rebuild sin caché:

```bash
docker compose -f docker-compose.yml build --no-cache wordpress
docker compose -f docker-compose.yml up -d
```

### Traefik no emite cert de Let's Encrypt

- Verificar que DNS resuelve a la IP del servidor: `dig wp.app.example.com`.
- Verificar que puerto 80 está abierto desde internet.
- En Dokploy → Service → Labels, los labels `certresolver=letsencrypt` deben estar. Si no, agregar manualmente.

### `network dokploy-network not found`

Crear manualmente desde Dokploy → Project → Settings → Networks, o desde CLI:

```bash
docker network create dokploy-network
```

---

## 8. Mantenimiento

### 8.1 Backup de MySQL

```bash
docker exec ai-agent-mysql mysqldump -uroot -p"${MYSQL_ROOT_PASSWORD}" wordpress | gzip > wp-$(date +%F).sql.gz
```

Restaurar:

```bash
gunzip -c wp-YYYY-MM-DD.sql.gz | docker exec -i ai-agent-mysql mysql -uroot -p"${MYSQL_ROOT_PASSWORD}" wordpress
```

### 8.2 Backup del SQLite del orchestrator

```bash
docker cp ai-agent-orchestrator:/data/orchestrator.db ./orchestrator-$(date +%F).db
```

### 8.3 Rotación de `ORCHESTRATOR_MASTER_KEY`

Si se filtra, regenerar con `openssl rand -base64 32`, actualizar la env var en Dokploy, y reiniciar el servicio `orchestrator`. Las claves API existentes siguen siendo válidas porque se hashean con `wp_hash_password` y no dependen del master key.

### 8.4 Logs

```bash
# Dokploy → Project → Logs (filtro por servicio)
make prod-logs                    # equivalente CLI local
```

---

## 9. Diferencias con dev (`docker-compose.dev.yml`)

| Aspecto                     | dev                              | prod (Dokploy)                            |
|-----------------------------|----------------------------------|-------------------------------------------|
| Plugin WP                   | volume mount `./plugin`          | bakeado en imagen `wordpress`             |
| Orchestrator runtime        | `tsx src/index.ts`               | `node dist/index.js` (compilado)          |
| Frontend runtime            | `next dev`                       | `next start` sobre output `standalone`    |
| Init script                 | `scripts/init-wordpress.sh` (v1) | `docker/init-wordpress.sh` (v2 idempotente) |
| `wp-config.php`             | sobrescrito con salts placeholder | NO se sobrescribe; salts de WP             |
| API keys                    | `update_option` (pisa)           | merge (`array_push` con dedup)            |
| `siteurl`/`home`            | `http://localhost:8000`          | `https://${WP_HOST}` desde env            |
| Proxy HTTPS                 | ninguno                          | Traefik + Let's Encrypt                   |
| Red Docker                  | `ai-agent-net` (driver bridge)   | `dokploy-network` (external)              |
| `NEXT_PUBLIC_*`             | env var de runtime (no funciona) | build args en compose                     |
| Credenciales DB             | `wordpress`/`wordpress`           | env vars del panel                        |

---

## 10. Estructura de archivos relevantes

```
ai-website-agent/
├── docker-compose.yml             ← ESTE para Dokploy
├── docker-compose.dev.yml         ← dev local (NO usar en Dokploy)
├── docker/
│   ├── Dockerfile.wordpress       ← FROM wordpress:6.6-php8.3-apache + plugin bakeado
│   ├── Dockerfile.init            ← FROM wordpress:cli-php8.3 (one-shot)
│   ├── Dockerfile.orchestrator    ← multi-stage tsc → node dist/index.js
│   ├── Dockerfile.frontend        ← multi-stage next build → standalone
│   └── init-wordpress.sh          ← v2 idempotente
├── .dockerignore                  ← excluye vendor/, *.mp4, .env, etc.
├── .env.example                   ← referencia de TODAS las env vars
└── docs/
    └── DOKPLOY.md                 ← este archivo
```