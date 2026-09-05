'use client';

import { useEffect, useState } from 'react';

import { Trash } from './icons';

type Skill = { name: string; description: string; builtin: boolean; edited: boolean };

/**
 * Las skills instaladas, y su texto.
 *
 * Las incorporadas tambien se editan: guardar una crea una copia tuya con el
 * mismo nombre que la sustituye, y "Restaurar" la borra y vuelve a valer la de
 * fabrica, que vive en el codigo y no se puede perder. Es lo que permite
 * retocar lo que trae la aplicacion sin miedo a romperlo.
 */
export function SkillsModal({ onClose }: { onClose: () => void }) {
  const [skills, setSkills] = useState<Skill[] | null>(null);
  const [open, setOpen] = useState<Skill | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [content, setContent] = useState('');
  const [original, setOriginal] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    const res = await fetch('/api/skills');
    setSkills(res.ok ? (await res.json()).skills : []);
  }

  async function openSkill(s: Skill) {
    setError(null);
    setOpen(s);
    setName(s.name);
    setDescription(s.description);
    const res = await fetch(`/api/skills/${encodeURIComponent(s.name)}`);
    if (res.ok) {
      const d = await res.json();
      setContent(d.content);
      setOriginal(d.original);
    }
  }

  function startNew() {
    setError(null);
    setOpen({ name: '', description: '', builtin: false, edited: false });
    setName('');
    setDescription('');
    setContent('');
    setOriginal(null);
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const nombre = name.trim();
      if (!nombre) {
        setError('Hace falta un nombre.');
        return;
      }
      const esNueva = !open?.name;
      const res = esNueva
        ? await fetch('/api/skills', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: nombre, description, content }),
          })
        : await fetch(`/api/skills/${encodeURIComponent(open!.name)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ description, content }),
          });

      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? 'No se ha podido guardar.');
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 1600);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function remove(s: Skill) {
    const aviso = s.builtin
      ? `¿Restaurar "${s.name}" a su texto original? Se pierde lo que hayas cambiado.`
      : `¿Borrar la skill "${s.name}"?`;
    if (!confirm(aviso)) return;

    await fetch(`/api/skills/${encodeURIComponent(s.name)}`, { method: 'DELETE' });
    if (open?.name === s.name) setOpen(null);
    await load();
  }

  const builtins = skills?.filter((s) => s.builtin) ?? [];
  const custom = skills?.filter((s) => !s.builtin) ?? [];

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Skills">
        <div className="modal-head">
          <h2>Skills</h2>
        </div>

        <div className="modal-body proj-split">
          <div className="proj-list">
            <p className="note" style={{ marginTop: 0 }}>
              Instrucciones reutilizables que el modelo carga solo cuando la tarea encaja
              con una de ellas. Puedes abrir cualquiera y cambiarle el texto.
            </p>

            <div className="model-group" style={{ paddingLeft: 0 }}>
              Incorporadas
            </div>
            {skills === null && <p className="side-empty">Cargando…</p>}
            {builtins.map((s) => (
              <div
                key={s.name}
                className={`result${open?.name === s.name ? ' on' : ''}`}
                onClick={() => void openSkill(s)}
                style={{ display: 'flex', alignItems: 'center', gap: 10 }}
              >
                <span style={{ flex: 1, minWidth: 0 }}>
                  <b>
                    {s.name}
                    {s.edited && <span className="tag" style={{ marginLeft: 8 }}>Editada</span>}
                  </b>
                  <small>{s.description}</small>
                </span>
                {s.edited && (
                  <button
                    className="act"
                    onClick={(e) => {
                      e.stopPropagation();
                      void remove(s);
                    }}
                  >
                    Restaurar
                  </button>
                )}
              </div>
            ))}

            <div className="model-group" style={{ paddingLeft: 0 }}>
              Tuyas
            </div>
            {custom.length === 0 && <p className="side-empty">Todavía no has añadido ninguna.</p>}
            {custom.map((s) => (
              <div
                key={s.name}
                className={`result${open?.name === s.name ? ' on' : ''}`}
                onClick={() => void openSkill(s)}
                style={{ display: 'flex', alignItems: 'center', gap: 10 }}
              >
                <span style={{ flex: 1, minWidth: 0 }}>
                  <b>{s.name}</b>
                  <small>{s.description}</small>
                </span>
                <button
                  className="act"
                  onClick={(e) => {
                    e.stopPropagation();
                    void remove(s);
                  }}
                  aria-label="Borrar"
                >
                  <Trash size={13} />
                </button>
              </div>
            ))}

            <button className="btn" style={{ marginTop: 10 }} onClick={startNew}>
              Añadir skill
            </button>
          </div>

          <div className="proj-detail">
            {!open && <p className="side-empty">Elige una skill para ver y editar su texto.</p>}

            {open && (
              <>
                {error && <div className="error">{error}</div>}

                {!open.name && (
                  <div className="field">
                    <label htmlFor="sk-name">Nombre</label>
                    <input
                      id="sk-name"
                      className="input"
                      placeholder="minusculas-y-guiones"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                    <p className="note">Así la escribirá el modelo al usarla.</p>
                  </div>
                )}

                <div className="field">
                  <label htmlFor="sk-desc">Descripción</label>
                  <input
                    id="sk-desc"
                    className="input"
                    placeholder="Una línea: para qué sirve"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                  <p className="note">
                    Es lo único que el modelo ve siempre; por eso decide con esto si cargar
                    la skill o no.
                  </p>
                </div>

                <div className="field">
                  <label htmlFor="sk-content">Instrucciones</label>
                  <textarea
                    id="sk-content"
                    className="textarea"
                    style={{ fontFamily: 'var(--mono)', fontSize: 12.5, minHeight: '18rem' }}
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                  />
                </div>

                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button className="btn primary" onClick={() => void save()} disabled={busy || !content.trim()}>
                    {saved ? 'Guardada' : 'Guardar'}
                  </button>
                  {open.builtin && original !== null && content !== original && (
                    <button className="btn" onClick={() => setContent(original)}>
                      Volver al texto original
                    </button>
                  )}
                </div>
              </>
            )}
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
