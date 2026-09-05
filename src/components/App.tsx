'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { type Artifact, ArtifactPane } from './ArtifactPane';
import { Composer } from './Composer';
import { EffortPicker } from './EffortPicker';
import { Briefcase, Chevron, Clock, Dots, FileIcon, Folder, Grid, Keyboard, Logout, Menu, NovaMark, Pencil, Pin, Plus, Settings as Gear, Spark, Trash } from './icons';
import { KeysModal } from './KeysModal';
import { readConversationsCache, readMessagesCache, writeConversationsCache, writeMessagesCache } from './localCache';
import { KeyboardShortcutsModal } from './KeyboardShortcutsModal';
import { ArtifactsModal } from './ArtifactsModal';
import { ProjectView } from './ProjectView';
import { TasksModal } from './TasksModal';
import { SkillsModal } from './SkillsModal';
import { MessageList } from './MessageList';
import { SearchModal } from './SearchModal';
import { SettingsModal } from './SettingsModal';
import { toolRunningLabel } from './Trace';
import type { Conversation, Message, ReasoningEffort, ToolUI, TraceStep } from './types';

export function App({ user }: { user: { id: string; email: string } }) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [skills, setSkills] = useState<{ name: string; description: string }[]>([]);
  // Nova siempre enruta en automatico: no hay eleccion de modelo en la
  // interfaz, asi que esto no es un estado, es la unica opcion que existe.
  const model = 'auto';
  // Al estilo del selector "Esfuerzo" que claude.ai pone junto al modelo.
  // null = automatico: no se manda reasoning_effort y el proveedor decide.
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>(null);

  const [streaming, setStreaming] = useState(false);
  const [pending, setPending] = useState<Message | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);
  // Que version de cada respuesta se esta mostrando, por id del mensaje de
  // usuario al que responde. Ausente = la mas reciente.
  const [versionSelection, setVersionSelection] = useState<Record<string, number>>({});

  // En incognito nada toca la base de datos: el hilo vive solo en memoria y se
  // pierde al cambiar de conversacion o recargar. Es el equivalente a no dejar
  // rastro, no un cifrado.
  const [incognito, setIncognito] = useState(false);

  const [collapsed, setCollapsed] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [userMenu, setUserMenu] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [artifactsOpen, setArtifactsOpen] = useState(false);
  type ProjectRow = {
    id: string;
    name: string;
    description: string | null;
    instructions: string | null;
    conversations: number;
    docs: number;
  };
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [openProjectId, setOpenProjectId] = useState<string | null>(null);
  const [tasksOpen, setTasksOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const [toolRunning, setToolRunning] = useState<string | null>(null);
  const [pendingStartedAt, setPendingStartedAt] = useState<number | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [artifact, setArtifact] = useState<Artifact | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  // Que conversacion se quiere ver ahora mismo. openConversation() dispara un
  // fetch que tarda; si mientras tanto el usuario crea una nueva o abre otra,
  // sin esto la respuesta tardia sobreescribia messages/activeId con los de
  // la conversacion vieja al llegar.
  const desiredConversationRef = useRef<string | null>(null);

  const active = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? null,
    [conversations, activeId],
  );

  // --- carga inicial -------------------------------------------------------

  const openConversation = useCallback(
    async (id: string, list?: Conversation[]) => {
      desiredConversationRef.current = id;
      setIncognito(false);
      setActiveId(id);
      setError(null);
      setSidebarOpen(false);
      history.replaceState(null, '', `/?c=${id}`);

      const conv = (list ?? conversations).find((c) => c.id === id);
      if (conv) setReasoningEffort(conv.reasoning_effort ?? null);

      // Optimista: si esta conversacion ya se vio en este navegador, se
      // pinta de golpe con lo que quedo en cache sin esperar a la red. En el
      // caso normal (un solo dispositivo) el servidor va a confirmar
      // exactamente esto; si hay otro dispositivo de por medio, la respuesta
      // que llega mas abajo lo corrige.
      const cached = readMessagesCache<Message[]>(user.id, id);
      if (cached) setMessages(cached);

      const res = await fetch(`/api/conversations/${id}`);
      // Mientras se esperaba la respuesta, el usuario pudo crear otra
      // conversacion o abrir otra distinta: aplicar esto ahora la
      // sobreescribiria con datos de la que ya no se esta viendo.
      if (desiredConversationRef.current !== id) return;
      if (!res.ok) {
        // Puede haberse borrado desde otra pestana. Se limpia en lugar de
        // dejar en pantalla mensajes de algo que ya no existe.
        setMessages([]);
        setConversations((prev) => prev.filter((c) => c.id !== id));
        setActiveId(null);
        return;
      }

      const data = await res.json();
      if (desiredConversationRef.current !== id) return;
      setMessages(data.messages);
      setReasoningEffort(data.conversation.reasoning_effort ?? null);
    },
    [conversations, user.id],
  );

  useEffect(() => {
    // Optimista: se pinta con lo que quedo en cache del navegador antes de
    // esperar a la red. El caso normal es un solo dispositivo, donde la
    // respuesta del servidor no va a cambiar nada de lo que ya se ve; si hay
    // otro dispositivo de por medio, se corrige en cuanto llega mas abajo.
    const cachedConversations = readConversationsCache<Conversation[]>(user.id);
    const wanted = new URLSearchParams(location.search).get('c');
    let openedTarget: string | null = null;

    if (cachedConversations?.length) {
      setConversations(cachedConversations);
      openedTarget = wanted ?? cachedConversations[0]?.id ?? null;
      if (openedTarget) void openConversation(openedTarget, cachedConversations);
    }

    void (async () => {
      const [convRes, skillsRes] = await Promise.all([
        fetch('/api/conversations'),
        fetch('/api/skills'),
      ]);

      if (convRes.ok) {
        const { conversations } = await convRes.json();
        setConversations(conversations);

        const target = wanted ?? conversations[0]?.id ?? null;
        // Si ya se abrio optimistamente la misma conversacion desde cache,
        // no hace falta pedirla otra vez: su propio fetch interno ya trae
        // la version confirmada por el servidor.
        if (target && target !== openedTarget) void openConversation(target, conversations);
      }

      if (skillsRes.ok) {
        const { skills } = await skillsRes.json();
        setSkills(skills);
      }
    })();
    // Solo al montar. Con openConversation en las dependencias se reabriria la
    // conversacion cada vez que cambia la lista, pisando lo que este abierto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refleja el estado actual en la cache local: cubre tanto la respuesta del
  // servidor como cualquier cambio propio (enviar, reintentar, editar,
  // renombrar, fijar, borrar) sin tener que acordarse de guardar en cada
  // sitio donde eso pasa.
  useEffect(() => {
    if (conversations.length) writeConversationsCache(user.id, conversations);
  }, [conversations, user.id]);

  useEffect(() => {
    if (!incognito && activeId) writeMessagesCache(user.id, activeId, messages);
  }, [messages, activeId, incognito, user.id]);

  useEffect(() => {
    document.title = active ? `${active.title} — NovaChat` : 'NovaChat';
  }, [active]);

  // Los bloques de codigo previsualizables piden abrirse por evento, porque
  // viven dentro del Markdown memoizado.
  useEffect(() => {
    const onArtifact = (e: Event) => setArtifact((e as CustomEvent<Artifact>).detail);
    window.addEventListener('novachat:artifact', onArtifact);
    return () => window.removeEventListener('novachat:artifact', onArtifact);
  }, []);

  // Abrir una conversacion encontrada por la herramienta buscar_historial,
  // disparado desde Trace.tsx que no tiene acceso directo a openConversation.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const { id } = (e as CustomEvent<{ id: string }>).detail;
      void openConversation(id);
    };
    window.addEventListener('novachat:open-conversation', onOpen);
    return () => window.removeEventListener('novachat:open-conversation', onOpen);
  }, [openConversation]);

  // --- conversaciones ------------------------------------------------------

  const loadProjects = useCallback(async () => {
    const res = await fetch('/api/projects');
    if (res.ok) setProjects((await res.json()).projects ?? []);
  }, []);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  /** El proyecto abierto, con sus datos frescos de la lista. */
  const openProject = projects.find((p) => p.id === openProjectId) ?? null;

  /** Crea uno y lo abre: pedir el nombre y despues abrirlo es un paso de mas. */
  const createProject = useCallback(async () => {
    const name = prompt('Nombre del proyecto');
    if (!name?.trim()) return;

    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim() }),
    });
    if (!res.ok) return;

    const { id } = await res.json();
    await loadProjects();
    setOpenProjectId(id);
    setSidebarOpen(false);
  }, [loadProjects]);

  const newConversation = useCallback(
    async (opts?: { incognito?: boolean; projectId?: string | null }) => {
      // Invalida cualquier openConversation() todavia en vuelo: si su
      // respuesta llega despues de esto, no debe pisar la conversacion nueva.
      desiredConversationRef.current = null;
      setError(null);
      setMessages([]);
      setSidebarOpen(false);

      if (opts?.incognito) {
        setIncognito(true);
        setActiveId(null);
        history.replaceState(null, '', '/');
        return null;
      }

      setIncognito(false);
      const res = await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, reasoningEffort, projectId: opts?.projectId ?? null }),
      });
      if (!res.ok) return null;

      const conv: Conversation = { ...(await res.json()), updated_at: new Date().toISOString() };
      desiredConversationRef.current = conv.id;
      setConversations((prev) => [conv, ...prev]);
      setActiveId(conv.id);
      history.replaceState(null, '', `/?c=${conv.id}`);
      return conv.id;
    },
    [reasoningEffort],
  );

  async function patchConversation(id: string, patch: Partial<Conversation>) {
    setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    await fetch(`/api/conversations/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
  }

  async function removeConversation(id: string) {
    setMenuFor(null);
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (id === activeId) {
      desiredConversationRef.current = null;
      setActiveId(null);
      setMessages([]);
      history.replaceState(null, '', '/');
    }
    await fetch(`/api/conversations/${id}`, { method: 'DELETE' });
  }

  async function renameConversation(id: string, current: string) {
    setMenuFor(null);
    const title = prompt('Nuevo titulo', current);
    if (title?.trim()) await patchConversation(id, { title: title.trim() });
  }

  /** Descarga el hilo como Markdown, legible fuera de la aplicacion. */
  function exportConversation() {
    setMenuFor(null);
    const title = active?.title ?? 'Conversacion';
    const body = messages
      .map((m) => (m.role === 'user' ? `## Tu\n\n${m.content}` : `## NovaChat (${m.model ?? '-'})\n\n${m.content}`))
      .join('\n\n');

    const blob = new Blob([`# ${title}\n\n${body}\n`], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title.replace(/[^\p{L}\p{N} _-]/gu, '').slice(0, 60) || 'conversacion'}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function changeEffort(effort: ReasoningEffort) {
    setReasoningEffort(effort);
    if (activeId) void patchConversation(activeId, { reasoning_effort: effort });
  }

  // --- envio ---------------------------------------------------------------

  const send = useCallback(
    async (
      text: string,
      opts?: {
        replaceFrom?: number;
        retryId?: string;
        after?: Promise<unknown>;
        /** A que conversacion va, cuando aun no es la activa segun el estado. */
        conversationId?: string;
      },
    ) => {
      const isRetry = Boolean(opts?.retryId);
      const content = text.trim();
      if (!isRetry && !content) return;
      if (streaming) return;

      // `activeId` es estado de React: quien acaba de crear la conversacion
      // todavia lo ve viejo en este mismo tick, y el mensaje se iba a la
      // conversacion anterior. Por eso se puede pasar a mano.
      let conversationId = opts?.conversationId ?? activeId;
      if (!conversationId && !incognito) conversationId = await newConversation();
      if (!conversationId && !incognito) return;

      setError(null);
      setStreaming(true);
      setSlow(false);

      // Al reeditar, el historial se corta en ese punto: lo que venia despues
      // respondia a una pregunta que ya no existe. Al reintentar no se corta
      // nada: la respuesta anterior se queda como version navegable.
      // Igual que con `activeId`: si la conversacion se acaba de crear, el
      // `messages` de este closure todavia es el del hilo anterior, y el
      // primer mensaje del proyecto salia debajo de una conversacion ajena.
      const base =
        opts?.replaceFrom !== undefined
          ? messages.slice(0, opts.replaceFrom)
          : opts?.conversationId
            ? []
            : messages;

      let localUserId: string | null = null;
      if (isRetry) {
        setMessages(base);
      } else {
        const userMessage: Message = {
          id: `local-${Date.now()}`,
          role: 'user',
          content,
          created_at: new Date().toISOString(),
        };
        localUserId = userMessage.id;
        setMessages([...base, userMessage]);
      }
      setPending({ id: 'streaming', role: 'assistant', content: '', reasoning: '', model, trace: [] });
      setPendingStartedAt(Date.now());

      // Vigilante de silencios.
      //
      // Midiendo el router de verdad: entre seis y catorce segundos hasta la
      // primera letra, y parones de hasta veintiseis segundos a mitad de
      // respuesta. Sin avisar, esos parones se ven igual que si la aplicacion
      // se hubiera colgado. El reloj se rearma con cada trozo que llega, asi
      // que el aviso sale tanto al principio como en un silencio de despues.
      let slowTimer: ReturnType<typeof setTimeout> | undefined;
      const watchSilence = () => {
        clearTimeout(slowTimer);
        slowTimer = setTimeout(() => setSlow(true), 6000);
      };
      watchSilence();

      const controller = new AbortController();
      abortRef.current = controller;
      let doneMeta: { id: string; reply_to?: string | null; version_index?: number } | null = null;

      // Copia local de lo que se va acumulando en `pending`, para poder
      // construir el mensaje final sin leer el estado desde dentro de otro
      // actualizador de estado: anidar un setMessages dentro de un
      // setPending((p) => ...) es impuro y React 18 en modo estricto puede
      // invocarlo dos veces, duplicando el mensaje en la conversacion.
      let finalText = '';
      let finalReasoning = '';
      let finalTrace: TraceStep[] = [];

      // Amortiguador de escritura.
      //
      // El router no entrega los tokens a ritmo constante: manda rafagas y
      // luego se queda callado, asi que el texto salia a trompicones. Y
      // pintar en cada token era ademas cuadratico — `Markdown` reparsea el
      // mensaje entero cada vez, asi que cuanto mas largo, mas caro cada
      // token. Aqui los deltas se acumulan y se vuelcan en cada fotograma,
      // drenando una fraccion de lo pendiente: una rafaga se reparte en unos
      // pocos fotogramas en vez de aparecer de golpe, un goteo lento sale
      // igual que antes, y los repintados quedan acotados a los del monitor
      // en vez de uno por token.
      let textQueue = '';
      let shownText = '';
      let frame: number | null = null;

      // Un fotograma de cada tres: a 60 Hz no hace falta repintar tan seguido
      // para que se vea fluido, y cada repintado cuesta un reparseo del ultimo
      // parrafo. Con esto el trabajo baja a un tercio sin que se note.
      let tick = 0;

      const drain = () => {
        frame = null;
        if (!textQueue) return;
        if (tick++ % 3 !== 0) {
          frame = requestAnimationFrame(drain);
          return;
        }
        const step = Math.max(6, Math.ceil(textQueue.length / 4));
        shownText += textQueue.slice(0, step);
        textQueue = textQueue.slice(step);
        setPending((prev) => (prev ? { ...prev, content: shownText } : prev));
        if (textQueue) frame = requestAnimationFrame(drain);
      };

      const queueText = (chunk: string) => {
        textQueue += chunk;
        if (frame === null) frame = requestAnimationFrame(drain);
      };

      /** Al terminar (o al abortar) se vuelca lo que quede, sin esperar fotogramas. */
      const flushText = () => {
        if (frame !== null) cancelAnimationFrame(frame);
        frame = null;
        if (!textQueue) return;
        shownText += textQueue;
        textQueue = '';
        setPending((prev) => (prev ? { ...prev, content: shownText } : prev));
      };

      try {
        // Al editar, esto es el borrado en el servidor de lo que venia
        // despues: la interfaz ya se actualizo al instante mas arriba, pero
        // el mensaje nuevo no debe llegar al servidor antes de que el
        // borrado se aplique, o el borrado podria arrastrarlo tambien por
        // compartir marca de tiempo posterior a la del mensaje editado.
        if (opts?.after) await opts.after;

        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            conversationId,
            content: isRetry ? undefined : content,
            model,
            reasoningEffort,
            incognito,
            mode: isRetry ? 'retry' : 'send',
            replyTo: isRetry ? opts?.retryId : undefined,
            // En incognito el servidor no tiene historial guardado, asi que se
            // le manda el del cliente.
            history: incognito ? base.map((m) => ({ role: m.role, content: m.content })) : undefined,
          }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          setError((await res.text().catch(() => '')) || 'El servidor no ha respondido.');
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          setSlow(false);
          watchSilence();

          buffer += decoder.decode(value, { stream: true });

          // NDJSON: un evento por linea; la ultima puede venir partida.
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.trim()) continue;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- forma variable segun `t`, se desestructura mas abajo
            let event: any;
            try {
              event = JSON.parse(line);
            } catch {
              continue;
            }

            if (event.t === 'delta') {
              finalText += event.v;
              queueText(event.v);
            } else if (event.t === 'reasoning') {
              finalReasoning += event.v;
              setPending((p) => (p ? { ...p, reasoning: (p.reasoning ?? '') + event.v } : p));
            } else if (event.t === 'title') {
              setConversations((prev) =>
                prev.map((c) => (c.id === conversationId ? { ...c, title: event.v } : c)),
              );
            } else if (event.t === 'user') {
              // El servidor confirma el id real del mensaje que se acaba de
              // guardar: sin adoptarlo, un reintento posterior de este mismo
              // turno no sabria a que id de verdad referenciar.
              const realId = event.id as string;
              if (localUserId) {
                const localId = localUserId;
                setMessages((prev) => prev.map((m) => (m.id === localId ? { ...m, id: realId } : m)));
              }
            } else if (event.t === 'done') {
              doneMeta = { id: event.id, reply_to: event.reply_to, version_index: event.version_index };
            } else if (event.t === 'tool') {
              const step: TraceStep = { id: event.id, name: event.name, args: event.args };
              finalTrace = [...finalTrace, step];
              setPending((p) => (p ? { ...p, trace: finalTrace } : p));
              setToolRunning(toolRunningLabel(event.name, event.args));
            } else if (event.t === 'tool_result') {
              const ui = event.ui as ToolUI | undefined;
              finalTrace = finalTrace.map((s) => (s.id === event.id ? { ...s, ui } : s));
              setPending((p) => (p ? { ...p, trace: finalTrace } : p));
              setToolRunning(null);
            } else if (event.t === 'error') {
              setError(event.v);
            }
          }
        }
      } catch (err) {
        // Abortar es una accion del usuario, no un fallo que reportar.
        if ((err as Error).name !== 'AbortError') {
          setError('Se ha perdido la conexion. Lo que se habia generado esta guardado.');
        }
      } finally {
        flushText();
        clearTimeout(slowTimer);
        setSlow(false);
        setToolRunning(null);
        setPendingStartedAt(null);
        abortRef.current = null;

        setPending(null);
        if (finalText || finalReasoning || finalTrace.length) {
          setMessages((prev) => [
            ...prev,
            {
              id: doneMeta?.id ?? `done-${Date.now()}`,
              role: 'assistant',
              content: finalText,
              reasoning: finalReasoning || undefined,
              model,
              trace: finalTrace,
              reply_to: doneMeta?.reply_to,
              version_index: doneMeta?.version_index,
              created_at: new Date().toISOString(),
            },
          ]);
        }

        setStreaming(false);
        if (conversationId) {
          setConversations((prev) =>
            [...prev].sort((a, b) => {
              if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
              return a.id === conversationId ? -1 : b.id === conversationId ? 1 : 0;
            }),
          );
        }
      }
    },
    [activeId, incognito, messages, model, reasoningEffort, newConversation, streaming],
  );

  function stop() {
    abortRef.current?.abort();
  }

  /**
   * Reintenta la ultima pregunta. En incognito no hay nada que versionar en
   * el servidor, asi que sigue truncando el array local como antes; fuera de
   * incognito, la respuesta anterior no se pierde: queda como una version
   * mas, navegable con el selector "< 1/2 >".
   */
  /**
   * Reintenta una respuesta concreta, no solo la ultima.
   *
   * Lo que se reintenta de verdad es el mensaje de usuario al que contestaba,
   * asi que se busca por `reply_to`; si esa respuesta es vieja y no lo tiene
   * guardado, se cae al ultimo mensaje de usuario anterior a ella, que es a
   * quien respondia por fuerza.
   */
  function retry(assistantId?: string) {
    if (streaming) return;
    let idx = -1;
    if (assistantId) {
      const at = messages.findIndex((m) => m.id === assistantId);
      if (at === -1) return;
      const answered = messages[at].reply_to;
      idx = answered
        ? messages.findIndex((m) => m.id === answered)
        : messages.slice(0, at).map((m) => m.role).lastIndexOf('user');
    } else {
      idx = messages.map((m) => m.role).lastIndexOf('user');
    }
    if (idx === -1) return;
    if (incognito) {
      void send(messages[idx].content, { replaceFrom: idx });
      return;
    }
    const userId = messages[idx].id;
    setVersionSelection((prev) => {
      if (!(userId in prev)) return prev;
      const next = { ...prev };
      delete next[userId];
      return next;
    });
    void send('', { retryId: userId });
  }

  /** Reenvia un mensaje editado, borrando de verdad en el servidor lo que venia despues. */
  function editMessage(id: string, text: string) {
    const idx = messages.findIndex((m) => m.id === id);
    if (idx === -1) return;

    // Optimista: la interfaz se corta ya (dentro de send, mas abajo) sin
    // esperar a la red. El borrado real en el servidor va por su cuenta en
    // paralelo; send() espera a que termine antes de mandar el mensaje
    // nuevo, pero eso no bloquea lo que se ve en pantalla.
    const after =
      !incognito && activeId && !id.startsWith('local-')
        ? fetch(`/api/conversations/${activeId}/truncate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fromMessageId: id }),
          }).catch(() => {
            setError('No se ha podido borrar el historial antiguo en el servidor; puede reaparecer al recargar.');
          })
        : undefined;

    void send(text, { replaceFrom: idx, after });
  }

  // --- atajos --------------------------------------------------------------

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      const target = e.target as HTMLElement | null;
      const typing = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable;

      if (mod && key === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      } else if (mod && e.shiftKey && key === 'o') {
        e.preventDefault();
        void newConversation();
      } else if (mod && key === 'b') {
        e.preventDefault();
        setCollapsed((v) => !v);
      } else if (mod && key === '/') {
        e.preventDefault();
        setShortcutsOpen((v) => !v);
      } else if (key === '?' && !typing) {
        e.preventDefault();
        setShortcutsOpen((v) => !v);
      } else if (e.key === 'Escape') {
        // Con una respuesta en curso, Esc la corta primero: es lo que se
        // espera al pulsarlo, y cerrar menus de paso seria confuso.
        if (streaming) {
          stop();
        } else {
          setMenuFor(null);
          setUserMenu(false);
          setSidebarOpen(false);
          setShortcutsOpen(false);
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [newConversation, streaming]);

  // Cierra los menus contextuales al pulsar fuera.
  useEffect(() => {
    if (!menuFor && !userMenu) return;
    const close = () => {
      setMenuFor(null);
      setUserMenu(false);
    };
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [menuFor, userMenu]);

  const groups = useMemo(() => groupByDate(conversations), [conversations]);

  // El pie del redactor recuerda verificar las fuentes solo cuando la ultima
  // respuesta de verdad busco algo, no siempre.
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
  const lastUsedWebSearch = Boolean(lastAssistant?.trace?.some((s) => s.name === 'buscar_web'));

  return (
    <div
      className={`shell${collapsed ? ' collapsed' : ''}${artifact ? ' with-artifact' : ''}`}
    >
      {sidebarOpen && <div className="scrim" onClick={() => setSidebarOpen(false)} />}

      <aside className={`sidebar${sidebarOpen ? ' open' : ''}`}>
        <div className="brand">
          <NovaMark size={26} id="brand-mark" />
          <span className="brand-name">
            Nova<em>Chat</em>
          </span>
          <button
            className="icon-btn"
            style={{ marginLeft: 'auto' }}
            onClick={() => setCollapsed(true)}
            aria-label="Ocultar barra lateral"
            title="Ocultar barra lateral (Ctrl+B)"
          >
            <Chevron size={15} />
          </button>
        </div>

        <button className="new-chat" onClick={() => void newConversation()}>
          <Plus /> Nueva conversacion
        </button>

        {/* Navegacion principal, no ajustes: son sitios a los que se va, como en
            claude.ai. Metidas en el menu del pie quedaban escondidas. */}
        <nav className="side-nav">
          <button className="side-nav-item" onClick={() => setArtifactsOpen(true)}>
            <Grid size={15} /> Artefactos
          </button>
          <button className="side-nav-item" onClick={() => setTasksOpen(true)}>
            <Clock size={15} /> Programado
          </button>
          <button className="side-nav-item" onClick={() => setSettingsOpen(true)}>
            <Briefcase size={15} /> Personalizar
          </button>
        </nav>

        {/* Los proyectos se ven desde aqui, como en claude.ai: la cabecera lleva
            el "+" para crear uno, y debajo estan los que ya hay. Tener que
            entrar a un sitio para ver la lista era un paso de mas. */}
        <nav className="side-projects">
          <div className="side-heading">
            Proyectos
            <button className="side-add" onClick={() => void createProject()} title="Proyecto nuevo">
              <Plus />
            </button>
          </div>
          {projects.length === 0 && <p className="side-empty">Aun no hay ninguno.</p>}
          {projects.map((p) => (
            <button
              key={p.id}
              className={`side-nav-item${openProjectId === p.id ? ' on' : ''}`}
              onClick={() => {
                setOpenProjectId(p.id);
                setSidebarOpen(false);
              }}
            >
              <Folder size={14} /> {p.name}
            </button>
          ))}
        </nav>

        <div className="side-actions">
          <button className="side-action" onClick={() => setSearchOpen(true)}>
            Buscar
            <kbd>Ctrl K</kbd>
          </button>
          <button
            className={`side-action${incognito ? ' on' : ''}`}
            onClick={() => void newConversation({ incognito: true })}
            title="Una conversacion que no se guarda"
          >
            Incognito
          </button>
        </div>

        <nav className="conv-list">
          {conversations.length === 0 && (
            <p className="side-empty">Todavia no hay conversaciones.</p>
          )}

          {groups.map(([label, items]) => (
            <div key={label}>
              <div className="conv-group">{label}</div>
              {items.map((c) => (
                <div key={c.id} style={{ position: 'relative' }}>
                  <button
                    className={`conv${c.id === activeId ? ' active' : ''}`}
                    onClick={() => void openConversation(c.id)}
                  >
                    <span className="conv-title">{c.title}</span>
                    <span
                      className="conv-menu"
                      role="button"
                      tabIndex={0}
                      aria-label="Mas opciones"
                      aria-expanded={menuFor === c.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuFor(menuFor === c.id ? null : c.id);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          e.stopPropagation();
                          setMenuFor(menuFor === c.id ? null : c.id);
                        }
                      }}
                    >
                      <Dots />
                    </span>
                  </button>

                  {menuFor === c.id && (
                    <div className="pop" style={{ right: 8, top: 34 }}>
                      <button
                        className="pop-item"
                        onClick={() => void renameConversation(c.id, c.title)}
                      >
                        <Pencil /> Renombrar
                      </button>
                      <button
                        className="pop-item"
                        onClick={() => {
                          setMenuFor(null);
                          void patchConversation(c.id, { pinned: !c.pinned });
                        }}
                      >
                        <Pin /> {c.pinned ? 'No fijar' : 'Fijar arriba'}
                      </button>
                      {c.id === activeId && (
                        <button className="pop-item" onClick={exportConversation}>
                          <Spark /> Exportar
                        </button>
                      )}
                      <button
                        className="pop-item danger"
                        onClick={() => void removeConversation(c.id)}
                      >
                        <Trash /> Borrar
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-foot" style={{ position: 'relative' }}>
          <button
            className="user-btn"
            onClick={(e) => {
              e.stopPropagation();
              setUserMenu((v) => !v);
            }}
            aria-expanded={userMenu}
          >
            <span className="avatar">{user.email[0]?.toUpperCase()}</span>
            <span className="who" title={user.email}>
              {user.email}
            </span>
            <Chevron size={13} />
          </button>

          {userMenu && (
            <div className="pop" style={{ left: 10, right: 10, bottom: 46 }}>
              <button
                className="pop-item"
                onClick={() => {
                  setUserMenu(false);
                  setSettingsOpen(true);
                }}
              >
                <Gear size={15} /> Ajustes
              </button>
              <button
                className="pop-item"
                onClick={() => {
                  setUserMenu(false);
                  setKeysOpen(true);
                }}
              >
                <Spark size={15} /> Herramientas de busqueda
              </button>
              <button
                className="pop-item"
                onClick={() => {
                  setUserMenu(false);
                  setSkillsOpen(true);
                }}
              >
                <FileIcon size={15} /> Skills
              </button>
              <button
                className="pop-item"
                onClick={() => {
                  setUserMenu(false);
                  setShortcutsOpen(true);
                }}
              >
                <Keyboard size={15} /> Atajos de teclado
              </button>
              <button className="pop-item danger" onClick={() => void logout()}>
                <Logout size={15} /> Cerrar sesion
              </button>
            </div>
          )}
        </div>
      </aside>

      <main className="main">
        <div className="topbar">
          {collapsed && (
            <button
              className="icon-btn"
              onClick={() => setCollapsed(false)}
              aria-label="Mostrar barra lateral"
              title="Mostrar barra lateral (Ctrl+B)"
            >
              <Menu />
            </button>
          )}
          <button
            className="icon-btn menu-toggle"
            aria-label="Conversaciones"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu />
          </button>

          <h1>
            {incognito && <span className="tag">Incognito</span>}
            {openProject?.name ?? active?.title ?? 'Nueva conversacion'}
          </h1>

          <EffortPicker effort={reasoningEffort} onChange={changeEffort} />
        </div>

        {openProject ? (
          <ProjectView
            project={openProject}
            skills={skills}
            onOpenConversation={(id) => {
              setOpenProjectId(null);
              void openConversation(id);
            }}
            onStart={async (projectId, text) => {
              const id = await newConversation({ projectId });
              if (!id) return;
              setOpenProjectId(null);
              void send(text, { conversationId: id });
            }}
            onChanged={() => void loadProjects()}
          />
        ) : (
          <>
        <MessageList
          messages={messages}
          pending={pending}
          streaming={streaming}
          slow={slow}
          toolRunning={toolRunning}
          pendingStartedAt={pendingStartedAt}
          error={error}
          incognito={incognito}
          greeting={greeting(user.email)}
          onRetry={retry}
          onPick={(text) => void send(text)}
          onEdit={editMessage}
          versionSelection={versionSelection}
          onSelectVersion={(replyTo, versionIndex) =>
            setVersionSelection((prev) => ({ ...prev, [replyTo]: versionIndex }))
          }
        />

        <div className="composer-wrap">
          <Composer
            disabled={streaming}
            streaming={streaming}
            onSend={send}
            onStop={stop}
            lastUsedWebSearch={lastUsedWebSearch}
            skills={skills}
          />
        </div>
          </>
        )}
      </main>

      {artifact && <ArtifactPane artifact={artifact} onClose={() => setArtifact(null)} />}

      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}

      {keysOpen && <KeysModal onClose={() => setKeysOpen(false)} />}

      {artifactsOpen && <ArtifactsModal onClose={() => setArtifactsOpen(false)} />}
      {tasksOpen && <TasksModal onClose={() => setTasksOpen(false)} />}
      {skillsOpen && <SkillsModal onClose={() => setSkillsOpen(false)} />}

      {shortcutsOpen && <KeyboardShortcutsModal onClose={() => setShortcutsOpen(false)} />}

      {searchOpen && (
        <SearchModal
          onClose={() => setSearchOpen(false)}
          onOpen={(id) => {
            setSearchOpen(false);
            void openConversation(id);
          }}
        />
      )}
    </div>
  );
}

async function logout() {
  await fetch('/api/auth/logout', { method: 'POST' });
  location.href = '/login';
}

/** Saludo segun la hora local, con el nombre sacado del correo. */
function greeting(email: string) {
  const h = new Date().getHours();
  const when = h < 6 ? 'Buenas noches' : h < 13 ? 'Buenos dias' : h < 21 ? 'Buenas tardes' : 'Buenas noches';
  const name = email.split('@')[0].replace(/[._-]+/g, ' ').split(' ')[0];
  return `${when}, ${name.charAt(0).toUpperCase()}${name.slice(1)}`;
}

/**
 * Agrupa las conversaciones por antiguedad.
 *
 * Las fijadas van en su propio grupo arriba, al margen de la fecha: el sentido
 * de fijar algo es justamente sacarlo del orden cronologico.
 */
function groupByDate(list: Conversation[]): [string, Conversation[]][] {
  const pinned: Conversation[] = [];
  const buckets = new Map<string, Conversation[]>();
  const order = ['Hoy', 'Ayer', 'Ultimos 7 dias', 'Ultimos 30 dias', 'Anteriores'];

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  for (const c of list) {
    if (c.pinned) {
      pinned.push(c);
      continue;
    }
    const days = Math.floor(
      (startOfToday.getTime() - new Date(c.updated_at).getTime()) / 86_400_000,
    );
    const label =
      days < 0
        ? 'Hoy'
        : days === 0
          ? 'Ayer'
          : days < 7
            ? 'Ultimos 7 dias'
            : days < 30
              ? 'Ultimos 30 dias'
              : 'Anteriores';

    const bucket = buckets.get(label);
    if (bucket) bucket.push(c);
    else buckets.set(label, [c]);
  }

  const groups: [string, Conversation[]][] = [];
  if (pinned.length) groups.push(['Fijadas', pinned]);
  for (const label of order) {
    const items = buckets.get(label);
    if (items?.length) groups.push([label, items]);
  }
  return groups;
}
