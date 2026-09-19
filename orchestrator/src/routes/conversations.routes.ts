/**
 * Conversations Routes.
 *
 *   GET  /api/conversations?site_id=X[&limit=N]   Listar conversaciones del sitio (más recientes primero)
 *   GET  /api/conversations/:id/messages          Obtener historial completo de mensajes (cronológico)
 *
 * Persistencia de chats (SRS §17): los mensajes ya se guardan en la tabla `messages`
 * cada vez que el usuario envía algo o el asistente responde (ver chat.routes.ts).
 * Estos endpoints exponen ese historial para que el frontend pueda restaurar
 * conversaciones al recargar la página o al re-entrar a un sitio.
 */

import { Hono } from 'hono';
import { getDb } from '../db/client.js';

export const conversationsRoutes = new Hono();

interface ConversationRow {
  id: string;
  site_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  message_count: number;
  preview: string | null;
}

interface MessageRow {
  id: string;
  role: string;
  content: string;
  tool_calls: string | null;
  tool_results: string | null;
  created_at: string;
}

interface ChangeRow {
  id: string;
  title: string;
  description: string | null;
  operations: string;
  status: string;
  created_at: string;
}

// ─────────────────────────────────────────────────────────────────
// GET /api/conversations?site_id=X[&limit=N]
// Lista las conversaciones de un sitio, ordenadas por updated_at DESC.
// Incluye message_count y un preview (texto del primer mensaje del user).
// ─────────────────────────────────────────────────────────────────
conversationsRoutes.get('/', (c) => {
  const siteId = c.req.query('site_id');
  if (!siteId) {
    return c.json(
      { success: false, error: { code: 'INVALID_REQUEST', message: 'site_id query param required' } },
      400
    );
  }

  const limitRaw = c.req.query('limit');
  const limit = Math.min(Math.max(parseInt(limitRaw ?? '50', 10) || 50, 1), 200);

  const db = getDb();
  // Verificar que el sitio existe — devuelve 404 si no.
  const siteRow = db.prepare(`SELECT id FROM sites WHERE id = ?`).get(siteId);
  if (!siteRow) {
    return c.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'Site not found' } },
      404
    );
  }

  const rows = db
    .prepare(
      `SELECT
         c.id            AS id,
         c.site_id       AS site_id,
         c.title         AS title,
         c.created_at    AS created_at,
         c.updated_at    AS updated_at,
         (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count,
         (
           SELECT m.content FROM messages m
           WHERE m.conversation_id = c.id AND m.role = 'user'
           ORDER BY m.created_at ASC LIMIT 1
         ) AS preview
       FROM conversations c
       WHERE c.site_id = ?
       ORDER BY c.updated_at DESC
       LIMIT ?`
    )
    .all(siteId, limit) as ConversationRow[];

  return c.json({ success: true, data: rows });
});

// ─────────────────────────────────────────────────────────────────
// GET /api/conversations/:id/messages
// Devuelve el historial completo de una conversación en orden cronológico,
// junto con los changes (planes) asociados para que el frontend pueda
// reconstruir la UI sin llamadas adicionales.
// Devuelve 404 si la conversación no existe.
// ─────────────────────────────────────────────────────────────────
conversationsRoutes.get('/:id/messages', (c) => {
  const id = c.req.param('id');
  const db = getDb();

  const convRow = db
    .prepare(`SELECT id, site_id, title, created_at, updated_at FROM conversations WHERE id = ?`)
    .get(id) as
    | { id: string; site_id: string; title: string; created_at: string; updated_at: string }
    | undefined;

  if (!convRow) {
    return c.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'Conversation not found' } },
      404
    );
  }

  const messages = db
    .prepare(
      `SELECT id, role, content, tool_calls, tool_results, created_at
       FROM messages
       WHERE conversation_id = ?
       ORDER BY created_at ASC`
    )
    .all(id) as MessageRow[];

  // Traemos los changes asociados a esta conversación para que el frontend
  // pueda reconstruir el plan en cada mensaje del assistant que generó un Change Plan.
  // (chat.routes.ts guarda `conversation_id` en la tabla `changes` cuando un plan se crea.)
  const changes = db
    .prepare(
      `SELECT id, title, description, operations, status, created_at
       FROM changes
       WHERE conversation_id = ?
       ORDER BY created_at ASC`
    )
    .all(id) as ChangeRow[];

  return c.json({
    success: true,
    data: {
      conversation: convRow,
      messages,
      changes,
    },
  });
});

