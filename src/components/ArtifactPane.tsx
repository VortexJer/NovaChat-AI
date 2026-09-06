'use client';

import { useMemo, useState } from 'react';

import { CopyButton } from './Markdown';

export type Artifact = { lang: string; code: string; title?: string };

/**
 * Deja un solo documento en la vista previa.
 *
 * Los modelos pequenos repiten la pagina entera de vez en cuando: visto en
 * produccion en una landing, donde el mensaje traia dos <!DOCTYPE> y las
 * vallas de codigo pegadas ("```" seguido de "```html"). La vista previa
 * pintaba las dos paginas seguidas con un "```html" suelto en medio, y lo que
 * se entregaba parecia roto aunque la primera copia estuviera perfecta.
 *
 * Se corta en la segunda apertura de documento y se tiran las vallas sueltas.
 * Solo afecta a lo que se ve: la pestana de codigo sigue mostrando lo que dijo
 * el modelo, sin recortar.
 */
function unSoloDocumento(code: string): string {
  const limpio = code.replace(/^\s*```[a-z]*\s*$/gim, '').trim();
  const segundo = limpio.search(/<!DOCTYPE\s+html|<html[\s>]/i);
  if (segundo < 0) return limpio;
  const siguiente = limpio.slice(segundo + 1).search(/<!DOCTYPE\s+html|<html[\s>]/i);
  return siguiente < 0 ? limpio : limpio.slice(0, segundo + 1 + siguiente).trimEnd();
}

/** Lenguajes que se pueden enseñar renderizados y no solo como texto. */
const PREVIEWABLE = new Set(['html', 'svg', 'xml']);

export function isPreviewable(lang: string) {
  return PREVIEWABLE.has(lang.toLowerCase());
}

/**
 * Panel de vista previa.
 *
 * El contenido va en un iframe con sandbox: es codigo que ha escrito un modelo
 * a partir, muchas veces, de texto que venia de fuera. Sin aislarlo, un script
 * generado podria leer la sesion de NovaChat y hablar con su API en nombre del
 * usuario.
 *
 * El sandbox lleva allow-scripts pero NO allow-same-origin. Esa combinacion es
 * la que importa: con las dos, el iframe puede quitarse el propio sandbox.
 * Asi el codigo se ejecuta, pero en un origen opaco, sin acceso a las cookies
 * ni al DOM de la aplicacion.
 */
export function ArtifactPane({
  artifact,
  onClose,
}: {
  artifact: Artifact;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<'preview' | 'code'>(
    isPreviewable(artifact.lang) ? 'preview' : 'code',
  );

  const doc = useMemo(() => {
    if (artifact.lang.toLowerCase() === 'svg') {
      return `<!doctype html><meta charset="utf-8"><style>
        html,body{height:100%;margin:0;display:grid;place-items:center;background:#0a0f19}
        svg{max-width:100%;max-height:100%}
      </style>${artifact.code}`;
    }
    return unSoloDocumento(artifact.code);
  }, [artifact]);

  return (
    <aside className="artifact">
      <div className="artifact-head">
        {artifact.title && <span className="artifact-title">{artifact.title}</span>}
        <div className="artifact-tabs">
          {isPreviewable(artifact.lang) && (
            <button
              className={tab === 'preview' ? 'on' : ''}
              onClick={() => setTab('preview')}
            >
              Vista previa
            </button>
          )}
          <button className={tab === 'code' ? 'on' : ''} onClick={() => setTab('code')}>
            Codigo
          </button>
        </div>

        <CopyButton text={artifact.code} />

        <button
          className="icon-btn"
          onClick={() => {
            // Descarga sin servidor: el contenido ya esta en memoria.
            const blob = new Blob([artifact.code], { type: 'text/plain;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `artefacto.${artifact.lang === 'texto' ? 'txt' : artifact.lang}`;
            a.click();
            URL.revokeObjectURL(url);
          }}
          aria-label="Descargar"
          title="Descargar"
        >
          <span style={{ fontSize: 12 }}>Bajar</span>
        </button>

        <button className="icon-btn" onClick={onClose} aria-label="Cerrar panel">
          <span style={{ fontSize: 16, lineHeight: 1 }}>&times;</span>
        </button>
      </div>

      {tab === 'preview' ? (
        <iframe
          className="artifact-frame"
          title="Vista previa"
          sandbox="allow-scripts allow-forms allow-modals allow-popups"
          srcDoc={doc}
        />
      ) : (
        <pre className="artifact-code">
          <code>{artifact.code}</code>
        </pre>
      )}
    </aside>
  );
}
