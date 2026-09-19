'use client';

import type { ReactNode } from 'react';
import clsx from 'clsx';

/**
 * Avatar — círculo para usuarios / assistants / modelos.
 *
 * Variantes:
 * - `user` — fondo `bg-accent/15` con texto morado, muestra la inicial.
 * - `assistant` — gradiente `from-purple-500 to-blue-500` (Sparkles icon).
 * - `model` — gradiente `from-accent to-accent/70` (panel derecho).
 * - `neutral` — fondo gris con texto muted.
 *
 * Tamaños: `xs`, `sm`, `md`, `lg`, `xl`, `2xl`.
 *
 * `2xl` es un tamaño extra (96px / w-24 h-24) pensado para el header
 * prominente del modelo activo en el RightPanel.
 */
export interface AvatarProps {
  variant?: 'user' | 'assistant' | 'model' | 'neutral';
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  initials?: string;
  /** Contenido custom (típicamente un <Sparkles /> o similar). Sobrescribe `initials`. */
  children?: ReactNode;
  className?: string;
  ariaLabel?: string;
}

const variantClass = {
  user: 'bg-accent/15 text-accent',
  assistant: 'bg-gradient-to-br from-purple-500 to-blue-500 text-white',
  model: 'bg-gradient-to-br from-accent to-accent/70 text-white',
  neutral: 'bg-surface text-text-muted border border-panel-border',
};

const sizeClass = {
  xs: 'h-6 w-6 text-[10px]',
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-12 w-12 text-base',
  xl: 'h-16 w-16 text-lg',
  '2xl': 'h-24 w-24 text-2xl',
};

export function Avatar({
  variant = 'neutral',
  size = 'md',
  initials,
  children,
  className,
  ariaLabel,
}: AvatarProps) {
  return (
    <div
      role="img"
      aria-label={ariaLabel}
      className={clsx(
        'inline-flex items-center justify-center rounded-full font-semibold select-none flex-shrink-0',
        variantClass[variant],
        sizeClass[size],
        className
      )}
    >
      {children ?? (initials ? initials.slice(0, 2).toUpperCase() : null)}
    </div>
  );
}