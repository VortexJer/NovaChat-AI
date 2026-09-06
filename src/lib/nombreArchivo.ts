/**
 * Nombre con el que guardar un bloque de codigo.
 *
 * La descarga del visor llamaba a todo "artefacto.html" pasara lo que pasara,
 * asi que bajar tres paginas seguidas dejaba tres archivos con el mismo nombre
 * pisandose en la carpeta. Y el nombre bueno casi siempre esta dentro del
 * propio contenido: el <title> de la pagina, el primer <h1>, o un comentario
 * de cabecera con la ruta del archivo.
 */

const EXT: Record<string, string> = {
  html: 'html',
  svg: 'svg',
  xml: 'xml',
  css: 'css',
  js: 'js',
  javascript: 'js',
  ts: 'ts',
  typescript: 'ts',
  jsx: 'jsx',
  tsx: 'tsx',
  json: 'json',
  py: 'py',
  python: 'py',
  sql: 'sql',
  sh: 'sh',
  bash: 'sh',
  yaml: 'yml',
  yml: 'yml',
  md: 'md',
  markdown: 'md',
  texto: 'txt',
};

/** Deja el texto apto para un nombre de archivo, sin acentos ni signos raros. */
function limpiar(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9 ._-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 60);
}

export function nombreDeCodigo(code: string, lang: string, titulo?: string): string {
  const ext = EXT[lang.toLowerCase()] ?? 'txt';

  // 1. El nombre que ya venia dado, si lo hay.
  // 2. Un comentario de cabecera con la ruta: "<!-- pagina.html -->", "// app.js".
  // 3. El <title> de la pagina.
  // 4. El primer <h1>.
  const cabecera = code.slice(0, 400).match(/(?:^|\n)\s*(?:<!--|\/\/|#|\/\*)\s*([\w.-]+\.[a-z]{2,4})\b/i)?.[1];
  const title = code.match(/<title[^>]*>([\s\S]{1,120}?)<\/title>/i)?.[1];
  const h1 = code.match(/<h1[^>]*>([\s\S]{1,120}?)<\/h1>/i)?.[1];

  const crudo = (titulo || cabecera || title || h1 || '').replace(/<[^>]+>/g, ' ').trim();
  const base = limpiar(crudo);
  if (!base) return `artefacto.${ext}`;

  // Si ya trae la extension correcta, no se le pone dos veces.
  return new RegExp(`\\.${ext}$`, 'i').test(base) ? base : `${base}.${ext}`;
}
