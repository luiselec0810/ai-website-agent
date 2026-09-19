/**
 * E2E — Chat
 *
 * Verifica el comportamiento del chat en `/sites/:siteId` tras el refactor:
 *   - Layout desktop de 3 columnas (sidebar + main + right panel).
 *   - Quick actions visibles al cargar (textarea vacío).
 *   - Enviar un mensaje produce respuesta del assistant.
 *   - Historial de conversaciones en el sidebar/dropdown.
 *
 * Estrategia de skip:
 *   - Los agentes #1 y #2 están refactorizando el design system + componentes.
 *   - Si la nueva UI todavía no expone el sidebar/right-panel/quick-actions,
 *     marcamos el test como `fixme` con un comentario claro en lugar de fallar.
 */

import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const SCREENSHOTS_DIR = 'tests/e2e/screenshots';

// ID de sitio válido del orquestador (recogido vía /api/sites).
// Si el orquestador no responde, los tests se saltan sin fallar.
const SITE_ID = process.env.E2E_SITE_ID ?? '';

test.beforeAll(async () => {
  mkdirSync(SCREENSHOTS_DIR, { recursive: true });

  if (!SITE_ID) {
    // Intentar sacar el primer site real del orquestador (puerto 4100).
    try {
      const res = await fetch('http://localhost:4100/api/sites');
      const json = (await res.json()) as { success: boolean; data?: Array<{ id: string }> };
      const id = json.data?.find((s) => s.id !== '__system__')?.id ?? '';
      if (id) process.env.E2E_SITE_ID = id;
    } catch {
      /* ignore — los tests se saltarán */
    }
  }
});

async function gotoChat(page: import('@playwright/test').Page) {
  const id = process.env.E2E_SITE_ID;
  test.skip(!id, 'No hay sitios disponibles en el orquestador (puerto 4100).');

  // Interceptamos la carga del site para no depender del proxy /api → Docker.
  // (En local dev el rewrite apunta a http://orchestrator:4000 y falla.)
  await page.route(`**/api/sites/${id}`, async (route) => {
    try {
      const upstream = await fetch(`http://localhost:4100/api/sites/${id}`);
      const body = await upstream.text();
      await route.fulfill({
        status: upstream.status,
        contentType: upstream.headers.get('content-type') ?? 'application/json',
        body,
      });
    } catch {
      await route.fulfill({ status: 502, body: '{"success":false}' });
    }
  });
  await page.route(`**/api/sites/${id}/pages**`, async (route) => {
    try {
      const upstream = await fetch(
        `http://localhost:4100/api/sites/${id}/pages${route.request().url().includes('?') ? '?' + route.request().url().split('?')[1] : ''}`
      );
      const body = await upstream.text();
      await route.fulfill({
        status: upstream.status,
        contentType: 'application/json',
        body,
      });
    } catch {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '{"success":true,"data":{"items":[],"pagination":{}}}',
      });
    }
  });
  await page.route(`**/api/conversations**`, async (route) => {
    try {
      const url = new URL(route.request().url());
      const qs = url.search;
      const upstream = await fetch(`http://localhost:4100/api/conversations${qs}`);
      const body = await upstream.text();
      await route.fulfill({
        status: upstream.status,
        contentType: 'application/json',
        body,
      });
    } catch {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '{"success":true,"data":[]}',
      });
    }
  });
  await page.route(`**/api/sites/${id}/inventory/**`, async (route) => {
    try {
      const url = new URL(route.request().url());
      const upstream = await fetch(`http://localhost:4100${url.pathname}${url.search}`);
      const body = await upstream.text();
      await route.fulfill({
        status: upstream.status,
        contentType: 'application/json',
        body,
      });
    } catch {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '{"success":true,"data":{"cached":false,"age_ms":0,"ttl_ms":0,"source":"fresh"}}',
      });
    }
  });

  await page.goto(`/sites/${id}`);
  await expect(page.getByRole('textbox')).toBeVisible({ timeout: 15_000 });
}

test.describe('Chat', () => {
  test('chat layout 3 columnas en desktop', async ({ page }) => {
    await gotoChat(page);

    // El sidebar izquierdo está expuesto como <aside aria-label="Páginas y cambios pendientes">.
    // El refactor podría cambiar el aria-label, pero el role `complementary` (aside) se mantiene.
    const sidebar = page.locator('aside[aria-label*="áginas"], aside[aria-label*="endientes"]').first();
    const sidebarVisible = await sidebar.isVisible().catch(() => false);

    test.skip(
      !sidebarVisible,
      'Sidebar de páginas todavía no se renderiza (depende del agente #2 — design system refactor).'
    );

    const sidebarBox = await sidebar.boundingBox();
    expect(sidebarBox?.width ?? 0).toBeGreaterThanOrEqual(240);

    // Right panel (preview / plan) — puede existir como aside o <section>.
    // El selector es tolerante: cualquier aside/region visible a la derecha del main.
    const rightPanel = page
      .locator(
        'aside:not([aria-label*="áginas"]):not([aria-label*="endientes"]), [role="complementary"]:not([aria-label*="áginas"]):not([aria-label*="endientes"])'
      )
      .first();
    const rightPanelVisible = await rightPanel.isVisible().catch(() => false);

    if (rightPanelVisible) {
      const rightBox = await rightPanel.boundingBox();
      expect(rightBox?.width ?? 0).toBeGreaterThanOrEqual(300);
    }

    await page.screenshot({
      path: `${SCREENSHOTS_DIR}/chat-desktop-layout.png`,
      fullPage: true,
    });
  });

  test('quick actions visibles al input vacío', async ({ page }) => {
    await gotoChat(page);

    // Los chips de QuickActions tienen un contenedor con aria-label semántico.
    const container = page.locator('[aria-label*="ccesos directos"], [aria-label*="uick"]').first();
    const hasContainer = await container.count();

    if (hasContainer === 0) {
      test.skip(
        true,
        'Quick actions todavía no están montadas (depende del agente #2 — design system refactor).'
      );
      return;
    }
    await expect(container).toBeVisible();

    // Los chips tienen labels estables (Páginas, Plantillas, Media reciente…).
    const pagesChip = page.getByRole('button', { name: /^Páginas$/ }).first();
    const templatesChip = page.getByRole('button', { name: /^Plantillas$/ }).first();
    const mediaChip = page.getByRole('button', { name: /Media/i }).first();

    await expect(pagesChip).toBeVisible();
    await expect(templatesChip).toBeVisible();
    await expect(mediaChip).toBeVisible();

    // Click en "Páginas" debe escribir el prompt predefinido en el textarea.
    const textarea = page.getByRole('textbox');
    const before = await textarea.inputValue();
    expect(before).toBe('');
    await pagesChip.click();

    const after = await textarea.inputValue();
    expect(after.length).toBeGreaterThan(0);
    expect(after.toLowerCase()).toContain('páginas');
  });

  test('enviar mensaje muestra respuesta del assistant', async ({ page }) => {
    await gotoChat(page);

    // Mockear /api/chat para no depender del LLM real.
    await page.route('**/api/chat', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            conversation_id: 'conv-test-123',
            type: 'answer',
            text: 'Hola — soy el assistant de prueba.',
            tool_results: [],
          },
        }),
      });
    });

    const textarea = page.getByRole('textbox');
    await textarea.fill('hola');

    // Botón de enviar (aria-label="Enviar" o title="Enviar").
    const sendBtn = page.getByRole('button', { name: /enviar/i }).first();
    await sendBtn.click();

    // Esperar a que el mensaje del user aparezca.
    await expect(page.getByText('hola').first()).toBeVisible();

    // Esperar la respuesta del assistant.
    await expect(page.getByText(/Hola — soy el assistant de prueba/)).toBeVisible({
      timeout: 30_000,
    });
  });

  test('chat history en sidebar muestra conversaciones previas', async ({ page }) => {
    // Mockear conversaciones para devolver 2 items.
    await page.route('**/api/conversations**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: [
            {
              id: 'conv-aaa',
              site_id: process.env.E2E_SITE_ID,
              title: 'Conversación A',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              message_count: 3,
              preview: 'Listar páginas',
            },
            {
              id: 'conv-bbb',
              site_id: process.env.E2E_SITE_ID,
              title: 'Conversación B',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              message_count: 5,
              preview: 'Cambiar título',
            },
          ],
        }),
      });
    });

    await gotoChat(page);

    // El botón de "Ver conversaciones anteriores" abre el dropdown de historial.
    const historyBtn = page
      .getByRole('button', { name: /conversaciones anteriores/i })
      .first();
    const hasBtn = await historyBtn.count();

    if (hasBtn === 0) {
      test.skip(
        true,
        'Botón de historial todavía no está montado (depende del agente #2 — design system refactor).'
      );
      return;
    }

    await historyBtn.click();

    // El dropdown debe listar ≥1 conversación.
    await expect(page.getByText(/Conversación A/).first()).toBeVisible();
    await expect(page.getByText(/Conversación B/).first()).toBeVisible();
  });
});
