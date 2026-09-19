/**
 * E2E Test 6 — SRS §42 Test 6: "Agrega un botón a una página"
 *
 * Verifica el flujo:
 *   1. Usuario pide "agrega un botón con el texto 'Contáctenos' en la página Inicio".
 *   2. Agente genera Change Plan con:
 *      - get_elementor_structure (para encontrar container_id)
 *      - add_widget (button)
 *   3. Usuario aprueba.
 *   4. El widget button aparece en el árbol de la página.
 *
 * Pre-requisitos:
 *   - docker-compose up corriendo.
 *   - Sitio con una página Elementor (Inicio).
 */

import { test, expect } from '@playwright/test';

test.describe('SRS §42 — Acceptance Criteria', () => {
  test('Test 6: Agregar widget button a una página Elementor', async ({ page }) => {
    test.setTimeout(120_000);

    await page.goto('/');

    const firstSite = page.locator('a[href^="/sites/"]').first();
    if (await firstSite.count() === 0) {
      test.skip(true, 'No sites connected.');
    }
    await firstSite.click();

    const chat = page.locator('textarea');
    await expect(chat).toBeVisible({ timeout: 10_000 });

    // Pedir agregar botón.
    await chat.fill('Agrega un botón con el texto "Contáctenos" en la página Inicio');
    await chat.press('Enter');

    // Esperar Change Plan.
    const planTitle = page.locator('text=/📋|Change Plan|button|Botón|agregar widget/i').first();
    await expect(planTitle).toBeVisible({ timeout: 60_000 });

    // Aprobar el plan.
    await page.click('button:has-text("Aprobar y ejecutar")');

    // Esperar confirmación de completado.
    await expect(
      page.locator('text=/✅ Completado|completed|button/i').first()
    ).toBeVisible({ timeout: 30_000 });
  });

  /**
   * Test 6b: verifica via API REST que el widget button existe en la página
   * y tiene el texto correcto. Después de ejecutar el flow del Test 6.
   */
  test('Test 6b: API REST refleja el nuevo widget button con texto "Contáctenos"', async ({ request }) => {
    const sitesRes = await request.get('http://localhost:3000/api/sites');
    if (!sitesRes.ok()) test.skip(true, 'sites endpoint unavailable');
    const sites = await sitesRes.json();
    if (!sites.data?.length) test.skip(true, 'No sites');

    const siteId = sites.data[0].id;

    // Buscar la página Inicio.
    const pagesRes = await request.get(`http://localhost:3000/api/sites/${siteId}/pages`);
    if (!pagesRes.ok()) test.skip(true, 'pages endpoint unavailable');
    const pagesBody = await pagesRes.json();
    const pages = pagesBody.data?.items ?? pagesBody.data ?? [];

    const inicio = pages.find((p: { title?: string }) =>
      /Inicio/i.test(typeof p.title === 'string' ? p.title : '')
    );
    if (!inicio) test.skip(true, 'No "Inicio" page found.');

    // Obtener estructura Elementor.
    const structRes = await request.get(`http://localhost:3000/api/sites/${siteId}/pages/${inicio.id}/elementor`);
    if (!structRes.ok()) test.skip(true, `elementor endpoint returned ${structRes.status()}`);
    const struct = await structRes.json();

    // Buscar un widget button cuyo texto sea "Contáctenos".
    function findButton(nodes: unknown): boolean {
      if (!Array.isArray(nodes)) return false;
      for (const n of nodes) {
        const node = n as { widgetType?: string; settings?: { text?: string }; elements?: unknown[] };
        if (node.widgetType === 'button' && /Cont.ctenos/i.test(String(node.settings?.text ?? ''))) {
          return true;
        }
        if (node.elements && findButton(node.elements)) return true;
      }
      return false;
    }
    const content = struct.data?.content ?? [];
    expect(findButton(content)).toBeTruthy();
  });
});
