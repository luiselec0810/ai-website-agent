'use client';

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useRouter } from 'next/navigation';
import {
  Loader2,
  MessageSquare,
  Plus,
  X,
} from 'lucide-react';
import clsx from 'clsx';
import { ChatSession } from './Chat';
import type { Change, Site } from '@/lib/types';

/**
 * Estado interno de un tab. Una tab representa una conversación abierta en el
 * UI; cada tab tiene su propia instancia de `<ChatSession>` que mantiene todo
 * el state (mensajes, input, adjuntos, etc.) de forma aislada.
 *
 * Lifecycle:
 *   1. Nace como `{status: 'new'}` cuando el usuario hace click en "+" o cuando
 *      la URL trae un `?c=<id>` que no estaba abierto.
 *   2. Pasa a `loading` mientras el `<ChatSession>` carga el historial (sólo si
 *      trae `conversationId` desde el inicio).
 *   3. Pasa a `ready` cuando termina la carga o cuando se envía el primer
 *      mensaje (el backend devuelve el `conversation_id` real).
 *
 * Cuando el backend devuelve un `conversation_id`, el padre actualiza la tab
 * vía `onConversationChange(tabId, convId)` y la URL pasa a `?c=<nuevo_id>`.
 */
interface Tab {
  tabId: string;
  conversationId?: string;
  title: string;
  status: 'new' | 'loading' | 'ready';
}

const TAB_TITLE_NEW = 'Nueva conversación';
const TAB_TITLE_LOADING = 'Cargando…';
const DEFAULT_MAX_TABS = 8;

/**
 * Genera un `tabId` único y estable por tab.
 *
 * Usa `crypto.randomUUID()` cuando está disponible (todos los navegadores
 * modernos + Node 19+). Cae a un fallback basado en `Math.random + Date.now`
 * si la API no está presente (ej: SSR en algunos contextos edge).
 */
function newTabId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'tab_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

/**
 * Construye la URL del sitio apuntando a la tab dada. Si la tab tiene
 * `conversationId`, lo agrega como `?c=`. Si no, URL limpia.
 */
function siteUrl(siteId: string, tab: Tab): string {
  return tab.conversationId
    ? `/sites/${siteId}?c=${encodeURIComponent(tab.conversationId)}`
    : `/sites/${siteId}`;
}

/**
 * API imperativa expuesta por `<ChatTabs>` al padre vía `ref`. La usa
 * `AppSidebar` para pedir que se abra (o active) la tab de una conversación
 * sin pasar por el ciclo effect→URL→effect.
 */
export interface ChatTabsHandle {
  /** Abre una tab para `convId` (o activa la existente). */
  openConversation: (convId: string) => void;
  /** Abre una nueva tab vacía y la activa. */
  openNewTab: () => void;
}

export const ChatTabs = forwardRef<ChatTabsHandle, {
  siteId: string;
  site: Site;
  /** `?c=` actual de la URL al montar. La fuente de verdad del padre. */
  initialConversationId?: string;
  onToggleSidebar?: () => void;
  modelName?: string;
  /**
   * Re-emite el `change` activo del session actualmente visible. El padre lo
   * usa para alimentar el RightPanel (aprobación en curso).
   */
  onActiveChange?: (
    change: Change | null,
    results: Array<{ tool: string; status: string; retries: number; error?: { message: string } }>
  ) => void;
  /**
   * Re-emite la lista agregada de cambios pendientes (unión de todas las
   * tabs abiertas). Lo usa el sidebar para el badge "Pending changes".
   */
  onPendingChanges: (changes: Change[]) => void;
  /** Tope duro de tabs abiertas para evitar clutter. Default: 8. */
  maxTabs?: number;
}>(function ChatTabs({
  siteId,
  site,
  initialConversationId,
  onToggleSidebar,
  modelName,
  onActiveChange,
  onPendingChanges,
  maxTabs = DEFAULT_MAX_TABS,
}: {
  siteId: string;
  site: Site;
  /** `?c=` actual de la URL al montar. La fuente de verdad del padre. */
  initialConversationId?: string;
  onToggleSidebar?: () => void;
  modelName?: string;
  /**
   * Re-emite el `change` activo del session actualmente visible. El padre lo
   * usa para alimentar el RightPanel (aprobación en curso).
   */
  onActiveChange?: (
    change: Change | null,
    results: Array<{ tool: string; status: string; retries: number; error?: { message: string } }>
  ) => void;
  /**
   * Re-emite la lista agregada de cambios pendientes (unión de todas las
   * tabs abiertas). Lo usa el sidebar para el badge "Pending changes".
   */
  onPendingChanges: (changes: Change[]) => void;
  /** Tope duro de tabs abiertas para evitar clutter. Default: 8. */
  maxTabs?: number;
}, ref) {
  const router = useRouter();
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  // Bandera de init: separamos el effect de "primer mount" del effect de
  // "el URL cambió mientras estoy vivo". Sin esto, la segunda pasada del
  // effect con `[initialConversationId]` duplicaría la tab inicial.
  const initRef = useRef(false);
  // Cada ChatSession emite sus cambios pendientes vía este mapa. Acumulamos
  // y emitimos la unión al padre cuando cambia.
  const pendingByTabRef = useRef<Map<string, Change[]>>(new Map());
  const [pendingTick, setPendingTick] = useState(0); // fuerza re-emit cuando un session reporta nuevos cambios

  // ─── Init ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    const tabId = newTabId();
    const initialTab: Tab = {
      tabId,
      conversationId: initialConversationId,
      title: initialConversationId ? TAB_TITLE_LOADING : TAB_TITLE_NEW,
      status: initialConversationId ? 'loading' : 'new',
    };
    setTabs([initialTab]);
    setActiveTabId(tabId);
  }, [initialConversationId]);

  // ─── Reaccionar a cambios en `?c=` después del init ────────────────────
  // Caso típico: el usuario hace click en una conversación del sidebar
  // (`<Link href="/sites/X?c=Y">`) y ChatTabs debe abrir/activar esa tab.
  useEffect(() => {
    if (!initRef.current) return; // esperar al init
    if (!initialConversationId) return; // URL sin ?c= → no hacer nada
    const existing = tabs.find((t) => t.conversationId === initialConversationId);
    if (existing) {
      setActiveTabId(existing.tabId);
      return;
    }
    if (tabs.length >= maxTabs) {
      // Tope alcanzado: caemos a la primera tab como fallback.
      if (tabs.length > 0) setActiveTabId(tabs[0].tabId);
      return;
    }
    const tabId = newTabId();
    const newTab: Tab = {
      tabId,
      conversationId: initialConversationId,
      title: TAB_TITLE_LOADING,
      status: 'loading',
    };
    setActiveTabId(tabId);
    setTabs((prev) => [...prev, newTab]);
    // No llamamos replaceUrl acá: si la URL ya tiene este `?c=`, es
    // redundante; si viene de un imperative openConversation, ya se manejó
    // allí mismo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialConversationId, maxTabs]);

  // ─── Helpers ──────────────────────────────────────────────────────────
  const replaceUrl = useCallback(
    (tab: Tab | null) => {
      const url = tab ? siteUrl(siteId, tab) : `/sites/${siteId}`;
      router.replace(url);
    },
    [router, siteId]
  );

  /**
   * IMPORTANTE: NO llamar a `setActiveTabId` ni a `replaceUrl` DENTRO del
   * updater de `setTabs`. En React 18 los updaters se ejecutan en un contexto
   * de batching donde los setStates anidados se procesan de forma poco
   * confiable (probado: el `aria-selected` quedaba en `false` para todas las
   * tabs). Hacerlo así — un `setActiveTabId` y un `setTabs` planos — funciona.
   */
  const openNewTab = useCallback(() => {
    if (tabs.length >= maxTabs) return;
    const tabId = newTabId();
    const newTab: Tab = {
      tabId,
      title: TAB_TITLE_NEW,
      status: 'new',
    };
    setActiveTabId(tabId);
    setTabs((prev) => [...prev, newTab]);
    replaceUrl(newTab);
  }, [tabs.length, maxTabs, replaceUrl]);

  /**
   * Abre (o activa) una tab para una conversación existente. Llamado desde el
   * sidebar al hacer click en una conversación de la lista CHATS.
   *
   * No usa updater funcional de `setTabs` para los `setActiveTabId` anidados
   * (mismo motivo que `openNewTab`).
   */
  const openConversation = useCallback(
    (convId: string) => {
      const existing = tabs.find((t) => t.conversationId === convId);
      if (existing) {
        setActiveTabId(existing.tabId);
        replaceUrl(existing);
        return;
      }
      if (tabs.length >= maxTabs) {
        // Tope alcanzado: caemos a la primera tab como fallback (igual que
        // cuando se abre desde la URL).
        if (tabs.length > 0) setActiveTabId(tabs[0].tabId);
        return;
      }
      const tabId = newTabId();
      const newTab: Tab = {
        tabId,
        conversationId: convId,
        title: TAB_TITLE_LOADING,
        status: 'loading',
      };
      setActiveTabId(tabId);
      setTabs((prev) => [...prev, newTab]);
      replaceUrl(newTab);
    },
    [tabs, maxTabs, replaceUrl]
  );

  /**
   * Cierra una tab. NO borra la conversación del servidor — sólo la quita de
   * la lista de tabs abiertas. Si era la activa, auto-activamos la siguiente
   * (o la anterior si era la última).
   *
   * No usa updater funcional de `setTabs` para los `setActiveTabId` anidados
   * (mismo motivo que `openNewTab`).
   */
  const closeTab = useCallback(
    (tabId: string) => {
      const idx = tabs.findIndex((t) => t.tabId === tabId);
      if (idx === -1) return;
      const next = tabs.filter((t) => t.tabId !== tabId);
      pendingByTabRef.current.delete(tabId);
      setPendingTick((t) => t + 1);
      let newActive: Tab | null = null;
      let nextTabs: Tab[] = next;
      if (activeTabId === tabId) {
        if (next.length === 0) {
          // No quedan tabs. Mantenemos al menos una tab vacía (UX tipo
          // navegador: cerrar la última abre una nueva).
          newActive = {
            tabId: newTabId(),
            title: TAB_TITLE_NEW,
            status: 'new',
          };
          nextTabs = [newActive];
        } else {
          // Auto-activar la tab que ocupa la misma posición, o la anterior
          // si cerramos la última.
          newActive = next[idx] ?? next[idx - 1] ?? next[0];
        }
      }
      setTabs(nextTabs);
      if (newActive) {
        setActiveTabId(newActive.tabId);
        replaceUrl(newActive);
      }
    },
    [tabs, activeTabId, replaceUrl]
  );

  const activateTab = useCallback(
    (tabId: string) => {
      setActiveTabId(tabId);
      const tab = tabs.find((t) => t.tabId === tabId);
      if (tab) replaceUrl(tab);
    },
    [replaceUrl, tabs]
  );

  // ─── Callbacks emitidos por cada ChatSession ─────────────────────────
  /**
   * `ChatSession` lo llama cuando su `conversationId` cambia (ej: el backend
   * devuelve el id real tras el primer mensaje). Actualizamos la tab y la URL.
   */
  const handleConvChange = useCallback(
    (tabId: string, convId: string | undefined) => {
      setTabs((prev) =>
        prev.map((t) => {
          if (t.tabId !== tabId) return t;
          // Si la tab ya tenía este convId, no-op.
          if (t.conversationId === convId) return t;
          return { ...t, conversationId: convId, status: convId ? 'ready' : t.status };
        })
      );
      if (tabId === activeTabId) {
        const target = tabs.find((t) => t.tabId === tabId);
        if (target) {
          const updated = { ...target, conversationId: convId, status: convId ? 'ready' as const : target.status };
          replaceUrl(updated);
        }
      }
    },
    [activeTabId, replaceUrl, tabs]
  );

  /**
   * `ChatSession` lo llama cuando conoce el título de la conversación (lo
   * trae el endpoint `/conversations/:id/messages`). Acepta `undefined` para
   * no romper si la API no devuelve título (mostramos "Nueva conversación").
   */
  const handleTitleChange = useCallback((tabId: string, title: string | undefined) => {
    setTabs((prev) =>
      prev.map((t) => (t.tabId === tabId ? { ...t, title: title || TAB_TITLE_NEW } : t))
    );
  }, []);

  /**
   * Acumula los `pendingChanges` reportados por cada session y re-emite la
   * unión al padre. Usamos un Map + tick para forzar la emisión cuando hay
   * cambios (un useEffect con deps sobre el Map no es reactivo).
   */
  const handleSessionPending = useCallback((_tabId: string, changes: Change[]) => {
    pendingByTabRef.current.set(_tabId, changes);
    setPendingTick((t) => t + 1);
  }, []);

  // Re-emitir la unión cuando cambia cualquier tab.
  useEffect(() => {
    const merged: Change[] = [];
    const seen = new Set<string>();
    for (const list of pendingByTabRef.current.values()) {
      for (const c of list) {
        if (!seen.has(c.id)) {
          seen.add(c.id);
          merged.push(c);
        }
      }
    }
    onPendingChanges(merged);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingTick, tabs]);

  // ─── Exponer API al padre vía ref imperativa ─────────────────────────
  // page.tsx enchufa este ref en `AppSidebar.onOpenConversation` para que el
  // click en una conversación del sidebar abra/active la tab correcta sin
  // pasar por el ciclo effect→URL→effect.
  useImperativeHandle(
    ref,
    () => ({
      openConversation,
      openNewTab,
    }),
    [openConversation, openNewTab]
  );

  /**
   * Devuelve callbacks que cada `ChatSession` puede llamar. Memoizados para
   * que las sesiones no se re-rendericen innecesariamente al cambiar la tab
   * activa u otros tabs.
   *
   * NOTA: las firmas de los callbacks incluyen el `tabId` aunque ya lo
   * conozcamos por el closure, porque `<ChatSession>` lo emite como primer
   * argumento. Lo recibimos pero no lo usamos (ya viene en `tab.tabId`).
   */
  const sessionCallbacks = useMemo(() => {
    const map = new Map<
      string,
      {
        onConversationChange: (tabId: string, convId: string | undefined) => void;
        onTitleChange: (tabId: string, title: string | undefined) => void;
        onPendingChanges: (changes: Change[]) => void;
        onNewTab: () => void;
      }
    >();
    for (const tab of tabs) {
      map.set(tab.tabId, {
        onConversationChange: (_tid, convId) => handleConvChange(tab.tabId, convId),
        onTitleChange: (_tid, title) => handleTitleChange(tab.tabId, title),
        onPendingChanges: (changes) => handleSessionPending(tab.tabId, changes),
        onNewTab: () => openNewTab(),
      });
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs, handleConvChange, handleTitleChange, handleSessionPending, openNewTab]);

  const activeTab = tabs.find((t) => t.tabId === activeTabId) ?? null;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Tab bar */}
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        maxTabs={maxTabs}
        onActivate={activateTab}
        onClose={closeTab}
        onNew={openNewTab}
      />

      {/* Sessions: todas montadas, sólo la activa visible. Mantener las
          inactivas montadas preserva el input a medio tipear, adjuntos
          subiéndose, y streams SSE de aprobación en curso. */}
      <div className="flex-1 min-h-0 relative">
        {tabs.map((tab) => {
          const cb = sessionCallbacks.get(tab.tabId);
          if (!cb) return null;
          const isActive = tab.tabId === activeTabId;
          return (
            <div
              key={tab.tabId}
              className={clsx(
                'absolute inset-0 flex flex-col',
                isActive ? 'visible' : 'invisible pointer-events-none'
              )}
              aria-hidden={!isActive}
            >
              <ChatSession
                siteId={siteId}
                site={site}
                tabId={tab.tabId}
                conversationId={tab.conversationId}
                onToggleSidebar={onToggleSidebar}
                modelName={modelName}
                onConversationChange={cb.onConversationChange}
                onTitleChange={cb.onTitleChange}
                onActiveChange={(change, results) => {
                  // Sólo propagamos el activeChange del session visible.
                  if (isActive) onActiveChange?.(change, results);
                }}
                onPendingChanges={cb.onPendingChanges}
                onNewTab={cb.onNewTab}
              />
            </div>
          );
        })}
        {tabs.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-text-muted text-sm">
            Sin conversaciones abiertas.
          </div>
        )}
      </div>
    </div>
  );
});

ChatTabs.displayName = 'ChatTabs';

/**
 * TabBar — strip horizontal con las tabs abiertas + botón "+".
 *
 * UX:
 *   - Cada tab es un Button con variant="soft" si está activa, "ghost" si no.
 *   - El ícono X de cierre se pinta rojo en hover.
 *   - El botón + se deshabilita cuando se alcanza el tope.
 *   - El strip hace overflow-x: auto cuando hay más tabs que las que caben.
 */
function TabBar({
  tabs,
  activeTabId,
  maxTabs,
  onActivate,
  onClose,
  onNew,
}: {
  tabs: Tab[];
  activeTabId: string | null;
  maxTabs: number;
  onActivate: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onNew: () => void;
}) {
  const atLimit = tabs.length >= maxTabs;
  return (
    <div
      className="flex items-center gap-1 px-2 py-1.5 bg-panel border-b border-panel-border overflow-x-auto"
      role="tablist"
      aria-label="Conversaciones abiertas"
    >
      {tabs.map((tab) => {
        const isActive = tab.tabId === activeTabId;
        const title = tab.title || TAB_TITLE_NEW;
        return (
          <button
            key={tab.tabId}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onActivate(tab.tabId)}
            className={clsx(
              'group inline-flex items-center gap-1.5 h-7 px-2.5 rounded-card text-xs transition flex-shrink-0 max-w-[200px]',
              isActive
                ? 'bg-accent-soft text-accent font-medium'
                : 'text-text-muted hover:bg-surface hover:text-text'
            )}
            title={title}
          >
            {tab.status === 'loading' ? (
              <Loader2 size={11} className="animate-spin flex-shrink-0" />
            ) : (
              <MessageSquare size={11} className="flex-shrink-0" />
            )}
            <span className="truncate">{title}</span>
            <span
              role="button"
              aria-label={`Cerrar ${title}`}
              tabIndex={-1}
              onClick={(e) => {
                e.stopPropagation();
                onClose(tab.tabId);
              }}
              className={clsx(
                'flex-shrink-0 inline-flex items-center justify-center w-4 h-4 rounded-sm',
                'opacity-60 hover:opacity-100',
                'hover:bg-danger-soft hover:text-danger',
                'transition'
              )}
            >
              <X size={11} />
            </span>
          </button>
        );
      })}
      <button
        type="button"
        onClick={onNew}
        disabled={atLimit}
        aria-label="Nueva tab de conversación"
        title={atLimit ? `Máximo ${maxTabs} tabs abiertas` : 'Nueva tab'}
        className={clsx(
          'inline-flex items-center justify-center w-7 h-7 rounded-card transition flex-shrink-0',
          'text-text-muted hover:bg-surface hover:text-text',
          'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent'
        )}
      >
        <Plus size={14} />
      </button>
    </div>
  );
}
