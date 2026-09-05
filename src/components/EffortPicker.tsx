'use client';

import { useEffect, useRef, useState } from 'react';

import { Check, Chevron } from './icons';
import type { ReasoningEffort } from './types';

const OPTIONS: { value: ReasoningEffort; label: string; hint: string }[] = [
  { value: null, label: 'Automático', hint: 'El proveedor decide cuanto piensa.' },
  { value: 'low', label: 'Bajo', hint: 'Respuestas rapidas, menos razonamiento.' },
  { value: 'medium', label: 'Medio', hint: 'Equilibrio entre velocidad y profundidad.' },
  { value: 'high', label: 'Alto', hint: 'Piensa mas a fondo; tarda mas en responder.' },
];

/**
 * Selector de esfuerzo de razonamiento, al estilo de claude.ai — pero suelto,
 * no anidado en un selector de modelo: Nova enruta siempre en automatico, asi
 * que no hace falta elegir modelo, solo cuanto se le deja pensar.
 */
export function EffortPicker({
  effort,
  onChange,
}: {
  effort: ReasoningEffort;
  onChange: (effort: ReasoningEffort) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = OPTIONS.find((o) => o.value === effort) ?? OPTIONS[0];

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('click', onClick);
    return () => window.removeEventListener('click', onClick);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="model-btn" onClick={() => setOpen((v) => !v)} title="Esfuerzo de razonamiento">
        <span>Esfuerzo: {current.label}</span>
        <Chevron size={13} />
      </button>

      {open && (
        <div className="pop" style={{ right: 0, top: 34, minWidth: 240 }}>
          {OPTIONS.map((opt) => (
            <button
              key={opt.label}
              className="pop-item"
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
              style={{ alignItems: 'flex-start', flexDirection: 'column', gap: 2 }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}>
                <span style={{ flex: 1, fontWeight: 600, color: 'var(--text)' }}>{opt.label}</span>
                {opt.value === effort && <Check size={13} />}
              </span>
              <small style={{ color: 'var(--text-3)', fontSize: 11.5 }}>{opt.hint}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
