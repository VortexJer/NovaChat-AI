'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { type Artifact, ArtifactPane } from './ArtifactPane';
import { Composer } from './Composer';
import { EffortPicker } from './EffortPicker';
import { Briefcase, Chevron, Clock, Dots, FileIcon, Folder, Grid, Keyboard, Logout, Menu, NovaMark, Pencil, Pin, Plug, Plus, Settings as Gear, Spark, Trash } from './icons';
import { KeysModal } from './KeysModal';
import {
  readConversationsCache,
  readMessagesCache,
  removeMessagesCache,
  writeConversationsCache,
  writeMessagesCache,
} from './localCache';
import { KeyboardShortcutsModal } from './KeyboardShortcutsModal';
import { ArtifactsModal } from './ArtifactsModal';
import { ConnectorsModal } from './ConnectorsModal';
import { ProjectView } from './ProjectView';
import { TasksModal } from './TasksModal';
import { SkillsModal } from './SkillsModal';
import { MessageList } from './MessageList';
import { MobileViewport } from './MobileViewport';
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
  /**
   * De que conversacion es la respuesta que se esta generando.
   *
   * Sin esto, abrir otro chat mientras uno responde pintaba la burbuja en
   * curso — y todos sus trozos — en el chat recien abierto, y al terminar
   * pegaba la respuesta entera en el hilo equivocado. El estado de generacion
   * es uno solo para toda la aplicacion, asi que hay que decir a quien
   * pertenece y no ensenarlo fuera de ahi.
   */
  const [pendingFor, setPendingFor] = useState<string | null>(null);
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
  const [connectorsOpen, setConnectorsOpen] = useState(false);
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
  /** El proyecto cuyo "borrar" esta esperando el segundo clic. */
  const [confirmProject, setConfirmProject] = useState<string | null>(null);
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

  // Hasta que no se ha leido una lista (de cache o del servidor) no se escribe
  // la cache: si no, el primer render, con la lista aun vacia, la borraria.
  const listaCargadaRef = useRef(false);

  useEffect(() => {
    // Optimista: se pinta con lo que quedo en cache del navegador antes de
    // esperar a la red. El caso normal es un solo dispositivo, donde la
    // respuesta del servidor no va a cambiar nada de lo que ya se ve; si hay
    // otro dispositivo de por medio, se corrige en cuanto llega mas abajo.
    const cachedConversations = readConversationsCache<Conversation[]>(user.id);
    const wanted = new URLSearchParams(location.search).get('c');
    let openedTarget: string | null = null;

    if (cachedConversations?.length) {
      listaCargadaRef.current = true;
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
        listaCargadaRef.current = true;
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

  /**
   * Vuelve a leer la lista del servidor y la deja mandar sobre lo que hubiera
   * en memoria.
   *
   * Hace falta porque la aplicacion anclada a la pantalla de inicio no se
   * recarga: se queda en segundo plano y al volver a ella sigue el mismo React
   * de hace horas. Sin esto, una conversacion borrada desde el ordenador
   * seguiria apareciendo en el movil hasta cerrarla del todo.
   *
   * Si la que estaba abierta ya no existe, se sale a una nueva en vez de
   * quedarse mirando un hilo que ya no esta en ninguna parte.
   */
  const refrescarLista = useCallback(async () => {
    const res = await fetch('/api/conversations');
    if (!res.ok) return;

    const { conversations: frescas } = (await res.json()) as { conversations: Conversation[] };
    setConversations(frescas);

    if (activeId && !frescas.some((c) => c.id === activeId)) {
      desiredConversationRef.current = null;
      setActiveId(null);
      setMessages([]);
      removeMessagesCache(user.id, activeId);
      history.replaceState(null, '', '/');
    }
  }, [activeId, user.id]);

  useEffect(() => {
    // Mientras se esta generando una respuesta no: sacar la conversacion de
    // debajo a mitad de streaming es peor que enseñar la lista un poco vieja.
    const alVolver = () => {
      if (streaming || incognito) return;
      if (document.visibilityState === 'visible') void refrescarLista();
    };
    document.addEventListener('visibilitychange', alVolver);
    window.addEventListener('focus', alVolver);
    return () => {
      document.removeEventListener('visibilitychange', alVolver);
      window.removeEventListener('focus', alVolver);
    };
  }, [refrescarLista, streaming, incognito]);

  // Refleja el estado actual en la cache local: cubre tanto la respuesta del
  // servidor como cualquier cambio propio (enviar, reintentar, editar,
  // renombrar, fijar, borrar) sin tener que acordarse de guardar en cada
  // sitio donde eso pasa.
  useEffect(() => {
    // Tambien cuando se queda vacia: si solo se guardara con contenido, borrar
    // la ultima conversacion dejaria la cache con la lista vieja y al abrir la
    // aplicacion volverian a aparecer un instante las que ya no existen.
    if (listaCargadaRef.current) writeConversationsCache(user.id, conversations);
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

  /** Saca la conversacion del proyecto sin borrarla: vuelve a la lista por fechas. */
  async function detachConversation(id: string) {
    setMenuFor(null);
    setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, project_id: null } : c)));
    await fetch(`/api/conversations/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: null }),
    });
    void loadProjects();
  }

  async function renameProject(id: string, actual: string) {
    setMenuFor(null);
    const name = prompt('Nuevo nombre del proyecto', actual);
    if (!name?.trim() || name.trim() === actual) return;
    await fetch(`/api/projects/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim() }),
    });
    void loadProjects();
  }

  /**
   * Borrar un proyecto no borra sus conversaciones: el servidor las saca de el
   * y siguen en el historial, asi que aqui hay que devolverlas a la lista por
   * fechas sin recargar.
   */
  async function removeProject(id: string) {
    setMenuFor(null);
    setConfirmProject(null);
    const res = await fetch(`/api/projects/${id}`, { method: 'DELETE' });
    if (!res.ok) return;

    if (openProjectId === id) setOpenProjectId(null);
    setProjects((prev) => prev.filter((p) => p.id !== id));
    setConversations((prev) =>
      prev.map((c) => (c.project_id === id ? { ...c, project_id: null } : c)),
    );
  }

  /**
   * Borra la conversacion de la base de datos —sus mensajes caen con ella por
   * la clave foranea— y de todo rastro local: la lista, la cache del navegador
   * y, si era la que estaba abierta, la propia pantalla, que pasa a una
   * conversacion nueva.
   *
   * La lista se actualiza antes de que conteste el servidor, que es lo que hace
   * que se sienta instantaneo, pero si el borrado falla se devuelve a su sitio
   * en vez de dejar creer que se borro: al recargar reaparecia y no habia forma
   * de saber por que.
   */
  async function removeConversation(id: string) {
    setMenuFor(null);

    const antes = conversations;
    setConversations((prev) => prev.filter((c) => c.id !== id));
    removeMessagesCache(user.id, id);

    if (id === activeId) {
      desiredConversationRef.current = null;
      setActiveId(null);
      setMessages([]);
      setPending(null);
      history.replaceState(null, '', '/');
    }

    const res = await fetch(`/api/conversations/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      setConversations(antes);
      setError('No se ha podido borrar la conversacion.');
    }
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
      setPendingFor(conversationId ?? null);
      setPendingStartedAt(Date.now());

      // Vigilante de silencios.
      //
      // Midiendo el router de verdad: entre seis y catorce segundos hasta la
      // primera letra, y parones de hasta veintiseis segundos a mitad de
      // respuesta. Sin avisar, esos parones se ven igual que si la aplicacion
      // se hubiera colgado. El reloj se rearma con cada trozo que llega, asi
      // que el aviso sale tanto al principio como en un silencio de despues.
      let slowTimer: ReturnType<typeof setTimeout> | undefined;
      let deadTimer: ReturnType<typeof setTimeout> | undefined;
      const controller = new AbortController();
      abortRef.current = controller;

      const watchSilence = () => {
        clearTimeout(slowTimer);
        clearTimeout(deadTimer);
        slowTimer = setTimeout(() => setSlow(true), 6000);
        // Y una red debajo del aviso: si pasan diez minutos sin que llegue
        // **nada**, se da el turno por muerto y se corta.
        //
        // Diez y no seis (el triple de los dos de antes) porque este plazo
        // tiene que quedar por encima del peor caso del servidor, o lo
        // cortaria a media faena: noventa segundos de espera al modelo
        // elegido, mas ciento treinta y cinco recorriendo suplentes, mas
        // doscientos setenta de ultima bala son ocho minutos y cuarto en los
        // que legitimamente no llega nada.
        //
        // El servidor tiene sus propios topes, pero si se queda colgado por
        // cualquier motivo —una consulta que no vuelve, una conexion que no se
        // cierra— el cliente se queda esperando para siempre con la luz
        // parpadeando y sin forma de saber que ya no va a llegar nada. Esto se
        // encarga de que eso siempre acabe.
        deadTimer = setTimeout(() => {
          setError('El servidor ha dejado de responder. Lo que se habia generado esta guardado.');
          controller.abort();
        }, 600_000);
      };
      watchSilence();
      let doneMeta: { id: string; reply_to?: string | null; version_index?: number } | null = null;
      let abortado = false;

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
      // El router no entrega los tokens a ritmo constante: manda una rafaga de
      // varios cientos de caracteres y luego se calla uno o dos segundos. Sin
      // amortiguar, eso se ve como saltos: un bloque de golpe, parado, otro
      // bloque. Aqui los deltas entran en una cola y salen a ritmo constante.
      //
      // La clave es que el ritmo se calcula por **tiempo transcurrido**, no
      // por fraccion de lo pendiente. Drenar un cuarto de la cola en cada
      // repintado —lo que se hacia antes— vacia deprisa al principio y se
      // arrastra al final, que es justo el tiron que se veia. Ahora se vacia
      // lo pendiente en una ventana fija: si llegan 600 caracteres de golpe
      // salen a 1.700 por segundo durante 350 ms, y si llegan de dos en dos
      // salen al minimo, sin parones.
      //
      // Ademas se pinta en cada fotograma, no en uno de cada tres: lo que
      // cuesta es reparsear el Markdown, y de eso ya se encarga `StreamingBody`
      // dejando fuera el parrafo en curso.
      const HORIZONTE = 0.6; // segundos para vaciar lo pendiente
      const MINIMO = 90; // caracteres por segundo, para que un goteo no se pare

      let textQueue = '';
      let shownText = '';
      let frame: number | null = null;
      let ultimo = 0;

      /**
       * Hay respuestas que no se escriben: se entregan.
       *
       * Una tabla, un bloque de codigo o la nota que acompaña a un archivo no
       * ganan nada apareciendo letra a letra — la tabla se recoloca en cada
       * fotograma mientras le llegan columnas, y el archivo ya esta hecho antes
       * de que empiece a escribirse la frase. En cuanto se ve que la respuesta
       * es de ese tipo se deja de dosificar y sale entera.
       */
      let instantaneo = false;

      const esEntrega = (texto: string) =>
        texto.includes('```') || /(^|\n)\s*\|/.test(texto) || /(^|\n)\s*\|?\s*-{3,}/.test(texto);

      const drain = (ahora: number) => {
        frame = null;
        if (!textQueue) {
          ultimo = 0;
          return;
        }

        // Un fotograma perdido (pestaña en segundo plano) no debe soltar un
        // bloque entero de golpe: el salto se limita a 100 ms.
        const dt = ultimo ? Math.min((ahora - ultimo) / 1000, 0.1) : 1 / 60;
        ultimo = ahora;

        const ritmo = Math.max(MINIMO, textQueue.length / HORIZONTE);
        const paso = Math.max(1, Math.round(ritmo * dt));

        shownText += textQueue.slice(0, paso);
        textQueue = textQueue.slice(paso);
        setPending((prev) => (prev ? { ...prev, content: shownText } : prev));

        frame = requestAnimationFrame(drain);
      };

      const volcar = () => {
        if (frame !== null) cancelAnimationFrame(frame);
        frame = null;
        if (!textQueue) return;
        shownText += textQueue;
        textQueue = '';
        setPending((prev) => (prev ? { ...prev, content: shownText } : prev));
      };

      const queueText = (chunk: string) => {
        textQueue += chunk;
        if (!instantaneo && esEntrega(shownText + textQueue)) instantaneo = true;
        if (instantaneo) {
          volcar();
          return;
        }
        if (frame === null) frame = requestAnimationFrame(drain);
      };

      /**
       * Al terminar no se vuelca lo que queda de golpe: se deja que acabe de
       * salir al mismo ritmo, que si no el ultimo trozo aparecia de un tiron
       * justo al final. Al abortar si, porque ahi el usuario ya ha dicho basta.
       */
      const settleText = (abortado: boolean) =>
        new Promise<void>((resolve) => {
          if (abortado || !textQueue) {
            if (frame !== null) cancelAnimationFrame(frame);
            frame = null;
            if (textQueue) {
              shownText += textQueue;
              textQueue = '';
              setPending((prev) => (prev ? { ...prev, content: shownText } : prev));
            }
            resolve();
            return;
          }

          // Tope de seguridad: pase lo que pase, el mensaje final no se hace
          // esperar mas de un segundo.
          const limite = setTimeout(() => {
            clearInterval(vigilante);
            if (frame !== null) cancelAnimationFrame(frame);
            frame = null;
            textQueue = '';
            resolve();
          }, 1000);

          const vigilante = setInterval(() => {
            if (textQueue) return;
            clearInterval(vigilante);
            clearTimeout(limite);
            resolve();
          }, 30);
        });

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
          setError(await fallo(res));
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        /**
         * El turno acaba cuando llega `done`, no cuando el servidor cierra.
         *
         * Antes se seguia leyendo hasta que el socket se cerraba por su cuenta,
         * y como el vigilante de silencios se rearma con cada evento, `done`
         * dejaba dos minutos mas de "esperando" con la luz parpadeando aunque
         * la respuesta ya estuviera entera en pantalla. Ese era el "se queda
         * atascado cuando la IA ya ha acabado".
         */
        let terminado = false;

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
              terminado = true;
            } else if (event.t === 'tool') {
              // Si el turno ha creado un archivo, lo que se escriba despues es
              // la nota que lo acompaña: sale de golpe, con el archivo.
              if (String(event.name).startsWith('crear_')) {
                instantaneo = true;
                volcar();
              }
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

          if (terminado) break;
        }

        // Soltar la conexion en vez de dejarla abierta hasta que expire.
        void reader.cancel().catch(() => {});
      } catch (err) {
        // Abortar es una accion del usuario, no un fallo que reportar.
        abortado = (err as Error).name === 'AbortError';
        if (!abortado) {
          setError('Se ha perdido la conexion. Lo que se habia generado esta guardado.');
        }
      } finally {
        await settleText(abortado);
        clearTimeout(slowTimer);
        clearTimeout(deadTimer);
        setSlow(false);
        setToolRunning(null);
        setPendingStartedAt(null);
        abortRef.current = null;

        setPending(null);
        setPendingFor(null);
        // Si mientras tanto se ha abierto otro chat, esta respuesta no se
        // pega a lo que hay en pantalla: pertenece a otro hilo y ya esta
        // guardada en la base de datos, asi que aparecera al volver a el.
        const sigueDelante = !conversationId || desiredConversationRef.current === conversationId;
        if (sigueDelante && (finalText || finalReasoning || finalTrace.length)) {
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

  useEffect(() => {
    if (!menuFor) setConfirmProject(null);
  }, [menuFor]);

  // Una conversacion de un proyecto vive **dentro** del proyecto, como en
  // claude.ai: cuelga de el en la barra lateral y no aparece tambien suelta
  // en la lista por fechas. Verlo en los dos sitios era lo que hacia que el
  // proyecto pareciera una etiqueta y no un sitio.
  const groups = useMemo(
    () => groupByDate(conversations.filter((c) => !c.project_id)),
    [conversations],
  );

  const projectConversations = useMemo(() => {
    const map = new Map<string, Conversation[]>();
    for (const c of conversations) {
      if (!c.project_id) continue;
      const list = map.get(c.project_id);
      if (list) list.push(c);
      else map.set(c.project_id, [c]);
    }
    return map;
  }, [conversations]);

  /** El proyecto de la conversacion abierta, para la miga de pan de arriba. */
  const activeProject = projects.find((p) => p.id === active?.project_id) ?? null;

  // El pie del redactor recuerda verificar las fuentes solo cuando la ultima
  // respuesta de verdad busco algo, no siempre.
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
  const lastUsedWebSearch = Boolean(lastAssistant?.trace?.some((s) => s.name === 'buscar_web'));

  /**
   * Si la respuesta en curso es de la conversacion que se esta viendo.
   *
   * En incognito no hay id de conversacion y `pendingFor` se queda en null:
   * ahi solo existe un hilo, asi que se ensena igual.
   */
  const mio = pendingFor === null || pendingFor === activeId;

  return (
    <div
      className={`shell${collapsed ? ' collapsed' : ''}${artifact ? ' with-artifact' : ''}`}
    >
      {/* No pinta nada: mide lo que de verdad se ve cuando sale el teclado del
          movil y corta el zoom de dos dedos. */}
      <MobileViewport />

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
          <button className="side-nav-item" onClick={() => setConnectorsOpen(true)}>
            <Plug size={15} /> Conectores
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
            <div key={p.id} style={{ position: 'relative' }}>
              <button
                className={`side-nav-item${openProjectId === p.id ? ' on' : ''}`}
                onClick={() => {
                  setOpenProjectId(p.id);
                  setSidebarOpen(false);
                }}
              >
                <Folder size={14} />
                <span className="conv-title">{p.name}</span>
                <span
                  className="conv-menu"
                  role="button"
                  tabIndex={0}
                  aria-label="Opciones del proyecto"
                  aria-expanded={menuFor === `proyecto-${p.id}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuFor(menuFor === `proyecto-${p.id}` ? null : `proyecto-${p.id}`);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      e.stopPropagation();
                      setMenuFor(menuFor === `proyecto-${p.id}` ? null : `proyecto-${p.id}`);
                    }
                  }}
                >
                  <Dots />
                </span>
              </button>

              {menuFor === `proyecto-${p.id}` && (
                <div
                  className="pop"
                  style={{ right: 8, top: 32 }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <button className="pop-item" onClick={() => void renameProject(p.id, p.name)}>
                    <Pencil /> Renombrar
                  </button>

                  {confirmProject === p.id ? (
                    <>
                      <p className="pop-note">
                        {p.conversations
                          ? `Sus ${p.conversations} conversaciones no se borran: vuelven a la lista general.`
                          : 'No tiene conversaciones.'}
                      </p>
                      <button className="pop-item danger" onClick={() => void removeProject(p.id)}>
                        <Trash /> Si, borrar
                      </button>
                      <button className="pop-item" onClick={() => setConfirmProject(null)}>
                        Cancelar
                      </button>
                    </>
                  ) : (
                    <button className="pop-item danger" onClick={() => setConfirmProject(p.id)}>
                      <Trash /> Borrar proyecto
                    </button>
                  )}
                </div>
              )}

              {(projectConversations.get(p.id) ?? []).slice(0, 6).map((c) => (
                <div key={c.id} style={{ position: 'relative' }}>
                  <button
                    className={`side-sub${c.id === activeId && !openProjectId ? ' on' : ''}`}
                    onClick={() => {
                      setOpenProjectId(null);
                      void openConversation(c.id);
                    }}
                    title={c.title}
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
                    <div className="pop" style={{ right: 8, top: 28 }}>
                      <button
                        className="pop-item"
                        onClick={() => void renameConversation(c.id, c.title)}
                      >
                        <Pencil /> Renombrar
                      </button>
                      <button className="pop-item" onClick={() => void detachConversation(c.id)}>
                        <Folder /> Sacar del proyecto
                      </button>
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
            {!openProject && activeProject && (
              <>
                <button
                  className="crumb"
                  onClick={() => setOpenProjectId(activeProject.id)}
                  title="Volver al proyecto"
                >
                  {activeProject.name}
                </button>
                <span className="crumb-sep">/</span>
              </>
            )}
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
            onDeleted={(id) => {
              setOpenProjectId(null);
              void loadProjects();
              // Sus conversaciones vuelven a la lista general, que es lo que
              // hace el servidor: si no, seguirian colgando de un proyecto que
              // ya no esta.
              setConversations((prev) =>
                prev.map((c) => (c.project_id === id ? { ...c, project_id: null } : c)),
              );
            }}
          />
        ) : (
          <>
        {/*
          Todo lo que indica "esto se esta generando" se ensena solo en la
          conversacion a la que pertenece. Al abrir otra mientras responde,
          este hilo se ve quieto y el de origen conserva su burbuja.
        */}
        <MessageList
          messages={messages}
          pending={mio ? pending : null}
          streaming={mio && streaming}
          slow={mio && slow}
          toolRunning={mio ? toolRunning : null}
          pendingStartedAt={mio ? pendingStartedAt : null}
          error={error}
          incognito={incognito}
          greeting={greeting(user.email)}
          onRetry={retry}
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
      {connectorsOpen && <ConnectorsModal onClose={() => setConnectorsOpen(false)} />}

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

/**
 * Convierte una respuesta fallida en una frase que se pueda leer.
 *
 * El cuerpo de un error **no siempre es nuestro**. Cuando Render reinicia la
 * instancia, su balanceador responde antes de que la peticion llegue a la
 * aplicacion, y lo que devuelve es su pagina 502: cuarenta kilobytes de HTML
 * con las tipografias incrustadas en base64. Eso se estaba volcando entero en
 * el banner de error, encima de la conversacion, y parecia que el modelo habia
 * contestado con codigo.
 *
 * Asi que solo se confia en el cuerpo cuando es texto plano y corto, que es
 * justo la forma de los errores de esta aplicacion ("No autenticado",
 * "Conversacion no encontrada"). Para todo lo demas manda el codigo de estado.
 */
async function fallo(res: Response): Promise<string> {
  const tipo = res.headers.get('content-type') ?? '';
  const nuestro = tipo.startsWith('text/plain') || tipo.startsWith('application/json');

  if (nuestro) {
    const cuerpo = (await res.text().catch(() => '')).trim();
    // El limite descarta de paso cualquier pagina de error que llegue mal
    // etiquetada, sin tener que adivinar de quien es.
    if (cuerpo && cuerpo.length <= 300 && !cuerpo.startsWith('<')) return cuerpo;
  }

  if (res.status === 401) return 'Se ha cerrado la sesion. Vuelve a entrar.';
  if (res.status === 413) return 'El mensaje o los archivos son demasiado grandes.';
  if (res.status === 429) return 'Demasiadas peticiones seguidas. Espera un momento.';
  if (res.status >= 500) {
    return 'El servidor no estaba disponible (probablemente reiniciandose). Dale a Reintentar en unos segundos.';
  }
  return `El servidor no ha respondido (error ${res.status}).`;
}
