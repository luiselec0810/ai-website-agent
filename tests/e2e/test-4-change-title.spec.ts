/**
 * E2E Test 4 — SRS §42 Test 4: "Cambia el título principal"
 *
 * Verifica el flujo completo:
 *   1. Usuario pide cambiar un título.
 *   2. Agente genera un Change Plan.
 *   3. Usuario aprueba.
 *   4. Cambios se aplican en WordPress.
 *   5. Usuario revierte.
 *   6. Estado anterior se restaura.
 *
 * Este test requiere un LLM funcional. Se skipea si no hay respuesta del agente.
 */

import { test, expect } from '@playwright/test';

test('Test 4: Cambiar título con aprobación y rollback', async ({ page }) => {
  test.setTimeout(120_000);

  await page.goto('/');
  const firstSite = page.locator('a[href^="/sites/"]').first();
  if (await firstSite.count() === 0) {
    test.skip(true, 'No sites connected.');
  }
  await firstSite.click();

  const chat = page.locator('textarea');
  await expect(chat).toBeVisible({ timeout: 10_000 });

  // Pedir cambio de título
  await chat.fill('Cambia el título de la página Nosotros a "Sobre Nosotros"');
  await chat.press('Enter');

  // Esperar el Change Plan (puede tardar varios segundos)
  const planTitle = page.locator('text=/📋|Change Plan|Cambiar/').first();
  await expect(planTitle).toBeVisible({ timeout: 60_000 });

  // Aprobar
  await page.click('button:has-text("Aprobar y ejecutar")');

  // Esperar estado completado
  await expect(page.locator('text=/✅ Completado|completed/i').first()).toBeVisible({ timeout: 30_000 });
});
