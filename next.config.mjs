/** @type {import('next').NextConfig} */
const nextConfig = {
  // Empaqueta solo lo necesario: la imagen final pesa ~120 MB en vez de ~1 GB,
  // y el servidor arranca en ~80 MB de RAM, que es lo que hace que quepa en el
  // plan gratuito de Render donde LobeChat se quedaba sin memoria.
  output: 'standalone',

  // pdf.js se carga como paquete de Node, no empaquetado por webpack. Su
  // compilacion para Node resuelve piezas opcionales (fuentes, canvas) en
  // tiempo de ejecucion, y al meterla en el bundle esa resolucion se rompe: el
  // servidor de produccion fallaba al abrir cualquier PDF mientras en local
  // funcionaba. Como externo, la salida `standalone` se lo lleva tal cual.
  serverExternalPackages: ['pdfjs-dist'],

  // El rastreo de ficheros sigue los imports, y pdf.js no importa su worker:
  // lo carga por ruta en tiempo de ejecucion. Sin esta linea la imagen se
  // quedaba sin `pdf.worker.mjs` y cualquier PDF moria con "Setting up fake
  // worker failed".
  outputFileTracingIncludes: {
    '/api/**': ['./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'],
  },
  reactStrictMode: true,
  poweredByHeader: false,
};

export default nextConfig;
