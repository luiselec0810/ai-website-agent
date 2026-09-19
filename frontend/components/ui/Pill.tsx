'use client';

import type { HTMLAttributes, ReactNode } from 'react';
import clsx from 'clsx';

/**
 * Pill — badge pequeño tipo "chip" con forma redondeada completa.
 *
 * Variantes de color:
 * - `accent` — `bg-accent-soft text-accent` (default).
 * - `neutral` — `bg-surface text-text-muted border border-panel-border`.
 * - `success` — `bg-success-soft text-success`.
 * - `warning` — `bg-warning-soft text-warning`.
 * - `danger` — `bg-danger-soft text-danger`.
 * - `outline` — borde accent, fondo transparente.
 *
 * Usado en: badges de status, contadores en nav, chips de modelo activo, etc.
 */
export interface PillProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: 'accent' | 'neutral' | 'success' | 'warning' | 'danger' | 'outline';
  size?: 'xs' | 'sm';
  children?: ReactNode;
}

const variantClass = {
  accent: 'bg-accent-soft text-accent border border-transparent',
  neutral: 'bg-surface text-text-muted border border-panel-border',
  success: 'bg-success-soft text-success border border-transparent',
  warning: 'bg-warning-soft text-warning border border-transparent',
  danger: 'bg-danger-soft text-danger border border-transparent',
  outline: 'bg-transparent text-accent border border-accent/40',
};

const sizeClass = {
  xs: 'px-1.5 py-0 text-[10px]',
  sm: 'px-2 py-0.5 text-xs',
};

export function Pill({
  variant = 'accent',
  size = 'sm',
  className,
  children,
  ...rest
}: PillProps) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-pill font-medium whitespace-nowrap',
        variantClass[variant],
        sizeClass[size],
        className
      )}
      {...rest}
    >
      {children}
    </span>
  );
}