'use client';

import { memo, useState } from 'react';
import { nombreDeCodigo } from '@/lib/nombreArchivo';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';

import { Check, Chevron, Copy } from './icons';
import { TableBlock } from './TableBlock';

function CopyButton({ text, label = 'Copiar' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);

  return (
    <button
      className="act"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1600);
        } catch {
          // El portapapeles falla sin permiso o fuera de https. Callar es mejor
          // que un error que el usuario no puede resolver.
        }
      }}
      aria-label={label}
    >
      {done ? <Check /> : <Copy />}
      {done ? 'Copiado' : label}
    </button>
  );
}

/**
 * Bloque de codigo con cabecera: lenguaje a la izquierda, copiar a la derecha.
 *
 * rehype-highlight ya ha marcado el contenido, asi que aqui solo se envuelve.
 * El lenguaje se saca de la clase `language-x` que pone remark.
 */
/** A partir de aqui un bloque ocupa mas de lo que aporta y arranca plegado. */
const COLLAPSE_FROM_LINES = 12;

function CodeBlock({ children, ...props }: React.HTMLAttributes<HTMLPreElement>) {
  // El hijo del <pre> es el <code>; de ahi salen la clase y el texto crudo.
  const child = (children as React.ReactElement<{ className?: string; children?: unknown }>)?.props;
  const lang = /language-(\w+)/.exec(child?.className ?? '')?.[1] ?? 'texto';
  const text = extractText(child?.children);

  const previewable = ['html', 'svg', 'xml'].includes(lang.toLowerCase());
  const lines = text.split('\n').length;
  const collapsible = lines > COLLAPSE_FROM_LINES;
  // Los bloques largos arrancan plegados: una pagina web entera son cientos de
  // lineas de codigo que hay que pasar en rueda para llegar a lo que el
  // mensaje dice despues, y casi nunca se leen — para eso esta "Abrir".
  const [open, setOpen] = useState(false);
  const folded = collapsible && !open;

  return (
    <div className="code">
      <div className="code-head">
        <span className="code-lang">{lang}</span>
        {collapsible && (
          <button className="act code-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            <Chevron size={11} className={open ? 'chev-open' : undefined} />
            {open ? 'Plegar' : `${lines} lineas`}
          </button>
        )}
        <span style={{ display: 'flex', gap: 2, marginLeft: 'auto' }}>
          {previewable && (
            <button
              className="act"
              onClick={() =>
                // Evento en vez de prop: este bloque vive dentro de un
                // componente memoizado y de ReactMarkdown, y pasar el callback
                // hasta aqui obligaria a romper la memoizacion que mantiene
                // fluido el streaming.
                window.dispatchEvent(
                  new CustomEvent('novachat:artifact', { detail: { lang, code: text } }),
                )
              }
            >
              Abrir
            </button>
          )}
          {/*
            Descargar tambien desde el chat, no solo desde el visor.
            Un bloque de codigo largo es un archivo que todavia no existe: sin
            esto habia que abrir el visor o seleccionar y copiar a mano
            trescientas lineas.
          */}
          <button
            className="act"
            title="Guardar como archivo"
            onClick={() => {
              const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = nombreDeCodigo(text, lang);
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            Bajar
          </button>
          <CopyButton text={text} />
        </span>
      </div>
      {folded ? (
        <button className="code-folded" onClick={() => setOpen(true)}>
          {text.split('\n')[0].slice(0, 80) || `${lang} plegado`}…
        </button>
      ) : (
        <pre {...props}>{children}</pre>
      )}
    </div>
  );
}

/** Recompone el texto plano de un arbol de React para poder copiarlo. */
function extractText(node: unknown): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractText).join('');
  const el = node as { props?: { children?: unknown } };
  return el.props ? extractText(el.props.children) : '';
}

const components = {
  pre: CodeBlock,
  // Las tablas anchas hacen scroll dentro de su contenedor; si no, empujarian
  // el ancho de toda la pagina. Y llevan boton para copiarlas a Excel.
  table: TableBlock,
  // Los enlaces salen a una pestana nueva. noreferrer evita filtrar la URL del
  // chat al sitio de destino.
  a: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props} target="_blank" rel="noopener noreferrer" />
  ),
};

/**
 * Renderiza Markdown.
 *
 * Va memoizado porque durante el streaming el componente padre se repinta en
 * cada fragmento: sin esto se reparsearia el mensaje entero decenas de veces
 * por segundo y la escritura se veria a tirones en mensajes largos.
 */
export const Markdown = memo(function Markdown({ children }: { children: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        // ignoreMissing: durante el streaming llegan bloques de codigo con el
        // lenguaje a medio escribir ("```pyt"), y sin esto el resaltador lanza.
        rehypePlugins={[[rehypeHighlight, { ignoreMissing: true, detect: true }]]}
        components={components}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
});

export { CopyButton };
