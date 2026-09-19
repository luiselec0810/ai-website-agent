import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'AI Website Agent',
  description: 'Controla WordPress + Elementor con IA',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
