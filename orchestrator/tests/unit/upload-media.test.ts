/**
 * Test de regresión — gap G6.
 *
 * `upload_media` debe:
 *   1. Estar registrado en el tool registry (antes faltaba).
 *   2. Enviar `multipart/form-data` al plugin (no JSON).
 *   3. Adjuntar el archivo con su filename + MIME type.
 *   4. Propagar errores como WpError.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getTool } from '../../src/tools/index.js';
import type { WpSite } from '../../src/executor/wp-client.js';

const site: WpSite = {
  id: 'site-1',
  name: 'Test Site',
  url: 'http://elementor-ia.local',
  apiKey: 'aiw_test_key_xxx',
};

describe('G6 regression — upload_media sends multipart/form-data', () => {
  let tmpDir: string;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'upload-test-'));
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('is registered in tool registry', () => {
    const tool = getTool('upload_media');
    expect(tool).toBeDefined();
    expect(tool!.name).toBe('upload_media');
    expect(tool!.input_schema.required).toContain('file_path');
  });

  it('sends multipart/form-data with file, filename and MIME type', async () => {
    const filePath = join(tmpDir, 'logo.png');
    writeFileSync(filePath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])); // PNG header
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 201,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            success: true,
            data: { id: 42, title: 'logo.png', mime_type: 'image/png', url: 'http://x/logo.png' },
          })
        ),
    });

    const tool = getTool('upload_media')!;
    const result = await tool.execute(
      site,
      { file_path: filePath, title: 'Custom Title', alt: 'My logo', change_id: 'ch-up-001' },
      'ch-up-001'
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchMock.mock.calls[0];
    expect(String(calledUrl)).toContain('/wp-json/ai-agent/v1/media');
    expect(calledInit.method).toBe('POST');
    expect(calledInit.headers['Content-Type']).toMatch(/^multipart\/form-data; boundary=/);
    expect(calledInit.headers['X-AI-Agent-Key']).toBe('aiw_test_key_xxx');
    expect(calledInit.headers['X-AI-Agent-Change-Id']).toBe('ch-up-001');

    // Body debe ser Buffer (no string JSON).
    expect(Buffer.isBuffer(calledInit.body)).toBe(true);
    const bodyStr = (calledInit.body as Buffer).toString('utf-8');
    expect(bodyStr).toContain('filename="logo.png"');
    expect(bodyStr).toContain('Content-Type: image/png');
    expect(bodyStr).toContain('Custom Title');

    expect((result as { id: number }).id).toBe(42);
  });

  it('throws WpError INVALID_REQUEST when file_path is missing', async () => {
    const tool = getTool('upload_media')!;
    await expect(tool.execute(site, { file_path: '' }, undefined)).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws WpError FILE_READ_ERROR when file does not exist', async () => {
    const tool = getTool('upload_media')!;
    await expect(
      tool.execute(site, { file_path: join(tmpDir, 'does-not-exist.png') }, undefined)
    ).rejects.toMatchObject({ code: 'FILE_READ_ERROR' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('propagates plugin errors as WpError', async () => {
    const filePath = join(tmpDir, 'big.jpg');
    writeFileSync(filePath, Buffer.from([0xff, 0xd8, 0xff]));
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 413,
      text: () =>
        Promise.resolve(
          JSON.stringify({ success: false, error: { code: 'FILE_TOO_LARGE', message: 'File exceeds upload limit' } })
        ),
    });

    const tool = getTool('upload_media')!;
    await expect(tool.execute(site, { file_path: filePath }, undefined)).rejects.toMatchObject({
      code: 'FILE_TOO_LARGE',
    });
  });
});
