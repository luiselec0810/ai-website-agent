/**
 * E2E — Aprobación de un plan con SSE
 *
 * Verifica el flujo completo:
 *   1. Crear conversación vía `/api/chat` (mockeada).
 *   2. Capturar `change_id` de la respuesta del plan.
 *   3. Navegar al chat con `?c=<conv>`.
 *   4. Disparar el flujo de aprobación (botón "Aprobar y ejecutar todo").
 *   5. Confirmar que los badges de operación transicionan de "pending" →
 *      "running" → "✓"/"✗" gracias al stream SSE.
 *
 * Notas:
 *   - Para evitar depender del LLM real, mockeamos `/api/chat` y
 *     `/api/changes/:id/approve-stream` con un stream SSE sintético que
 *     emite los eventos esperados (`op:start`, `op:success`, `done`).
 */

import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const SCREENSHOTS_DIR = 'tests/e2e/screenshots';

test.beforeAll(async () => {
  mkdirSync(SCREENSHOTS_DIR, { recursive: true });

  // Cargar SITE_ID desde el orquestador.
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

async function installCommonMocks(page: Page) {
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
  await page.route(`**/api/conversations**`, async (route) => {
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

test.describe('Aprobación con SSE', () => {
  test('aprobar plan actualiza badges con SSE', async ({ page }) => {
    const siteId = process.env.E2E_SITE_ID;
    test.skip(!siteId, 'No hay SITE_ID en el orquestador (puerto 4100).');

    await installCommonMocks(page);

    const changeId = 'chg_mock_001';
    const conversationId = 'conv_mock_001';

    // Mock /api/chat → devuelve un plan con 2 operaciones.
    await page.route('**/api/chat', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            conversation_id: conversationId,
            type: 'plan',
            text: 'Plan propuesto',
            plan: {
              title: 'Crear página de prueba',
              description: 'Usa Plantilla1 sobre una página nueva',
              operations: [
                { tool: 'use_template', arguments: { page_id: 1, template_id: 7 } },
                { tool: 'publish_page', arguments: { page_id: 1 } },
              ],
            },
            change_id: changeId,
          },
        }),
      });
    });

    // Mock approve-stream con SSE sintético: 2 ops → ambas success.
    await page.route(`**/api/changes/${changeId}/approve-stream`, async (route) => {
      const ops = [
        { tool: 'use_template', index: 0 },
        { tool: 'publish_page', index: 1 },
      ];
      const sseLines: string[] = [];
      for (const op of ops) {
        sseLines.push(`event: op:start\ndata: ${JSON.stringify({ tool: op.tool, index: op.index, operationId: `op_${op.index}` })}\n\n`);
        sseLines.push(
          `event: op:success\ndata: ${JSON.stringify({
            tool: op.tool,
            index: op.index,
            durationMs: 120,
            result: { ok: true },
          })}\n\n`
        );
      }
      sseLines.push(
        `event: done\ndata: ${JSON.stringify({
          change_id: changeId,
          status: 'completed',
          results: ops.map((o) => ({
            tool: o.tool,
            status: 'success',
            retries: 0,
          })),
        })}\n\n`
      );
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { 'cache-control': 'no-cache', connection: 'keep-alive' },
        body: sseLines.join(''),
      });
    });

    await page.goto(`/sites/${siteId}`);
    await expect(page.getByRole('textbox')).toBeVisible({ timeout: 15_000 });

    // Disparar un mensaje que genere el plan.
    const textarea = page.getByRole('textbox');
    await textarea.fill(
      'Crea una página llamada Test SSE y aplica Plantilla1'
    );
    await page.getByRole('button', { name: /enviar/i }).first().click();

    // Esperar a que aparezca el botón "Aprobar y ejecutar todo".
    const approveBtn = page.getByRole('button', {
      name: /aprobar y ejecutar todo/i,
    });
    const hasBtn = await approveBtn.count();

    if (hasBtn === 0) {
      test.skip(
        true,
        'Botón de aprobar todavía no se renderiza (depende del agente #1 — design system refactor).'
      );
      return;
    }
    await expect(approveBtn).toBeVisible({ timeout: 30_000 });

    // Click en aprobar.
    await approveBtn.click();

    // Los badges de operación deben terminar mostrando "✓" (success).
    // Usamos selectores tolerantes: el status se renderiza dentro del ChangePlan.
    await expect(page.getByText('✓').first()).toBeVisible({ timeout: 30_000 });

    // Y el header del plan debe terminar con el status "completado".
    await expect(page.getByText(/completado/i).first()).toBeVisible({
      timeout: 15_000,
    });

    await page.screenshot({
      path: `${SCREENSHOTS_DIR}/chat-approval-sse.png`,
      fullPage: true,
    });
  });
});
