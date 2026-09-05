'use client';

const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform ?? navigator.userAgent);
const MOD = MAC ? '⌘' : 'Ctrl';

const GROUPS: { title: string; items: [string, string][] }[] = [
  {
    title: 'General',
    items: [
      [`${MOD} K`, 'Buscar conversaciones'],
      [`${MOD} Shift O`, 'Nueva conversación'],
      [`${MOD} B`, 'Mostrar u ocultar la barra lateral'],
      ['?', 'Esta ayuda'],
    ],
  },
  {
    title: 'Durante una respuesta',
    items: [
      ['Esc', 'Detener la respuesta en curso'],
      ['Esc', 'Cerrar un menú o la barra lateral, si no hay nada generándose'],
    ],
  },
  {
    title: 'Redactor',
    items: [
      ['Enter', 'Enviar el mensaje'],
      ['Shift Enter', 'Salto de línea'],
    ],
  },
];

export function KeyboardShortcutsModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Atajos de teclado">
        <div className="modal-head">
          <h2>Atajos de teclado</h2>
        </div>

        <div className="modal-body">
          {GROUPS.map((g) => (
            <div key={g.title} style={{ marginBottom: 18 }}>
              <div className="model-group" style={{ paddingLeft: 0 }}>
                {g.title}
              </div>
              {g.items.map(([keys, label]) => (
                <div
                  key={keys + label}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0' }}
                >
                  <span style={{ fontSize: 13.5, color: 'var(--text-2)' }}>{label}</span>
                  <span style={{ display: 'flex', gap: 4 }}>
                    {keys.split(' ').map((k) => (
                      <kbd
                        key={k}
                        style={{
                          fontFamily: 'var(--mono)',
                          fontSize: 11.5,
                          padding: '2px 7px',
                          background: 'var(--surface)',
                          border: '1px solid var(--border)',
                          color: 'var(--text)',
                        }}
                      >
                        {k}
                      </kbd>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          ))}
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
