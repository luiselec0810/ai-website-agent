/**
 * Test de regresión — chat upload feature.
 *
 * La ruta POST /api/sites/:id/upload debe:
 *   1. Aceptar multipart/form-data con campo "file".
 *   2. Reenviar al plugin (POST /wp-json/ai-agent/v1/media).
 *   3. Devolver 201 con los datos del attachment.
 *   4. Devolver 404 si el sitio no existe.
 *   5. Propagar errores del plugin como 502.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';

const tmpDir = mkdtempSync(join(tmpdir(), 'orch-upload-'));
process.env.DATABASE_PATH = join(tmpDir, 'test.db');
process.env.LLM_PROVIDER = 'minimax';
process.env.LLM_MODEL = 'MiniMax-Text-01';
process.env.MINIMAX_API_KEY = 'test-key';

let _dbOverride: Database.Database | null = null;
vi.mock('../../../src/db/client.js', async () => {
  const real = await vi.importActual<typeof import('../../../src/db/client.js')>('../../../src/db/client.js');
  return {
    ...real,
    getDb: () => {
      if (_dbOverride) return _dbOverride;
      throw new Error('Test DB not initialized');
    },
    closeDb: () => {
      if (_dbOverride) {
        _dbOverride.close();
        _dbOverride = null;
      }
    },
  };
});

const { sitesRoutes } = await import('../../../src/routes/sites.routes.js');

describe('POST /api/sites/:id/upload — passthrough multipart', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    const dbPath = join(tmpDir, `upload-${Date.now()}-${Math.random().toString(36).slice(2,8)}.db`);
    _dbOverride = new Database(dbPath);
    _dbOverride.pragma('journal_mode = WAL');
    _dbOverride.pragma('foreign_keys = ON');
    _dbOverride.exec(readFileSync(join(process.cwd(), 'src', 'db', 'schema.sql'), 'utf-8'));
    _dbOverride
      .prepare(`INSERT INTO sites (id, name, url, api_key_encrypted, status) VALUES (?, ?, ?, ?, 'active')`)
      .run('site-1', 'Test Site', 'http://elementor-ia.local', 'test-key');

    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (_dbOverride) {
      try { _dbOverride.close(); } catch { /* closed */ }
      _dbOverride = null;
    }
  });

  it('forwards multipart upload to plugin and returns 201', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 201,
      text: () => Promise.resolve(JSON.stringify({
        success: true,
        data: { id: 99, title: 'logo.png', url: 'http://x/logo.png', mime_type: 'image/png' },
      })),
    });

    const form = new FormData();
    const blob = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' });
    form.append('file', blob, 'logo.png');
    form.append('title', 'My logo');
    form.append('change_id', 'ch-test-up');

    const res = await sitesRoutes.request('/site-1/upload', { method: 'POST', body: form });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.id).toBe(99);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchMock.mock.calls[0];
    expect(String(calledUrl)).toContain('/wp-json/ai-agent/v1/media');
    expect(calledInit.method).toBe('POST');
    expect(calledInit.headers['X-AI-Agent-Key']).toBe('test-key');
    expect(calledInit.headers['X-AI-Agent-Change-Id']).toBe('ch-test-up');
    // No debe haber Content-Type manual — el browser setea multipart boundary.
    expect(calledInit.headers['Content-Type']).toBeUndefined();
    expect(calledInit.body).toBeInstanceOf(FormData);
  });

  it('returns 404 when site does not exist', async () => {
    const form = new FormData();
    form.append('file', new Blob(['x']), 'x.txt');

    const res = await sitesRoutes.request('/no-such-site/upload', { method: 'POST', body: form });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('NOT_FOUND');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 502 when plugin fails', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () => Promise.resolve(JSON.stringify({
        success: false,
        error: { code: 'UPLOAD_FAILED', message: 'PHP fatal error' },
      })),
    });

    const form = new FormData();
    form.append('file', new Blob(['x']), 'x.txt');

    const res = await sitesRoutes.request('/site-1/upload', { method: 'POST', body: form });

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('UPLOAD_FAILED');
  });
});
