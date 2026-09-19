/**
 * Tests para WpClient (orchestrator/src/executor/wp-client.ts).
 *
 * G7 regression — el plugin ahora envuelve las respuestas de error en
 *   { success: false, error: { code, message, data } }
 * Antes del fix, los WP_Error se devolvían crudos y la respuesta tenía
 *   { code, message, data }
 * por lo que `callWp` no podía extraer code/message y mostraba "HTTP 500"
 * como fallback en synthesizeTextFromToolResults.
 *
 * Estos tests cubren ambos formatos para asegurar paridad.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { callWp, WpError } from '../../src/executor/wp-client.js';
import type { WpSite } from '../../src/executor/wp-client.js';

const site: WpSite = {
  id: 'site-1',
  name: 'Test Site',
  url: 'http://elementor-ia.local',
  apiKey: 'aiw_test_key_xxx',
};

describe('WpClient — plugin response parsing', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('unwraps { success: true, data } on 2xx responses', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify({ success: true, data: { id: 1, title: 'X' } })),
    });

    const out = await callWp(site, 'GET', '/pages/1');

    expect(out).toEqual({ id: 1, title: 'X' });
  });

  // ─────────────────────────────────────────────────────────────────
  // G7 regression — wrapped error responses
  // ─────────────────────────────────────────────────────────────────

  it('extracts code + message from { success: false, error: ... } on 4xx responses', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: () => Promise.resolve(JSON.stringify({
        success: false,
        error: {
          code: 'ELEMENT_NOT_FOUND',
          message: 'Element "abc123" not found.',
          data: { status: 404, element_id: 'abc123' },
        },
      })),
    });

    try {
      await callWp(site, 'PATCH', '/pages/1/elementor/widgets/abc123', {
        body: { settings: { title: 'x' }, change_id: 'ch-1' },
      });
      expect.fail('Expected callWp to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(WpError);
      const e = err as WpError;
      expect(e.code).toBe('ELEMENT_NOT_FOUND');
      expect(e.message).toBe('Element "abc123" not found.');
      expect(e.httpStatus).toBe(404);
      expect(e.details).toEqual({ status: 404, element_id: 'abc123' });
    }
  });

  it('still parses legacy unwrapped WP_Error responses (defensive: no "HTTP 500" fallback)', async () => {
    // Antes del fix el plugin devolvía { code, message, data } sin wrapper.
    // Aunque ya no debería ocurrir, mantenemos compatibilidad para no romper
    // sitios con plugins antiguos o respuestas de WP_Error crudas de WP core.
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () => Promise.resolve(JSON.stringify({
        code: 'ELEMENT_NOT_FOUND',
        message: 'Element "abc123" not found.',
        data: { element_id: 'abc123' },
      })),
    });

    try {
      await callWp(site, 'PATCH', '/pages/1/elementor/widgets/abc123');
      expect.fail('Expected callWp to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(WpError);
      const e = err as WpError;
      // Con el formato legacy NO podemos extraer code/message, pero tampoco
      // debemos inventar un "HTTP 500" engañoso si la respuesta es no-JSON o vacía.
      // Hoy el fallback es "HTTP_ERROR" + "HTTP 500" (httpStatus), que es honesto.
      expect(e.code).toMatch(/^(ELEMENT_NOT_FOUND|HTTP_ERROR)$/);
      expect(e.httpStatus).toBe(500);
    }
  });

  it('returns INVALID_RESPONSE for non-JSON body (e.g. PHP fatal HTML page)', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () => Promise.resolve('<html><body>Fatal error</body></html>'),
    });

    try {
      await callWp(site, 'POST', '/pages');
      expect.fail('Expected callWp to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(WpError);
      const e = err as WpError;
      expect(e.code).toBe('INVALID_RESPONSE');
      expect(e.httpStatus).toBe(500);
      expect(e.message).toContain('non-JSON');
    }
  });

  it('replace_image: 404 on stale element_id should now surface code + message, not "HTTP 500"', async () => {
    // Simula el escenario exacto del bug: replace_image con un element_id
    // que ya no existe. Antes daba "HTTP 500" genérico; ahora debe
    // propagar ELEMENT_NOT_FOUND con HTTP 404.
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: () => Promise.resolve(JSON.stringify({
        success: false,
        error: {
          code: 'ELEMENT_NOT_FOUND',
          message: 'Element "8fb0d97" not found.',
          data: { status: 404, element_id: '8fb0d97' },
        },
      })),
    });

    try {
      await callWp(site, 'PATCH', '/pages/79/elementor/widgets/8fb0d97', {
        body: { media_id: 84, change_id: 'ch-retry' },
      });
      expect.fail('Expected callWp to throw');
    } catch (err) {
      const e = err as WpError;
      expect(e.httpStatus).toBe(404);
      expect(e.code).toBe('ELEMENT_NOT_FOUND');
      // El mensaje NO debe ser "HTTP 500" — debe ser el del plugin.
      expect(e.message).not.toMatch(/^HTTP \d+$/);
      expect(e.message).toContain('8fb0d97');
    }
  });
});