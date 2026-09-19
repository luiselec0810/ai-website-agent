#!/usr/bin/env bash
#
# smoke.sh — Smoke test del sistema AI Website Agent.
#
# Verifica:
#   1. Health del orchestrator y del plugin WP.
#   2. Tools de lectura (list_pages, search_media, list_templates, design-system, audit).
#   3. Auth (sin API key → 403 FORBIDDEN).
#   4. Error codes correctos en IDs inválidos.
#
# Requisitos: WP corriendo en elementor-ia.local, orchestrator en :4000.
#
# Uso:
#   bash scripts/smoke.sh
#   DEFAULT_WP_URL=http://localhost bash scripts/smoke.sh
#
# Salida: "Passed: N  Failed: M" + exit code = M.

set -u

WP_URL="${DEFAULT_WP_URL:-http://elementor-ia.local}"
WP_KEY="${DEFAULT_WP_API_KEY:-}"
ORCH="${DEFAULT_ORCH_URL:-http://localhost:4000}"

if [[ -z "$WP_KEY" ]]; then
  echo "ERROR: DEFAULT_WP_API_KEY env var required." >&2
  echo "  Generate one in WP Admin → Settings → AI Website Bridge." >&2
  exit 2
fi

PASS=0
FAIL=0

check() {
  local name="$1"
  local expect_substr="$2"
  shift 2
  local out
  local code
  out="$("$@" 2>&1)"
  code=$?
  if [[ $code -eq 0 ]] && echo "$out" | grep -q "$expect_substr"; then
    echo "  PASS  $name"
    PASS=$((PASS + 1))
  else
    echo "  FAIL  $name (exit=$code)"
    echo "        expected: '$expect_substr'"
    echo "        got:      $(echo "$out" | head -3 | tr '\n' ' ')"
    FAIL=$((FAIL + 1))
  fi
}

check_status() {
  local name="$1"
  local expect_http="$2"
  shift 2
  local code
  code=$("$@" 2>/dev/null)
  if [[ "$code" == "$expect_http" ]]; then
    echo "  PASS  $name (HTTP $code)"
    PASS=$((PASS + 1))
  else
    echo "  FAIL  $name (expected HTTP $expect_http, got $code)"
    FAIL=$((FAIL + 1))
  fi
}

echo "════════════════════════════════════════════════════════════════"
echo "  AI Website Agent — Smoke Test"
echo "  WP:   $WP_URL"
echo "  Orch: $ORCH"
echo "════════════════════════════════════════════════════════════════"

echo ""
echo "[1] Health checks"
check "orchestrator /health" '"success":true' \
  curl -fsS --max-time 5 "$ORCH/health"

check "plugin /health" 'elementor_installed' \
  curl -fsS --max-time 5 -H "X-AI-Agent-Key: $WP_KEY" "$WP_URL/wp-json/ai-agent/v1/health"

echo ""
echo "[2] Read tools"
check "list_pages" '"data":' \
  curl -fsS --max-time 10 -H "X-AI-Agent-Key: $WP_KEY" "$WP_URL/wp-json/ai-agent/v1/pages?per_page=3"

check "search_media" '"items":' \
  curl -fsS --max-time 10 -H "X-AI-Agent-Key: $WP_KEY" "$WP_URL/wp-json/ai-agent/v1/media?per_page=3"

check "list_templates" '"data":' \
  curl -fsS --max-time 10 -H "X-AI-Agent-Key: $WP_KEY" "$WP_URL/wp-json/ai-agent/v1/templates"

check "design-system" '"colors":' \
  curl -fsS --max-time 10 -H "X-AI-Agent-Key: $WP_KEY" "$WP_URL/wp-json/ai-agent/v1/design-system"

check "audit log" '"success":true' \
  curl -fsS --max-time 10 -H "X-AI-Agent-Key: $WP_KEY" "$WP_URL/wp-json/ai-agent/v1/audit?limit=3"

echo ""
echo "[3] Auth / Error codes"
check_status "auth missing key" 403 \
  curl -sS -o /dev/null -w '%{http_code}' --max-time 5 \
  "$WP_URL/wp-json/ai-agent/v1/pages"

check_status "bad page id" 404 \
  curl -sS -o /dev/null -w '%{http_code}' --max-time 5 \
  -H "X-AI-Agent-Key: $WP_KEY" "$WP_URL/wp-json/ai-agent/v1/pages/99999999"

check_status "wrong api key" 403 \
  curl -sS -o /dev/null -w '%{http_code}' --max-time 5 \
  -H "X-AI-Agent-Key: aiw_wrong_key" "$WP_URL/wp-json/ai-agent/v1/pages"

echo ""
echo "════════════════════════════════════════════════════════════════"
echo "  Passed: $PASS  Failed: $FAIL"
echo "════════════════════════════════════════════════════════════════"
exit $FAIL
