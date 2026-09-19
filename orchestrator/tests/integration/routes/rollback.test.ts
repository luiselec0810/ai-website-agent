/**
 * Integration test — G9 fix.
 *
 * La ruta POST /api/changes/:id/rollback debe:
 *   1. Pasar la llamada al plugin (POST /wp-json/ai-agent/v1/changes/{id}/rollback).
 *   2. Actualizar changes.status='rolled_back'.
 *   3. Devolver 200 con success=true.
 *   4. Devolver 404 si el change no existe.
 *   5. Devolver 500 si el plugin falla (propaga código de error).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';

// 1. Setup env ANTES de importar módulos que lean config.ts.
const tmpDir = mkdtempSync(join(tmpdir(), 'orch-rollback-'));
process.env.DATABASE_PATH = join(tmpDir, 'test.db');
process.env.LLM_PROVIDER = 'minimax';
process.env.LLM_MODEL = 'MiniMax-Text-01';
process.env.MINIMAX_API_KEY = 'test-key-not-used';

// 2. Stubear el singleton de DB para que devuelva nuestra DB temporal.
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

// 3. Importar después de configurar mocks.
const { changesRoutes } = await import('../../../src/routes/changes.routes.js');

describe('G9 regression — POST /api/changes/:id/rollback', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Crear DB temporal con schema completo.
    const dbPath = join(tmpDir, `rollback-${Date.now()}-${Math.random().toString(36).slice(2,8)}.db`);
    _dbOverride = new Database(dbPath);
    _dbOverride.pragma('journal_mode = WAL');
    _dbOverride.pragma('foreign_keys = ON');
    const schemaPath = join(process.cwd(), 'src', 'db', 'schema.sql');
    _dbOverride.exec(readFileSync(schemaPath, 'utf-8'));

    // Seed: un site y un change completed.
    _dbOverride
      .prepare(
        `INSERT INTO sites (id, name, url, api_key_encrypted, status)
         VALUES (?, ?, ?, ?, 'active')`
      )
      .run('site-rollback', 'Test Site', 'http://elementor-ia.local', 'aiw_test_key');
    _dbOverride
      .prepare(
        `INSERT INTO changes (id, site_id, title, description, operations, status)
         VALUES (?, ?, 'Test change', '', '[]', 'completed')`
      )
      .run('ch-rollback-001', 'site-rollback');

    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (_dbOverride) {
      try {
        _dbOverride.close();
      } catch {
        // ya cerrada
      }
      _dbOverride = null;
    }
  });

  it('calls plugin rollback and updates status', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify({ success: true, data: { rolled_back: true } })),
    });

    const res = await changesRoutes.request('/ch-rollback-001/rollback', { method: 'POST' });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: { change_id: string; status: string; plugin_result: unknown } };
    expect(body.success).toBe(true);
    expect(body.data.change_id).toBe('ch-rollback-001');
    expect(body.data.status).toBe('rolled_back');
    expect(body.data.plugin_result).toEqual({ rolled_back: true });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchMock.mock.calls[0];
    expect(String(calledUrl)).toContain('/wp-json/ai-agent/v1/changes/ch-rollback-001/rollback');
    expect(calledInit.method).toBe('POST');
    expect(calledInit.headers['X-AI-Agent-Key']).toBe('aiw_test_key');

    // Verificar que la DB se actualizó.
    const row = _dbOverride!.prepare(`SELECT status FROM changes WHERE id = ?`).get('ch-rollback-001') as { status: string };
    expect(row.status).toBe('rolled_back');
  });

  it('returns 404 when change does not exist', async () => {
    const res = await changesRoutes.request('/ch-does-not-exist/rollback', { method: 'POST' });

    expect(res.status).toBe(404);
    const body = (await res.json()) as { success: false; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('NOT_FOUND');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 500 with plugin error code when plugin fails', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            success: false,
            error: { code: 'NO_SNAPSHOT', message: 'No snapshot found for that change_id' },
          })
        ),
    });

    const res = await changesRoutes.request('/ch-rollback-001/rollback', { method: 'POST' });

    expect(res.status).toBe(500);
    const body = (await res.json()) as { success: false; error: { code: string; message: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('NO_SNAPSHOT');
    expect(body.error.message).toContain('No snapshot');

    // El estado NO debe cambiar a rolled_back si el plugin falló.
    const row = _dbOverride!.prepare(`SELECT status FROM changes WHERE id = ?`).get('ch-rollback-001') as { status: string };
    expect(row.status).toBe('completed');
  });
});
