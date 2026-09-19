'use client';

import clsx from 'clsx';
import type { Change } from '@/lib/types';

/**
 * AuditLog — lista de cambios pendientes / recientes.
 *
 * `compact`: si true, omite el wrapping extra (útil cuando ya está dentro de un
 * `<Section>` con título). Default `false`.
 */
export function AuditLog({
  changes,
  compact = false,
}: {
  changes: Change[];
  compact?: boolean;
}) {
  if (changes.length === 0) {
    return (
      <p className={clsx('text-xs text-text-faint', !compact && 'p-2')}>
        Sin cambios pendientes.
      </p>
    );
  }

  return (
    <ul className="space-y-1">
      {changes.map((c) => (
        <li
          key={c.id}
          className={clsx(
            'text-xs bg-surface rounded-card p-2 border border-transparent',
            'hover:border-accent/40 transition'
          )}
        >
          <div className="font-semibold truncate text-text">{c.title}</div>
          <div className="text-text-muted mt-1 flex items-center justify-between">
            <span>{c.status}</span>
            <span>{new Date(c.created_at).toLocaleTimeString()}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}