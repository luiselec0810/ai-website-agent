/**
 * Tipos canónicos para respuestas del orchestrator.
 *
 * El plugin WordPress devuelve respuestas en diferentes formas según el
 * endpoint (a veces array directo, a veces { data, pagination }, a veces
 * { items, pagination }). El orchestrator normaliza TODAS las listas a
 * { items, pagination } para que el frontend y los tests tengan una forma
 * estable y predecible.
 *
 * @see normalizeList
 */

export interface Pagination {
  /** Total de items disponibles (no solo los de esta página). */
  total: number;
  /** Página actual (1-indexed). */
  page: number;
  /** Items por página. */
  per_page: number;
}

export interface CollectionResponse<T> {
  items: T[];
  pagination: Pagination;
}

export type RawPluginResponse = unknown;
