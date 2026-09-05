/**
 * Markdown -> HTML minimo para vistas previas dentro del panel de artefactos
 * (contenido de una skill, por ejemplo). No es un parser completo: cubre lo
 * que un fichero de instrucciones escrito a mano suele traer — encabezados,
 * listas, bloques de codigo con lenguaje, negrita, codigo en linea y
 * parrafos — que es todo lo que hace falta para que se lea igual de bien que
 * el texto plano, pero con formato.
 */

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function inline(text: string): string {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

export function markdownToHtmlFragment(markdown: string): string {
  const out: string[] = [];
  const lines = markdown.split(/\r?\n/);
  let list: { tag: 'ul' | 'ol'; items: string[] } | null = null;
  let code: { lang: string; lines: string[] } | null = null;

  const flushList = () => {
    if (list) {
      out.push(`<${list.tag}>${list.items.map((li) => `<li>${li}</li>`).join('')}</${list.tag}>`);
      list = null;
    }
  };

  for (const raw of lines) {
    const fence = /^```\s*(\S*)/.exec(raw);
    if (fence) {
      if (code) {
        out.push(`<pre><code class="lang-${code.lang}">${escapeHtml(code.lines.join('\n'))}</code></pre>`);
        code = null;
      } else {
        flushList();
        code = { lang: fence[1] || '', lines: [] };
      }
      continue;
    }
    if (code) {
      code.lines.push(raw);
      continue;
    }

    const line = raw.trim();
    if (!line) {
      flushList();
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)/.exec(line);
    if (heading) {
      flushList();
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }

    const bullet = /^[-*]\s+(.*)/.exec(line);
    if (bullet) {
      if (list?.tag !== 'ul') {
        flushList();
        list = { tag: 'ul', items: [] };
      }
      list.items.push(inline(bullet[1]));
      continue;
    }

    const numbered = /^\d+[.)]\s+(.*)/.exec(line);
    if (numbered) {
      if (list?.tag !== 'ol') {
        flushList();
        list = { tag: 'ol', items: [] };
      }
      list.items.push(inline(numbered[1]));
      continue;
    }

    flushList();
    out.push(`<p>${inline(line)}</p>`);
  }
  flushList();
  if (code) out.push(`<pre><code>${escapeHtml(code.lines.join('\n'))}</code></pre>`);

  return out.join('');
}

/** Vista previa oscura, a juego con el resto de la interfaz, para el contenido de una skill. */
export function skillPreviewHtml(name: string, content: string): string {
  return `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;padding:32px 40px;background:#0b0c0e;color:#e9e9ea;font-family:system-ui,-apple-system,sans-serif}
    .page{max-width:720px;margin:0 auto}
    h1{font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#e10600;margin:0 0 20px}
    h1,h2,h3,h4,h5,h6{font-weight:700}
    h2{font-size:19px;margin:26px 0 10px}
    h3{font-size:16px;margin:20px 0 8px}
    h4,h5,h6{font-size:14px;margin:16px 0 6px}
    p{font-size:14px;line-height:1.7;margin:0 0 12px;color:#c9cacc}
    ul,ol{margin:0 0 12px;padding-left:24px}
    li{font-size:14px;line-height:1.65;margin-bottom:4px;color:#c9cacc}
    code{font-family:ui-monospace,'JetBrains Mono',Menlo,Consolas,monospace;font-size:12.5px;
      background:#1a1c1f;border:1px solid #2a2d31;padding:1px 5px}
    pre{background:#131417;border:1px solid #2a2d31;padding:14px 16px;overflow-x:auto;margin:0 0 14px}
    pre code{border:0;background:none;padding:0;font-size:12.5px;line-height:1.6}
    strong{font-weight:700;color:#f2f1ed}
  </style><div class="page"><h1>${escapeHtml(name)}</h1>${markdownToHtmlFragment(content)}</div>`;
}
