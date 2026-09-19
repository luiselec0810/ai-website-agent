'use client';

import { useEffect, useState } from 'react';
import { Check, X, ChevronDown, ChevronRight, Undo, SkipForward, Play, Loader2 } from 'lucide-react';
import clsx from 'clsx';
import type { ChangePlan } from '@/lib/types';

interface OperationExecState {
  status: 'pending' | 'running' | 'success' | 'failed' | 'skipped';
  error?: string;
}

export interface ExecutionResult {
  tool: string;
  status: string;
  retries: number;
  error?: { code: string; message: string };
}

export function ChangePlanView({
  plan,
  changeId,
  status,
  onApprove,
  onReject,
  onRollback,
  onExecuteOperation,
  isApproving = false,
  executionResults,
}: {
  plan: ChangePlan;
  changeId: string;
  status: 'awaiting_approval' | 'approved' | 'executing' | 'completed' | 'failed' | 'rolled_back';
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onRollback?: (id: string) => void;
  onExecuteOperation?: (id: string, index: number, skip?: boolean) => Promise<void>;
  /**
   * Cuando el padre está ejecutando `approve` y la operación es lenta,
   * mostramos spinner en los botones y los deshabilitamos para evitar
   * doble-click que generaría operaciones duplicadas.
   */
  isApproving?: boolean;
  /**
   * Resultados devueltos por el backend en `/api/changes/:id/approve`
   * (un `ExecutionResult` por operación, en el mismo orden que `plan.operations`).
   * Cuando esta prop cambia y difiere del state interno, sincronizamos los
   * badges de cada operación con su estado real (success/failed/skipped).
   */
  executionResults?: ExecutionResult[];
}) {
  const [expanded, setExpanded] = useState(true);
  const [operationStates, setOperationStates] = useState<Record<number, OperationExecState>>({});
  const [runningOp, setRunningOp] = useState<number | null>(null);

  useEffect(() => {
    if (!executionResults || executionResults.length === 0) return;
    setOperationStates((prev) => {
      const next = { ...prev };
      executionResults.forEach((r, i) => {
        const mapped: OperationExecState = (() => {
          if (r.status === 'success') return { status: 'success' };
          if (r.status === 'failed')
            return { status: 'failed', error: r.error?.message ?? r.error?.code ?? 'failed' };
          if (r.status === 'skipped') return { status: 'skipped' };
          if (r.status === 'running') return { status: 'running' };
          return { status: 'pending' };
        })();
        next[i] = mapped;
      });
      return next;
    });
  }, [executionResults]);

  const statusLabel = {
    awaiting_approval: 'Pendiente de aprobación',
    approved: 'Aprobado',
    executing: 'Ejecutando...',
    completed: '✅ Completado',
    failed: '❌ Falló',
    rolled_back: '↶ Revertido',
  }[status];

  const canAct = status === 'awaiting_approval' && !isApproving;
  const canRollback = status === 'completed' || status === 'failed';

  async function runOp(idx: number, skip: boolean) {
    if (!onExecuteOperation) return;
    setRunningOp(idx);
    setOperationStates((s) => ({ ...s, [idx]: { status: 'running' } }));
    try {
      await onExecuteOperation(changeId, idx, skip);
      setOperationStates((s) => ({
        ...s,
        [idx]: { status: skip ? 'skipped' : 'success' },
      }));
    } catch (err) {
      setOperationStates((s) => ({
        ...s,
        [idx]: { status: 'failed', error: (err as Error).message },
      }));
    } finally {
      setRunningOp(null);
    }
  }

  const totalOps = plan.operations.length;
  const completedOps = executionResults
    ? executionResults.filter((r) => r.status === 'success' || r.status === 'skipped').length
    : Object.values(operationStates).filter((s) => s.status === 'success' || s.status === 'skipped').length;

  return (
    <div className="bg-panel border border-panel-border rounded-card overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-surface transition"
      >
        <div className="flex items-center gap-2">
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span className="font-semibold text-text">📋 {plan.title}</span>
        </div>
        <span className="text-xs text-text-muted flex items-center gap-2">
          {isApproving && <Loader2 size={12} className="animate-spin text-accent" />}
          {isApproving
            ? `Ejecutando ${completedOps}/${totalOps}…`
            : statusLabel}
        </span>
      </button>

      {expanded && (
        <div className="px-4 pb-4">
          {plan.description && (
            <p className="text-sm text-text-muted mb-3">{plan.description}</p>
          )}

          <ol className="space-y-2 mb-4">
            {plan.operations.map((op, i) => {
              const opState = operationStates[i];
              const isThisRunning = isApproving || opState?.status === 'running';
              return (
                <li
                  key={i}
                  className="bg-surface rounded-card p-3 text-sm border border-panel-border"
                >
                  <div className="flex items-start gap-2">
                    <span className="text-accent font-mono text-xs mt-0.5">{i + 1}.</span>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <code className="text-accent">{op.tool}</code>
                        {isThisRunning && !opState && (
                          <span className="text-xs px-2 py-0.5 rounded-pill bg-warning-soft text-warning flex items-center gap-1">
                            <Loader2 size={10} className="animate-spin" />
                            ejecutando…
                          </span>
                        )}
                        {opState && (
                          <span
                            className={clsx(
                              'text-xs px-2 py-0.5 rounded-pill',
                              opState.status === 'success' && 'bg-success-soft text-success',
                              opState.status === 'failed' && 'bg-danger-soft text-danger',
                              opState.status === 'skipped' && 'bg-surface text-text-muted',
                              opState.status === 'running' && 'bg-warning-soft text-warning',
                              opState.status === 'pending' && 'bg-surface text-text-muted'
                            )}
                          >
                            {opState.status === 'running'
                              ? 'ejecutando…'
                              : opState.status === 'success'
                              ? '✓'
                              : opState.status === 'failed'
                              ? '✗'
                              : opState.status === 'skipped'
                              ? 'skipped'
                              : opState.status}
                          </span>
                        )}
                      </div>
                      {Object.keys(op.arguments).length > 0 && (
                        <pre className="mt-1 text-xs text-text-muted overflow-x-auto">
                          {JSON.stringify(op.arguments, null, 2)}
                        </pre>
                      )}
                      {opState?.error && (
                        <p className="text-xs text-danger mt-1">{opState.error}</p>
                      )}

                      {canAct && onExecuteOperation && (
                        <div className="mt-2 flex gap-2">
                          <button
                            onClick={() => runOp(i, false)}
                            disabled={runningOp !== null || isApproving}
                            className="flex items-center gap-1 text-xs bg-success-soft text-success px-2 py-1 rounded-card hover:bg-success/20 disabled:opacity-40"
                          >
                            <Play size={12} />
                            Ejecutar
                          </button>
                          <button
                            onClick={() => runOp(i, true)}
                            disabled={runningOp !== null || isApproving}
                            className="flex items-center gap-1 text-xs bg-surface text-text-muted px-2 py-1 rounded-card hover:bg-panel-border disabled:opacity-40"
                          >
                            <SkipForward size={12} />
                            Saltar
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>

          {canAct && (
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => onApprove(changeId)}
                disabled={isApproving}
                aria-busy={isApproving}
                className="flex-1 bg-success text-white px-4 py-2 rounded-card hover:bg-success/90 transition flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-wait"
                title="Aprobar y ejecutar todas las operaciones en orden"
              >
                {isApproving ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    Ejecutando {completedOps}/{totalOps}…
                  </>
                ) : (
                  <>
                    <Check size={14} /> Aprobar y ejecutar todo
                  </>
                )}
              </button>
              {onExecuteOperation && (
                <button
                  onClick={async () => {
                    for (let i = 0; i < plan.operations.length; i++) {
                      if (operationStates[i]?.status === 'success') continue;
                      await runOp(i, false);
                    }
                  }}
                  disabled={isApproving}
                  className="bg-accent text-white px-4 py-2 rounded-card hover:bg-accent/90 transition flex items-center gap-2 disabled:opacity-60 disabled:cursor-wait"
                  title="Ejecutar todas las operaciones pendientes, una por una (respeta placeholders)"
                >
                  <Play size={14} /> Ejecutar todas
                </button>
              )}
              <button
                onClick={() => onReject(changeId)}
                disabled={isApproving}
                className="bg-danger text-white px-4 py-2 rounded-card hover:bg-danger/90 transition flex items-center gap-2 disabled:opacity-60 disabled:cursor-wait"
              >
                <X size={14} /> Rechazar
              </button>
            </div>
          )}

          {canRollback && onRollback && (
            <button
              onClick={() => onRollback(changeId)}
              className="w-full bg-warning-soft text-warning border border-warning/40 px-4 py-2 rounded-card hover:bg-warning/20 transition flex items-center justify-center gap-2"
            >
              <Undo size={14} /> Revertir este cambio
            </button>
          )}
        </div>
      )}
    </div>
  );
}