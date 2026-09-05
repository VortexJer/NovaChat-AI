/**
 * Saca el texto de un archivo para poder usarlo como contexto de un proyecto.
 *
 * Lo que se le da al modelo es texto, asi que guardar el binario original no
 * serviria de nada: aqui se extrae al subirlo y se guarda ya convertido.
 *
 * La regla es aceptar todo lo que se pueda leer y decirlo claro cuando no se
 * puede, en vez de mantener una lista blanca de extensiones: un `.env`, un
 * `Makefile` o un `.conf` son texto perfectamente valido y rechazarlos por no
 * estar en una lista es absurdo.
 */
import ExcelJS from 'exceljs';
import JSZip from 'jszip';

/** Atajo para lo que seguro que es texto. Lo que no este aqui se decide mirando el contenido. */
const TEXT_EXT =
  /\.(txt|md|markdown|csv|tsv|json|jsonl|ndjson|ya?ml|xml|html?|css|scss|jsx?|tsx?|mjs|cjs|py|ipynb|java|c|cc|cpp|cxx|h|hpp|cs|go|rs|rb|php|swift|kt|kts|scala|dart|lua|pl|r|sh|bash|zsh|ps1|sql|ini|cfg|conf|toml|log|env|tex|rst|adoc|vue|svelte|graphql|gql|proto|prisma|dockerfile|makefile|gitignore|lock)$/i;

export class UnsupportedFile extends Error {}

export async function extractText(name: string, buffer: Buffer): Promise<string> {
  const lower = name.toLowerCase();

  if (TEXT_EXT.test(lower)) return buffer.toString('utf8');

  if (lower.endsWith('.docx')) return fromDocx(buffer);
  if (lower.endsWith('.pptx')) return fromPptx(buffer);
  if (lower.endsWith('.xlsx')) return fromXlsx(buffer);
  if (lower.endsWith('.odt') || lower.endsWith('.odp') || lower.endsWith('.ods')) return fromOpenDocument(buffer);
  if (lower.endsWith('.pdf')) return fromPdf(buffer);

  // Antes de rendirse: si el contenido parece texto legible, se acepta aunque
  // la extension sea rara o no tenga.
  if (looksLikeText(buffer.subarray(0, 4000).toString('utf8'))) return buffer.toString('utf8');

  throw new UnsupportedFile(
    `No se puede leer "${name}": no es texto ni un formato conocido. Si es una imagen o un audio, aqui no hay forma de sacarle texto.`,
  );
}

/**
 * ¿Esto es texto?
 *
 * Se mira la proporcion de bytes de control y del caracter de reemplazo que
 * deja un UTF-8 mal decodificado. Un binario los tiene a puñados; un archivo
 * de configuracion raro, ninguno.
 */
function looksLikeText(sample: string): boolean {
  if (!sample) return false;
  let raros = 0;
  for (const ch of sample) {
    const c = ch.codePointAt(0)!;
    if (c === 0xfffd || c < 9 || (c > 13 && c < 32)) raros++;
  }
  return raros / sample.length < 0.02;
}

/**
 * El texto de un PDF, pagina a pagina.
 *
 * Se usa pdf.js, el mismo motor con el que los navegadores enseñan PDFs, en su
 * compilacion para Node. Se desactivan fuentes y evaluacion porque aqui no se
 * dibuja nada: solo hace falta la capa de texto.
 *
 * Un PDF escaneado no tiene capa de texto — son imagenes — asi que sale vacio
 * y se avisa, en vez de guardar una nota en blanco que al modelo no le sirve.
 */
async function fromPdf(buffer: Buffer): Promise<string> {
  // Import dinamico: pdf.js es grande y solo hace falta cuando alguien sube un
  // PDF, no en cada arranque del servidor.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    disableFontFace: true,
    isEvalSupported: false,
    useSystemFonts: false,
  }).promise;

  const paginas: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    // pdf.js entrega fragmentos sueltos; `hasEOL` marca donde acaba la linea.
    let texto = '';
    for (const item of content.items) {
      const it = item as { str?: string; hasEOL?: boolean };
      if (typeof it.str !== 'string') continue;
      texto += it.str + (it.hasEOL ? '\n' : '');
    }
    const limpio = texto.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    if (limpio) paginas.push(`--- Pagina ${i} ---\n${limpio}`);
  }

  if (!paginas.length) {
    throw new UnsupportedFile(
      'Ese PDF no tiene capa de texto: parece escaneado, y aqui no hay reconocimiento optico.',
    );
  }
  return paginas.join('\n\n');
}

/** El cuerpo del .docx: un salto de linea por cada parrafo. */
async function fromDocx(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file('word/document.xml')?.async('string');
  if (!xml) throw new UnsupportedFile('El .docx no tiene cuerpo legible.');

  return stripTags(xml, /<\/w:p>/g);
}

/** Los de LibreOffice y OpenOffice: mismo truco, otro nombre de archivo dentro. */
async function fromOpenDocument(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file('content.xml')?.async('string');
  if (!xml) throw new UnsupportedFile('El documento no tiene cuerpo legible.');

  return stripTags(xml, /<\/text:p>/g);
}

/**
 * Convierte un XML de Office en texto.
 *
 * Quita **todas** las etiquetas en vez de extraer solo los nodos de texto.
 * Extraerlos parecia mas limpio pero filtraba marcado crudo en cuanto el
 * documento tenia una tabla — visto probandolo con un .docx real, que escupia
 * `<w:tblPr>...` en medio del texto. Quitar etiquetas no puede filtrar
 * marcado por construccion.
 */
function stripTags(xml: string, paragraphEnd: RegExp): string {
  return xml
    .replace(paragraphEnd, '\n')
    .replace(/<[^>]*>/g, '')
    .split('\n')
    .map((line) => unescapeXml(line).replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

/** Una diapositiva por bloque, en orden. */
async function fromPptx(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const slides = Object.keys(zip.files)
    .filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
    // slide10 va despues de slide9, no antes: hay que ordenar por numero.
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));

  const out: string[] = [];
  for (const [i, path] of slides.entries()) {
    const xml = (await zip.file(path)?.async('string')) ?? '';
    const text = stripTags(xml, /<\/a:p>/g);
    if (text.trim()) out.push(`--- Diapositiva ${i + 1} ---\n${text}`);
  }
  return out.join('\n\n');
}

/** Las hojas como texto separado por tabuladores: es lo que mejor lee un modelo. */
async function fromXlsx(buffer: Buffer): Promise<string> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);

  const out: string[] = [];
  wb.eachSheet((sheet) => {
    const lines: string[] = [`--- Hoja "${sheet.name}" ---`];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell) => {
        const v = cell.value;
        cells.push(
          v && typeof v === 'object' && 'formula' in v
            ? `=${(v as { formula: string }).formula}`
            : String(v ?? ''),
        );
      });
      if (cells.some((c) => c.trim())) lines.push(cells.join('\t'));
    });
    if (lines.length > 1) out.push(lines.join('\n'));
  });
  return out.join('\n\n');
}

const unescapeXml = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

/**
 * El aviso que se le enseña a la persona cuando un archivo no se ha podido
 * leer. Un "no se ha podido leer" a secas no dice nada: ni a quien lo sube, ni
 * a quien tiene que arreglarlo. Asi que el motivo real va al log del servidor y
 * un resumen corto va al aviso.
 */
export function readFailure(name: string, err: unknown): string {
  if (err instanceof UnsupportedFile) return err.message;

  const motivo = err instanceof Error ? err.message : String(err);
  console.error(`[extract] ${name}:`, err);
  return `No se ha podido leer "${name}": ${motivo.slice(0, 160)}`;
}
