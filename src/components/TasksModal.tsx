'use client';

import { useEffect, useState } from 'react';

import { Trash } from './icons';

type Cadence = 'diaria' | 'laborables' | 'semanal';

type Task = {
  id: string;
  name: string;
  prompt: string;
  cadence: Cadence;
  hour: number;
  enabled: boolean;
  last_run: string | null;
  next_run: string;
};

const CADENCE_LABEL: Record<Cadence, string> = {
  diaria: 'Todos los días',
  laborables: 'Días laborables',
  semanal: 'Cada lunes',
};

/** Plantillas, como las que claude.ai enseña cuando no hay ninguna tarea. */
const TEMPLATES: { name: string; prompt: string; cadence: Cadence; hour: number }[] = [
  {
    name: 'Resumen diario',
    prompt: 'Busca las noticias mas importantes de hoy sobre inteligencia artificial y hazme un resumen de cinco puntos, con la fuente de cada uno.',
    cadence: 'laborables',
    hour: 8,
  },
  {
    name: 'Revisión semanal',
    prompt: 'Repasa mis conversaciones de esta semana con buscar_historial y hazme un resumen de en que he estado trabajando y que quedo a medias.',
    cadence: 'semanal',
    hour: 16,
  },
  {
    name: 'Vigilar un tema',
    prompt: 'Busca si ha salido algo nuevo sobre [tema] en los ultimos dias. Si no hay nada relevante, dilo en una linea.',
    cadence: 'diaria',
    hour: 9,
  },
];

const when = (iso: string) =>
  new Date(iso).toLocaleString('es-ES', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export function TasksModal({ onClose }: { onClose: () => void }) {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [cadence, setCadence] = useState<Cadence>('laborables');
  const [hour, setHour] = useState(8);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const res = await fetch('/api/tasks');
      setTasks(res.ok ? (await res.json()).tasks : []);
    })();
  }, []);

  async function send(method: string, body?: unknown, qs = '') {
    setBusy(true);
    try {
      const res = await fetch(`/api/tasks${qs}`, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (res.ok) setTasks((await res.json()).tasks);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Programado">
        <div className="modal-head">
          <h2>Programado</h2>
        </div>

        <div className="modal-body">
          <p className="note" style={{ marginTop: 0 }}>
            Un encargo y su horario. A su hora se abre una conversación nueva con él,
            igual que si lo hubieras escrito tú, y te la encuentras en el historial.
          </p>

          {tasks === null && <p className="side-empty">Cargando…</p>}
          {tasks?.length === 0 && <p className="side-empty">Aún no hay tareas programadas.</p>}

          {tasks?.map((t) => (
            <div className="result" key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'default' }}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <b style={{ opacity: t.enabled ? 1 : 0.5 }}>{t.name}</b>
                <small>
                  {CADENCE_LABEL[t.cadence]} a las {t.hour}:00 ·{' '}
                  {t.enabled ? `próxima: ${when(t.next_run)}` : 'en pausa'}
                </small>
              </span>
              <button className="act" onClick={() => void send('PATCH', { id: t.id, enabled: !t.enabled })} disabled={busy}>
                {t.enabled ? 'Pausar' : 'Activar'}
              </button>
              <button className="act" onClick={() => void send('DELETE', undefined, `?id=${t.id}`)} aria-label="Borrar">
                <Trash size={13} />
              </button>
            </div>
          ))}

          <div className="model-group" style={{ paddingLeft: 0, marginTop: 16 }}>
            Nueva tarea
          </div>

          {tasks?.length === 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
              {TEMPLATES.map((t) => (
                <button
                  key={t.name}
                  className="act"
                  onClick={() => {
                    setName(t.name);
                    setPrompt(t.prompt);
                    setCadence(t.cadence);
                    setHour(t.hour);
                  }}
                >
                  {t.name}
                </button>
              ))}
            </div>
          )}

          <div className="field">
            <label htmlFor="task-name">Nombre</label>
            <input id="task-name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="field">
            <label htmlFor="task-prompt">Encargo</label>
            <textarea
              id="task-prompt"
              className="textarea"
              style={{ fontFamily: 'var(--font)', minHeight: '6rem' }}
              placeholder="Lo que quieres que haga, escrito como se lo dirías en el chat."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="task-cadence">Cada</label>
              <select
                id="task-cadence"
                className="input"
                value={cadence}
                onChange={(e) => setCadence(e.target.value as Cadence)}
              >
                <option value="diaria">Todos los días</option>
                <option value="laborables">Días laborables</option>
                <option value="semanal">Cada lunes</option>
              </select>
            </div>
            <div className="field" style={{ width: 110 }}>
              <label htmlFor="task-hour">Hora (UTC)</label>
              <input
                id="task-hour"
                className="input"
                type="number"
                min={0}
                max={23}
                value={hour}
                onChange={(e) => setHour(Number(e.target.value))}
              />
            </div>
          </div>

          <button
            className="btn primary"
            disabled={busy || !name.trim() || !prompt.trim()}
            onClick={async () => {
              await send('POST', { name, prompt, cadence, hour });
              setName('');
              setPrompt('');
            }}
          >
            Programar
          </button>
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
