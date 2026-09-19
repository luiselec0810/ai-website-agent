'use client';

import { useEffect, useState } from 'react';
import { ExternalLink, ImageIcon, RefreshCw } from 'lucide-react';
import clsx from 'clsx';
import { mediaApi, type MediaItem } from '@/lib/api';
import { Skeleton } from '@/components/ui/Skeleton';

/**
 * LibraryPanel — sub-panel del sidebar para "Library".
 *
 * Lista los archivos media del sitio actual en un grid 2-col con
 * miniaturas. La carga es lazy: solo se hace fetch la primera vez que
 * el disclosure se abre (o cuando el usuario pulsa "Reintentar" tras
 * un error). Los datos se preservan si el usuario cierra y vuelve a
 * abrir el disclosure — solo se reintenta on-demand.
 *
 * Modo selección: si se pasa `onSelect`, cada tile se vuelve clickeable
 * y al hacer click invoca el callback con el `MediaItem` elegido. Esto
 * permite reusar el panel en otros contextos (ej. el popover del chat
 * para "adjuntar desde WordPress" sin re-subir el archivo).
 *
 * Estados:
 *   - `idle`     → todavía no se intentó fetch.
 *   - `loading`  → fetch en curso.
 *   - `error`    → fetch falló (mensaje inline + botón Reintentar).
 *   - `data`     → fetch OK (puede ser array vacío → empty state).
 *
 * Diseño:
 *   - Grid 2-col responsive (cada celda ~120px en sidebar 260px).
 *   - Miniaturas con `<img loading="lazy">`; fallback ImageIcon si
 *     el src falla.
 *   - Título truncado a 1 línea.
 *   - Botón "Open in new tab" compacto abajo del título.
 *
 * Tokens: `bg-panel`, `bg-surface`, `border-panel-border`, `text-text`,
 * `text-text-muted`, `text-text-faint`, `text-accent`, `bg-accent-soft`,
 * `rounded-card`, `shadow-popover`.
 */
type FetchState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'data'; items: MediaItem[] };

export interface LibraryPanelProps {
  siteId: string;
  /** Si se pasa, cada tile se vuelve clickeable y dispara este callback. */
  onSelect?: (item: MediaItem) => void;
}

export function LibraryPanel({ siteId, onSelect }: LibraryPanelProps) {
  const [state, setState] = useState<FetchState>({ kind: 'idle' });

  // Fetch una sola vez por mount del panel. Si el padre cierra y vuelve
  // a abrir el disclosure, AppSidebar desmonta/remonta este componente
  // y arrancamos de nuevo — está OK porque la lista es barata y queremos
  // estado fresco al re-abrir (consistente con la expectativa del usuario).
  useEffect(() => {
    let cancelled = false;
    setState({ kind: 'loading' });
    mediaApi
      .list(siteId, { limit: 24 })
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
  }, [siteId]);

  function retry() {
    setState({ kind: 'loading' });
    mediaApi
      .list(siteId, { limit: 24 })
      .then((items) => setState({ kind: 'data', items }))
      .catch((err: Error) => setState({ kind: 'error', message: err.message }));
  }

  return (
    <div
      className="bg-surface border border-panel-border rounded-card p-2 mx-1 mb-1 shadow-popover"
      role="region"
      aria-label="Library del sitio"
    >
      {state.kind === 'loading' && <LoadingView />}
      {state.kind === 'error' && (
        <ErrorView message={state.message} onRetry={retry} />
      )}
      {state.kind === 'data' && state.items.length === 0 && <EmptyView />}
      {state.kind === 'data' && state.items.length > 0 && (
        <MediaGrid items={state.items} onSelect={onSelect} />
      )}
      {state.kind === 'idle' && <LoadingView />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sub-views                                                          */
/* ------------------------------------------------------------------ */

function LoadingView() {
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="bg-panel border border-panel-border rounded-card p-1.5"
        >
          <Skeleton className="h-12 w-full mb-1" rounded="md" />
          <Skeleton className="h-2.5 w-3/4 mb-1" />
          <Skeleton className="h-5 w-full" />
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
        No se pudo cargar el media library
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
        aria-label="Reintentar carga del media library"
      >
        <RefreshCw size={10} />
        Reintentar
      </button>
    </div>
  );
}

function EmptyView() {
  return (
    <div className="px-2 py-3 text-center">
      <div className="mx-auto h-7 w-7 rounded-card bg-accent-soft text-accent flex items-center justify-center mb-1.5">
        <ImageIcon size={14} />
      </div>
      <p className="text-[11px] text-text font-medium mb-0.5">
        No hay media en este sitio todavía
      </p>
      <p className="text-[10px] text-text-faint leading-snug">
        Subí archivos desde el WordPress admin para verlos acá.
      </p>
    </div>
  );
}

function MediaGrid({
  items,
  onSelect,
}: {
  items: MediaItem[];
  onSelect?: (item: MediaItem) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-1.5 max-h-[260px] overflow-y-auto">
      {items.map((item) => (
        <MediaTile
          key={item.id}
          item={item}
          onSelect={onSelect ? () => onSelect(item) : undefined}
        />
      ))}
    </div>
  );
}

function MediaTile({
  item,
  onSelect,
}: {
  item: MediaItem;
  onSelect?: () => void;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const showThumb = !imgFailed && Boolean(item.url) && isLikelyImage(item);
  const interactive = !!onSelect;

  const body = (
    <>
      <div
        className={clsx(
          'h-12 w-full rounded mb-1 flex items-center justify-center overflow-hidden',
          'bg-surface border border-panel-border'
        )}
      >
        {showThumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.url}
            alt={item.alt || item.title}
            loading="lazy"
            onError={() => setImgFailed(true)}
            className="h-full w-full object-cover"
          />
        ) : (
          <ImageIcon size={16} className="text-text-faint" aria-hidden />
        )}
      </div>
      <p
        className="text-[10px] text-text font-medium truncate mb-0.5"
        title={item.title}
      >
        {item.title || `Media #${item.id}`}
      </p>
      {interactive ? (
        <span
          className={clsx(
            'inline-flex items-center justify-center gap-0.5 w-full',
            'h-5 rounded text-[9px] font-medium',
            'text-white bg-accent group-hover:bg-accent/90 transition'
          )}
        >
          Adjuntar
        </span>
      ) : (
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className={clsx(
            'inline-flex items-center justify-center gap-0.5 w-full',
            'h-5 rounded text-[9px] font-medium',
            'text-accent bg-accent-soft hover:bg-accent-soft/80 transition'
          )}
          aria-label={`Abrir ${item.title || `media ${item.id}`} en nueva pestaña`}
        >
          <ExternalLink size={8} />
          Open
        </a>
      )}
    </>
  );

  if (interactive) {
    return (
      <button
        type="button"
        onClick={onSelect}
        className={clsx(
          'bg-panel border border-panel-border rounded-card p-1.5 group text-left',
          'hover:border-accent/60 transition cursor-pointer w-full'
        )}
        aria-label={`Adjuntar ${item.title || `media ${item.id}`} al chat`}
      >
        {body}
      </button>
    );
  }

  return (
    <div className="bg-panel border border-panel-border rounded-card p-1.5 group">
      {body}
    </div>
  );
}

function isLikelyImage(item: MediaItem): boolean {
  if (item.mime_type) return item.mime_type.startsWith('image/');
  // Fallback por extensión de URL si el plugin no devolvió mime_type.
  const u = item.url ?? '';
  return /\.(png|jpe?g|gif|webp|svg|bmp|avif)(\?|$)/i.test(u);
}
