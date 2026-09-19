/**
 * Tests de integración — persistence de conversaciones (SRS §17).
 *
 * Verifica:
 *   1. GET /api/conversations?site_id=X lista conversaciones del sitio,
 *      ordenadas por updated_at DESC, con message_count y preview correctos.
 *   2. GET /api/conversations?site_id=X excluye conversaciones de OTROS sitios.
 *   3. GET /api/conversations/:id/messages devuelve los mensajes en orden
 *      cronológico y asocia los changes (planes) a la conversación.
 *   4. Errores 400/404 cuando faltan parámetros o el id no existe.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';

const tmpDir = mkdtempSync(join(tmpdir(), 'orch-conversations-'));
process.env.DATABASE_PATH = join(tmpDir, 'test.db');
process.env.LLM_PROVIDER = 'minimax';
process.env.LLM_MODEL = 'MiniMax-Text-01';
process.env.MINIMAX_API_KEY = 'test-key';

let _dbOverride: Database.Database | null = null;
vi.mock('../../../src/db/client.js', async () => {
  const real = await vi.importActual<typeof import('../../../src/db/client.js')>('../../../src/db/client.js');
  return {
    ...real,
    getDb: () => {
      if (_dbOverride) return _dbOverride;
      throw new Error('Test DB not initialized');
    },
    closeDb: () => {
      if (_dbOverride) {
        _dbOverride.close();
        _dbOverride = null;
      }
    },
  };
});

const { conversationsRoutes } = await import('../../../src/routes/conversations.routes.js');

function seedSite(id = 'site-1', name = 'Test Site') {
  _dbOverride!
    .prepare(
      `INSERT INTO sites (id, name, url, api_key_encrypted, status)
       VALUES (?, ?, ?, ?, 'active')`
    )
    .run(id, name, `http://${id}.local`, 'test-key');
}

function seedConversation(
  id: string,
  siteId: string,
  opts: { title?: string; createdAt?: string; updatedAt?: string } = {}
) {
  const created = opts.createdAt ?? '2024-01-01T10:00:00.000Z';
  const updated = opts.updatedAt ?? '2024-01-01T10:00:00.000Z';
  _dbOverride!
    .prepare(
      `INSERT INTO conversations (id, site_id, user_id, title, created_at, updated_at)
       VALUES (?, ?, 'default_user', ?, ?, ?)`
    )
    .run(id, siteId, opts.title ?? 'Chat', created, updated);
}

function seedMessage(
  id: string,
  conversationId: string,
  role: 'user' | 'assistant' | 'system',
  content: string,
  createdAt: string
) {
  _dbOverride!
    .prepare(
      `INSERT INTO messages (id, conversation_id, role, content, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(id, conversationId, role, content, createdAt);
}

describe('GET /api/conversations — listar conversaciones del sitio', () => {
  beforeEach(() => {
    const dbPath = join(tmpDir, `list-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.db`);
    _dbOverride = new Database(dbPath);
    _dbOverride.pragma('journal_mode = WAL');
    _dbOverride.pragma('foreign_keys = ON');
    _dbOverride.exec(readFileSync(join(process.cwd(), 'src', 'db', 'schema.sql'), 'utf-8'));
    seedSite('site-1');
    seedSite('site-2', 'Other Site');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (_dbOverride) {
      try {
        _dbOverride.close();
      } catch {
        /* already closed */
      }
      _dbOverride = null;
    }
  });

  it('devuelve 400 si falta site_id', async () => {
    const res = await conversationsRoutes.request('/', { method: 'GET' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('INVALID_REQUEST');
  });

  it('devuelve 404 si el sitio no existe', async () => {
    const res = await conversationsRoutes.request('/?site_id=no-existe', { method: 'GET' });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('lista conversaciones del sitio ordenadas por updated_at DESC con message_count y preview', async () => {
    seedConversation('conv-A', 'site-1', {
      title: 'Primera',
      createdAt: '2024-01-01T10:00:00.000Z',
      updatedAt: '2024-01-03T10:00:00.000Z',
    });
    seedMessage('msg-A1', 'conv-A', 'user', 'Hola mundo', '2024-01-01T10:00:01.000Z');
    seedMessage('msg-A2', 'conv-A', 'assistant', 'Hola!', '2024-01-01T10:00:02.000Z');

    seedConversation('conv-B', 'site-1', {
      title: 'Segunda',
      createdAt: '2024-01-02T10:00:00.000Z',
      updatedAt: '2024-01-05T10:00:00.000Z',
    });
    seedMessage('msg-B1', 'conv-B', 'user', 'Cuál es el hero?', '2024-01-02T10:00:01.000Z');

    const res = await conversationsRoutes.request('/?site_id=site-1', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(2);

    // Orden: conv-B (updated_at 2024-01-05) antes que conv-A (2024-01-03).
    expect(body.data[0].id).toBe('conv-B');
    expect(body.data[0].message_count).toBe(1);
    expect(body.data[0].preview).toBe('Cuál es el hero?');

    expect(body.data[1].id).toBe('conv-A');
    expect(body.data[1].message_count).toBe(2);
    expect(body.data[1].preview).toBe('Hola mundo');
  });

  it('excluye conversaciones de otros sitios', async () => {
    seedConversation('conv-X', 'site-1', { title: 'Mía', updatedAt: '2024-02-01T10:00:00.000Z' });
    seedMessage('msg-X1', 'conv-X', 'user', 'pregunta A', '2024-02-01T10:00:01.000Z');

    seedConversation('conv-Y', 'site-2', { title: 'Otra', updatedAt: '2024-02-02T10:00:00.000Z' });
    seedMessage('msg-Y1', 'conv-Y', 'user', 'pregunta B', '2024-02-02T10:00:01.000Z');

    const res = await conversationsRoutes.request('/?site_id=site-1', { method: 'GET' });
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe('conv-X');
    expect(body.data[0].site_id).toBe('site-1');
  });

  it('respeta el límite (limit query param)', async () => {
    for (let i = 0; i < 5; i++) {
      const id = `conv-${i}`;
      seedConversation(id, 'site-1', {
        updatedAt: `2024-01-0${i + 1}T10:00:00.000Z`,
      });
    }
    const res = await conversationsRoutes.request('/?site_id=site-1&limit=2', { method: 'GET' });
    const body = await res.json();
    expect(body.data).toHaveLength(2);
  });

  it('cappea limit a 200 como máximo', async () => {
    // Insertar 250 conversaciones dummy.
    const stmt = _dbOverride!.prepare(
      `INSERT INTO conversations (id, site_id, user_id, title, created_at, updated_at) VALUES (?, ?, 'u', 't', ?, ?)`
    );
    const tx = _dbOverride!.transaction(() => {
      for (let i = 0; i < 250; i++) {
        stmt.run(`c-${i}`, 'site-1', '2024-01-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z');
      }
    });
    tx();

    const res = await conversationsRoutes.request('/?site_id=site-1&limit=9999', { method: 'GET' });
    const body = await res.json();
    expect(body.data.length).toBe(200);
  });
});

describe('GET /api/conversations/:id/messages — historial completo', () => {
  beforeEach(() => {
    const dbPath = join(tmpDir, `msgs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.db`);
    _dbOverride = new Database(dbPath);
    _dbOverride.pragma('journal_mode = WAL');
    _dbOverride.pragma('foreign_keys = ON');
    _dbOverride.exec(readFileSync(join(process.cwd(), 'src', 'db', 'schema.sql'), 'utf-8'));
    seedSite('site-1');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (_dbOverride) {
      try {
        _dbOverride.close();
      } catch {
        /* already closed */
      }
      _dbOverride = null;
    }
  });

  it('devuelve 404 si la conversación no existe', async () => {
    const res = await conversationsRoutes.request('/no-existe/messages', { method: 'GET' });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('devuelve los mensajes en orden cronológico con metadatos de la conversación', async () => {
    seedConversation('conv-1', 'site-1', { title: 'Test conv' });
    seedMessage('m1', 'conv-1', 'user', 'Pregunta 1', '2024-01-01T10:00:01.000Z');
    seedMessage('m2', 'conv-1', 'assistant', 'Respuesta 1', '2024-01-01T10:00:02.000Z');
    seedMessage('m3', 'conv-1', 'user', 'Pregunta 2', '2024-01-01T10:00:03.000Z');
    seedMessage('m4', 'conv-1', 'assistant', 'Respuesta 2', '2024-01-01T10:00:04.000Z');

    const res = await conversationsRoutes.request('/conv-1/messages', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.data.conversation.id).toBe('conv-1');
    expect(body.data.conversation.site_id).toBe('site-1');
    expect(body.data.conversation.title).toBe('Test conv');

    expect(body.data.messages).toHaveLength(4);
    expect(body.data.messages.map((m: { content: string }) => m.content)).toEqual([
      'Pregunta 1',
      'Respuesta 1',
      'Pregunta 2',
      'Respuesta 2',
    ]);
    expect(body.data.messages.map((m: { role: string }) => m.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
    ]);
    // Sin changes asociados, el array viene vacío.
    expect(body.data.changes).toEqual([]);
  });

  it('incluye los changes (planes) asociados a la conversación', async () => {
    seedConversation('conv-plan', 'site-1');
    seedMessage('m1', 'conv-plan', 'user', 'Crea una página', '2024-01-01T10:00:01.000Z');
    seedMessage('m2', 'conv-plan', 'assistant', 'Aquí tienes el plan', '2024-01-01T10:00:03.000Z');

    _dbOverride!
      .prepare(
        `INSERT INTO changes (id, site_id, conversation_id, title, description, operations, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        'ch-001',
        'site-1',
        'conv-plan',
        'Crear página X',
        'Plan detallado',
        JSON.stringify([
          { tool: 'create_page', arguments: { title: 'X' } },
        ]),
        'awaiting_approval',
        '2024-01-01T10:00:02.000Z'
      );

    const res = await conversationsRoutes.request('/conv-plan/messages', { method: 'GET' });
    const body = await res.json();
    expect(body.data.messages).toHaveLength(2);
    expect(body.data.changes).toHaveLength(1);
    expect(body.data.changes[0].id).toBe('ch-001');
    expect(body.data.changes[0].status).toBe('awaiting_approval');
    expect(body.data.changes[0].title).toBe('Crear página X');
    // operations viene como JSON string — el frontend lo parsea.
    expect(typeof body.data.changes[0].operations).toBe('string');
    expect(JSON.parse(body.data.changes[0].operations)).toHaveLength(1);
  });

  it('sólo devuelve los changes de ESA conversación, no los de otras', async () => {
    seedConversation('conv-A', 'site-1');
    seedConversation('conv-B', 'site-1');
    seedMessage('mA', 'conv-A', 'user', 'a', '2024-01-01T10:00:01.000Z');
    seedMessage('mB', 'conv-B', 'user', 'b', '2024-01-02T10:00:01.000Z');

    _dbOverride!
      .prepare(
        `INSERT INTO changes (id, site_id, conversation_id, title, description, operations, status, created_at)
         VALUES (?, 'site-1', ?, 't', '', '[]', 'completed', ?)`
      )
      .run('ch-A', 'conv-A', '2024-01-01T10:00:02.000Z');

    _dbOverride!
      .prepare(
        `INSERT INTO changes (id, site_id, conversation_id, title, description, operations, status, created_at)
         VALUES (?, 'site-1', ?, 't', '', '[]', 'completed', ?)`
      )
      .run('ch-B', 'conv-B', '2024-01-02T10:00:02.000Z');

    const resA = await conversationsRoutes.request('/conv-A/messages', { method: 'GET' });
    const bodyA = await resA.json();
    expect(bodyA.data.changes.map((c: { id: string }) => c.id)).toEqual(['ch-A']);

    const resB = await conversationsRoutes.request('/conv-B/messages', { method: 'GET' });
    const bodyB = await resB.json();
    expect(bodyB.data.changes.map((c: { id: string }) => c.id)).toEqual(['ch-B']);
  });

  it('devuelve array vacío de mensajes cuando la conversación existe pero no tiene mensajes', async () => {
    seedConversation('conv-empty', 'site-1');
    const res = await conversationsRoutes.request('/conv-empty/messages', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.messages).toEqual([]);
    expect(body.data.changes).toEqual([]);
    expect(body.data.conversation.id).toBe('conv-empty');
  });
});
