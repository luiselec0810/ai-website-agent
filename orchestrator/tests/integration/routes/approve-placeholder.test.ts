/**
 * Test de regresión — placeholder resolution con ExecutionResult.
 *
 * Bug: captureContext leía `r.id` pero el result real es un ExecutionResult
 * con shape `{ tool, status, result: { id, ... }, error?, retries }`. El `r.id`
 * siempre era undefined → los placeholders `{{page_id}}` se resolvían a
 * `undefined` → URLs malformadas (`/pages/undefined/...`) → 404.
 *
 * El fix: captureContext ahora busca `outer.result.id` (el payload anidado).
 *
 * Test: simula un change con operaciones create_page → use_template. Verifica
 * que tras create_page, el placeholder se sustituye correctamente en use_template.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';

const tmpDir = mkdtempSync(join(tmpdir(), 'orch-approve-placeholder-'));
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

const { changesRoutes } = await import('../../../src/routes/changes.routes.js');
const { logger } = await import('../../../src/logger.js');

describe('Regresión: placeholder resolution con captureContext', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    const dbPath = join(tmpDir, `ph-${Date.now()}-${Math.random().toString(36).slice(2,8)}.db`);
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

    // Change con 2 operaciones: create_page → use_template({{page_id}}, 49).
    _dbOverride
      .prepare(
        `INSERT INTO changes (id, site_id, title, description, operations, status)
         VALUES (?, ?, ?, ?, ?, 'awaiting_approval')`
      )
      .run(
        'ch-ph-001',
        'site-1',
        'Test',
        '',
        JSON.stringify([
          {
            tool: 'create_page',
            arguments: { title: 'TestPage', status: 'draft', builder: 'elementor' },
          },
          {
            tool: 'use_template',
            arguments: {
              page_id: '{{page_id}}',
              template_id: 49,
              change_id: 'import-49',
            },
          },
        ])
      );

    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  /**
   * Helper: preflight de template_ids dispara un GET /templates?per_page=100
   * ANTES de cualquier op del plan. Si el plan contiene `use_template`
   * con template_id numérico, este mock debe ser la PRIMERA entrada en la
   * cola de `mockResolvedValueOnce` del test. Devuelve los IDs habituales
   * de los tests (39, 41, 49, 7, 5).
   */
  function mockPreflightTemplates() {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            success: true,
            data: [
              { id: 5, title: 'Kit por defecto', type: 'kit' },
              { id: 7, title: 'Test page', type: 'page' },
              { id: 39, title: 'Plan1', type: 'page' },
              { id: 41, title: 'Plan2', type: 'page' },
              { id: 49, title: 'Plantilla1', type: 'page' },
            ],
          })
        ),
    });
  }

  // Todos los tests de esta suite mockean respuestas específicas de
  // create_page / use_template / replace_image sin configurar el preflight
  // de template_id (que añadiría una llamada adicional al endpoint
  // /templates y rompería los `toHaveBeenCalledTimes(N)` existentes).
  // SKIP_TEMPLATE_PREFLIGHT desactiva esa validación solo en este describe.
  beforeEach(() => {
    process.env.SKIP_TEMPLATE_PREFLIGHT = '1';
  });
  afterEach(() => {
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

  it('use_template recibe page_id resuelto, NO "undefined"', async () => {
    fetchMock
      // create_page response
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        text: () =>
          Promise.resolve(
            JSON.stringify({ success: true, data: { id: 77, title: 'TestPage', status: 'draft' } })
          ),
      })
      // use_template response
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              success: true,
              data: {
                page_id: 77,
                template_id: 49,
                position: 'last',
                new_element_ids: ['abc1234'],
                appended: 1,
              },
            })
          ),
      });

    const res = await changesRoutes.request('/ch-ph-001/approve', { method: 'POST' });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.status).toBe('completed');

    // CRITICAL: la segunda llamada (use_template) debe usar page_id=77, no "undefined".
    // (Preflight desactivado via SKIP_TEMPLATE_PREFLIGHT=1 en este describe.)
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [createCallUrl, createCallInit] = fetchMock.mock.calls[0];
    const [useTplCallUrl, useTplCallInit] = fetchMock.mock.calls[1];

    // create_page: POST /wp-json/ai-agent/v1/pages
    expect(String(createCallUrl)).toMatch(/\/wp-json\/ai-agent\/v1\/pages(\?|$)/);

    // use_template: debe ir a /pages/77/elementor/use-template, NO /pages/undefined/...
    expect(String(useTplCallUrl)).toMatch(/\/pages\/77\/elementor\/use-template/);
    expect(String(useTplCallUrl)).not.toContain('undefined');

    // Body de use_template debe tener template_id=49.
    const tplBody = JSON.parse(useTplCallInit.body);
    expect(tplBody.template_id).toBe(49);
    expect(tplBody.change_id).toBe('import-49');
  });

  it('container_id placeholder también se resuelve entre add_container y add_widget', async () => {
    // Cambiamos el change para usar add_container → add_widget.
    _dbOverride
      .prepare(`UPDATE changes SET operations = ? WHERE id = 'ch-ph-001'`)
      .run(
        JSON.stringify([
          {
            tool: 'create_page',
            arguments: { title: 'TestPage2', status: 'draft', builder: 'elementor' },
          },
          {
            tool: 'add_container',
            arguments: {
              page_id: '{{page_id}}',
              parent_id: 'root',
              position: 'last',
              change_id: 'add-c-1',
            },
          },
          {
            tool: 'add_widget',
            arguments: {
              page_id: '{{page_id}}',
              container_id: '{{container_id}}',
              widget: 'heading',
              settings: { title: 'Hi' },
              change_id: 'add-w-1',
            },
          },
        ])
      );

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        text: () =>
          Promise.resolve(
            JSON.stringify({ success: true, data: { id: 78, title: 'TestPage2' } })
          ),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              success: true,
              data: {
                new_element_id: 'cnt7777',
                page_id: 78,
              },
            })
          ),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              success: true,
              data: {
                new_element_id: 'wdg9999',
                page_id: 78,
              },
            })
          ),
      });

    const res = await changesRoutes.request('/ch-ph-001/approve', { method: 'POST' });

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const [containerUrl, containerInit] = fetchMock.mock.calls[1];
    const [widgetUrl, widgetInit] = fetchMock.mock.calls[2];

    // add_container: page_id=78 (resuelto de create_page).
    expect(String(containerUrl)).toMatch(/\/pages\/78\/elementor\/containers/);
    expect(String(containerUrl)).not.toContain('undefined');

    // add_widget: page_id=78 + container_id=cnt7777 (resuelto de add_container).
    expect(String(widgetUrl)).toMatch(/\/pages\/78\/elementor\/widgets/);
    expect(String(widgetUrl)).not.toContain('undefined');
    const widgetBody = JSON.parse(widgetInit.body);
    expect(widgetBody.container_id).toBe('cnt7777');
  });

  // ─────────────────────────────────────────────────────────────────
  // Regresión: use_template + replace_image + update_widget
  //
  // Bug original: el LLM hardcodeaba IDs del get_template (stale) en
  // replace_image/update_widget, pero use_template genera IDs NUEVOS
  // (`new_element_ids`). Fix: el plan debe usar {{element_id:N}} para
  // indexar en new_element_ids, y el orchestrator debe resolverlos.
  // ─────────────────────────────────────────────────────────────────
  it('use_template → replace_image: {{element_id:N}} resuelve al ID clonado correcto', async () => {
    _dbOverride
      .prepare(`UPDATE changes SET operations = ? WHERE id = 'ch-ph-001'`)
      .run(
        JSON.stringify([
          {
            tool: 'create_page',
            arguments: { title: 'TplPage', status: 'draft', builder: 'elementor' },
          },
          {
            tool: 'use_template',
            arguments: {
              page_id: '{{page_id}}',
              template_id: 39,
              change_id: 'tpl-39',
            },
          },
          {
            tool: 'replace_image',
            arguments: {
              page_id: '{{page_id}}',
              element_id: '{{element_id:1}}',
              media_id: 95,
              change_id: 'rep-img-1',
            },
          },
        ])
      );

    fetchMock
      // create_page → page 80
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        text: () => Promise.resolve(JSON.stringify({ success: true, data: { id: 80, title: 'TplPage' } })),
      })
      // use_template → clona 3 elementos: [root-cnt, image-w, btn-w]
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              success: true,
              data: {
                page_id: 80,
                template_id: 39,
                position: 'last',
                new_element_ids: ['a1b2c3d', 'e4f5a6b', '1234567'],
                appended: 3,
              },
            })
          ),
      })
      // replace_image
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () =>
          Promise.resolve(JSON.stringify({ success: true, data: { id: 'e4f5a6b', updated: true } })),
      });

    const res = await changesRoutes.request('/ch-ph-001/approve', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.status).toBe('completed');

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [repImgUrl, repImgInit] = fetchMock.mock.calls[2];

    // PATCH /pages/80/elementor/widgets/e4f5a6b  (NO "undefined", NO el ID stale del template)
    expect(String(repImgUrl)).toContain('/pages/80/elementor/widgets/e4f5a6b');
    expect(String(repImgUrl)).not.toContain('undefined');
    const repImgBody = JSON.parse(repImgInit.body);
    expect(repImgBody.media_id).toBe(95);
    expect(repImgBody.change_id).toBe('rep-img-1');
  });

  it('use_template → update_widget: {{element_id:0}} apunta al root, {{element_id:N}} a widgets internos', async () => {
    _dbOverride
      .prepare(`UPDATE changes SET operations = ? WHERE id = 'ch-ph-001'`)
      .run(
        JSON.stringify([
          {
            tool: 'create_page',
            arguments: { title: 'TplPage2', status: 'draft', builder: 'elementor' },
          },
          {
            tool: 'use_template',
            arguments: { page_id: '{{page_id}}', template_id: 41, change_id: 'tpl-41' },
          },
          {
            // {{container_id}} debe seguir resolviendo al root (índice 0), por retrocompat.
            tool: 'add_widget',
            arguments: {
              page_id: '{{page_id}}',
              container_id: '{{container_id}}',
              widget: 'heading',
              settings: { title: 'Nuevo título' },
              change_id: 'add-h-1',
            },
          },
          {
            // {{element_id:2}} apunta al tercer elemento clonado.
            tool: 'update_widget',
            arguments: {
              page_id: '{{page_id}}',
              element_id: '{{element_id:2}}',
              settings: { title: 'Heading desde el template' },
              change_id: 'upd-w-1',
            },
          },
        ])
      );

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        text: () => Promise.resolve(JSON.stringify({ success: true, data: { id: 90, title: 'TplPage2' } })),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              success: true,
              data: {
                page_id: 90,
                template_id: 41,
                new_element_ids: ['a1b2c3d', 'c4d5e6f', '7890abc'],
                appended: 3,
              },
            })
          ),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        text: () =>
          Promise.resolve(
            JSON.stringify({ success: true, data: { new_element_id: 'feedbac', page_id: 90 } })
          ),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () =>
          Promise.resolve(JSON.stringify({ success: true, data: { id: '7890abc', updated: true } })),
      });

    const res = await changesRoutes.request('/ch-ph-001/approve', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.status).toBe('completed');

    expect(fetchMock).toHaveBeenCalledTimes(4);
    const [, addInit] = fetchMock.mock.calls[2];
    const [updUrl, updInit] = fetchMock.mock.calls[3];

    // add_widget: container_id=a1b2c3d ({{container_id}} = elementIds[0])
    const addBody = JSON.parse(addInit.body);
    expect(addBody.container_id).toBe('a1b2c3d');
    expect(addBody.widget).toBe('heading');

    // update_widget: PATCH .../widgets/7890abc (el tercer elemento clonado, índice 2)
    expect(String(updUrl)).toContain('/pages/90/elementor/widgets/7890abc');
    expect(String(updUrl)).not.toContain('undefined');
    const updBody = JSON.parse(updInit.body);
    expect(updBody.settings.title).toBe('Heading desde el template');
    expect(updBody.change_id).toBe('upd-w-1');
  });

  it('use_template con UN SOLO elemento: {{element_id}} y {{element_id:0}} apuntan al mismo root', async () => {
    _dbOverride
      .prepare(`UPDATE changes SET operations = ? WHERE id = 'ch-ph-001'`)
      .run(
        JSON.stringify([
          { tool: 'create_page', arguments: { title: 'Solo', status: 'draft', builder: 'elementor' } },
          { tool: 'use_template', arguments: { page_id: '{{page_id}}', template_id: 7, change_id: 't-7' } },
          {
            tool: 'replace_image',
            // Sin índice: {{element_id}} debe caer en lastContainerId (= elementIds[0])
            arguments: {
              page_id: '{{page_id}}',
              element_id: '{{element_id}}',
              media_id: 11,
              change_id: 'r-1',
            },
          },
        ])
      );

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        text: () => Promise.resolve(JSON.stringify({ success: true, data: { id: 100 } })),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              success: true,
              data: { new_element_ids: ['abcdef0'], page_id: 100 },
            })
          ),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify({ success: true, data: { updated: true } })),
      });

    const res = await changesRoutes.request('/ch-ph-001/approve', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const [url] = fetchMock.mock.calls[2];
    expect(String(url)).toContain('/pages/100/elementor/widgets/abcdef0');
    expect(String(url)).not.toContain('undefined');
  });

  it('element_id hardcodeado y NO-Elementor es auto-sustituido por lastContainerId (último root)', async () => {
    // Si el LLM pasase un element_id fake tipo "main-image" o un número, resolveSpecialKeys
    // lo reemplaza por el lastContainerId capturado, en lugar de enviarlo al plugin
    // (que devolvería 404 "element not found").
    _dbOverride
      .prepare(`UPDATE changes SET operations = ? WHERE id = 'ch-ph-001'`)
      .run(
        JSON.stringify([
          { tool: 'create_page', arguments: { title: 'Fallback', status: 'draft', builder: 'elementor' } },
          { tool: 'use_template', arguments: { page_id: '{{page_id}}', template_id: 7, change_id: 't-7b' } },
          {
            tool: 'update_widget',
            arguments: {
              page_id: '{{page_id}}',
              element_id: 'main-image', // sentinel no-Elementor
              settings: { title: 'Nuevo' },
              change_id: 'uw-1',
            },
          },
        ])
      );

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        text: () => Promise.resolve(JSON.stringify({ success: true, data: { id: 110 } })),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        text: () =>
          Promise.resolve(
            JSON.stringify({ success: true, data: { new_element_ids: ['cafe1d0'], page_id: 110 } })
          ),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify({ success: true, data: { id: 'cafe1d0' } })),
      });

    const res = await changesRoutes.request('/ch-ph-001/approve', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const [url, init] = fetchMock.mock.calls[2];
    expect(String(url)).toContain('/pages/110/elementor/widgets/cafe1d0');
    expect(String(url)).not.toContain('main-image');
  });

  /**
   * Regresión: si una op que produce IDs falla (e.g., use_template con revision),
   * las ops siguientes que dependen de esos IDs deben marcarse como `skipped`
   * con `error.code = PREREQ_FAILED` en vez de ejecutarse y fallar una por una.
   */
  it('aborta chain de ops si una op productoras de IDs falla', async () => {
    _dbOverride
      .prepare(`UPDATE changes SET operations = ? WHERE id = 'ch-ph-001'`)
      .run(
        JSON.stringify([
          {
            tool: 'create_page',
            arguments: { title: 'TestPrereq', status: 'draft', builder: 'elementor' },
          },
          // use_template falla porque post 89 no es elementor_library (es un revision).
          {
            tool: 'use_template',
            arguments: { page_id: '{{page_id}}', template_id: 89, change_id: 'ut-1' },
          },
          // Debería skipearse porque use_template falló.
          {
            tool: 'replace_image',
            arguments: { page_id: '{{page_id}}', element_id: '{{container_id}}', media_id: 999, change_id: 'ri-1' },
          },
          {
            tool: 'update_widget',
            arguments: { page_id: '{{page_id}}', element_id: '{{container_id}}', settings: { title: 'X' }, change_id: 'uw-1' },
          },
        ])
      );

    // Solo create_page debería ejecutarse (devuelve page_id 200).
    // use_template debería FALLAR (revision post).
    // replace_image y update_widget deberían skipearse (PREREQ_FAILED).
    fetchMock.mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.includes('/pages') && !u.includes('/elementor') && !u.includes('/media')) {
        return {
          ok: true,
          status: 201,
          text: () =>
            Promise.resolve(
              JSON.stringify({ success: true, data: { id: 200, title: 'TestPrereq' } })
            ),
        };
      }
      if (u.includes('/use-template')) {
        return {
          ok: false,
          status: 400,
          text: () =>
            Promise.resolve(
              JSON.stringify({
                success: false,
                error: { code: 'TEMPLATE_WRONG_TYPE', message: 'Post 89 is a "revision", not an Elementor template.' },
              })
            ),
        };
      }
      // No debería llegar aquí: las ops restantes deben skipearse.
      return {
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify({ success: true, data: {} })),
      };
    });

    const res = await changesRoutes.request('/ch-ph-001/approve', { method: 'POST' });
    expect(res.status).toBe(200);

    type ResBody = { data: { status: string; results: Array<{ tool: string; status: string; error?: { code: string; message: string } }> } };
    const body = (await res.json()) as ResBody;
    expect(body.data.status).toBe('failed'); // Al menos una falló.
    expect(body.data.results).toHaveLength(4);

    // 1. create_page: success.
    expect(body.data.results[0].tool).toBe('create_page');
    expect(body.data.results[0].status).toBe('success');

    // 2. use_template: failed.
    expect(body.data.results[1].tool).toBe('use_template');
    expect(body.data.results[1].status).toBe('failed');

    // 3 + 4: replace_image y update_widget: skipped por PREREQ_FAILED.
    expect(body.data.results[2].tool).toBe('replace_image');
    expect(body.data.results[2].status).toBe('skipped');
    expect(body.data.results[2].error?.code).toBe('PREREQ_FAILED');
    expect(body.data.results[3].tool).toBe('update_widget');
    expect(body.data.results[3].status).toBe('skipped');
    expect(body.data.results[3].error?.code).toBe('PREREQ_FAILED');

    // Solo se hicieron 2 llamadas HTTP (create_page + use_template), no 4.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  /**
   * Regresión: bug reportado — "se crea la página, se aplica la plantilla,
   * pero no se agregaron los archivos a los widgets".
   *
   * Causa raíz: el plugin PHP devolvía `new_element_ids` solo con los IDs
   * TOP-LEVEL del template (no los widgets internos). El orquestador solo
   * conocía el container raíz, así que `{{element_id:N}}` no podía
   * resolverse y caía al fallback `lastContainerId` en `resolveSpecialKeys`,
   * apuntando al container equivocado → la operación se ejecutaba "exitosa"
   * pero no afectaba al widget real, sin ningún error visible.
   *
   * Fix:
   *   1) Plugin devuelve la lista DFS completa de IDs (containers + widgets).
   *   2) Defensiva en el orquestador: si el placeholder no se resuelve,
   *      se emite un `logger.warn` con contexto y el placeholder CRUDO llega
   *      al plugin (no se enmascara con `''` ni con el último container).
   *      El operador ve el warning y el plugin devuelve error explícito.
   *
   * Este test cubre la defensiva del orquestador (independiente del fix
   * del plugin) verificando que un placeholder sin resolver:
   *   - produce un warning estructurado,
   *   - NO se sustituye por lastContainerId,
   *   - llega al plugin con el string crudo (URL inválida → operación failed,
   *     en vez de un éxito silencioso que apuntaba al widget equivocado).
   */
  it('placeholder sin resolver: log warning + placeholder crudo llega al plugin (no fallback lastContainerId)', async () => {
    // use_template devuelve solo 1 ID top-level (modo bug del plugin).
    // Luego replace_image referencia {{element_id:2}} (índice fuera de rango).
    _dbOverride
      .prepare(`UPDATE changes SET operations = ? WHERE id = 'ch-ph-001'`)
      .run(
        JSON.stringify([
          { tool: 'create_page', arguments: { title: 'UnresolvedBug', status: 'draft', builder: 'elementor' } },
          { tool: 'use_template', arguments: { page_id: '{{page_id}}', template_id: 55, change_id: 'tpl-55' } },
          {
            tool: 'replace_image',
            arguments: {
              page_id: '{{page_id}}',
              element_id: '{{element_id:2}}', // índice fuera de rango en el array bug
              media_id: 117,
              change_id: 'ri-bug-1',
            },
          },
        ])
      );

    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        text: () => Promise.resolve(JSON.stringify({ success: true, data: { id: 300, title: 'UnresolvedBug' } })),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              success: true,
              data: { new_element_ids: ['cafe123'], page_id: 300 },
            })
          ),
      })
      // replace_image con URL inválida → el plugin WordPress devuelve 404 real
      // (esto es lo que DEBERÍA haber pasado en producción antes del fix;
      // antes el orquestador "tapaba" el bug con fallback a lastContainerId).
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              success: false,
              error: { code: 'ELEMENT_NOT_FOUND', message: 'Element not found' },
            })
          ),
      });

    const res = await changesRoutes.request('/ch-ph-001/approve', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.status).toBe('failed');

    // Se ejecutaron 3 llamadas (create_page, use_template, replace_image).
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // La 3ª llamada (replace_image) recibió el placeholder CRUDO en la URL,
    // NO el fallback lastContainerId ('cafe123'). El `URL` de Node puede
    // encodar el `:` o dejarlo literal según el contexto, así que usamos
    // una regex tolerante al encoding.
    const [repImgUrl, repImgInit] = fetchMock.mock.calls[2];
    const urlStr = String(repImgUrl);
    expect(urlStr).toMatch(/\/pages\/300\/elementor\/widgets\/%7B%7Belement_id(?::|%3A)2%7D%7D/);
    expect(urlStr).not.toContain('cafe123');
    const repImgBody = JSON.parse(repImgInit.body);
    expect(repImgBody.media_id).toBe(117);

    // El warning se emitió con el placeholder crudo y el contexto relevante.
    expect(warnSpy).toHaveBeenCalled();
    const warnCalls = warnSpy.mock.calls;
    const hasUnresolvedWarn = warnCalls.some((call) => {
      // pino logger.warn(obj, msg) — buscamos en el objeto o en el mensaje.
      const serialized = JSON.stringify(call);
      return (
        serialized.includes('element_id:2') &&
        serialized.includes('Placeholder could not be resolved')
      );
    });
    expect(hasUnresolvedWarn).toBe(true);

    warnSpy.mockRestore();
  });
});
