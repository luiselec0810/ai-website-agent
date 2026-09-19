/**
 * Test del preflight de template_ids en changes.routes.
 *
 * Bug: el LLM alucinaba a veces el id del template (típico: 0 o ids
 * inventados), produciendo planes inválidos. El preflight rechaza el
 * plan entero ANTES de ejecutar nada, con un mensaje que lista los
 * templates válidos.
 *
 * Verifica 3 escenarios:
 *  - preflight SIN mock explícito de /templates: la llamada falla
 *    silenciosamente, las ops corren normales (degraded mode).
 *  - preflight CON mock que lista id X: si el plan usa template_id X,
 *    pasa; si usa id Y (no en la lista), aborta con INVALID_TEMPLATE_ID
 *    y marca todas las ops como failed.
 *  - el flag SKIP_TEMPLATE_PREFLIGHT desactiva el preflight (los
 *    tests placeholder existentes dependen de ese comportamiento).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';

const tmpDir = mkdtempSync(join(tmpdir(), 'orch-preflight-'));
process.env.DATABASE_PATH = join(tmpDir, 'test.db');
process.env.LLM_PROVIDER = 'minimax';
process.env.LLM_MODEL = 'MiniMax-Text-01';
process.env.MINIMAX_API_KEY = 'test-key';

let _dbOverride: Database.Database | null = null;
vi.mock('../../../src/db/client.js', async () => {
  const real = await vi.importActual<typeof import('../../../src/db/client.js')>(
    '../../../src/db/client.js'
  );
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

const { changesRoutes } = await import('../../../src/routes/changes.routes.js');

describe('Preflight: template_id validation antes de ejecutar ops', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    const dbPath = join(tmpDir, `pl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.db`);
    _dbOverride = new Database(dbPath);
    _dbOverride.pragma('journal_mode = WAL');
    _dbOverride.pragma('foreign_keys = ON');
    _dbOverride.exec(readFileSync(join(process.cwd(), 'src', 'db', 'schema.sql'), 'utf-8'));

    _dbOverride
      .prepare(
        `INSERT INTO sites (id, name, url, api_key_encrypted, status)
         VALUES (?, ?, ?, ?, 'active')`
      )
      .run('site-1', 'Test Site', 'http://elementor-ia.local', 'test-key');

    _dbOverride
      .prepare(
        `INSERT INTO changes (id, site_id, title, description, operations, status)
         VALUES (?, ?, ?, ?, ?, 'awaiting_approval')`
      )
      .run('ch-pl-001', 'site-1', 'Preflight test', '', '[]');

    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    // El preflight se ejecuta por defecto; los tests de esta suite lo necesitan.
    delete process.env.SKIP_TEMPLATE_PREFLIGHT;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (_dbOverride) {
      try {
        _dbOverride.close();
      } catch {
        // already closed
      }
      _dbOverride = null;
    }
  });

  it('rechaza plan con template_id inválido y marca todas las ops como failed', async () => {
    _dbOverride
      .prepare(`UPDATE changes SET operations = ? WHERE id = 'ch-pl-001'`)
      .run(
        JSON.stringify([
          { tool: 'create_page', arguments: { title: 'P', status: 'draft', builder: 'elementor' } },
          { tool: 'use_template', arguments: { page_id: '{{page_id}}', template_id: 99, change_id: 't-99' } },
          { tool: 'replace_image', arguments: { page_id: '{{page_id}}', element_id: '{{element_id:1}}', media_id: 7, change_id: 'r-1' } },
        ])
      );

    // Preflight /templates devuelve SOLO id 49 → el plan pide id 99 (no existe).
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            success: true,
            data: [{ id: 49, title: 'Plantilla1', type: 'page' }],
          })
        ),
    });

    const res = await changesRoutes.request('/ch-pl-001/approve', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.status).toBe('failed');

    // Solo se hizo la llamada al preflight (create_page no se ejecuta).
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [preflightUrl] = fetchMock.mock.calls[0];
    expect(String(preflightUrl)).toContain('/templates');

    // Las 3 ops quedaron como failed con código INVALID_TEMPLATE_ID.
    expect(body.data.results).toHaveLength(3);
    for (const r of body.data.results) {
      expect(r.status).toBe('failed');
      expect(r.error?.code).toBe('INVALID_TEMPLATE_ID');
    }
    expect(body.data.results[0].error?.message).toMatch(/INVALID_TEMPLATE_ID.*99/);
    expect(body.data.results[0].error?.message).toMatch(/49.*Plantilla1/);
  });

  it('deja pasar el plan cuando el id sí existe en /templates', async () => {
    _dbOverride
      .prepare(`UPDATE changes SET operations = ? WHERE id = 'ch-pl-001'`)
      .run(
        JSON.stringify([
          { tool: 'create_page', arguments: { title: 'P', status: 'draft', builder: 'elementor' } },
          { tool: 'use_template', arguments: { page_id: '{{page_id}}', template_id: 49, change_id: 't-49' } },
        ])
      );

    fetchMock
      // Preflight /templates — id 49 está en la lista
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              success: true,
              data: [{ id: 49, title: 'Plantilla1', type: 'page' }],
            })
          ),
      })
      // create_page
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        text: () =>
          Promise.resolve(JSON.stringify({ success: true, data: { id: 50, title: 'P' } })),
      })
      // use_template
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              success: true,
              data: {
                page_id: 50,
                template_id: 49,
                position: 'last',
                new_element_ids: ['id01', 'id02', 'id03'],
                appended: 1,
              },
            })
          ),
      });

    const res = await changesRoutes.request('/ch-pl-001/approve', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.status).toBe('completed');
    // 3 calls: preflight + create_page + use_template
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('degraded mode: si /templates falla, ops corren normales (no bloqueamos)', async () => {
    _dbOverride
      .prepare(`UPDATE changes SET operations = ? WHERE id = 'ch-pl-001'`)
      .run(
        JSON.stringify([
          { tool: 'create_page', arguments: { title: 'P', status: 'draft', builder: 'elementor' } },
          { tool: 'use_template', arguments: { page_id: '{{page_id}}', template_id: 49, change_id: 't-49' } },
        ])
      );

    // mockImplementation basado en URL para evitar dependencias de orden
    // en la queue. /templates falla (preflight degraded), /pages y
    // /use-template responden OK.
    fetchMock.mockImplementation(async (url: string) => {
      const u = String(url);
      // Preflight /templates: simular fallo (preflight captura y continúa).
      if (u.includes('/templates')) {
        return {
          ok: false,
          status: 500,
          text: () => Promise.resolve(JSON.stringify({ error: 'simulated failure' })),
        };
      }
      // create_page
      if (u.endsWith('/wp-json/ai-agent/v1/pages') || u.match(/\/pages\?/)) {
        return {
          ok: true,
          status: 201,
          text: () =>
            Promise.resolve(JSON.stringify({ success: true, data: { id: 60, title: 'P' } })),
        };
      }
      // use_template
      if (u.includes('/use-template')) {
        return {
          ok: true,
          status: 201,
          text: () =>
            Promise.resolve(
              JSON.stringify({
                success: true,
                data: { page_id: 60, template_id: 49, new_element_ids: ['x'], appended: 1 },
              })
            ),
        };
      }
      // Default: 404 (cualquier otra URL no debería llamarse).
      return {
        ok: false,
        status: 404,
        text: () => Promise.resolve(JSON.stringify({ error: 'unexpected call: ' + u })),
      };
    });

    const res = await changesRoutes.request('/ch-pl-001/approve', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json();
    if (body.data.status !== 'completed') {
      console.log('UNEXPECTED BODY:', JSON.stringify(body, null, 2));
    }
    expect(body.data.status).toBe('completed');
    // Total: preflight /templates + create_page + use_template = 3 calls.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
