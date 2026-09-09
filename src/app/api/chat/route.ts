import { randomUUID } from 'node:crypto';

import { currentUser } from '@/lib/auth';
import { ready, sql } from '@/lib/db';
import {
  type ChatMessage,
  colaDeSuplentes,
  complete,
  streamCompletion,
  TITLE_MODEL,
} from '@/lib/llm';
import { DEFAULT_SYSTEM_PROMPT, renderPrompt, TITLE_PROMPT } from '@/lib/prompt';
import { projectPromptBlock } from '@/lib/projects';
import { getSkillContent } from '@/lib/skills';
import { availableTools, runTool, type ToolSpec, type ToolUI } from '@/lib/tools';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Cuantos mensajes previos se envian. Acota el gasto y la latencia. */
const HISTORY_LIMIT = 40;

/**
 * Cuantas rondas de herramientas se permiten por respuesta.
 *
 * Sin tope, un modelo que interpreta mal un resultado puede quedarse buscando
 * en bucle hasta agotar la cuota. Tres rondas bastan para "busca, lee la mejor
 * fuente, responde".
 */
/**
 * Vueltas de herramienta por respuesta.
 *
 * Tres se quedaban cortas: cargar la skill del documento y buscar en la web
 * las cifras que la propia skill pide citar ya gastan tres, y la vuelta que
 * habria creado el archivo se quedaba sin herramientas — visto en produccion,
 * con la presentacion entera volcada como JSON en un bloque de codigo porque
 * ya no podia llamar a nada.
 */
const MAX_TOOL_ROUNDS = 6;

/**
 * Herramienta de escape del reintento forzado.
 *
 * El modelo del router falla de dos formas al pedirle un archivo: unas veces
 * carga la skill, anuncia que va a generar y termina el turno sin llamar a
 * nada; otras ni siquiera carga la skill y escribe la presentacion entera en
 * el chat, diapositiva por diapositiva. La segunda no deja rastro en la traza.
 *
 * En vez de adivinar por palabras del mensaje que es lo que se pedia — que
 * falla con "resume el informe que te pase" y con cualquier frase que no
 * estuviera en la lista — se le vuelve a preguntar obligandole a elegir una
 * herramienta, y se le da esta como salida. Decide el modelo, que es quien
 * entiende la peticion, y no una lista de palabras.
 */
const NO_TOOL: ToolSpec = {
  type: 'function',
  function: {
    name: 'sin_herramienta',
    description:
      'Usala cuando la respuesta que ya has escrito esta completa tal cual y no hacia falta generar ningun archivo ni buscar nada. Si en cambio lo que te han pedido era un documento, una presentacion o una hoja de calculo, no uses esta: llama a la herramienta que crea ese archivo.',
    parameters: { type: 'object', properties: {} },
  },
};

/** A partir de aqui una respuesta ya no es una contestacion de chat, es el cuerpo de un documento. */
const LONG_ANSWER = 300;

/** Skills cuya carga significa que el modelo iba a generar un archivo. */
const DOC_SKILLS = new Set(['docx', 'pptx', 'xlsx']);

/** Un paso de la traza de herramientas de un mensaje. Se persiste tal cual. */
export type TraceStep = { id: string; name: string; args: Record<string, unknown>; ui?: ToolUI };

type Event =
  | { t: 'delta'; v: string }
  | { t: 'reasoning'; v: string }
  | { t: 'tool'; id: string; name: string; args: Record<string, unknown> }
  | { t: 'tool_result'; id: string; ui?: ToolUI }
  | { t: 'title'; v: string }
  | { t: 'user'; id: string }
  | { t: 'done'; id: string; reply_to?: string | null; version_index?: number }
  | { t: 'error'; v: string };

const encode = (e: Event) => new TextEncoder().encode(JSON.stringify(e) + '\n');

type ToolCall = { id: string; name: string; args: string };

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return new Response('No autenticado', { status: 401 });

  await ready();

  const {
    conversationId,
    content: rawContent,
    model,
    reasoningEffort,
    incognito = false,
    history: clientHistory,
    mode = 'send',
    replyTo,
  } = (await req.json()) as {
    conversationId: string | null;
    content?: string;
    model: string;
    reasoningEffort?: 'low' | 'medium' | 'high' | null;
    incognito?: boolean;
    history?: { role: string; content: string }[];
    mode?: 'send' | 'retry';
    replyTo?: string;
  };

  if (mode === 'send' && (typeof rawContent !== 'string' || !rawContent.trim())) {
    return new Response('Peticion invalida', { status: 400 });
  }
  // Reintentar guarda la respuesta nueva como otra version en vez de repetir
  // el mensaje del usuario: solo tiene sentido con conversacion persistida,
  // en incognito el cliente ya lo resuelve truncando su propio array.
  if (mode === 'retry' && (incognito || typeof replyTo !== 'string' || !replyTo)) {
    return new Response('Peticion invalida', { status: 400 });
  }
  if (!incognito && !conversationId) {
    return new Response('Peticion invalida', { status: 400 });
  }

  // En incognito no se toca la base de datos en ningun momento: ni se busca la
  // conversacion, ni se guarda el mensaje, ni se titula. El historial lo aporta
  // el cliente, que es el unico sitio donde vive.
  if (!incognito) {
    // La pertenencia se comprueba en la consulta, no despues: asi un id ajeno
    // no llega a leer nada aunque se adivine.
    const [conv] = await sql<{ id: string }[]>`
      SELECT id FROM conversations
      WHERE id = ${conversationId} AND user_id = ${user.id}
      LIMIT 1
    `;
    if (!conv) return new Response('Conversacion no encontrada', { status: 404 });
  }

  const [settings] = await sql<
    {
      system_prompt: string | null;
      temperature: number;
      display_name: string | null;
      about_you: string | null;
      instructions: string | null;
    }[]
  >`
    SELECT system_prompt, temperature, display_name, about_you, instructions
    FROM settings WHERE user_id = ${user.id}
  `;

  type Row = {
    id: string;
    role: string;
    content: string;
    reply_to: string | null;
    version_index: number;
    created_at: Date;
    trace: { name: string; args?: Record<string, unknown> }[] | null;
  };

  // Todas las filas, no solo las ultimas N: hace falta el historial completo
  // para poder quedarse solo con la version mas reciente de cada respuesta y,
  // en un reintento, cortar justo antes del turno que se esta regenerando.
  const rows: Row[] = incognito
    ? []
    : await sql<Row[]>`
        SELECT id, role, content, reply_to, version_index, created_at, trace
        FROM messages
        WHERE conversation_id = ${conversationId}
        ORDER BY created_at ASC
      `;

  let content = rawContent ?? '';
  let targetUserId: string | null = null;

  if (mode === 'retry') {
    const target = rows.find((r) => r.id === replyTo && r.role === 'user');
    if (!target) return new Response('Mensaje no encontrado', { status: 404 });
    content = target.content;
    targetUserId = target.id;
  }

  /**
   * Reconstruye el historial quedandose solo con la version mas reciente de
   * cada respuesta (las anteriores siguen en la base de datos, navegables
   * desde el selector, pero no se le repiten al modelo como si fueran turnos
   * aparte). `cutBeforeId`, si se da, para antes de ese mensaje: es como
   * queda el contexto justo antes del turno que se va a reintentar.
   */
  function buildHistory(list: Row[], cutBeforeId?: string | null) {
    const latestByReplyTo = new Map<string, Row>();
    for (const r of list) {
      if (r.role === 'assistant' && r.reply_to) {
        const cur = latestByReplyTo.get(r.reply_to);
        if (!cur || r.version_index > cur.version_index) latestByReplyTo.set(r.reply_to, r);
      }
    }
    const out: { role: string; content: string }[] = [];
    for (const r of list) {
      if (cutBeforeId && r.id === cutBeforeId) break;
      if (r.role === 'assistant' && r.reply_to) {
        if (latestByReplyTo.get(r.reply_to)?.id === r.id) out.push({ role: r.role, content: r.content });
      } else {
        out.push({ role: r.role, content: r.content });
      }
    }
    return out;
  }

  const history = incognito
    ? (clientHistory ?? []).slice(-HISTORY_LIMIT)
    : buildHistory(rows, targetUserId).slice(-HISTORY_LIMIT);

  const userMessageId = randomUUID();
  if (!incognito && mode === 'send') {
    await sql`
      INSERT INTO messages (id, conversation_id, role, content, reply_to)
      VALUES (${userMessageId}, ${conversationId}, 'user', ${content}, ${userMessageId})
    `;
  }

  // Version que le toca a esta respuesta: 1 para un turno nuevo, o la
  // siguiente libre si se esta reintentando uno que ya tiene alguna.
  const replyToId = mode === 'retry' ? targetUserId : userMessageId;
  const nextVersion =
    mode === 'retry'
      ? Math.max(0, ...rows.filter((r) => r.reply_to === targetUserId).map((r) => r.version_index)) + 1
      : 1;

  // Un prompt guardado pero en blanco es el preset "Sin prompt": se respeta y
  // no se cae al de fabrica. Solo la ausencia de fila usa el de fabrica.
  const stored = settings?.system_prompt;
  const systemPrompt = stored === undefined || stored === null ? DEFAULT_SYSTEM_PROMPT : stored;

  // Perfil y proyecto se añaden detras del prompt, no dentro: el prompt de
  // sistema puede estar personalizado o vacio, y estas dos cosas tienen que
  // llegar igual. En incognito no hay conversacion guardada, asi que tampoco
  // hay proyecto del que sacar contexto.
  const profile = profileBlock(settings);
  const project = incognito || !conversationId ? '' : await projectPromptBlock(conversationId);
  const loaded = await loadedSkillsBlock(user.id, rows);
  const preamble = [systemPrompt.trim() ? renderPrompt(systemPrompt) : '', profile, project, loaded]
    .filter(Boolean)
    .join('\n\n');

  const conversation: ChatMessage[] = [
    ...(preamble ? [{ role: 'system' as const, content: preamble }] : []),
    ...history.map((m) => ({ role: m.role as ChatMessage['role'], content: m.content })),
    { role: 'user' as const, content },
  ];

  // Las herramientas estan siempre disponibles: no hay interruptor que las
  // desactive, asi que se ofrecen siempre que existan (documentos sin clave,
  // busqueda/imagenes si hay clave configurada, historial siempre).
  const tools = await availableTools(user.id);

  const assistantId = randomUUID();
  const isFirstExchange = mode === 'send' && history.length === 0;
  const abort = new AbortController();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let text = '';
      let reasoning = '';
      let closed = false;
      const trace: TraceStep[] = [];

      const send = (e: Event) => {
        if (!closed) controller.enqueue(encode(e));
      };

      // El cliente arranca el turno con un id local; en cuanto se conoce el
      // real de la base de datos se le manda para que lo adopte, y asi un
      // reintento posterior pueda referenciarlo por su id de verdad.
      if (!incognito && mode === 'send') send({ t: 'user', id: userMessageId });

      /**
       * El titulo se pide **a la vez** que la respuesta, no despues.
       *
       * Antes se generaba al terminar, y como es otra llamada al router, el
       * `done` y el cierre del stream esperaban a que volviera: con el router
       * lento eso son hasta sesenta segundos en los que la respuesta ya estaba
       * entera en pantalla y la aplicacion seguia diciendo que generaba. Es el
       * "se queda atascado con la luz parpadeando" de siempre.
       *
       * Lanzandolo aqui, para cuando la respuesta acaba casi siempre ya esta
       * listo. El `catch` es obligatorio: una promesa que nadie espera todavia
       * y que falla tumbaria el proceso.
       */
      const tituloPendiente =
        !incognito && isFirstExchange ? makeTitle(content).catch(() => null) : null;

      // Si el usuario cierra la pestana o pulsa "detener", se corta la peticion
      // al router en vez de seguir gastando tokens contra el vacio. Lo generado
      // hasta ese punto se guarda igual, mas abajo.
      req.signal.addEventListener('abort', () => abort.abort());

      try {
        // Cada vuelta es una respuesta del modelo. Si pide herramientas, se
        // ejecutan, se anaden al contexto y se vuelve a preguntar; si contesta
        // texto, se acaba.
        // Los modelos pequenos del router se quedan a veces a mitad de camino:
        // cargan la skill del documento, anuncian "voy a generar la
        // presentacion" y terminan el turno sin llamar a la herramienta. Si
        // eso pasa se reintenta una vez obligando a que llame a alguna
        // (`tool_choice: "required"`, que este router si admite — el nombre de
        // funcion concreto lo rechazan los proveedores). Se reintenta solo una
        // vez y solo si ya habia cargado una skill de documento: es la senal
        // de que estaba a punto de generar un archivo, no una conversacion
        // normal a la que forzarle una herramienta seria absurdo.
        // Dos como mucho: el primero suele acabar en `usar_skill` y hace falta
        // otro para que llegue a crear el archivo.
        let forced = 0;
        // Compartido por todas las vueltas del turno: una skill se sirve una vez.
        const servedSkills = new Set<string>();

        for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
          const offerTools = tools.length > 0 && round < MAX_TOOL_ROUNDS;

          /**
           * Un turno con herramientas habla varias veces, y lo que dice en
           * cada vuelta se iba pegando sin nada en medio: "monto la
           * tabla.Listo. El archivo...". Una linea en blanco entre vueltas es
           * lo que separa dos parrafos de verdad.
           */
          if (round > 0 && text && !/\s$/.test(text)) {
            const separador = '\n\n';
            text += separador;
            send({ t: 'delta', v: separador });
          }

          const result = await runRound({
            model,
            messages: conversation,
            temperature: settings?.temperature ?? 1,
            reasoningEffort: reasoningEffort ?? undefined,
            tools: offerTools ? tools : [],
            signal: abort.signal,
            onDelta: (v) => {
              text += v;
              send({ t: 'delta', v });
            },
            onReasoning: (v) => {
              reasoning += v;
              send({ t: 'reasoning', v });
            },
          });

          if (result.error) {
            send({ t: 'error', v: result.error });
            break;
          }

          if (result.toolCalls.length === 0) {
            // Se vuelve a preguntar cuando el modelo ya habia cargado una skill
            // de documento (iba a generar y se quedo a medias) o cuando ha
            // soltado una respuesta larga sin usar nada: las dos formas en que
            // se salta la herramienta. Una contestacion corta de chat no entra
            // aqui, asi que hablar normal no paga ninguna llamada de mas.
            const loadedDocSkill = trace.some(
              (step) => step.name === 'usar_skill' && DOC_SKILLS.has(String(step.args?.nombre ?? '')),
            );
            /**
             * Una respuesta que **es** codigo ya es la entrega.
             *
             * Pidiendo "hazme una pagina HTML con una calculadora de
             * propinas", la respuesta pasaba de LONG_ANSWER y no habia creado
             * ningun archivo, asi que se forzaba una herramienta — y el modelo
             * elegia crear_documento_word y devolvia un .docx con el HTML
             * dentro. Absurdo: lo que se pedia era la pagina, y la pagina ya
             * estaba escrita.
             *
             * Se mide por peso, no por presencia: una respuesta normal puede
             * llevar un ejemplo corto entre vallas sin dejar de ser una
             * respuesta a la que si le falta su archivo.
             */
            const enBloques = [...result.text.matchAll(/```[\s\S]*?```/g)].reduce(
              (n, m) => n + m[0].length,
              0,
            );
            const esSobreTodoCodigo = enBloques > result.text.trim().length * 0.5;

            const maybeOwesFile =
              forced < 2 &&
              tools.length > 0 &&
              !esSobreTodoCodigo &&
              (loadedDocSkill || result.text.trim().length >= LONG_ANSWER) &&
              !trace.some((step) => step.name.startsWith('crear_'));

            if (!maybeOwesFile) break;

            forced++;
            // Lo que ya dijo va al contexto para que el reintento no repita el
            // preambulo, y se pide otra vuelta con la herramienta obligada.
            if (result.text.trim()) {
              conversation.push({ role: 'assistant', content: result.text } as ChatMessage);
            }
            const retryRound = await runRound({
              model,
              messages: conversation,
              temperature: settings?.temperature ?? 1,
              reasoningEffort: reasoningEffort ?? undefined,
              tools: [...tools, NO_TOOL],
              forceTool: true,
              signal: abort.signal,
              /**
               * Esta vuelta existe para arrancar una llamada a herramienta, no
               * para hablar: lo que diga se tira.
               *
               * Antes se sumaba a la respuesta, y cuando el modelo en vez de
               * llamar a la herramienta volvia a escribir lo mismo, al usuario
               * le llegaba dos veces. Visto con una calculadora de propinas en
               * HTML: la pagina entera repetida, con la valla de codigo suelta
               * en medio y el <script> en un bloque aparte etiquetado "php".
               * Se le echaba la culpa al modelo; era esta linea.
               *
               * No se pierde nada: si la llamada sale, la vuelta siguiente es
               * la que redacta el mensaje que acompaña al archivo.
               */
              onDelta: () => {},
              onReasoning: () => {},
            });

            if (retryRound.error || retryRound.toolCalls.length === 0) break;
            // El modelo dice que su respuesta ya estaba completa: se le cree.
            if (retryRound.toolCalls.some((c) => c.name === NO_TOOL.function.name)) break;
            result.toolCalls = retryRound.toolCalls.filter((c) => c.name !== NO_TOOL.function.name);
            result.text = retryRound.text;
          }

          // El turno del asistente que pide las herramientas tiene que quedar
          // en el contexto: sin el, el proveedor rechaza los mensajes de rol
          // "tool" que vienen despues por no corresponder a ninguna llamada.
          conversation.push({
            role: 'assistant',
            content: result.text || null,
            tool_calls: result.toolCalls.map((c) => ({
              id: c.id,
              type: 'function',
              function: { name: c.name, arguments: c.args },
            })),
          } as ChatMessage);

          for (const call of result.toolCalls) {
            let args: Record<string, unknown> = {};
            try {
              args = JSON.parse(call.args || '{}');
            } catch {
              // Argumentos malformados: se ejecuta con lo que haya, y la
              // herramienta contestara que falta la consulta.
            }

            send({ t: 'tool', id: call.id, name: call.name, args });

            const outcome = await runTool(user.id, call.name, args, incognito ? null : conversationId, servedSkills);
            conversation.push({
              role: 'tool',
              tool_call_id: call.id,
              content: outcome.forModel,
            } as ChatMessage);

            trace.push({ id: call.id, name: call.name, args, ui: outcome.ui });
            send({ t: 'tool_result', id: call.id, ui: outcome.ui });
          }
        }
      } catch (err) {
        const aborted = (err as Error)?.name === 'AbortError';
        if (!aborted) {
          send({ t: 'error', v: 'Se ha perdido la conexion con el router.' });
        }
      }

      // Se guarda aunque la respuesta se cortara a medias: es preferible un
      // mensaje incompleto en el historial a perder lo que ya se habia leido.
      // Un turno que solo llamo a una herramienta sin anadir texto (por
      // ejemplo, crear un documento sin comentario) tambien cuenta como
      // contenido que conservar.
      if (!incognito) {
        if (text.trim() || reasoning.trim() || trace.length > 0) {
          // sql.json() etiqueta el parametro como jsonb para que postgres.js lo
          // mande tal cual; pasar una cadena ya serializada a mano hace que la
          // librearia la trate como texto plano y Postgres la vuelva a
          // envolver, guardando un jsonb-de-un-string en vez del array.
          await sql`
            INSERT INTO messages (id, conversation_id, role, content, reasoning, model, trace, reply_to, version_index)
            VALUES (${assistantId}, ${conversationId}, 'assistant', ${text},
                    ${reasoning || null}, ${model},
                    ${trace.length ? sql.json(trace as unknown as Parameters<typeof sql.json>[0]) : null},
                    ${replyToId}, ${nextVersion})
          `;
        }
        await sql`UPDATE conversations SET updated_at = now() WHERE id = ${conversationId}`;
      }

      if (tituloPendiente) {
        // Y aun asi, con tope: si el titulo no esta a los tres segundos, se
        // cierra sin el. La conversacion se queda como "Nueva conversacion",
        // que es infinitamente mejor que dejar la interfaz creyendo que aun
        // esta escribiendo.
        const title = await Promise.race([
          tituloPendiente,
          new Promise<null>((r) => setTimeout(() => r(null), 3000)),
        ]);
        if (title) {
          await sql`UPDATE conversations SET title = ${title} WHERE id = ${conversationId}`;
          send({ t: 'title', v: title });
        }
      }

      send({ t: 'done', id: assistantId, reply_to: incognito ? null : replyToId, version_index: incognito ? undefined : nextVersion });
      closed = true;
      controller.close();
    },

    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Sin esto algunos proxies acumulan la respuesta y el streaming se ve
      // como un unico bloque al final.
      'X-Accel-Buffering': 'no',
    },
  });
}

/**
 * Una vuelta de conversacion con el modelo.
 *
 * Devuelve el texto emitido y las llamadas a herramientas que haya pedido. Los
 * fragmentos se van entregando por los callbacks segun llegan, para que el
 * usuario vea escribir en vez de esperar al final.
 */
type RoundOpts = {
  model: string;
  messages: ChatMessage[];
  temperature: number;
  reasoningEffort?: 'low' | 'medium' | 'high';
  tools: unknown[];
  signal: AbortSignal;
  /** Obliga al modelo a llamar a alguna herramienta en vez de solo contestar texto. */
  forceTool?: boolean;
  onDelta: (v: string) => void;
  onReasoning: (v: string) => void;
};

/**
 * Cuanto se espera a la primera palabra antes de dar el intento por perdido.
 *
 * Medido contra este router: lo normal son entre seis y catorce segundos hasta
 * el primer caracter. Pero cuando las rutas estan en enfriamiento, "auto"
 * acepta la peticion y **no emite nada nunca**: se han visto esperas de dos
 * minutos terminando en nada. Pasado este plazo se pasa al siguiente modelo de
 * SUPLENTES, que o contesta enseguida o devuelve su 429 al instante.
 *
 * Noventa segundos dejan pasar holgadamente el caso lento de verdad y cortan el
 * caso muerto mucho antes de que se note como "esto no va".
 */
const SIN_PRIMERA_PALABRA_MS = 90_000;

/** Lo que se espera al primer modelo cuando ya no queda ningun suplente libre. */
const ULTIMA_ESPERA_MS = 270_000;

/**
 * Una vuelta de conversacion, reintentando si el modelo se queda mudo.
 *
 * Solo se reintenta cuando **no ha llegado nada**: si ya habia empezado a
 * escribir, cortar a mitad y volver a empezar seria peor que la pausa.
 */
/**
 * Modelos concretos a los que caer cuando el elegido no da nada.
 *
 * El router limita por modelo con enfriamientos de unos minutos. Cuando le
 * toca a uno responde 429 al instante, lo cual es comodo: recorrer la lista
 * entera cuesta milisegundos hasta dar con uno libre.
 *
 * El problema es "auto". Con todas las rutas en enfriamiento **no devuelve el
 * 429: se queda colgado sin mandar un solo byte**. Comprobado a mano contra el
 * router, sin pasar por esta aplicacion: "auto" agota los sesenta segundos con
 * cero bytes mientras un modelo concreto libre contesta en menos de uno. Por
 * eso, en cuanto "auto" se queda mudo, no se insiste con "auto" — se pregunta
 * por nombre.
 *
 * Estan aqui los que el catalogo acepta de verdad. Ojo: /v1/models lista
 * modelos que luego dan 404 al pedirles algo (claude-sonnet-4-5, entre otros),
 * asi que esta lista sale de probarlos uno a uno, no de leer el catalogo.
 */
/**
 * Cuanto se le da a cada suplente para arrancar.
 *
 * Menos que al modelo elegido: cuando quedan doscientos y pico candidatos
 * detras, insistir con uno lento sale mas caro que probar el siguiente.
 */
const PACIENCIA_SUPLENTE_MS = 45_000;

/**
 * Tope de reloj para todo el recorrido de suplentes.
 *
 * Los capados contestan 429 en tres decimas y los alias 404 igual de rapido,
 * asi que recorrer decenas de modelos no gasta presupuesto: solo lo gastan los
 * que se quedan colgados. Con esto, el peor caso del turno queda por debajo de
 * los 540 s del tope general (90 del primero + 135 aqui + 270 de la ultima bala).
 */
const PRESUPUESTO_SUPLENTES_MS = 135_000;

/**
 * Una vuelta de conversacion, cambiando de modelo si el que toca no responde.
 *
 * Solo se cambia cuando **no ha llegado nada**: si ya habia empezado a
 * escribir, cortar a mitad y volver a empezar con otro modelo seria peor que
 * la pausa.
 */
async function runRound(
  opts: RoundOpts,
): Promise<{ text: string; toolCalls: ToolCall[]; error?: string }> {
  // El elegido, con la paciencia normal.
  const primero = await unIntento(opts);
  if (!primero.mudo && !primero.agotado && !primero.reintentable) return primero;
  if (opts.signal.aborted) return primero;

  let ultimoError = primero.error;
  // Si nadie llega a arrancar, se sabra si fue por cuota (reintentar mas tarde
  // tiene sentido) o porque todos se colgaron (no lo tiene).
  let todosCapados = true;
  let probados = 0;

  const suplentes = (await colaDeSuplentes(opts.tools.length > 0)).filter(
    (m) => m !== opts.model,
  );
  const limite = Date.now() + PRESUPUESTO_SUPLENTES_MS;

  for (const model of suplentes) {
    if (Date.now() >= limite) {
      console.warn(`[novachat] presupuesto agotado tras ${probados} suplentes`);
      todosCapados = false; // no se llego al final: quedaba gente por preguntar
      break;
    }

    const r = await unIntento({ ...opts, model }, PACIENCIA_SUPLENTE_MS);
    probados++;

    if (!r.mudo && !r.agotado && !r.reintentable) {
      console.warn(`[novachat] responde ${model} tras ${probados} intentos`);
      return r;
    }
    if (opts.signal.aborted) return r;

    ultimoError = r.error ?? ultimoError;
    if (!r.agotado) todosCapados = false;
  }

  /**
   * Ultima bala: el primero quiza solo iba lento.
   *
   * Se juega solo cuando **todos** los suplentes han devuelto 429, porque
   * entonces no queda nadie a quien preguntar y esperar es gratis en
   * comparacion con rendirse. Segun las analiticas del propio router, su
   * tiempo medio hasta el primer token son catorce segundos y su latencia P95
   * pasa de cincuenta: con treinta segundos de paciencia se estaban tirando
   * respuestas que si llegaban.
   *
   * No se aplica siempre porque, cuando hay algun suplente libre, cambiar de
   * modelo devuelve la respuesta en dos segundos — mucho mejor que esperar.
   */
  if (todosCapados && !opts.signal.aborted) {
    console.warn(`[novachat] ${probados} suplentes capados, esperando al primero`);
    const r = await unIntento(opts, ULTIMA_ESPERA_MS);
    if (!r.mudo) return r;
  }

  return {
    text: '',
    toolCalls: [],
    error:
      ultimoError ??
      'Ningun modelo del router esta disponible ahora mismo. Espera unos minutos y reintenta.',
  };
}

async function unIntento(
  opts: RoundOpts,
  paciencia = SIN_PRIMERA_PALABRA_MS,
): Promise<{ text: string; toolCalls: ToolCall[]; error?: string; mudo?: boolean; agotado?: boolean; reintentable?: boolean }> {
  // Vigilante propio: se aborta la peticion al router sin tocar la del usuario,
  // para poder distinguir despues quien corto.
  const vigilante = new AbortController();
  const cortarTodo = () => vigilante.abort();
  opts.signal.addEventListener('abort', cortarTodo);

  let huboContenido = false;
  const reloj = setTimeout(() => {
    if (!huboContenido) vigilante.abort();
  }, paciencia);

  // Tope duro, que antes lo ponia `streamCompletion` con su propio timeout y
  // ahora se le pasa nuestra señal: una respuesta que empieza y no termina
  // nunca tambien tiene que cortarse.
  const tope = setTimeout(() => vigilante.abort(), 540_000);

  try {
    return await unIntentoInterno(opts, vigilante.signal, () => {
      if (!huboContenido) {
        huboContenido = true;
        clearTimeout(reloj);
      }
    });
  } catch (err) {
    const abortado = (err as Error)?.name === 'AbortError';
    // Si aborto el vigilante y no habia llegado nada, se puede reintentar.
    if (abortado && !huboContenido && !opts.signal.aborted) {
      return { text: '', toolCalls: [], mudo: true };
    }
    if (abortado) return { text: '', toolCalls: [] };
    throw err;
  } finally {
    clearTimeout(reloj);
    clearTimeout(tope);
    opts.signal.removeEventListener('abort', cortarTodo);
  }
}

async function unIntentoInterno(
  opts: RoundOpts,
  signal: AbortSignal,
  marcarContenido: () => void,
): Promise<{ text: string; toolCalls: ToolCall[]; error?: string; agotado?: boolean; reintentable?: boolean }> {
  let upstream = await streamCompletion(
    {
      model: opts.model,
      messages: opts.messages,
      temperature: opts.temperature,
      reasoning_effort: opts.reasoningEffort,
      ...(opts.tools.length > 0
        ? { tools: opts.tools, tool_choice: opts.forceTool ? 'required' : 'auto' }
        : {}),
    },
    signal,
  );

  // No todos los modelos del router admiten herramientas, y el que no las
  // admite responde 400 en lugar de ignorarlas. En ese caso se reintenta sin
  // ellas: es preferible una respuesta sin busqueda a un error.
  //
  // El 429 queda fuera a proposito. Es "estas capado por ahora", no "no se
  // usar herramientas": reintentar sin ellas gastaba otra peticion para volver
  // a comerse el mismo 429, y de paso habria contestado sin poder crear el
  // archivo que se le pedia.
  if (
    !upstream.ok &&
    opts.tools.length > 0 &&
    upstream.status >= 400 &&
    upstream.status < 500 &&
    upstream.status !== 429
  ) {
    upstream = await streamCompletion(
      {
        model: opts.model,
        messages: opts.messages,
        temperature: opts.temperature,
        reasoning_effort: opts.reasoningEffort,
      },
      signal,
    );
  }

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => '');
    return {
      text: '',
      toolCalls: [],
      error: describeUpstreamError(upstream.status, detail, opts.model),
      // 429 es el enfriamiento por modelo del router. No es el final del
      // camino: hay otros modelos y puede que alguno este libre.
      agotado: upstream.status === 429,
      reintentable: mereceOtroModelo(upstream.status),
    };
  }

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';

  // Las llamadas llegan troceadas igual que el texto: el nombre en un
  // fragmento y los argumentos repartidos en varios. Se acumulan por indice.
  const calls = new Map<number, ToolCall>();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // El SSE separa eventos por linea; un chunk puede partir uno por la mitad,
    // asi que la ultima linea incompleta se deja en el buffer.
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;

      const data = trimmed.slice(5).trim();
      if (data === '[DONE]') continue;

      try {
        const delta = JSON.parse(data)?.choices?.[0]?.delta;
        if (!delta) continue;

        // Los modelos de razonamiento mandan la cadena de pensamiento en un
        // campo aparte, y no hay un nombre unico entre proveedores.
        const think = delta.reasoning_content ?? delta.reasoning;
        if (typeof think === 'string' && think) {
          marcarContenido();
          opts.onReasoning(think);
        }

        if (typeof delta.content === 'string' && delta.content) {
          marcarContenido();
          text += delta.content;
          opts.onDelta(delta.content);
        }

        for (const tc of delta.tool_calls ?? []) {
          marcarContenido();
          const index = tc.index ?? 0;
          const current = calls.get(index) ?? { id: '', name: '', args: '' };
          if (tc.id) current.id = tc.id;
          if (tc.function?.name) current.name = tc.function.name;
          if (tc.function?.arguments) current.args += tc.function.arguments;
          calls.set(index, current);
        }
      } catch {
        // Una linea suelta malformada no debe tumbar la respuesta entera.
      }
    }
  }

  const toolCalls = [...calls.values()].filter((c) => c.name);
  // Algunos proveedores no rellenan el id. El protocolo exige uno para casar
  // la respuesta con la llamada, asi que se inventa si falta.
  for (const call of toolCalls) call.id ||= `call_${randomUUID().slice(0, 8)}`;

  // Ultimo recurso: puede que la llamada venga escrita a mano en el texto.
  if (toolCalls.length === 0) {
    const ofrecidas = new Set(
      opts.tools
        .map((t) => (t as { function?: { name?: string } })?.function?.name)
        .filter((n): n is string => Boolean(n)),
    );
    const rescatadas = rescatarLlamadas(text, ofrecidas);
    if (rescatadas.toolCalls.length) {
      console.warn(
        `[novachat] ${opts.model} escribio ${rescatadas.toolCalls.length} llamada(s) como texto; rescatadas`,
      );
      return { text: rescatadas.resto, toolCalls: rescatadas.toolCalls };
    }
  }

  return { text, toolCalls };
}

/**
 * Rescata llamadas a herramientas que el modelo ha escrito como texto.
 *
 * Varios modelos abiertos del router (Qwen, Hermes y parecidos) no emiten
 * `tool_calls` en el JSON: escupen en el contenido un XML con esta forma
 *
 *     <tool_call><function=nombre><PARAM=clave>valor</PARAM></function></tool_call>
 *
 * y se quedan tan anchos. Comprobado pidiendo una tabla de amortizacion: el
 * modelo compuso la llamada entera y correcta, con sus sesenta filas, pero
 * como no venia por el canal que toca no se ejecutaba nada — y al usuario le
 * llegaban nueve mil caracteres de XML crudo en el chat en lugar de su Excel.
 *
 * Interpretarlo aqui deja intacto todo lo de arriba: la llamada sigue el mismo
 * camino que una normal, se ejecuta, entra en la traza y el turno continua.
 *
 * Los valores llegan sin tipar. Los que empiezan por corchete o llave se leen
 * como JSON (las columnas y las filas vienen asi); el resto se quedan como
 * cadena, que es lo que declara el esquema para titulos y subtitulos.
 */
function rescatarLlamadas(
  texto: string,
  ofrecidas: Set<string>,
): { toolCalls: ToolCall[]; resto: string } {
  const toolCalls: ToolCall[] = [];
  let resto = texto;

  // El cierre es opcional a proposito: si el modelo se corta a mitad, lo que
  // haya llegado hasta el final sigue siendo aprovechable.
  const bloques = /<tool_call>([\s\S]*?)(?:<\/tool_call>|$)/g;
  for (const bloque of texto.matchAll(bloques)) {
    const dentro = bloque[1];
    const nombre = dentro.match(/<function=([^>\s]+)>/)?.[1];
    if (!nombre) continue;

    const args: Record<string, unknown> = {};
    const campos = /<parameter=([^>\s]+)>([\s\S]*?)<\/parameter>/g;
    for (const campo of dentro.matchAll(campos)) {
      const bruto = campo[2].trim();
      if (bruto.startsWith('[') || bruto.startsWith('{')) {
        try {
          args[campo[1]] = JSON.parse(bruto);
          continue;
        } catch {
          // JSON roto: se guarda tal cual y que la herramienta se queje con
          // su mensaje de siempre, que es mas util que perder la llamada.
        }
      }
      args[campo[1]] = bruto;
    }

    if (!Object.keys(args).length || !ofrecidas.has(nombre)) continue;
    toolCalls.push({
      id: `call_${randomUUID().slice(0, 8)}`,
      name: nombre,
      args: JSON.stringify(args),
    });
    resto = resto.replace(bloque[0], '');
  }

  if (toolCalls.length === 0) {
    const enJson = rescatarJson(resto, ofrecidas);
    if (enJson.toolCalls.length) return enJson;
  }

  return { toolCalls, resto: limpiarCola(resto) };
}

/**
 * Quita los restos de sintaxis que quedan al arrancar una llamada del texto.
 *
 * La fuga de JSON venia envuelta en un corchete de mas ("[
[{...}]"), asi que
 * al sacar el valor quedaba ese corchete solo al final de la respuesta. Un
 * mensaje jamas termina de verdad en un corchete o una llave **abiertos**. Los
 * de cierre se respetan: "el array [1,2,3]" es un final legitimo.
 */
const limpiarCola = (t: string) => t.replace(/[\s,[{]+$/, '').trim();

/**
 * El otro dialecto: la llamada pegada como JSON al final de la respuesta.
 *
 * Visto explicando TCP frente a UDP. La explicacion ocupaba mil ciento sesenta
 * caracteres y estaba bien; detras venian ocho mil de
 * `[{"name":"crear_presentacion","parameters":{...}}]` en crudo, para una
 * pregunta que no pedia ninguna presentacion.
 *
 * El candado es que el nombre este entre las herramientas que de verdad se han
 * ofrecido en esta vuelta. Sin eso, a quien pida "dame un JSON con un campo
 * name" se le ejecutaria su propio ejemplo.
 */
function rescatarJson(
  texto: string,
  ofrecidas: Set<string>,
): { toolCalls: ToolCall[]; resto: string } {
  const vacio = { toolCalls: [] as ToolCall[], resto: texto };
  if (!/"name"\s*:/.test(texto)) return vacio;

  for (let i = 0; i < texto.length; i++) {
    const abre = texto[i];
    if (abre !== '{' && abre !== '[') continue;

    const fin = finDelValor(texto, i);
    if (fin < 0) continue;

    let dato: unknown;
    try {
      dato = JSON.parse(texto.slice(i, fin + 1));
    } catch {
      continue;
    }

    const candidatos = Array.isArray(dato) ? dato : [dato];
    const llamadas: ToolCall[] = [];
    for (const c of candidatos) {
      if (!c || typeof c !== 'object') continue;
      const o = c as Record<string, unknown>;
      const nombre = typeof o.name === 'string' ? o.name : '';
      const args = o.parameters ?? o.arguments ?? o.args;
      if (!ofrecidas.has(nombre) || !args || typeof args !== 'object') continue;
      llamadas.push({
        id: `call_${randomUUID().slice(0, 8)}`,
        name: nombre,
        args: JSON.stringify(args),
      });
    }

    if (llamadas.length) {
      return {
        toolCalls: llamadas,
        resto: limpiarCola(texto.slice(0, i) + texto.slice(fin + 1)),
      };
    }
  }

  return vacio;
}

/**
 * Donde termina el valor JSON que empieza en `desde`.
 *
 * Hace falta contar llaves a mano porque el JSON viene incrustado en prosa y
 * no se sabe donde acaba. Las cadenas se saltan enteras: una llave dentro de
 * comillas no cuenta, y una comilla escapada no cierra la cadena.
 */
function finDelValor(texto: string, desde: number): number {
  let nivel = 0;
  let enCadena = false;
  let escapado = false;

  for (let i = desde; i < texto.length; i++) {
    const ch = texto[i];
    if (enCadena) {
      if (escapado) escapado = false;
      else if (ch === '\\') escapado = true;
      else if (ch === '"') enCadena = false;
      continue;
    }
    if (ch === '"') enCadena = true;
    else if (ch === '{' || ch === '[') nivel++;
    else if (ch === '}' || ch === ']') {
      nivel--;
      if (nivel === 0) return i;
      if (nivel < 0) return -1;
    }
  }
  return -1;
}

/**
 * ¿Vale la pena preguntarle a otro modelo, o fallaria igual?
 *
 * Antes solo el 429 hacia avanzar la cola de suplentes, y el 502 se devolvia
 * tal cual al usuario con doscientos cincuenta modelos sin probar. Que es
 * absurdo, porque el 502 dice literalmente que el fallo **no** es de la
 * peticion: el router llego a su proveedor y el proveedor se cayo.
 *
 * Se pasa al siguiente cuando el fallo es del otro lado (5xx), cuando se agoto
 * el tiempo (408) o cuando ese modelo concreto no existe (404, tipico de los
 * alias del router, que se anuncian en /v1/models y luego no resuelven).
 *
 * No se pasa con 401 ni 403: la clave es la misma para todos y fallaria igual
 * doscientas cincuenta veces. Tampoco con 400, que apunta a que lo que estamos
 * mandando esta mal; recorrer la cola entera solo tardaria mas en decir lo
 * mismo, y el reintento sin herramientas de mas arriba ya cubre el 400 que si
 * depende del modelo.
 */
function mereceOtroModelo(status: number): boolean {
  return status >= 500 || status === 408 || status === 404 || status === 409;
}

function describeUpstreamError(status: number, detail: string, model: string) {
  if (status === 401 || status === 403) {
    return 'El router ha rechazado la clave. Revisa LLM_API_KEY.';
  }
  if (status === 404) {
    return `El modelo "${model}" ya no esta disponible en el router. Prueba con otro.`;
  }
  if (status === 429) {
    return 'El proveedor de este modelo ha agotado su cuota. Prueba con otro modelo o espera un poco.';
  }
  const snippet = detail.slice(0, 200).replace(/\s+/g, ' ').trim();
  return `El router ha devuelto un error ${status}${snippet ? `: ${snippet}` : '.'}`;
}

async function makeTitle(firstMessage: string) {
  const raw = await complete(TITLE_MODEL, [
    { role: 'system', content: TITLE_PROMPT },
    { role: 'user', content: firstMessage.slice(0, 2000) },
  ]);
  if (!raw) return null;

  // Los modelos pequenos ignoran a veces "sin comillas" y "sin punto final".
  const clean = raw.split('\n')[0].replace(/^["'`]|["'`.]$/g, '').trim();
  return clean.length > 0 && clean.length <= 80 ? clean : null;
}

/**
 * Lo que la persona ha dicho de si misma en Personalizar.
 *
 * Va aparte del prompt de sistema a proposito: quien cambia el prompt para
 * probar algo no deberia perder por eso su nombre ni sus preferencias.
 */
function profileBlock(settings?: {
  display_name: string | null;
  about_you: string | null;
  instructions: string | null;
}): string {
  if (!settings) return '';
  const lines: string[] = [];
  if (settings.display_name) lines.push(`La persona se llama ${settings.display_name}; llamala asi.`);
  if (settings.about_you) lines.push(`A que se dedica: ${settings.about_you}`);
  if (settings.instructions) lines.push(`Como quiere que le respondas:\n${settings.instructions}`);
  if (!lines.length) return '';

  return `<persona>\n${lines.join('\n\n')}\n</persona>`;
}

/** Tope de skills que se reinyectan, para que una conversacion larga no se lleve el contexto entero. */
const MAX_LOADED_SKILLS = 3;

/**
 * Las skills que ya se leyeron antes en esta conversacion, puestas de una vez.
 *
 * Los resultados de herramienta no se guardan en el historial — solo quedan en
 * la traza de cada mensaje — asi que el modelo no tiene forma de saber que ya
 * leyo una skill, y la volvia a cargar en **cada mensaje**: una vuelta extra
 * al router y el texto entero otra vez en el contexto, que es lo que lo hacia
 * crecer sin parar.
 *
 * Aqui se miran las trazas anteriores, se recuperan esas skills y se ponen una
 * sola vez en el preambulo. Asi el modelo ya las tiene y no necesita pedirlas:
 * una copia por conversacion en vez de una por mensaje.
 */
async function loadedSkillsBlock(
  userId: string,
  rows: { trace: { name: string; args?: Record<string, unknown> }[] | null }[],
): Promise<string> {
  const names: string[] = [];
  for (const row of rows) {
    for (const step of row.trace ?? []) {
      if (step.name !== 'usar_skill') continue;
      const n = String(step.args?.nombre ?? '').trim();
      if (n && !names.includes(n)) names.push(n);
    }
  }
  if (!names.length) return '';

  // Las mas recientes son las que importan si hay muchas.
  const pick = names.slice(-MAX_LOADED_SKILLS);
  const parts: string[] = [];
  for (const name of pick) {
    const content = await getSkillContent(userId, name);
    if (content) parts.push(`<skill nombre="${name}">\n${content}\n</skill>`);
  }
  if (!parts.length) return '';

  return `<skills_cargadas>
Ya has leido estas skills en esta conversacion y las tienes aqui enteras. No vuelvas a pedirlas con usar_skill: aplicalas directamente.

${parts.join('\n\n')}
</skills_cargadas>`;
}
