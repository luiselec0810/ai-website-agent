'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { sitesApi } from '@/lib/api';
import type { Site } from '@/lib/types';

/**
 * Lista de sitios en `/sites` (sin siteId).
 *
 * Next.js solo reconocía `/sites/[siteId]` antes de esta página — acceder
 * a `/sites` solo mostraba un 404 o pantalla en blanco según el orden de
 * build. Esta página hace de "index" de sitios para que cualquier
 * navegación al path `/sites` (sin id) renderice la lista, en lugar
 * de romper.
 */
export default function SitesIndexPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await sitesApi.list();
        if (!cancelled) setSites(data);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen p-8 max-w-5xl mx-auto">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">Sitios conectados</h1>
          <p className="text-muted mt-1">
            Elige un sitio para abrir su chat, o{' '}
            <Link href="/" className="text-accent hover:text-orange-300">
              añade uno nuevo
            </Link>
            .
          </p>
        </div>
        <Link
          href="/"
          className="bg-accent text-white px-4 py-2 rounded-lg hover:bg-orange-600 transition"
        >
          ← Inicio
        </Link>
      </header>

      {error && (
        <div className="bg-red-900 border border-red-700 text-red-100 px-4 py-3 rounded mb-6">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-muted">Cargando sitios…</p>
      ) : sites.length === 0 ? (
        <div className="text-center py-16 text-muted">
          <p className="text-xl mb-2">No hay sitios conectados todavía.</p>
          <p>
            <Link href="/" className="text-accent hover:text-orange-300">
              Conecta tu primer sitio WordPress
            </Link>
            .
          </p>
        </div>
      ) : (
        <ul className="grid gap-4">
          {sites.map((site) => (
            <li key={site.id}>
              <Link
                href={`/sites/${site.id}`}
                className="block bg-panel border border-border rounded-lg p-6 hover:border-accent transition"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-white">{site.name}</h3>
                    <p className="text-sm text-muted">{site.url}</p>
                  </div>
                  <div className="text-right text-sm text-muted">
                    <p>WP {site.wordpress_version ?? '—'}</p>
                    <p>Elementor {site.elementor_version ?? '—'}</p>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
