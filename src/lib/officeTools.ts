/**
 * Generacion de documentos de oficina.
 *
 * NO usa las skills docx/pptx/xlsx que publica Anthropic en
 * github.com/anthropics/skills: esas cuatro (docx, pptx, xlsx, pdf) llevan
 * licencia propietaria — su LICENSE.txt prohibe expresamente "extraer estos
 * materiales de los Servicios" y "distribuirlos a terceros", asi que
 * vendorizarlas en un producto ajeno como NovaChat las incumpliria.
 *
 * Lo que si es reutilizable, porque es de terceros bajo licencia MIT y
 * publico independientemente de Anthropic, son las mismas librerias de npm
 * que esas skills usan por debajo: `docx` para Word, y sus equivalentes
 * `pptxgenjs` para PowerPoint y `exceljs` para Excel. La logica de aqui es
 * propia.
 */

import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from 'docx';
import ExcelJS from 'exceljs';
import PptxGenJS from 'pptxgenjs';

export type GeneratedFile = { buffer: Buffer; name: string; mime: string; kind: 'docx' | 'pptx' | 'xlsx' };

const safeName = (title: string, ext: string) =>
  `${(title.trim() || 'documento').replace(/[^\p{L}\p{N} _-]/gu, '').slice(0, 60)}.${ext}`;

// --- Word --------------------------------------------------------------

/**
 * Paleta y medidas calcadas de un .docx real de claude.ai (desunzipeado y su
 * document.xml leido directamente): azul marino para titulos y cabeceras de
 * tabla en vez del rojo de marca de NovaChat — un informe que se va a
 * imprimir o mandar fuera no tiene por que llevar la identidad visual de la
 * app que lo genero, tiene que verse como un documento profesional.
 */
const DOCX_NAVY = '1F3864';
const DOCX_MUTED = '595959';
const DOCX_BORDER = 'BFBFBF';

const HEADING_SIZES: Record<number, number> = { 1: 30, 2: 26, 3: 24 }; // en semipuntos: 15/13/12pt

const cellBorder = { style: BorderStyle.SINGLE, size: 4, color: DOCX_BORDER };
const TABLE_BORDERS = {
  top: cellBorder,
  bottom: cellBorder,
  left: cellBorder,
  right: cellBorder,
  insideHorizontal: cellBorder,
  insideVertical: cellBorder,
};

/**
 * Convierte un Markdown sencillo a bloques de Word (parrafos y tablas).
 *
 * Solo el subconjunto que un modelo va a producir de forma natural al
 * redactar un documento: encabezados (#, ##, ###), listas con guion o
 * asterisco, negrita, tablas con sintaxis de barras verticales, y parrafos
 * sueltos. No es un parser de Markdown completo a proposito — cuanto mas
 * simple, menos formas de que un modelo pequeno del router produzca algo
 * que lo rompa.
 */
function markdownToBlocks(markdown: string): (Paragraph | Table)[] {
  const blocks: (Paragraph | Table)[] = [];
  const lines = markdown.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Tabla: una fila de cabecera, una fila separadora (|---|---|), y N filas
    // de datos — la misma sintaxis de tabla que usa markdown en todos sitios.
    if (isTableRow(line) && isTableSeparator(lines[i + 1]?.trim() ?? '')) {
      const header = parseTableCells(line);
      let j = i + 2;
      const rows: string[][] = [];
      while (j < lines.length && isTableRow(lines[j].trim())) {
        rows.push(parseTableCells(lines[j].trim()));
        j++;
      }
      blocks.push(buildTable(header, rows));
      i = j - 1;
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const headingLevel = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3][level - 1];
      blocks.push(
        new Paragraph({
          heading: headingLevel,
          spacing: { before: 320, after: 160 },
          children: runsFrom(heading[2], { bold: true, color: DOCX_NAVY, size: HEADING_SIZES[level] }),
        }),
      );
      continue;
    }

    const bullet = /^[-*]\s+(.*)/.exec(line);
    if (bullet) {
      blocks.push(new Paragraph({ bullet: { level: 0 }, children: runsFrom(bullet[1]) }));
      continue;
    }

    blocks.push(new Paragraph({ spacing: { after: 200, line: 276 }, children: runsFrom(line) }));
  }

  return blocks;
}

const isTableRow = (line: string) => /^\|.*\|$/.test(line);
const isTableSeparator = (line: string) => /^\|(\s*:?-+:?\s*\|)+$/.test(line);
const parseTableCells = (line: string) =>
  line.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

/** Ancho util de la caja de texto en twips: A4 (11906) menos los dos margenes de 1134. */
const CONTENT_WIDTH = 9638;

/**
 * Reparte el ancho de la tabla segun lo que ocupa cada columna en vez de a
 * partes iguales: si no, una columna de fechas cortas se lleva el mismo
 * espacio que una de descripciones y estas rompen en tres lineas al lado de
 * un hueco vacio. El peso se acota por arriba y por abajo para que una celda
 * larga suelta no se coma la tabla entera.
 *
 * Devuelve twips, no porcentajes: con `tblLayout` fijo lo que Word respeta es
 * la rejilla (`w:tblGrid`), y esa solo se puede fijar pasando anchos absolutos
 * a la tabla — los porcentajes por celda se ignoran.
 */
function columnWidths(header: string[], rows: string[][]): number[] {
  const weights = header.map((h, i) => {
    const body = Math.max(...rows.map((r) => (r[i] ?? '').length), 1);
    // La cabecera marca el minimo: una columna de valores cortos ("Alto",
    // "Baja") no puede quedar mas estrecha que su propio titulo (que ademas va en negrita) o es el titulo
    // el que parte en dos lineas, que es justo lo que peor se ve.
    return Math.max(h.length + 4, Math.min(body, 34));
  });
  const total = weights.reduce((a, b) => a + b, 0);
  const widths = weights.map((w) => Math.round((w / total) * CONTENT_WIDTH));
  // Cuadra el redondeo en la columna mas ancha para que sumen el ancho exacto.
  const drift = CONTENT_WIDTH - widths.reduce((a, b) => a + b, 0);
  widths[widths.indexOf(Math.max(...widths))] += drift;
  return widths;
}

/** Tabla con cabecera en azul marino y texto blanco, bordes grises finos — el mismo patron que usa claude.ai. */
function buildTable(header: string[], rows: string[][]): Table {
  const widths = columnWidths(header, rows);
  const margins = { top: 100, bottom: 100, left: 120, right: 120 };

  const headerRow = new TableRow({
    tableHeader: true,
    children: header.map(
      (text, i) =>
        new TableCell({
          width: { size: widths[i], type: WidthType.DXA },
          margins,
          shading: { fill: DOCX_NAVY, type: ShadingType.CLEAR, color: 'auto' },
          verticalAlign: VerticalAlign.CENTER,
          children: [new Paragraph({ children: runsFrom(text, { bold: true, color: 'FFFFFF' }) })],
        }),
    ),
  });

  const bodyRows = rows.map(
    (row) =>
      new TableRow({
        children: header.map(
          (_, i) =>
            new TableCell({
              width: { size: widths[i], type: WidthType.DXA },
              margins,
              verticalAlign: VerticalAlign.CENTER,
              children: [new Paragraph({ children: runsFrom(row[i] ?? '') })],
            }),
        ),
      }),
  );

  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    // Sin FIXED, Word reajusta los anchos por su cuenta e ignora el reparto.
    layout: TableLayoutType.FIXED,
    columnWidths: widths,
    borders: TABLE_BORDERS,
    rows: [headerRow, ...bodyRows],
  });
}

/** Trocea una linea en TextRun, aplicando negrita a los tramos **entre asteriscos dobles** y las propiedades base a todos los tramos. */
function runsFrom(text: string, base: { bold?: boolean; color?: string; size?: number } = {}): TextRun[] {
  return text
    .split(/(\*\*[^*]+\*\*)/g)
    .filter(Boolean)
    .map((part) =>
      part.startsWith('**') && part.endsWith('**')
        ? new TextRun({ ...base, text: part.slice(2, -2), bold: true })
        : new TextRun({ ...base, text: part }),
    );
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Igual que runsFrom pero para HTML: negrita entre ** una vez escapado el texto. */
function inlineHtml(text: string): string {
  return escapeHtml(text).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

/**
 * Vista previa en HTML del mismo Markdown que markdownToBlocks convierte a
 * .docx real — no es el documento, es una maqueta ligera para enseñar en el
 * panel de artefactos sin tener que abrir el archivo descargado, al estilo
 * del panel que claude.ai muestra junto a la tarjeta de archivo. Usa la misma
 * paleta que el .docx (azul marino, gris de bordes) para que lo que se ve
 * aqui y lo que se abre en Word sean el mismo documento.
 */
export function wordPreviewHtml(title: string, markdown: string, subtitle?: string): string {
  const body: string[] = [];
  let list: string[] | null = null;
  const flushList = () => {
    if (list) {
      body.push(`<ul>${list.map((li) => `<li>${li}</li>`).join('')}</ul>`);
      list = null;
    }
  };

  const lines = markdown.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) {
      flushList();
      continue;
    }

    if (isTableRow(line) && isTableSeparator(lines[i + 1]?.trim() ?? '')) {
      flushList();
      const header = parseTableCells(line);
      let j = i + 2;
      const rows: string[][] = [];
      while (j < lines.length && isTableRow(lines[j].trim())) {
        rows.push(parseTableCells(lines[j].trim()));
        j++;
      }
      const head = header.map((c) => `<th>${inlineHtml(c)}</th>`).join('');
      const cells = rows
        .map((r) => `<tr>${header.map((_, k) => `<td>${inlineHtml(r[k] ?? '')}</td>`).join('')}</tr>`)
        .join('');
      body.push(`<table><thead><tr>${head}</tr></thead><tbody>${cells}</tbody></table>`);
      i = j - 1;
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)/.exec(line);
    if (heading) {
      flushList();
      const level = heading[1].length + 1; // # de markdown -> h2..h4, deja h1 para el titulo
      body.push(`<h${level}>${inlineHtml(heading[2])}</h${level}>`);
      continue;
    }
    const bullet = /^[-*]\s+(.*)/.exec(line);
    if (bullet) {
      list ??= [];
      list.push(inlineHtml(bullet[1]));
      continue;
    }
    flushList();
    body.push(`<p>${inlineHtml(line)}</p>`);
  }
  flushList();

  return `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;padding:48px 56px;background:#e9e9ea;font-family:Calibri,Carlito,'Segoe UI',sans-serif}
    .page{max-width:700px;margin:0 auto;background:#fff;color:#1a1a1a;padding:56px 64px;box-shadow:0 2px 20px rgba(0,0,0,.25);min-height:80vh}
    h1{font-size:26px;margin:0 0 6px;font-weight:700;color:#1F3864;border-bottom:2px solid #1F3864;padding-bottom:8px}
    .subtitle{font-size:13.5px;font-style:italic;color:#595959;margin:0 0 26px}
    h2{font-size:18px;margin:26px 0 9px;color:#1F3864}
    h3{font-size:15.5px;margin:22px 0 8px;color:#1F3864}
    h4{font-size:14px;margin:18px 0 6px;color:#1F3864}
    p{font-size:14px;line-height:1.6;margin:0 0 11px}
    ul{margin:0 0 12px;padding-left:22px}
    li{font-size:14px;line-height:1.6;margin-bottom:4px}
    strong{font-weight:700}
    table{border-collapse:collapse;width:100%;margin:6px 0 18px}
    th,td{border:1px solid #BFBFBF;padding:6px 9px;text-align:left;font-size:13px;line-height:1.45;vertical-align:middle}
    th{background:#1F3864;color:#fff;font-weight:700;border-color:#1F3864}
  </style><div class="page"><h1>${inlineHtml(title)}</h1>${
    subtitle ? `<p class="subtitle">${inlineHtml(subtitle)}</p>` : ''
  }${body.join('')}</div>`;
}

/**
 * Vista previa en HTML de una presentacion: una diapositiva por pantalla,
 * apiladas — con la misma maquetacion que el .pptx real que genera
 * `createPresentation` (portada oscura con indice de secciones, contenido
 * sobre blanco con tarjetas de insignia numerada y franja de cierre), no una
 * lista de vinetas simplificada.
 */
export function pptxPreviewHtml(
  title: string,
  subtitle: string | undefined,
  slides: SlideSpec[],
  theme?: Partial<PptxTheme>,
): string {
  const t = paletteFrom(theme);
  const sections = slides.map((s) => s.seccion).filter((x): x is string => Boolean(x));
  const chips =
    sections.length >= 2
      ? `<div class="chips">${sections
          .slice(0, 5)
          .map((n, i) => `<span class="chip"><b>${String(i + 1).padStart(2, '0')}</b> ${inlineHtml(n)}</span>`)
          .join('')}</div>`
      : '';

  const cover = `
    <section class="cover">
      <div class="blob blob-a"></div>
      <div class="blob blob-b"></div>
      <p class="eyebrow">PRESENTACIÓN</p>
      <h2>${inlineHtml(title)}</h2>
      <div class="bar"></div>
      ${subtitle ? `<p class="subtitle">${inlineHtml(subtitle)}</p>` : ''}
      ${chips}
      <p class="meta">${slides.length + 1} diapositivas</p>
    </section>`;

  const rest = slides
    .map((s, i) => {
      const label = s.seccion ? escapeHtml(s.seccion.toUpperCase()) : '';
      const eyebrow = `${String(i + 1).padStart(2, '0')}${label ? ` · ${label}` : ''}`;
      const accent = `a${i % 3}`;

      if (s.tipo === 'seccion') {
        return `
    <section class="divider">
      <span class="bignum ${accent}">${String(i + 1).padStart(2, '0')}</span>
      <div>
        ${label ? `<p class="eyebrow ${accent}-t">${label}</p>` : ''}
        <h2>${inlineHtml(s.titulo)}</h2>
      </div>
    </section>`;
      }

      if (s.cita || s.tipo === 'cita') {
        const q = s.cita ?? { texto: s.titulo, autor: undefined };
        return `
    <section class="quote">
      <span class="mark ${accent}-t">&ldquo;</span>
      <blockquote>${inlineHtml(q.texto)}</blockquote>
      ${q.autor ? `<p class="author">— ${inlineHtml(q.autor)}</p>` : ''}
    </section>`;
      }

      const hasChart = Boolean(s.grafico && s.grafico.categorias.length);
      const stat = s.destacado;
      const max = hasChart || stat ? 3 : s.tipo === 'comparacion' ? 2 : 4;
      const points = s.puntos.slice(0, max);

      const callout = s.callout
        ? `<div class="callout"><span class="badge ${accent}">${escapeHtml(
            initials(s.callout.titulo),
          )}</span><div><p class="co-title ${accent}-t">${inlineHtml(
            s.callout.titulo,
          )}</p><p class="ptext">${inlineHtml(s.callout.texto)}</p></div></div>`
        : '';

      const statHtml = stat
        ? `<div class="stat"><p class="stat-v">${inlineHtml(stat.valor)}</p><p class="ptext">${inlineHtml(
            stat.texto,
          )}</p></div>`
        : '';

      const chart = s.grafico
        ? `<div class="chart"><p class="charttitle">${inlineHtml(s.grafico.titulo)}</p>${s.grafico.categorias
            .map(
              (c, ci) =>
                `<div class="bar-row"><span>${inlineHtml(c)}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.min(100, (s.grafico!.valores[ci] / Math.max(...s.grafico!.valores)) * 100)}%"></div></div><b>${s.grafico!.valores[ci]}</b></div>`,
            )
            .join('')}</div>`
        : '';

      const body =
        s.tipo === 'comparacion'
          ? `<div class="cards compare">${points
              .map(
                (p, pi) =>
                  `<div class="col"><p class="band a${pi % 3}">${inlineHtml(
                    p.titulo,
                  )}</p><p class="coltext">${inlineHtml(p.texto)}</p></div>`,
              )
              .join('')}</div>`
          : `<div class="cards${hasChart || stat ? ' stacked' : ''}${
              s.tipo === 'proceso' ? ' flow' : ''
            }">${points
              .map(
                (p, pi) => `<div class="card">
            <span class="cardtop"><span class="badge a${pi % 3}">${String(pi + 1).padStart(2, '0')}</span>${
                  p.etiqueta ? `<span class="pill a${pi % 3}-t a${pi % 3}-b">${escapeHtml(p.etiqueta.toUpperCase())}</span>` : ''
                }</span>
            <p class="ptitle">${inlineHtml(p.titulo)}</p>
            <p class="ptext">${inlineHtml(p.texto)}</p>
          </div>`,
              )
              .join('')}</div>`;

      return `
    <section class="content">
      <p class="eyebrow">${eyebrow}</p>
      <h2>${inlineHtml(s.titulo)}</h2>
      ${callout}
      <div class="body${hasChart || stat ? ' split' : ''}">
        ${chart}
        ${body}
        ${statHtml}
      </div>
      ${s.cierre ? `<p class="closing">${inlineHtml(s.cierre)}</p>` : ''}
    </section>`;
    })
    .join('');

  return `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;background:#0a0a0b;font-family:Calibri,Carlito,'Segoe UI',sans-serif}
    section{aspect-ratio:16/9;max-width:920px;margin:0 auto 2px;padding:4.5% 5%;
      box-sizing:border-box;position:relative;overflow:hidden;display:flex;flex-direction:column}
    .cover{background:#${t.ink};color:#${t.onDark};justify-content:center}
    .blob{position:absolute;border-radius:50%;pointer-events:none}
    .blob-a{width:31%;height:55%;right:-4%;top:-19%;background:#${t.accents[0]};opacity:.45}
    .blob-b{width:18.5%;height:33%;right:-2%;top:10%;background:#${t.accents[1] ?? t.accents[0]};opacity:.4}
    .eyebrow{margin:0 0 2%;font-size:clamp(8px,1vw,10px);font-weight:700;letter-spacing:.16em;color:#${t.accent}}
    .cover h2{font-family:Georgia,'Times New Roman',serif;font-size:clamp(19px,3.4vw,34px);margin:0;
      font-weight:700;max-width:74%;line-height:1.08}
    .bar{width:52px;height:4px;background:#${t.accent};margin:2.4% 0 1.6%}
    .subtitle{font-size:clamp(10px,1.3vw,13px);color:#${t.onDarkMuted};margin:0;max-width:72%}
    .chips{display:flex;gap:1.4%;margin-top:auto}
    .chip{flex:1;border:1px solid rgba(247,247,251,.25);background:rgba(247,247,251,.06);border-radius:4px;
      padding:1.1% 0;text-align:center;font-size:clamp(7px,.95vw,9.5px);color:#${t.onDark};
      overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .chip b{color:#${t.accent}}
    .meta{margin:2.2% 0 0;font-size:clamp(7px,.9vw,9px);color:#${t.onDarkMuted}}
    .content{background:#fff;color:#2b2b33}
    .content h2{font-family:Georgia,'Times New Roman',serif;font-size:clamp(14px,2.4vw,24px);
      margin:0 0 3%;color:#${t.ink};line-height:1.05}
    .body{flex:1;display:flex;gap:2.4%;min-height:0}
    .cards{flex:1;display:flex;gap:2.4%;min-width:0}
    .cards.stacked{flex-direction:column;flex:0 0 46%;gap:1.8%}
    .card{flex:1;background:#f4f4f8;border:1px solid #e4e4ec;border-radius:6px;padding:3.5% 4%;
      box-sizing:border-box;min-width:0;display:flex;flex-direction:column}
    .cards.stacked .card{flex-direction:column}
    .badge{display:inline-flex;align-items:center;justify-content:center;width:2.4em;height:2.4em;
      border-radius:50%;color:#fff;font-weight:700;font-size:clamp(8px,1.05vw,11px);flex:none}
    .a0{background:#${t.accents[0]}}.a1{background:#${t.accents[1] ?? t.accents[0]}}.a2{background:#${t.accents[2] ?? t.accents[0]}}
    .ptitle{font-family:Georgia,'Times New Roman',serif;font-weight:700;color:#${t.ink};
      font-size:clamp(10px,1.5vw,14px);margin:8% 0 4%;line-height:1.15}
    .ptext{margin:0;font-size:clamp(8px,1.1vw,10.5px);line-height:1.45;color:#6b6b78}
    .chart{flex:0 0 48%;display:flex;flex-direction:column;justify-content:center;gap:6px;min-width:0}
    .charttitle{margin:0 0 4px;font-size:clamp(8px,1.05vw,10.5px);font-weight:700;color:#2b2b33}
    .bar-row{display:flex;align-items:center;gap:7px;font-size:clamp(7px,1vw,10px);color:#2b2b33}
    .bar-row span{flex:0 0 34%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:right}
    .bar-track{flex:1;height:9px;background:#eeeef4}
    .bar-fill{height:100%;background:#${t.accents[0]}}
    .bar-row b{flex:none;font-size:clamp(7px,1vw,10px)}
    .closing{margin:2.6% 0 0;background:#${t.ink};color:#${t.onDark};border-radius:4px;padding:1.5% 2%;
      font-size:clamp(8px,1.1vw,11px)}
    .divider{background:#${t.ink};color:#${t.onDark};flex-direction:row;align-items:center;gap:4%}
    .bignum{font-family:Georgia,'Times New Roman',serif;font-size:clamp(38px,7vw,72px);font-weight:700;
      line-height:1;padding-right:4%;border-right:1px solid rgba(169,166,196,.5)}
    .divider h2{font-family:Georgia,'Times New Roman',serif;font-size:clamp(15px,2.8vw,28px);margin:2% 0 0;
      color:#${t.onDark};line-height:1.06}
    .quote{background:#${t.ink};color:#${t.onDark};justify-content:center;padding:6% 8%}
    .mark{font-family:Georgia,serif;font-size:clamp(30px,6vw,60px);line-height:.7;font-weight:700}
    blockquote{font-family:Georgia,'Times New Roman',serif;font-style:italic;margin:3% 0 0;
      font-size:clamp(13px,2.2vw,22px);line-height:1.25}
    .author{margin:4% 0 0;font-size:clamp(8px,1.1vw,11px);color:#${t.onDarkMuted}}
    .a0-t{color:#${t.accents[0]}}.a1-t{color:#${t.accents[1] ?? t.accents[0]}}.a2-t{color:#${t.accents[2] ?? t.accents[0]}}
    .a0-b{border-color:#${t.accents[0]}}.a1-b{border-color:#${t.accents[1] ?? t.accents[0]}}.a2-b{border-color:#${t.accents[2] ?? t.accents[0]}}
    .callout{display:flex;gap:2%;align-items:flex-start;background:#f4f4f8;border:1px solid #e4e4ec;
      border-radius:6px;padding:2% 2.4%;margin-bottom:2.4%}
    .co-title{margin:0 0 1.5%;font-weight:700;font-size:clamp(9px,1.2vw,11.5px)}
    .cardtop{display:flex;align-items:center;gap:6px}
    .pill{border:1px solid;border-radius:4px;padding:2px 6px;font-size:clamp(6px,.8vw,7.5px);
      font-weight:700;letter-spacing:.08em;white-space:nowrap}
    .cards.flow .card+.card{position:relative}
    .cards.flow .card+.card::before{content:'';position:absolute;left:-1.6%;top:50%;width:0;height:0;
      border-left:6px solid #e4e4ec;border-top:4px solid transparent;border-bottom:4px solid transparent}
    .cards.flow{gap:3.2%}
    .cards.compare{gap:2.8%}
    .col{flex:1;background:#f4f4f8;border:1px solid #e4e4ec;border-radius:6px;overflow:hidden;min-width:0}
    .band{margin:0;padding:2.4% 3.5%;color:#fff;font-weight:700;font-size:clamp(9px,1.3vw,12.5px)}
    .band.a0{background:#${t.accents[0]}}.band.a1{background:#${t.accents[1] ?? t.accents[0]}}.band.a2{background:#${t.accents[2] ?? t.accents[0]}}
    .coltext{margin:0;padding:3.5%;font-size:clamp(8px,1.1vw,11px);line-height:1.45;color:#2b2b33}
    .stat{flex:0 0 34%;background:#f4f4f8;border:1px solid #e4e4ec;border-radius:6px;padding:3% 3.4%;
      align-self:flex-start}
    .stat-v{font-family:Georgia,'Times New Roman',serif;font-weight:700;color:#${t.accent};margin:0 0 4%;
      font-size:clamp(18px,3.4vw,34px);line-height:1}
  </style>${cover}${rest}`;
}

/**
 * Vista previa en HTML de una hoja de calculo, con la misma lectura que el
 * archivo real: bloque de titulo, cabecera azul marino, celdas de entrada en
 * amarillo frente a las calculadas, fila de totales destacada y las notas al
 * pie. Una celda con formula se enseña con su formula (con "=" delante, como
 * en Excel) en vez del valor — no hay motor de calculo aqui para mostrar el
 * resultado real, asi que fingir un numero seria mentir.
 */
export function xlsxPreviewHtml(
  name: string,
  columns: ColumnSpec[],
  rows: CellValue[][],
  subtitle?: string,
  notes?: string[],
): string {
  const head = columns.map((c) => `<th>${escapeHtml(c.nombre)}</th>`).join('');
  const totalsIndex = isTotalsRow(rows) ? rows.length - 1 : -1;

  const body = rows
    .map((row, r) => {
      const cells = columns
        .map((col, i) => {
          const v = row[i];
          if (isFormula(v)) return `<td class="f">=${escapeHtml(v.formula)}</td>`;
          const cls = r !== totalsIndex && isInputCell(v, col) ? ' class="in"' : '';
          return `<td${cls}>${escapeHtml(cellText(v ?? ''))}</td>`;
        })
        .join('');
      return `<tr${r === totalsIndex ? ' class="total"' : ''}>${cells}</tr>`;
    })
    .join('');

  const notesHtml = notes?.length
    ? `<div class="notes"><b>Notas y supuestos</b><ul>${notes
        .slice(0, 8)
        .map((n) => `<li>${inlineHtml(n)}</li>`)
        .join('')}</ul></div>`
    : '';

  return `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;padding:26px 22px;background:#fff;color:#2b2b33;
      font-family:Calibri,Carlito,'Segoe UI',sans-serif;font-size:13px}
    h1{font-size:18px;margin:0 0 4px;color:#1F3864}
    .sub{margin:0 0 3px;font-style:italic;font-size:11.5px;color:#595959}
    .legend{margin:0 0 16px;font-style:italic;font-size:11.5px;color:#595959}
    table{border-collapse:collapse}
    th,td{border:1px solid #BFBFBF;padding:5px 9px;text-align:left;white-space:nowrap;font-size:12.5px}
    th{background:#1F3864;color:#fff;font-weight:700;position:sticky;top:0}
    td.in{background:#FFFFCC;color:#0000FF}
    td.f{font-family:Consolas,'Courier New',monospace;font-size:12px;font-weight:700}
    tr.total td{background:#D9E2F3;font-weight:700;border-top:2px solid #1F3864}
    tr.total td:first-child{color:#1F3864}
    .notes{margin-top:18px;font-size:11.5px;color:#595959}
    .notes ul{margin:4px 0 0;padding-left:18px}
    .notes li{margin-bottom:3px}
  </style><h1>${escapeHtml(name)}</h1>${
    subtitle ? `<p class="sub">${inlineHtml(subtitle)}</p>` : ''
  }${
    rows.some((row) => row.some((v, i) => isInputCell(v, columns[i])))
      ? '<p class="legend">Leyenda: celdas en azul sobre fondo amarillo = datos que puedes editar. Texto en negro = formulas, no tocar.</p>'
      : ''
  }<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>${notesHtml}`;
}

export async function createWordDocument(
  title: string,
  markdown: string,
  subtitle?: string,
): Promise<GeneratedFile> {
  const head: (Paragraph | Table)[] = [
    new Paragraph({
      alignment: AlignmentType.LEFT,
      spacing: { after: subtitle ? 120 : 360 },
      // La regla bajo el titulo es un borde del parrafo, no una tabla ni una
      // linea de guiones: asi se mueve con el titulo si el texto reflowea.
      border: { bottom: { style: BorderStyle.SINGLE, size: 12, space: 6, color: DOCX_NAVY } },
      children: [new TextRun({ text: title, bold: true, color: DOCX_NAVY, size: 44 })],
    }),
  ];

  if (subtitle) {
    head.push(
      new Paragraph({
        spacing: { after: 360 },
        children: [new TextRun({ text: subtitle, italics: true, color: DOCX_MUTED, size: 22 })],
      }),
    );
  }

  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: 'Calibri', size: 22 } },
      },
    },
    sections: [
      {
        properties: { page: { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } },
        children: [...head, ...markdownToBlocks(markdown)],
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  return {
    buffer,
    name: safeName(title, 'docx'),
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    kind: 'docx',
  };
}

// --- PowerPoint ----------------------------------------------------------

/**
 * Cada diapositiva es una etiqueta de seccion ("eyebrow"), un titulo, y una
 * lista de puntos con su propia mini-cabecera y texto — no una lista plana de
 * vinetas. Es la misma forma que produce claude.ai de verdad (comprobado
 * desunzipeando un .pptx suyo real: bloques numerados con mini-titulo +
 * explicacion, nunca una vineta suelta), y lo que permite que cada punto se
 * lea como una tarjeta en vez de una linea de texto plana.
 */
export type SlidePoint = {
  titulo: string;
  texto: string;
  /** Pildora de color al pie de la tarjeta: la categoria del punto en una o dos palabras. */
  etiqueta?: string;
};
export type SlideChart = { titulo: string; categorias: string[]; valores: number[] };

/**
 * Maqueta de la diapositiva.
 *
 * Existe porque una baraja en la que todas las diapositivas son la misma
 * rejilla de tarjetas se lee como una plantilla rellenada, por bien dibujada
 * que este cada una. El .pptx real de claude.ai cambia de forma casi en cada
 * pagina — un dato enorme, una definicion destacada, pasos encadenados, dos
 * columnas que se comparan — y eso es lo que hace que se siga.
 */
export type SlideLayout = 'tarjetas' | 'proceso' | 'comparacion' | 'seccion' | 'cita';

export type SlideSpec = {
  /** Etiqueta corta de seccion ("INTRODUCCION"). Si falta, no se muestra numero de seccion. */
  seccion?: string;
  titulo: string;
  puntos: SlidePoint[];
  /** Como se dibujan los puntos. Por defecto, tarjetas en columnas. */
  tipo?: SlideLayout;
  /** Barra de un solo grafico, opcional — para el punto con un dato que vale la pena visualizar. */
  grafico?: SlideChart;
  /** Un numero grande con su explicacion, sobre los puntos: el dato que resume la diapositiva. */
  destacado?: { valor: string; texto: string };
  /** Caja destacada bajo el titulo, con insignia: una definicion o el contexto que hace falta antes de los puntos. */
  callout?: { titulo: string; texto: string };
  /** Diapositiva de cita a pagina completa, en oscuro. Sustituye a los puntos. */
  cita?: { texto: string; autor?: string };
  /** Notas del orador: van al panel de notas real de PowerPoint (Ver > Notas), no a la diapositiva. */
  notas?: string;
  /** Frase de remate en una franja al pie: la conclusion que se saca de los puntos, no un resumen de ellos. */
  cierre?: string;
};

/**
 * Paleta y maquetacion calcadas de un .pptx real de claude.ai (desunzipeado y
 * ademas renderizado a PDF con LibreOffice para mirarlo diapositiva a
 * diapositiva). Tres cosas de ese archivo son las que marcaban la diferencia
 * y aqui estan replicadas: portada oscura pero **contenido sobre blanco**,
 * los puntos como tarjetas en columnas con una insignia numerada de color en
 * vez de una lista apilada, y una frase de cierre que remata la idea.
 *
 * El rojo de marca de NovaChat no se usa, por lo mismo que el .docx va en
 * azul marino: una presentacion que se proyecta fuera no tiene por que llevar
 * la identidad visual de la aplicacion que la genero.
 */
/**
 * Tema de la presentacion: lo elige el modelo, no esta escrito aqui.
 *
 * Antes la paleta era fija — siempre indigo, naranja y verde, siempre los
 * mismos dos circulos en la portada — asi que por bien maquetada que
 * estuviera, la herramienta rellenaba una plantilla en vez de diseñar. Es el
 * mismo error que la skill de web ya tenia corregido: el color tiene que
 * salir del tema del que va la presentacion, no de la aplicacion que la
 * genera.
 *
 * Lo que sigue fijo es la estructura de contraste — portada oscura con texto
 * claro, contenido oscuro sobre blanco — porque de eso depende que se lea
 * proyectado, y no es una decision estetica que convenga delegar.
 */
export type PptxTheme = {
  /** Fondo de la portada y de las franjas de cierre. Oscuro. */
  fondo: string;
  /** De dos a tres acentos, que rotan por tarjeta. El primero manda. */
  acentos: string[];
  /** Tratamiento decorativo de la portada. */
  portada: 'circulos' | 'diagonal' | 'lineas' | 'arco' | 'limpia';
  /** Familia de los titulares. */
  titulares: 'serif' | 'sans';
};

type Palette = {
  ink: string;
  onDark: string;
  onDarkMuted: string;
  accents: string[];
  accent: string;
  card: string;
  line: string;
  text: string;
  muted: string;
  serif: string;
  sans: string;
  cover: PptxTheme['portada'];
};

const DEFAULT_THEME: PptxTheme = {
  fondo: '1A1830',
  acentos: ['5B4BC4', 'E8663D', '2E7D5B'],
  portada: 'circulos',
  titulares: 'serif',
};

const HEX = /^[0-9A-Fa-f]{6}$/;
const hex = (v: string | undefined, fallback: string) =>
  typeof v === 'string' && HEX.test(v.replace('#', '')) ? v.replace('#', '').toUpperCase() : fallback;

/** Luminancia relativa aproximada, para decidir el texto sobre un fondo dado. */
function luminance(h: string): number {
  const n = parseInt(h, 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => c / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Mezcla hacia blanco (t=1) o hacia negro (t=-1). */
function mix(h: string, t: number): string {
  const n = parseInt(h, 16);
  const target = t > 0 ? 255 : 0;
  const k = Math.abs(t);
  const parts = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) =>
    Math.round(c + (target - c) * k),
  );
  return parts.map((c) => c.toString(16).padStart(2, '0')).join('').toUpperCase();
}

function paletteFrom(theme?: Partial<PptxTheme>): Palette {
  let ink = hex(theme?.fondo, DEFAULT_THEME.fondo);
  // Un "fondo" claro romperia la portada entera: se oscurece en vez de
  // rechazarlo, que da mejor resultado que ignorar lo que pidio el modelo.
  if (luminance(ink) > 0.35) ink = mix(ink, -0.72);

  const accents = (theme?.acentos ?? [])
    .map((a) => hex(a, ''))
    .filter(Boolean)
    .slice(0, 3);
  const finalAccents = accents.length ? accents : DEFAULT_THEME.acentos;

  const serif = theme?.titulares === 'sans' ? 'Calibri' : 'Georgia';

  return {
    ink,
    // El texto claro lleva un punto del propio fondo para que la portada se
    // vea de una pieza y no como texto blanco pegado encima.
    onDark: mix(ink, 0.94),
    onDarkMuted: mix(ink, 0.62),
    accents: finalAccents,
    accent: finalAccents[0],
    card: 'F4F4F8',
    line: 'E4E4EC',
    text: '2B2B33',
    muted: '6B6B78',
    serif,
    sans: 'Calibri',
    cover: theme?.portada ?? DEFAULT_THEME.portada,
  };
}

const SLIDE_W = 10;
const SLIDE_H = 5.63;
const MARGIN = 0.5;

/** Un titular largo tiene que encoger, no desbordarse encima de lo que lleva debajo. */
const titleSize = (text: string, big: number, small: number) =>
  text.length > 46 ? small : big;

export async function createPresentation(
  title: string,
  subtitle: string | undefined,
  slides: SlideSpec[],
  theme?: Partial<PptxTheme>,
): Promise<GeneratedFile> {
  const t = paletteFrom(theme);
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'NOVA_16x9', width: SLIDE_W, height: SLIDE_H });
  pptx.layout = 'NOVA_16x9';

  // --- Portada -----------------------------------------------------------
  const cover = pptx.addSlide();
  cover.background = { color: t.ink };

  drawCover(cover, pptx, t);

  cover.addText('PRESENTACIÓN', {
    x: MARGIN,
    y: 0.55,
    w: 6,
    fontSize: 10,
    bold: true,
    charSpacing: 3,
    color: t.accent,
    fontFace: t.sans,
  });

  // La caja del titulo termina en 2.95 y lo de debajo empieza en 3.05: asi un
  // titulo de tres lineas crece hacia arriba dentro de su caja en vez de
  // pisar la barra y el subtitulo, que es justo lo que pasaba antes.
  cover.addText(title, {
    x: MARGIN,
    y: 1.05,
    w: 7.4,
    h: 1.9,
    fontSize: titleSize(title, 34, 27),
    bold: true,
    color: t.onDark,
    fontFace: t.serif,
    valign: 'bottom',
    lineSpacingMultiple: 1.08,
  });
  cover.addShape(pptx.ShapeType.rect, {
    x: MARGIN,
    y: 3.1,
    w: 1.1,
    h: 0.055,
    fill: { color: t.accent },
    line: { color: t.accent, transparency: 100 },
  });
  if (subtitle) {
    cover.addText(subtitle, {
      x: MARGIN,
      y: 3.3,
      w: 7.2,
      h: 0.5,
      fontSize: 13,
      color: t.onDarkMuted,
      fontFace: t.sans,
      valign: 'top',
    });
  }

  // Indice de secciones en fichas, como el original: se ve de que va la
  // charla antes de pasar de diapositiva.
  const sections = slides.map((s) => s.seccion).filter((s): s is string => Boolean(s));
  if (sections.length >= 2) {
    const chips = sections.slice(0, 5);
    const gap = 0.14;
    const chipW = (SLIDE_W - MARGIN * 2 - gap * (chips.length - 1)) / chips.length;
    chips.forEach((name, i) => {
      const x = MARGIN + i * (chipW + gap);
      cover.addShape(pptx.ShapeType.roundRect, {
        x,
        y: 4.25,
        w: chipW,
        h: 0.5,
        rectRadius: 0.06,
        fill: { color: t.onDark, transparency: 88 },
        line: { color: t.onDark, transparency: 75 },
      });
      cover.addText(
        [
          { text: `${String(i + 1).padStart(2, '0')}  `, options: { bold: true, color: t.accent } },
          { text: name, options: { color: t.onDark } },
        ],
        {
          x,
          y: 4.25,
          w: chipW,
          h: 0.5,
          fontSize: 9.5,
          fontFace: t.sans,
          align: 'center',
          valign: 'middle',
        },
      );
    });
  }

  cover.addText(`${slides.length + 1} diapositivas`, {
    x: MARGIN,
    y: 5.05,
    w: 6,
    fontSize: 9,
    color: t.onDarkMuted,
    fontFace: t.sans,
  });

  // --- Diapositivas de contenido ----------------------------------------
  slides.forEach((slide, index) => {
    const s = pptx.addSlide();
    const sectionLabel = slide.seccion ? slide.seccion.toUpperCase() : '';
    const eyebrow = `${String(index + 1).padStart(2, '0')}${sectionLabel ? ` · ${sectionLabel}` : ''}`;
    const accent = t.accents[index % t.accents.length];

    // --- Separador de seccion: solo el numero y el nombre, en oscuro -------
    if (slide.tipo === 'seccion') {
      s.background = { color: t.ink };
      s.addText(String(index + 1).padStart(2, '0'), {
        x: MARGIN,
        y: 1.5,
        w: 2,
        h: 1.5,
        fontSize: 72,
        bold: true,
        color: accent,
        fontFace: t.serif,
        valign: 'middle',
      });
      s.addShape(pptx.ShapeType.rect, {
        x: MARGIN + 1.75,
        y: 1.72,
        w: 0.02,
        h: 1.06,
        fill: { color: t.onDarkMuted },
        line: { color: t.onDarkMuted, transparency: 100 },
      });
      if (sectionLabel) {
        s.addText(sectionLabel, {
          x: MARGIN + 2.05,
          y: 1.62,
          w: 7,
          fontSize: 10,
          bold: true,
          charSpacing: 3,
          color: accent,
          fontFace: t.sans,
        });
      }
      s.addText(slide.titulo, {
        x: MARGIN + 2.05,
        y: 1.9,
        w: 7,
        h: 1.1,
        fontSize: titleSize(slide.titulo, 30, 24),
        bold: true,
        color: t.onDark,
        fontFace: t.serif,
        valign: 'top',
        lineSpacingMultiple: 1.05,
      });
      if (slide.notas) s.addNotes(slide.notas);
      return;
    }

    // --- Cita a pagina completa -------------------------------------------
    if (slide.cita || slide.tipo === 'cita') {
      const quote = slide.cita ?? { texto: slide.titulo, autor: undefined };
      s.background = { color: t.ink };
      s.addText('“', {
        x: MARGIN - 0.06,
        y: 0.5,
        w: 1.2,
        h: 1,
        fontSize: 90,
        bold: true,
        color: accent,
        fontFace: t.serif,
      });
      s.addText(quote.texto, {
        x: MARGIN + 0.55,
        y: 1.35,
        w: SLIDE_W - MARGIN * 2 - 0.9,
        h: 2.5,
        fontSize: quote.texto.length > 150 ? 20 : 26,
        color: t.onDark,
        fontFace: t.serif,
        italic: true,
        valign: 'middle',
        lineSpacingMultiple: 1.2,
      });
      if (quote.autor) {
        s.addText(`— ${quote.autor}`, {
          x: MARGIN + 0.55,
          y: 4.1,
          w: 7,
          fontSize: 12,
          color: t.onDarkMuted,
          fontFace: t.sans,
        });
      }
      if (slide.notas) s.addNotes(slide.notas);
      return;
    }

    // --- Diapositivas de contenido, sobre blanco ---------------------------
    s.background = { color: 'FFFFFF' };
    s.addText(eyebrow, {
      x: MARGIN,
      y: 0.3,
      w: 9,
      fontSize: 9.5,
      bold: true,
      charSpacing: 2,
      color: t.accent,
      fontFace: t.sans,
    });
    s.addText(slide.titulo, {
      x: MARGIN,
      y: 0.54,
      w: 9,
      h: 0.82,
      fontSize: titleSize(slide.titulo, 24, 20),
      bold: true,
      color: t.ink,
      fontFace: t.serif,
      valign: 'top',
      lineSpacingMultiple: 1.05,
    });

    const hasChart = Boolean(slide.grafico && slide.grafico.categorias.length);
    const closing = slide.cierre?.trim();
    let top = 1.5;
    const bottom = closing ? 4.62 : 5.05;

    // Caja destacada bajo el titulo: definicion o contexto antes de los puntos.
    if (slide.callout) {
      const h = 0.92;
      s.addShape(pptx.ShapeType.roundRect, {
        x: MARGIN,
        y: top,
        w: SLIDE_W - MARGIN * 2,
        h,
        rectRadius: 0.06,
        fill: { color: t.card },
        line: { color: t.line, width: 1 },
      });
      s.addShape(pptx.ShapeType.ellipse, {
        x: MARGIN + 0.22,
        y: top + 0.24,
        w: 0.44,
        h: 0.44,
        fill: { color: accent },
        line: { color: accent },
      });
      s.addText(initials(slide.callout.titulo), {
        x: MARGIN + 0.22,
        y: top + 0.24,
        w: 0.44,
        h: 0.44,
        fontSize: 10,
        bold: true,
        color: 'FFFFFF',
        fontFace: t.sans,
        align: 'center',
        valign: 'middle',
      });
      s.addText(slide.callout.titulo, {
        x: MARGIN + 0.82,
        y: top + 0.14,
        w: SLIDE_W - MARGIN * 2 - 1.1,
        h: 0.26,
        fontSize: 11.5,
        bold: true,
        color: accent,
        fontFace: t.sans,
        valign: 'top',
      });
      s.addText(slide.callout.texto, {
        x: MARGIN + 0.82,
        y: top + 0.4,
        w: SLIDE_W - MARGIN * 2 - 1.1,
        h: h - 0.5,
        fontSize: 10.5,
        color: t.muted,
        fontFace: t.sans,
        valign: 'top',
        lineSpacingMultiple: 1.15,
      });
      top += h + 0.22;
    }

    // Dato grande: ocupa la franja de la derecha y las tarjetas se apilan al lado.
    const stat = slide.destacado;
    if (stat && !hasChart) {
      const w = 3.5;
      const h = 1.3;
      const x = SLIDE_W - MARGIN - w;
      s.addShape(pptx.ShapeType.roundRect, {
        x,
        y: top,
        w,
        h,
        rectRadius: 0.06,
        fill: { color: t.card },
        line: { color: t.line, width: 1 },
      });
      s.addText(stat.valor, {
        x: x + 0.18,
        y: top + 0.1,
        w: w - 0.36,
        h: 0.62,
        fontSize: stat.valor.length > 7 ? 26 : 34,
        bold: true,
        color: t.accent,
        fontFace: t.serif,
        valign: 'middle',
      });
      s.addText(stat.texto, {
        x: x + 0.18,
        y: top + 0.74,
        w: w - 0.36,
        h: h - 0.86,
        fontSize: 10,
        color: t.muted,
        fontFace: t.sans,
        valign: 'top',
        lineSpacingMultiple: 1.15,
      });
    }

    const maxPoints = hasChart || stat ? 3 : slide.tipo === 'comparacion' ? 2 : 4;
    const points = slide.puntos.slice(0, maxPoints);

    if (hasChart && slide.grafico) {
      const g = slide.grafico;
      s.addText(g.titulo, {
        x: MARGIN,
        y: top,
        w: 4.6,
        fontSize: 10.5,
        bold: true,
        color: t.text,
        fontFace: t.sans,
      });
      s.addChart(
        pptx.ChartType.bar,
        [{ name: g.titulo, labels: g.categorias, values: g.valores }],
        {
          x: MARGIN - 0.05,
          y: top + 0.3,
          w: 4.7,
          h: bottom - top - 0.35,
          barDir: 'bar',
          chartColors: [t.accents[0]],
          catAxisLabelColor: t.text,
          valAxisLabelColor: t.muted,
          dataLabelColor: t.text,
          dataLabelFontSize: 10,
          showLegend: false,
          showTitle: false,
          plotArea: { fill: { color: 'FFFFFF' } },
          chartArea: { fill: { color: 'FFFFFF' } },
          catAxisLineColor: t.line,
          valAxisLineColor: t.line,
          showValue: true,
        },
      );

      const gap = 0.16;
      const cardH = points.length ? (bottom - top - gap * (points.length - 1)) / points.length : 0;
      points.forEach((point, i) => {
        drawCard(s, pptx, t, {
          x: 5.4,
          y: top + i * (cardH + gap),
          w: SLIDE_W - MARGIN - 5.4,
          h: cardH,
          index: i,
          point,
          compact: true,
        });
      });
    } else if (stat) {
      // Con dato grande, las tarjetas van apiladas a su izquierda.
      const w = SLIDE_W - MARGIN * 2 - 3.5 - 0.22;
      const gap = 0.16;
      const cardH = points.length ? (bottom - top - gap * (points.length - 1)) / points.length : 0;
      points.forEach((point, i) => {
        drawCard(s, pptx, t, {
          x: MARGIN,
          y: top + i * (cardH + gap),
          w,
          h: cardH,
          index: i,
          point,
          compact: true,
        });
      });
    } else if (slide.tipo === 'comparacion') {
      // Dos columnas anchas, cada una con su banda de cabecera de color.
      const gap = 0.28;
      const cardW = (SLIDE_W - MARGIN * 2 - gap) / 2;
      points.forEach((point, i) => {
        const x = MARGIN + i * (cardW + gap);
        const band = t.accents[i % t.accents.length];
        s.addShape(pptx.ShapeType.roundRect, {
          x,
          y: top,
          w: cardW,
          h: bottom - top,
          rectRadius: 0.06,
          fill: { color: t.card },
          line: { color: t.line, width: 1 },
        });
        s.addShape(pptx.ShapeType.rect, {
          x,
          y: top,
          w: cardW,
          h: 0.46,
          fill: { color: band },
          line: { color: band },
        });
        s.addText(point.titulo, {
          x: x + 0.2,
          y: top,
          w: cardW - 0.4,
          h: 0.46,
          fontSize: 12.5,
          bold: true,
          color: 'FFFFFF',
          fontFace: t.sans,
          valign: 'middle',
        });
        s.addText(point.texto, {
          x: x + 0.2,
          y: top + 0.62,
          w: cardW - 0.4,
          h: bottom - top - 0.82,
          fontSize: 11,
          color: t.text,
          fontFace: t.sans,
          valign: 'top',
          lineSpacingMultiple: 1.25,
        });
      });
    } else {
      // Tarjetas en columnas; en modo proceso, con flechas entre ellas.
      const proceso = slide.tipo === 'proceso';
      const cols = Math.min(points.length, 3) || 1;
      const rows = Math.ceil(points.length / cols);
      const gapX = proceso ? 0.42 : 0.22;
      const gapY = 0.2;
      const cardW = (SLIDE_W - MARGIN * 2 - gapX * (cols - 1)) / cols;
      const cardH = (bottom - top - gapY * (rows - 1)) / rows;
      points.forEach((point, i) => {
        const x = MARGIN + (i % cols) * (cardW + gapX);
        const y = top + Math.floor(i / cols) * (cardH + gapY);
        drawCard(s, pptx, t, { x, y, w: cardW, h: cardH, index: i, point, compact: false });

        if (proceso && i % cols !== cols - 1 && i < points.length - 1) {
          s.addShape(pptx.ShapeType.rightArrow, {
            x: x + cardW + 0.06,
            y: y + cardH / 2 - 0.11,
            w: 0.3,
            h: 0.22,
            fill: { color: t.line },
            line: { color: t.line },
          });
        }
      });
    }

    if (closing) {
      s.addShape(pptx.ShapeType.roundRect, {
        x: MARGIN,
        y: 4.78,
        w: SLIDE_W - MARGIN * 2,
        h: 0.55,
        rectRadius: 0.05,
        fill: { color: t.ink },
        line: { color: t.ink },
      });
      s.addText(closing, {
        x: MARGIN + 0.22,
        y: 4.78,
        w: SLIDE_W - MARGIN * 2 - 0.44,
        h: 0.55,
        fontSize: 11,
        color: t.onDark,
        fontFace: t.sans,
        valign: 'middle',
      });
    }

    if (slide.notas) s.addNotes(slide.notas);
  });

  const data = await pptx.write({ outputType: 'nodebuffer' });
  return {
    buffer: Buffer.from(data as Uint8Array),
    name: safeName(title, 'pptx'),
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    kind: 'pptx',
  };
}

/**
 * Decoracion de la portada.
 *
 * Cinco tratamientos en vez de uno. Todos se salen por el borde a proposito
 * —una forma centrada parece un icono, una cortada parece diseño— y todos
 * dejan libre la mitad izquierda, que es donde va el titular.
 */
function drawCover(s: PptxGenJS.Slide, pptx: PptxGenJS, t: Palette) {
  const a0 = t.accents[0];
  const a1 = t.accents[1] ?? t.accents[0];

  if (t.cover === 'limpia') return;

  if (t.cover === 'circulos') {
    s.addShape(pptx.ShapeType.ellipse, {
      x: SLIDE_W - 2.1,
      y: -1.05,
      w: 3.1,
      h: 3.1,
      fill: { color: a0, transparency: 55 },
      line: { color: a0, transparency: 100 },
    });
    s.addShape(pptx.ShapeType.ellipse, {
      x: SLIDE_W - 1.35,
      y: 0.55,
      w: 1.85,
      h: 1.85,
      fill: { color: a1, transparency: 60 },
      line: { color: a1, transparency: 100 },
    });
    return;
  }

  if (t.cover === 'diagonal') {
    // Dos cunas cruzando la esquina inferior derecha.
    s.addShape(pptx.ShapeType.rtTriangle, {
      x: SLIDE_W - 3.4,
      y: SLIDE_H - 2.5,
      w: 3.4,
      h: 2.5,
      fill: { color: a0, transparency: 62 },
      line: { color: a0, transparency: 100 },
    });
    s.addShape(pptx.ShapeType.rtTriangle, {
      x: SLIDE_W - 1.8,
      y: SLIDE_H - 1.35,
      w: 1.8,
      h: 1.35,
      fill: { color: a1, transparency: 45 },
      line: { color: a1, transparency: 100 },
    });
    return;
  }

  if (t.cover === 'lineas') {
    // Una trama de barras finas a la derecha, mas juntas segun se aleja.
    for (let i = 0; i < 14; i++) {
      s.addShape(pptx.ShapeType.rect, {
        x: SLIDE_W - 2.6 + i * 0.19,
        y: -0.2,
        w: 0.045,
        h: SLIDE_H + 0.4,
        fill: { color: i % 4 === 0 ? a1 : a0, transparency: 55 + i * 2 },
        line: { color: a0, transparency: 100 },
      });
    }
    return;
  }

  // arco: un anillo grueso que asoma por la esquina.
  s.addShape(pptx.ShapeType.donut, {
    x: SLIDE_W - 2.3,
    y: SLIDE_H - 2.3,
    w: 4,
    h: 4,
    fill: { color: a0, transparency: 58 },
    line: { color: a0, transparency: 100 },
  });
}

/** Iniciales para la insignia redonda del callout: dos letras como mucho. */
function initials(text: string): string {
  const words = text.trim().split(/\s+/).filter((w) => w.length > 2);
  if (!words.length) return '·';
  return words.slice(0, 2).map((w) => w[0].toUpperCase()).join('');
}

/** Tarjeta con insignia numerada de color, mini-titulo en serif y texto. */
function drawCard(
  s: PptxGenJS.Slide,
  pptx: PptxGenJS,
  t: Palette,
  o: { x: number; y: number; w: number; h: number; index: number; point: SlidePoint; compact: boolean },
) {
  const accent = t.accents[o.index % t.accents.length];
  const pad = 0.2;

  s.addShape(pptx.ShapeType.roundRect, {
    x: o.x,
    y: o.y,
    w: o.w,
    h: o.h,
    rectRadius: 0.06,
    fill: { color: t.card },
    line: { color: t.line, width: 1 },
  });

  const badge = o.compact ? 0.34 : 0.44;
  s.addShape(pptx.ShapeType.ellipse, {
    x: o.x + pad,
    y: o.y + pad,
    w: badge,
    h: badge,
    fill: { color: accent },
    line: { color: accent },
  });
  s.addText(String(o.index + 1).padStart(2, '0'), {
    x: o.x + pad,
    y: o.y + pad,
    w: badge,
    h: badge,
    fontSize: o.compact ? 9 : 11,
    bold: true,
    color: 'FFFFFF',
    fontFace: t.sans,
    align: 'center',
    valign: 'middle',
  });

  if (o.compact) {
    // Apilada al lado de un grafico: titulo y texto a la derecha de la insignia.
    const tx = o.x + pad + badge + 0.16;
    const tw = o.w - (pad + badge + 0.16) - pad;
    s.addText(o.point.titulo, {
      x: tx,
      y: o.y + pad - 0.04,
      w: tw,
      h: 0.28,
      fontSize: 12,
      bold: true,
      color: t.ink,
      fontFace: t.serif,
      valign: 'top',
    });
    s.addText(o.point.texto, {
      x: tx,
      y: o.y + pad + 0.26,
      w: tw,
      h: o.h - pad * 2 - 0.26,
      fontSize: 10,
      color: t.muted,
      fontFace: t.sans,
      valign: 'top',
      lineSpacingMultiple: 1.15,
    });
    return;
  }

  // Todo lo de dentro se mide contra el alto real de la tarjeta. Con una caja
  // destacada o un callout encima, las tarjetas quedan bajas, y con medidas
  // fijas el texto se metia debajo de la pildora — visto al renderizar.
  const roomy = o.h >= 2.1;
  const titleGap = 0.14;
  const titleH = roomy ? 0.6 : 0.4;
  const label = o.point.etiqueta?.toUpperCase();
  // La pildora va al pie si cabe; si no, en la misma fila que la insignia, que
  // ahi no le quita sitio a nada.
  const tagAtFoot = Boolean(label) && roomy;
  const tagW = label ? Math.min(o.w - pad * 2, 0.26 + label.length * 0.075) : 0;

  if (label) {
    const tx = tagAtFoot ? o.x + pad : o.x + pad + badge + 0.14;
    const ty = tagAtFoot ? o.y + o.h - pad - 0.26 : o.y + pad + (badge - 0.26) / 2;
    s.addShape(pptx.ShapeType.roundRect, {
      x: tx,
      y: ty,
      w: tagW,
      h: 0.26,
      rectRadius: 0.05,
      fill: { color: 'FFFFFF' },
      line: { color: accent, width: 1 },
    });
    s.addText(label, {
      x: tx,
      y: ty,
      w: tagW,
      h: 0.26,
      fontSize: 7.5,
      bold: true,
      charSpacing: 1,
      color: accent,
      fontFace: t.sans,
      align: 'center',
      valign: 'middle',
    });
  }

  const titleY = o.y + pad + badge + titleGap;
  s.addText(o.point.titulo, {
    x: o.x + pad,
    y: titleY,
    w: o.w - pad * 2,
    h: titleH,
    fontSize: roomy ? 14 : 12.5,
    bold: true,
    color: t.ink,
    fontFace: t.serif,
    valign: 'top',
    lineSpacingMultiple: 1.05,
  });

  const textY = titleY + titleH + 0.04;
  const textH = Math.max(0.2, o.y + o.h - pad - (tagAtFoot ? 0.38 : 0) - textY);
  s.addText(o.point.texto, {
    x: o.x + pad,
    y: textY,
    w: o.w - pad * 2,
    h: textH,
    fontSize: roomy ? 10.5 : 10,
    color: t.muted,
    fontFace: t.sans,
    valign: 'top',
    lineSpacingMultiple: 1.2,
  });
}

// --- Excel -----------------------------------------------------------------

/**
 * Una celda es un valor plano o una formula real de Excel (sin el "=" — lo
 * pone ExcelJS). Verificado desunzipeando el .xlsx resultante: ExcelJS
 * escribe una etiqueta `<f>` de verdad, no un texto que se parezca a una
 * formula, asi que Excel/LibreOffice la recalcula al abrir el archivo como
 * cualquier formula escrita a mano.
 */
export type CellValue = string | number | { formula: string };
export type ColumnFormat = 'texto' | 'numero' | 'entero' | 'moneda' | 'porcentaje';
export type ColumnSpec = { nombre: string; formato?: ColumnFormat };

const NUM_FORMATS: Partial<Record<ColumnFormat, string>> = {
  // Tres secciones: positivo; negativo entre parentesis; el cero como guion.
  // Asi una columna de desviaciones se lee de un vistazo sin buscar el signo.
  numero: '#,##0.00;(#,##0.00);-',
  entero: '#,##0;(#,##0);-',
  moneda: '#,##0.00 "\u20AC";(#,##0.00 "\u20AC");-',
  porcentaje: '0.0%;(0.0%);-',
};

/**
 * Mismos valores que el .docx: azul marino para cabeceras, gris para las
 * lineas de contexto. Sacados de un .xlsx real de claude.ai leido celda a
 * celda con ExcelJS, no elegidos a ojo.
 */
const XL_NAVY = '1F3864';
const XL_MUTED = '595959';
const XL_TOTAL = 'D9E2F3';
const XL_INPUT_BG = 'FFFFCC';
const XL_INPUT_FG = '0000FF';

const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FFBFBFBF' } },
  left: { style: 'thin', color: { argb: 'FFBFBFBF' } },
  bottom: { style: 'thin', color: { argb: 'FFBFBFBF' } },
  right: { style: 'thin', color: { argb: 'FFBFBFBF' } },
};

function cellText(v: CellValue): string {
  return typeof v === 'object' ? v.formula : String(v);
}

export async function createSpreadsheet(
  name: string,
  columns: ColumnSpec[],
  rows: CellValue[][],
  subtitle?: string,
  notes?: string[],
): Promise<GeneratedFile> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(name.trim().slice(0, 30) || 'Hoja1');

  // Bloque de cabecera de la hoja: titulo, contexto y leyenda. Calcado del
  // .xlsx real de claude.ai — una hoja que llega por correo sin una linea que
  // diga de que va y en que unidades esta obliga a preguntar.
  const titleCell = sheet.getCell('A1');
  titleCell.value = name;
  titleCell.font = { bold: true, size: 14, color: { argb: `FF${XL_NAVY}` } };
  sheet.getRow(1).height = 18;

  let cursor = 2;
  if (subtitle) {
    const c = sheet.getCell(`A${cursor}`);
    c.value = subtitle;
    c.font = { italic: true, size: 9, color: { argb: `FF${XL_MUTED}` } };
    cursor++;
  }

  const hasInputs = rows.some((row) =>
    row.some((v, i) => isInputCell(v, columns[i])),
  );
  if (hasInputs) {
    const c = sheet.getCell(`A${cursor}`);
    c.value =
      'Leyenda: celdas en azul sobre fondo amarillo = datos que puedes editar. Texto en negro = formulas, no tocar.';
    c.font = { italic: true, size: 9, color: { argb: `FF${XL_MUTED}` } };
    cursor++;
  }

  const headerRowNumber = cursor + 1; // una fila en blanco antes de la tabla

  const headerRow = sheet.getRow(headerRowNumber);
  headerRow.height = 30;
  columns.forEach((c, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = c.nombre;
    cell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${XL_NAVY}` } };
    cell.alignment = { vertical: 'middle', wrapText: true };
    cell.border = THIN_BORDER;
  });

  // La ultima fila es la de totales cuando se llama "Total": se resalta como
  // tal (fondo azul claro, negrita y filete superior) en vez de quedar como
  // una fila mas de datos, que es lo que la hacia pasar desapercibida.
  const totalsIndex = isTotalsRow(rows) ? rows.length - 1 : -1;
  // Cuanto ha bajado la tabla respecto a "cabecera en la fila 1".
  const rowOffset = headerRowNumber - 1;

  rows.forEach((row, i) => {
    const excelRow = sheet.getRow(headerRowNumber + 1 + i);
    const isTotals = i === totalsIndex;
    columns.forEach((col, j) => {
      const cell = excelRow.getCell(j + 1);
      const raw = row[j];
      const value = isFormula(raw) ? { formula: shiftFormulaRows(raw.formula, rowOffset) } : raw;
      cell.value = value === undefined ? null : (value as ExcelJS.CellValue);
      cell.border = isTotals
        ? { ...THIN_BORDER, top: { style: 'medium', color: { argb: `FF${XL_NAVY}` } } }
        : THIN_BORDER;
      cell.font = { size: 10 };

      if (isTotals) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${XL_TOTAL}` } };
        cell.font = { size: 10, bold: true, ...(j === 0 ? { color: { argb: `FF${XL_NAVY}` } } : {}) };
      } else if (isInputCell(value, col)) {
        // Dato de entrada: amarillo con texto azul, la convencion de toda la
        // vida en las plantillas de calculo para "esto lo rellenas tu".
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${XL_INPUT_BG}` } };
        cell.font = { size: 10, color: { argb: `FF${XL_INPUT_FG}` } };
      } else if (isFormula(value)) {
        cell.font = { size: 10, bold: true };
      }
    });
  });

  columns.forEach((c, i) => {
    const fmt = c.formato && NUM_FORMATS[c.formato];
    if (fmt) {
      // Solo a las celdas de datos: si se aplica a la columna entera, el
      // titulo y las notas de arriba heredan el formato numerico.
      rows.forEach((_, r) => {
        sheet.getRow(headerRowNumber + 1 + r).getCell(i + 1).numFmt = fmt;
      });
    }

    // Ancho segun el contenido real, cabecera incluida — no solo la cabecera
    // como antes, que dejaba columnas de datos largos comprimidas.
    const longest = rows.reduce((max, row) => Math.max(max, cellText(row[i] ?? '').length), c.nombre.length);
    sheet.getColumn(i + 1).width = Math.min(42, Math.max(11, longest + 3));
  });

  if (notes?.length) {
    const start = headerRowNumber + rows.length + 2;
    const head = sheet.getCell(`A${start}`);
    head.value = 'Notas y supuestos';
    head.font = { bold: true, size: 10 };
    notes.slice(0, 8).forEach((note, i) => {
      const c = sheet.getCell(`A${start + 1 + i}`);
      c.value = `• ${note}`;
      c.font = { size: 9, color: { argb: `FF${XL_MUTED}` } };
    });
  }

  // Cabecera y primera columna congeladas: en una hoja larga es la diferencia
  // entre poder leerla y perder de vista de que columna es cada numero.
  sheet.views = [{ state: 'frozen', xSplit: 1, ySplit: headerRowNumber, topLeftCell: `B${headerRowNumber + 1}` }];

  const buffer = await workbook.xlsx.writeBuffer();
  return {
    buffer: Buffer.from(buffer),
    name: safeName(name, 'xlsx'),
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    kind: 'xlsx',
  };
}

/**
 * Traslada las filas de una formula en notacion A1.
 *
 * El modelo escribe las formulas como si la tabla empezara arriba del todo
 * (cabecera en la fila 1, primer dato en la 2), que es lo natural y lo que
 * pide el esquema de la herramienta. Pero la hoja lleva delante un bloque de
 * titulo, subtitulo y leyenda, asi que la tabla real empieza mas abajo: sin
 * este ajuste, `SUM(B2:B7)` sumaria el hueco en blanco de encima de la tabla
 * y daria un total silenciosamente equivocado — que es exactamente lo que
 * pasaba, comprobado renderizando el archivo.
 *
 * Los tramos entre comillas se dejan intactos: en `IF(F2=0,"",...)` la cadena
 * vacia no es una referencia. Y un nombre de funcion que acaba en digitos
 * (LOG10) tampoco lo es, por eso se descarta lo que va seguido de "(".
 */
function shiftFormulaRows(formula: string, offset: number): string {
  if (offset === 0) return formula;
  return formula
    .split(/("(?:[^"]|"")*")/g)
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part.replace(/(\$?)([A-Za-z]{1,3})(\$?)(\d+)\b(?!\s*\()/g, (m, d1, col, d2, row) =>
            `${d1}${col}${d2}${Number(row) + offset}`,
          ),
    )
    .join('');
}

const isFormula = (v: CellValue | undefined): v is { formula: string } =>
  typeof v === 'object' && v !== null && 'formula' in v;

/** Un numero escrito a mano en una columna numerica es un dato de entrada; una formula, no. */
const isInputCell = (v: CellValue | undefined, col: ColumnSpec | undefined) =>
  typeof v === 'number' && Boolean(col?.formato) && col?.formato !== 'texto';

const isTotalsRow = (rows: CellValue[][]) => {
  const last = rows[rows.length - 1];
  if (!last || rows.length < 2) return false;
  const label = typeof last[0] === 'string' ? last[0].trim().toLowerCase() : '';
  return label.startsWith('total');
};
