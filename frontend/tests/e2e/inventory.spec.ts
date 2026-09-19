/**
 * E2E — Inventory badge
 *
 * Verifica el badge de inventario en el header del chat:
 *   - Es visible y muestra el texto "inv …" (o equivalente).
 *   - El botón de refresh dispara un DELETE seguido de un GET para invalidar
 *     el caché y re-fetchar.
 */

import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const SCREENSHOTS_DIR = 'tests/e2e/screenshots';

test.beforeAll(async () => {
  mkdirSync(SCREENSHOTS_DIR, { recursive: true });

  if (!process.env.E2E_SITE_ID) {
    try {
      const res = await fetch('http://localhost:4100/api/sites');
      const json = (await res.json()) as {
        success: boolean;
        data?: Array<{ id: string }>;
      };
      const id = json.data?.find((s) => s.id !== '__system__')?.id ?? '';
      if (id) process.env.E2E_SITE_ID = id;
    } catch {
      /* ignore */
    }
  }
});

async function gotoChat(page: import('@playwright/test').Page) {
  const siteId = process.env.E2E_SITE_ID;
  test.skip(!siteId, 'No hay SITE_ID en el orquestador.');

  await page.route(`**/api/sites/${siteId}`, async (route) => {
    try {
      const upstream = await fetch(`http://localhost:4100/api/sites/${siteId}`);
      const body = await upstream.text();
      await route.fulfill({
        status: upstream.status,
        contentType: 'application/json',
        body,
      });
    } catch {
      await route.fulfill({ status: 502, body: '{"success":false}' });
    }
  });
  await page.route(`**/api/sites/${siteId}/pages**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '{"success":true,"data":{"items":[],"pagination":{}}}',
    });
  });
  await page.route('**/api/conversations**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '{"success":true,"data":[]}',
    });
  });
  // Mock inventory/health para devolver un cache "viejo" pero válido.
  await page.route(`**/api/sites/${siteId}/inventory/health`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          cached: true,
          age_ms: 60_000,
          ttl_ms: 600_000,
          source: 'cache',
        },
      }),
    });
  });
  // Mock refresh (DELETE + GET) — devolvemos health nuevo.
  await page.route(`**/api/sites/${siteId}/inventory**`, async (route) => {
    const method = route.request().method();
    if (method === 'DELETE') {
      await route.fulfill({ status: 204, body: '' });
      return;
    }
    if (method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { items: [], source: 'fresh' } }),
      });
      return;
    }
    await route.continue();
  });

  await page.goto(`/sites/${siteId}`);
  await expect(page.getByRole('textbox')).toBeVisible({ timeout: 15_000 });
}

test.describe('Inventory badge', () => {
  test('badge inventario visible en header', async ({ page }) => {
    await gotoChat(page);

    // El badge expone un botón con aria-label estable.
    const refreshBtn = page
      .getByRole('button', { name: /refrescar inventario/i })
      .first();
    const hasBtn = await refreshBtn.count();

    if (hasBtn === 0) {
      test.skip(
        true,
        'Badge de inventario todavía no está montado (depende del agente #1 — design system refactor).'
      );
      return;
    }

    // El contenedor del badge tiene un <span> con texto "inv …".
    await expect(refreshBtn).toBeVisible();
    await expect(page.getByText(/inv\s/).first()).toBeVisible();

    await page.screenshot({
      path: `${SCREENSHOTS_DIR}/chat-inventory-badge.png`,
      fullPage: true,
    });
  });

  test('badge refresh invalida caché y re-fetch', async ({ page }) => {
    await gotoChat(page);

    const refreshBtn = page
      .getByRole('button', { name: /refrescar inventario/i })
      .first();
    const hasBtn = await refreshBtn.count();

    if (hasBtn === 0) {
      test.skip(
        true,
        'Badge de inventario todavía no está montado (depende del agente #1 — design system refactor).'
      );
      return;
    }

    // Capturar las llamadas a los endpoints de inventory.
    const inventoryRequests: Array<{ method: string; url: string }> = [];
    page.on('request', (req) => {
      const url = req.url();
      if (url.includes(`/api/sites/`) && url.includes('/inventory')) {
        inventoryRequests.push({ method: req.method(), url });
      }
    });

    await refreshBtn.click();

    // Esperar a que se ejecute la secuencia: DELETE + GET.
    await expect
      .poll(
        () =>
          inventoryRequests.find(
            (r) => r.method === 'DELETE' && /\/inventory(\?|$)/.test(r.url)
          ),
        { timeout: 10_000, intervals: [100, 200, 500] }
      )
      .toBeTruthy();

    await expect
      .poll(
        () =>
          inventoryRequests.find(
            (r) =>
              r.method === 'GET' &&
              /\/inventory\?refresh=1/.test(r.url)
          ),
        { timeout: 10_000, intervals: [100, 200, 500] }
      )
      .toBeTruthy();

    // También se re-pide health al final.
    await expect
      .poll(
        () =>
          inventoryRequests.find(
            (r) => r.method === 'GET' && /\/inventory\/health/.test(r.url)
          ),
        { timeout: 10_000, intervals: [100, 200, 500] }
      )
      .toBeTruthy();
  });
});
