/**
 * Site Inventory — read-only ground-truth cache.
 *
 * Cada vez que el chat va a invocar al LLM, el orchestrator necesita una
 * visión completa del sitio (páginas, templates, media, design system,
 * settings, global widgets) para inyectarla en el system prompt. Hacer
 * todas esas llamadas a WP en cada turno sería costoso (latencia × N
 * endpoints) e inconsistente (mismo sitio, distintas versiones en cada
 * turno).
 *
 * Esta módulo consolida esos endpoints en UN solo cache por sitio:
 *
 *   - TTL configurable vía env var `AI_AGENT_INVENTORY_TTL_MS`
 *     (default 60 s).
 *   - `Promise.allSettled` para que un 404 de un sub-endpoint NO
 *     envenene al resto. Los fallos se marcan como `null` con un campo
 *     `_error` que nombra al endpoint upstream + status.
 *   - Cache invalidable explícitamente con `clearInventoryCache(siteId)`
 *     (usado por la ruta DELETE y por el chat tras ejecutar un plan).
 *   - Cada elemento trae `_error` en lugar de un valor "tóxico" para que
 *     el LLM pueda verlo y decidir (mucho mejor que un inventario vacío
 *     que el LLM rellenaría con IDs inventados).
 */

import { callWp, type WpSite } from '../executor/wp-client.js';
import { logger } from '../logger.js';

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export interface InventorySite {
  id: string;
  name: string;
  url: string;
  wordpress_version?: string;
  elementor_version?: string;
}

export interface InventoryPage {
  id: number;
  title: string;
  status: string;
  url?: string;
  modified?: string;
}

export interface InventoryTemplate {
  id: number;
  title: string;
  type: string;
  created?: string;
}

export interface InventoryMediaItem {
  id: number;
  title: string;
  url: string;
  mime_type?: string;
}

export interface InventoryGlobalWidget {
  id: number;
  title: string;
}

/**
 * Forma de error embebido en un campo del inventario: el endpoint upstream
 * devolvió un error. NO se trata como inventario vacío — el LLM debe saber
 * que no tenemos la verdad sobre esa parte del sitio y obrar en
 * consecuencia (p.ej. usar `list_pages` antes de inventar IDs).
 */
export interface InventoryFieldError {
  _error: true;
  endpoint: string;
  status: number;
  message: string;
}

/**
 * Representa "no tenemos este dato" sin señalar fallo upstream. Usado por
 * el formatter para que el LLM vea "no disponible" en vez de "error".
 */
export interface InventoryFieldMissing {
  _missing: true;
}

export interface SiteInventory {
  site: InventorySite;
  pages: Array<InventoryPage | InventoryFieldError> | null;
  templates: Array<InventoryTemplate | InventoryFieldError> | null;
  media: Array<InventoryMediaItem | InventoryFieldError> | null;
  designSystem: unknown | InventoryFieldError | InventoryFieldMissing | null;
  siteSettings: unknown | InventoryFieldError | InventoryFieldMissing | null;
  globalWidgets: Array<InventoryGlobalWidget | InventoryFieldError> | null;
  availableTools: string[];
  fetchedAt: string;
  /**
   * Edad en ms cuando se construyó el inventario. Útil para el LLM saber
   * si debe re-preguntar (p.ej. "este inventario es de hace 5 min").
   */
  age_ms?: number;
}

// ─────────────────────────────────────────────────────────────────
// Cache
// ─────────────────────────────────────────────────────────────────

interface CacheEntry {
  data: SiteInventory;
  fetchedAt: number; // ms epoch
}

const cache: Map<string, CacheEntry> = new Map();

function getTtlMs(): number {
  const raw = process.env.AI_AGENT_INVENTORY_TTL_MS;
  if (raw === undefined || raw === '') return 60_000;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return 60_000;
  return parsed;
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

interface WpListResponse<T> {
  success: true;
  data: T[] | { items?: T[] };
}

function unwrapList<T>(raw: unknown): T[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as T[];
  const wrapped = raw as WpListResponse<T>;
  if (wrapped && wrapped.success && wrapped.data) {
    const d = wrapped.data;
    if (Array.isArray(d)) return d;
    if (Array.isArray(d.items)) return d.items;
  }
  // El plugin a veces envuelve bajo `data` sin success flag.
  const data = (raw as { data?: unknown }).data;
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === 'object' && Array.isArray((data as { items?: unknown[] }).items)) {
    return ((data as { items: T[] }).items) ?? [];
  }
  return [];
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

interface SubtaskOutcome<T> {
  value: T | null;
  error: InventoryFieldError | null;
}

/**
 * Llama a un endpoint read-only y devuelve su `data` o un error tipado.
 * NO lanza — siempre resuelve con `{ value, error }`.
 */
async function safeCall<T>(site: WpSite, path: string): Promise<SubtaskOutcome<T>> {
  try {
    const data = await callWp<T>(site, 'GET', path);
    return { value: data, error: null };
  } catch (err) {
    const e = err as { message?: string; httpStatus?: number; code?: string };
    const status = e.httpStatus ?? 0;
    const code = e.code ?? 'UNKNOWN';
    return {
      value: null,
      error: {
        _error: true,
        endpoint: path,
        status,
        message: `${code}: ${e.message ?? 'unknown error'}`,
      },
    };
  }
}

// ─────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────

export interface GetInventoryOptions {
  /** Forzar fetch aunque la entrada del cache esté fresca. */
  forceRefresh?: boolean;
  /**
   * Override del TTL para esta llamada específica (ms). Útil para que el
   * chat use un TTL más corto que el REST público (p.ej. 30 s).
   */
  maxAgeMs?: number;
}

/**
 * Devuelve el inventario (páginas, templates, media, etc.) para un sitio.
 * Usa cache en memoria con TTL configurable.
 */
export async function getInventoryForSite(
  site: WpSite,
  opts: GetInventoryOptions = {}
): Promise<SiteInventory> {
  const ttl = opts.maxAgeMs ?? getTtlMs();
  const now = Date.now();

  // Cache hit si existe, no se forza refresh, y aún no expiró.
  if (!opts.forceRefresh) {
    const cached = cache.get(site.id);
    if (cached && now - cached.fetchedAt < ttl) {
      // Anotar edad actual para el formatter (y para /health).
      const data: SiteInventory = { ...cached.data, age_ms: now - cached.fetchedAt };
      return data;
    }
  }

  // Cache miss / TTL expiry / forceRefresh → refetch concurrente.
  const settled = await Promise.allSettled([
    safeCall<unknown>(site, '/health'),
    safeCall<unknown>(site, '/pages?per_page=200'),
    safeCall<unknown>(site, '/templates?per_page=200'),
    safeCall<unknown>(site, '/media?per_page=100'),
    safeCall<unknown>(site, '/design-system'),
    safeCall<unknown>(site, '/site-settings'),
    safeCall<unknown>(site, '/global-widgets?per_page=100'),
  ]);

  const [health, pages, templates, media, designSystem, siteSettings, globalWidgets] =
    settled;

  // Helper: si la settled promise rejected (no debería pasar, pero por
  // seguridad), tratarlo como error de campo.
  const unwrap = <T,>(r: PromiseSettledResult<SubtaskOutcome<T>>): SubtaskOutcome<T> => {
    if (r.status === 'rejected') {
      return {
        value: null,
        error: {
          _error: true,
          endpoint: 'unknown',
          status: 0,
          message: r.reason instanceof Error ? r.reason.message : String(r.reason),
        },
      };
    }
    return r.value;
  };

  const healthRes = unwrap(health);
  const pagesRes = unwrap(pages);
  const templatesRes = unwrap(templates);
  const mediaRes = unwrap(media);
  const designRes = unwrap(designSystem);
  const settingsRes = unwrap(siteSettings);
  const widgetsRes = unwrap(globalWidgets);

  // Loggear warnings de los fallos (no son fatales — son información para debug).
  const failures = [pagesRes, templatesRes, mediaRes, designRes, settingsRes, widgetsRes].filter(
    (r) => r.error !== null
  );
  if (failures.length > 0) {
    logger.warn(
      {
        site: site.id,
        failed: failures.map((f) => ({ endpoint: f.error!.endpoint, status: f.error!.status })),
      },
      'Site inventory: some subtasks failed; partial inventory returned'
    );
  }

  // Extraer availableWidgets del /health (también cubre el caso en que el
  // /health general falle pero su shape esté embebido en otra respuesta;
  // por ahora simplemente: si /health falla, availableTools queda []).
  let availableTools: string[] = [];
  if (healthRes.value && isObject(healthRes.value)) {
    const aw = (healthRes.value as { available_widgets?: unknown }).available_widgets;
    if (Array.isArray(aw)) {
      availableTools = aw.filter((x): x is string => typeof x === 'string');
    }
  }

  // Normalizar /pages /templates /media a arrays (los plugins a veces
  // envuelven bajo { success, data: [...] } o { success, data: { items } }).
  const normalizeListResult = <T,>(r: SubtaskOutcome<unknown>): Array<T | InventoryFieldError> | null => {
    if (r.error) return null; // marcador "endpoint entero falló"
    const items = unwrapList<T>(r.value);
    return items;
  };

  // Cap media to most recent 100 by id desc (defensa por si el plugin
  // ignora per_page en alguna versión).
  const rawMedia = normalizeListResult<InventoryMediaItem>(mediaRes) ?? null;
  const cappedMedia = rawMedia
    ? (rawMedia as InventoryMediaItem[]).slice().sort((a, b) => b.id - a.id).slice(0, 100)
    : null;

  const fetchedAtIso = new Date(now).toISOString();
  const inventory: SiteInventory = {
    site: {
      id: site.id,
      name: site.name,
      url: site.url,
    },
    pages: normalizeListResult<InventoryPage>(pagesRes),
    templates: normalizeListResult<InventoryTemplate>(templatesRes),
    media: cappedMedia,
    designSystem: designRes.error
      ? designRes.error
      : designRes.value === undefined || designRes.value === null
        ? { _missing: true }
        : designRes.value,
    siteSettings: settingsRes.error
      ? settingsRes.error
      : settingsRes.value === undefined || settingsRes.value === null
        ? { _missing: true }
        : settingsRes.value,
    globalWidgets: normalizeListResult<InventoryGlobalWidget>(widgetsRes),
    availableTools,
    fetchedAt: fetchedAtIso,
    age_ms: 0,
  };

  // Guardar en cache (con la edad reseteada — el caller la sobrescribirá
  // con su propia lectura del reloj si quiere).
  cache.set(site.id, { data: inventory, fetchedAt: now });
  logger.info(
    {
      site: site.id,
      pages: inventory.pages?.length ?? 'err',
      templates: inventory.templates?.length ?? 'err',
      media: inventory.media?.length ?? 'err',
      globalWidgets: inventory.globalWidgets?.length ?? 'err',
      hasDesignSystem: inventory.designSystem !== null && !(inventory.designSystem as InventoryFieldError)?._error,
      hasSiteSettings: inventory.siteSettings !== null && !(inventory.siteSettings as InventoryFieldError)?._error,
      availableTools: inventory.availableTools.length,
    },
    'Site inventory built'
  );

  return { ...inventory, age_ms: 0 };
}

/**
 * Elimina la entrada de cache para un sitio. Útil después de un write
 * plan para forzar que el próximo fetch vea datos frescos.
 */
export function clearInventoryCache(siteId: string): boolean {
  return cache.delete(siteId);
}

/**
 * Limpia TODO el cache. Útil para tests y para el endpoint "debug".
 */
export function clearAllInventoryCache(): void {
  cache.clear();
}

/**
 * Debug: estado actual del cache para un sitio (o null si no hay entrada).
 */
export function getInventoryCacheState(
  siteId: string,
  ttlMs = getTtlMs()
): { cached: boolean; age_ms: number; ttl_ms: number; source: 'cache' | 'fresh' } {
  const entry = cache.get(siteId);
  if (!entry) return { cached: false, age_ms: -1, ttl_ms: ttlMs, source: 'fresh' };
  const age = Date.now() - entry.fetchedAt;
  return {
    cached: age < ttlMs,
    age_ms: age,
    ttl_ms: ttlMs,
    source: age < ttlMs ? 'cache' : 'fresh',
  };
}

/**
 * Tamaño actual del cache. Útil para tests / health.
 */
export function inventoryCacheSize(): number {
  return cache.size;
}