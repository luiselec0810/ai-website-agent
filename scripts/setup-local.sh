#!/bin/bash
# ─────────────────────────────────────────────────────────────────
# setup-local.sh
# Script de auto-setup para Local. Ejecutar en Local Site Shell.
# Se encarga de:
#   1. Instalar el plugin AI Website Bridge
#   2. Activarlo
#   3. Crear API Key
#   4. Flush rewrite rules
# ─────────────────────────────────────────────────────────────────
set -e

cd /app/public

echo "⏳ Esperando a que WordPress responda..."
until wp core is-installed --allow-root 2>/dev/null; do
  sleep 3
done
echo "✅ WordPress responde."

echo ""
echo "📦 Instalando plugin AI Website Bridge (si no existe)..."
if [ ! -d wp-content/plugins/ai-website-bridge ]; then
  mkdir -p wp-content/plugins/ai-website-bridge
  echo "  → Pegando manualmente con WP-CLI no es trivial, hazlo vía admin o sube el zip."
  echo "  → Luego corre este script de nuevo."
fi

echo ""
echo "📦 Activando AI Website Bridge..."
wp plugin activate ai-website-bridge --allow-root 2>/dev/null || echo "  ⚠️  Activa manualmente desde WP Admin primero"

echo ""
echo "🔑 Creando API Key..."
API_KEY="aiw_$(openssl rand -hex 32 2>/dev/null || echo "$(date +%s)_local")"
# Fallback para Windows (donde openssl puede no estar): usar timestamp
API_KEY="${API_KEY}_local"

wp eval "
update_option('ai_agent_api_keys', [
  [
    'key_hash' => wp_hash_password('${API_KEY}'),
    'user_id'  => 1,
    'label'    => 'Local setup script',
    'created'  => current_time('mysql'),
  ]
]);
" --allow-root

echo ""
echo "🔄 Flush rewrite rules..."
wp rewrite flush --allow-root

echo ""
echo "════════════════════════════════════════════════════════════"
echo "🎉 Setup completado."
echo "════════════════════════════════════════════════════════════"
echo ""
echo "  📍 WordPress:     http://localhost:PUERTO (ver app)"
echo "  🔑 API Key:       ${API_KEY}"
echo ""
echo "Pegala en: ai-website-agent/orchestrator/.env → DEFAULT_WP_API_KEY"
echo "════════════════════════════════════════════════════════════"
echo "${API_KEY}" > /tmp/ai-agent-api-key.txt
echo "  💾 También guardada en /tmp/ai-agent-api-key.txt"
