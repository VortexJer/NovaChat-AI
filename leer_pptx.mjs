// Vuelca la estructura real de un .pptx: diapositivas, texto por forma,
// imagenes, tablas y notas del orador. Sin dependencias: es un zip.
import { execFileSync } from 'node:child_process';

const ruta = process.argv[2];
if (!ruta) {
  console.error('uso: node leer_pptx.mjs <archivo.pptx>');
  process.exit(1);
}

const py = (codigo) =>
  execFileSync('python', ['-c', codigo, ruta], { maxBuffer: 64 * 1024 * 1024 }).toString('utf8');

const listado = py(
  'import sys,zipfile\n' +
    'z=zipfile.ZipFile(sys.argv[1])\n' +
    'print("\\n".join(n for n in z.namelist()))',
)
  .split('\n')
  // Python en Windows escribe \r\n: sin recortarlo, cada nombre acaba en un
  // retorno de carro y el "$" de los patrones de abajo no casa nunca.
  .map((l) => l.trim())
  .filter(Boolean);

const slides = listado
  .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
  .sort((a, b) => Number(a.match(/(\d+)/)[1]) - Number(b.match(/(\d+)/)[1]));
const notas = listado.filter((n) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(n));
const medios = listado.filter((n) => n.startsWith('ppt/media/'));

const desescapar = (s) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"');

console.log(`== ${ruta}`);
console.log(`diapositivas=${slides.length} notas=${notas.length} medios=${medios.length}`);
if (medios.length) console.log(`   medios: ${medios.map((m) => m.split('/').pop()).join(', ')}`);
console.log('');

for (const s of slides) {
  const xml = py(
    'import sys,zipfile\n' +
      `sys.stdout.buffer.write(zipfile.ZipFile(sys.argv[1]).read(${JSON.stringify(s)}))`,
  );
  // Cada forma con su texto; se mira tambien si lleva relleno o es tabla.
  const formas = [...xml.matchAll(/<p:sp>([\s\S]*?)<\/p:sp>/g)].map((m) => {
    const parrafos = [...m[1].matchAll(/<a:p>([\s\S]*?)<\/a:p>/g)].map((pp) =>
      [...pp[1].matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((t) => desescapar(t[1])).join(''),
    );
    return parrafos.filter((t) => t.trim());
  });
  const tablas = (xml.match(/<a:tbl>/g) || []).length;
  const imagenes = (xml.match(/<p:pic>/g) || []).length;

  console.log(`-- ${s.split('/').pop()}  formas=${formas.length} tablas=${tablas} imagenes=${imagenes}`);
  for (const f of formas) {
    if (!f.length) continue;
    console.log(`     · ${f.join(' / ').slice(0, 145)}`);
  }
}
