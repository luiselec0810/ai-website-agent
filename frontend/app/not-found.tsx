import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center p-8">
      <div className="bg-panel border border-border rounded-lg p-8 max-w-md text-center">
        <h1 className="text-2xl font-bold text-white mb-2">404 — Página no encontrada</h1>
        <p className="text-muted mb-6">
          La ruta que buscas no existe o fue movida.
        </p>
        <Link
          href="/"
          className="inline-block bg-accent text-white px-4 py-2 rounded hover:bg-orange-600 transition"
        >
          Volver al inicio
        </Link>
      </div>
    </div>
  );
}
