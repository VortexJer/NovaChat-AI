// Vuelca la estructura real de un .docx: estilos de parrafo, texto, tablas.
// Sin dependencias: un .docx es un zip y basta con leer word/document.xml.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const ruta = process.argv[2];
if (!ruta) {
  console.error('uso: node leer_docx.mjs <archivo.docx>');
  process.exit(1);
}

// Se descomprime con Python, que esta siempre a mano en esta maquina y evita
// meter una dependencia solo para esto.
const xml = execFileSync(
  'python',
  [
    '-c',
    'import sys,zipfile;sys.stdout.buffer.write(zipfile.ZipFile(sys.argv[1]).read("word/document.xml"))',
    ruta,
  ],
  { maxBuffer: 64 * 1024 * 1024 },
).toString('utf8');

const desescapar = (s) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");

// Cada parrafo con su estilo y su texto.
const parrafos = [...xml.matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)].map((m) => {
  const cuerpo = m[1];
  const estilo = cuerpo.match(/<w:pStyle w:val="([^"]+)"/)?.[1] ?? '';
  const texto = [...cuerpo.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)]
    .map((t) => desescapar(t[1]))
    .join('');
  const negrita = /<w:b\/>|<w:b /.test(cuerpo);
  const lista = /<w:numPr>/.test(cuerpo);
  return { estilo, texto, negrita, lista };
});

const tablas = (xml.match(/<w:tbl>/g) || []).length;
const filasTabla = (xml.match(/<w:tr\b/g) || []).length;
const saltos = (xml.match(/<w:br w:type="page"\/>/g) || []).length;

console.log(`== ${ruta}`);
console.log(`parrafos=${parrafos.length} tablas=${tablas} filas_de_tabla=${filasTabla} saltos_pagina=${saltos}`);
console.log('');
for (const p of parrafos) {
  if (!p.texto.trim() && !p.estilo) continue;
  const marca = [p.estilo || '-', p.lista ? 'lista' : '', p.negrita ? 'negrita' : '']
    .filter(Boolean)
    .join(',');
  console.log(`  [${marca}] ${p.texto.slice(0, 130)}`);
}
