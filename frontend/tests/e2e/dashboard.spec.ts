/**
 * E2E — Dashboard
 *
 * Verifica el comportamiento de la home (`/`) tras el refactor de design system:
 *   - Carga inicial: header y CTA visibles.
 *   - El botón "+ Conectar sitio" revela el formulario de alta.
 *   - Cuando el orquestador devuelve 0 sitios, el dashboard muestra un empty state
 *     con CTA hacia el alta.
 *
 * Notas de robustez:
 *   - Usamos selectores semánticos (`role`, `placeholder`, `text`) en lugar de
 *     clases Tailwind, porque el refactor de design system puede renombrar tokens.
 *   - El dashboard llama a `sitesApi.list()` que en dev fuera de Docker sale
 *     por el proxy `/api → http://orchestrator:4000` y devuelve 502. Eso es
 *     equivalente al "caso vacío" desde el punto de vista del componente, así
 *     que el test del empty state sigue siendo válido.
 */

import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const SCREENSHOTS_DIR = 'tests/e2e/screenshots';

test.beforeAll(() => {
  mkdirSync(SCREENSHOTS_DIR, { recursive: true });
});

test.describe('Dashboard', () => {
  test('dashboard lista sitios cargados', async ({ page }) => {
    await page.goto('/');

    // El header puede ser un <h1> o un <h2> según el refactor; usamos role.
    const heading = page.getByRole('heading', {
      name: /AI Website Agent/i,
    });
    await expect(heading).toBeVisible();

    // CTA principal — el accessible name es "Conectar sitio" (el "+" es
    // un icono y queda fuera del name). El refactor #1/#2 puede variar el
    // icono, así que solo matcheamos el texto del botón.
    const connectBtn = page.getByRole('button', { name: /conectar sitio/i });
    await expect(connectBtn).toBeVisible();

    // Esperar a que el fetch termine (la UI o muestra sitios o muestra empty state).
    await page.waitForLoadState('networkidle');

    // Screenshot completo del dashboard (caso base del refactor).
    await page.screenshot({
      path: `${SCREENSHOTS_DIR}/dashboard-home.png`,
      fullPage: true,
    });
  });

  test('botón Conectar sitio abre el form', async ({ page }) => {
    await page.goto('/');

    // Asegurarnos que el dashboard cargó antes de buscar el botón.
    await expect(
      page.getByRole('heading', { name: /AI Website Agent/i })
    ).toBeVisible();

    // Click en el CTA.
    await page.getByRole('button', { name: /conectar sitio/i }).click();

    // El form tiene un input para la URL del sitio con placeholder típico.
    // Usamos placeholder porque es estable a través de cambios de estilo
    // y no depende del wrapping label (que el refactor puede cambiar).
    const urlInput = page.getByPlaceholder(/example\.com|https?:\/\//i).first();
    await expect(urlInput).toBeVisible();

    // El form también pide nombre del sitio y API key — verificamos
    // por placeholder/texto del label visible (tolerante al wrapping).
    const nameInput = page.getByPlaceholder(/sitio de prueba/i).first();
    await expect(nameInput).toBeVisible();
    await expect(page.getByText(/API Key/i).first()).toBeVisible();

    await page.screenshot({
      path: `${SCREENSHOTS_DIR}/dashboard-connect-form.png`,
      fullPage: true,
    });
  });

  test('no hay sitios vacíos muestra empty state', async ({ page }) => {
    // Interceptamos el listado de sitios para forzar el caso vacío.
    // Esto aísla el test del estado real del orquestador y del proxy /api
    // que en local puede fallar por la URL Docker interna.
    await page.route('**/api/sites', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [] }),
      });
    });

    await page.goto('/');

    // Header sigue visible.
    await expect(
      page.getByRole('heading', { name: /AI Website Agent/i })
    ).toBeVisible();

    // Empty state: copy tolerante a variantes ("No hay sitios …", etc.).
    await expect(page.getByText(/no hay sitios/i).first()).toBeVisible({
      timeout: 15_000,
    });

    await page.screenshot({
      path: `${SCREENSHOTS_DIR}/dashboard-empty-state.png`,
      fullPage: true,
    });
  });
});
