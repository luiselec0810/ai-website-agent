/**
 * Test de regresión — gap G7.
 *
 * `replace_image` debe enviar `media_id` en el BODY del PATCH, no como query param.
 * El plugin's `update_widget` resuelve `body.media_id` y construye `settings.image = {id, url}`.
 * Antes del fix, `media_id` se enviaba como query string y se ignoraba silenciosamente,
 * por lo que el reemplazo de imagen nunca ocurría.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getTool } from '../../src/tools/index.js';
import type { WpSite } from '../../src/executor/wp-client.js';

const site: WpSite = {
  id: 'site-1',
  name: 'Test Site',
  url: 'http://elementor-ia.local',
  apiKey: 'aiw_test_key_xxx',
};

describe('G7 regression — replace_image sends media_id in body', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends PATCH to /pages/{page_id}/elementor/widgets/{element_id} with media_id in body', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify({ success: true, data: { id: 'img1', updated: true } })),
    });

    const tool = getTool('replace_image');
    expect(tool).toBeDefined();

    await tool!.execute(
      site,
      {
        page_id: 42,
        element_id: 'abc1234',
        media_id: 999,
        change_id: 'ch-test-001',
      },
      'ch-test-001'
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchMock.mock.calls[0];
    expect(String(calledUrl)).toContain('/wp-json/ai-agent/v1/pages/42/elementor/widgets/abc1234');
    expect(calledInit.method).toBe('PATCH');
    expect(calledInit.headers['X-AI-Agent-Key']).toBe('aiw_test_key_xxx');

    const body = JSON.parse(calledInit.body);
    expect(body.media_id).toBe(999);
    expect(body.change_id).toBe('ch-test-001');
    expect(calledUrl).not.toContain('media_id=');
    expect(calledUrl).not.toContain('change_id=');
  });

  it('does NOT include media_id in query string (regression: previously leaked there)', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify({ success: true, data: { id: 'img1' } })),
    });

    const tool = getTool('replace_image')!;
    await tool.execute(site, { page_id: 1, element_id: 'abc1234', media_id: 7 }, 'ch-test-002');

    const [calledUrl] = fetchMock.mock.calls[0];
    expect(String(calledUrl)).not.toMatch(/[?&]media_id=/);
  });
});
