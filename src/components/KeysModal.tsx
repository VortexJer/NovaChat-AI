'use client';

import { useEffect, useState } from 'react';

type ProviderStatus = {
  id: string;
  name: string;
  kind: 'web' | 'imagen';
  help: string;
  configured: boolean;
  fromEnv: boolean;
};

export function KeysModal({ onClose, onSaved }: { onClose: () => void; onSaved?: () => void }) {
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [encrypted, setEncrypted] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    const res = await fetch('/api/keys');
    if (!res.ok) return;
    const data = await res.json();
    setProviders(data.providers);
    setEncrypted(data.encrypted);
  }

  async function save() {
    setBusy(true);
    try {
      // Solo se envian los campos que se han tocado. Un campo vacio que no se
      // toco no debe borrar una clave ya guardada.
      const touched = Object.fromEntries(
        Object.entries(values).filter(([, v]) => v !== undefined),
      );
      await fetch('/api/keys', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keys: touched }),
      });
      setValues({});
      await load();
      onSaved?.();
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
    } finally {
      setBusy(false);
    }
  }

  const web = providers.filter((p) => p.kind === 'web');
  const images = providers.filter((p) => p.kind === 'imagen');

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Claves de servicios">
        <div className="modal-head">
          <h2>Herramientas de busqueda</h2>
        </div>

        <div className="modal-body">
          <p className="note" style={{ marginTop: 0 }}>
            Con al menos una clave de busqueda web, NovaChat puede buscar en
            internet y leer paginas cuando lo necesite. Con una de imagenes,
            puede buscar fotografias. Activa las herramientas en la barra
            superior de cada conversacion.
          </p>

          <p className="note">
            {encrypted
              ? 'Las claves se guardan cifradas con AES-256-GCM.'
              : 'Las claves se guardan sin cifrar. Define SECRETS_KEY en el servidor para cifrarlas.'}
          </p>

          <Section title="Busqueda web" providers={web} values={values} setValues={setValues} />
          <Section title="Imagenes" providers={images} values={values} setValues={setValues} />
        </div>

        <div className="modal-foot">
          <button className="btn" onClick={onClose}>
            Cerrar
          </button>
          <button className="btn primary" onClick={() => void save()} disabled={busy}>
            {saved ? 'Guardado' : busy ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  providers,
  values,
  setValues,
}: {
  title: string;
  providers: ProviderStatus[];
  values: Record<string, string>;
  setValues: (fn: (prev: Record<string, string>) => Record<string, string>) => void;
}) {
  if (providers.length === 0) return null;

  return (
    <>
      <div className="model-group" style={{ paddingLeft: 0 }}>
        {title}
      </div>

      {providers.map((p) => (
        <div className="field" key={p.id}>
          <label htmlFor={`key-${p.id}`}>
            {p.name}
            {p.configured && (
              <span className="tag" style={{ marginLeft: 8 }}>
                {p.fromEnv ? 'desde el entorno' : 'configurada'}
              </span>
            )}
          </label>
          <input
            id={`key-${p.id}`}
            className="input"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder={p.configured ? 'Guardada. Escribe para reemplazarla.' : 'Pega aqui la clave'}
            value={values[p.id] ?? ''}
            onChange={(e) => setValues((prev) => ({ ...prev, [p.id]: e.target.value }))}
          />
          <p className="note">
            {p.help}
            {p.configured && ' Deja el campo vacio para no tocarla; borra el contenido y guarda para eliminarla.'}
          </p>
        </div>
      ))}
    </>
  );
}
