'use client';

import clsx from 'clsx';

/**
 * Skeleton — placeholder animado durante loading.
 *
 * Default: `animate-pulse bg-muted rounded` (text-muted color en el token actual).
 * Las dimensiones se controlan con className (ej. `h-4 w-32`).
 */
export function Skeleton({
  className,
  rounded = 'md',
}: {
  className?: string;
  rounded?: 'sm' | 'md' | 'lg' | 'full';
}) {
  const radius = {
    sm: 'rounded-sm',
    md: 'rounded',
    lg: 'rounded-lg',
    full: 'rounded-full',
  }[rounded];
  return (
    <div
      aria-hidden="true"
      className={clsx('animate-pulse bg-muted', radius, className)}
    />
  );
}