'use client';

/**
 * SiteInventoryBadge — chip compacto para el header del chat que muestra la
 * "frescura" del inventario del sitio inyectado en el system prompt del LLM.
 *
 * El inventario es un cache read-only (páginas, templates, media, design
 * system) que el orchestrator mantiene para evitar que el LLM invente IDs.
 * Este badge:
 *   - Muestra la edad del cache (o "no cacheado" si nunca se pidió).
 *   - Click → abre un popover con detalles y un botón "Refresh" que dispara
 *     `DELETE /api/sites/:id/inventory` + `GET ...?refresh=1`.
 *   - Click fuera del popover o tecla `Escape` → cierra el popover.
 *
 * No se mete en el flujo crítico del chat: si falla, se loggea y se sigue
 * como si no existiera.
 *
 * Diseño (Design System tokens):
 *   - Card base: `bg-panel border border-panel-border rounded-card`.
 *   - Loading: spinner accent + texto muted.
 *   - Fresh (cached + age < TTL): badge `bg-success-soft text-success` con checkmark.
 *   - Stale (cached pero TTL expirado): badge `bg-warning-soft text-warning` con clock.
 *   - Error: `bg-danger-soft text-danger`.
 *
 * Hidratación: cualquier render que dependa de `Date.now()` o del estado
 * del cache (que solo se conoce después del fetch) puede divergir entre
 * server y cliente. Por eso usamos un `mounted` flag: hasta que el componente
 * se monte en el cliente, renderizamos un placeholder estático. Esto coincide
 * con el patrón que el resto de la app está adoptando para evitar warnings
 * de hydration de Next.js.
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Database,
  RefreshCw,
  AlertTriangle,
  Check,
  Clock,
  X,
} from 'lucide-react';
import clsx from 'clsx';

interface InventoryHealth {
  cached: boolean;
  age_ms: number;
  ttl_ms: number;
  source: 'cache' | 'fresh';
}

interface SiteInventoryBadgeProps {
  siteId: string;
  /**
   * Si cambia (p.ej. tras aprobar un change plan), el badge vuelve a chequear
   * el estado automáticamente.
   */
  refreshTrigger?: number;
}

function formatAge(ms: number): string {
  if (ms < 0) return '—';
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return `${h} h`;
}

async function fetchHealth(siteId: string): Promise<InventoryHealth> {
  const res = await fetch(
    `${(typeof process !== 'undefined' && process.env.NEXT_PUBLIC_ORCHESTRATOR_URL
      ? `${process.env.NEXT_PUBLIC_ORCHESTRATOR_URL}/api`
      : '/api')}/sites/${siteId}/inventory/health`,
    { cache: 'no-store' }
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as { success: boolean; data: InventoryHealth };
  if (!json.success) throw new Error('Backend error');
  return json.data;
}

async function refreshInventory(siteId: string): Promise<void> {
  const base =
    typeof process !== 'undefined' && process.env.NEXT_PUBLIC_ORCHESTRATOR_URL
      ? `${process.env.NEXT_PUBLIC_ORCHESTRATOR_URL}/api`
      : '/api';
  await fetch(`${base}/sites/${siteId}/inventory`, { method: 'DELETE' });
  await fetch(`${base}/sites/${siteId}/inventory?refresh=1`, { cache: 'no-store' });
}

export function SiteInventoryBadge({
  siteId,
  refreshTrigger = 0,
}: SiteInventoryBadgeProps) {
  const [health, setHealth] = useState<InventoryHealth | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const load = useCallback(async () => {
    try {
      const h = await fetchHealth(siteId);
      setHealth(h);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [siteId]);

  // Cargar al montar y cada vez que cambie refreshTrigger / siteId.
  useEffect(() => {
    let cancelled = false;
    void load().then(() => {
      if (cancelled) return;
    });
    return () => {
      cancelled = true;
    };
  }, [load, refreshTrigger]);

  // Incrementar la edad localmente cada 10s para que el badge se actualice
  // sin re-fetche (igual que la versión original).
  useEffect(() => {
    if (!health) return;
    const id = setInterval(() => {
      setHealth((prev) => (prev ? { ...prev, age_ms: prev.age_ms + 10_000 } : prev));
    }, 10_000);
    return () => clearInterval(id);
  }, [health?.cached]);

  // Click outside / Escape → cerrar popover.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const onRefresh = async () => {
    setLoading(true);
    try {
      await refreshInventory(siteId);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  // Mientras no estamos montados en el cliente, devolvemos un placeholder
  // estático (sin textos dependientes de tiempo) para que el HTML de SSR
  // coincida con el primer render del cliente.
  if (!mounted) {
    return (
      <span
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-pill text-xs uppercase tracking-wider font-semibold text-text-faint border border-panel-border bg-panel"
        aria-hidden="true"
      >
        <Database size={12} />
      </span>
    );
  }

  // Estado de error → botón danger que abre el popover (también con refresh).
  if (error) {
    return (
      <div ref={containerRef} className="relative inline-flex">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label="Estado del inventario del sitio (error)"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-pill text-xs uppercase tracking-wider font-semibold bg-danger-soft text-danger border border-transparent hover:border-danger/40 transition"
        >
          <AlertTriangle size={12} />
          <span className="font-medium">inventario n/d</span>
        </button>
        {open && (
          <Popover
            title="Inventario del sitio"
            tone="danger"
            onClose={() => setOpen(false)}
            footer={
              <button
                type="button"
                onClick={onRefresh}
                disabled={loading}
                className="w-full inline-flex items-center justify-center gap-1.5 h-8 px-3 rounded-card text-xs font-medium bg-accent text-white border border-transparent hover:bg-accent/90 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
                <span>{loading ? 'Refrescando…' : 'Refresh'}</span>
              </button>
            }
          >
            <div className="text-danger flex items-start gap-1.5">
              <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          </Popover>
        )}
      </div>
    );
  }

  // Loading inicial.
  if (!health) {
    return (
      <div ref={containerRef} className="relative inline-flex">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label="Cargando inventario del sitio"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-pill text-xs uppercase tracking-wider font-semibold text-text-muted border border-panel-border bg-panel"
        >
          <Database size={12} className="animate-pulse text-accent" />
          <span>cargando…</span>
        </button>
        {open && (
          <Popover
            title="Inventario del sitio"
            onClose={() => setOpen(false)}
            footer={
              <button
                type="button"
                onClick={onRefresh}
                disabled={loading}
                className="w-full inline-flex items-center justify-center gap-1.5 h-8 px-3 rounded-card text-xs font-medium bg-accent text-white border border-transparent hover:bg-accent/90 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
                <span>{loading ? 'Refrescando…' : 'Refresh'}</span>
              </button>
            }
          >
            <div className="flex items-center gap-1.5 text-text-muted">
              <RefreshCw size={12} className="animate-spin" />
              <span>Cargando estado del inventario…</span>
            </div>
          </Popover>
        )}
      </div>
    );
  }

  const fresh = health.cached && health.age_ms < health.ttl_ms;

  return (
    <div ref={containerRef} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={
          health.cached
            ? `Inventario cacheado hace ${formatAge(health.age_ms)} (TTL ${formatAge(
                health.ttl_ms
              )})`
            : 'Inventario no cacheado — próximo mensaje del chat lo cargará'
        }
        className={clsx(
          'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-pill text-xs uppercase tracking-wider font-semibold border border-transparent transition',
          'hover:border-current/40',
          fresh
            ? 'bg-success-soft text-success'
            : 'bg-warning-soft text-warning'
        )}
      >
        {fresh ? <Check size={12} /> : <Clock size={12} />}
        <span className="font-medium">
          inv {health.cached ? formatAge(health.age_ms) : '—'}
        </span>
      </button>
      {open && (
        <Popover
          title="Inventario del sitio"
          onClose={() => setOpen(false)}
          footer={
            <button
              type="button"
              onClick={onRefresh}
              disabled={loading}
              aria-label="Refrescar inventario del sitio"
              className="w-full inline-flex items-center justify-center gap-1.5 h-8 px-3 rounded-card text-xs font-medium bg-accent text-white border border-transparent hover:bg-accent/90 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
              <span>{loading ? 'Refrescando…' : 'Refresh'}</span>
            </button>
          }
        >
          <div className="flex items-center justify-between text-text">
            <span className="text-text-muted">Edad del cache</span>
            <span className="font-medium">
              {health.cached ? formatAge(health.age_ms) : '—'}
            </span>
          </div>
          <div className="flex items-center justify-between text-text">
            <span className="text-text-muted">TTL</span>
            <span className="font-medium">{formatAge(health.ttl_ms)}</span>
          </div>
          <div className="flex items-center justify-between text-text mt-0.5">
            <span className="text-text-muted">Fuente</span>
            <span className="font-medium">
              {health.source === 'cache' ? 'cache' : 'fresh'}
            </span>
          </div>
          <div className="mt-2">
            <span
              className={clsx(
                'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-pill text-xs uppercase tracking-wider font-semibold border border-transparent',
                fresh
                  ? 'bg-success-soft text-success'
                  : 'bg-warning-soft text-warning'
              )}
            >
              {fresh ? <Check size={12} /> : <Clock size={12} />}
              <span className="font-medium">{fresh ? 'fresco' : 'stale'}</span>
            </span>
          </div>
        </Popover>
      )}
    </div>
  );
}

/**
 * Popover — mini panel anclado debajo del botón. Se posiciona absoluto
 * respecto al contenedor `relative` que envuelve trigger + popover.
 *
 * Props:
 *   - `title`    — texto del header (con ícono de Database).
 *   - `tone`     — color del header. Default `accent`, alternativo `danger`.
 *   - `onClose`  — botón X (Escape y click-outside los maneja el padre).
 *   - `footer`   — slot para el botón de acción primaria (Refresh).
 *   - `children` — contenido del cuerpo.
 */
function Popover({
  title,
  tone = 'accent',
  onClose,
  footer,
  children,
}: {
  title: string;
  tone?: 'accent' | 'danger';
  onClose: () => void;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      role="dialog"
      aria-label={title}
      className="absolute right-0 top-full mt-1 z-30 bg-panel border border-panel-border rounded-card shadow-popover p-3 w-60 text-xs animate-in"
    >
      <div className="flex items-center gap-2 mb-2">
        <Database
          size={14}
          className={tone === 'danger' ? 'text-danger' : 'text-accent'}
        />
        <span className="font-medium text-text flex-1">{title}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar"
          className="text-text-faint hover:text-text p-0.5 rounded hover:bg-surface"
        >
          <X size={12} />
        </button>
      </div>
      <div className="space-y-1">{children}</div>
      {footer && <div className="mt-3">{footer}</div>}
    </div>
  );
}