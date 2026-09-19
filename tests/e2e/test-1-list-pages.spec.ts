/**
 * E2E Test 1 — SRS §42 Test 1: "Lista las páginas de mi sitio"
 *
 * Verifica que el agente responde con la lista de páginas cuando el usuario lo pide.
 *
 * Pre-requisitos:
 *   - docker-compose up corriendo (WordPress en :8000, Orchestrator en :4000, Frontend en :3000).
 *   - LLM provider configurado en .env.
 */

import { test, expect } from '@playwright/test';

test.describe('SRS §42 — Acceptance Criteria', () => {
  test('Test 1: Chat lista las páginas del sitio', async ({ page }) => {
    await page.goto('/');

    // Verificar que la página principal carga
    await expect(page.getByRole('heading', { name: /AI Website Agent/ })).toBeVisible();

    // Si hay sitios conectados, entrar al primero
    const firstSite = page.locator('a[href^="/sites/"]').first();
    if (await firstSite.count() === 0) {
      test.skip(true, 'No sites connected. Run init-wordpress.sh and register a site first.');
    }
    await firstSite.click();

    // Esperar al chat
    const chat = page.locator('textarea');
    await expect(chat).toBeVisible({ timeout: 10_000 });

    // Enviar mensaje pidiendo lista de páginas
    await chat.fill('Lista las páginas de mi sitio');
    await chat.press('Enter');

    // El LLM debería responder mencionando algunas de las páginas de ejemplo.
    // El test es tolerante: solo verifica que el chat responde con algo.
    await expect(page.locator('text=/Inicio|Nosotros|Servicios|Contacto/i').first()).toBeVisible({ timeout: 30_000 });
  });
});
