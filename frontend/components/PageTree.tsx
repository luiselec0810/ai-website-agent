'use client';

import { useEffect, useState } from 'react';
import { FileText } from 'lucide-react';
import clsx from 'clsx';
import { pagesApi } from '@/lib/api';
import type { Page } from '@/lib/types';

/**
 * PageTree — lista de páginas del sitio (proxy del plugin WP).
 *
 * `compact`: si es true, omite el `<h3>` (ya está envuelto en un `<Section>`
 * del sidebar con su propio título). Default `false` para mantener retro-compat.
 */
export function PageTree({
  siteId,
  compact = false,
}: {
  siteId: string;
  compact?: boolean;
}) {
  const [pages, setPages] = useState<Page[]>([]);
  const [loading, setLoading] = useState(true);

  // G11 fix: carga las páginas reales del sitio vía /api/sites/:id/pages
  // (passthrough del orchestrator al plugin WP).
  useEffect(() => {
    let cancelled = false;
    pagesApi
      .list(siteId)
      .then((res) => {
        if (!cancelled) setPages(res.items);
      })
      .catch((err) => {
        console.error('PageTree load failed:', err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [siteId]);

  return (
    <div>
      {!compact && (
        <h3 className="text-sm font-semibold text-text-muted mb-2">Páginas</h3>
      )}
      {loading ? (
        <p className="text-xs text-text-faint px-2 py-1">Cargando...</p>
      ) : pages.length === 0 ? (
        <p className="text-xs text-text-faint px-2 py-1">
          No hay páginas publicadas.
        </p>
      ) : (
        <ul className="space-y-0.5">
          {pages.map((p) => (
            <li
              key={p.id}
              className={clsx(
                'flex items-center gap-2 px-2 py-1.5 rounded-card text-sm',
                'text-text-muted hover:bg-surface hover:text-text transition'
              )}
            >
              <FileText size={12} className="text-text-faint flex-shrink-0" />
              <span className="flex-1 truncate">{p.title}</span>
              <span className="text-[10px] text-text-faint">{p.status}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}