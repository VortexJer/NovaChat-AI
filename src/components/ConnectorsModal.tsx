'use client';

import { useEffect, useState } from 'react';

import { Trash } from './icons';

type Connector = {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  hasToken: boolean;
  tools: number | null;
  lastError: string | null;
};

type Catalogo = { id: string; name: string; url: string; help: string };

/**
 * Conectores: servidores MCP cuyas herramientas puede usar el modelo.
 *
 * Es lo mismo que hay detras de los "Conectores" de claude.ai, con una
 * diferencia que conviene no esconder: alli Gmail, Drive y Slack se conectan de
 * un clic porque la aplicacion de OAuth es de Anthropic y Google y Slack se la
 * aprobaron. Eso no se puede reutilizar desde fuera. Lo que si funciona aqui
 * son los servidores MCP remotos que cada servicio publica y que se autentican
 * con un token tuyo, que es la mayoria.
 */
export function ConnectorsModal({ onClose }: { onClose: () => void }) {
  const [conectores, setConectores] = useState<Connector[] | null>(null);
  const [catalogo, setCatalogo] = useState<Catalogo[]>([]);
  const [filtro, setFiltro] = useState<'todo' | 'conectado' | 'no'>('todo');
  const [buscar, setBuscar] = useState('');

  const [nombre, setNombre] = useState('');
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [ayuda, setAyuda] = useState<string | null>(null);
  const [abierto, setAbierto] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    void cargar();
  }, []);

  async function cargar() {
    const res = await fetch('/api/connectors');
    if (!res.ok) {
      setConectores([]);
      return;
    }
    const d = await res.json();
    setConectores(d.connectors ?? []);
    setCatalogo(d.catalogo ?? []);
  }

  function empezar(c?: Catalogo) {
    setError(null);
    setAviso(null);
    setAbierto(true);
    setNombre(c?.name ?? '');
    setUrl(c?.url ?? '');
    setAyuda(c?.help ?? null);
    setToken('');
  }

  async function conectar() {
    setOcupado(true);
    setError(null);
    setAviso(null);
    try {
      const res = await fetch('/api/connectors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: nombre, url, token }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d.error ?? 'No se ha podido conectar.');
        return;
      }
      setAviso(`Conectado. ${d.tools} herramientas disponibles.`);
      setAbierto(false);
      setToken('');
      await cargar();
    } finally {
      setOcupado(false);
    }
  }

  async function encender(c: Connector, enabled: boolean) {
    setConectores((prev) => prev?.map((x) => (x.id === c.id ? { ...x, enabled } : x)) ?? prev);
    await fetch(`/api/connectors/${c.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    });
  }

  async function quitar(c: Connector) {
    setConectores((prev) => prev?.filter((x) => x.id !== c.id) ?? prev);
    await fetch(`/api/connectors/${c.id}`, { method: 'DELETE' });
  }

  const lista = (conectores ?? []).filter((c) => {
    if (filtro === 'conectado' && !c.enabled) return false;
    if (filtro === 'no' && c.enabled) return false;
    if (buscar && !c.name.toLowerCase().includes(buscar.toLowerCase())) return false;
    return true;
  });

  /** Los del catalogo que aun no estan puestos. */
  const sinPoner = catalogo.filter((c) => !(conectores ?? []).some((x) => x.url === c.url));

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Conectores">
        <div className="modal-head">
          <h2>Conectores</h2>
        </div>

        <div className="modal-body">
          <p className="note" style={{ marginTop: 0 }}>
            Servidores MCP cuyas herramientas puede usar NovaChat: leer tus incidencias,
            buscar en tu documentacion, abrir un repositorio. Cada uno se enciende y se
            apaga por separado, porque cada herramienta encendida viaja en todas las
            peticiones y de mas no hay: cuantas mas hay, peor elige el modelo.
          </p>

          {sinPoner.length > 0 && (
            <>
              <div className="model-group" style={{ paddingLeft: 0 }}>
                Listos para conectar
              </div>
              <div className="conn-popular">
                {sinPoner.map((c) => (
                  <div className="conn-card" key={c.id}>
                    <span>{c.name}</span>
                    <button className="act" onClick={() => empezar(c)}>
                      Conectar
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="conn-bar">
            <div className="conn-filtros">
              {(['todo', 'conectado', 'no'] as const).map((f) => (
                <button
                  key={f}
                  className={`act${filtro === f ? ' on' : ''}`}
                  onClick={() => setFiltro(f)}
                >
                  {f === 'todo' ? 'Todo' : f === 'conectado' ? 'Encendidos' : 'Apagados'}
                </button>
              ))}
            </div>
            <input
              className="input"
              placeholder="Buscar"
              value={buscar}
              onChange={(e) => setBuscar(e.target.value)}
              style={{ maxWidth: '14rem' }}
            />
          </div>

          {conectores === null && <p className="side-empty">Cargando…</p>}
          {conectores?.length === 0 && (
            <p className="side-empty">Todavia no hay ninguno.</p>
          )}

          {lista.map((c) => (
            <div className="result" key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <b>{c.name}</b>
                <small>
                  {c.lastError
                    ? c.lastError
                    : `${c.tools ?? '?'} herramientas · ${c.hasToken ? 'con token' : 'sin token'}`}
                </small>
              </span>

              <button
                className={`act${c.enabled ? ' on' : ''}`}
                onClick={() => void encender(c, !c.enabled)}
              >
                {c.enabled ? 'Encendido' : 'Apagado'}
              </button>

              <button className="act" aria-label="Quitar" onClick={() => void quitar(c)}>
                <Trash size={13} />
              </button>
            </div>
          ))}

          {abierto ? (
            <div className="conn-form">
              <div className="model-group" style={{ paddingLeft: 0 }}>
                Conector nuevo
              </div>
              <input
                className="input"
                placeholder="Nombre"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
              />
              <input
                className="input"
                placeholder="https://… (URL del servidor MCP)"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                style={{ marginTop: 6 }}
              />
              <input
                className="input"
                type="password"
                placeholder="Token (si lo pide)"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                style={{ marginTop: 6 }}
              />
              {ayuda && <p className="note">{ayuda}</p>}

              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <button className="btn primary" disabled={ocupado} onClick={() => void conectar()}>
                  {ocupado ? 'Probando…' : 'Conectar'}
                </button>
                <button className="btn" onClick={() => setAbierto(false)}>
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            <button className="act" style={{ marginTop: 10 }} onClick={() => empezar()}>
              Añadir conector personalizado
            </button>
          )}

          {error && <p className="note" style={{ color: 'var(--accent)' }}>{error}</p>}
          {aviso && <p className="note">{aviso}</p>}
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
