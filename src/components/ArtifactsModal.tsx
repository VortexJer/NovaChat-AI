'use client';

import { useEffect, useState } from 'react';

import { Trash } from './icons';

type Artifact = {
  id: string;
  kind: 'docx' | 'pptx' | 'xlsx' | 'html';
  name: string;
  created_at: string;
  conversation_id: string | null;
  bytes: number;
};

const KIND_LABEL: Record<Artifact['kind'], string> = {
  docx: 'Documento',
  pptx: 'Presentación',
  xlsx: 'Hoja de cálculo',
  html: 'Página',
};

const size = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

const when = (iso: string) =>
  new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * Galeria de todo lo generado.
 *
 * Cada tarjeta lleva la vista previa real dentro de un iframe reducido, no un
 * icono generico: entre cinco presentaciones, lo que las distingue es como se
 * ven, no su nombre de archivo. El iframe va con sandbox y sin
 * allow-same-origin, igual que el panel de artefactos, porque el HTML de
 * dentro lo escribio un modelo.
 */
export function ArtifactsModal({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<Artifact[] | null>(null);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [query, setQuery] = useState('');

  useEffect(() => {
    void (async () => {
      const res = await fetch('/api/artifacts');
      if (!res.ok) {
        setItems([]);
        return;
      }
      const data = (await res.json()) as { artifacts: Artifact[] };
      setItems(data.artifacts);

      // Las vistas previas se piden una a una y despues de la lista: son el
      // trozo pesado, y asi la rejilla aparece de inmediato y se va llenando.
      for (const a of data.artifacts.slice(0, 24)) {
        const r = await fetch(`/api/artifacts/${a.id}`);
        if (!r.ok) continue;
        const d = (await r.json()) as { previewHtml: string | null };
        if (d.previewHtml) setPreviews((prev) => ({ ...prev, [a.id]: d.previewHtml! }));
      }
    })();
  }, []);

  async function remove(id: string, name: string) {
    if (!confirm(`¿Borrar "${name}"? No se puede deshacer.`)) return;
    setItems((prev) => prev?.filter((a) => a.id !== id) ?? null);
    await fetch(`/api/artifacts/${id}`, { method: 'DELETE' });
  }

  const shown = (items ?? []).filter((a) => a.name.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <div className="backdrop" onClick={onClose}>
      <div
        className="modal wide"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Artefactos"
      >
        <div className="modal-head">
          <h2>Artefactos</h2>
        </div>

        <div className="modal-body">
          <p className="note" style={{ marginTop: 0 }}>
            Todo lo que NovaChat ha generado: documentos, presentaciones, hojas de cálculo
            y páginas. Se guardan enteros, así que siguen aquí semanas después.
          </p>

          <input
            className="input"
            placeholder="Buscar por nombre"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ marginBottom: 14 }}
          />

          {items === null && <p className="side-empty">Cargando…</p>}
          {items !== null && shown.length === 0 && (
            <p className="side-empty">
              {items.length === 0
                ? 'Todavía no has generado nada. Pide un documento, una presentación o una hoja de cálculo.'
                : 'Ningún artefacto con ese nombre.'}
            </p>
          )}

          <div className="art-grid">
            {shown.map((a) => (
              <div className="art-card" key={a.id}>
                <div className="art-thumb">
                  {previews[a.id] ? (
                    <iframe
                      title={a.name}
                      sandbox=""
                      srcDoc={previews[a.id]}
                      scrolling="no"
                      tabIndex={-1}
                    />
                  ) : (
                    <span className="art-kind">{KIND_LABEL[a.kind]}</span>
                  )}
                </div>
                <div className="art-meta">
                  <b title={a.name}>{a.name}</b>
                  <small>
                    {KIND_LABEL[a.kind]} · {size(a.bytes)} · {when(a.created_at)}
                  </small>
                </div>
                <div className="art-actions">
                  <a className="act" href={`/api/files/${a.id}`} download>
                    Descargar
                  </a>
                  <button className="act" onClick={() => void remove(a.id, a.name)} aria-label="Borrar">
                    <Trash size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="modal-foot">
          <button className="btn" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
