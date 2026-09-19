'use client';

import type { ButtonHTMLAttributes, ReactNode } from 'react';
import clsx from 'clsx';

/**
 * Button — unifica todos los `<button>` del producto.
 *
 * Variantes:
 * - `primary` — botón de CTA (morado sólido). Para "Send", "Aprobar", "Nueva conversación".
 * - `ghost`  — botón secundario (transparente + hover gris). Para cancelar / dismiss.
 * - `icon`   — botón circular solo-ícono. Para toolbars de mensaje, etc.
 * - `danger` — destructivo (rojo sólido). Para "Rechazar", "Revertir".
 * - `soft`   — botón con fondo accent-soft (morado claro). Para acciones que necesitan emphasis
 *              pero no son el CTA principal.
 *
 * Tamaños: `sm`, `md` (default), `lg`. Para icon-only usar `icon`.
 *
 * Para mantener accesibilidad: si es `icon`, siempre debe tener `aria-label`
 * (no forzamos porque hay casos donde se combina con texto).
 */
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost' | 'icon' | 'danger' | 'soft';
  size?: 'sm' | 'md' | 'lg';
  /** Cuando el botón es solo un ícono, agrega un tamaño cuadrado. */
  iconOnly?: boolean;
  loading?: boolean;
  children?: ReactNode;
}

const sizeMap = {
  sm: 'h-8 text-xs px-3',
  md: 'h-10 text-sm px-4',
  lg: 'h-12 text-base px-5',
};

const iconSizeMap = {
  sm: 'h-8 w-8',
  md: 'h-10 w-10',
  lg: 'h-12 w-12',
};

const variantClass = {
  primary: clsx(
    'bg-accent text-white border border-transparent',
    'hover:bg-accent/90 active:bg-accent/80',
    'disabled:bg-accent/40'
  ),
  ghost: clsx(
    'bg-transparent text-text-muted border border-transparent',
    'hover:bg-surface hover:text-text',
    'disabled:text-text-faint'
  ),
  icon: clsx(
    'bg-transparent text-text-muted border border-transparent rounded-full',
    'hover:bg-surface hover:text-text',
    'disabled:text-text-faint'
  ),
  danger: clsx(
    'bg-danger text-white border border-transparent',
    'hover:bg-danger/90 active:bg-danger/80',
    'disabled:bg-danger/40'
  ),
  soft: clsx(
    'bg-accent-soft text-accent border border-transparent',
    'hover:bg-accent-soft/80 active:bg-accent-soft',
    'disabled:opacity-50'
  ),
};

export function Button({
  variant = 'primary',
  size = 'md',
  iconOnly = false,
  loading = false,
  className,
  disabled,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-card font-medium',
        'transition disabled:cursor-not-allowed',
        'focus-visible:outline-none focus-visible:shadow-focus',
        iconOnly ? iconSizeMap[size] : sizeMap[size],
        variantClass[variant],
        className
      )}
      {...rest}
    >
      {children}
    </button>
  );
}