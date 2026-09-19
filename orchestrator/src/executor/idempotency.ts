/**
 * Idempotency.
 *
 * Antes de ejecutar una tool, registramos su `operation_id` en la tabla
 * `change_operations`. Si ya existe, abortamos para evitar duplicaciones.
 */

import { nanoid } from 'nanoid';
import { getDb } from '../db/client.js';

export interface OperationRecord {
  id: string;
  changeId: string;
  operationId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  result?: unknown;
  status: 'pending' | 'executing' | 'success' | 'failed' | 'skipped';
  errorCode?: string;
  errorMessage?: string;
  createdAt: string;
  executedAt?: string;
}

/**
 * Genera un operation_id único (o usa uno provisto).
 */
export function generateOperationId(provided?: string): string {
  return provided ?? `op_${nanoid(12)}`;
}

/**
 * Verifica si una operación con este operation_id ya fue ejecutada.
 */
export function isOperationExecuted(operationId: string): boolean {
  const db = getDb();
  const row = db
    .prepare(`SELECT status FROM change_operations WHERE operation_id = ?`)
    .get(operationId) as { status: string } | undefined;

  return row?.status === 'success';
}

/**
 * Registra una operación como pendiente. Devuelve true si es nueva, false si ya existía.
 */
export function registerPendingOperation(
  changeId: string,
  operationId: string,
  toolName: string,
  arguments_: Record<string, unknown>
): boolean {
  const db = getDb();
  try {
    db.prepare(
      `INSERT INTO change_operations (id, change_id, operation_id, tool_name, arguments, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP)`
    ).run(nanoid(), changeId, operationId, toolName, JSON.stringify(arguments_));
    return true;
  } catch (err) {
    // UNIQUE constraint violation = ya existía.
    if ((err as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return false;
    }
    throw err;
  }
}

/**
 * Marca una operación como en ejecución.
 */
export function markExecuting(operationId: string): void {
  const db = getDb();
  db.prepare(
    `UPDATE change_operations SET status = 'executing' WHERE operation_id = ?`
  ).run(operationId);
}

/**
 * Marca una operación como exitosa.
 */
export function markSuccess(operationId: string, result: unknown): void {
  const db = getDb();
  db.prepare(
    `UPDATE change_operations SET status = 'success', result = ?, executed_at = CURRENT_TIMESTAMP WHERE operation_id = ?`
  ).run(JSON.stringify(result), operationId);
}

/**
 * Marca una operación como fallida.
 */
export function markFailed(operationId: string, errorCode: string, errorMessage: string): void {
  const db = getDb();
  db.prepare(
    `UPDATE change_operations SET status = 'failed', error_code = ?, error_message = ?, executed_at = CURRENT_TIMESTAMP WHERE operation_id = ?`
  ).run(errorCode, errorMessage, operationId);
}
