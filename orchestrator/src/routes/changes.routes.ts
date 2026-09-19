/**
 * Changes Routes.
 *
 *   GET  /api/changes                       Listar cambios
 *   GET  /api/changes/:id                   Obtener un cambio
 *   POST /api/changes/:id/approve           Aprobar y ejecutar todo el plan (JSON)
 *   POST /api/changes/:id/approve-stream    Aprobar y ejecutar todo el plan (SSE)
 *   POST /api/changes/:id/execute-operation Ejecutar una operación individual
 *   POST /api/changes/:id/reject            Rechazar cambio
 *   POST /api/changes/:id/rollback          Revertir a snapshot anterior (passthrough al plugin)
 */

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { nanoid } from 'nanoid';
import { getDb } from '../db/client.js';
import { type WpSite, WpError, callWp } from '../executor/wp-client.js';
import { executeTool } from '../executor/tool-executor.js';
import { logger } from '../logger.js';
import { decodeSiteRow } from '../security/crypto.js';

/**
 * Tipos de eventos emitidos por `runChangeOperations` durante la ejecución de
 * un change. Cada evento lleva un `event` (que se mapea a la línea `event:`
 * del SSE) y un `data` arbitrario (se serializa como JSON en la línea
 * `data:`). El consumidor (`/approve-stream`) los reenvía al cliente; el
 * `/approve` no los usa pero mantiene la misma forma para que ambos
 * endpoints ejecuten exactamente la misma lógica.
 */
export type OperationEventName = 'op:start' | 'op:success' | 'op:fail' | 'op:skipped';

export interface OperationEvent {
  event: OperationEventName;
  data: Record<string, unknown>;
}

/**
 * Formatea un par (event, data) como un frame SSE completo. Cada frame
 * termina en `\n\n` (dos saltos de línea) según la spec de Server-Sent
 * Events. Usamos esta función como test local; en el endpoint real
 * delegamos en `streamSSE.writeSSE` de Hono, que produce exactamente el
 * mismo wire format.
 */
export function formatSseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export const changesRoutes = new Hono();

// ─────────────────────────────────────────────────────────────────
// Helpers — context & placeholder resolution
// ─────────────────────────────────────────────────────────────────

interface ExecElementTreeNode {
  id: string | null;
  elType: string; // 'widget' | 'container' | 'section' | 'column' | …
  widgetType?: string | null;
  settings?: Record<string, unknown>;
}

interface ExecContext {
  lastPageId?: number;
  lastContainerId?: string;
  /**
   * All new element IDs returned by `use_template`, in order. The first ID
   * is also stored as `lastContainerId` for backwards compatibility, but
   * subsequent widget operations need a way to reference later IDs (e.g.
   * the image widget that lives at index 1). Use `{{element_id:N}}` in
   * the plan to index into this array.
   */
  elementIds?: string[];
  /**
   * Metadata por elemento devuelta por `use_template.new_element_tree`.
   * Cada nodo trae `id`, `elType`, `widgetType` (si aplica) y `settings`.
   * Usado por `pickElementId` para hacer smart fallback: cuando el LLM usa
   * `{{element_id}}` o `{{element_id:0}}` apuntando a un container, busca
   * el primer widget del tipo apropiado (image/video/heading) en este
   * árbol en lugar de retornar el container raíz.
   */
  elementTree?: ExecElementTreeNode[];
  /**
   * Args de la operación actual que se está resolviendo. Se usa como
   * `hint` en `pickElementId` para inferir el widget type apropiado
   * cuando el placeholder indexado apunta a un container.
   */
  argsHint?: Record<string, unknown>;
}

function emptyContext(): ExecContext {
  return {};
}

/**
 * Returns the ID stored at position `idx` in `ctx.elementIds`.
 *
 * Semántica:
 *  - Si `ctx.elementIds` está definido y `idx` cae dentro del rango, devuelve
 *    ese ID (es el caso principal tras `use_template`, donde el plugin
 *    devuelve la lista DFS completa de IDs clonados).
 *  - Si `ctx.elementIds` NO está definido aún (caso `add_container` →
 *    `add_widget` directo, sin `use_template` previo), cae a
 *    `ctx.lastContainerId`.
 *  - Si `ctx.elementIds` está definido pero `idx` está fuera de rango,
 *    devuelve `''`. Esto es deliberado: el LLM pidió un ID que no existe
 *    y reportarlo como "el último container" apuntaba silenciosamente a un
 *    widget equivocado (ver bug "widgets no actualizados tras use_template").
 *    Devolver `''` permite que el resolver emita un warning y deje el
 *    placeholder crudo para que el plugin responda con un error HTTP claro.
 */
export function inferWidgetTypeFromArgs(args: Record<string, unknown>): string | null {
  const json = JSON.stringify(args).toLowerCase();
  if (/["']?(?:media_id|image|image_url|attachment)["']?\s*[:=]/.test(json)) return 'image';
  if (
    /["']?(?:video_type|hosted_url|youtube_url|vimeo_url|dailymotion_url|poster)["']?\s*[:=]/.test(
      json
    )
  )
    return 'video';
  if (/"header_size"\s*:/.test(json) && /"title"\s*:/.test(json)) return 'heading';
  if (/"form_fields"\s*:/.test(json)) return 'form';
  if (/["']?(?:html|code)["']?\s*[:=][^,}]*?"type"\s*:\s*"html"/.test(json)) return 'html';
  if (/"button_text"\s*:/.test(json)) return 'button';
  if (/"text"\s*:/.test(json)) {
    return /"link"\s*:/.test(json) ? 'button' : 'text-editor';
  }
  return null;
}

export function findFirstWidgetOfType(
  tree: ExecElementTreeNode[] | undefined,
  widgetType: string | null,
): string | null {
  if (!Array.isArray(tree)) return null;
  for (const node of tree) {
    if (node.elType === 'widget' && typeof node.id === 'string') {
      if (widgetType === null) return node.id;
      if (node.widgetType === widgetType) return node.id;
    }
  }
  return null;
}

function pickElementId(
  ctx: ExecContext,
  idx: number,
  argsHint?: Record<string, unknown>,
): string {
  const ids = ctx.elementIds;
  if (Array.isArray(ids) && idx >= 0 && idx < ids.length && typeof ids[idx] === 'string') {
    const id = ids[idx] as string;
    if (Array.isArray(ctx.elementTree) && argsHint) {
      const node = ctx.elementTree[idx];
      if (node && node.elType !== 'widget') {
        const widgetType = inferWidgetTypeFromArgs(argsHint);
        const widgetId = findFirstWidgetOfType(ctx.elementTree, widgetType);
        if (widgetId) return widgetId;
      }
    }
    return id;
  }
  if (!Array.isArray(ids)) {
    return ctx.lastContainerId ?? '';
  }
  return '';
}

function resolvePlaceholders(value: unknown, ctx: ExecContext): unknown {
  if (typeof value === 'string') {
    const match = value.match(/^\{\{([^}]+)\}\}$/);
    if (match) {
      const k = match[1].trim();
      if (k === 'page_id' || k === 'pageId') return ctx.lastPageId !== undefined ? ctx.lastPageId : value;
      if (k === 'container_id' || k === 'containerId' || k === 'element_id') {
        return ctx.lastContainerId !== undefined ? ctx.lastContainerId : value;
      }
      // Indexed access into ctx.elementIds: {{element_id:0}}, {{container_id:1}}, ...
      // Used after use_template to reference a specific cloned element by its
      // position in the new_element_ids array.
      const idxMatch = k.match(/^(?:element_id|container_id|containerId):(\d+)$/);
      if (idxMatch) {
        const idx = parseInt(idxMatch[1], 10);
        const resolved = pickElementId(ctx, idx, ctx.argsHint);
        if (resolved !== '') return resolved;
        logUnresolvedPlaceholder(k, ctx);
        return value;
      }
    }
    return value.replace(/\{\{([^}]+)\}\}/g, (_, kk) => {
      const k = kk.trim();
      if (k === 'page_id' || k === 'pageId') return String(ctx.lastPageId ?? '');
      if (k === 'container_id' || k === 'containerId' || k === 'element_id') {
        return String(ctx.lastContainerId ?? '');
      }
      const idxMatch = k.match(/^(?:element_id|container_id|containerId):(\d+)$/);
      if (idxMatch) {
        const idx = parseInt(idxMatch[1], 10);
        const resolved = String(pickElementId(ctx, idx, ctx.argsHint));
        if (resolved !== '') return resolved;
        logUnresolvedPlaceholder(k, ctx);
        return value;
      }
      // Placeholder desconocido (e.g. {{element}}, {{video}}). Reportar como no resuelto
      // y devolver string vacío para que el caller lo vea como error, no aplicar
      // a un container equivocado.
      logUnresolvedPlaceholder(k, ctx);
      return '';
    });
  }
  if (Array.isArray(value)) return value.map((v) => resolvePlaceholders(v, ctx));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = resolvePlaceholders(v, ctx);
    }
    return out;
  }
  return value;
}

/**
 * Emite un warning estructurado cuando un placeholder no se puede resolver.
 *
 * Antes este caso se "enmascaraba" devolviendo `''` o cayendo al fallback
 * "último container_id" en `resolveSpecialKeys`, lo que provocaba fallos
 * silenciosos en operaciones como `update_widget` o `replace_image`
 * (ver bug "widgets no actualizados tras use_template"). Ahora el log es
 * explícito y el placeholder crudo se propaga al plugin, que devolverá
 * un error HTTP claro en lugar de aplicarse al container equivocado.
 */
function logUnresolvedPlaceholder(placeholderKey: string, ctx: ExecContext): void {
  logger.warn(
    {
      placeholder: `{{${placeholderKey}}}`,
      ctx: {
        lastPageId: ctx.lastPageId,
        lastContainerId: ctx.lastContainerId,
        elementIdsAvailable: ctx.elementIds?.length ?? 0,
        elementIds: ctx.elementIds,
      },
    },
    'Placeholder could not be resolved against execution context'
  );
}

function resolveSpecialKeys(args: Record<string, unknown>, ctx: ExecContext): Record<string, unknown> {
  const out = { ...args };
  if (
    'page_id' in out &&
    (out.page_id === 0 ||
      out.page_id === '0' ||
      out.page_id === '' ||
      out.page_id === null ||
      out.page_id === undefined) &&
    ctx.lastPageId !== undefined
  ) {
    out.page_id = ctx.lastPageId;
  }
  // Auto-fallback for container_id / element_id when the LLM passed a
  // placeholder-style string that resolvePlaceholders didn't fully replace
  // (e.g. "main-container", "abc", "0"). Valid Elementor IDs are 7 lowercase
  // hex chars; anything else is treated as a sentinel and replaced with the
  // most recently captured container/element ID.
  //
  // NOTA: NO aplicamos este fallback si el valor sigue siendo un placeholder
  // crudo `{{...}}` sin resolver — esos ya dispararon un warning en
  // `logUnresolvedPlaceholder` y deben llegar al plugin para producir un
  // error HTTP claro en lugar de apuntar al container equivocado (lo que
  // provocaba el bug "widgets no actualizados tras use_template").
  for (const key of ['container_id', 'element_id'] as const) {
    if (!(key in out)) continue;
    const id = out[key];
    if (typeof id === 'string' && /^\{\{[^}]+\}\}$/.test(id)) {
      // placeholder crudo sin resolver: lo dejamos tal cual para que el plugin
      // responda con un error y el operador pueda diagnosticarlo.
      continue;
    }
    if (typeof id === 'string' && !/^[a-f0-9]{7}$/.test(id) && ctx.lastContainerId) {
      out[key] = ctx.lastContainerId;
    }
  }
  return out;
}

function captureContext(toolName: string, result: unknown, ctx: ExecContext): void {
  if (!result || typeof result !== 'object') return;
  const outer = result as Record<string, unknown>;
  // `result` aquí es un ExecutionResult: { tool, status, result?: <tool payload>, error?, retries }.
  // El payload real del tool está anidado en `outer.result`. Si no existe (e.g. falló),
  // caemos al outer para no perder nada.
  const inner = (outer.result && typeof outer.result === 'object')
    ? outer.result as Record<string, unknown>
    : outer;

  if (toolName === 'create_page' && typeof inner.id === 'number') {
    ctx.lastPageId = inner.id;
  }
  if (toolName === 'add_container' || toolName === 'add_widget') {
    if (typeof inner.id === 'string') ctx.lastContainerId = inner.id;
    else if (typeof inner.new_element_id === 'string') ctx.lastContainerId = inner.new_element_id;
    else if (inner.new_element_id !== undefined) ctx.lastContainerId = String(inner.new_element_id);
  }
  // use_template devuelve inner.new_element_ids (array con TODOS los IDs nuevos,
  // no solo el root). Guardamos el array completo para que operaciones
  // posteriores puedan referenciar widgets específicos vía {{element_id:N}}.
  // El primero sigue siendo lastContainerId por compat con planes que usan
  // {{container_id}} después de use_template.
  if (toolName === 'use_template' && Array.isArray(inner.new_element_ids)) {
    const ids = inner.new_element_ids.filter((x): x is string => typeof x === 'string');
    if (ids.length > 0) {
      ctx.elementIds = ids;
      ctx.lastContainerId = ids[0];
    }
    // Metadata por nodo (id, elType, widgetType) para que `pickElementId`
    // pueda hacer smart fallback: si el LLM usa `{{element_id:0}}` apuntando
    // a un container, devolvemos el primer widget del tipo apropiado.
    const tree = inner.new_element_tree;
    if (Array.isArray(tree)) {
      ctx.elementTree = tree.filter(
        (n): n is ExecElementTreeNode =>
          typeof n === 'object' && n !== null && typeof n.id === 'string'
      );
    }
  }
}

/** Build initial context from already-completed operations in this change. */
function recoverContext(db: ReturnType<typeof getDb>, changeId: string): ExecContext {
  const ctx = emptyContext();
  const rows = db
    .prepare(
      `SELECT tool_name, result FROM change_operations
       WHERE change_id = ? AND status = 'success' ORDER BY created_at ASC`
    )
    .all(changeId) as Array<{ tool_name: string; result: string }>;
  for (const r of rows) {
    try {
      const res = JSON.parse(r.result || 'null');
      captureContext(r.tool_name, res, ctx);
    } catch {
      // ignore
    }
  }
  return ctx;
}

interface ChangeRow {
  id: string;
  site_id: string;
  operations: string;
  status: string;
}

interface SiteRow {
  id: string;
  name: string;
  url: string;
  api_key_encrypted: string;
}

function getChange(id: string): ChangeRow | undefined {
  const db = getDb();
  return db.prepare(`SELECT * FROM changes WHERE id = ?`).get(id) as ChangeRow | undefined;
}

function getSite(siteId: string): SiteRow | undefined {
  const db = getDb();
  return decodeSiteRow(
    db
      .prepare(`SELECT id, name, url, api_key_encrypted FROM sites WHERE id = ?`)
      .get(siteId) as SiteRow | undefined
  );
}

/**
 * Resuelve template_ids del plan basándose en el mensaje del usuario.
 *
 * Si el LLM puso un template_id incorrecto (e.g., id=91 que es un revision post),
 * pero el usuario mencionó un nombre de template en su mensaje (e.g., "Plantilla1"),
 * buscamos el match en la lista de templates y corregimos automáticamente.
 *
 * Devuelve { resolved: bool, corrections: Array<{from,to,reason}>, ops: ops_corregidas }.
 */
async function resolveTemplateIdsInPlan(
  site: WpSite,
  ops: Array<{ tool: string; arguments: Record<string, unknown> }>,
  userMessage: string
): Promise<{
  templates: Array<{ id: number; title: string; type: string }>;
  corrections: Array<{ opIndex: number; tool: string; fromId: number; toId: number; reason: string }>;
}> {
  const empty = { templates: [], corrections: [] };
  if (process.env.NODE_ENV === 'test' || process.env.AI_AGENT_SKIP_VALIDATION === '1') return empty;

  const templateToolNames = new Set(['use_template', 'get_template']);
  const templateIds = new Set<number>();
  ops.forEach((op) => {
    if (templateToolNames.has(op.tool)) {
      const id = Number(op.arguments?.template_id);
      if (Number.isInteger(id) && id > 0) templateIds.add(id);
    }
  });
  if (templateIds.size === 0) return empty;

  let templates: Array<{ id: number; title: string; type: string }> = [];
  try {
    const res = await fetch(`${site.url}/wp-json/ai-agent/v1/templates?per_page=100`, {
      method: 'GET',
      headers: { 'X-AI-Agent-Key': site.apiKey, 'Accept': 'application/json' },
    });
    if (res.ok) {
      const json = (await res.json()) as { data?: Array<{ id: number; title: string; type: string }> };
      if (Array.isArray(json.data)) templates = json.data;
    }
  } catch {
    // ignore
  }
  if (templates.length === 0) return { templates, corrections: [] };

  const msgLower = userMessage.toLowerCase();
  const corrections: Array<{ opIndex: number; tool: string; fromId: number; toId: number; reason: string }> = [];

  // Para cada operación con template_id, intentar mejorarlo.
  ops.forEach((op, idx) => {
    if (!templateToolNames.has(op.tool)) return;
    const currentId = Number(op.arguments?.template_id);
    if (!Number.isInteger(currentId) || currentId <= 0) return;
    const current = templates.find((t) => t.id === currentId);

    // Si el actual es válido (elementor_library) y el título está en el mensaje, OK.
    if (
      current &&
      (current.type === 'page' || current.type === 'section' || current.type === 'widget') &&
      msgLower.includes(current.title.toLowerCase())
    ) {
      return;
    }

    // Buscar template cuyo título matchee el mensaje del usuario.
    // Prioridad: match exacto de palabra (delimitado por no-alfanum) > substring > primer match.
    const candidates = templates.filter(
      (t) => t.type === 'page' || t.type === 'section' || t.type === 'widget'
    );
    let best: { t: typeof candidates[0]; score: number } | null = null;
    for (const t of candidates) {
      const tLow = t.title.toLowerCase();
      if (!tLow) continue;
      let score = 0;
      if (msgLower.includes(tLow)) {
        score = 100 + tLow.length; // más largo = más específico
      } else {
        // Match por palabra individual
        const words = tLow.split(/\W+/).filter((w) => w.length >= 4);
        for (const w of words) {
          if (msgLower.includes(w)) {
            score = Math.max(score, w.length);
          }
        }
      }
      if (score > 0 && (!best || score > best.score)) {
        best = { t, score };
      }
    }

    if (best && (!current || best.t.id !== currentId)) {
      op.arguments.template_id = best.t.id;
      corrections.push({
        opIndex: idx,
        tool: op.tool,
        fromId: currentId,
        toId: best.t.id,
        reason: `Cambié template_id=${currentId} por template_id=${best.t.id} ("${best.t.title}") porque matchea tu mensaje.`,
      });
    }
  });

  return { templates, corrections };
}

/**
 * Pre-valida un change plan antes de ejecutar cualquier operación.
 * 1. Resuelve template_ids basándose en el mensaje del usuario (auto-fix).
 * 2. Verifica que cada template_id exista como elementor_library.
 * 3. Si alguno sigue inválido, retorna error.
 */
async function validateChangePlan(
  site: WpSite,
  ops: Array<{ tool: string; arguments: Record<string, unknown> }>,
  userMessage: string
): Promise<{
  ok: true;
  correctedOps?: Array<{ tool: string; arguments: Record<string, unknown> }>;
  corrections?: Array<{ opIndex: number; tool: string; fromId: number; toId: number; reason: string }>;
} | { ok: false; error: { code: string; message: string; details?: unknown } }> {
  if (process.env.NODE_ENV === 'test' || process.env.AI_AGENT_SKIP_VALIDATION === '1') {
    return { ok: true };
  }

  const templateToolNames = new Set(['use_template', 'get_template']);
  const hasTemplateOp = ops.some((op) => templateToolNames.has(op.tool));
  if (!hasTemplateOp) return { ok: true };

  // 1) Auto-resolver template_ids basándose en el mensaje del usuario.
  const { templates, corrections } = await resolveTemplateIdsInPlan(site, ops, userMessage);

  // 2) Validar que cada template_id ahora exista como elementor_library.
  const templateIds = new Set<number>();
  for (const op of ops) {
    if (templateToolNames.has(op.tool)) {
      const id = Number(op.arguments?.template_id);
      if (Number.isInteger(id) && id > 0) templateIds.add(id);
    }
  }

  const errors: Array<{ id: number; reason: string }> = [];
  for (const id of templateIds) {
    const found = templates.find((t) => t.id === id);
    if (!found) {
      errors.push({ id, reason: 'NOT_FOUND — no existe ningún template con ese id' });
      continue;
    }
    if (found.type !== 'page' && found.type !== 'section' && found.type !== 'widget') {
      errors.push({ id, reason: `WRONG_TYPE — post_type del id ${id} es "${found.type}", no elementor_library` });
    }
  }
  if (errors.length === 0) {
    return {
      ok: true,
      correctedOps: corrections.length > 0 ? ops : undefined,
      corrections: corrections.length > 0 ? corrections : undefined,
    };
  }

  const summary = errors
    .map((e) => `  - template_id=${e.id}: ${e.reason}`)
    .join('\n');
  const available = templates
    .filter((t) => t.type === 'page' || t.type === 'section')
    .map((t) => `${t.id}:${t.title}`)
    .join(', ') || '(ninguno)';
  return {
    ok: false,
    error: {
      code: 'INVALID_TEMPLATE_ID',
      message: `El plan referencia template_id(s) inválido(s):\n${summary}\n` +
        `Templates disponibles: ${available}`,
      details: { errors, availableTemplates: templates.map((t) => ({ id: t.id, title: t.title, type: t.type })) },
    },
  };
}

function ensureAwaitingApproval(id: string) {
  const row = getChange(id);
  if (!row) return { error: 'NOT_FOUND' as const, message: 'Change not found.' };
  if (row.status !== 'awaiting_approval') {
    return {
      error: 'INVALID_STATE' as const,
      message: `Change status is "${row.status}". Only awaiting_approval allowed.`,
    };
  }
  return { row };
}

/**
 * Pre-procesa un change aprobado:
 *   - Carga el site (404 si no existe).
 *   - Parsea `ops` desde la DB.
 *   - Valida el plan (template_ids), incluyendo auto-fix basado en el mensaje
 *     del usuario (enviado en el body o recuperado de `messages`).
 *   - Si la validación falla, marca el change como `failed` y devuelve el
 *     error para que el caller lo responda con HTTP 400.
 *
 * Se comparte entre `POST /api/changes/:id/approve` (JSON) y
 * `POST /api/changes/:id/approve-stream` (SSE). En el modo SSE, los errores
 * de validación se devuelven como JSON normal (NO como frame SSE) porque
 * el cliente aún no tiene un stream abierto para escribir.
 */
type ApprovalPrep =
  | {
      ok: true;
      site: WpSite;
      ops: Array<{ tool: string; arguments: Record<string, unknown> }>;
    }
  | {
      ok: false;
      status: 400 | 404;
      body: { success: false; error: { code: string; message: string; details?: unknown } };
    };

async function prepareApproval(
  check: { row: ChangeRow },
  reqBody: Record<string, unknown>
): Promise<ApprovalPrep> {
  const siteRow = getSite(check.row.site_id);
  if (!siteRow) {
    return {
      ok: false,
      status: 404,
      body: { success: false, error: { code: 'SITE_NOT_FOUND', message: 'Site not found.' } },
    };
  }
  const site: WpSite = { id: siteRow.id, name: siteRow.name, url: siteRow.url, apiKey: siteRow.api_key_encrypted };

  let userMessage = typeof reqBody.message === 'string' ? reqBody.message : '';
  const db = getDb();

  let ops = JSON.parse(check.row.operations) as Array<{ tool: string; arguments: Record<string, unknown> }>;
  const validation = await validateChangePlan(site, ops, userMessage);
  if (!validation.ok) {
    db.prepare(`UPDATE changes SET status = 'failed', error_code = ?, error_message = ? WHERE id = ?`)
      .run(validation.error.code, validation.error.message, check.row.id);
    return {
      ok: false,
      status: 400,
      body: {
        success: false,
        error: {
          code: validation.error.code,
          message: validation.error.message,
          details: validation.error.details,
        },
      },
    };
  }

  // Si el validador corrigió template_ids automáticamente, persistir el plan corregido
  // en la DB para que la ejecución use los IDs correctos.
  if (validation.corrections && validation.corrections.length > 0 && validation.correctedOps) {
    logger.info(
      { changeId: check.row.id, corrections: validation.corrections, userMessage },
      'Auto-fixed template_ids based on user message'
    );
    db.prepare(`UPDATE changes SET operations = ? WHERE id = ?`).run(
      JSON.stringify(validation.correctedOps),
      check.row.id
    );
    ops = validation.correctedOps;
  }

  // Fallback: si el frontend no envió message en el body, obtenerlo de la DB.
  if (!userMessage) {
    const lastUserMsg = db
      .prepare(
        `SELECT content FROM messages
         WHERE conversation_id = (SELECT conversation_id FROM changes WHERE id = ?)
           AND role = 'user'
         ORDER BY created_at DESC LIMIT 1`
      )
      .get(check.row.id) as { content: string } | undefined;
    if (lastUserMsg?.content) {
      userMessage = lastUserMsg.content;
      const { corrections } = await resolveTemplateIdsInPlan(site, ops, userMessage);
      if (corrections.length > 0) {
        logger.info({ changeId: check.row.id, corrections, userMessage }, 'Auto-fixed from DB');
        db.prepare(`UPDATE changes SET operations = ? WHERE id = ?`).run(
          JSON.stringify(ops),
          check.row.id
        );
      }
    }
  }

  return { ok: true, site, ops };
}

/**
 * Ejecuta la lista de operaciones de un change y emite eventos por cada
 * paso. Esta función concentra TODA la lógica de orquestación que antes
 * vivía inline en `POST /approve`: resolución de placeholders, abort-chain
 * si una op "productora" falla, captura de contexto, manejo de errores.
 *
 * Se comparte entre `POST /api/changes/:id/approve` (que devuelve los
 * resultados como JSON) y `POST /api/changes/:id/approve-stream` (que los
 * emite como SSE). Los dos endpoints pasan por el MISMO bucle → si un bug
 * se reproduce en uno, se reproduce en el otro.
 *
 * El callback `onEvent` (opcional) recibe `{ event, data }` antes de
 * invocar cada tool (`op:start`), después de éxito (`op:success`), después
 * de fallo (`op:fail`) y cuando se salta por prereq fallido (`op:skipped`).
 * Si el callback no está, los eventos se descartan (modo JSON legacy).
 *
 * Devuelve el array de `ExecutionResult` en el mismo orden que `ops`,
 * preservando la forma exacta que `/approve` ya devolvía — así la API JSON
 * no cambia.
 */
/**
 * Verifica que todos los `use_template` del plan referencien templates
 * que existen en WP. Devuelve void o lanza un Error con código
 * `INVALID_TEMPLATE_ID`.
 *
 * Solo valida IDs numéricos concretos: si el LLM dejó un `{{...}}` o
 * un valor no numérico, esa op fallará al ejecutarse y el error
 * detallado aparecerá en el log del orquestador (no bloqueamos aquí).
 */
async function validateTemplateIds(
  site: WpSite,
  ops: Array<{ tool: string; arguments: Record<string, unknown> }>,
): Promise<void> {
  // Bypass opt-in: los tests del orchestrator (Vitest) usan placeholders
  // numéricos para validar flujos de placeholder resolution sin querer
  // ejecutar el preflight. Para eso setean `SKIP_TEMPLATE_PREFLIGHT=1`
  // en su `beforeEach`. La razón es que esos tests mockean las respuestas
  // específicas del plugin para `create_page` / `use_template` /
  // `replace_image`, y añadir el preflight desbalancea los `toHaveBeenCalledTimes`.
  if (process.env.SKIP_TEMPLATE_PREFLIGHT === '1') {
    return;
  }

  // IDs concretos (no placeholders, no 0) que el plan referencia.
  const concreteIds = ops
    .filter((o) => o.tool === 'use_template')
    .map((o) => o.arguments.template_id)
    .filter((id): id is number => typeof id === 'number' && id > 0);

  if (concreteIds.length === 0) return;

  // Pedimos el listado al endpoint del plugin. Si falla la consulta,
  // no bloqueamos — confiamos en que `/use-template` fallará luego con
  // un mensaje más específico (TEMPLATE_NOT_FOUND, etc.).
  let templates: Array<{ id: number; title: string; type?: string }>;
  try {
    templates = await callWp<Array<{ id: number; title: string; type?: string }>>(
      site,
      'GET',
      '/templates?per_page=100'
    );
  } catch (err) {
    logger.warn(
      { err: (err as Error).message, site: site.id },
      'Preflight: could not fetch /templates list, skipping validation (degraded mode)'
    );
    return;
  }

  // Si la lista viene vacía (plugin sin permisos / set recién creado /
  // respuesta inesperada), tampoco bloqueamos: dejamos que `/use-template`
  // emita su propio error si el id tampoco existe realmente.
  if (!Array.isArray(templates) || templates.length === 0) {
    logger.warn(
      { site: site.id, count: templates?.length },
      'Preflight: /templates returned empty/invalid list, skipping validation (degraded mode)'
    );
    return;
  }

  const validIds = new Set(templates.map((t) => t.id));
  const invalid = concreteIds.filter((id) => !validIds.has(id));

  if (invalid.length === 0) return;

  // Lista nombres legibles para que el operador (o un retry del LLM)
  // sepa qué id usar. Mostramos hasta 20 entries para no inflar el mensaje.
  const availList = templates
    .map((t) => `${t.id}="${t.title}"${t.type ? ` (${t.type})` : ''}`)
    .slice(0, 20)
    .join(', ');
  const errMsg =
    `INVALID_TEMPLATE_ID: el plan referencia template_id(s) inválido(s): ${invalid.join(', ')}. ` +
    `Templates disponibles: ${availList}. ` +
    `Llama a list_templates primero para descubrir el id correcto.`;
  const err = new Error(errMsg) as Error & { code?: string };
  err.code = 'INVALID_TEMPLATE_ID';
  throw err;
}

export async function runChangeOperations(
  site: WpSite,
  changeId: string,
  changeStatus: string,
  ops: Array<{ tool: string; arguments: Record<string, unknown> }>,
  onEvent?: (e: OperationEvent) => Promise<void> | void,
): Promise<unknown[]> {
  const ctx = emptyContext();
  const results: unknown[] = [];

  /**
   * Tools que producen IDs referenciados por operaciones posteriores.
   * Si fallan, las operaciones que dependen de sus IDs deben abortarse.
   * Ej: create_page produce page_id; use_template produce new_element_ids.
   */
  const PRODUCER_TOOLS = new Set(['create_page', 'duplicate_page', 'add_container', 'add_widget', 'use_template']);

  // ───────────────────────────────────────────────────────────────
  // Preflight: validar template_ids antes de ejecutar CUALQUIER op.
  // El LLM a veces alucina IDs (típico: "Plantilla1" → 0 o a un id
  // de template que no existe). Si dejamos correr el plan, la primera
  // op `use_template` falla con un mensaje críptico y todas las
  // siguientes se skipean — un desperdicio de round-trips y un cambio
  // que termina sin aplicar nada. Con este preflight, fallamos antes
  // con un mensaje que:
  //   1) le dice al operador exactamente qué id es inválido,
  //   2) le lista los templates disponibles para que pueda pedirle
  //      al LLM que use el id correcto en una iteración siguiente.
  // ───────────────────────────────────────────────────────────────
  try {
    await validateTemplateIds(site, ops);
  } catch (err) {
    const error = {
      code: (err as Error & { code?: string }).code ?? 'PREFLIGHT_FAILED',
      message: (err as Error).message,
    };
    logger.warn({ changeId: site.id, invalid: error.message }, 'Preflight rejected plan before any op ran');
    for (let i = 0; i < ops.length; i++) {
      results.push({ tool: ops[i].tool, status: 'failed', error, retries: 0 });
      if (onEvent) {
        await onEvent({ event: 'op:fail', data: { tool: ops[i].tool, index: i, error } });
      }
    }
    return results;
  }

  let lastFailedPrereq: string | null = null;

  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];

    // Si ya hubo una falla en una operación previa que era prerequisito de esta,
    // abortar el resto del plan para no acumular errores espurios.
    if (lastFailedPrereq) {
      const skipResult = {
        tool: op.tool,
        status: 'skipped',
        error: { code: 'PREREQ_FAILED', message: `Skipped because previous operation "${lastFailedPrereq}" failed.` },
        retries: 0,
      };
      results.push(skipResult);
      if (onEvent) {
        await onEvent({
          event: 'op:skipped',
          data: { tool: op.tool, index: i, error: skipResult.error },
        });
      }
      continue;
    }

    const operationId = `ch-${changeId}-${op.tool}-${nanoid(6)}`;
    // Setear el hint de args ANTES de resolver placeholders para que
    // `pickElementId` pueda inferir el widget type correcto cuando el
    // placeholder indexado cae en un container (smart fallback).
    ctx.argsHint = op.arguments;
    const resolvedArgs = resolveSpecialKeys(
      resolvePlaceholders(op.arguments, ctx) as Record<string, unknown>,
      ctx
    );

    if (onEvent) {
      await onEvent({
        event: 'op:start',
        data: { tool: op.tool, index: i, operationId },
      });
    }

    const startTime = Date.now();
    try {
      const result = await executeTool(site, changeId, changeStatus, op.tool, resolvedArgs, {
        operationId,
      });
      results.push(result);
      captureContext(op.tool, result, ctx);

      const durationMs = Date.now() - startTime;

      if (result.status === 'success') {
        if (onEvent) {
          await onEvent({
            event: 'op:success',
            data: { tool: op.tool, index: i, durationMs, result: result.result },
          });
        }
      } else if (result.status === 'skipped') {
        if (onEvent) {
          await onEvent({
            event: 'op:skipped',
            data: {
              tool: op.tool,
              index: i,
              durationMs,
              error: result.error ?? { code: 'SKIPPED', message: 'Operation skipped' },
            },
          });
        }
      } else {
        // status === 'failed'
        if (onEvent) {
          await onEvent({
            event: 'op:fail',
            data: {
              tool: op.tool,
              index: i,
              durationMs,
              error: result.error ?? { code: 'UNKNOWN', message: 'Tool execution failed' },
            },
          });
        }
        if (PRODUCER_TOOLS.has(op.tool)) {
          lastFailedPrereq = op.tool;
        }
      }
    } catch (err) {
      const error = { code: 'EXEC_ERROR', message: (err as Error).message };
      results.push({ tool: op.tool, status: 'failed', error, retries: 0 });
      const durationMs = Date.now() - startTime;
      if (onEvent) {
        await onEvent({
          event: 'op:fail',
          data: { tool: op.tool, index: i, durationMs, error },
        });
      }
      if (PRODUCER_TOOLS.has(op.tool)) {
        lastFailedPrereq = op.tool;
      }
    }
  }

  return results;
}

// ─────────────────────────────────────────────────────────────────
// List changes
// ─────────────────────────────────────────────────────────────────
changesRoutes.get('/', (c) => {
  const siteId = c.req.query('site_id');
  const status = c.req.query('status');
  const db = getDb();
  const where: string[] = ['1=1'];
  const params: unknown[] = [];
  if (siteId) {
    where.push('site_id = ?');
    params.push(siteId);
  }
  if (status) {
    where.push('status = ?');
    params.push(status);
  }
  const sql = `SELECT id, site_id, page_id, title, description, status, created_at, approved_at, completed_at
               FROM changes WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT 100`;
  const rows = db.prepare(sql).all(...params);
  // /api/changes devuelve filas del orchestrator (no plugin passthrough).
  // El frontend y los tests E2E consumen `data` como Change[] directo.
  return c.json({ success: true, data: rows });
});

// ─────────────────────────────────────────────────────────────────
// Get one change (with operations)
// ─────────────────────────────────────────────────────────────────
changesRoutes.get('/:id', (c) => {
  const id = c.req.param('id');
  const db = getDb();
  const row = db.prepare(`SELECT * FROM changes WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
  if (!row) return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Change not found' } }, 404);
  const operations = db
    .prepare(`SELECT id, operation_id, tool_name, arguments, result, status, error_code, error_message, created_at, executed_at FROM change_operations WHERE change_id = ? ORDER BY created_at ASC`)
    .all(id);
  return c.json({ success: true, data: { ...row, operations } });
});

// ─────────────────────────────────────────────────────────────────
// Approve all operations at once (bulk)
// ─────────────────────────────────────────────────────────────────
changesRoutes.post('/:id/approve', async (c) => {
  const id = c.req.param('id');
  const check = ensureAwaitingApproval(id);
  if ('error' in check) {
    return c.json({ success: false, error: check }, check.error === 'NOT_FOUND' ? 404 : 400);
  }

  const reqBody = await c.req.json().catch(() => ({} as Record<string, unknown>));
  const prep = await prepareApproval(check, reqBody);
  if (!prep.ok) {
    return c.json(prep.body, prep.status);
  }

  const { site, ops } = prep;
  const db = getDb();

  const now = new Date().toISOString();
  db.prepare(`UPDATE changes SET status = 'approved', approved_at = ? WHERE id = ?`).run(now, id);
  db.prepare(`UPDATE changes SET status = 'executing' WHERE id = ?`).run(id);

  // Modo JSON legacy: sin callback de eventos. La lógica completa vive en
  // `runChangeOperations` (compartida con `/approve-stream`).
  const results = await runChangeOperations(site, id, 'approved', ops);

  const allSuccess = results.every(
    (r: unknown) =>
      r !== null &&
      typeof r === 'object' &&
      (r as { status?: string }).status !== undefined &&
      ((r as { status: string }).status === 'success' || (r as { status: string }).status === 'skipped')
  );

  db.prepare(`UPDATE changes SET status = ?, completed_at = ? WHERE id = ?`).run(
    allSuccess ? 'completed' : 'failed',
    new Date().toISOString(),
    id
  );

  return c.json({
    success: true,
    data: { change_id: id, status: allSuccess ? 'completed' : 'failed', results },
  });
});

// ─────────────────────────────────────────────────────────────────
// Approve all operations — streaming via Server-Sent Events
//
// Mismo endpoint que `/approve`, pero emite eventos `op:start`,
// `op:success`, `op:fail`, `op:skipped` por cada operación en tiempo
// real, y un evento terminal `done` con el resultado agregado. La UI
// puede así actualizar el badge de cada operación en el momento en que
// el backend termina de procesarla, sin esperar a que termine el lote.
//
// El body, la validación de template_ids y la lógica de abort-chain son
// compartidos con `/approve` vía `prepareApproval` y `runChangeOperations`.
// Si cualquiera de los dos cambia, los dos endpoints cambian igual.
// ─────────────────────────────────────────────────────────────────
changesRoutes.post('/:id/approve-stream', async (c) => {
  const id = c.req.param('id');
  const check = ensureAwaitingApproval(id);
  if ('error' in check) {
    return c.json({ success: false, error: check }, check.error === 'NOT_FOUND' ? 404 : 400);
  }

  const reqBody = await c.req.json().catch(() => ({} as Record<string, unknown>));
  const prep = await prepareApproval(check, reqBody);
  if (!prep.ok) {
    // Errores de validación se devuelven como JSON normal (el cliente aún
    // no tiene stream abierto para escribir).
    return c.json(prep.body, prep.status);
  }

  const { site, ops } = prep;
  const db = getDb();

  // Status a executing ANTES de abrir el stream, así cualquier re-fetch
  // concurrente del change ve la transición.
  const now = new Date().toISOString();
  db.prepare(`UPDATE changes SET status = 'approved', approved_at = ? WHERE id = ?`).run(now, id);
  db.prepare(`UPDATE changes SET status = 'executing' WHERE id = ?`).run(id);

  // `X-Accel-Buffering: no` le pide a nginx (y otros proxies reversos)
  // que NO acumulen el response en buffer antes de mandarlo al cliente.
  // Sin esto, los eventos SSE se verían como un único chunk al final.
  // Hono ya setea Transfer-Encoding: chunked + Content-Type: text/event-stream
  // + Cache-Control: no-cache + Connection: keep-alive vía streamSSE.
  c.header('X-Accel-Buffering', 'no');

  return streamSSE(c, async (stream) => {
    // Si el cliente se desconecta, dejamos de emitir pero NO fallamos duro
    // (la DB ya se actualizará abajo al final, si llegamos a ese punto).
    stream.onAbort(() => {
      logger.info({ changeId: id }, 'Client disconnected from approve-stream');
    });

    try {
      const results = await runChangeOperations(site, id, 'approved', ops, async (e) => {
        // `stream.writeSSE` envuelve los datos en el wire format SSE
        // estándar (event/data + doble \n), igual que `formatSseEvent`.
        await stream.writeSSE({ event: e.event, data: JSON.stringify(e.data) });
      });

      const allSuccess = results.every(
        (r: unknown) =>
          r !== null &&
          typeof r === 'object' &&
          (r as { status?: string }).status !== undefined &&
          ((r as { status: string }).status === 'success' || (r as { status: string }).status === 'skipped')
      );

      db.prepare(`UPDATE changes SET status = ?, completed_at = ? WHERE id = ?`).run(
        allSuccess ? 'completed' : 'failed',
        new Date().toISOString(),
        id
      );

      await stream.writeSSE({
        event: 'done',
        data: JSON.stringify({
          change_id: id,
          status: allSuccess ? 'completed' : 'failed',
          results,
        }),
      });
    } catch (err) {
      // Si algo se rompe mid-stream, marcamos failed y enviamos un evento
      // de error antes de cerrar. Hono cerrará el stream en su finally.
      logger.error({ err, changeId: id }, 'Error during streaming approve');
      db.prepare(`UPDATE changes SET status = 'failed', completed_at = ? WHERE id = ?`).run(
        new Date().toISOString(),
        id
      );
      try {
        await stream.writeSSE({
          event: 'done',
          data: JSON.stringify({
            change_id: id,
            status: 'failed',
            results: [],
            error: { code: 'STREAM_ERROR', message: (err as Error).message },
          }),
        });
      } catch {
        // El cliente ya se desconectó; nada que hacer.
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────
// Execute a single operation (per-step approval)
// ─────────────────────────────────────────────────────────────────
changesRoutes.post('/:id/execute-operation', async (c) => {
  const id = c.req.param('id');
  const check = ensureAwaitingApproval(id);
  if ('error' in check) {
    return c.json({ success: false, error: check }, check.error === 'NOT_FOUND' ? 404 : 400);
  }

  const siteRow = getSite(check.row.site_id);
  if (!siteRow) {
    return c.json({ success: false, error: { code: 'SITE_NOT_FOUND', message: 'Site not found.' } }, 404);
  }
  const site: WpSite = { id: siteRow.id, name: siteRow.name, url: siteRow.url, apiKey: siteRow.api_key_encrypted };

  const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
  const operationIndex = Number(body.operationIndex);
  const skip = !!body.skip;

  if (!Number.isInteger(operationIndex) || operationIndex < 0) {
    return c.json(
      { success: false, error: { code: 'INVALID_REQUEST', message: 'operationIndex (>= 0) required.' } },
      400
    );
  }

  const ops = JSON.parse(check.row.operations) as Array<{ tool: string; arguments: Record<string, unknown> }>;
  if (operationIndex >= ops.length) {
    return c.json({ success: false, error: { code: 'OUT_OF_RANGE', message: `operationIndex out of range (max ${ops.length - 1}).` }}, 400);
  }

  const db = getDb();

  // ¿Ya ejecutada esta operación?
  const existing = db
    .prepare(`SELECT id, status FROM change_operations WHERE change_id = ? AND arguments LIKE ? ORDER BY created_at LIMIT 1`)
    .get(id, `%${JSON.stringify(ops[operationIndex]).slice(0, 80)}%`) as { id: string; status: string } | undefined;

  if (existing) {
    return c.json({
      success: true,
      data: { status: existing.status, alreadyExecuted: true, operationIndex },
    });
  }

  // Recuperar context de operaciones previas exitosas.
  const ctx = recoverContext(db, id);

  const op = ops[operationIndex];

  if (skip) {
    db.prepare(
      `INSERT INTO change_operations (id, change_id, operation_id, tool_name, arguments, status, created_at, executed_at)
       VALUES (?, ?, ?, ?, ?, 'skipped', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
    ).run(`op-${nanoid(8)}`, id, nanoid(12), op.tool, JSON.stringify(op.arguments));
    return c.json({ success: true, data: { status: 'skipped', operationIndex } });
  }

  const resolvedArgs = resolveSpecialKeys(
    resolvePlaceholders(op.arguments, ctx) as Record<string, unknown>,
    ctx
  );

  try {
    const result = await executeTool(site, id, 'approved', op.tool, resolvedArgs, {
      operationId: `ch-${id}-op${operationIndex}-${nanoid(6)}`,
    });
    captureContext(op.tool, result, ctx);
    if (result.status === 'failed') {
      return c.json(
        {
          success: false,
          data: {
            status: 'failed',
            operationIndex,
            error: result.error ?? { code: 'UNKNOWN', message: 'Tool execution failed.' },
          },
        },
        500
      );
    }
    return c.json({ success: true, data: { status: result.status, operationIndex, result } });
  } catch (err) {
    logger.error({ err, op }, 'Per-step operation failed');
    return c.json(
      {
        success: false,
        data: {
          status: 'failed',
          operationIndex,
          error: { code: 'EXEC_ERROR', message: (err as Error).message },
        },
      },
      500
    );
  }
});

// ─────────────────────────────────────────────────────────────────
// Reject
// ─────────────────────────────────────────────────────────────────
changesRoutes.post('/:id/reject', (c) => {
  const id = c.req.param('id');
  const db = getDb();
  const result = db
    .prepare(`UPDATE changes SET status = 'rolled_back' WHERE id = ? AND status IN ('awaiting_approval', 'planned')`)
    .run(id);
  if (result.changes === 0) {
    return c.json(
      { success: false, error: { code: 'INVALID_STATE', message: 'Change cannot be rejected in its current state.' } },
      400
    );
  }
  return c.json({ success: true, data: { change_id: id, status: 'rolled_back' } });
});

// ─────────────────────────────────────────────────────────────────
// Rollback (G9 fix) — passthrough al endpoint del plugin + actualiza estado.
// El plugin expone POST /wp-json/ai-agent/v1/changes/{change_id}/rollback
// que restaura el snapshot más reciente. Esta ruta expone esa misma operación
// en el orchestrator para que el frontend / curl no tengan que cambiar de host.
// ─────────────────────────────────────────────────────────────────
changesRoutes.post('/:id/rollback', async (c) => {
  const id = c.req.param('id');
  const db = getDb();

  const changeRow = getChange(id);
  if (!changeRow) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Change not found.' } }, 404);
  }

  const siteRow = getSite(changeRow.site_id);
  if (!siteRow) {
    return c.json({ success: false, error: { code: 'SITE_NOT_FOUND', message: 'Site not found.' } }, 404);
  }
  const site: WpSite = { id: siteRow.id, name: siteRow.name, url: siteRow.url, apiKey: siteRow.api_key_encrypted };

  try {
    const pluginResult = await callWp<unknown>(site, 'POST', `/changes/${id}/rollback`, { changeId: id });

    db.prepare(`UPDATE changes SET status = 'rolled_back', completed_at = ? WHERE id = ?`).run(
      new Date().toISOString(),
      id
    );

    logger.info({ changeId: id, site: site.name }, 'Change rolled back via plugin');
    return c.json({
      success: true,
      data: { change_id: id, status: 'rolled_back', plugin_result: pluginResult },
    });
  } catch (err) {
    const code = err instanceof WpError ? err.code : 'ROLLBACK_ERROR';
    const message = err instanceof Error ? err.message : 'Unknown rollback error';
    logger.error({ err, changeId: id }, 'Rollback failed');
    return c.json({ success: false, error: { code, message } }, 500);
  }
});
