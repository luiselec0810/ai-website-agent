'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Globe,
  MoreVertical,
  Plug,
  KeyRound,
  Trash2,
  ExternalLink,
  RefreshCw,
} from 'lucide-react';
import clsx from 'clsx';
import { sitesApi } from '@/lib/api';
import type { Site } from '@/lib/types';
import { Skeleton } from '@/components/ui/Skeleton';
import { Pill } from '@/components/ui/Pill';

/**
 * AppsPanel — sub-panel del sidebar para "Apps".
 *
 * Lista los sitios conectados (mismo source que el dashboard `/`),
 * con un kebab menu (⋮) por sitio para acciones administrativas.
 *
 * Acciones del kebab menu:
 *   - "Probar conexión" → POST `/sites/:id/test` (funciona).
 *   - "Editar API key"  → deshabilitado (endpoint no existe aún).
 *   - "Eliminar"        → deshabilitado (endpoint no existe aún).
 *
 * Las dos acciones deshabilitadas se renderizan con `aria-disabled`,
 * cursor `not-allowed` y un `title` con la justificación. Marcarlas
 * en la UI mantiene la estructura coherente con la spec y permite
 * habilitar el flujo completo cuando el backend exponga los
 * endpoints.
 *
 * Click en el cuerpo de la fila → navega a `/sites/<id>`. En modo
 * drawer (`onNavigate`) cerramos el drawer además de navegar.
 *
 * Tokens: `bg-panel`, `bg-surface`, `border-panel-border`, `text-text`,
 * `text-text-muted`, `text-text-faint`, `text-accent`, `bg-accent-soft`,
 * `rounded-card`, `shadow-popover`.
 */

type FetchState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'data'; items: Site[] };

/**
 * Estado del "Probar conexión" en línea con el sitio. Lo vive dentro
 * del panel para mantener el feedback cerca de la fila; se descarta
 * cuando el panel se desmonta.
 */
type TestState =
  | { kind: 'idle' }
  | { kind: 'testing' }
  | { kind: 'ok'; summary: string }
  | { kind: 'fail'; message: string };

export interface AppsPanelProps {
  /** Id del sitio activo (resaltado en la lista). */
  currentSiteId: string;
  /** Llamado cuando el usuario navega a otro sitio (útil para cerrar el drawer). */
  onNavigate?: () => void;
}

export function AppsPanel({ currentSiteId, onNavigate }: AppsPanelProps) {
  const router = useRouter();
  const [state, setState] = useState<FetchState>({ kind: 'loading' });
  const [openMenuFor, setOpenMenuFor] = useState<string | null>(null);
  const [testBySite, setTestBySite] = useState<Record<string, TestState>>({});

  useEffect(() => {
    let cancelled = false;
    setState({ kind: 'loading' });
    sitesApi
      .list()
      .then((items) => {
        if (cancelled) return;
        setState({ kind: 'data', items });
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setState({ kind: 'error', message: err.message });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function retry() {
    setState({ kind: 'loading' });
    sitesApi
      .list()
      .then((items) => setState({ kind: 'data', items }))
      .catch((err: Error) => setState({ kind: 'error', message: err.message }));
  }

  function goToSite(siteId: string) {
    router.push(`/sites/${siteId}`);
    onNavigate?.();
  }

  async function testSite(siteId: string) {
    setTestBySite((s) => ({ ...s, [siteId]: { kind: 'testing' } }));
    setOpenMenuFor(null);
    try {
      const r = await sitesApi.test(siteId);
      const summary = `WP ${r.wordpress_version ?? '?'} · Elementor ${r.elementor_version ?? '?'}`;
      setTestBySite((s) => ({ ...s, [siteId]: { kind: 'ok', summary } }));
    } catch (err) {
      setTestBySite((s) => ({
        ...s,
        [siteId]: { kind: 'fail', message: (err as Error).message },
      }));
    }
  }

  return (
    <div
      className="bg-surface border border-panel-border rounded-card p-2 mx-1 mb-1 shadow-popover"
      role="region"
      aria-label="Sitios conectados"
    >
      {state.kind === 'loading' && <LoadingView />}
      {state.kind === 'error' && (
        <ErrorView message={state.message} onRetry={retry} />
      )}
      {state.kind === 'data' && state.items.length === 0 && (
        <EmptyView onAdd={onNavigate} />
      )}
      {state.kind === 'data' && state.items.length > 0 && (
        <div className="max-h-[300px] overflow-y-auto space-y-1">
          {state.items.map((site) => (
            <SiteRow
              key={site.id}
              site={site}
              isActive={site.id === currentSiteId}
              menuOpen={openMenuFor === site.id}
              onOpenMenu={() =>
                setOpenMenuFor((cur) => (cur === site.id ? null : site.id))
              }
              onCloseMenu={() => setOpenMenuFor(null)}
              onGo={() => goToSite(site.id)}
              onTest={() => testSite(site.id)}
              testState={testBySite[site.id] ?? { kind: 'idle' }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sub-views                                                          */
/* ------------------------------------------------------------------ */

function LoadingView() {
  return (
    <div className="space-y-1">
      {[0, 1].map((i) => (
        <div
          key={i}
          className="bg-panel border border-panel-border rounded-card p-2 flex items-center gap-2"
        >
          <Skeleton className="h-7 w-7" rounded="md" />
          <div className="flex-1 min-w-0">
            <Skeleton className="h-2.5 w-3/5 mb-1" />
            <Skeleton className="h-2 w-4/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

function ErrorView({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="px-2 py-3 text-center">
      <p className="text-[11px] text-danger font-medium mb-1">
        No se pudieron cargar los sitios
      </p>
      <p
        className="text-[10px] text-text-faint mb-2 leading-snug break-words"
        title={message}
      >
        {message}
      </p>
      <button
        onClick={onRetry}
        className={clsx(
          'inline-flex items-center gap-1 px-2 py-1 rounded-card text-[10px] font-medium',
          'bg-accent-soft text-accent hover:bg-accent-soft/80 transition'
        )}
        aria-label="Reintentar carga de sitios"
      >
        <RefreshCw size={10} />
        Reintentar
      </button>
    </div>
  );
}

function EmptyView({ onAdd }: { onAdd?: () => void }) {
  return (
    <div className="px-2 py-3 text-center">
      <div className="mx-auto h-7 w-7 rounded-card bg-accent-soft text-accent flex items-center justify-center mb-1.5">
        <Globe size={14} />
      </div>
      <p className="text-[11px] text-text font-medium mb-0.5">
        No hay sitios conectados
      </p>
      <p className="text-[10px] text-text-faint leading-snug mb-2">
        Andá al dashboard para conectar el primero.
      </p>
      <a
        href="/"
        onClick={() => onAdd?.()}
        className={clsx(
          'inline-flex items-center gap-1 px-2 py-1 rounded-card text-[10px] font-medium',
          'bg-accent-soft text-accent hover:bg-accent-soft/80 transition'
        )}
      >
        Ir al dashboard
      </a>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Site row + kebab menu                                              */
/* ------------------------------------------------------------------ */

function SiteRow({
  site,
  isActive,
  menuOpen,
  onOpenMenu,
  onCloseMenu,
  onGo,
  onTest,
  testState,
}: {
  site: Site;
  isActive: boolean;
  menuOpen: boolean;
  onOpenMenu: () => void;
  onCloseMenu: () => void;
  onGo: () => void;
  onTest: () => void;
  testState: TestState;
}) {
  const initials = site.name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div
      className={clsx(
        'bg-panel border rounded-card p-2 group relative',
        isActive ? 'border-accent/40' : 'border-panel-border'
      )}
    >
      <div className="flex items-start gap-2">
        {/* Avatar — click navega. */}
        <button
          type="button"
          onClick={onGo}
          className="h-7 w-7 rounded-card bg-accent-soft text-accent flex items-center justify-center text-[10px] font-semibold flex-shrink-0 hover:bg-accent-soft/80 transition focus-visible:outline-none focus-visible:shadow-focus"
          aria-label={`Ir al sitio ${site.name}`}
          title={site.name}
        >
          {initials || <Globe size={12} />}
        </button>

        {/* Info + pills — click navega. */}
        <button
          type="button"
          onClick={onGo}
          className="flex-1 min-w-0 text-left focus-visible:outline-none focus-visible:shadow-focus rounded"
          aria-label={`Ir al sitio ${site.name}`}
        >
          <p
            className={clsx(
              'text-[11px] font-semibold truncate leading-tight',
              isActive ? 'text-accent' : 'text-text'
            )}
            title={site.name}
          >
            {site.name}
          </p>
          <p
            className="text-[10px] text-text-muted truncate inline-flex items-center gap-0.5 mt-0.5"
            title={site.url}
          >
            <span className="truncate">{site.url}</span>
            <ExternalLink size={8} className="flex-shrink-0" />
          </p>
          <div className="mt-1 flex items-center gap-1 flex-wrap">
            <Pill size="xs" variant="neutral">
              WP {site.wordpress_version ?? '—'}
            </Pill>
            <Pill size="xs" variant="neutral">
              Elementor {site.elementor_version ?? '—'}
            </Pill>
            {isActive ? (
              <Pill size="xs" variant="accent">
                Actual
              </Pill>
            ) : site.status === 'connected' ? (
              <Pill size="xs" variant="success">
                Activo
              </Pill>
            ) : (
              <Pill size="xs" variant="warning">
                {site.status || 'Inactivo'}
              </Pill>
            )}
          </div>
        </button>

        {/* Kebab trigger. */}
        <button
          type="button"
          onClick={onOpenMenu}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label={`Acciones para ${site.name}`}
          className={clsx(
            'h-6 w-6 rounded-full inline-flex items-center justify-center flex-shrink-0',
            'text-text-muted hover:text-text hover:bg-surface transition',
            'focus-visible:outline-none focus-visible:shadow-focus'
          )}
        >
          <MoreVertical size={12} />
        </button>
      </div>

      {/* Inline test feedback (debajo de la fila, solo si se testeó). */}
      {testState.kind !== 'idle' && (
        <div
          className={clsx(
            'mt-1.5 px-1.5 py-1 rounded text-[10px] leading-snug',
            testState.kind === 'testing' && 'bg-surface text-text-muted',
            testState.kind === 'ok' && 'bg-success-soft text-success',
            testState.kind === 'fail' && 'bg-danger-soft text-danger'
          )}
        >
          {testState.kind === 'testing' && 'Probando conexión…'}
          {testState.kind === 'ok' && `OK · ${testState.summary}`}
          {testState.kind === 'fail' && (
            <span title={testState.message}>
              Falló: {truncate(testState.message, 80)}
            </span>
          )}
        </div>
      )}

      {/* Kebab menu (popover). */}
      {menuOpen && (
        <SiteMenu
          siteName={site.name}
          onClose={onCloseMenu}
          onTest={onTest}
        />
      )}
    </div>
  );
}

function SiteMenu({
  siteName,
  onClose,
  onTest,
}: {
  siteName: string;
  onClose: () => void;
  onTest: () => void;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Click-outside + Escape para cerrar el menú.
  useEffect(() => {
    function onPointerDown(e: MouseEvent) {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={`Acciones para ${siteName}`}
      className={clsx(
        'absolute right-1 top-8 z-20 min-w-[160px]',
        'bg-panel border border-panel-border rounded-card shadow-popover',
        'py-1 text-[11px]'
      )}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        role="menuitem"
        type="button"
        onClick={onTest}
        className={clsx(
          'w-full flex items-center gap-2 px-2 py-1.5 text-left',
          'text-text hover:bg-surface transition'
        )}
      >
        <Plug size={11} className="text-text-muted" />
        Probar conexión
      </button>

      {/* Deshabilitado: falta endpoint PUT /sites/:id en el orchestrator. */}
      <button
        role="menuitem"
        type="button"
        disabled
        aria-disabled="true"
        title="Próximamente — el endpoint para editar API key aún no está disponible"
        className={clsx(
          'w-full flex items-center gap-2 px-2 py-1.5 text-left',
          'text-text-faint cursor-not-allowed'
        )}
      >
        <KeyRound size={11} />
        Editar API key
        <span className="ml-auto text-[9px] text-text-faint">Pronto</span>
      </button>

      {/* Deshabilitado: falta endpoint DELETE /sites/:id en el orchestrator. */}
      <button
        role="menuitem"
        type="button"
        disabled
        aria-disabled="true"
        title="Próximamente — el endpoint para eliminar sitios aún no está disponible"
        className={clsx(
          'w-full flex items-center gap-2 px-2 py-1.5 text-left',
          'text-text-faint cursor-not-allowed'
        )}
      >
        <Trash2 size={11} />
        Eliminar
        <span className="ml-auto text-[9px] text-text-faint">Pronto</span>
      </button>
    </div>
  );
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n - 1)}…`;
}
