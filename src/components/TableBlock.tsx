'use client';

import { useRef, useState } from 'react';

import { Check, Copy } from './icons';

/**
 * Una tabla del chat, con boton para copiarla y pegarla en Excel.
 *
 * La clave es escribir al portapapeles **dos formatos a la vez**: `text/html`
 * con la tabla de verdad, que es lo que Excel y Sheets leen para crear celdas,
 * y `text/plain` con los valores separados por tabuladores, que es lo que
 * recibe cualquier otra cosa. Copiar solo texto pega la tabla entera en una
 * celda; copiar solo HTML deja sin nada a un editor de texto.
 *
 * Los valores se leen del DOM ya renderizado en vez de del Markdown original:
 * asi lo que se copia es exactamente lo que se ve, con la negrita resuelta y
 * sin los guiones de la fila separadora.
 */
export function TableBlock(props: React.HTMLAttributes<HTMLTableElement>) {
  const wrap = useRef<HTMLDivElement>(null);
  const [done, setDone] = useState(false);

  async function copy() {
    const table = wrap.current?.querySelector('table');
    if (!table) return;

    const rows = [...table.querySelectorAll('tr')].map((tr) =>
      [...tr.querySelectorAll('th,td')].map((c) => (c.textContent ?? '').trim()),
    );
    // Los tabuladores y saltos de linea dentro de una celda romperian la
    // rejilla al pegar, asi que se sustituyen por espacios.
    const tsv = rows.map((r) => r.map((c) => c.replace(/[\t\n\r]+/g, ' ')).join('\t')).join('\n');

    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([table.outerHTML], { type: 'text/html' }),
          'text/plain': new Blob([tsv], { type: 'text/plain' }),
        }),
      ]);
    } catch {
      // Navegador sin ClipboardItem, o sin permiso para el formato HTML: el
      // texto con tabuladores tambien lo pega Excel en celdas, asi que sirve.
      try {
        await navigator.clipboard.writeText(tsv);
      } catch {
        return;
      }
    }
    setDone(true);
    setTimeout(() => setDone(false), 1600);
  }

  return (
    <div className="table-block">
      <div className="table-bar">
        <button className="act" onClick={() => void copy()} aria-label="Copiar tabla">
          {done ? <Check size={13} /> : <Copy size={13} />}
          {done ? 'Copiada' : 'Copiar tabla'}
        </button>
      </div>
      <div className="table-wrap" ref={wrap}>
        <table {...props} />
      </div>
    </div>
  );
}
