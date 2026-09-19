'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Menu, ExternalLink } from 'lucide-react';
import { ChatTabs, type ChatTabsHandle } from '@/components/ChatTabs';
import { AppShell } from '@/components/AppShell';
import { AppSidebar } from '@/components/AppSidebar';
import { useModelNameFromEnv } from '@/components/RightPanel';
import { sitesApi } from '@/lib/api';
import type { Site, Change } from '@/lib/types';

interface ActiveChangeInfo {
  change: Change | null;
  results: Array<{ tool: string; status: string; retries: number; error?: { message: string } }>;
}

function SitePageInner() {
  const params = useParams();
  const siteId = params?.siteId as string;
  const searchParams = useSearchParams();
  const modelName = useModelNameFromEnv();
  const [site, setSite] = useState<Site | null>(null);
  const [pendingChanges, setPendingChanges] = useState<Change[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Drawer lateral en mobile/tablet (<lg). En >=lg el sidebar está siempre
  // visible como columna en el grid del AppShell.
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeChange, setActiveChange] = useState<ActiveChangeInfo>({
    change: null,
    results: [],
  });
  // Lee ?c= de la URL. ChatTabs lo usa para abrir/activar la tab correspondiente.
  const initialConversationId = searchParams.get('c') ?? undefined;

  /**
   * Ref imperativa a `<ChatTabs>`. La usamos para abrir tabs desde el sidebar
   * sin pasar por el ciclo effect→URL→effect (más directo y sin parpadeos).
   */
  const chatTabsRef = useRef<ChatTabsHandle>(null);

  // Cierra el drawer cuando el viewport cruza el breakpoint lg (1024px)
  // para que el sidebar quede en su posición normal del grid.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia('(min-width: 1024px)');
    const onChange = (e: MediaQueryListEvent) => {
      if (e.matches) setSidebarOpen(false);
    };
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  async function load() {
    try {
      const s = await sitesApi.get(siteId);
      setSite(s);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    if (siteId) load();
  }, [siteId]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface p-8">
        <div className="bg-panel border border-panel-border rounded-card p-6 max-w-md text-center">
          <p className="text-danger font-medium mb-2">Error</p>
          <p className="text-sm text-text-muted">{error}</p>
        </div>
      </div>
    );
  }

  if (!site) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface">
        <p className="text-text-muted">Cargando...</p>
      </div>
    );
  }

  return (
    <AppShell
      sidebar={
        <AppSidebar
          siteId={siteId}
          mode="column"
          pendingChanges={pendingChanges}
          onOpenConversation={(convId) => chatTabsRef.current?.openConversation(convId)}
        />
      }
      main={
        <div className="flex flex-col h-screen min-h-0">
          {/* Header (sitio + breadcrumb + versiones). */}
          <header className="flex items-center gap-3 px-4 md:px-6 py-3 border-b border-panel-border bg-panel">
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden flex items-center justify-center h-8 w-8 rounded-card text-text-muted hover:bg-surface"
              aria-label="Abrir navegación"
              aria-expanded={sidebarOpen}
            >
              <Menu size={16} />
            </button>
            <Link
              href="/"
              className="text-sm text-text-muted hover:text-text transition"
            >
              ← Sitios
            </Link>
            <div className="min-w-0 flex-1">
              <h1 className="text-base font-semibold text-text truncate">{site.name}</h1>
              <a
                href={site.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-text-muted hover:text-accent truncate inline-flex items-center gap-1"
              >
                {site.url}
                <ExternalLink size={10} />
              </a>
            </div>
            <div className="hidden md:block text-xs text-text-faint whitespace-nowrap">
              WP {site.wordpress_version} · Elementor {site.elementor_version}
            </div>
          </header>

          {/* ChatTabs ocupa el resto. Cada tab es una conversación independiente
              con su propio state (input, mensajes, adjuntos). La API imperativa
              (openConversation) la expone vía ref para que el sidebar pueda
              activar/crear tabs sin pasar por la URL. */}
          <ChatTabs
            ref={chatTabsRef}
            siteId={siteId}
            site={site}
            initialConversationId={initialConversationId}
            onToggleSidebar={() => setSidebarOpen((o) => !o)}
            modelName={modelName}
            onPendingChanges={setPendingChanges}
            onActiveChange={(change, results) => setActiveChange({ change, results })}
          />
        </div>
      }
    />
  );
}

export default function SitePage() {
  // useSearchParams requiere Suspense en Next.js 14 app router.
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-surface">
          <p className="text-text-muted">Cargando...</p>
        </div>
      }
    >
      <SitePageInner />
    </Suspense>
  );
}