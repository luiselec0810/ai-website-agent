'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  History,
  ChevronDown,
  MessageSquare,
  Plus,
  Loader2,
} from 'lucide-react';
import clsx from 'clsx';
import { conversationsApi } from '@/lib/api';
import type { Conversation } from '@/lib/types';

/**
 * ConversationDropdown — dropdown en el header del chat para cambiar
 * de conversación sin salir del sitio.
 *
 * Comportamiento:
 *   - El botón muestra el título de la conversación actual
 *     (o "Nueva conversación" si no hay ninguna).
 *   - Click → abre un panel anclado debajo con:
 *       * Opción "Nueva conversación" al tope (limpia `?c=`).
 *       * Lista de las últimas 20 conversaciones del sitio.
 *   - Click en una conversación → `router.push` a `/sites/{id}?c={convId}`.
 *   - Click fuera del contenedor o tecla Escape → cierra.
 *
 * Usa `router.push` (Next.js client-side navigation) en lugar de mutar
 * el estado interno del `<Chat>`, para que el componente sea agnóstico
 * del flujo de carga de mensajes.
 */
export interface ConversationDropdownProps {
  siteId: string;
  /** ID de la conversación actualmente abierta (de `?c=`). */
  currentConversationId?: string;
  /** Título de la conversación actual (viene del `<Chat>`). */
  currentTitle?: string;
  /** Si true, muestra "Cargando conversación…" mientras el Chat carga historial. */
  loading?: boolean;
}

export function ConversationDropdown({
  siteId,
  currentConversationId,
  currentTitle,
  loading = false,
}: ConversationDropdownProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Cargar conversaciones cada vez que se abre el dropdown.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoadingList(true);
    conversationsApi
      .list(siteId, { limit: 20 })
      .then((res) => {
        if (!cancelled) setConversations(res);
      })
      .catch((err) => {
        console.error('[ConversationDropdown] failed to load conversations:', err);
      })
      .finally(() => {
        if (!cancelled) setLoadingList(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, siteId]);

  // Click outside / Escape → cerrar.
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

  const handleSelect = (convId?: string) => {
    setOpen(false);
    if (!convId) {
      router.push(`/sites/${siteId}`);
    } else if (convId !== currentConversationId) {
      router.push(`/sites/${siteId}?c=${convId}`);
    }
  };

  return (
    <div ref={containerRef} className="relative flex-1 min-w-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Selector de conversación"
        className={clsx(
          'flex items-center gap-2 min-w-0 px-2 py-1 rounded-card transition w-full text-left',
          'hover:bg-surface text-text-muted hover:text-text',
          open && 'bg-surface text-text'
        )}
      >
        <History size={14} className="flex-shrink-0 text-text-muted" />
        <span className="text-sm truncate flex-1 min-w-0">
          {loading ? (
            <span>Cargando conversación…</span>
          ) : currentTitle ? (
            <>
              <span className="hidden sm:inline text-text-muted">Conversación actual: </span>
              <span className="text-text font-medium">{currentTitle}</span>
            </>
          ) : (
            <span className="text-text">Nueva conversación</span>
          )}
        </span>
        <ChevronDown
          size={12}
          className={clsx(
            'flex-shrink-0 text-text-faint transition-transform',
            open && 'rotate-180 text-text-muted'
          )}
        />
      </button>
      {open && (
        <div
          className="absolute top-full left-0 right-0 mt-1 bg-panel border border-panel-border rounded-card shadow-popover z-30 max-h-80 overflow-y-auto animate-in"
          role="listbox"
          aria-label="Conversaciones"
        >
          <button
            type="button"
            onClick={() => handleSelect(undefined)}
            className="flex items-center gap-2 px-3 py-2 text-sm w-full text-left transition hover:bg-surface text-accent"
            role="option"
            aria-selected={!currentConversationId}
          >
            <Plus size={12} />
            <span>Nueva conversación</span>
          </button>
          {loadingList ? (
            <div className="flex items-center gap-2 px-3 py-2 text-sm text-text-muted">
              <Loader2 size={12} className="animate-spin" />
              <span>Cargando conversaciones…</span>
            </div>
          ) : conversations.length === 0 ? (
            <p className="text-xs text-text-faint px-3 py-2">
              No hay conversaciones aún.
            </p>
          ) : (
            <ul className="py-1 border-t border-panel-border">
              {conversations.map((c) => {
                const isActive = c.id === currentConversationId;
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => handleSelect(c.id)}
                      className={clsx(
                        'flex items-center gap-2 px-3 py-2 text-sm w-full text-left transition',
                        isActive
                          ? 'bg-accent-soft text-accent font-medium'
                          : 'text-text hover:bg-surface'
                      )}
                      role="option"
                      aria-selected={isActive}
                      title={c.preview ?? c.title}
                    >
                      <MessageSquare size={12} className="flex-shrink-0" />
                      <span className="truncate">
                        {c.preview || c.title || '(sin título)'}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}