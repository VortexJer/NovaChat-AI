'use client';

import { useEffect, useRef, useState } from 'react';

type Result = { id: string; title: string; snippet: string | null; updated_at: string };

export function SearchModal({
  onClose,
  onOpen,
}: {
  onClose: () => void;
  onOpen: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const [cursor, setCursor] = useState(0);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  // Antirrebote: sin esto se lanzaria una consulta por tecla pulsada.
  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }

    setSearching(true);
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query.trim())}`, {
          signal: controller.signal,
        });
        if (res.ok) {
          const { results } = await res.json();
          setResults(results);
          setCursor(0);
        }
      } catch {
        // Consulta cancelada porque el usuario siguio escribiendo.
      } finally {
        setSearching(false);
      }
    }, 220);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  return (
    <div className="backdrop" onClick={onClose}>
      <div
        className="modal"
        style={{ maxWidth: 560 }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Buscar conversaciones"
      >
        <div className="modal-head">
          <input
            ref={inputRef}
            className="search"
            placeholder="Buscar en tus conversaciones..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              // Navegacion con flechas y Enter, sin tocar el raton.
              if (e.key === 'Escape') onClose();
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setCursor((c) => Math.min(c + 1, results.length - 1));
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setCursor((c) => Math.max(c - 1, 0));
              }
              if (e.key === 'Enter' && results[cursor]) onOpen(results[cursor].id);
            }}
          />
        </div>

        <div className="modal-body" style={{ paddingTop: 8 }}>
          {query.trim().length < 2 ? (
            <p className="side-empty">Escribe al menos dos caracteres.</p>
          ) : searching && results.length === 0 ? (
            <p className="side-empty">Buscando...</p>
          ) : results.length === 0 ? (
            <p className="side-empty">Sin resultados para "{query.trim()}".</p>
          ) : (
            results.map((r, i) => (
              <button
                key={r.id}
                className={`result${i === cursor ? ' on' : ''}`}
                onMouseEnter={() => setCursor(i)}
                onClick={() => onOpen(r.id)}
              >
                <b>{r.title}</b>
                {r.snippet && <small>{r.snippet.replace(/\s+/g, ' ').trim()}</small>}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
