'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Search,
  MessageSquare,
  Library,
  Settings,
  Plus,
  FileText,
  ScrollText,
  X,
  Sparkles,
  ChevronDown,
} from 'lucide-react';
import clsx from 'clsx';
import { conversationsApi } from '@/lib/api';
import type { Conversation, Change } from '@/lib/types';
import { Section } from './ui/Section';
import { Button } from './ui/Button';
import { Pill } from './ui/Pill';
import { PageTree } from './PageTree';
import { AuditLog } from './AuditLog';
import { LibraryPanel } from './sidebar/LibraryPanel';
import { AppsPanel } from './sidebar/AppsPanel';

interface AppSidebarProps {
  siteId: string;
  /** Sidebar visible como columna (lg+) o como drawer (<lg). */
  mode?: 'column' | 'drawer';
  /** Estado de apertura del drawer (solo `mode === 'drawer'`). */
  open?: boolean;
  /** Cierra el drawer (click backdrop o botón ✕). */
  onClose?: () => void;
  /** Cambios pendientes (audit log). El padre los carga para que el sidebar los muestre. */
  pendingChanges?: Change[];
  /** Conteo de conversaciones (para el badge de "Chats"). */
  chatsCount?: number;
  /** Conteo de media (para el badge de "Library"). Si no se pasa, se recalcula
   * con la longitud real del listado una vez que `LibraryPanel` termine de cargar. */
  libraryCount?: number;
  /** Conteo de sitios conectados (para el badge de "Apps"). */
  appsCount?: number;
  /**
   * Callback opcional al click en una conversación de la lista CHATS. Si se
   * provee, el `<Link>` se reemplaza por un `<button>` que invoca este callback
   * en lugar de navegar. Lo usa `<ChatTabs>` para abrir/activar tabs sin pasar
   * por el ciclo effect→URL→effect. Si es `undefined`, se usa el comportamiento
   * legacy (`<Link href="/sites/{id}?c={convId}">`).
   */
  onOpenConversation?: (convId: string) => void;
}

/**
 * AppSidebar — sidebar estilo Ciphy consolidado.
 *
 * Estructura (de arriba a abajo):
 *   1. Brand: ícono cuadrado morado + "AI Website Agent".
 *   2. Search bar con `⌘K` shortcut indicator (decorativo; no implementado).
 *   3. Nav con disclosures: Chats (con badge), Library (con badge),
 *      Apps (con badge). Chats muestra las últimas conversaciones inline
 *      al abrirse; Library/Apps cargan sus panels dedicados.
 *   4. Sección PINNED — placeholder.
 *   5. Sección PAGES — `<PageTree>` reubicado.
 *   6. Sección PENDING CHANGES — `<AuditLog>` reubicado.
 *   7. Footer: botón "+ Nueva conversación".
 *
 * Modos:
 *   - `column` (default): el padre lo inyecta en el `<AppShell>` slot `sidebar`.
 *     Visible solo en `lg+` (controlado por el grid del shell). El `<aside>`
 *     tiene `hidden lg:flex`.
 *   - `drawer`: el padre lo monta fuera del shell como overlay. Se muestra
 *     cuando `open === true`. En `md+` sigue siendo drawer (la página puede
 *     elegir ocultarlo al cruzar el breakpoint si quiere sidebar visible).
 *
 * El componente cierra el drawer cuando el viewport cruza `lg` (>=1024px)
 * para que no quede abierto al volver al desktop.
 */
export function AppSidebar({
  siteId,
  mode = 'column',
  open = false,
  onClose,
  pendingChanges = [],
  chatsCount,
  libraryCount = 0,
  appsCount = 0,
  onOpenConversation,
}: AppSidebarProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentConvId = searchParams?.get('c') ?? undefined;
  const [conversations, setConversations] = useState<Conversation[]>([]);
  // Estado del disclosure para "Chats", "Library" y "Apps". Independientes:
  // el usuario puede abrir uno, abrir otro (cierra implícitamente al
  // montar/ocultar los panels) o ninguno. Cuando el sidebar se vuelve a
  // montar (cambio de sitio), arrancan cerrados.
  const [disclosure, setDisclosure] = useState<{
    chatsOpen: boolean;
    libraryOpen: boolean;
    appsOpen: boolean;
  }>({
    chatsOpen: false,
    libraryOpen: false,
    appsOpen: false,
  });

  // Cargar conversaciones para la sección CHATS.
  useEffect(() => {
    let cancelled = false;
    conversationsApi
      .list(siteId, { limit: 10 })
      .then((res) => {
        if (!cancelled) setConversations(res);
      })
      .catch((err) => {
        console.error('[AppSidebar] failed to load conversations:', err);
      });
    return () => {
      cancelled = true;
    };
  }, [siteId]);

  // Auto-close del drawer cuando el viewport cruza lg.
  useEffect(() => {
    if (mode !== 'drawer' || !open) return;
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia('(min-width: 1024px)');
    const onChange = (e: MediaQueryListEvent) => {
      if (e.matches) onClose?.();
    };
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [mode, open, onClose]);

  const startNewConversation = () => {
    // Navegar a la página del sitio sin ?c= → Chat limpiará y arrancará nueva.
    router.push(`/sites/${siteId}`);
    onClose?.();
  };

  const totalChats = chatsCount ?? conversations.length;

  const content = (
    <div className="flex flex-col h-full">
      {/* Header: brand + close (only drawer) */}
      <div className="flex items-center gap-2 px-3 pt-4 pb-3">
        <div className="h-8 w-8 rounded-card bg-accent flex items-center justify-center flex-shrink-0">
          <Sparkles size={16} className="text-white" />
        </div>
        <span className="text-sm font-semibold text-text truncate">
          AI Website Agent
        </span>
        {mode === 'drawer' && (
          <button
            onClick={onClose}
            className="ml-auto text-text-muted hover:text-text p-1 rounded hover:bg-surface"
            aria-label="Cerrar panel"
          >
            <X size={16} />
          </button>
        )}
      </div>

      {/* Search bar + ⌘K */}
      <div className="px-3 pb-3">
        <div className="relative flex items-center">
          <Search
            size={14}
            className="absolute left-2.5 text-text-faint pointer-events-none"
          />
          <input
            type="text"
            placeholder="Buscar conversaciones…"
            className={clsx(
              'w-full bg-surface text-text text-sm',
              'border border-panel-border rounded-card',
              'pl-8 pr-12 py-1.5',
              'placeholder:text-text-faint',
              'focus:outline-none focus:border-accent/60 focus:shadow-focus transition'
            )}
            aria-label="Buscar conversaciones"
          />
          <kbd className="absolute right-2 px-1.5 py-0.5 text-[10px] font-mono text-text-faint bg-panel border border-panel-border rounded">
            ⌘K
          </kbd>
        </div>
      </div>

      {/* Main nav */}
      <nav className="px-3 pb-3 flex flex-col gap-0.5">
        <DisclosureNavItem
          icon={<MessageSquare size={14} />}
          label="Chats"
          badge={totalChats}
          open={disclosure.chatsOpen}
          onToggle={() =>
            setDisclosure((d) => ({ ...d, chatsOpen: !d.chatsOpen }))
          }
        >
          {disclosure.chatsOpen && (
            <ul className="py-1">
              {conversations.length === 0 ? (
                <li className="text-xs text-text-faint px-2 py-1">
                  No hay conversaciones aún.
                </li>
              ) : (
                conversations.map((c) => {
                  const isActive = c.id === currentConvId;
                  const linkClassName = clsx(
                    'flex items-center gap-2 px-2 py-1.5 rounded-card text-sm transition',
                    isActive
                      ? 'bg-accent-soft text-accent font-medium'
                      : 'text-text-muted hover:bg-surface hover:text-text'
                  );
                  const inner = (
                    <>
                      <MessageSquare size={12} className="flex-shrink-0" />
                      <span className="truncate">
                        {c.preview || c.title || '(sin título)'}
                      </span>
                    </>
                  );
                  // Si el padre inyectó `onOpenConversation`, preferimos el
                  // callback (más directo: ChatTabs abre/activa la tab sin
                  // pasar por effect→URL→effect). Si no, caemos al `<Link>`
                  // legacy para preservar compat con sitios sin tabs.
                  if (onOpenConversation) {
                    return (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => {
                            onOpenConversation(c.id);
                            onClose?.();
                          }}
                          className={clsx(linkClassName, 'w-full text-left')}
                          title={c.preview ?? c.title}
                        >
                          {inner}
                        </button>
                      </li>
                    );
                  }
                  return (
                    <li key={c.id}>
                      <Link
                        href={`/sites/${siteId}?c=${c.id}`}
                        onClick={onClose}
                        className={linkClassName}
                        title={c.preview ?? c.title}
                      >
                        {inner}
                      </Link>
                    </li>
                  );
                })
              )}
            </ul>
          )}
        </DisclosureNavItem>
        <DisclosureNavItem
          icon={<Library size={14} />}
          label="Library"
          badge={libraryCount}
          open={disclosure.libraryOpen}
          onToggle={() =>
            setDisclosure((d) => ({ ...d, libraryOpen: !d.libraryOpen }))
          }
        >
          {/*
            Importante: NO gateamos con `disclosure.libraryOpen && …` porque
            eso desmontaría el componente y dispararía un fetch nuevo cada
            vez que se abre el disclosure. Lo dejamos siempre montado; el
            contenedor padre del `DisclosureNavItem` aplica `max-h-0
            overflow-hidden` cuando está cerrado, así que es free el fetch
            hasta que el usuario lo abra por primera vez (data lista
            cuando hace click).
          */}
          <LibraryPanel siteId={siteId} />
        </DisclosureNavItem>
        <DisclosureNavItem
          icon={<Settings size={14} />}
          label="Apps"
          badge={appsCount}
          open={disclosure.appsOpen}
          onToggle={() =>
            setDisclosure((d) => ({ ...d, appsOpen: !d.appsOpen }))
          }
        >
          {disclosure.appsOpen && (
            <AppsPanel currentSiteId={siteId} onNavigate={onClose} />
          )}
        </DisclosureNavItem>
      </nav>

      {/* Scrollable region: pinned + pages + pending */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-3 space-y-4">
        <Section title="Pinned">
          <p className="text-xs text-text-faint px-2 py-1">
            Nada pineado todavía.
          </p>
        </Section>

        <Section title="Pages">
          <PageTree siteId={siteId} compact />
        </Section>

        <Section title="Pending changes">
          <AuditLog changes={pendingChanges} compact />
        </Section>
      </div>

      {/* Footer CTA */}
      <div className="p-3 border-t border-panel-border">
        <Button
          variant="soft"
          size="md"
          className="w-full"
          onClick={startNewConversation}
          aria-label="Iniciar una conversación nueva"
        >
          <Plus size={14} />
          Nueva conversación
        </Button>
      </div>
    </div>
  );

  if (mode === 'column') {
    return (
      <aside
        className="hidden lg:flex bg-panel border-r border-panel-border flex-col w-[260px] h-screen sticky top-0"
        aria-label="Navegación principal"
      >
        {content}
      </aside>
    );
  }

  // Drawer mode (overlay). Renderizamos condicionalmente — el padre controla `open`.
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 lg:hidden">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Navegación principal"
        className={clsx(
          'absolute left-0 top-0 bottom-0 w-72 max-w-[85vw]',
          'bg-panel border-r border-panel-border',
          'flex flex-col shadow-popover'
        )}
      >
        {content}
      </aside>
    </div>
  );
}

/**
 * NavItem — fila de navegación principal con `<Link>` (navega a una ruta).
 * Usado por "Chats" → `/` (dashboard).
 */
function NavItem({
  href,
  icon,
  label,
  badge,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  badge?: number;
}) {
  return (
    <Link
      href={href}
      className={clsx(
        'flex items-center gap-2 px-2 py-1.5 rounded-card text-sm',
        'text-text-muted hover:bg-surface hover:text-text transition'
      )}
    >
      <span className="text-text-muted">{icon}</span>
      <span className="flex-1">{label}</span>
      {badge !== undefined && badge > 0 && (
        <Pill size="xs" variant="neutral">
          {badge}
        </Pill>
      )}
    </Link>
  );
}

/**
 * DisclosureNavItem — fila de navegación con patrón disclosure.
 *
 * A diferencia de `NavItem`, NO navega: el click solo togglea `open`.
 * Cuando `open` es true, renderiza los `children` debajo del botón
 * (sub-panel colapsable). Usado para "Library" y "Apps" en el sidebar.
 *
 * El botón usa `aria-expanded` para a11y. El chevron rota 180° según
 * el estado. La zona clickeable es toda la fila para affordance claro.
 */
function DisclosureNavItem({
  icon,
  label,
  badge,
  open,
  onToggle,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  badge?: number;
  open: boolean;
  onToggle: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={`disclosure-${label.toLowerCase()}`}
        className={clsx(
          'flex items-center gap-2 px-2 py-1.5 rounded-card text-sm w-full text-left',
          'text-text-muted hover:bg-surface hover:text-text transition',
          open && 'bg-surface text-text'
        )}
      >
        <span className={clsx(open ? 'text-accent' : 'text-text-muted')}>
          {icon}
        </span>
        <span className="flex-1">{label}</span>
        {badge !== undefined && badge > 0 && (
          <Pill size="xs" variant="neutral">
            {badge}
          </Pill>
        )}
        <ChevronDown
          size={12}
          className={clsx(
            'text-text-faint transition-transform',
            open && 'rotate-180 text-text-muted'
          )}
        />
      </button>
      <div
        id={`disclosure-${label.toLowerCase()}`}
        className={clsx('overflow-hidden', open ? 'mt-1' : 'max-h-0')}
        role="region"
        aria-label={`${label} panel`}
        aria-hidden={!open}
      >
        {children}
      </div>
    </div>
  );
}

// Re-exports para consumidores que quieran importar los átomos desde aquí.
export { FileText, ScrollText };