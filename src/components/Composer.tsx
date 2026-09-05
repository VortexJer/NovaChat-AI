'use client';

import { useEffect, useRef, useState } from 'react';

import { Mic, Paperclip, Send, Stop, Trash } from './icons';

type Attachment = { name: string; text: string; truncated?: boolean };

export function Composer({
  disabled,
  streaming,
  onSend,
  onStop,
  initialValue = '',
  lastUsedWebSearch = false,
  skills = [],
}: {
  disabled: boolean;
  streaming: boolean;
  onSend: (text: string) => void | Promise<void>;
  onStop: () => void;
  initialValue?: string;
  /** La ultima respuesta busco en internet: se avisa de verificar las fuentes. */
  lastUsedWebSearch?: boolean;
  /** Para el desplegable de "/", al estilo del selector de skill de claude.ai. */
  skills?: { name: string; description: string }[];
}) {
  const [value, setValue] = useState(initialValue);
  const [files, setFiles] = useState<Attachment[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [listening, setListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [skillHighlight, setSkillHighlight] = useState(0);
  const ref = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  // "/" al principio y sin espacios: se esta escribiendo un comando de barra
  // para invocar una skill directamente, igual que el "/skill-creator" de
  // claude.ai en vez de esperar a que el modelo decida usarla sola.
  const slashMatch = /^\/(\S*)$/.exec(value);
  const skillMatches = slashMatch
    ? skills.filter((s) => s.name.toLowerCase().includes(slashMatch[1].toLowerCase())).slice(0, 6)
    : [];
  const skillMenuOpen = skillMatches.length > 0;

  useEffect(() => {
    setSkillHighlight(0);
  }, [slashMatch?.[1]]);

  function pickSkill(name: string) {
    setValue(`Usa la skill ${name} para: `);
    ref.current?.focus();
  }

  // El reconocimiento de voz del navegador solo existe en Chrome y derivados,
  // asi que el boton solo aparece donde de verdad funciona en vez de fallar al
  // pulsarlo. Se comprueba en un efecto porque en el servidor no hay `window` y
  // renderizarlo distinto en cliente daria un desajuste de hidratacion.
  useEffect(() => {
    const w = window as unknown as {
      SpeechRecognition?: SpeechRecognitionCtor;
      webkitSpeechRecognition?: SpeechRecognitionCtor;
    };
    setSpeechSupported(Boolean(w.SpeechRecognition ?? w.webkitSpeechRecognition));
  }, []);

  function startDictation() {
    const w = window as unknown as {
      SpeechRecognition?: SpeechRecognitionCtor;
      webkitSpeechRecognition?: SpeechRecognitionCtor;
    };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) return;

    const recognition = new Ctor();
    recognition.lang = navigator.language || 'es-ES';
    recognition.continuous = true;
    recognition.interimResults = false;

    recognition.onresult = (event) => {
      // Solo los resultados definitivos nuevos: sin el indice, cada evento
      // reescribiria desde el principio y el texto saldria duplicado.
      let addition = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) addition += event.results[i][0].transcript;
      }
      if (addition) setValue((prev) => (prev ? `${prev} ${addition.trim()}` : addition.trim()));
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);

    recognition.start();
    recognitionRef.current = recognition;
    setListening(true);
  }

  function stopDictation() {
    recognitionRef.current?.stop();
    setListening(false);
  }

  // Si el componente desaparece con el microfono abierto, el navegador dejaria
  // el indicador de grabacion encendido.
  useEffect(() => () => recognitionRef.current?.stop(), []);

  // Altura automatica: se resetea a auto antes de medir, porque scrollHeight
  // nunca decrece si la altura fijada sigue puesta y el campo no encogeria al
  // borrar texto.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 256)}px`;
  }, [value]);

  useEffect(() => {
    if (!streaming) ref.current?.focus();
  }, [streaming]);

  function submit() {
    const body = value.trim();
    if (!body && files.length === 0) return;
    if (disabled) return;

    // Los adjuntos van delante, delimitados y con su nombre, para que el modelo
    // sepa donde empieza y acaba cada uno y no confunda su contenido con la
    // pregunta.
    const parts = files.map((f) => `<archivo nombre="${f.name}">\n${f.text}\n</archivo>`);
    const text = [...parts, body].filter(Boolean).join('\n\n');

    void onSend(text);
    setValue('');
    setFiles([]);
  }

  /**
   * Adjunta archivos.
   *
   * El texto lo saca el servidor, no el navegador: un PDF o un .docx no son
   * texto, hay que abrirlos. Antes se leian con `file.text()` y por eso solo
   * colaban los de texto plano — de ahi que no dejara subir casi nada. Es el
   * mismo extractor que usa el contexto de los proyectos.
   */
  async function addFiles(list: FileList | File[]) {
    const arr = Array.from(list);
    if (!arr.length) return;

    setReading(true);
    setNotice(null);
    try {
      const body = new FormData();
      for (const f of arr) body.append('files', f);

      const res = await fetch('/api/attachments', { method: 'POST', body });
      if (!res.ok) {
        setNotice('No se han podido leer los archivos.');
        return;
      }
      const data = (await res.json()) as { files: Attachment[]; errors: string[] };
      if (data.files.length) setFiles((prev) => [...prev, ...data.files]);

      const recortados = data.files.filter((f) => f.truncated).map((f) => f.name);
      setNotice(
        [
          data.errors.join(' '),
          recortados.length ? `Recortado por largo: ${recortados.join(', ')}.` : '',
        ]
          .filter(Boolean)
          .join(' ') || null,
      );
    } finally {
      setReading(false);
    }
  }

  return (
    <div
      className="composer"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        void addFiles(e.dataTransfer.files);
      }}
    >
      {reading && (
        <p className="note" style={{ padding: '10px 12px 0', margin: 0 }}>
          Leyendo los archivos…
        </p>
      )}
      {files.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '10px 12px 0' }}>
          {files.map((f, i) => (
            <span
              key={`${f.name}-${i}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '3px 6px 3px 9px',
                borderRadius: 6,
                border: '1px solid var(--border)',
                background: 'var(--surface-2)',
                fontSize: 12,
                color: 'var(--text-2)',
              }}
            >
              {f.name}
              {f.truncated && <span style={{ color: 'var(--text-3)' }}>(recortado)</span>}
              <button
                aria-label={`Quitar ${f.name}`}
                onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                style={{ display: 'grid', placeItems: 'center', color: 'var(--text-3)' }}
              >
                <Trash size={12} />
              </button>
            </span>
          ))}
        </div>
      )}

      {notice && (
        <p style={{ margin: 0, padding: '8px 12px 0', fontSize: 12, color: 'var(--text-3)' }}>
          {notice}
        </p>
      )}

      {skillMenuOpen && (
        <div className="skill-menu" role="listbox">
          {skillMatches.map((s, i) => (
            <button
              key={s.name}
              type="button"
              role="option"
              aria-selected={i === skillHighlight}
              className={i === skillHighlight ? 'on' : ''}
              onMouseEnter={() => setSkillHighlight(i)}
              onClick={() => pickSkill(s.name)}
            >
              <span className="skill-menu-name">/{s.name}</span>
              <span className="skill-menu-desc">{s.description}</span>
            </button>
          ))}
        </div>
      )}

      <textarea
        ref={ref}
        rows={1}
        placeholder="Escribe un mensaje... ('/' para usar una skill)"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (skillMenuOpen) {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setSkillHighlight((i) => (i + 1) % skillMatches.length);
              return;
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              setSkillHighlight((i) => (i - 1 + skillMatches.length) % skillMatches.length);
              return;
            }
            if ((e.key === 'Enter' || e.key === 'Tab') && !e.nativeEvent.isComposing) {
              e.preventDefault();
              pickSkill(skillMatches[skillHighlight].name);
              return;
            }
            if (e.key === 'Escape') {
              e.preventDefault();
              setValue('');
              return;
            }
          }

          // Enter envia, Shift+Enter salta linea. Es lo que espera cualquiera
          // que venga de otro cliente de chat.
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
        onPaste={(e) => {
          const dropped = Array.from(e.clipboardData.files);
          if (dropped.length) {
            e.preventDefault();
            void addFiles(dropped);
          }
        }}
      />

      <div className="composer-bar">
        <label
          className="act icon-only"
          style={{ cursor: 'pointer' }}
          title="Adjuntar archivo (PDF, Word, PowerPoint, Excel, texto...)"
          aria-label="Adjuntar archivo"
        >
          <Paperclip size={15} />
          <input
            type="file"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) void addFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </label>

        {speechSupported && (
          <button
            className="act icon-only"
            onClick={() => (listening ? stopDictation() : startDictation())}
            title={listening ? 'Escuchando...' : 'Dictar'}
            aria-label={listening ? 'Escuchando' : 'Dictar'}
            style={listening ? { color: 'var(--accent)' } : undefined}
          >
            {listening && <span className="pulse" />}
            <Mic size={15} />
          </button>
        )}

        <span className="hint">
          {lastUsedWebSearch ? (
            'Verifica las fuentes citadas.'
          ) : (
            <>
              <kbd>Enter</kbd> enviar · <kbd>Shift</kbd>+<kbd>Enter</kbd> salto
            </>
          )}
        </span>

        {streaming ? (
          <button className="stop" onClick={onStop}>
            <Stop /> Detener
          </button>
        ) : (
          <button
            className="send"
            onClick={submit}
            disabled={disabled || (!value.trim() && files.length === 0)}
            aria-label="Enviar"
          >
            <Send />
          </button>
        )}
      </div>
    </div>
  );
}
