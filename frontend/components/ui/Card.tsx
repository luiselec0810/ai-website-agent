'use client';

import type { HTMLAttributes, ReactNode } from 'react';
import clsx from 'clsx';

/**
 * Card — wrapper "panel" del design system.
 *
 * - `bg-panel` (white) sobre `bg-surface` (off-white) del root.
 * - `border border-panel-border` (zinc-200).
 * - `rounded-card` (14px).
 * - `shadow-card` (casi flat, 1px).
 *
 * Variantes:
 * - `default` — el panel básico.
 * - `popover` — sombras más profundas (para dropdowns / drawers).
 * - `ghost` — sin borde, sin sombra (dentro de otros panels).
 */
export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'popover' | 'ghost';
  padding?: 'none' | 'sm' | 'md' | 'lg';
  children?: ReactNode;
}

const paddingMap = {
  none: '',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-6',
};

export function Card({
  variant = 'default',
  padding = 'none',
  className,
  children,
  ...rest
}: CardProps) {
  return (
    <div
      className={clsx(
        'bg-panel rounded-card',
        variant === 'default' && 'border border-panel-border shadow-card',
        variant === 'popover' && 'border border-panel-border shadow-popover',
        variant === 'ghost' && '',
        paddingMap[padding],
        className
      )}
      {...rest}
    >
      {children}
    </div>
  );
}