'use client';

import { useEffect, useState } from 'react';

import { FileIcon } from './icons';
import type { TraceStep } from './types';

const VERB: Record<string, string> = {
  buscar_web: 'Búsqueda web',
  buscar_imagenes: 'Búsqueda de imágenes',
  leer_pagina: 'Lectura de página',
  crear_documento_word: 'Documento de Word',
  crear_presentacion: 'Presentación',
  crear_hoja_calculo: 'Hoja de cálculo',
  usar_skill: 'Skill',
  buscar_historial: 'Búsqueda en el historial',
};

/** Frase corta para el aviso mientras corre, antes de que haya traza que mostrar. */
export function toolRunningLabel(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case 'buscar_web':
      return `Buscando: "${args.consulta ?? ''}"`;
    case 'buscar_imagenes':
      return `Buscando imágenes: "${args.consulta ?? ''}"`;
    case 'leer_pagina':
      return `Leyendo ${args.url ?? ''}`;
    case 'crear_documento_word':
      return `Creando documento: ${args.titulo ?? ''}`;
    case 'crear_presentacion':
      return `Creando presentación: ${args.titulo ?? ''}`;
    case 'crear_hoja_calculo':
      return `Creando hoja de cálculo: ${args.nombre ?? ''}`;
    case 'usar_skill':
      return `Leyendo la skill: ${args.nombre ?? ''}`;
    case 'buscar_historial':
      return `Buscando en conversaciones anteriores: "${args.consulta ?? ''}"`;
    default:
      // Las de los conectores llegan con el nombre que publica su servidor:
      // `mcp_<conector>_<herramienta>`. Se enseña lo ultimo, que es lo unico
      // que le dice algo a quien mira.
      if (name.startsWith('mcp_')) {
        return `Usando el conector: ${name.split('_').slice(2).join('_') || name}`;
      }
      return 'Usando una herramienta';
  }
}

function domain(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** Segundos transcurridos desde `since`, actualizado cada segundo mientras se muestra. */
function ElapsedTimer({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const secs = Math.max(0, Math.round((now - since) / 1000));
  return <span className="trace-timer">{secs}s</span>;
}

/**
 * Traza colapsada de las herramientas usadas en un mensaje, al estilo de
 * claude.ai: mientras corre muestra en una sola linea que se esta haciendo
 * ahora mismo con un cronometro en vivo (p. ej. "Creando documento... 7s"),
 * y al terminar pasa a un resumen en pasado ("Ejecutó N acciones") que se
 * expande a los pasos reales — la consulta que se mando, las paginas que se
 * abrieron, la skill que se leyó.
 */
export function Trace({
  trace,
  running,
  runningLabel,
  startedAt,
  autoOpenFiles,
}: {
  trace: TraceStep[];
  running?: boolean;
  runningLabel?: string | null;
  startedAt?: number | null;
  /** Abre el panel de artefactos solo mientras el mensaje se esta generando, no al reabrir el historial. */
  autoOpenFiles?: boolean;
}) {
  if (trace.length === 0 && !running) return null;

  const files = trace.filter((s) => s.ui?.kind === 'file');
  const images = trace.filter((s) => s.ui?.kind === 'images');

  return (
    <>
      <details className="trace" open={running}>
        <summary>
          {running && <span className="pulse" />}
          {running ? (runningLabel ?? 'Trabajando') : `Ejecutó ${trace.length} ${trace.length === 1 ? 'acción' : 'acciones'}`}
          {running && startedAt ? <ElapsedTimer since={startedAt} /> : null}
        </summary>
        {trace.length > 0 && (
          <div className="trace-steps">
            {trace.map((step) => (
              <StepRows key={step.id} step={step} />
            ))}
          </div>
        )}
      </details>

      {files.map((step) =>
        step.ui?.kind === 'file' ? (
          <FileCard
            key={step.id}
            name={step.ui.name}
            type={step.ui.type}
            fileId={step.ui.fileId}
            previewHtml={step.ui.previewHtml}
            autoOpen={autoOpenFiles}
          />
        ) : null,
      )}

      {images.map((step) =>
        step.ui?.kind === 'images' ? <ImageGrid key={step.id} query={step.ui.query} items={step.ui.items} /> : null,
      )}
    </>
  );
}

function StepRows({ step }: { step: TraceStep }) {
  const verb = VERB[step.name] ?? step.name;

  if (step.ui?.kind === 'web') {
    return (
      <>
        <div className="trace-step">
          <span className="k">{verb}</span>
          <span className="v">&ldquo;{step.ui.query}&rdquo;</span>
        </div>
        {step.ui.results.map((r) => (
          <div className="trace-step" key={r.url}>
            <span className="k">Abrió</span>
            <span className="v">
              <a href={r.url} target="_blank" rel="noopener noreferrer">
                {r.title || domain(r.url)}
              </a>
            </span>
          </div>
        ))}
      </>
    );
  }

  if (step.ui?.kind === 'page') {
    return (
      <div className="trace-step">
        <span className="k">Abrió</span>
        <span className="v">
          <a href={step.ui.url} target="_blank" rel="noopener noreferrer">
            {step.ui.url}
          </a>
        </span>
      </div>
    );
  }

  if (step.ui?.kind === 'images') {
    return (
      <div className="trace-step">
        <span className="k">{verb}</span>
        <span className="v">&ldquo;{step.ui.query}&rdquo; — {step.ui.items.length} resultado(s)</span>
      </div>
    );
  }

  if (step.ui?.kind === 'file') {
    return (
      <div className="trace-step">
        <span className="k">Creó</span>
        <span className="v">{step.ui.name}</span>
      </div>
    );
  }

  if (step.ui?.kind === 'history') {
    if (step.ui.items.length === 0) {
      return (
        <div className="trace-step">
          <span className="k">{verb}</span>
          <span className="v">&ldquo;{step.ui.query}&rdquo; — sin resultados</span>
        </div>
      );
    }
    return (
      <>
        <div className="trace-step">
          <span className="k">{verb}</span>
          <span className="v">&ldquo;{step.ui.query}&rdquo;</span>
        </div>
        {step.ui.items.map((it) => (
          <div className="trace-step" key={it.conversationId}>
            <span className="k">Encontró</span>
            <span className="v">
              <button type="button" className="trace-link" onClick={() => openConversation(it.conversationId)}>
                {it.title}
              </button>{' '}
              · {it.date}
            </span>
          </div>
        ))}
      </>
    );
  }

  if (step.ui?.kind === 'skill') {
    const { name, previewHtml } = step.ui;
    return (
      <div className="trace-step">
        <span className="k">Skill</span>
        <span className="v">
          {previewHtml ? (
            <button type="button" className="trace-link" onClick={() => openPreview(name, previewHtml)}>
              {name}
            </button>
          ) : (
            name
          )}
        </span>
      </div>
    );
  }

  if (step.ui?.kind === 'connector') {
    const { connector, tool } = step.ui;
    return (
      <div className="trace-step">
        <span className="k">{connector}</span>
        <span className="v">{tool}</span>
      </div>
    );
  }

  // Sin `ui`: la herramienta fallo o no devolvio nada que mostrar aparte del
  // texto ya incluido en la respuesta del modelo.
  return (
    <div className="trace-step">
      <span className="k">{verb}</span>
      <span className="v">{Object.values(step.args)[0] ? String(Object.values(step.args)[0]) : '—'}</span>
    </div>
  );
}

const FILE_LABEL: Record<string, string> = {
  docx: 'Documento · DOCX',
  pptx: 'Presentación · PPTX',
  xlsx: 'Hoja de cálculo · XLSX',
};

function openPreview(name: string, previewHtml: string) {
  window.dispatchEvent(
    new CustomEvent('novachat:artifact', { detail: { lang: 'html', code: previewHtml, title: name } }),
  );
}

/** Abre una conversacion encontrada por `buscar_historial`, al estilo de las citas de claude.ai. */
function openConversation(id: string) {
  window.dispatchEvent(new CustomEvent('novachat:open-conversation', { detail: { id } }));
}

function FileCard({
  name,
  type,
  fileId,
  previewHtml,
  autoOpen,
}: {
  name: string;
  type: string;
  fileId: string;
  previewHtml?: string;
  autoOpen?: boolean;
}) {
  // Al terminar de generarse se enseña sola, como en claude.ai — pero solo la
  // primera vez que aparece esta tarjeta, no cada vez que se reabre el
  // historial de la conversacion.
  useEffect(() => {
    if (autoOpen && previewHtml) openPreview(name, previewHtml);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="filecard">
      <button
        type="button"
        className="filecard-main"
        disabled={!previewHtml}
        onClick={() => previewHtml && openPreview(name, previewHtml)}
      >
        <span className="ficon">
          <FileIcon size={16} />
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span className="fname">{name}</span>
          <span className="ftype">{FILE_LABEL[type] ?? type.toUpperCase()}</span>
        </span>
      </button>
      <a className="act" href={`/api/files/${fileId}`} download={name}>
        Descargar
      </a>
    </div>
  );
}

function ImageGrid({ items }: { query: string; items: { url: string; thumb: string; credit: string; page: string }[] }) {
  return (
    <div className="img-grid">
      {items.map((img) => (
        <a className="img-card" key={img.url} href={img.page} target="_blank" rel="noopener noreferrer">
          {/* eslint-disable-next-line @next/next/no-img-element -- son imagenes externas y ocasionales, no vale la pena el pipeline de next/image */}
          <img src={img.thumb} alt="" loading="lazy" />
          <span className="credit">{img.credit}</span>
        </a>
      ))}
    </div>
  );
}
