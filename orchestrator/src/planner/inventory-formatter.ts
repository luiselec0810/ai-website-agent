/**
 * Inventory Formatter — convierte un SiteInventory en un bloque de texto
 * para inyectar en el system prompt del LLM.
 *
 * El LLM usa estos datos como ground truth para no inventar IDs. Si una
 * sección no está disponible (error del upstream o `_missing`), el bloque
 * lo declara explícitamente para que el LLM NO rellene con IDs ficticios.
 *
 * Trimming defensivo: si el inventario es muy grande (>3000 chars ≈
 * ~750 tokens), recortamos los items más viejos primero, manteniendo
 * siempre los más recientes (asunción: los más recientes son los más
 * relevantes). El cap duro es 3000 chars por seguridad.
 */

import type {
  SiteInventory,
  InventoryFieldError,
  InventoryPage,
  InventoryTemplate,
  InventoryMediaItem,
  InventoryGlobalWidget,
} from '../context/site-inventory.js';

const HARD_CHAR_CAP = 3000;
const PER_LIST_CAP = 50;

/**
 * Helper para volcar un campo que puede ser lista, error o missing.
 */
function formatListSection<T extends { id: number; title: string }>(
  label: string,
  items: Array<T | InventoryFieldError> | null | undefined
): string {
  if (items === null || items === undefined) {
    return `# ${label}: (error al cargar este endpoint — pídele al usuario que revise la conexión del plugin)`;
  }
  const errItem = items.find((it) => (it as InventoryFieldError)._error) as InventoryFieldError | undefined;
  if (errItem) {
    return `# ${label}: (error: ${errItem.endpoint} → ${errItem.status} ${errItem.message})`;
  }
  const validItems = items.filter((it): it is T => !(it as InventoryFieldError)._error);
  if (validItems.length === 0) {
    return `# ${label}: (vacío)`;
  }
  const lines = validItems.slice(0, PER_LIST_CAP).map((it) => {
    const extra: string[] = [];
    if ('status' in it && (it as { status?: string }).status) {
      extra.push(`status=${(it as { status: string }).status}`);
    }
    if ('type' in it && (it as { type?: string }).type) {
      extra.push(`type=${(it as { type: string }).type}`);
    }
    if ('mime_type' in it && (it as { mime_type?: string }).mime_type) {
      extra.push(`mime=${(it as { mime_type: string }).mime_type}`);
    }
    return `- id=${it.id} title="${escapeQuotes(it.title)}"${extra.length ? ' ' + extra.join(' ') : ''}`;
  });
  const suffix = validItems.length > PER_LIST_CAP ? ` …(mostrando ${PER_LIST_CAP} de ${validItems.length})` : '';
  return `# ${label} (${validItems.length}):\n${lines.join('\n')}${suffix}`;
}

function formatObjectSection(
  label: string,
  value: unknown
): string {
  if (value === null || value === undefined) return `# ${label}: (no disponible)`;
  if (typeof value === 'object' && value !== null) {
    if ((value as { _error?: unknown })._error) {
      const e = value as InventoryFieldError;
      return `# ${label}: (error: ${e.endpoint} → ${e.status} ${e.message})`;
    }
    if ((value as { _missing?: unknown })._missing) {
      return `# ${label}: (no disponible en este sitio)`;
    }
    // JSON corto.
    try {
      const json = JSON.stringify(value).slice(0, 400);
      return `# ${label}: ${json}`;
    } catch {
      return `# ${label}: (objeto no serializable)`;
    }
  }
  return `# ${label}: ${String(value)}`;
}

function escapeQuotes(s: string): string {
  // Escapar comillas y newlines para mantener el bloque en una sola línea por item.
  return s.replace(/"/g, '\\"').replace(/\n/g, ' ').replace(/\r/g, '').slice(0, 120);
}

/**
 * Construye el bloque delimitado que se inyecta en el system prompt.
 * Trim defensivo: si supera HARD_CHAR_CAP, descartamos los items más
 * viejos de cada lista (sin tocar las primeras 25 entradas, que son las
 * que el LLM probablemente usará primero).
 */
export function formatInventoryForPrompt(inv: SiteInventory): string {
  // Trim por lista si el inventario es enorme — empezamos con los 50 más
  // recientes de cada sección, y si aún así supera el cap, recortamos a 25.
  const buildBlock = (limit: number): string => {
    const sections: string[] = [];
    // Distinguimos tres estados: null (error upstream), [] (vacío OK),
    // o [...] con items. La función `formatListSection` sabe interpretar
    // cada uno — sólo necesitamos pasarle el array tal cual, sin "capear"
    // un null a [].
    if (inv.pages !== undefined) {
      sections.push(
        formatListSection(
          'Páginas',
          inv.pages === null ? null : cap(inv.pages as Array<InventoryPage | InventoryFieldError>, limit)
        )
      );
    }
    if (inv.templates !== undefined) {
      sections.push(
        formatListSection(
          'Templates',
          inv.templates === null ? null : cap(inv.templates as Array<InventoryTemplate | InventoryFieldError>, limit)
        )
      );
    }
    if (inv.media !== undefined) {
      sections.push(
        formatListSection(
          'Media (los más recientes)',
          inv.media === null ? null : cap(inv.media as Array<InventoryMediaItem | InventoryFieldError>, limit)
        )
      );
    }
    if (inv.globalWidgets !== undefined) {
      sections.push(
        formatListSection(
          'Global widgets',
          inv.globalWidgets === null ? null : cap(inv.globalWidgets as Array<InventoryGlobalWidget | InventoryFieldError>, limit)
        )
      );
    }
    sections.push(formatObjectSection('Design system', inv.designSystem));
    sections.push(formatObjectSection('Site settings', inv.siteSettings));
    if (inv.availableTools.length > 0) {
      sections.push(`# Available tools: ${inv.availableTools.slice(0, 30).join(', ')}${inv.availableTools.length > 30 ? '…' : ''}`);
    }
    return sections.join('\n\n');
  };

  let limit = PER_LIST_CAP;
  let block = buildBlock(limit);
  // Recortar si supera el cap — bajamos a 25, luego 10.
  for (const candidate of [PER_LIST_CAP, 25, 10]) {
    if (block.length <= HARD_CHAR_CAP) break;
    limit = candidate;
    block = buildBlock(limit);
  }
  // Último recurso: si seguimos sobre el cap (p.ej. design-system JSON
  // gigantesco), cortamos sin piedad para no romper el system prompt.
  if (block.length > HARD_CHAR_CAP) {
    block = block.slice(0, HARD_CHAR_CAP - 50) + '\n[…truncated for size…]';
  }

  const header = `─── INVENTARIO ACTUAL DEL SITIO (cached, fetched at ${inv.fetchedAt}, age ${Math.floor((inv.age_ms ?? 0) / 1000)}s) ───`;
  const footer = `──────────────────────────────────────────────────────────────────────
Use this list as ground truth. NEVER invent page_id, template_id, media_id
or widget_type — always pick from the inventory above. If a user asks for
something that isn't in the inventory, SAY SO and offer to upload/fetch it.
`;
  return `${header}\n${block}\n\n${footer}`;
}

function cap<T>(arr: Array<T> | null | undefined, limit: number): Array<T> {
  if (!arr) return [];
  if (arr.length <= limit) return arr;
  // Mantener los más recientes (asumimos que vienen ya ordenados por id desc,
  // pero por las dudas los ordenamos).
  return arr.slice(0, limit);
}