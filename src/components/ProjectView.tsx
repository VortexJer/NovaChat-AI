'use client';

import { useCallback, useEffect, useState } from 'react';

import { Composer } from './Composer';
import { Trash } from './icons';

type Project = {
  id: string;
  name: string;
  description: string | null;
  instructions: string | null;
  conversations: number;
  docs: number;
};

type Doc = { id: string; name: string; content: string };
type Conv = { id: string; title: string; updated_at: string };

/** "Ahora", "hace 20 min", "hace 3 h", o la fecha si ya es de otro dia. */
function cuando(iso: string): string {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'Ahora';
  if (min < 60) return `hace ${min} min`;
  if (min < 60 * 24) return `hace ${Math.round(min / 60)} h`;
  return new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
}

/**
 * Un proyecto: el sitio desde el que se chatea sobre un tema.
 *
 * La primera version de esto era una etiqueta que se le ponia a una
 * conversacion ya empezada, con un boton de "mover". Estaba mal: en claude.ai
 * un proyecto **tiene su propio compositor**, y las conversaciones nacen
 * dentro. Escribir aqui abre una conversacion nueva que ya lleva las
 * instrucciones y el contexto del proyecto, sin tener que acordarse de nada.
 */
export function ProjectView({
  project,
  onOpenConversation,
  onStart,
  onChanged,
  skills,
}: {
  project: Project;
  onOpenConversation: (id: string) => void;
  /** Arranca una conversacion del proyecto con este primer mensaje. */
  onStart: (projectId: string, text: string) => void | Promise<void>;
  onChanged: () => void;
  skills: { name: string; description: string }[];
}) {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [convs, setConvs] = useState<Conv[]>([]);
  const [instructions, setInstructions] = useState(project.instructions ?? '');
  const [editingInstructions, setEditingInstructions] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteName, setNoteName] = useState('');
  const [noteBody, setNoteBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [d, c] = await Promise.all([
      fetch(`/api/projects/${project.id}`).then((r) => (r.ok ? r.json() : { docs: [] })),
      fetch(`/api/projects/${project.id}/conversations`).then((r) => (r.ok ? r.json() : { conversations: [] })),
    ]);
    setDocs(d.docs ?? []);
    setConvs(c.conversations ?? []);
  }, [project.id]);

  useEffect(() => {
    setInstructions(project.instructions ?? '');
    setEditingInstructions(false);
    void load();
  }, [project.id, project.instructions, load]);

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${project.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) setDocs((await res.json()).docs ?? []);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function upload(list: FileList | null) {
    if (!list?.length) return;
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      for (const f of Array.from(list)) body.append('files', f);
      const res = await fetch(`/api/projects/${project.id}/upload`, { method: 'POST', body });
      const data = await res.json();
      if (data.docs) setDocs(data.docs);
      if (data.errors?.length) setError(data.errors.join(' '));
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="project-view">
      <div className="project-main">
        <div className="project-head">
          <h1>{project.name}</h1>
          {project.description && <p>{project.description}</p>}
        </div>

        <Composer
          disabled={false}
          streaming={false}
          skills={skills}
          onSend={(text) => onStart(project.id, text)}
          onStop={() => {}}
        />

        <p className="project-hint">
          Lo que escribas aquí abre una conversación del proyecto, con sus instrucciones
          y su contexto ya puestos.
        </p>

        {convs.length > 0 && (
          <div className="project-convs">
            <div className="model-group" style={{ paddingLeft: 0 }}>
              Recientes
            </div>
            {convs.map((c) => (
              <div className="result" key={c.id} onClick={() => onOpenConversation(c.id)}>
                <b>{c.title}</b>
                <small>{cuando(c.updated_at)}</small>
              </div>
            ))}
          </div>
        )}
      </div>

      <aside className="project-rail">
        <section>
          <header>
            <h2>Instrucciones</h2>
            {!editingInstructions && (
              <button className="act" onClick={() => setEditingInstructions(true)}>
                {instructions ? 'Editar' : 'Añadir'}
              </button>
            )}
          </header>

          {editingInstructions ? (
            <>
              <textarea
                className="textarea"
                style={{ fontFamily: 'var(--font)', minHeight: '8rem' }}
                placeholder="El tono, el cliente, lo que nunca hay que olvidar en este proyecto."
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
              />
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                <button
                  className="btn primary"
                  disabled={busy}
                  onClick={async () => {
                    await patch({ instructions });
                    setEditingInstructions(false);
                  }}
                >
                  Guardar
                </button>
                <button
                  className="btn"
                  onClick={() => {
                    setInstructions(project.instructions ?? '');
                    setEditingInstructions(false);
                  }}
                >
                  Cancelar
                </button>
              </div>
            </>
          ) : (
            <p className="rail-note">
              {instructions || 'Se le dan al modelo en cada conversación del proyecto.'}
            </p>
          )}
        </section>

        <section>
          <header>
            <h2>Contexto</h2>
            <label className="act" style={{ cursor: 'pointer' }}>
              Subir
              <input
                type="file"
                multiple
                style={{ display: 'none' }}
                onChange={(e) => {
                  void upload(e.target.files);
                  e.target.value = '';
                }}
              />
            </label>
          </header>

          {docs.length === 0 && !noteOpen && (
            <p className="rail-note">
              PDF, Word, PowerPoint, Excel, texto o código. Se consulta en cada
              conversación del proyecto.
            </p>
          )}

          {docs.map((d) => (
            <div className="result" key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <b>{d.name}</b>
                <small>{d.content.length.toLocaleString('es-ES')} caracteres</small>
              </span>
              <button className="act" onClick={() => void patch({ removeDoc: d.id })} aria-label="Quitar">
                <Trash size={13} />
              </button>
            </div>
          ))}

          {error && <p className="rail-note" style={{ color: 'var(--accent)' }}>{error}</p>}

          {noteOpen ? (
            <>
              <input
                className="input"
                placeholder="Nombre de la nota"
                value={noteName}
                onChange={(e) => setNoteName(e.target.value)}
                style={{ marginTop: 8 }}
              />
              <textarea
                className="textarea"
                style={{ fontFamily: 'var(--font)', minHeight: '6rem', marginTop: 6 }}
                placeholder="Pega aquí el texto."
                value={noteBody}
                onChange={(e) => setNoteBody(e.target.value)}
              />
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                <button
                  className="btn primary"
                  disabled={busy || !noteBody.trim()}
                  onClick={async () => {
                    await patch({ doc: { name: noteName || 'Nota', content: noteBody } });
                    setNoteName('');
                    setNoteBody('');
                    setNoteOpen(false);
                  }}
                >
                  Añadir
                </button>
                <button className="btn" onClick={() => setNoteOpen(false)}>
                  Cancelar
                </button>
              </div>
            </>
          ) : (
            <button className="act" style={{ marginTop: 8 }} onClick={() => setNoteOpen(true)}>
              O pegar texto
            </button>
          )}
        </section>
      </aside>
    </div>
  );
}
