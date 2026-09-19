/**
 * customQuickActions — storage local de "accesos directos personalizados"
 * para el chat.
 *
 * Los quick actions built-in viven en `QUICK_ACTIONS` (QuickActions.tsx) y
 * son inmutables. Los customs son definidos por el usuario y se persisten
 * en `localStorage` con la key `chat:customQuickActions:v1`.
 *
 * Cada custom action se asocia a una **categoría existente** (un id de
 * `QUICK_ACTIONS`), no agrega una categoría nueva. Así "Mis páginas en
 * borrador" se mete dentro de `pages`, "Mis templates por color" dentro de
 * `templates`, etc.
 *
 * El scope es por-navegador: si el usuario cambia de device o limpia el
 * storage del browser, los customs se pierden. Si querés persistencia
 * server-side hay que meter un endpoint en el orchestrator (no incluido).
 *
 * Versioning: el sufijo `:v1` permite invalidar/migrar el formato sin
 * romper deployments viejos. Si cambiás la shape, bumpealo a `:v2`.
 */

const STORAGE_KEY = 'chat:customQuickActions:v1';

export interface CustomQuickAction {
  /** ID único estable (se usa como key de React). Prefijo `custom_`. */
  id: string;
  /** ID de la categoría (`pages`, `templates`, etc.) a la que pertenece. */
  categoryId: string;
  /** Etiqueta visible en la lista del sub-panel. */
  label: string;
  /** Descripción corta debajo del label. Default: 'Acción personalizada'. */
  description: string;
  /** Texto que se inyecta en el textarea del chat al elegir esta opción. */
  prompt: string;
}

/**
 * Carga los custom actions desde localStorage. Retorna [] si:
 *   - Estamos en SSR (no hay window).
 *   - El storage está vacío.
 *   - El JSON está corrupto (lo loggea y devuelve [] para no romper la UI).
 */
export function loadCustomActions(): CustomQuickAction[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Filtramos entradas mal formadas para que un storage corrupto no rompa
    // el render del QuickActions (un custom con campos faltantes explotaría
    // cuando intentamos leer `prompt`).
    return parsed.filter(
      (a): a is CustomQuickAction =>
        a &&
        typeof a.id === 'string' &&
        typeof a.categoryId === 'string' &&
        typeof a.label === 'string' &&
        typeof a.prompt === 'string'
    );
  } catch (err) {
    console.warn('[customQuickActions] load failed:', err);
    return [];
  }
}

/**
 * Persiste la lista completa. Usado por el `add` y `remove` debajo,
 * pero también exportado por si en el futuro se quiere un "reset all".
 */
export function saveCustomActions(actions: CustomQuickAction[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(actions));
  } catch (err) {
    // QuotaExceededError u otros — loggeamos pero no rompemos UX.
    console.warn('[customQuickActions] save failed:', err);
  }
}

/**
 * Crea y persiste un nuevo custom action. Devuelve el action con el `id`
 * generado para que el caller pueda meterlo en state local sin volver
 * a leer storage.
 */
export function addCustomAction(
  input: Omit<CustomQuickAction, 'id'>
): CustomQuickAction {
  const id = `custom_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const newAction: CustomQuickAction = {
    ...input,
    id,
  };
  const current = loadCustomActions();
  saveCustomActions([...current, newAction]);
  return newAction;
}

/**
 * Elimina un custom action por id. No-op si el id no existe.
 */
export function removeCustomAction(id: string): void {
  const current = loadCustomActions();
  const filtered = current.filter((a) => a.id !== id);
  if (filtered.length === current.length) return; // nada que borrar
  saveCustomActions(filtered);
}

/**
 * Elimina todos los customs de una categoría (útil para un futuro botón
 * "reset category" en la UI).
 */
export function clearCategoryCustoms(categoryId: string): void {
  const current = loadCustomActions();
  saveCustomActions(current.filter((a) => a.categoryId !== categoryId));
}