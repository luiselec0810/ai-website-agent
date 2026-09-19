/**
 * Inventory Routes.
 *
 *   GET    /api/sites/:siteId/inventory       Inventario cacheado del sitio (refresh si TTL expiró)
 *   GET    /api/sites/:siteId/inventory/health  Estado del cache (cached, age_ms, ttl_ms, source)
 *   DELETE /api/sites/:siteId/inventory       Limpia la entrada del cache (fuerza refresh en el próximo GET)
 *
 * El inventario consolida las respuestas de los endpoints read-only del
 * plugin WP (pages, templates, media, design-system, site-settings,
 * global-widgets, health) en una sola respuesta. Ver
 * `../context/site-inventory.ts` para los detalles de cache, TTL y
 * manejo de errores por sub-endpoint.
 */

import { Hono } from 'hono';
import {
  getInventoryForSite,
  clearInventoryCache,
  getInventoryCacheState,
} from '../context/site-inventory.js';
import { getDb } from '../db/client.js';
import { decodeSiteRow } from '../security/crypto.js';
import { logger } from '../logger.js';

export const inventoryRoutes = new Hono();

interface SiteRow {
  id: string;
  name: string;
  url: string;
  api_key_encrypted: string;
}

/**
 * Resolver helper: 404 si el sitio no existe, devuelve el site row si sí.
 */
function resolveSiteOrNotFound(c: { req: { param: (k: string) => string }; json: (v: unknown, s?: number) => Response }): { ok: true; site: SiteRow } | { ok: false; res: Response } {
  const siteId = c.req.param('siteId');
  const db = getDb();
  const row = decodeSiteRow(
    db
      .prepare(`SELECT id, name, url, api_key_encrypted FROM sites WHERE id = ?`)
      .get(siteId) as SiteRow | undefined
  );
  if (!row) {
    return {
      ok: false,
      res: c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Site not found' } }, 404) as unknown as Response,
    };
  }
  return { ok: true, site: row };
}

// ─────────────────────────────────────────────────────────────────
// GET /api/sites/:siteId/inventory
// ─────────────────────────────────────────────────────────────────
inventoryRoutes.get('/:siteId/inventory', async (c) => {
  const resolved = resolveSiteOrNotFound(c as unknown as { req: { param: (k: string) => string }; json: (v: unknown, s?: number) => Response });
  if (!resolved.ok) return resolved.res as unknown as Response;
  const row = resolved.site;
  const forceRefresh = c.req.query('refresh') === '1' || c.req.query('force') === '1';

  try {
    const data = await getInventoryForSite(
      { id: row.id, name: row.name, url: row.url, apiKey: row.api_key_encrypted },
      { forceRefresh }
    );
    return c.json({ success: true, data });
  } catch (err) {
    logger.error({ err, siteId: row.id }, 'Inventory fetch failed');
    return c.json(
      {
        success: false,
        error: {
          code: 'INVENTORY_FAILED',
          message: (err as Error).message,
        },
      },
      502
    );
  }
});

// ─────────────────────────────────────────────────────────────────
// GET /api/sites/:siteId/inventory/health
// ─────────────────────────────────────────────────────────────────
inventoryRoutes.get('/:siteId/inventory/health', (c) => {
  const siteId = c.req.param('siteId');
  const db = getDb();
  const row = db.prepare(`SELECT id FROM sites WHERE id = ?`).get(siteId);
  if (!row) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Site not found' } }, 404);
  }
  const state = getInventoryCacheState(siteId);
  return c.json({ success: true, data: state });
});

// ─────────────────────────────────────────────────────────────────
// DELETE /api/sites/:siteId/inventory
// ─────────────────────────────────────────────────────────────────
inventoryRoutes.delete('/:siteId/inventory', (c) => {
  const siteId = c.req.param('siteId');
  const db = getDb();
  const row = db.prepare(`SELECT id FROM sites WHERE id = ?`).get(siteId);
  if (!row) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Site not found' } }, 404);
  }
  const cleared = clearInventoryCache(siteId);
  return c.json({ success: true, data: { cleared } });
});