/**
 * Test de regresión — gap G11.
 *
 * La ruta GET /api/sites/:id/pages debe:
 *   1. Hacer passthrough al plugin WP /wp-json/ai-agent/v1/pages.
 *   2. Devolver 404 si el sitio no existe.
 *   3. Propagar errores del plugin como 502.
 *   4. Pasar query params (search, status, per_page) al plugin.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';

const tmpDir = mkdtempSync(join(tmpdir(), 'orch-sites-pages-'));
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

describe('G11 regression — GET /api/sites/:id/pages passthrough', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    const dbPath = join(tmpDir, `pages-${Date.now()}-${Math.random().toString(36).slice(2,8)}.db`);
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
      try { _dbOverride.close(); } catch { /* already closed */ }
      _dbOverride = null;
    }
  });

  it('proxies to plugin /pages and returns data', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify({
        success: true,
        data: [
          { id: 1, title: 'Inicio', status: 'publish' },
          { id: 2, title: 'Nosotros', status: 'publish' },
        ],
      })),
    });

    const res = await sitesRoutes.request('/site-1/pages?status=publish&per_page=10', { method: 'GET' });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.items).toHaveLength(2);
    expect(body.data.items[0].title).toBe('Inicio');
    expect(body.data.pagination).toBeDefined();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchMock.mock.calls[0];
    expect(String(calledUrl)).toContain('/wp-json/ai-agent/v1/pages');
    expect(String(calledUrl)).toContain('status=publish');
    expect(String(calledUrl)).toContain('per_page=10');
    expect(calledInit.method).toBe('GET');
    expect(calledInit.headers['X-AI-Agent-Key']).toBe('test-key');
  });

  it('returns 404 when site does not exist', async () => {
    const res = await sitesRoutes.request('/no-such-site/pages', { method: 'GET' });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('NOT_FOUND');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 502 with WP error code when plugin fails', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () => Promise.resolve(JSON.stringify({
        success: false,
        error: { code: 'WP_INTERNAL', message: 'Plugin error' },
      })),
    });

    const res = await sitesRoutes.request('/site-1/pages', { method: 'GET' });

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('WP_INTERNAL');
  });
});
