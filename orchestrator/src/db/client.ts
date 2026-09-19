/**
 * DB Client — singleton de better-sqlite3.
 *
 * Carga el schema.sql al inicializar y expone helpers para queries tipadas.
 */

import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { logger } from '../logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  logger.info({ path: config.DATABASE_PATH }, 'Opening SQLite database');

  _db = new Database(config.DATABASE_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');

  // Cargar y aplicar schema.
  const schemaPath = join(__dirname, 'schema.sql');
  const schema = readFileSync(schemaPath, 'utf-8');
  _db.exec(schema);

  // Crear fila dummy "system" en `sites` y `changes` para herramientas de solo lectura
  // que no requieren una acción explícita del usuario.
  const systemSiteId = '__system__';
  _db.prepare(
    `INSERT OR IGNORE INTO sites (id, name, url, api_key_encrypted, status, created_at, updated_at)
     VALUES (?, 'System', 'about:blank', '', 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
  ).run(systemSiteId);

  const systemChangeId = '__system_read__';
  _db.prepare(
    `INSERT OR IGNORE INTO changes (id, site_id, title, description, operations, status, created_at)
     VALUES (?, ?, 'System read-only operations', '', '[]', 'completed', CURRENT_TIMESTAMP)`
  ).run(systemChangeId, systemSiteId);

  logger.info('Database schema applied');
  return _db;
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
