'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus, ArrowRight, Globe, X, ExternalLink } from 'lucide-react';
import clsx from 'clsx';
import { sitesApi } from '@/lib/api';
import type { Site } from '@/lib/types';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Pill } from '@/components/ui/Pill';
import { Skeleton } from '@/components/ui/Skeleton';

/**
 * Dashboard / home.
 *
 * Layout presentable:
 *   - Header con brand + CTA "+ Conectar sitio" arriba a la derecha.
 *   - Grid de cards de sitios (cuando hay) con hover `shadow-card-hover`.
 *   - Empty state con hero + form.
 *   - Form (toggle) con 3 inputs: nombre, url, apiKey.
 */
export default function HomePage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', url: '', apiKey: '' });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    try {
      setLoading(true);
      const data = await sitesApi.list();
      setSites(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleAddSite(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await sitesApi.create(form);
      setForm({ name: '', url: '', apiKey: '' });
      setShowForm(false);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-surface">
      <div className="max-w-5xl mx-auto p-6 md:p-10">
        {/* Header */}
        <header className="mb-8 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-text">
              AI Website Agent
            </h1>
            <p className="text-sm text-text-muted mt-1">
              Controla WordPress + Elementor con IA
            </p>
          </div>
          <Button
            variant={showForm ? 'ghost' : 'primary'}
            onClick={() => setShowForm((v) => !v)}
          >
            {showForm ? (
              <>
                <X size={14} />
                Cancelar
              </>
            ) : (
              <>
                <Plus size={14} />
                Conectar sitio
              </>
            )}
          </Button>
        </header>

        {/* Error global */}
        {error && (
          <div className="bg-danger-soft border border-danger/30 text-danger px-4 py-3 rounded-card mb-6 text-sm">
            {error}
          </div>
        )}

        {/* Form (toggle) */}
        {showForm && (
          <Card padding="lg" className="mb-8">
            <h2 className="text-lg font-semibold text-text mb-4">
              Conectar un sitio WordPress
            </h2>
            <form onSubmit={handleAddSite}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <label className="block text-sm text-text-muted mb-1">
                    Nombre del sitio
                  </label>
                  <input
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="Mi sitio de prueba"
                    required
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="block text-sm text-text-muted mb-1">
                    URL del sitio
                  </label>
                  <input
                    type="url"
                    value={form.url}
                    onChange={(e) => setForm({ ...form, url: e.target.value })}
                    placeholder="https://example.com"
                    required
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="block text-sm text-text-muted mb-1">
                    API Key (del plugin AI Website Bridge)
                  </label>
                  <input
                    type="password"
                    value={form.apiKey}
                    onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                    placeholder="aiw_..."
                    required
                    className={inputClass}
                  />
                </div>
              </div>
              <div className="mt-5 flex items-center gap-3">
                <Button type="submit" variant="primary" disabled={submitting}>
                  {submitting ? 'Probando…' : 'Probar y guardar'}
                </Button>
                <p className="text-xs text-text-faint">
                  Probamos la conexión contra el plugin antes de guardar.
                </p>
              </div>
            </form>
          </Card>
        )}

        {/* Lista de sitios / loading / empty */}
        {loading ? (
          <div className="grid gap-4 md:grid-cols-2">
            {[0, 1, 2].map((i) => (
              <Card key={i} padding="lg">
                <Skeleton className="h-5 w-40 mb-2" />
                <Skeleton className="h-3 w-56 mb-4" />
                <Skeleton className="h-3 w-32" />
              </Card>
            ))}
          </div>
        ) : sites.length === 0 ? (
          <EmptyState onAdd={() => setShowForm(true)} />
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {sites.map((site) => (
              <SiteCard key={site.id} site={site} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const inputClass = clsx(
  'w-full bg-surface text-text text-sm',
  'border border-panel-border rounded-card',
  'px-3 py-2 placeholder:text-text-faint',
  'focus:outline-none focus:border-accent focus:shadow-focus transition'
);

function SiteCard({ site }: { site: Site }) {
  const initials = site.name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <Link
      href={`/sites/${site.id}`}
      className="block group focus:outline-none focus-visible:shadow-focus rounded-card"
    >
      <Card
        padding="lg"
        className="hover:shadow-card-hover hover:border-accent/40 transition cursor-pointer h-full"
      >
        <div className="flex items-start gap-3">
          <div
            className="h-10 w-10 rounded-card bg-accent-soft text-accent flex items-center justify-center font-semibold flex-shrink-0"
            aria-hidden="true"
          >
            {initials || <Globe size={16} />}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-semibold text-text truncate">
              {site.name}
            </h3>
            <p className="text-xs text-text-muted truncate inline-flex items-center gap-1">
              {site.url}
              <ExternalLink size={10} className="flex-shrink-0" />
            </p>
          </div>
          <ArrowRight
            size={16}
            className="text-text-faint group-hover:text-accent transition flex-shrink-0"
          />
        </div>

        <div className="mt-4 flex items-center gap-2 text-xs">
          <Pill size="xs" variant="neutral">
            WP {site.wordpress_version ?? '—'}
          </Pill>
          <Pill size="xs" variant="neutral">
            Elementor {site.elementor_version ?? '—'}
          </Pill>
          {site.status === 'connected' && (
            <Pill size="xs" variant="success">
              Conectado
            </Pill>
          )}
        </div>
      </Card>
    </Link>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <Card padding="lg" className="text-center py-16">
      <div className="mx-auto h-14 w-14 rounded-card bg-accent-soft text-accent flex items-center justify-center mb-4">
        <Globe size={28} />
      </div>
      <h2 className="text-lg font-semibold text-text">
        No hay sitios conectados todavía
      </h2>
      <p className="text-sm text-text-muted mt-2 max-w-md mx-auto">
        Conectá tu primer sitio WordPress + Elementor para empezar a
        controlarlo con IA.
      </p>
      <div className="mt-6">
        <Button variant="primary" onClick={onAdd}>
          <Plus size={14} />
          Conectar primer sitio
        </Button>
      </div>
    </Card>
  );
}