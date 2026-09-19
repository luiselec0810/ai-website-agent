#!/usr/bin/env bash
#
# sync-plugin-to-local.sh — Copia los archivos PHP modificados al plugin
# instalado en LocalWP.
#
# USO:
#   bash scripts/sync-plugin-to-local.sh                 # auto-detecta site
#   bash scripts/sync-plugin-to-local.sh <site-name>      # explícito
#
# IMPORTANTE:
#   - LocalWP NO recarga automáticamente el plugin cuando editas PHP.
#   - En Local, basta refrescar el navegador para que WP recargue el plugin.
#   - Este script NO toca LocalWP; solo sincroniza archivos.
#
# POR QUÉ EXISTE:
#   El código fuente vive en `ai-website-agent/plugin/`.
#   LocalWP lee desde `<site>/app/public/wp-content/plugins/ai-website-bridge/`.
#   Sin este script, los cambios solo viven en el source y nunca se prueban en WP.
#
# ALTERNATIVA MEJOR A FUTURO: configurar un symlink en LocalWP que apunte
# directamente al source. Ver AGENT.md sección "LocalWP sync".

set -e

# ─────────────────────────────────────────────────────────────────
# Config
# ─────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
SOURCE_DIR="$PROJECT_ROOT/plugin"
LOCAL_SITES_DIR="$HOME/Local Sites"

# Detectar site name si no se pasa argumento.
if [ $# -ge 1 ]; then
  SITE_NAME="$1"
else
  # Auto-detectar: tomar el primer directorio en Local Sites que tenga
  # el plugin ai-website-bridge instalado.
  SITE_NAME=""
  for dir in "$LOCAL_SITES_DIR"/*/; do
    if [ -d "$dir/app/public/wp-content/plugins/ai-website-bridge" ]; then
      SITE_NAME="$(basename "$dir")"
      break
    fi
  done

  if [ -z "$SITE_NAME" ]; then
    echo "❌ No se encontró un site de Local con el plugin ai-website-bridge."
    echo "   Pasa el site name como argumento:"
    echo "   bash scripts/sync-plugin-to-local.sh mi-site-name"
    echo ""
    echo "   Sites disponibles en $LOCAL_SITES_DIR:"
    ls "$LOCAL_SITES_DIR" 2>/dev/null || echo "   (ninguno)"
    exit 1
  fi
fi

PLUGIN_DST="$LOCAL_SITES_DIR/$SITE_NAME/app/public/wp-content/plugins/ai-website-bridge"

if [ ! -d "$PLUGIN_DST" ]; then
  echo "❌ Plugin no encontrado en: $PLUGIN_DST"
  echo "   Verifica que el site '$SITE_NAME' existe en LocalWP."
  exit 1
fi

echo "═══════════════════════════════════════════════════════════"
echo "  Sync plugin → LocalWP"
echo "  Source: $SOURCE_DIR"
echo "  Dest:   $PLUGIN_DST"
echo "═══════════════════════════════════════════════════════════"
echo ""

# ─────────────────────────────────────────────────────────────────
# Detectar archivos modificados vs destino
# ─────────────────────────────────────────────────────────────────
changed=()
new_files=()
identical=()

# Comparar cada archivo PHP en source.
while IFS= read -r -d '' src_file; do
  rel_path="${src_file#$SOURCE_DIR/}"
  dst_file="$PLUGIN_DST/$rel_path"

  if [ -f "$dst_file" ]; then
    if ! cmp -s "$src_file" "$dst_file"; then
      changed+=("$rel_path")
    else
      identical+=("$rel_path")
    fi
  else
    new_files+=("$rel_path")
  fi
done < <(find "$SOURCE_DIR" -name "*.php" -type f -print0)

# Mostrar resumen.
echo "📊 Cambios detectados:"
echo "   ${#changed[@]} archivos modificados"
echo "   ${#new_files[@]} archivos nuevos"
echo "   ${#identical[@]} idénticos (omitidos)"
echo ""

if [ ${#changed[@]} -eq 0 ] && [ ${#new_files[@]} -eq 0 ]; then
  echo "✅ Nada que sincronizar."
  exit 0
fi

# ─────────────────────────────────────────────────────────────────
# Confirmar
# ─────────────────────────────────────────────────────────────────
if [ ${#changed[@]} -gt 0 ]; then
  echo "Archivos modificados:"
  for f in "${changed[@]}"; do
    echo "  M  $f"
  done
fi
if [ ${#new_files[@]} -gt 0 ]; then
  echo "Archivos nuevos:"
  for f in "${new_files[@]}"; do
    echo "  A  $f"
  done
fi
echo ""

read -p "¿Copiar al plugin de Local? [y/N] " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Cancelado."
  exit 0
fi

# ─────────────────────────────────────────────────────────────────
# Copiar
# ─────────────────────────────────────────────────────────────────
copied=0
for f in "${changed[@]}" "${new_files[@]}"; do
  src="$SOURCE_DIR/$f"
  dst="$PLUGIN_DST/$f"
  mkdir -p "$(dirname "$dst")"
  cp "$src" "$dst"
  echo "  ✓ $f"
  copied=$((copied + 1))
done

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  ✅ $copied archivos copiados."
echo ""
echo "  Próximos pasos:"
echo "  1. Refresca el navegador en http://${SITE_NAME// /}.local (o el puerto"
echo "     que use tu site: probablemente 10010)."
echo "  2. WordPress recarga automáticamente el plugin PHP en cada request."
echo "  3. Si el plugin no aparece actualizado, en WP Admin → Plugins →"
echo "     desactivar y volver a activar ai-website-bridge."
echo "═══════════════════════════════════════════════════════════"
