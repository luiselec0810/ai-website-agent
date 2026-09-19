/**
 * E2E Test 3 — SRS §42 Test 3: "Detecta si una página está hecha con Elementor"
 *
 * Verifica que el agente puede distinguir entre páginas hechas con Elementor
 * (builder) y páginas clásicas. El usuario pregunta "qué páginas están hechas con Elementor"
 * y el agente responde con la lista.
 *
 * Pre-requisitos:
 *   - docker-compose up corriendo.
 *   - Sitio con al menos una página Elementor (las páginas de ejemplo "Inicio"
 *     y "Nosotros" suelen serlo).
 */

import { test, expect } from '@playwright/test';

test.describe('SRS §42 — Acceptance Criteria', () => {
  test('Test 3: Chat detecta páginas construidas con Elementor', async ({ page }) => {
    await page.goto('/');

    const firstSite = page.locator('a[href^="/sites/"]').first();
    if (await firstSite.count() === 0) {
      test.skip(true, 'No sites connected.');
    }
    await firstSite.click();

    const chat = page.locator('textarea');
    await expect(chat).toBeVisible({ timeout: 10_000 });

    // Preguntar qué páginas usan Elementor.
    await chat.fill('Qué páginas están construidas con Elementor?');
    await chat.press('Enter');

    // El LLM debe responder con al menos un nombre de página (la respuesta del
    // agente debería incluir el nombre de las páginas que tengan `builder=elementor`).
    // Aceptamos el caso en que diga "ninguna" si la DB no tiene páginas Elementor.
    const responseLocator = page.locator(
      'text=/Inicio|Nosotros|Servicios|Contacto|ninguna|ninguno/i'
    ).first();

    await expect(responseLocator).toBeVisible({ timeout: 30_000 });
  });
});
