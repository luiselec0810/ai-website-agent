'use client';

import type { ReactNode } from 'react';
import clsx from 'clsx';

/**
 * AppShell — layout base de 3 columnas estilo Ciphy.
 *
 * Estructura del grid (definida vía `grid-cols-*`):
 *   - `mobile`    → 1 col (sidebar como drawer fuera del shell).
 *   - `lg+`       → 3 cols (260px sidebar + flex main + 330px right panel).
 *   - cuando no hay rightPanel → 2 cols (260px sidebar + flex main).
 *
 * El sidebar NO se monta dentro del shell en mobile/tablet: vive fuera como
 * drawer controlado por el padre (`AppSidebar` recibe `open` / `onClose` y
 * se renderiza como overlay). En lg+ el sidebar SÍ va dentro del shell.
 *
 * Props:
 *   - `sidebar`     — elementos del sidebar (visible lg+).
 *   - `main`        — columna central (siempre).
 *   - `rightPanel`  — columna derecha (opcional, solo lg+).
 *
 * Tip: si necesitás que el sidebar sea un drawer en mobile pero columna en
 * desktop, montá el `<AppSidebar>` DENTRO de este shell (slot `sidebar`) Y
 * adicionalmente como overlay fuera del shell. AppSidebar ya soporta ambos
 * modos vía `mode` prop.
 */
export interface AppShellProps {
  sidebar?: ReactNode;
  main: ReactNode;
  rightPanel?: ReactNode;
  className?: string;
}

export function AppShell({ sidebar, main, rightPanel, className }: AppShellProps) {
  const hasRight = Boolean(rightPanel);
  return (
    <div
      className={clsx(
        'min-h-screen bg-surface text-text',
        'grid',
        // Mobile: 1 columna. Sidebar vive como drawer fuera del shell.
        'grid-cols-1',
        // lg+ (>=1024px): cuando hay rightPanel → 3 cols (260 1fr 330).
        hasRight && 'lg:grid-cols-[260px_1fr_330px]',
        // lg+ (>=1024px): cuando NO hay rightPanel → 2 cols (260 1fr).
        !hasRight && sidebar && 'lg:grid-cols-[260px_1fr]',
        // Sidebar oculto en mobile/tablet cuando es slot del shell.
        sidebar && 'lg:[&>aside]:block',
        className
      )}
    >
      {sidebar}
      <main className="min-w-0 min-h-screen flex flex-col">{main}</main>
      {rightPanel}
    </div>
  );
}