/**
 * Tool Executor.
 *
 * Ejecuta una herramienta con:
 *   - ApprovalGate: bloquea tools de escritura si el change no está approved
 *   - Idempotency: registra operation_id antes de ejecutar; aborta si ya existe
 *   - Reintentos: hasta 3 veces si la tool falla (solo para tools de lectura)
 *   - Auditoría: registra éxito/fallo en change_operations
 */

import { nanoid } from 'nanoid';
import { ApprovalGate } from './approval-gate.js';
import {
  generateOperationId,
  isOperationExecuted,
  markExecuting,
  markFailed,
  markSuccess,
  registerPendingOperation,
} from './idempotency.js';
import { getTool } from '../tools/index.js';
import type { WpSite } from './wp-client.js';
import { WpError } from './wp-client.js';
import { logger } from '../logger.js';

export interface ExecutionResult {
  tool: string;
  status: 'success' | 'failed' | 'skipped';
  result?: unknown;
  error?: { code: string; message: string };
  retries: number;
}

export async function executeTool(
  site: WpSite,
  changeId: string,
  changeStatus: string,
  toolName: string,
  arguments_: Record<string, unknown>,
  options: { maxRetries?: number; operationId?: string } = {}
): Promise<ExecutionResult> {
  const maxRetries = options.maxRetries ?? 3;
  const operationId = generateOperationId(
    options.operationId ?? (arguments_.change_id as string | undefined)
  );

  // 1. Approval gate
  const gate = new ApprovalGate(changeStatus);
  gate.requireApproval(toolName);

  // 2. Idempotency check
  if (isOperationExecuted(operationId)) {
    logger.info({ operationId, tool: toolName }, 'Operation already executed, skipping');
    return { tool: toolName, status: 'skipped', retries: 0 };
  }

  // 3. Registrar como pending
  registerPendingOperation(changeId, operationId, toolName, arguments_);

  // 4. Buscar la tool
  const tool = getTool(toolName);
  if (!tool) {
    markFailed(operationId, 'UNKNOWN_TOOL', `Unknown tool: ${toolName}`);
    return {
      tool: toolName,
      status: 'failed',
      error: { code: 'UNKNOWN_TOOL', message: `Unknown tool: ${toolName}` },
      retries: 0,
    };
  }

  // 5. Ejecutar con reintentos (solo para tools de lectura).
  const isReadOnly = gate.isReadOnlyTool(toolName);
  const retries = isReadOnly ? maxRetries : 1;
  let lastError: WpError | Error | null = null;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      markExecuting(operationId);
      const result = await tool.execute(site, arguments_, changeId);
      markSuccess(operationId, result);
      logger.info({ tool: toolName, operationId, attempt }, 'Tool executed successfully');
      return { tool: toolName, status: 'success', result, retries: attempt - 1 };
    } catch (err) {
      lastError = err as Error;
      logger.warn({ tool: toolName, attempt, error: lastError.message }, 'Tool execution failed');
      if (attempt === retries) {
        markFailed(operationId, 'TOOL_ERROR', lastError.message);
        break;
      }
      // Esperar antes de reintentar (exponential backoff ligero).
      await new Promise((resolve) => setTimeout(resolve, 200 * attempt));
    }
  }

  return {
    tool: toolName,
    status: 'failed',
    error: {
      code: lastError instanceof WpError ? lastError.code : 'TOOL_ERROR',
      message: lastError?.message ?? 'Unknown error',
    },
    retries: retries - 1,
  };
}

/**
 * Ejecuta múltiples tools en secuencia.
 * Si una falla, no aborta (devuelve el resultado) para que el LLM pueda adaptarse.
 */
export async function executeTools(
  site: WpSite,
  changeId: string,
  changeStatus: string,
  tools: Array<{ name: string; arguments: Record<string, unknown> }>
): Promise<ExecutionResult[]> {
  const results: ExecutionResult[] = [];
  for (const t of tools) {
    const result = await executeTool(site, changeId, changeStatus, t.name, t.arguments);
    results.push(result);
  }
  return results;
}

// Helper export
export { ApprovalGate };
export { nanoid };
