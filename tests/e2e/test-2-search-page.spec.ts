/**
 * E2E Test 2 — SRS §42 Test 2: "Busca una página por nombre"
 *
 * Verifica que el agente puede encontrar una página específica por título.
 * El usuario pide "busca la página Servicios" y el agente responde con la página correcta.
 *
 * Pre-requisitos:
 *   - docker-compose up corriendo.
 *   - Sitio registrado con páginas de ejemplo (Inicio, Nosotros, Servicios, Contacto).
 */

import { test, expect } from '@playwright/test';

test.describe('SRS §42 — Acceptance Criteria', () => {
  test('Test 2: Chat encuentra una página específica por nombre', async ({ page }) => {
    await page.goto('/');

    const firstSite = page.locator('a[href^="/sites/"]').first();
    if (await firstSite.count() === 0) {
      test.skip(true, 'No sites connected.');
    }
    await firstSite.click();

    const chat = page.locator('textarea');
    await expect(chat).toBeVisible({ timeout: 10_000 });

    // Buscar página específica.
    await chat.fill('Busca la página Servicios');
    await chat.press('Enter');

    // El LLM debería responder mencionando "Servicios" (con su ID).
    // Aceptamos cualquier respuesta que incluya el nombre de la página buscada
    // o el formato "id=N, status=...".
    await expect(
      page.locator('text=/Servicios.*id=|Servicios\\s*\\(id=\\d+\\)/i').first()
    ).toBeVisible({ timeout: 30_000 });
  });
});
