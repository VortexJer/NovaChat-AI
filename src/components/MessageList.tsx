'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { Check, ChevronLeft, ChevronRight, Copy, NovaMark, Paperclip, Pencil, Refresh, Spark, Speaker, SpeakerOff } from './icons';
import { StreamingBody } from './StreamingBody';
import { Markdown } from './Markdown';
import { Trace } from './Trace';
import type { Message } from './types';

/**
 * Separa los adjuntos del mensaje escrito.
 *
 * Lo que se manda al modelo lleva el texto entero del archivo delante, entre
 * etiquetas. Pintar eso tal cual en el hilo llenaba la pantalla con veinte mil
 * caracteres de un .docx y escondia la pregunta. Aqui se sacan para enseñarlos
 * como una ficha que se abre si se quiere ver.
 */
const ATTACHMENT = /<archivo nombre="([^"]*)">\n([\s\S]*?)\n<\/archivo>/g;

function splitAttachments(content: string): { files: { name: string; text: string }[]; text: string } {
  const files: { name: string; text: string }[] = [];
  const text = content.replace(ATTACHMENT, (_m, name: string, body: string) => {
    files.push({ name, text: body });
    return '';
  });
  return { files, text: text.trim() };
}

function Attachment({ file }: { file: { name: string; text: string } }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`chip-file${open ? ' open' : ''}`}>
      <button onClick={() => setOpen((v) => !v)}>
        <Paperclip size={13} />
        <span>{file.name}</span>
        <small>{file.text.length.toLocaleString('es-ES')} caracteres</small>
      </button>
      {open && <pre>{file.text}</pre>}
    </div>
  );
}

/**
 * Agrupa mensajes de asistente consecutivos que comparten `reply_to`: son
 * versiones del mismo turno (la original y sus reintentos), no turnos
 * distintos, y se pintan como un unico bloque con selector de version.
 */
type Group = { kind: 'user'; message: Message } | { kind: 'assistant'; versions: Message[] };

function groupMessages(messages: Message[]): Group[] {
  const groups: Group[] = [];
  for (const m of messages) {
    if (m.role === 'user') {
      groups.push({ kind: 'user', message: m });
      continue;
    }
    const last = groups[groups.length - 1];
    if (last?.kind === 'assistant' && m.reply_to && last.versions[0]?.reply_to === m.reply_to) {
      last.versions.push(m);
    } else {
      groups.push({ kind: 'assistant', versions: [m] });
    }
  }
  return groups;
}

export function MessageList({
  messages,
  pending,
  streaming,
  slow,
  toolRunning,
  pendingStartedAt,
  error,
  incognito,
  greeting,
  onRetry,
  onEdit,
  versionSelection,
  onSelectVersion,
}: {
  messages: Message[];
  pending: Message | null;
  streaming: boolean;
  slow: boolean;
  toolRunning?: string | null;
  pendingStartedAt?: number | null;
  error: string | null;
  incognito?: boolean;
  greeting?: string;
  onRetry: (assistantId?: string) => void;
  onEdit?: (id: string, text: string) => void;
  versionSelection?: Record<string, number>;
  onSelectVersion?: (replyTo: string, versionIndex: number) => void;
}) {
  const threadRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const groups = useMemo(() => groupMessages(messages), [messages]);

  // El scroll sigue al streaming, pero se suelta en cuanto el usuario sube a
  // releer: arrastrarlo de vuelta hacia abajo mientras lee es de lo que mas
  // molesta en un cliente de chat.
  useEffect(() => {
    const el = threadRef.current;
    if (!el) return;

    const onScroll = () => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      stickRef.current = distance < 120;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const el = threadRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages, pending?.content, pending?.reasoning]);

  const empty = messages.length === 0 && !pending;

  return (
    <div className="thread" ref={threadRef}>
      {empty ? (
        <div className="empty">
          <NovaMark size={56} id="empty-mark" />
          <h2>{greeting ?? 'En que estas trabajando?'}</h2>
          <p>
            {incognito
              ? 'Conversacion de incognito: no se guardara nada al salir.'
              : 'Escribe algo para empezar.'}
          </p>
        </div>
      ) : (
        <div className="thread-inner">
          {groups.map((g, gi) => {
            if (g.kind === 'user') {
              const m = g.message;
              const attached = splitAttachments(m.content);
              return (
                <div className="msg user" key={`u-${m.id}`}>
                  {editing === m.id ? (
                    <div style={{ width: '100%' }}>
                      <textarea
                        className="textarea"
                        style={{ fontFamily: 'var(--font)', fontSize: 15, minHeight: '6rem' }}
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        autoFocus
                      />
                      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
                        <button className="btn" onClick={() => setEditing(null)}>
                          Cancelar
                        </button>
                        <button
                          className="btn primary"
                          onClick={() => {
                            setEditing(null);
                            onEdit?.(m.id, draft);
                          }}
                        >
                          Enviar de nuevo
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      {attached.files.map((f, i) => (
                        <Attachment file={f} key={`${m.id}-f-${i}`} />
                      ))}
                      {attached.text && <div className="bubble">{attached.text}</div>}
                      <div className="msg-actions" style={{ justifyContent: 'flex-end' }}>
                        {relativeTime(m.created_at) && (
                          <span className="msg-time">{relativeTime(m.created_at)}</span>
                        )}
                        <CopyAction text={attached.text || m.content} />
                        {onEdit && (
                          <button
                            className="act"
                            onClick={() => {
                              setEditing(m.id);
                              setDraft(attached.text);
                            }}
                          >
                            <Pencil size={13} /> Editar
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            }

            const { versions } = g;
            const replyTo = versions[0]?.reply_to ?? undefined;
            const latest = versions.reduce((a, b) => ((b.version_index ?? 1) > (a.version_index ?? 1) ? b : a));
            const wanted = replyTo ? versionSelection?.[replyTo] : undefined;
            const m = (wanted !== undefined && versions.find((v) => v.version_index === wanted)) || latest;
            const vi = versions.findIndex((v) => v === m);

            return (
              <div className="msg" key={`a-${replyTo ?? m.id}`}>
                <div className="msg-head">
                  <Spark size={13} />
                  NovaChat
                  {m.model && <span className="msg-model">{m.model}</span>}
                </div>

                {m.trace && m.trace.length > 0 && <Trace trace={m.trace} />}

                {m.reasoning && (
                  <details className="reasoning">
                    <summary>Razonamiento</summary>
                    <div className="reasoning-body">{m.reasoning}</div>
                  </details>
                )}

                <Markdown>{m.content}</Markdown>

                <div className="msg-actions">
                  <CopyAction text={m.content} />
                  <SpeakAction text={m.content} />
                  <button className="act" onClick={() => onRetry(m.id)} disabled={streaming}>
                    <Refresh size={13} /> Reintentar
                  </button>
                  {relativeTime(m.created_at) && (
                    <span className="msg-time">{relativeTime(m.created_at)}</span>
                  )}
                  {versions.length > 1 && replyTo && (
                    <span className="version-switch">
                      <button
                        className="act"
                        disabled={vi <= 0}
                        onClick={() => onSelectVersion?.(replyTo, versions[vi - 1].version_index ?? 1)}
                        aria-label="Version anterior"
                      >
                        <ChevronLeft size={13} />
                      </button>
                      {vi + 1}/{versions.length}
                      <button
                        className="act"
                        disabled={vi >= versions.length - 1}
                        onClick={() => onSelectVersion?.(replyTo, versions[vi + 1].version_index ?? 1)}
                        aria-label="Version siguiente"
                      >
                        <ChevronRight size={13} />
                      </button>
                    </span>
                  )}
                </div>
              </div>
            );
          })}

          {pending && (
            <div className="msg">
              <div className="msg-head">
                <Spark size={13} />
                NovaChat
                {pending.model && <span className="msg-model">{pending.model}</span>}
              </div>

              {(toolRunning || (pending.trace && pending.trace.length > 0)) && (
                <Trace
                  trace={pending.trace ?? []}
                  running={Boolean(toolRunning)}
                  runningLabel={toolRunning}
                  startedAt={pendingStartedAt}
                  autoOpenFiles
                />
              )}

              {pending.reasoning && (
                <details className="reasoning" open>
                  <summary>Razonando...</summary>
                  <div className="reasoning-body">{pending.reasoning}</div>
                </details>
              )}

              <StreamingBody content={pending.content} />
              <span className="caret" />
            </div>
          )}

          {slow && (
            <p className="banner">
              El router está tardando. Suele ser normal: mide entre seis y catorce
              segundos hasta la primera palabra, y a veces se queda callado a mitad
              de respuesta. Sigue conectado.
            </p>
          )}

          {error && <p className="banner error">{error}</p>}

          {/* Colchon para que el ultimo mensaje no quede pegado al redactor. */}
          <div style={{ height: 24 }} />
        </div>
      )}
    </div>
  );
}

/**
 * Quita la sintaxis de Markdown antes de leer en voz alta: sin esto, un
 * "**importante**" se oiria como "asterisco asterisco importante asterisco
 * asterisco" en vez de solo "importante".
 */
function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, '$1')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/\n{2,}/g, '. ')
    .replace(/\n/g, ' ')
    .trim();
}

/**
 * Leer en voz alta, al estilo del boton de altavoz de claude.ai — el
 * complemento simetrico del dictado por voz que ya tiene el redactor. Usa la
 * misma Web Speech API, solo que para sintesis en vez de reconocimiento.
 */
function SpeakAction({ text }: { text: string }) {
  const [speaking, setSpeaking] = useState(false);
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    setSupported(typeof window !== 'undefined' && 'speechSynthesis' in window);
  }, []);

  // Si el mensaje cambia (streaming) o el componente desaparece con la voz
  // activa, no debe quedarse leyendo un mensaje que ya no esta en pantalla.
  useEffect(() => () => window.speechSynthesis?.cancel(), []);

  if (!supported) return null;

  function toggle() {
    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(stripMarkdown(text));
    utterance.lang = navigator.language || 'es-ES';
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(utterance);
    setSpeaking(true);
  }

  return (
    <button className="act" onClick={toggle}>
      {speaking ? <SpeakerOff size={13} /> : <Speaker size={13} />}
      {speaking ? 'Detener' : 'Leer'}
    </button>
  );
}

/** "hace 3 min", al estilo de la marca de tiempo junto a las acciones de claude.ai. */
function relativeTime(iso?: string): string | null {
  if (!iso) return null;
  const diff = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diff) || diff < 0) return null;

  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'ahora';
  if (min < 60) return `hace ${min} min`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `hace ${hr} h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `hace ${day} d`;
  return new Date(iso).toLocaleDateString();
}

function CopyAction({ text }: { text: string }) {
  const [done, setDone] = useState(false);

  return (
    <button
      className="act"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1600);
        } catch {
          // Sin permiso de portapapeles no hay nada que el usuario pueda hacer.
        }
      }}
    >
      {done ? <Check size={13} /> : <Copy size={13} />}
      {done ? 'Copiado' : 'Copiar'}
    </button>
  );
}
