/**
 * Sites Routes.
 *
 *   GET  /api/sites          Listar sitios conectados
 *   POST /api/sites          Registrar un sitio nuevo
 *   GET  /api/sites/:id      Obtener info de un sitio
 *   POST /api/sites/:id/test Probar conexión
 */

import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { getDb } from '../db/client.js';
import { callWp, WpError, type WpSite } from '../executor/wp-client.js';
import { logger } from '../logger.js';
import { encryptApiKey, decodeSiteRow } from '../security/crypto.js';
import { normalizeList } from '../normalizers/index.js';

export const sitesRoutes = new Hono();

// Listar
sitesRoutes.get('/', (c) => {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, name, url, status, wordpress_version, elementor_version, last_health_check, created_at
       FROM sites ORDER BY created_at DESC`
    )
    .all();

  return c.json({ success: true, data: rows });
});

// Registrar sitio nuevo
sitesRoutes.post('/', async (c) => {
  const body = await c.req.json<{ name: string; url: string; apiKey: string }>();

  if (!body.name || !body.url || !body.apiKey) {
    return c.json({ success: false, error: { code: 'INVALID_REQUEST', message: 'name, url and apiKey are required' } }, 400);
  }

  // Verificar conexión haciendo un /health
  const tempSite: WpSite = { id: 'temp', name: body.name, url: body.url, apiKey: body.apiKey };
  try {
    const health = await callWp<{
      wordpress_version: string;
      elementor_installed: boolean;
      elementor_version: string | null;
      available_widgets: string[];
    }>(tempSite, 'GET', '/health');

    const id = `site_${nanoid(10)}`;
    const now = new Date().toISOString();

    // G10 fix: encriptar apiKey antes de guardar en SQLite (AES-256-GCM).
    const db = getDb();
    db.prepare(
      `INSERT INTO sites (id, name, url, api_key_encrypted, status, wordpress_version, elementor_version, last_health_check, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`
    ).run(
      id,
      body.name,
      body.url,
      encryptApiKey(body.apiKey),
      health.wordpress_version,
      health.elementor_version ?? '',
      now,
      now,
      now
    );

    return c.json({
      success: true,
      data: {
        id,
        name: body.name,
        url: body.url,
        status: 'active',
        wordpress_version: health.wordpress_version,
        elementor_version: health.elementor_version,
        available_widgets: health.available_widgets,
      },
    }, 201);
  } catch (err) {
    logger.error({ err }, 'Failed to register site');
    return c.json(
      {
        success: false,
        error: {
          code: 'CONNECTION_FAILED',
          message: (err as Error).message,
        },
      },
      400
    );
  }
});

// Obtener un sitio
sitesRoutes.get('/:id', (c) => {
  const id = c.req.param('id');
  const db = getDb();
  const row = db
    .prepare(`SELECT id, name, url, status, wordpress_version, elementor_version, last_health_check, created_at FROM sites WHERE id = ?`)
    .get(id);

  if (!row) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Site not found' } }, 404);
  }
  return c.json({ success: true, data: row });
});

// G11 fix: passthrough para listar páginas del sitio (usado por el frontend).
// El frontend llama `/api/sites/{id}/pages` y esto resuelve el site + ejecuta el plugin.
sitesRoutes.get('/:id/pages', async (c) => {
  const id = c.req.param('id');
  const db = getDb();
  const row = decodeSiteRow(
    db
      .prepare(`SELECT id, name, url, api_key_encrypted FROM sites WHERE id = ?`)
      .get(id) as { id: string; name: string; url: string; api_key_encrypted: string } | undefined
  );

  if (!row) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Site not found' } }, 404);
  }

  const site: WpSite = { id: row.id, name: row.name, url: row.url, apiKey: row.api_key_encrypted };
  const search = c.req.query('search');
  const status = c.req.query('status');
  const perPage = c.req.query('per_page');

  try {
    const raw = await callWp<unknown>(site, 'GET', '/pages', {
      query: { search, status, per_page: perPage },
    });
    // Normaliza a { items, pagination } sin importar la forma cruda del plugin.
    const perPageNum = perPage ? Number(perPage) : undefined;
    return c.json({
      success: true,
      data: normalizeList(raw, { per_page_override: perPageNum }),
    });
  } catch (err) {
    return c.json(
      {
        success: false,
        error: {
          code: err instanceof WpError ? err.code : 'WP_ERROR',
          message: (err as Error).message,
        },
      },
      502
    );
  }
});

// ─────────────────────────────────────────────────────────────────
// Upload de archivos desde el navegador del usuario.
// Acepta multipart/form-data (campo "file"), lo reenvía al plugin como
// POST /wp-json/ai-agent/v1/media. Retorna el attachment normalizado.
// Body adicional opcional: title, alt, caption.
// ─────────────────────────────────────────────────────────────────
sitesRoutes.post('/:id/upload', async (c) => {
  const id = c.req.param('id');
  const db = getDb();
  const row = decodeSiteRow(
    db
      .prepare(`SELECT id, name, url, api_key_encrypted FROM sites WHERE id = ?`)
      .get(id) as { id: string; name: string; url: string; api_key_encrypted: string } | undefined
  );
  if (!row) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Site not found' } }, 404);
  }

  const site: WpSite = { id: row.id, name: row.name, url: row.url, apiKey: row.api_key_encrypted };

  // Parse multipart del request entrante.
  let body: FormData;
  try {
    body = await c.req.formData();
  } catch {
    return c.json({ success: false, error: { code: 'INVALID_REQUEST', message: 'Expected multipart/form-data.' } }, 400);
  }

  const file = body.get('file');
  if (!(file instanceof File)) {
    return c.json({ success: false, error: { code: 'INVALID_REQUEST', message: 'Missing "file" field in form-data.' } }, 400);
  }

  // Construir multipart para reenviar al plugin.
  const forward = new FormData();
  forward.append('file', file, file.name);
  const title = body.get('title');
  if (typeof title === 'string' && title) forward.append('title', title);
  const alt = body.get('alt');
  if (typeof alt === 'string' && alt) forward.append('alt', alt);
  const caption = body.get('caption');
  if (typeof caption === 'string' && caption) forward.append('caption', caption);

  const changeId = body.get('change_id');
  const headers: Record<string, string> = {
    'X-AI-Agent-Key': site.apiKey,
    'Accept': 'application/json',
  };
  if (typeof changeId === 'string' && changeId) {
    headers['X-AI-Agent-Change-Id'] = changeId;
  }

  const url = new URL('/wp-json/ai-agent/v1/media', site.url);
  const response = await fetch(url.toString(), { method: 'POST', headers, body: forward });

  const text = await response.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    return c.json({
      success: false,
      error: { code: 'INVALID_RESPONSE', message: `WP returned non-JSON (HTTP ${response.status})` },
    }, 502);
  }

  if (!response.ok) {
    const err = (json as { error?: { code: string; message: string } })?.error;
    return c.json({
      success: false,
      error: { code: err?.code ?? 'WP_ERROR', message: err?.message ?? `HTTP ${response.status}` },
    }, 502);
  }

  const wrapped = json as { success: boolean; data?: unknown; error?: { code: string; message: string } };
  if (wrapped?.success === false) {
    return c.json({
      success: false,
      error: { code: wrapped.error?.code ?? 'UNKNOWN', message: wrapped.error?.message ?? 'Unknown error' },
    }, 502);
  }

  return c.json({ success: true, data: wrapped.data }, 201);
});

// Probar conexión
sitesRoutes.post('/:id/test', async (c) => {
  const id = c.req.param('id');
  const db = getDb();
  const row = decodeSiteRow(
    db
      .prepare(`SELECT id, name, url, api_key_encrypted FROM sites WHERE id = ?`)
      .get(id) as { id: string; name: string; url: string; api_key_encrypted: string } | undefined
  );

  if (!row) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Site not found' } }, 404);
  }

  const site: WpSite = { id: row.id, name: row.name, url: row.url, apiKey: row.api_key_encrypted };
  try {
    const health = await callWp<{
      wordpress_version: string;
      elementor_installed: boolean;
      elementor_version: string | null;
    }>(site, 'GET', '/health');

    db.prepare(
      `UPDATE sites SET wordpress_version = ?, elementor_version = ?, last_health_check = ?, updated_at = ? WHERE id = ?`
    ).run(
      health.wordpress_version,
      health.elementor_version ?? '',
      new Date().toISOString(),
      new Date().toISOString(),
      id
    );

    return c.json({ success: true, data: health });
  } catch (err) {
    return c.json(
      {
        success: false,
        error: { code: 'CONNECTION_FAILED', message: (err as Error).message },
      },
      502
    );
  }
});
