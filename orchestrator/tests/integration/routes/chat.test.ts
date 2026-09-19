/**
 * Integration tests — POST /api/chat auto-continue loop.
 *
 * Verifica que el chat iterates automáticamente sin requerir intervención
 * del usuario cuando el LLM hace lecturas seguidas (list_templates,
 * get_template, analyze_page, etc.) antes de generar el Change Plan.
 *
 * Escenarios cubiertos:
 *   1. Chat con 3+ tool_calls secuenciales → produce plan (force-plan tras 2da "non-converging" respuesta).
 *   2. Force-plan funciona en 1er intento cuando LLM devuelve plan directo tras el nudge.
 *   3. Force-plan itera varias veces (1, 2, 3 intentos) hasta que el LLM produce plan.
 *   4. Force-plan ejecuta tools adicionales pedidas por el LLM durante el nudge.
 *   5. Mensaje sin intención de cambio → no entra en force-plan (devuelve answer).
 *   6. Force-plan abandona tras MAX_FORCE_ITERATIONS si LLM nunca produce plan.
 *
 * NOTA: Estos tests mockean `plan-generator.generateAgentResponse` y
 * `globalThis.fetch` para simular el comportamiento del LLM y el plugin WP
 * sin llamadas reales de red.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';

const tmpDir = mkdtempSync(join(tmpdir(), 'orch-chat-'));
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

// Mock plan-generator.generateAgentResponse para controlar respuestas del LLM.
const _generateAgentResponseMock = vi.fn();
vi.mock('../../../src/planner/plan-generator.js', () => ({
  generateAgentResponse: (...args: unknown[]) => _generateAgentResponseMock(...args),
}));

// Mock site-inventory.getInventoryForSite para no interferir con los
// recuentos de fetchMock en este test (los tests del inventario tienen
// su propio archivo). Devolvemos un inventario vacío y stale — el chat
// no necesita datos reales para ejercitar el force-plan loop.
const _getInventoryForSiteMock = vi.fn(async () => ({
  site: { id: 'site-1', name: 'Test Site', url: 'http://elementor-ia.local' },
  pages: null,
  templates: null,
  media: null,
  designSystem: { _missing: true },
  siteSettings: { _missing: true },
  globalWidgets: null,
  availableTools: [],
  fetchedAt: '2024-01-01T00:00:00.000Z',
  age_ms: 0,
}));
vi.mock('../../../src/context/site-inventory.js', async () => {
  const real = await vi.importActual<typeof import('../../../src/context/site-inventory.js')>('../../../src/context/site-inventory.js');
  return {
    ...real,
    getInventoryForSite: (...args: unknown[]) => _getInventoryForSiteMock(...args),
  };
});

const { chatRoutes } = await import('../../../src/routes/chat.routes.js');

/** Helper: respuesta JSON-wrapped del plugin WP. */
function wpJsonOk(data: unknown, status = 200): Response {
  return {
    ok: true,
    status,
    text: () => Promise.resolve(JSON.stringify({ success: true, data })),
  } as Response;
}

/** Helper: respuesta con tool_calls (answer). */
function answerWithTools(text: string, toolCalls: Array<{ id: string; name: string; arguments?: Record<string, unknown> }>) {
  return {
    type: 'answer' as const,
    text,
    tool_calls: toolCalls.map((tc) => ({ id: tc.id, name: tc.name, arguments: tc.arguments ?? {} })),
  };
}

/** Helper: respuesta answer sin tool_calls. */
function answerTextOnly(text: string) {
  return { type: 'answer' as const, text, tool_calls: [] };
}

/** Helper: respuesta plan. */
function planResp(title: string, description: string, ops: Array<{ tool: string; arguments?: Record<string, unknown> }>) {
  return {
    type: 'plan' as const,
    plan: {
      title,
      description,
      operations: ops.map((o) => ({ tool: o.tool, arguments: o.arguments ?? {} })),
    },
    tool_calls: [],
  };
}

describe('POST /api/chat — auto-continue + force-plan loop', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    const dbPath = join(tmpDir, `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.db`);
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

    // Bootstrap rows normally inserted por `getDb()`. El chat routes usa
    // change_id='__system_read__' para tools de lectura, que FK-referencea
    // sites(id)='__system__' + changes(id). Sin estos rows, los tool calls
    // fallan con FOREIGN KEY constraint failed.
    _dbOverride
      .prepare(
        `INSERT OR IGNORE INTO sites (id, name, url, api_key_encrypted, status, created_at, updated_at)
         VALUES (?, 'System', 'about:blank', '', 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
      )
      .run('__system__');
    _dbOverride
      .prepare(
        `INSERT OR IGNORE INTO changes (id, site_id, title, description, operations, status, created_at)
         VALUES (?, ?, 'System read-only operations', '', '[]', 'completed', CURRENT_TIMESTAMP)`
      )
      .run('__system_read__', '__system__');

    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    _generateAgentResponseMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (_dbOverride) {
      try {
        _dbOverride.close();
      } catch {
        /* already closed */
      }
      _dbOverride = null;
    }
  });

  /**
   * Escenario 1 (regresión del bug original):
   *   - Main loop hace list_templates → get_template → analyze_page (3 tools)
   *   - 4ª llamada: answer sin tool_calls (sale del main loop sin plan)
   *   - Force-plan iter 1: answer (sin plan)
   *   - Force-plan iter 2: PLAN → success
   *
   * Antes del fix esto fallaba: force-plan corría una vez, devolvía answer,
   * y el código daba up — el usuario debía hacer click manual "continúa".
   */
  it('3+ tool_calls secuenciales terminan produciendo un plan (force-plan loop)', async () => {
    _generateAgentResponseMock
      // 1ª LLM call (initial): list_templates
      .mockResolvedValueOnce(answerWithTools('Buscando templates...', [
        { id: 'tc1', name: 'list_templates', arguments: {} },
      ]))
      // 2ª LLM call (main loop iter 1): get_template
      .mockResolvedValueOnce(answerWithTools('Obteniendo template 49...', [
        { id: 'tc2', name: 'get_template', arguments: { id: 49 } },
      ]))
      // 3ª LLM call (main loop iter 2): get_elementor_structure
      .mockResolvedValueOnce(answerWithTools('Analizando estructura de página 99...', [
        { id: 'tc3', name: 'get_elementor_structure', arguments: { id: 99 } },
      ]))
      // 4ª LLM call (main loop iter 3): answer sin tool_calls — main loop sale sin plan
      .mockResolvedValueOnce(answerTextOnly('Tengo el template y la estructura. Procedo a crear.'))
      // 5ª LLM call (force-plan iter 1): sigue devolviendo texto sin plan
      .mockResolvedValueOnce(answerTextOnly('Necesito más contexto para generar el plan.'))
      // 6ª LLM call (force-plan iter 2): PLAN — bingo
      .mockResolvedValueOnce(
        planResp('Crear página Jaguar', 'Crea página Jaguar usando plantilla 49', [
          { tool: 'create_page', arguments: { title: 'Jaguar', status: 'draft', builder: 'elementor' } },
        ])
      );

    // Mock plugin WP: /health + 3 tools.
    fetchMock
      // /health (called during chat init)
      .mockResolvedValueOnce(
        wpJsonOk({ available_widgets: ['heading', 'image'], site_name: 'Test Site', site_url: 'http://elementor-ia.local' })
      )
      // /templates (list_templates)
      .mockResolvedValueOnce(wpJsonOk([{ id: 49, title: 'Plantilla1', type: 'page' }]))
      // /templates/49 (get_template)
      .mockResolvedValueOnce(wpJsonOk({ id: 49, title: 'Plantilla1', content: [] }))
      // /pages/99/elementor (get_elementor_structure)
      .mockResolvedValueOnce(wpJsonOk({ containers: [], widgets: [] }));

    const res = await chatRoutes.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        site_id: 'site-1',
        message: 'Crea página Jaguar con plantilla Plantilla1',
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.type).toBe('plan');
    expect(body.data.plan.title).toBe('Crear página Jaguar');
    expect(body.data.plan.operations).toHaveLength(1);
    expect(body.data.plan.operations[0].tool).toBe('create_page');
    expect(body.data.change_id).toBeDefined();

    // 1 inicial + 3 main loop iters + 2 force-plan iters = 6 calls.
    expect(_generateAgentResponseMock).toHaveBeenCalledTimes(6);

    // Se ejecutaron las 3 read-only tools contra WP.
    expect(fetchMock).toHaveBeenCalledTimes(4); // health + 3 tools
  });

  /**
   * Escenario 2: force-plan funciona en 1er intento cuando LLM responde plan directamente.
   */
  it('force-plan succeeds on first attempt when LLM produces plan immediately', async () => {
    _generateAgentResponseMock
      // 1ª LLM call (initial): list_templates
      .mockResolvedValueOnce(answerWithTools('Buscando templates...', [
        { id: 'tc1', name: 'list_templates', arguments: {} },
      ]))
      // 2ª LLM call (main loop iter 1): answer sin tool_calls — sale del main loop sin plan
      .mockResolvedValueOnce(answerTextOnly('Encontré los templates.'))
      // 3ª LLM call (force-plan iter 1): PLAN directo
      .mockResolvedValueOnce(
        planResp('Plan directo', 'Plan retornado en primer nudge', [
          { tool: 'create_page', arguments: { title: 'X' } },
        ])
      );

    fetchMock
      .mockResolvedValueOnce(
        wpJsonOk({ available_widgets: [], site_name: 'Test Site', site_url: 'http://elementor-ia.local' })
      )
      .mockResolvedValueOnce(wpJsonOk([{ id: 1, title: 'Plantilla1' }]));

    const res = await chatRoutes.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        site_id: 'site-1',
        message: 'Crea página X',
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.type).toBe('plan');
    expect(_generateAgentResponseMock).toHaveBeenCalledTimes(3);
  });

  /**
   * Escenario 3: force-plan ejecuta tools adicionales durante el nudge.
   * El LLM, ante el nudge, pide un tool más (analyze_page) y solo después
   * genera el plan. El loop debe ejecutar el tool y acumular el historial.
   */
  it('force-plan executes additional tool_calls requested during nudge iterations', async () => {
    _generateAgentResponseMock
      // 1ª LLM (initial): list_templates
      .mockResolvedValueOnce(answerWithTools('Buscando templates...', [
        { id: 'tc1', name: 'list_templates', arguments: {} },
      ]))
      // 2ª LLM (main loop iter 1): answer sin tool_calls — main loop sale
      .mockResolvedValueOnce(answerTextOnly('Tengo lo necesario.'))
      // 3ª LLM (force-plan iter 1): pide más tool (analyze_page)
      .mockResolvedValueOnce(answerWithTools('Necesito analizar la página actual primero.', [
        { id: 'tc2', name: 'analyze_page', arguments: { id: 99 } },
      ]))
      // 4ª LLM (force-plan iter 2, tras analyze_page): PLAN
      .mockResolvedValueOnce(
        planResp('Plan con análisis', 'Plan tras ejecutar analyze_page', [
          { tool: 'add_widget', arguments: { page_id: 99, widget: 'heading', settings: { title: 'Hello' } } },
        ])
      );

    fetchMock
      .mockResolvedValueOnce(wpJsonOk({ available_widgets: [], site_name: 'Test Site', site_url: 'http://elementor-ia.local' }))
      .mockResolvedValueOnce(wpJsonOk([{ id: 49, title: 'Plantilla1' }]))
      // analyze_page → /pages/99/elementor
      .mockResolvedValueOnce(wpJsonOk({ analysis: { containers: 1, widgets: 2 } }));

    const res = await chatRoutes.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        site_id: 'site-1',
        message: 'Modifica la página 99 añadiendo un heading',
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.type).toBe('plan');
    expect(body.data.plan.title).toBe('Plan con análisis');

    // 1 inicial + 1 main loop + 2 force-plan (tool + plan) = 4 calls.
    expect(_generateAgentResponseMock).toHaveBeenCalledTimes(4);
    // /health + list_templates + analyze_page = 3 fetches.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  /**
   * Escenario 4: force-plan itera varias veces (2 nudges con texto, plan en iter 3).
   */
  it('force-plan iterates multiple times when LLM keeps returning text without plan', async () => {
    _generateAgentResponseMock
      // 1ª LLM: list_templates
      .mockResolvedValueOnce(answerWithTools('Buscando...', [
        { id: 'tc1', name: 'list_templates', arguments: {} },
      ]))
      // 2ª LLM: answer sin tool_calls — main loop sale
      .mockResolvedValueOnce(answerTextOnly('Tengo templates.'))
      // 3ª (force-plan iter 1): más texto, sin plan
      .mockResolvedValueOnce(answerTextOnly('Hmm, déjame pensar...'))
      // 4ª (force-plan iter 2): más texto, sin plan
      .mockResolvedValueOnce(answerTextOnly('OK, voy a generar el plan...'))
      // 5ª (force-plan iter 3): PLAN
      .mockResolvedValueOnce(
        planResp('Plan tras 3 nudges', 'Plan generado en tercer nudge', [
          { tool: 'create_page', arguments: { title: 'Y' } },
        ])
      );

    fetchMock
      .mockResolvedValueOnce(wpJsonOk({ available_widgets: [], site_name: 'Test Site', site_url: 'http://elementor-ia.local' }))
      .mockResolvedValueOnce(wpJsonOk([{ id: 1, title: 'Plantilla1' }]));

    const res = await chatRoutes.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        site_id: 'site-1',
        message: 'Crea página Y',
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.type).toBe('plan');
    // 1 inicial + 1 main loop + 3 force-plan = 5 calls.
    expect(_generateAgentResponseMock).toHaveBeenCalledTimes(5);
  });

  /**
   * Escenario 5: el LLM nunca produce plan — el force-plan agota el budget
   * (4 iteraciones) y devuelve el último answer.
   */
  it('force-plan abandons after MAX_FORCE_ITERATIONS if LLM never produces plan', async () => {
    _generateAgentResponseMock
      // 1ª: list_templates
      .mockResolvedValueOnce(answerWithTools('Buscando...', [
        { id: 'tc1', name: 'list_templates', arguments: {} },
      ]))
      // 2ª: answer sin tools
      .mockResolvedValueOnce(answerTextOnly('Tengo info.'))
      // 3-6: 4 force-plan iters, todos devuelven texto sin plan
      .mockResolvedValueOnce(answerTextOnly('Nudge 1'))
      .mockResolvedValueOnce(answerTextOnly('Nudge 2'))
      .mockResolvedValueOnce(answerTextOnly('Nudge 3'))
      .mockResolvedValueOnce(answerTextOnly('Nudge 4'));

    fetchMock
      .mockResolvedValueOnce(wpJsonOk({ available_widgets: [], site_name: 'Test Site', site_url: 'http://elementor-ia.local' }))
      .mockResolvedValueOnce(wpJsonOk([{ id: 1 }]));

    const res = await chatRoutes.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        site_id: 'site-1',
        message: 'Crea página Z',
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    // No se logró plan — devuelve answer con el último texto.
    expect(body.data.type).toBe('answer');
    expect(body.data.text).toBe('Nudge 4');
    // 1 inicial + 1 main loop + 4 force-plan = 6 calls.
    expect(_generateAgentResponseMock).toHaveBeenCalledTimes(6);
  });

  /**
   * Escenario 6: mensaje sin intención de cambio → no entra en force-plan.
   * Verifica que la heurística `detectsChangeIntent` filtra correctamente.
   */
  it('mensajes sin verbos de cambio NO disparan force-plan (devuelve answer directo)', async () => {
    _generateAgentResponseMock.mockResolvedValue(
      answerTextOnly('Aquí tienes la lista de páginas que encontraste.')
    );

    fetchMock
      .mockResolvedValueOnce(wpJsonOk({ available_widgets: [], site_name: 'Test Site', site_url: 'http://elementor-ia.local' }))
      .mockResolvedValueOnce(wpJsonOk([{ id: 1, title: 'Inicio' }]));

    const res = await chatRoutes.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        site_id: 'site-1',
        message: '¿Cuántas páginas tiene el sitio?',  // No verbos de cambio
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.type).toBe('answer');
    // Solo 1 call al LLM — sin force-plan.
    expect(_generateAgentResponseMock).toHaveBeenCalledTimes(1);
  });

  /**
   * Escenario 7: el LLM produce plan directamente tras 1 tool call (happy path).
   * Verifica que el main loop sigue funcionando y no entra en force-plan.
   */
  it('LLM que produce plan tras tool calls no entra en force-plan', async () => {
    _generateAgentResponseMock
      // 1ª: list_templates
      .mockResolvedValueOnce(answerWithTools('Buscando templates...', [
        { id: 'tc1', name: 'list_templates', arguments: {} },
      ]))
      // 2ª: PLAN directo
      .mockResolvedValueOnce(
        planResp('Plan rápido', 'Plan tras 1 tool call', [
          { tool: 'create_page', arguments: { title: 'Quick' } },
        ])
      );

    fetchMock
      .mockResolvedValueOnce(wpJsonOk({ available_widgets: [], site_name: 'Test Site', site_url: 'http://elementor-ia.local' }))
      .mockResolvedValueOnce(wpJsonOk([{ id: 49, title: 'Plantilla1' }]));

    const res = await chatRoutes.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        site_id: 'site-1',
        message: 'Crea página Quick',
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.type).toBe('plan');
    // 1 inicial + 1 main loop = 2 calls. No force-plan.
    expect(_generateAgentResponseMock).toHaveBeenCalledTimes(2);
  });
});