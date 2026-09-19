/**
 * Normalización de respuestas del plugin WordPress.
 *
 * El plugin bridge expone varios endpoints REST que devuelven listas de items.
 * Lamentablemente, esos endpoints no son consistentes entre sí:
 *
 *   GET /pages     → { success, data: [...], pagination: { total, per_page, page } }
 *   GET /media     → { success, data: { items: [...], pagination: {...} } }
 *   GET /templates → { success, data: [...] }                    (sin pagination)
 *   GET /audit     → { success, data: [...] }                    (sin pagination)
 *   GET /health    → { success, data: {...} }                    (single object)
 *
 * Después de pasar por callWp (que extrae `data`), el orchestrator recibe
 * la forma interna sin el wrapper de success. El normalizador convierte
 * todas estas variantes a la forma canónica `{ items, pagination }`.
 *
 * Uso:
 *
 *   const raw = await callWp<unknown>(site, 'GET', '/pages');
 *   const normalized = normalizeList<Page>(raw);
 *   return c.json({ success: true, data: normalized });
 */

import type { CollectionResponse, Pagination, RawPluginResponse } from './types.js';

export * from './types.js';

function defaultPagination(itemsLen: number): Pagination {
  return { total: itemsLen, page: 1, per_page: itemsLen };
}

function extractPagination(raw: Record<string, unknown>, itemsLen: number): Pagination {
  const p = raw.pagination;
  if (p && typeof p === 'object') {
    const obj = p as Record<string, unknown>;
    const total = typeof obj.total === 'number' ? obj.total : itemsLen;
    const page = typeof obj.page === 'number' ? obj.page : 1;
    const per_page = typeof obj.per_page === 'number' ? obj.per_page : itemsLen;
    return { total, page, per_page };
  }
  return defaultPagination(itemsLen);
}

/**
 * Normaliza cualquier respuesta del plugin a `{ items, pagination }`.
 *
 * Acepta TODAS estas formas (post-`callWp` ya extrajo `data`):
 *   1. Array directo: `[...]`                                  → items, default pagination
 *   2. `{ data: [...], pagination }`                           → items, provided pagination
 *   3. `{ items: [...], pagination }`                          → items, provided pagination
 *   4. `{ success, data: [...], pagination }`                  → items, provided pagination
 *   5. `null` o `undefined`                                    → { items: [], pagination: {0,1,0} }
 *   6. Cualquier otra cosa                                     → { items: [], pagination: {0,1,0} }
 *
 * @param raw La respuesta cruda del plugin (post-callWp unwrap).
 * @param opts.per_page_override Si el plugin no provee per_page, usar este valor.
 */
export function normalizeList<T>(
  raw: RawPluginResponse,
  opts: { per_page_override?: number } = {}
): CollectionResponse<T> {
  if (raw === null || raw === undefined) {
    return { items: [], pagination: { total: 0, page: 1, per_page: opts.per_page_override ?? 0 } };
  }

  // Caso 1: array directo.
  if (Array.isArray(raw)) {
    return {
      items: raw as T[],
      pagination: opts.per_page_override !== undefined
        ? { total: raw.length, page: 1, per_page: opts.per_page_override }
        : defaultPagination(raw.length),
    };
  }

  // Casos 2-4: objeto con data o items.
  if (typeof raw === 'object') {
    const r = raw as Record<string, unknown>;

    // Priorizar `items` si existe (más explícito).
    if (Array.isArray(r.items)) {
      const items = r.items as T[];
      return { items, pagination: extractPagination(r, items.length) };
    }

    // Sino, `data` con array.
    if (Array.isArray(r.data)) {
      const items = r.data as T[];
      return { items, pagination: extractPagination(r, items.length) };
    }
  }

  // Forma desconocida → lista vacía.
  return { items: [], pagination: { total: 0, page: 1, per_page: opts.per_page_override ?? 0 } };
}

/**
 * Normaliza una respuesta single-object (health, design-system, page individual).
 *
 * El plugin devuelve `{ success, data: {...} }` y callWp extrae `data`.
 * Esta función es defensiva: si el plugin envuelve extra o devuelve null,
 * retorna `null` en lugar de propagar datos corruptos.
 */
export function normalizeSingle<T>(raw: RawPluginResponse): T | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'object') return null;
  return raw as T;
}
