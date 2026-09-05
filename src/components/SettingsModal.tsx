'use client';

import { useEffect, useState } from 'react';

import { PROMPT_PRESETS } from '@/lib/prompt';

import { Logout } from './icons';

type ClaudePrompt = { id: string; name: string };

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const [prompt, setPrompt] = useState('');
  const [preset, setPreset] = useState('default');
  const [temperature, setTemperature] = useState(1);
  const [displayName, setDisplayName] = useState('');
  const [aboutYou, setAboutYou] = useState('');
  const [instructions, setInstructions] = useState('');
  const [reducedMotion, setReducedMotion] = useState(false);
  const [adaptIdentity, setAdaptIdentity] = useState(true);

  const [published, setPublished] = useState<ClaudePrompt[]>([]);
  const [loadingPrompt, setLoadingPrompt] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void (async () => {
      const res = await fetch('/api/settings');
      if (!res.ok) return;
      const { settings } = await res.json();
      if (!settings) return;

      // null en base de datos significa "usa el de fabrica"; una cadena vacia
      // guardada a proposito es el preset "Sin prompt".
      setPrompt(settings.system_prompt ?? PROMPT_PRESETS[0].prompt);
      setTemperature(settings.temperature ?? 1);
      setDisplayName(settings.display_name ?? '');
      setAboutYou(settings.about_you ?? '');
      setInstructions(settings.instructions ?? '');
      setReducedMotion(Boolean(settings.reduced_motion));
    })();

    // La lista de prompts publicados se pide aparte: si Anthropic no responde,
    // los ajustes siguen funcionando igual.
    void (async () => {
      const res = await fetch('/api/prompts');
      if (res.ok) {
        const { entries } = await res.json();
        setPublished(entries ?? []);
      }
    })();
  }, []);

  async function loadPublished(id: string) {
    setLoadingPrompt(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/prompts?id=${encodeURIComponent(id)}`);
      const data = await res.json();
      if (!res.ok || !data.text) {
        setNotice(data.error ?? 'No se ha podido descargar ese prompt.');
        return;
      }
      setPrompt(adaptIdentity ? adapt(data.text) : data.text);
      setPreset('claude');
      setNotice(
        adaptIdentity
          ? 'Cargado y adaptado: se ha quitado la informacion de productos de Anthropic y el nombre.'
          : 'Cargado tal cual. Ojo: el modelo dira que es Claude y que tiene funciones que aqui no existen.',
      );
    } finally {
      setLoadingPrompt(false);
    }
  }

  async function save() {
    await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemPrompt: prompt,
        temperature,
        displayName,
        aboutYou,
        instructions,
        reducedMotion,
      }),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  }

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Personalizar">
        <div className="modal-head">
          <h2>Personalizar</h2>
          <button className="act" onClick={() => void logout()}>
            <Logout size={14} /> Cerrar sesion
          </button>
        </div>

        <div className="modal-body">
          <div className="model-group" style={{ paddingLeft: 0, marginTop: 0 }}>
            Sobre ti
          </div>

          <div className="field">
            <label htmlFor="pers-name">¿Cómo quieres que te llame?</label>
            <input
              id="pers-name"
              className="input"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Tu nombre"
            />
          </div>

          <div className="field">
            <label htmlFor="pers-about">¿A qué te dedicas?</label>
            <input
              id="pers-about"
              className="input"
              value={aboutYou}
              onChange={(e) => setAboutYou(e.target.value)}
              placeholder="Estudiante de informática, monto una app de chat propia…"
            />
          </div>

          <div className="field">
            <label htmlFor="pers-inst">Instrucciones permanentes</label>
            <textarea
              id="pers-inst"
              className="textarea"
              style={{ fontFamily: 'var(--font)', minHeight: '6rem' }}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="Responde en español, ve al grano, no me des rodeos antes de la respuesta…"
            />
            <p className="note">
              Van en todas las conversaciones, aparte del prompt de sistema: si cambias
              el prompt para probar algo, esto no se pierde.
            </p>
          </div>

          <div className="field">
            <label htmlFor="pers-motion" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                id="pers-motion"
                type="checkbox"
                checked={reducedMotion}
                onChange={(e) => setReducedMotion(e.target.checked)}
              />
              Movimiento reducido
            </label>
            <p className="note">Quita el suavizado de la escritura: el texto aparece de golpe según llega.</p>
          </div>

          <div className="model-group" style={{ paddingLeft: 0 }}>
            Avanzado
          </div>

          <div className="field">
            <label>Prompt de sistema</label>
            <div className="preset-grid">
              {PROMPT_PRESETS.map((p) => (
                <button
                  key={p.id}
                  className={`preset${preset === p.id ? ' on' : ''}`}
                  onClick={() => {
                    setPreset(p.id);
                    setPrompt(p.prompt);
                    setNotice(null);
                  }}
                >
                  <b>{p.name}</b>
                  <small>{p.description}</small>
                </button>
              ))}
            </div>

            <textarea
              className="textarea"
              value={prompt}
              onChange={(e) => {
                setPrompt(e.target.value);
                setPreset('custom');
              }}
              placeholder="Sin prompt de sistema."
            />
            <p className="note">
              {'{{currentDate}}'} se sustituye por la fecha de hoy en cada mensaje.
            </p>
          </div>

          {published.length > 0 && (
            <div className="field">
              <label>Prompts publicados de Claude</label>
              <p className="note" style={{ marginTop: 0, marginBottom: 8 }}>
                Anthropic publica los prompts de sistema de claude.ai en sus notas
                de version. Se descargan de ahi, siempre la version vigente.
              </p>

              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  marginBottom: 10,
                  fontWeight: 400,
                  color: 'var(--text-2)',
                  fontSize: 13,
                }}
              >
                <input
                  type="checkbox"
                  checked={adaptIdentity}
                  onChange={(e) => setAdaptIdentity(e.target.checked)}
                  style={{ accentColor: 'var(--accent)' }}
                />
                Adaptar identidad y quitar los datos de productos de Anthropic
              </label>

              <select
                className="input"
                disabled={loadingPrompt}
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) void loadPublished(e.target.value);
                  e.target.value = '';
                }}
              >
                <option value="">
                  {loadingPrompt ? 'Descargando...' : 'Elegir version para cargar...'}
                </option>
                {published.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>

              {notice && <p className="note">{notice}</p>}
            </div>
          )}

          <div className="field">
            <label htmlFor="temp">Temperatura: {temperature.toFixed(2)}</label>
            <input
              id="temp"
              className="range"
              type="range"
              min={0}
              max={2}
              step={0.05}
              value={temperature}
              onChange={(e) => setTemperature(Number(e.target.value))}
            />
            <p className="note">
              Baja es mas literal y repetible; alta, mas variada. 1 es el valor
              normal.
            </p>
          </div>
        </div>

        <div className="modal-foot">
          <button className="btn" onClick={onClose}>
            Cerrar
          </button>
          <button className="btn primary" onClick={() => void save()}>
            {saved ? 'Guardado' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  );
}

async function logout() {
  await fetch('/api/auth/logout', { method: 'POST' });
  location.href = '/login';
}

/**
 * Quita de un prompt de Claude lo que aqui seria falso.
 *
 * Las secciones de conducta (tono, formato, incertidumbre, evenhandedness)
 * funcionan igual de bien en cualquier modelo. Las de producto no: describen
 * la API de Anthropic, Claude Code, Artifacts, busqueda web y avisos internos
 * que en NovaChat no existen. Dejarlas hace que el modelo afirme tener
 * funciones que no tiene, que es peor que no darle prompt.
 */
function adapt(text: string): string {
  const drop = [
    'product_information',
    'fable_safeguards_routing',
    'anthropic_reminders',
    'artifacts_info',
    'search_instructions',
    'citation_instructions',
    'election_info',
  ];

  let out = text;
  for (const tag of drop) {
    out = out.replace(new RegExp(`<${tag}>[\\s\\S]*?</${tag}>\\s*`, 'g'), '');
  }

  return out
    .replace(/\bClaude\b/g, 'NovaChat')
    .replace(/\bAnthropic\b/g, 'NovaChat')
    .replace(/\{\{currentDateTime\}\}/g, '{{currentDate}}')
    .trim();
}
