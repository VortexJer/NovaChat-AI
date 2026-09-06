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
  manifest: '/manifest.webmanifest',
  applicationName: 'NovaChat',

  // Anadida a la pantalla de inicio del iPhone, la aplicacion abre a pantalla
  // completa y sin barra de Safari. `title` es lo que se lee debajo del icono:
  // sin esto iOS pone el <title> entero de la pagina, que cambia con cada
  // conversacion. La barra de estado translucida deja que el fondo de la
  // aplicacion suba hasta arriba del todo, y por eso hace falta respetar las
  // zonas seguras en el CSS.
  appleWebApp: {
    capable: true,
    title: 'NovaChat',
    statusBarStyle: 'black-translucent',
  },

  // iOS no acepta SVG en el icono de la pantalla de inicio: sin el PNG pone una
  // miniatura de la pagina. Se generan con `node scripts/iconos.mjs`.
  icons: {
    icon: [
      { url: '/icon.svg', type: 'image/svg+xml' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },

  formatDetection: { telephone: false },

  // Next solo emite el nombre moderno (`mobile-web-app-capable`), y Safari lee
  // el suyo de siempre para decidir si abre a pantalla completa: sin esta
  // linea, "Añadir a inicio" abre con la barra de Safari encima, que es
  // justamente lo que no queriamos.
  other: { 'apple-mobile-web-app-capable': 'yes' },
};

export const viewport: Viewport = {
  themeColor: '#0b0c0e',
  // El navegador movil no debe hacer zoom al enfocar el redactor, pero el
  // usuario si puede ampliar a mano: bloquearlo del todo rompe accesibilidad.
  // (El zoom al enfocar se evita con 16px de fuente en el redactor, no
  // prohibiendolo.)
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  // Que la pagina llegue hasta debajo de la muesca y del indicador de inicio;
  // el hueco se recupera con `env(safe-area-inset-*)` donde hace falta.
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${rajdhani.variable} ${jbMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
