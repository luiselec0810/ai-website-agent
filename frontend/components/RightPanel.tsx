'use client';

import { useEffect, useState } from 'react';
import { Sparkles, Check } from 'lucide-react';
import clsx from 'clsx';
import { Card } from './ui/Card';
import { Avatar } from './ui/Avatar';
import { Pill } from './ui/Pill';
import type { Change } from '@/lib/types';

/**
 * RightPanel — panel derecho del layout 3-col del /sites/[id].
 *
 * Estructura actual (refinada):
 *   - Card principal del modelo (header prominente + stats grid + pills + accordion).
 *   - Sub-secciones que aportan valor:
 *       * "Successfully generated responses" como pills verdes con ✓.
 *       * "Token usage & operations" como accordion colapsable con bullets numerados.
 *   - Link "Fact check history" al pie (alineado a la derecha).
 *
 * Si hay un cambio activo en aprobación, también muestra una
 * `ApprovalStatusCard` con sus ops + badges.
 *
 * Nota: la antigua sección "Searched for" (placeholder "Aún no se consultaron
 * sitios externos") se eliminó por no aportar valor real. Lo que de verdad
 * cuenta el flujo de trabajo aparece en los pills de "successfully generated".
 */

export interface RightPanelProps {
  /** Nombre del modelo activo (env: NEXT_PUBLIC_LLM_MODEL). */
  modelName: string;
  /** Descripción del modelo (1-2 sentences). */
  modelDescription?: string;
  /** Context window del modelo. Ya formateado, ej: "128,000 tokens" o "2M tokens". */
  contextWindowLabel?: string;
  /** Training data, ej: "Up to Apr 2023". */
  trainingDataLabel?: string;
  /** Cambios recientes / facts verificados. Default: 3 pills de demo. */
  successfulResponses?: string[];
  /** Cambio activo en aprobación. Si está, se muestra la ApprovalStatusCard. */
  activeChange?: Change | null;
  /** Resultado por ejecución del change (mismo shape que el backend). */
  activeChangeResults?: Array<{
    tool: string;
    status: string;
    retries: number;
    error?: { message: string };
  }>;
}

const DEFAULT_SUCCESSFUL_RESPONSES = [
  'Sitio listado con inventario completo',
  'Plantillas de Elementor recuperadas (6)',
  'Cambio aplicado: hero CTA actualizado',
];

export function RightPanel({
  modelName,
  modelDescription = 'Modelo de IA que controla tu sitio WordPress + Elementor. Lee el inventario, resuelve placeholders, y aplica operaciones de manera idempotente. Smart-fallback corrige placeholders que apuntan a containers.',
  contextWindowLabel = '128,000 tokens',
  trainingDataLabel,
  successfulResponses = DEFAULT_SUCCESSFUL_RESPONSES,
  activeChange = null,
  activeChangeResults = [],
}: RightPanelProps) {
  // Training data default = mes/año actual en inglés (ej: "Up to Sep 2026").
  const trainingLabel =
    trainingDataLabel ??
    `Up to ${new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`;

  return (
    <aside
      className="hidden lg:flex flex-col bg-surface border-l border-panel-border w-[330px] h-screen sticky top-0 overflow-y-auto p-4 gap-4"
      aria-label="Información del modelo y estado"
    >
      {/* Card principal del modelo — header prominente + stats + pills + accordion */}
      <Card variant="popover" className="p-5">
        {/* Header: avatar xl a la izquierda, título + descripción a la derecha */}
        <div className="flex items-start gap-4">
          <Avatar variant="model" size="2xl" ariaLabel={modelName}>
            <Sparkles size={36} />
          </Avatar>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold text-text leading-tight">
              {modelName}
            </h2>
            <p className="mt-1 text-xs text-text-muted leading-relaxed">
              {modelDescription}
            </p>
          </div>
        </div>

        {/* Stats grid — cada stat es una mini-card */}
        <div className="mt-5 grid grid-cols-2 gap-2">
          <StatCard label="Context window" value={contextWindowLabel} />
          <StatCard label="Training data" value={trainingLabel} />
        </div>

        {/* Pills de "successfully generated" */}
        <div className="mt-4 flex flex-wrap gap-1.5">
          {successfulResponses.map((r, i) => (
            <Pill key={i} variant="success" size="sm">
              <Check size={10} aria-hidden="true" />
              <span>{r}</span>
            </Pill>
          ))}
        </div>

        {/* Link "Fact check history" — alineado a la derecha */}
        <a
          href="#"
          onClick={(e) => e.preventDefault()}
          className="mt-3 block text-right text-xs text-text-muted hover:text-accent transition"
        >
          Fact check history →
        </a>
      </Card>

      {/* Approval status (si hay cambio activo) */}
      {activeChange && (
        <ApprovalStatusCard change={activeChange} results={activeChangeResults} />
      )}
    </aside>
  );
}

/**
 * StatCard — mini-card interna con label uppercase + valor destacado.
 * Específica del RightPanel, no se exporta a `ui/`.
 */
function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-panel-border rounded-card bg-surface p-3 text-center">
      <div className="text-xs font-semibold uppercase tracking-wide text-text-faint">
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold text-text leading-tight">
        {value}
      </div>
    </div>
  );
}

function ApprovalStatusCard({
  change,
  results,
}: {
  change: Change;
  results: Array<{ tool: string; status: string; retries: number; error?: { message: string } }>;
}) {
  const ops = change.operations ?? [];
  return (
    <Card padding="md">
      <div className="flex items-center justify-between gap-2 mb-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-faint">
          Aprobación en curso
        </h3>
        <Pill size="xs" variant="accent">
          {change.status}
        </Pill>
      </div>
      <div className="text-sm font-medium text-text truncate">{change.title}</div>
      {change.description && (
        <p className="mt-1 text-xs text-text-muted line-clamp-2">
          {change.description}
        </p>
      )}

      {ops.length > 0 && (
        <ol className="mt-3 space-y-1.5">
          {ops.map((op, i) => {
            const r = results[i];
            const status = r?.status ?? 'pending';
            return (
              <li
                key={op.id ?? i}
                className="flex items-start gap-2 text-xs text-text leading-snug"
              >
                <span
                  className={clsx(
                    'flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-semibold flex-shrink-0',
                    status === 'success' && 'bg-success-soft text-success',
                    status === 'failed' && 'bg-danger-soft text-danger',
                    status === 'skipped' && 'bg-warning-soft text-warning',
                    (status === 'pending' || status === 'running') &&
                      'bg-surface text-text-faint'
                  )}
                >
                  {status === 'success' ? (
                    <Check size={10} />
                  ) : status === 'failed' ? (
                    '✗'
                  ) : status === 'skipped' ? (
                    '⊘'
                  ) : (
                    i + 1
                  )}
                </span>
                <div className="flex-1 min-w-0">
                  <code className="text-accent font-mono text-[11px]">
                    {op.tool_name}
                  </code>
                  {r?.error?.message && status === 'failed' && (
                    <p className="mt-0.5 text-[10px] text-danger truncate">
                      {r.error.message}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}

/**
 * Hook de conveniencia para leer el nombre del modelo desde
 * `process.env.NEXT_PUBLIC_LLM_MODEL` (con fallback al default Gemini).
 */
export function useModelNameFromEnv(): string {
  const [name, setName] = useState('AI Website Agent');
  useEffect(() => {
    const fromEnv =
      process.env.NEXT_PUBLIC_LLM_MODEL ?? process.env.NEXT_PUBLIC_DEFAULT_MODEL;
    if (fromEnv) setName(fromEnv);
  }, []);
  return name;
}
