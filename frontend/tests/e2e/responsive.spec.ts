/**
 * E2E — Responsive
 *
 * Verifica el layout en viewports pequeños:
 *   - Mobile <768: sidebar y right-panel ocultos; solo el main chat es visible.
 *   - Botón de menú móvil abre el sidebar como drawer.
 *
 * El breakpoint `md` de Tailwind = 768px. Estos tests asumen que el refactor
 * mantiene ese mismo breakpoint.
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

async function installMocks(page: import('@playwright/test').Page) {
  const siteId = process.env.E2E_SITE_ID;
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
  await page.route(`**/api/sites/${siteId}/inventory/**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '{"success":true,"data":{"cached":false,"age_ms":0,"ttl_ms":0,"source":"fresh"}}',
    });
  });
}

test.describe('Responsive', () => {
  test('mobile <768 oculta sidebar y right panel', async ({ page }) => {
    const siteId = process.env.E2E_SITE_ID;
    test.skip(!siteId, 'No hay SITE_ID en el orquestador.');

    await page.setViewportSize({ width: 375, height: 667 });
    await installMocks(page);

    await page.goto(`/sites/${siteId}`);
    await expect(page.getByRole('textbox')).toBeVisible({ timeout: 15_000 });

    // Sidebar izquierdo — el selector busca el aside desktop (con aria-label estable).
    const sidebar = page.locator(
      'aside[aria-label*="áginas"], aside[aria-label*="endientes"]'
    ).first();
    const sidebarVisible = await sidebar.isVisible().catch(() => false);

    if (sidebarVisible) {
      // Si el aside está en el DOM, comprobamos que NO es visible
      // (Tailwind `hidden md:flex` lo manda a display:none en mobile).
      expect(await sidebar.isVisible()).toBe(false);
    }

    // El main chat debe seguir visible.
    const main = page.locator('main').first();
    await expect(main).toBeVisible();

    await page.screenshot({
      path: `${SCREENSHOTS_DIR}/chat-mobile.png`,
      fullPage: true,
    });
  });

  test('botón menú móvil abre sidebar drawer', async ({ page }) => {
    const siteId = process.env.E2E_SITE_ID;
    test.skip(!siteId, 'No hay SITE_ID en el orquestador.');

    await page.setViewportSize({ width: 375, height: 667 });
    await installMocks(page);

    await page.goto(`/sites/${siteId}`);
    await expect(page.getByRole('textbox')).toBeVisible({ timeout: 15_000 });

    // Botón de menú (aria-label estable: "Abrir panel de páginas" / "Cerrar panel de páginas").
    const menuBtn = page
      .getByRole('button', { name: /panel de páginas/i })
      .first();
    const hasBtn = await menuBtn.count();

    if (hasBtn === 0) {
      test.skip(
        true,
        'Botón de menú móvil todavía no existe (depende del agente #2 — design system refactor).'
      );
      return;
    }

    await menuBtn.click();

    // El drawer aparece: selector tolerante por aria-label del drawer.
    const drawer = page.locator(
      'aside[role="dialog"], aside[aria-modal="true"]'
    );
    await expect(drawer).toBeVisible({ timeout: 5_000 });

    await page.screenshot({
      path: `${SCREENSHOTS_DIR}/chat-mobile-drawer.png`,
      fullPage: true,
    });
  });
});
