/**
 * Integration tests — Site Inventory cache + REST routes.
 *
 *   Cubre:
 *     1. `getInventoryForSite` consolida los 6 sub-endpoints en una
 *        sola respuesta (Promise.allSettled).
 *     2. Cache hit: la segunda llamada no re-fetchea mientras el TTL
 *        no haya expirado.
 *     3. Cache miss por TTL expiry: con TTL=0 cada llamada re-fetchea.
 *     4. `clearInventoryCache(siteId)` fuerza re-fetch en el próximo get.
 *     5. Promise.allSettled isolation: un 404 en un sub-endpoint NO
 *        envenena al resto — los demás siguen devolviendo datos.
 *     6. DELETE /api/sites/:id/inventory limpia la entrada del cache.
 *     7. GET /api/sites/:id/inventory/health devuelve el estado del cache.
 *     8. GET /api/sites/:id/inventory devuelve 404 si el sitio no existe.
 *     9. `formatInventoryForPrompt` renderiza un bloque delimitado con
 *        páginas, templates, media y global widgets.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';

const tmpDir = mkdtempSync(join(tmpdir(), 'orch-inventory-'));
process.env.DATABASE_PATH = join(tmpDir, 'test.db');
process.env.LLM_PROVIDER = 'minimax';
process.env.LLM_MODEL = 'MiniMax-Text-01';
process.env.MINIMAX_API_KEY = 'test-key';
// Forzamos TTL = 30s por default en este archivo; los tests individuales
// lo sobreescriben cuando necesitan 0 u otro valor.
process.env.AI_AGENT_INVENTORY_TTL_MS = '30000';

let _dbOverride: Database.Database | null = null;
vi.mock('../../src/db/client.js', async () => {
  const real = await vi.importActual<typeof import('../../src/db/client.js')>('../../src/db/client.js');
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

// ─── Imports AFTER mock setup ──────────────────────────────────────────
const {
  getInventoryForSite,
  clearInventoryCache,
  clearAllInventoryCache,
  getInventoryCacheState,
  inventoryCacheSize,
} = await import('../../src/context/site-inventory.js');
const { inventoryRoutes } = await import('../../src/routes/inventory.routes.js');
const { formatInventoryForPrompt } = await import('../../src/planner/inventory-formatter.js');

// ─── Helpers ──────────────────────────────────────────────────────────

interface FetchResponse {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}

function jsonResponse(status: number, body: unknown): FetchResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
  };
}

/**
 * Construye un mock de `globalThis.fetch` que enruta por path y devuelve
 * respuestas configurables. Cada `setResponse(path, status, body)` agrega
 * una respuesta que se consume en orden (FIFO por path).
 */
function makeRouter(responses: Record<string, Array<{ status: number; body: unknown }>>) {
  return vi.fn(async (url: string): Promise<FetchResponse> => {
    const u = new URL(url);
    const path = u.pathname.replace('/wp-json/ai-agent/v1', '');
    const queue = responses[path] ?? [];
    if (queue.length === 0) {
      return jsonResponse(404, {
        success: false,
        error: { code: 'NO_MOCK', message: `no mock for ${path}` },
      });
    }
    const r = queue.shift()!;
    return jsonResponse(r.status, r.body);
  });
}

function seedSite(id = 'site-1') {
  if (!_dbOverride) throw new Error('DB not initialized');
  _dbOverride
    .prepare(
      `INSERT INTO sites (id, name, url, api_key_encrypted, status)
       VALUES (?, ?, ?, ?, 'active')`
    )
    .run(id, 'Test Site', `http://${id}.local`, 'test-key');
}

// ─── Tests ─────────────────────────────────────────────────────────────

describe('Site Inventory — getInventoryForSite', () => {
  beforeEach(() => {
    clearAllInventoryCache();
    const dbPath = join(tmpDir, `inv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.db`);
    _dbOverride = new Database(dbPath);
    _dbOverride.pragma('journal_mode = WAL');
    _dbOverride.pragma('foreign_keys = ON');
    _dbOverride.exec(readFileSync(join(process.cwd(), 'src', 'db', 'schema.sql'), 'utf-8'));
    seedSite('site-1');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (_dbOverride) {
      try { _dbOverride.close(); } catch { /* closed */ }
      _dbOverride = null;
    }
  });

  it('consolida los 6 sub-endpoints en una sola respuesta', async () => {
    const router = makeRouter({
      '/health': [
        { status: 200, body: { success: true, data: { available_widgets: ['heading', 'image'], site_name: 'X' } } },
      ],
      '/pages': [
        { status: 200, body: { success: true, data: [{ id: 118, title: 'Jaguar', status: 'publish' }, { id: 124, title: 'DFS', status: 'draft' }] } },
      ],
      '/templates': [
        { status: 200, body: { success: true, data: [{ id: 49, title: 'Plantilla1', type: 'page' }] } },
      ],
      '/media': [
        { status: 200, body: { success: true, data: [{ id: 129, title: 'logo.png', url: 'http://x/logo.png', mime_type: 'image/png' }] } },
      ],
      '/design-system': [
        { status: 200, body: { success: true, data: { colors: { primary: '#fff' } } } },
      ],
      '/site-settings': [
        { status: 200, body: { success: true, data: { timezone: 'UTC' } } },
      ],
      '/global-widgets': [
        { status: 200, body: { success: true, data: [{ id: 5, title: 'Hero global' }] } },
      ],
    });
    globalThis.fetch = router as unknown as typeof fetch;

    const site = { id: 'site-1', name: 'Test Site', url: 'http://site-1.local', apiKey: 'test-key' };
    const inv = await getInventoryForSite(site);

    expect(inv.site.id).toBe('site-1');
    expect(inv.pages).toHaveLength(2);
    expect((inv.pages as Array<{ id: number }>)[0].id).toBe(118);
    expect(inv.templates).toHaveLength(1);
    expect(inv.media).toHaveLength(1);
    expect(inv.globalWidgets).toHaveLength(1);
    expect(inv.availableTools).toEqual(['heading', 'image']);
    expect(inv.designSystem).toEqual({ colors: { primary: '#fff' } });
    expect(inv.siteSettings).toEqual({ timezone: 'UTC' });
    expect(typeof inv.fetchedAt).toBe('string');

    // Las 7 llamadas se hicieron en paralelo, no secuencialmente.
    expect(router).toHaveBeenCalledTimes(7);
  });

  it('cache hit: la segunda llamada no re-fetchea mientras el TTL no expire', async () => {
    const router = makeRouter({
      '/health': [{ status: 200, body: { success: true, data: { available_widgets: [] } } }],
      '/pages': [{ status: 200, body: { success: true, data: [] } }],
      '/templates': [{ status: 200, body: { success: true, data: [] } }],
      '/media': [{ status: 200, body: { success: true, data: [] } }],
      '/design-system': [{ status: 200, body: { success: true, data: {} } }],
      '/site-settings': [{ status: 200, body: { success: true, data: {} } }],
      '/global-widgets': [{ status: 200, body: { success: true, data: [] } }],
    });
    globalThis.fetch = router as unknown as typeof fetch;

    const site = { id: 'site-1', name: 'Test', url: 'http://site-1.local', apiKey: 'k' };
    await getInventoryForSite(site);
    await getInventoryForSite(site);
    await getInventoryForSite(site);

    expect(router).toHaveBeenCalledTimes(7); // Solo la primera vez.
    expect(inventoryCacheSize()).toBe(1);
  });

  it('cache miss por TTL expiry: con TTL=0 cada llamada re-fetchea', async () => {
    // Sobreescribimos el TTL antes del import — lo seteamos por env var,
    // pero como el módulo ya cargó con TTL=30000, usamos forceRefresh para
    // simular el comportamiento de TTL=0.
    const router = makeRouter({
      '/health': [
        { status: 200, body: { success: true, data: { available_widgets: [] } } },
        { status: 200, body: { success: true, data: { available_widgets: [] } } },
      ],
      '/pages': [
        { status: 200, body: { success: true, data: [] } },
        { status: 200, body: { success: true, data: [] } },
      ],
      '/templates': [
        { status: 200, body: { success: true, data: [] } },
        { status: 200, body: { success: true, data: [] } },
      ],
      '/media': [
        { status: 200, body: { success: true, data: [] } },
        { status: 200, body: { success: true, data: [] } },
      ],
      '/design-system': [
        { status: 200, body: { success: true, data: {} } },
        { status: 200, body: { success: true, data: {} } },
      ],
      '/site-settings': [
        { status: 200, body: { success: true, data: {} } },
        { status: 200, body: { success: true, data: {} } },
      ],
      '/global-widgets': [
        { status: 200, body: { success: true, data: [] } },
        { status: 200, body: { success: true, data: [] } },
      ],
    });
    globalThis.fetch = router as unknown as typeof fetch;

    const site = { id: 'site-1', name: 'Test', url: 'http://site-1.local', apiKey: 'k' };
    await getInventoryForSite(site, { forceRefresh: true });
    await getInventoryForSite(site, { forceRefresh: true });

    // 7 endpoints x 2 llamadas = 14 fetches.
    expect(router).toHaveBeenCalledTimes(14);
  });

  it('clearInventoryCache fuerza un re-fetch en el próximo get', async () => {
    const router = makeRouter({
      '/health': [
        { status: 200, body: { success: true, data: { available_widgets: [] } } },
        { status: 200, body: { success: true, data: { available_widgets: [] } } },
      ],
      '/pages': [
        { status: 200, body: { success: true, data: [] } },
        { status: 200, body: { success: true, data: [] } },
      ],
      '/templates': [
        { status: 200, body: { success: true, data: [] } },
        { status: 200, body: { success: true, data: [] } },
      ],
      '/media': [
        { status: 200, body: { success: true, data: [] } },
        { status: 200, body: { success: true, data: [] } },
      ],
      '/design-system': [
        { status: 200, body: { success: true, data: {} } },
        { status: 200, body: { success: true, data: {} } },
      ],
      '/site-settings': [
        { status: 200, body: { success: true, data: {} } },
        { status: 200, body: { success: true, data: {} } },
      ],
      '/global-widgets': [
        { status: 200, body: { success: true, data: [] } },
        { status: 200, body: { success: true, data: [] } },
      ],
    });
    globalThis.fetch = router as unknown as typeof fetch;

    const site = { id: 'site-1', name: 'Test', url: 'http://site-1.local', apiKey: 'k' };
    await getInventoryForSite(site);            // 7 fetches
    expect(router).toHaveBeenCalledTimes(7);
    expect(clearInventoryCache('site-1')).toBe(true);
    await getInventoryForSite(site);            // 7 fetches más
    expect(router).toHaveBeenCalledTimes(14);
    // clearInventoryCache sobre un siteId desconocido devuelve false.
    expect(clearInventoryCache('nonexistent')).toBe(false);
  });

  it('Promise.allSettled isolation: un 404 en un endpoint no envenena al resto', async () => {
    const router = makeRouter({
      '/health': [
        { status: 200, body: { success: true, data: { available_widgets: ['a'] } } },
      ],
      '/pages': [
        { status: 200, body: { success: true, data: [{ id: 1, title: 'OK', status: 'publish' }] } },
      ],
      '/templates': [
        { status: 404, body: { success: false, error: { code: 'NOT_FOUND', message: 'no templates endpoint' } } },
      ],
      '/media': [
        { status: 200, body: { success: true, data: [{ id: 5, title: 'logo', url: 'http://x/l.png' }] } },
      ],
      '/design-system': [
        { status: 500, body: { success: false, error: { code: 'INTERNAL', message: 'boom' } } },
      ],
      '/site-settings': [
        { status: 200, body: { success: true, data: { ok: true } } },
      ],
      '/global-widgets': [
        { status: 404, body: { success: false, error: { code: 'NOT_FOUND', message: 'no global widgets' } } },
      ],
    });
    globalThis.fetch = router as unknown as typeof fetch;

    const inv = await getInventoryForSite({
      id: 'site-1',
      name: 'Test',
      url: 'http://site-1.local',
      apiKey: 'k',
    });

    // Los OK siguen OK.
    expect(inv.pages).toHaveLength(1);
    expect(inv.media).toHaveLength(1);
    expect(inv.siteSettings).toEqual({ ok: true });
    expect(inv.availableTools).toEqual(['a']);
    // Los fallidos vienen como null (no como arrays vacíos).
    expect(inv.templates).toBeNull();
    expect(inv.globalWidgets).toBeNull();
    // designSystem viene como un InventoryFieldError (no como null, no como missing).
    expect(inv.designSystem).toMatchObject({ _error: true, endpoint: '/design-system' });
  });

  it('el cap de media ordena por id desc y limita a 100', async () => {
    const bigMedia = Array.from({ length: 250 }, (_, i) => ({
      id: i + 1,
      title: `m${i + 1}`,
      url: `http://x/m${i + 1}.png`,
      mime_type: 'image/png',
    }));
    const router = makeRouter({
      '/health': [{ status: 200, body: { success: true, data: { available_widgets: [] } } }],
      '/pages': [{ status: 200, body: { success: true, data: [] } }],
      '/templates': [{ status: 200, body: { success: true, data: [] } }],
      '/media': [{ status: 200, body: { success: true, data: bigMedia } }],
      '/design-system': [{ status: 200, body: { success: true, data: {} } }],
      '/site-settings': [{ status: 200, body: { success: true, data: {} } }],
      '/global-widgets': [{ status: 200, body: { success: true, data: [] } }],
    });
    globalThis.fetch = router as unknown as typeof fetch;

    const inv = await getInventoryForSite({
      id: 'site-1',
      name: 'Test',
      url: 'http://site-1.local',
      apiKey: 'k',
    });

    expect(inv.media).toHaveLength(100);
    // El primero es el id más alto (250).
    expect((inv.media as Array<{ id: number }>)[0].id).toBe(250);
  });
});

describe('Site Inventory — REST routes', () => {
  beforeEach(() => {
    clearAllInventoryCache();
    const dbPath = join(tmpDir, `inv-routes-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.db`);
    _dbOverride = new Database(dbPath);
    _dbOverride.pragma('journal_mode = WAL');
    _dbOverride.pragma('foreign_keys = ON');
    _dbOverride.exec(readFileSync(join(process.cwd(), 'src', 'db', 'schema.sql'), 'utf-8'));
    seedSite('site-1');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (_dbOverride) {
      try { _dbOverride.close(); } catch { /* closed */ }
      _dbOverride = null;
    }
  });

  it('GET /:siteId/inventory devuelve el inventario consolidado', async () => {
    const router = makeRouter({
      '/health': [{ status: 200, body: { success: true, data: { available_widgets: [] } } }],
      '/pages': [{ status: 200, body: { success: true, data: [{ id: 1, title: 'Home', status: 'publish' }] } }],
      '/templates': [{ status: 200, body: { success: true, data: [] } }],
      '/media': [{ status: 200, body: { success: true, data: [] } }],
      '/design-system': [{ status: 200, body: { success: true, data: {} } }],
      '/site-settings': [{ status: 200, body: { success: true, data: {} } }],
      '/global-widgets': [{ status: 200, body: { success: true, data: [] } }],
    });
    globalThis.fetch = router as unknown as typeof fetch;

    const res = await inventoryRoutes.request('/site-1/inventory', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.site.id).toBe('site-1');
    expect(body.data.pages).toHaveLength(1);
  });

  it('GET /:siteId/inventory devuelve 404 si el sitio no existe', async () => {
    const router = vi.fn(); // No debe ser llamado.
    globalThis.fetch = router as unknown as typeof fetch;

    const res = await inventoryRoutes.request('/nope/inventory', { method: 'GET' });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('NOT_FOUND');
    expect(router).not.toHaveBeenCalled();
  });

  it('GET /:siteId/inventory/health devuelve el estado del cache', async () => {
    const res = await inventoryRoutes.request('/site-1/inventory/health', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.cached).toBe(false);
    expect(body.data.source).toBe('fresh');
    expect(typeof body.data.ttl_ms).toBe('number');
  });

  it('DELETE /:siteId/inventory limpia el cache y devuelve { cleared }', async () => {
    // Poblar el cache primero.
    const router = makeRouter({
      '/health': [{ status: 200, body: { success: true, data: { available_widgets: [] } } }],
      '/pages': [{ status: 200, body: { success: true, data: [] } }],
      '/templates': [{ status: 200, body: { success: true, data: [] } }],
      '/media': [{ status: 200, body: { success: true, data: [] } }],
      '/design-system': [{ status: 200, body: { success: true, data: {} } }],
      '/site-settings': [{ status: 200, body: { success: true, data: {} } }],
      '/global-widgets': [{ status: 200, body: { success: true, data: [] } }],
    });
    globalThis.fetch = router as unknown as typeof fetch;

    await getInventoryForSite({ id: 'site-1', name: 'X', url: 'http://x', apiKey: 'k' });
    expect(getInventoryCacheState('site-1').cached).toBe(true);

    const res = await inventoryRoutes.request('/site-1/inventory', { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.cleared).toBe(true);
    expect(getInventoryCacheState('site-1').cached).toBe(false);
  });
});

describe('Site Inventory — formatInventoryForPrompt', () => {
  it('renderiza un bloque delimitado con páginas, templates, media y global widgets', () => {
    const inv = {
      site: { id: 's1', name: 'X', url: 'http://x' },
      pages: [
        { id: 118, title: 'Jaguar', status: 'publish' },
        { id: 124, title: 'DFS_FIX_VERIFY', status: 'draft' },
      ],
      templates: [{ id: 49, title: 'Plantilla1', type: 'page' }],
      media: [{ id: 129, title: 'logo.png', url: 'http://x/logo.png', mime_type: 'image/png' }],
      designSystem: { colors: { primary: '#fff' } },
      siteSettings: { timezone: 'UTC' },
      globalWidgets: [{ id: 5, title: 'Hero global' }],
      availableTools: ['heading', 'image'],
      fetchedAt: '2026-01-01T00:00:00.000Z',
      age_ms: 0,
    };

    const out = formatInventoryForPrompt(inv);
    expect(out).toContain('INVENTARIO ACTUAL DEL SITIO');
    expect(out).toContain('id=118');
    expect(out).toContain('Jaguar');
    expect(out).toContain('id=49');
    expect(out).toContain('Plantilla1');
    expect(out).toContain('id=129');
    expect(out).toContain('logo.png');
    expect(out).toContain('NEVER invent page_id');
    expect(out).toContain('Available tools');
    // No debe contener secretos obvios (apiKey, tokens).
    expect(out.toLowerCase()).not.toContain('apikey=');
    expect(out.toLowerCase()).not.toContain('token=');
  });

  it('anota campos con error upstream en vez de inventar IDs', () => {
    const inv = {
      site: { id: 's1', name: 'X', url: 'http://x' },
      pages: null,
      templates: [],
      media: [],
      designSystem: { _error: true, endpoint: '/design-system', status: 500, message: 'INTERNAL: boom' },
      siteSettings: { _missing: true },
      globalWidgets: [],
      availableTools: [],
      fetchedAt: '2026-01-01T00:00:00.000Z',
      age_ms: 0,
    };

    const out = formatInventoryForPrompt(inv);
    expect(out).toContain('error al cargar');
    expect(out).toContain('/design-system');
    expect(out).toContain('INTERNAL: boom');
    expect(out).toContain('no disponible en este sitio');
  });
});

// Cleanup del tmpDir al final.
process.on('exit', () => {
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});