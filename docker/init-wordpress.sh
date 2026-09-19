#!/bin/bash
# ─────────────────────────────────────────────────────────────────
# init-wordpress.sh — v2 (idempotente, Dokploy-safe)
#
# Aimed at production behind Traefik:
#   - Runs as ROOT (see Dockerfile.init) so we can read/write wp-config.php
#     regardless of its current owner. The wordpress entrypoint may not
#     have finished chown'ing files to www-data when init starts.
#   - Never overwrites wp-config.php if it already exists.
#   - Uses ${WP_URL} (env, from compose) for siteurl/home — corrects
#     the http://localhost default that wp core install writes.
#   - API keys are merged (not replaced) — admin-created keys survive
#     redeploys.
#   - Every step is guarded with an idempotency check.
#   - At the end, chowns everything back to www-data so the wordpress
#     service (running as www-data) can write uploads/etc.
#
# Env vars consumed:
#   WP_URL, WP_TITLE, WP_ADMIN_USER, WP_ADMIN_PASSWORD, WP_ADMIN_EMAIL,
#   DEFAULT_WP_API_KEY, WORDPRESS_DB_HOST, WORDPRESS_DB_USER,
#   WORDPRESS_DB_PASSWORD, WORDPRESS_DB_NAME
# ─────────────────────────────────────────────────────────────────
set -euo pipefail

cd /var/www/html

log() { echo "[init] $*"; }
mask_key() {
  local k="$1"
  if [ -z "$k" ]; then echo "(empty)"; return; fi
  echo "${k:0:8}****${k: -4}"
}

# ─────────────────────────────────────────────────────────────────
# Paso 1: esperar a wp-config.php (lo genera el entrypoint upstream)
# ─────────────────────────────────────────────────────────────────
log "Esperando wp-config.php (≤ 120 s)..."
for i in $(seq 1 60); do
  if [ -f wp-config.php ]; then
    log "wp-config.php existe."
    break
  fi
  sleep 2
done

if [ ! -f wp-config.php ]; then
  log "ERROR: wp-config.php no apareció tras 120 s."
  exit 1
fi

# ─────────────────────────────────────────────────────────────────
# Paso 2: validar / completar wp-config.php sin sobrescribir
# ─────────────────────────────────────────────────────────────────
# El entrypoint oficial genera wp-config.php desde $WORDPRESS_DB_*.
# Si por algún motivo faltan las constantes, las añadimos SIN tocar
# las salts (que WordPress genera aleatorias en primer arranque).
if ! grep -q "DB_NAME" wp-config.php; then
  log "wp-config.php incompleto — generando con wp config create..."
  wp config create \
    --dbname="${WORDPRESS_DB_NAME:-wordpress}" \
    --dbuser="${WORDPRESS_DB_USER:-wordpress}" \
    --dbpass="${WORDPRESS_DB_PASSWORD:-wordpress}" \
    --dbhost="${WORDPRESS_DB_HOST:-mysql}" \
    --dbcharset=utf8mb4 \
    --allow-root \
    --skip-check \
    --force
fi

# Inyectar $WP_URL en wp-config.php si aún no está (siteurl + home +
# FORCE_SSL_ADMIN + reverse-proxy awareness). Usamos un marcador único
# para no duplicar si se corre de nuevo.
MARKER="/* AI-WEBSITE-BRIDGE-PROXY-CONFIG */"
if ! grep -q "$MARKER" wp-config.php; then
  log "Inyectando config de proxy en wp-config.php..."
  WP_URL_VALUE="${WP_URL_VALUE:-${WP_URL:-http://wordpress}}"
  cat >> wp-config.php <<PHP

$MARKER
define('WP_SITEURL', '${WP_URL_VALUE}');
define('WP_HOME',    '${WP_URL_VALUE}');
define('FORCE_SSL_ADMIN', true);
if (isset(\$_SERVER['HTTP_X_FORWARDED_PROTO']) && \$_SERVER['HTTP_X_FORWARDED_PROTO'] === 'https') {
    \$_SERVER['HTTPS'] = 'on';
}
PHP
fi

# ─────────────────────────────────────────────────────────────────
# Paso 3: esperar a MySQL y verificar conexión
# ─────────────────────────────────────────────────────────────────
log "Verificando conexión a MySQL..."
log "  DB_HOST=${WORDPRESS_DB_HOST:-<unset>} DB_USER=${WORDPRESS_DB_USER:-<unset>} DB_NAME=${WORDPRESS_DB_NAME:-<unset>}"
log "  wp-config.php DB_HOST=$(grep -oE "DB_HOST.*'[^']*'" wp-config.php | head -1 || echo 'no encontrado')"
log "  wp-config.php DB_USER=$(grep -oE "DB_USER.*'[^']*'" wp-config.php | head -1 || echo 'no encontrado')"
for i in $(seq 1 30); do
  if wp db check --allow-root >/dev/null 2>&1; then
    log "Conexión DB OK."
    break
  fi
  if [ "$i" = "30" ]; then
    log "ERROR: no se pudo conectar a MySQL tras 60 s."
    log "Output completo de wp db check:"
    wp db check --allow-root 2>&1 || true
    log "Output de wp db query 'SELECT 1':"
    wp db query 'SELECT 1' --allow-root 2>&1 || true
    exit 1
  fi
  sleep 2
done

# ─────────────────────────────────────────────────────────────────
# Paso 4: instalar WordPress (si no lo está) usando $WP_URL
# ─────────────────────────────────────────────────────────────────
WP_URL_VALUE="${WP_URL_VALUE:-${WP_URL:-http://wordpress}}"

if ! wp core is-installed --allow-root 2>/dev/null; then
  log "Instalando WordPress en ${WP_URL_VALUE}..."
  wp core install \
    --url="${WP_URL_VALUE}" \
    --title="${WP_TITLE:-AI Agent Demo Site}" \
    --admin_user="${WP_ADMIN_USER:-admin}" \
    --admin_password="${WP_ADMIN_PASSWORD:-admin}" \
    --admin_email="${WP_ADMIN_EMAIL:-admin@example.com}" \
    --skip-email \
    --allow-root
  log "WordPress instalado."
else
  log "WordPress ya estaba instalado."
fi

# ─────────────────────────────────────────────────────────────────
# Paso 5: forzar siteurl/home = $WP_URL y reescribir reglas
# ─────────────────────────────────────────────────────────────────
log "Sincronizando siteurl/home con ${WP_URL_VALUE}..."
wp option update siteurl "${WP_URL_VALUE}" --allow-root >/dev/null
wp option update home    "${WP_URL_VALUE}" --allow-root >/dev/null
wp rewrite flush --hard --allow-root >/dev/null

# ─────────────────────────────────────────────────────────────────
# Paso 6: activar plugins (idempotente)
# ─────────────────────────────────────────────────────────────────
log "Activando AI Website Bridge..."
wp plugin activate ai-website-bridge --allow-root 2>/dev/null || true

log "Instalando/activando Elementor..."
wp plugin install elementor --activate --allow-root 2>/dev/null \
  || log "Elementor ya estaba instalado."

# ─────────────────────────────────────────────────────────────────
# Paso 7: páginas de ejemplo (idempotente)
# ─────────────────────────────────────────────────────────────────
log "Creando páginas de ejemplo..."
for TITLE in "Inicio" "Nosotros" "Servicios" "Contacto"; do
  if ! wp post list --post_type=page --title="$TITLE" --format=ids --allow-root 2>/dev/null | grep -q .; then
    wp post create --post_title="$TITLE" --post_status=publish --post_type=page --allow-root >/dev/null
  fi
done
if ! wp post list --post_type=page --title="Promociones" --format=ids --allow-root 2>/dev/null | grep -q .; then
  wp post create --post_title="Promociones" --post_status=draft --post_type=page --allow-root >/dev/null
fi

for PAGE_ID in $(wp post list --post_type=page --format=ids --allow-root 2>/dev/null); do
  wp post meta update "$PAGE_ID" _elementor_edit_mode    "builder"    --allow-root 2>/dev/null || true
  wp post meta update "$PAGE_ID" _elementor_template_type "wp-page"   --allow-root 2>/dev/null || true
  wp post meta update "$PAGE_ID" _elementor_version      "3.20.0"    --allow-root 2>/dev/null || true
done
log "Páginas OK."

# ─────────────────────────────────────────────────────────────────
# Paso 8: API key — MERGE (no replace)
# ─────────────────────────────────────────────────────────────────
API_KEY="${DEFAULT_WP_API_KEY:-}"
if [ -z "$API_KEY" ]; then
  log "WARN: DEFAULT_WP_API_KEY no seteada — saltando creación de key."
else
  log "Asegurando API Key del AI Agent (merge idempotente)..."
  wp eval "
    \$existing = get_option('ai_agent_api_keys', []);
    if (!is_array(\$existing)) { \$existing = []; }
    \$raw = getenv('DEFAULT_WP_API_KEY');
    if (!\$raw) { echo 'No API key provided.'; return; }
    \$hash = wp_hash_password(\$raw);
    foreach (\$existing as \$k) {
      if (isset(\$k['key_hash']) && \$k['key_hash'] === \$hash) {
        echo 'API key ya existía — no se duplica.';
        return;
      }
    }
    \$existing[] = [
      'key_hash' => \$hash,
      'user_id'  => 1,
      'label'    => 'Default Agent Key',
      'created'  => current_time('mysql'),
      'last_used'=> null,
    ];
    update_option('ai_agent_api_keys', \$existing);
    echo 'API key agregada (' . count(\$existing) . ' total).';
  " --allow-root
fi

# ─────────────────────────────────────────────────────────────────
# Paso 9: log final
# ─────────────────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════════════════════"
echo "🎉 WordPress inicializado."
echo "════════════════════════════════════════════════════════════"
echo "  URL pública: ${WP_URL_VALUE}"
echo "  Admin:       ${WP_URL_VALUE}/wp-admin"
echo "  REST:        ${WP_URL_VALUE}/wp-json/ai-agent/v1/"
echo "  API Key:     $(mask_key "$API_KEY")"
echo "════════════════════════════════════════════════════════════"

# Chown everything to www-data so the wordpress service (running as www-data
# after its entrypoint) can manage uploads, plugins, etc.
chown -R www-data:www-data /var/www/html || log "WARN: chown falló (no crítico)"
log "Permisos ajustados a www-data:www-data."