import type { Metadata, Viewport } from 'next';
import { JetBrains_Mono, Rajdhani } from 'next/font/google';

import './globals.css';

// Autoalojadas via next/font: se descargan en el build y se sirven desde el
// propio origen, sin peticion a Google Fonts en tiempo de ejecucion. Rajdhani
// viste toda la interfaz de alrededor (botones, cabeceras, chips); el cuerpo
// del chat sigue en la sans neutra del sistema para no forzar el tono
// "tecnico" dentro de textos largos. JetBrains Mono cubre codigo y datos.
const rajdhani = Rajdhani({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-rajdhani',
  display: 'swap',
});

const jbMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-jbmono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'NovaChat',
  description: 'Cliente de chat privado.',
  // Sin indexar: es una instalacion personal, no un sitio publico.
  robots: { index: false, follow: false },
  icons: { icon: '/icon.svg', apple: '/icon.svg' },
};

export const viewport: Viewport = {
  themeColor: '#0b0c0e',
  // El navegador movil no debe hacer zoom al enfocar el redactor, pero el
  // usuario si puede ampliar a mano: bloquearlo del todo rompe accesibilidad.
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${rajdhani.variable} ${jbMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
