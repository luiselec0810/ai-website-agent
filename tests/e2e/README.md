# E2E Tests — SRS §42 Acceptance Criteria

> **Estado:** 7 de 7 acceptance tests cubiertos. Todos los specs siguen el patrón "skip si no hay sitio" para no fallar en entornos sin Docker.

## Specs

| # | Archivo | Escenario SRS §42 | Tiempo típico | Skip si… |
|---|---------|--------------------|--------------|----------|
| 1 | [test-1-list-pages.spec.ts](test-1-list-pages.spec.ts) | Lista las páginas del sitio | ~30s | No hay sitio |
| 2 | [test-2-search-page.spec.ts](test-2-search-page.spec.ts) | Busca una página por nombre | ~30s | No hay sitio |
| 3 | [test-3-detect-elementor.spec.ts](test-3-detect-elementor.spec.ts) | Detecta si página está hecha con Elementor | ~30s | No hay sitio |
| 4 | [test-4-change-title.spec.ts](test-4-change-title.spec.ts) | Cambia el título con aprobación | ~120s | No hay sitio |
| 5 | [test-5-duplicate-page.spec.ts](test-5-duplicate-page.spec.ts) | Duplica una página (UI + API REST check) | ~120s | No hay sitio |
| 6 | [test-6-add-button.spec.ts](test-6-add-button.spec.ts) | Agrega un botón con texto específico (UI + API check) | ~120s | No hay sitio |
| 7 | [test-7-rollback.spec.ts](test-7-rollback.spec.ts) | Rollback restaura estado anterior | ~10s | No hay changes |

## Patrón de los tests

Todos los specs siguen este patrón:

```typescript
import { test, expect } from '@playwright/test';

test('Test N: ...', async ({ page }) => {
  test.setTimeout(120_000);  // Si requiere LLM

  await page.goto('/');

  // Skip si no hay sitios conectados.
  const firstSite = page.locator('a[href^="/sites/"]').first();
  if (await firstSite.count() === 0) {
    test.skip(true, 'No sites connected.');
  }
  await firstSite.click();

  const chat = page.locator('textarea');
  await expect(chat).toBeVisible({ timeout: 10_000 });

  await chat.fill('<mensaje en español>');
  await chat.press('Enter');

  // Esperar respuesta del LLM.
  await expect(page.locator('text=/.../').first()).toBeVisible({ timeout: 30_000 });
});
```

## Tests secundarios (5b, 6b)

Los tests #5 y #6 tienen un "Test Nb" adicional que verifica via REST API directa que el cambio realmente se aplicó:

- **5b**: `/api/sites/{id}/pages` debe contener una página con título que matchee "Servicios" o "Copia de".
- **6b**: `/api/sites/{id}/pages/{id}/elementor` debe contener un widget `button` con texto "Contáctenos".

Estos tests son útiles cuando el flujo UI pasa pero queremos confirmar persistencia real.

## Cómo correrlos

```bash
cd ai-website-agent/tests/e2e
npx playwright install chromium  # Solo la primera vez
npm test                         # Suite completa
npm run test:ui                  # Modo interactivo
npm run test:headed              # Ver el browser
npx playwright test --grep "Test 5"  # Solo un test
```

### Pre-requisitos

1. **WordPress + Elementor + Elementor Pro** corriendo (LocalWP en `http://elementor-ia.local` o Docker en `:8000`).
2. **Orchestrator** corriendo en `:4000`.
3. **Frontend Next.js** corriendo en `:3000`.
4. **Sitio registrado** en el orchestrator (ejecutar `bash scripts/init-wordpress.sh`).
5. **LLM provider configurado** en `orchestrator/.env` (Anthropic, OpenAI, Ollama local, MiniMax, o Gemini).
6. **Páginas de ejemplo**: Inicio, Nosotros, Servicios, Contacto (las crea `init-wordpress.sh`).

## Configuración

`playwright.config.ts`:

```typescript
{
  baseURL: 'http://localhost:3000',
  use: { browserName: 'chromium', headless: true },
  timeout: 30_000,
  retries: 0,
}
```

## Limitaciones

- **Tests dependientes de LLM** (1, 2, 3, 4, 5a, 6a) requieren un provider funcional. Si Ollama no responde, esos tests pueden tardar mucho.
- **Tests de mutación** (4, 5a, 6a) **modifican datos reales** en LocalWP. Se recomienda limpiar antes/después o usar un sitio de tests dedicado.
- **No hay cleanup automático**: el test-4 deja el título cambiado, el test-5 deja páginas duplicadas, el test-6 deja un botón nuevo. Se puede mitigar ejecutando test-7 (rollback) después, pero los tests 5/6 no generan snapshot automático (gap G1 solo cubre update_page).
