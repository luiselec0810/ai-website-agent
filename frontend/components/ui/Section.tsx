'use client';

import type { ReactNode } from 'react';
import clsx from 'clsx';

/**
 * Section — bloque de navegación en el sidebar (PINNED, CHATS, etc).
 *
 * Estilo:
 * - Título uppercase, tracking-wide, color faint.
 * - `mb-2 px-2` (separación consistente).
 *
 * Envuelve children en una lista vertical con spacing compacto.
 */
export interface SectionProps {
  title: string;
  children: ReactNode;
  className?: string;
  /** Si true, no muestra el título. Útil para secciones sin heading. */
  hideTitle?: boolean;
  /** Si true, agrega padding horizontal al contenido. */
  padded?: boolean;
}

export function Section({
  title,
  children,
  className,
  hideTitle = false,
  padded = false,
}: SectionProps) {
  return (
    <div className={clsx('flex flex-col gap-1', className)}>
      {!hideTitle && (
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-text-faint px-2 mb-1">
          {title}
        </h3>
      )}
      <div className={clsx('flex flex-col gap-0.5', padded && 'px-2')}>{children}</div>
    </div>
  );
}