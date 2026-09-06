/**
 * Convierte un .pptx, .docx o .xlsx a PDF para poder MIRARLO.
 *
 * Nace de una tanda de defectos que no se veian leyendo el codigo y saltaron a
 * la primera al abrir el archivo: la etiqueta de seccion numerada dos veces
 * ("02 · 01 · PROBLEMA"), el titulo de la tarjeta numerado otra vez encima de
 * su propia insignia, y medio hueco vacio dentro de las tarjetas. Los tres
 * estaban en produccion y ninguno daba error.
 *
 * Es el paso que hacia falta: generar, convertir, y mirar el PDF.
 *
 *   node scripts/revisar.mjs "ruta/al/archivo.pptx"
 *
 * Necesita LibreOffice instalado. En Windows suele estar en
 * C:\Program Files\LibreOffice\program\soffice.exe; si no, se le puede pasar
 * la ruta en la variable SOFFICE.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

const entrada = process.argv[2];
if (!entrada) {
  console.error('uso: node scripts/revisar.mjs <archivo.pptx|docx|xlsx> [carpeta-salida]');
  process.exit(1);
}

const CANDIDATOS = [
  process.env.SOFFICE,
  'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
  'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
  '/usr/bin/soffice',
  '/usr/bin/libreoffice',
  '/Applications/LibreOffice.app/Contents/MacOS/soffice',
].filter(Boolean);

const soffice = CANDIDATOS.find((c) => existsSync(c));
if (!soffice) {
  console.error(
    'No se ha encontrado LibreOffice. Instalalo o indica la ruta en la variable SOFFICE.',
  );
  process.exit(1);
}

const origen = resolve(entrada);
if (!existsSync(origen)) {
  console.error(`No existe: ${origen}`);
  process.exit(1);
}

const salida = resolve(process.argv[3] ?? dirname(origen));
mkdirSync(salida, { recursive: true });

// --headless deja de escribir en stderr cosas que no son errores, asi que la
// salida se ignora y se comprueba el archivo, que es lo que importa.
try {
  execFileSync(soffice, ['--headless', '--convert-to', 'pdf', '--outdir', salida, origen], {
    stdio: 'pipe',
    timeout: 180_000,
  });
} catch (err) {
  console.error('LibreOffice ha fallado:', err.message);
  process.exit(1);
}

const pdf = join(salida, basename(origen).replace(/\.[^.]+$/, '.pdf'));
if (!existsSync(pdf)) {
  console.error('La conversion no ha dejado ningun PDF.');
  process.exit(1);
}

console.log(pdf);
console.log('\nAbrelo y mira, que es de lo que se trata. Lo que conviene comprobar:');
console.log('  · numeraciones repetidas (la insignia y el titulo diciendo lo mismo)');
console.log('  · texto que se sale de su caja o que queda pegado al borde');
console.log('  · huecos muertos: un tercio de diapositiva o media tarjeta en blanco');
console.log('  · contraste real del texto claro sobre el fondo');
