/**
 * API client — todas las llamadas al Orchestrator pasan por aquí.
 *
 * Usa NEXT_PUBLIC_ORCHESTRATOR_URL si está definida (recomendado en dev local).
 * Si no, hace fallback al rewrite de Next.js (que solo funciona dentro de Docker).
 */

import type { Site, Page, Change, ChatResponse, ChangePlan, Conversation, ChatMessageRecord, ConversationChangeRecord } from './types';

// En el navegador, ir directo a localhost:4000 evita problemas con el rewrite
// (que apunta al hostname "orchestrator" del contenedor Docker, no resuelve fuera de Docker).
const BASE =
  (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_ORCHESTRATOR_URL
    ? `${process.env.NEXT_PUBLIC_ORCHESTRATOR_URL}/api`
    : '/api');

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    cache: 'no-store',
  });

  const json = await res.json();

  if (!res.ok || !json.success) {
    throw new Error(json?.error?.message ?? `HTTP ${res.status}`);
  }

  return json.data;
}

// ─────────────────────────────────────────────────────────────────
// Sites
// ─────────────────────────────────────────────────────────────────
export const sitesApi = {
  list: () => request<Site[]>('/sites'),
  get: (id: string) => request<Site>(`/sites/${id}`),
  test: (id: string) =>
    request<{ wordpress_version: string; elementor_installed: boolean; elementor_version: string }>(
      `/sites/${id}/test`,
      { method: 'POST' }
    ),
  create: (data: { name: string; url: string; apiKey: string }) =>
    request<Site>('/sites', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
};

// ─────────────────────────────────────────────────────────────────
// Pages (proxy al WP plugin, vía orchestrator)
// ─────────────────────────────────────────────────────────────────
export const pagesApi = {
  list: (siteId: string, params: { search?: string; status?: string } = {}) => {
    const qs = new URLSearchParams(params as Record<string, string>).toString();
    return request<{ items: Page[]; pagination: unknown }>(
      `/sites/${siteId}/pages${qs ? `?${qs}` : ''}`
    );
  },
};

// ─────────────────────────────────────────────────────────────────
// Media (upload + list desde el navegador)
// ─────────────────────────────────────────────────────────────────
export interface MediaItem {
  id: number;
  title: string;
  alt?: string;
  url: string;
  mime_type?: string;
  width?: number;
  height?: number;
}

/**
 * Subset del `SiteInventory` que nos interesa para `mediaApi.list()`.
 * El endpoint `/inventory` devuelve TODO el inventario consolidado;
 * extraer `media` es la forma más barata de listar media sin agregar
 * un endpoint dedicado al orchestrator. Ver `mediaApi.list` abajo.
 */
interface InventoryMediaResponse {
  media?: Array<MediaItem | { _error: true; endpoint: string; status: number; message: string }>;
}

export const mediaApi = {
  /**
   * Sube un archivo al sitio WordPress vía multipart. El orchestrator hace
   * passthrough al plugin (POST /wp-json/ai-agent/v1/media).
   */
  upload: async (
    siteId: string,
    file: File,
    meta?: { title?: string; alt?: string; caption?: string }
  ): Promise<MediaItem> => {
    const url = `${BASE}/sites/${siteId}/upload`;
    const form = new FormData();
    form.append('file', file, file.name);
    if (meta?.title) form.append('title', meta.title);
    if (meta?.alt) form.append('alt', meta.alt);
    if (meta?.caption) form.append('caption', meta.caption);

    const res = await fetch(url, {
      method: 'POST',
      body: form,
      cache: 'no-store',
      // No agregar Content-Type — el browser setea el boundary correcto.
    });

    const json = await res.json();
    if (!res.ok || !json.success) {
      throw new Error(json?.error?.message ?? `HTTP ${res.status}`);
    }
    return json.data as MediaItem;
  },

  /**
   * Lista los archivos media del sitio, ordenados por id DESC (más
   * recientes primero). El cap actual es 100 (lo aplica el plugin en su
   * `per_page` y lo refuerza `site-inventory.ts` server-side).
   *
   * Implementación: reusa `GET /api/sites/:siteId/inventory` y extrae
   * el campo `media`. No expone un endpoint nuevo del orchestrator —
   * el inventario ya está cacheado en memoria y se considera el
   * source-of-truth para listar media. Params aceptados por shape
   * (futuro): `{ limit?: number; refresh?: boolean }` — `refresh=1`
   * fuerza refetch ignorando el cache.
   *
   * Si el sub-endpoint upstream de media falló, el campo `media`
   * viene como `null` (ver `site-inventory.ts`); lo traduciremos a un
   * error con mensaje para que el panel pueda mostrar "Reintentar".
   */
  list: async (
    siteId: string,
    params: { limit?: number; refresh?: boolean } = {}
  ): Promise<MediaItem[]> => {
    const qs = new URLSearchParams();
    if (params.refresh) qs.set('refresh', '1');
    if (params.limit) qs.set('limit', String(params.limit));
    const query = qs.toString();
    const data = await request<InventoryMediaResponse>(
      `/sites/${siteId}/inventory${query ? `?${query}` : ''}`
    );
    const raw = data?.media;
    if (!raw) {
      throw new Error('Media no disponible (el inventario no pudo cargar el media library)');
    }
    // Filtramos elementos de error (defensivo — el backend nunca debería
    // devolver el array mezclado, pero site-inventory.ts marca errores
    // en campos individuales con `_error`).
    const items = raw.filter(
      (m): m is MediaItem => !m || typeof m !== 'object' || !('_error' in m)
    );
    // Aplicar limit cliente (defensivo: el server ya cap a 100).
    return params.limit ? items.slice(0, params.limit) : items;
  },
};

// ─────────────────────────────────────────────────────────────────
// Chat
// ─────────────────────────────────────────────────────────────────
export const chatApi = {
  send: (data: { site_id: string; conversation_id?: string; message: string }) =>
    request<ChatResponse>('/chat', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
};

// ─────────────────────────────────────────────────────────────────
// Conversations — historial persistente de chats (SRS §17).
// ─────────────────────────────────────────────────────────────────
export const conversationsApi = {
  /**
   * Lista las conversaciones de un sitio, ordenadas por última actualización DESC.
   * Cada item incluye `message_count` y `preview` (primer mensaje del user).
   */
  list: (siteId: string, params: { limit?: number } = {}) => {
    const qs = new URLSearchParams({ site_id: siteId });
    if (params.limit) qs.set('limit', String(params.limit));
    return request<Conversation[]>(`/conversations?${qs.toString()}`);
  },
  /**
   * Devuelve el historial completo de una conversación en orden cronológico,
   * junto con los metadatos de la conversación y los changes (planes) asociados.
   */
  getMessages: (conversationId: string) =>
    request<{
      conversation: Conversation;
      messages: ChatMessageRecord[];
      changes: ConversationChangeRecord[];
    }>(`/conversations/${encodeURIComponent(conversationId)}/messages`),
};

// ─────────────────────────────────────────────────────────────────
// Changes
// ─────────────────────────────────────────────────────────────────

/**
 * Evento emitido por el backend durante el streaming de aprobación
 * (`POST /api/changes/:id/approve-stream`). El callback de `approveStream`
 * recibe este shape por cada frame SSE.
 *
 * - `op:start`   → la operación está por ejecutarse.
 * - `op:success` → la operación terminó OK.
 * - `op:fail`    → la operación falló.
 * - `op:skipped` → se saltó por una falla previa en una op productora.
 * - `done`       → cambio terminado; `data` lleva `change_id`, `status`
 *                  final y `results` agregados (mismo shape que `/approve`).
 */
export type ApproveStreamEvent =
  | { type: 'op:start'; data: { tool: string; index: number; operationId: string } }
  | {
      type: 'op:success';
      data: { tool: string; index: number; durationMs: number; result: unknown };
    }
  | {
      type: 'op:fail';
      data: {
        tool: string;
        index: number;
        durationMs?: number;
        error: { code: string; message: string };
      };
    }
  | {
      type: 'op:skipped';
      data: {
        tool: string;
        index: number;
        durationMs?: number;
        error: { code: string; message: string };
      };
    }
  | { type: 'done'; data: ApproveStreamDoneData };

export interface ApproveStreamDoneData {
  change_id: string;
  status: string;
  results: Array<{
    tool: string;
    status: string;
    retries: number;
    result?: unknown;
    error?: { code: string; message: string };
  }>;
}

export const changesApi = {
  list: (params: { site_id?: string; status?: string } = {}) => {
    const qs = new URLSearchParams(params as Record<string, string>).toString();
    return request<Change[]>(`/changes${qs ? `?${qs}` : ''}`);
  },
  get: (id: string) => request<Change>(`/changes/${id}`),
  approve: (id: string) =>
    request<{
      change_id: string;
      status: string;
      results?: Array<{
        tool: string;
        status: string;
        retries: number;
        error?: { code: string; message: string };
      }>;
    }>(`/changes/${id}/approve`, { method: 'POST' }),

  /**
   * Aprobación vía Server-Sent Events.
   *
   * Abre `POST /api/changes/:id/approve-stream` y procesa el stream SSE
   * del backend frame por frame. Por cada frame llama `onEvent({ type, data })`
   * para que el caller (Chat.tsx) actualice el badge de la operación
   * correspondiente en el momento en que el backend termina de procesarla.
   *
   * Resuelve cuando llega el evento `done` con `data` (el mismo `results[]`
   * que devolvería `/approve`). Si el stream termina sin `done`, o si el
   * status HTTP no es 200, rechaza con un Error.
   *
   * NOTA: pasamos `{ method: 'POST' }` aunque conceptualmente el endpoint
   * modifica estado — el backend lo implementa como POST (más coherente
   * con `/approve` original) y permite enviar el body con `message` para
   * auto-fix de template_ids.
   */
  approveStream: async (
    id: string,
    onEvent: (e: ApproveStreamEvent) => void,
    opts: { message?: string } = {}
  ): Promise<{ status: string; results: ApproveStreamDoneData['results'] }> => {
    const url = `${BASE}/changes/${id}/approve-stream`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts.message ? { message: opts.message } : {}),
      cache: 'no-store',
    });

    if (!res.ok) {
      // El backend devuelve JSON normal para errores de validación/lookup
      // (NO abre stream SSE). Lo parseamos para dar un mensaje útil.
      let detail = `HTTP ${res.status}`;
      try {
        const body = (await res.json()) as { error?: { message?: string } };
        if (body?.error?.message) detail = body.error.message;
      } catch {
        /* leave as HTTP status */
      }
      throw new Error(detail);
    }
    if (!res.body) {
      throw new Error('Response body is null (streaming not supported in this environment)');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    let finalResults: { status: string; results: ApproveStreamDoneData['results'] } | null = null;

    const tryParseData = (raw: string): unknown => {
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Cortar en `\n\n` (separador de frames SSE) y procesar cada uno.
      let frameEnd = buffer.indexOf('\n\n');
      while (frameEnd !== -1) {
        const raw = buffer.slice(0, frameEnd);
        buffer = buffer.slice(frameEnd + 2);

        let eventName = 'message';
        let dataStr = '';
        for (const line of raw.split('\n')) {
          if (line.startsWith('event: ')) {
            eventName = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            // Spec SSE: si hay varias líneas `data:`, se concatenan con `\n`.
            // El backend sólo emite una por frame, pero por seguridad:
            dataStr += (dataStr ? '\n' : '') + line.slice(6);
          }
        }

        if (!eventName || dataStr === '') continue;
        const data = tryParseData(dataStr);

        // Cast: el backend emite los 5 tipos descritos en `ApproveStreamEvent`.
        // Hacemos el cast a `ApproveStreamEvent` y el caller lo valida.
        onEvent({ type: eventName, data } as ApproveStreamEvent);

        if (eventName === 'done') {
          const doneData = data as ApproveStreamDoneData;
          finalResults = {
            status: doneData.status,
            results: doneData.results,
          };
          // Drenar lo que quede del buffer y salir.
          try {
            await reader.cancel();
          } catch {
            /* ignore */
          }
          break;
        }
        frameEnd = buffer.indexOf('\n\n');
      }
      if (finalResults) break;
    }

    if (!finalResults) {
      throw new Error('Stream ended without a `done` event from the server.');
    }
    return finalResults;
  },

  reject: (id: string) =>
    request<{ change_id: string; status: string }>(`/changes/${id}/reject`, { method: 'POST' }),
  rollback: (id: string) =>
    request<{ change_id: string; status: string }>(`/changes/${id}/rollback`, { method: 'POST' }),
  executeOperation: (
    id: string,
    operationIndex: number,
    skip = false
  ): Promise<{
    status: string;
    operationIndex: number;
    result?: unknown;
    alreadyExecuted?: boolean;
    error?: { code: string; message: string };
  }> =>
    request(`/changes/${id}/execute-operation`, {
      method: 'POST',
      body: JSON.stringify({ operationIndex, skip }),
    }),
};
