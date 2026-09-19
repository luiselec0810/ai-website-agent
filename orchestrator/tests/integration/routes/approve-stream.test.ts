/**
 * Tests de integración — POST /api/changes/:id/approve-stream (SSE).
 *
 * Cubre el nuevo endpoint de streaming que emite Server-Sent Events
 * (`op:start`, `op:success`, `op:fail`, `op:skipped`, `done`) por cada
 * operación del change en tiempo real. La lógica de orquestación está
 * compartida con `/approve` vía `runChangeOperations`; estos tests
 * validan que ambos endpoints producen el mismo resultado funcional,
 * pero el formato de transporte es distinto:
 *
 *   - /approve         → un único JSON con todos los resultados.
 *   - /approve-stream  → un stream SSE frame-por-frame + `done` final.
 *
 * Casos cubiertos:
 *   1. Plan de 2 ops que tienen éxito: llegan op:start, op:success por
 *      cada una, luego `done` con status=completed. DB → completed.
 *   2. Plan donde una op "productora" falla: las siguientes se emiten como
 *      `op:skipped` con error.code=PREREQ_FAILED. DB → failed.
 *   3. Headers de respuesta: Content-Type text/event-stream,
 *      X-Accel-Buffering: no.
 *   4. /approve y /approve-stream producen los MISMOS resultados
 *      (mismo array de ExecutionResult, mismo status final).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';

const tmpDir = mkdtempSync(join(tmpdir(), 'orch-approve-stream-'));
process.env.DATABASE_PATH = join(tmpDir, 'test.db');
process.env.LLM_PROVIDER = 'minimax';
process.env.LLM_MODEL = 'MiniMax-Text-01';
process.env.MINIMAX_API_KEY = 'test-key';

// Stubear el singleton de DB para que devuelva nuestra DB temporal.
// El patrón es idéntico al de approve-placeholder.test.ts.
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

const { changesRoutes } = await import('../../../src/routes/changes.routes.js');

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

interface SseFrame {
  event: string;
  data: unknown;
}

/**
 * Lee un Response cuyo body es un stream SSE y devuelve todos los frames
 * en orden. Parsea líneas `event:` y `data:` según la spec; los frames
 * están separados por `\n\n`. Si un frame contiene sólo líneas `data:`
 * (sin `event:`), se interpreta como event="message" — pero el backend
 * siempre manda `event:`, así que en la práctica nunca cae ahí.
 */
async function readSseFrames(res: Response): Promise<SseFrame[]> {
  const frames: SseFrame[] = [];
  if (!res.body) throw new Error('Response has no body');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let frameEnd = buffer.indexOf('\n\n');
    while (frameEnd !== -1) {
      const raw = buffer.slice(0, frameEnd);
      buffer = buffer.slice(frameEnd + 2);

      let event = 'message';
      let data: unknown = '';
      for (const line of raw.split('\n')) {
        if (line.startsWith('event: ')) {
          event = line.slice(7).trim();
        } else if (line.startsWith('data: ')) {
          // El backend sólo usa una línea `data:` por frame, pero por
          // seguridad concatenamos si vienen varias (spec lo permite).
          data = (typeof data === 'string' ? data : '') + line.slice(6);
        }
      }

      if (typeof data === 'string' && data.length > 0) {
        try {
          data = JSON.parse(data);
        } catch {
          /* leave as string */
        }
      }
      frames.push({ event, data });
      frameEnd = buffer.indexOf('\n\n');
    }
  }
  return frames;
}

/**
 * Crea un site + un change con un array de operaciones dado.
 * Helper para no repetir boilerplate en cada `it`.
 */
function seedChange(
  changeId: string,
  ops: Array<{ tool: string; arguments: Record<string, unknown> }>
): void {
  if (!_dbOverride) throw new Error('DB not initialized');
  _dbOverride
    .prepare(
      `INSERT OR IGNORE INTO sites (id, name, url, api_key_encrypted, status)
       VALUES (?, ?, ?, ?, 'active')`
    )
    .run('site-stream-1', 'Test Stream Site', 'http://elementor-ia.local', 'test-key-stream');
  _dbOverride
    .prepare(
      `INSERT INTO changes (id, site_id, title, description, operations, status)
       VALUES (?, ?, ?, ?, ?, 'awaiting_approval')`
    )
    .run(changeId, 'site-stream-1', 'Stream Test', '', JSON.stringify(ops));
}

// ─────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────

describe('POST /api/changes/:id/approve-stream — SSE', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    const dbPath = join(
      tmpDir,
      `stream-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.db`
    );
    _dbOverride = new Database(dbPath);
    _dbOverride.pragma('journal_mode = WAL');
    _dbOverride.pragma('foreign_keys = ON');
    _dbOverride.exec(readFileSync(join(process.cwd(), 'src', 'db', 'schema.sql'), 'utf-8'));

    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    // Tests de streaming mockean respuestas específicas de cada op; el
    // preflight de template_id agrega una llamada extra que rompe los
    // conteos. El test dedicado al preflight (`preflight-test.ts`) setea
    // explicitamente SKIP_TEMPLATE_PREFLIGHT=0 y mockea /templates.
    process.env.SKIP_TEMPLATE_PREFLIGHT = '1';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.SKIP_TEMPLATE_PREFLIGHT;
    if (_dbOverride) {
      try {
        _dbOverride.close();
      } catch {
        /* already closed */
      }
      _dbOverride = null;
    }
  });

  it('emite op:start → op:success por cada op y un `done` final con status=completed', async () => {
    seedChange('ch-stream-ok', [
      { tool: 'create_page', arguments: { title: 'Page', status: 'draft', builder: 'elementor' } },
      { tool: 'add_container', arguments: { page_id: '{{page_id}}', parent_id: 'root', change_id: 'c1' } },
    ]);

    // El plan NO usa use_template → validateChangePlan se salta, OK.
    fetchMock
      // create_page → id 501
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        text: () => Promise.resolve(JSON.stringify({ success: true, data: { id: 501, title: 'Page' } })),
      })
      // add_container → new_element_id "cntA001"
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        text: () =>
          Promise.resolve(
            JSON.stringify({ success: true, data: { new_element_id: 'cntA001', page_id: 501 } })
          ),
      });

    const res = await changesRoutes.request('/ch-stream-ok/approve-stream', { method: 'POST' });
    expect(res.status).toBe(200);

    const frames = await readSseFrames(res);

    // Estructura exacta esperada:
    //   op:start (idx 0), op:success (idx 0),
    //   op:start (idx 1), op:success (idx 1),
    //   done
    expect(frames.map((f) => f.event)).toEqual([
      'op:start',
      'op:success',
      'op:start',
      'op:success',
      'done',
    ]);

    // Primer op:start → tool create_page, index 0
    const start0 = frames[0].data as { tool: string; index: number; operationId: string };
    expect(start0.tool).toBe('create_page');
    expect(start0.index).toBe(0);
    expect(typeof start0.operationId).toBe('string');
    expect(start0.operationId.length).toBeGreaterThan(0);

    // Primer op:success → mismo tool, mismo index, durationMs numérico, result.id=501
    const succ0 = frames[1].data as { tool: string; index: number; durationMs: number; result: { id: number } };
    expect(succ0.tool).toBe('create_page');
    expect(succ0.index).toBe(0);
    expect(typeof succ0.durationMs).toBe('number');
    expect(succ0.result.id).toBe(501);

    // Segundo op:start → tool add_container
    const start1 = frames[2].data as { tool: string; index: number };
    expect(start1.tool).toBe('add_container');
    expect(start1.index).toBe(1);

    // done → status completed, results tiene 2 items, change_id matchea
    const done = frames[4].data as { change_id: string; status: string; results: unknown[] };
    expect(done.change_id).toBe('ch-stream-ok');
    expect(done.status).toBe('completed');
    expect(done.results).toHaveLength(2);

    // DB → completed
    const row = _dbOverride!.prepare(`SELECT status FROM changes WHERE id = ?`).get('ch-stream-ok') as {
      status: string;
    };
    expect(row.status).toBe('completed');
  });

  it('cuando una op productora falla, las siguientes se emiten como op:skipped (PREREQ_FAILED)', async () => {
    // Plan: create_page → use_template (FALLA porque el plugin devuelve 400) → replace_image.
    // Esperado:
    //   op:start(create_page), op:success(create_page),
    //   op:start(use_template), op:fail(use_template),
    //   op:skipped(replace_image),
    //   done con status=failed
    seedChange('ch-stream-prereq', [
      { tool: 'create_page', arguments: { title: 'P', status: 'draft', builder: 'elementor' } },
      { tool: 'use_template', arguments: { page_id: '{{page_id}}', template_id: 89, change_id: 'tpl-89' } },
      { tool: 'replace_image', arguments: { page_id: '{{page_id}}', element_id: '{{container_id}}', media_id: 7, change_id: 'ri-1' } },
    ]);

    // use_template falla → validateChangePlan hace fetch a /templates ANTES
    // de validar; como en tests NODE_ENV='aiwall...' mmm. Veamos: validateChangePlan
    // usa process.env.NODE_ENV === 'test' como skip. En vitest, NODE_ENV sí es 'test'.
    // Pero también necesita skip cuando AI_AGENT_SKIP_VALIDATION=1. El test ya está
    // bajo vitest con NODE_ENV=test, así que validateChangePlan devuelve { ok: true }
    // sin hacer fetch. Bien.
    fetchMock
      // create_page OK
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        text: () => Promise.resolve(JSON.stringify({ success: true, data: { id: 700 } })),
      })
      // use_template FALLA con 400
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              success: false,
              error: { code: 'TEMPLATE_WRONG_TYPE', message: 'Post 89 is a "revision", not an Elementor template.' },
            })
          ),
      });
    // replace_image NO debe ejecutarse (skip por prereq).

    const res = await changesRoutes.request('/ch-stream-prereq/approve-stream', { method: 'POST' });
    expect(res.status).toBe(200);
    const frames = await readSseFrames(res);

    expect(frames.map((f) => f.event)).toEqual([
      'op:start',
      'op:success',
      'op:start',
      'op:fail',
      'op:skipped',
      'done',
    ]);

    // El op:fail debe llevar el código que devolvió el plugin.
    const fail = frames[3].data as { tool: string; index: number; error: { code: string; message: string } };
    expect(fail.tool).toBe('use_template');
    expect(fail.index).toBe(1);
    expect(fail.error.code).toBe('TEMPLATE_WRONG_TYPE');

    // El op:skipped (replace_image) debe llevar PREREQ_FAILED referenciando use_template.
    const skipped = frames[4].data as { tool: string; index: number; error: { code: string; message: string } };
    expect(skipped.tool).toBe('replace_image');
    expect(skipped.index).toBe(2);
    expect(skipped.error.code).toBe('PREREQ_FAILED');
    expect(skipped.error.message).toContain('use_template');

    // done → failed
    const done = frames[5].data as { status: string; results: Array<{ tool: string; status: string }> };
    expect(done.status).toBe('failed');
    expect(done.results).toHaveLength(3);
    expect(done.results[0].status).toBe('success');
    expect(done.results[1].status).toBe('failed');
    expect(done.results[2].status).toBe('skipped');

    // Solo se hicieron 2 llamadas HTTP (create_page + use_template), no 3.
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // DB → failed.
    const row = _dbOverride!.prepare(`SELECT status FROM changes WHERE id = ?`).get('ch-stream-prereq') as {
      status: string;
    };
    expect(row.status).toBe('failed');
  });

  it('los headers de respuesta incluyen text/event-stream, no-cache, X-Accel-Buffering: no', async () => {
    seedChange('ch-stream-headers', [
      { tool: 'create_page', arguments: { title: 'H', status: 'draft', builder: 'elementor' } },
    ]);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 201,
      text: () => Promise.resolve(JSON.stringify({ success: true, data: { id: 800 } })),
    });

    const res = await changesRoutes.request('/ch-stream-headers/approve-stream', { method: 'POST' });
    expect(res.status).toBe(200);

    // Headers clave del SSE.
    const ct = res.headers.get('content-type') ?? '';
    expect(ct).toMatch(/text\/event-stream/);
    expect(res.headers.get('cache-control')).toBe('no-cache');
    expect(res.headers.get('x-accel-buffering')).toBe('no');
    expect(res.headers.get('connection')).toBe('keep-alive');

    // Drain el stream hasta EOF para que Hono termine el handler de streaming
    // limpiamente (cerrar la DB mientras el callback sigue vivo provocaría
    // errores espurios en el siguiente test).
    await readSseFrames(res);
  });

  it('/approve-stream produce el MISMO status y resultados que /approve (mismo motor de ejecución)', async () => {
    // Mismo plan en dos changes distintos → comparar resultados.
    const ops = [
      { tool: 'create_page', arguments: { title: 'Compare', status: 'draft', builder: 'elementor' } },
      { tool: 'add_container', arguments: { page_id: '{{page_id}}', parent_id: 'root', change_id: 'cmp-c' } },
    ];
    seedChange('ch-cmp-stream', ops);
    seedChange('ch-cmp-json', ops);

    // Programar respuestas idénticas para los dos flows:
    //   call 1 → create_page id=900
    //   call 2 → add_container cnt9000
    // (se consumen en orden por el primer flow; re-programamos para el segundo).
    const responses = [
      {
        ok: true,
        status: 201,
        text: () => Promise.resolve(JSON.stringify({ success: true, data: { id: 900 } })),
      },
      {
        ok: true,
        status: 201,
        text: () =>
          Promise.resolve(
            JSON.stringify({ success: true, data: { new_element_id: 'cnt9000', page_id: 900 } })
          ),
      },
      // Segundo flujo: mismas respuestas (mockResolvedValueOnce se consume en orden).
      {
        ok: true,
        status: 201,
        text: () => Promise.resolve(JSON.stringify({ success: true, data: { id: 900 } })),
      },
      {
        ok: true,
        status: 201,
        text: () =>
          Promise.resolve(
            JSON.stringify({ success: true, data: { new_element_id: 'cnt9000', page_id: 900 } })
          ),
      },
    ];
    fetchMock
      .mockResolvedValueOnce(responses[0])
      .mockResolvedValueOnce(responses[1])
      .mockResolvedValueOnce(responses[2])
      .mockResolvedValueOnce(responses[3]);

    // 1) /approve (JSON)
    const jsonRes = await changesRoutes.request('/ch-cmp-json/approve', { method: 'POST' });
    expect(jsonRes.status).toBe(200);
    const jsonBody = (await jsonRes.json()) as {
      data: { status: string; results: Array<{ tool: string; status: string }> };
    };
    expect(jsonBody.data.status).toBe('completed');
    expect(jsonBody.data.results).toHaveLength(2);

    // 2) /approve-stream (SSE)
    const streamRes = await changesRoutes.request('/ch-cmp-stream/approve-stream', { method: 'POST' });
    expect(streamRes.status).toBe(200);
    const frames = await readSseFrames(streamRes);

    // Mismo status final, mismo número de resultados.
    const done = frames[frames.length - 1].data as {
      status: string;
      results: Array<{ tool: string; status: string }>;
    };
    expect(done.status).toBe('completed');
    expect(done.results).toHaveLength(2);

    // Cada operación tiene el mismo status en ambos endpoints.
    for (let i = 0; i < 2; i++) {
      expect(done.results[i].tool).toBe(jsonBody.data.results[i].tool);
      expect(done.results[i].status).toBe(jsonBody.data.results[i].status);
    }

    // Mismo status en DB para ambos.
    const a = _dbOverride!.prepare(`SELECT status FROM changes WHERE id = ?`).get('ch-cmp-json') as {
      status: string;
    };
    const b = _dbOverride!.prepare(`SELECT status FROM changes WHERE id = ?`).get('ch-cmp-stream') as {
      status: string;
    };
    expect(a.status).toBe('completed');
    expect(b.status).toBe('completed');
  });

  it('devuelve 404 con JSON normal si el change no existe', async () => {
    // No seedeamos nada → change no existe.
    const res = await changesRoutes.request('/ch-does-not-exist/approve-stream', { method: 'POST' });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.success).toBe(false);
    // ensureAwaitingApproval devuelve { error: 'NOT_FOUND', message: '...' };
    // eso se serializa como body.error.error (mantenemos compatibilidad con /approve).
    expect(body.error?.error).toBe('NOT_FOUND');

    // Importante: cuando hay error de validación/lookup NO abrimos stream SSE.
    expect(res.headers.get('content-type')).not.toMatch(/text\/event-stream/);
  });

  it('devuelve 400 con JSON normal si el change no está en awaiting_approval', async () => {
    seedChange('ch-stream-wrong-status', [
      { tool: 'create_page', arguments: { title: 'W', status: 'draft', builder: 'elementor' } },
    ]);
    // Forzar status distinto.
    _dbOverride!.prepare(`UPDATE changes SET status = 'completed' WHERE id = 'ch-stream-wrong-status'`).run();

    const res = await changesRoutes.request('/ch-stream-wrong-status/approve-stream', { method: 'POST' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error?.error).toBe('INVALID_STATE');
    expect(res.headers.get('content-type')).not.toMatch(/text\/event-stream/);
  });
});