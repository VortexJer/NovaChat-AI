/**
 * Puente con el router (FreeLLMAPI).
 *
 * La clave vive solo aqui, en el servidor. El navegador habla siempre con
 * /api/chat, nunca directamente con el router, asi que la clave no aparece en
 * el codigo del cliente ni en la pestana de red.
 */

const BASE = (process.env.LLM_BASE_URL ?? '').replace(/\/+$/, '');
const KEY = process.env.LLM_API_KEY ?? '';

if (!BASE && process.env.NODE_ENV === 'production') {
  console.warn('[novachat] LLM_BASE_URL no esta definida');
}

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  /** null cuando el turno del asistente solo pide herramientas y no dice nada. */
  content: string | null;
  /** Solo en turnos del asistente que invocan herramientas. */
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  /** Solo en mensajes de rol "tool": casa el resultado con su llamada. */
  tool_call_id?: string;
};

export function llmHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${KEY}`,
  };
}

/**
 * Abre el stream de la respuesta.
 *
 * El router duerme en el plan gratuito de Render, asi que la primera peticion
 * despues de un rato puede tardar cerca de un minuto en contestar. El timeout
 * es deliberadamente generoso por eso; un valor tipico de 30 s cortaria justo
 * los arranques en frio.
 */
export async function streamCompletion(
  body: {
    model: string;
    messages: ChatMessage[];
    temperature?: number;
    tools?: unknown[];
    tool_choice?: string;
    /**
     * Al estilo del selector "Esfuerzo" de claude.ai. freellmapi lo reenvia
     * tal cual al proveedor cuando lo admite, y lo descarta en silencio (sin
     * error) cuando no — asi que es seguro mandarlo siempre que la persona lo
     * haya elegido, sin comprobar antes si el modelo concreto lo soporta.
     */
    reasoning_effort?: 'low' | 'medium' | 'high';
  },
  signal?: AbortSignal,
) {
  return fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: llmHeaders(),
    body: JSON.stringify({ ...body, stream: true }),
    signal: signal ?? AbortSignal.timeout(180_000),
  });
}

/** Una respuesta corta y sin stream. Se usa para titular conversaciones. */
export async function complete(
  model: string,
  messages: ChatMessage[],
  maxTokens = 64,
): Promise<string | null> {
  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: llmHeaders(),
      body: JSON.stringify({ model, messages, max_tokens: maxTokens, stream: false }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.choices?.[0]?.message?.content?.trim() ?? null;
  } catch {
    return null;
  }
}

// --- catalogo de modelos ---------------------------------------------------

export type ModelInfo = { id: string; label: string; group: string };

/**
 * Nombres legibles y agrupacion.
 *
 * El router expone unos 250 modelos con identificadores crudos. Mostrarlos tal
 * cual es inusable, asi que los conocidos llevan nombre propio y los demas se
 * derivan del identificador y caen en "Otros" en vez de desaparecer: el
 * catalogo cambia por su cuenta y una lista blanca cerrada envejeceria mal.
 */
const CURATED: Record<string, [label: string, group: string]> = {
  auto: ['Nova Auto', 'Automatico'],
  fusion: ['Nova Fusion', 'Automatico'],
  'free-router': ['Router libre', 'Automatico'],

  'claude-opus-4-5': ['Claude Opus 4.5', 'Anthropic'],
  'claude-sonnet-4-5': ['Claude Sonnet 4.5', 'Anthropic'],
  'claude-haiku-4-5': ['Claude Haiku 4.5', 'Anthropic'],

  'gpt-5.4': ['GPT-5.4', 'OpenAI'],
  'gpt-5.4-mini': ['GPT-5.4 Mini', 'OpenAI'],
  'gpt-5.4-nano': ['GPT-5.4 Nano', 'OpenAI'],
  'gpt-5.3-codex': ['GPT-5.3 Codex', 'OpenAI'],
  'gpt-5.2': ['GPT-5.2', 'OpenAI'],
  'gpt-5.1': ['GPT-5.1', 'OpenAI'],
  'gpt-5': ['GPT-5', 'OpenAI'],
  o3: ['o3', 'OpenAI'],
  'o4-mini': ['o4 Mini', 'OpenAI'],
  'gpt-4.1': ['GPT-4.1', 'OpenAI'],
  'gpt-4o': ['GPT-4o', 'OpenAI'],

  'gemini-3.6-flash': ['Gemini 3.6 Flash', 'Google'],
  'gemini-3.5-flash': ['Gemini 3.5 Flash', 'Google'],
  'gemini-3.5-flash-lite': ['Gemini 3.5 Flash Lite', 'Google'],
  'gemini-2.5-pro': ['Gemini 2.5 Pro', 'Google'],
  'gemini-2.5-flash': ['Gemini 2.5 Flash', 'Google'],

  'grok-4.5': ['Grok 4.5', 'xAI'],
  'grok-4.3': ['Grok 4.3', 'xAI'],
  'grok-4': ['Grok 4', 'xAI'],
  'grok-code-fast-1': ['Grok Code Fast', 'xAI'],

  'deepseek-v4-pro': ['DeepSeek V4 Pro', 'DeepSeek'],
  'deepseek-v4-flash': ['DeepSeek V4 Flash', 'DeepSeek'],
  'deepseek-v3.2': ['DeepSeek V3.2', 'DeepSeek'],
  'deepseek-r1': ['DeepSeek R1', 'DeepSeek'],

  'kimi-k3': ['Kimi K3', 'Codigo'],
  'kimi-k2.7-code': ['Kimi K2.7 Code', 'Codigo'],
  'qwen3-coder-480b': ['Qwen3 Coder 480B', 'Codigo'],
  'qwen3-coder-next': ['Qwen3 Coder Next', 'Codigo'],
  codestral: ['Codestral', 'Codigo'],
  devstral: ['Devstral', 'Codigo'],

  'qwen3.5-397b': ['Qwen3.5 397B', 'Abiertos'],
  'glm-5.2': ['GLM-5.2', 'Abiertos'],
  'glm-4.7': ['GLM-4.7', 'Abiertos'],
  'minimax-m3': ['MiniMax M3', 'Abiertos'],
  'mistral-large-3': ['Mistral Large 3', 'Abiertos'],
  'mistral-medium-3.5': ['Mistral Medium 3.5', 'Abiertos'],
  'llama-4-maverick': ['Llama 4 Maverick', 'Abiertos'],
  'llama-4-scout': ['Llama 4 Scout', 'Abiertos'],
  'gpt-oss-120b': ['GPT-OSS 120B', 'Abiertos'],
  'nemotron-3-ultra': ['Nemotron 3 Ultra', 'Abiertos'],

  'sonar-pro': ['Sonar Pro', 'Con busqueda'],
  sonar: ['Sonar', 'Con busqueda'],
  'sonar-deep-research': ['Sonar Deep Research', 'Con busqueda'],
  'gpt-5-search-api': ['GPT-5 Search', 'Con busqueda'],
};

/** El orden en que se pintan los grupos. Lo no listado va al final. */
const GROUP_ORDER = [
  'Automatico',
  'Anthropic',
  'OpenAI',
  'Google',
  'xAI',
  'DeepSeek',
  'Codigo',
  'Con busqueda',
  'Abiertos',
  'Otros',
];

function prettify(id: string) {
  return id
    .split(/[-_]/)
    .map((part) => (/\d/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(' ');
}

let cache: { at: number; models: ModelInfo[] } | null = null;
const CACHE_MS = 10 * 60_000;

export async function listModels(): Promise<ModelInfo[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.models;

  let ids: string[] = [];
  try {
    const res = await fetch(`${BASE}/models`, {
      headers: llmHeaders(),
      signal: AbortSignal.timeout(90_000),
      cache: 'no-store',
    });
    if (res.ok) {
      const data = await res.json();
      ids = (data?.data ?? []).map((m: { id: string }) => m.id).filter(Boolean);
    }
  } catch {
    // El router puede estar despertando. Se sirve lo ultimo bueno que haya.
  }

  // Sin respuesta y sin cache, al menos deja elegir el enrutado automatico para
  // que la interfaz no aparezca vacia.
  if (ids.length === 0) return cache?.models ?? [{ id: 'auto', label: 'Nova Auto', group: 'Automatico' }];

  const models = ids.map<ModelInfo>((id) => {
    const hit = CURATED[id];
    return { id, label: hit?.[0] ?? prettify(id), group: hit?.[1] ?? 'Otros' };
  });

  models.sort((a, b) => {
    const ga = GROUP_ORDER.indexOf(a.group);
    const gb = GROUP_ORDER.indexOf(b.group);
    const oa = ga === -1 ? GROUP_ORDER.length : ga;
    const ob = gb === -1 ? GROUP_ORDER.length : gb;
    return oa !== ob ? oa - ob : a.label.localeCompare(b.label);
  });

  cache = { at: Date.now(), models };
  return models;
}

export const DEFAULT_MODEL = process.env.DEFAULT_MODEL ?? 'auto';
/** Modelo barato para tareas internas, como titular una conversacion. */
export const TITLE_MODEL = process.env.TITLE_MODEL ?? 'gemini-3.5-flash-lite';

/**
 * Una vuelta sin streaming, con herramientas.
 *
 * La usan las tareas programadas: ahi no hay nadie mirando como aparece el
 * texto, asi que el streaming solo complicaria el parseo. Devuelve el mensaje
 * del asistente tal cual, con sus llamadas a herramientas si las pidio.
 */
export async function completeRound(
  model: string,
  messages: ChatMessage[],
  tools: unknown[],
): Promise<{ content: string | null; toolCalls: { id: string; name: string; args: string }[] } | null> {
  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: llmHeaders(),
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        ...(tools.length ? { tools, tool_choice: 'auto' } : {}),
      }),
      signal: AbortSignal.timeout(180_000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const msg = data?.choices?.[0]?.message;
    if (!msg) return null;
    return {
      content: typeof msg.content === 'string' ? msg.content : null,
      toolCalls: (msg.tool_calls ?? []).map((c: { id: string; function: { name: string; arguments: string } }) => ({
        id: c.id,
        name: c.function.name,
        args: c.function.arguments ?? '{}',
      })),
    };
  } catch {
    return null;
  }
}

/**
 * El catalogo de modelos del router, para armar la cola de suplentes.
 *
 * Antes los suplentes eran cinco nombres escritos a mano, y con el router
 * capando por modelo se agotaban los cinco enseguida. Pero el catalogo trae
 * doscientos cincuenta, ciento cincuenta y cuatro de ellos con herramientas:
 * no hay razon para quedarse en cinco.
 *
 * Dos cosas que se aprendieron mirandolo de verdad:
 *
 * - **Ya viene ordenado.** El orden del catalogo coincide con el ranking que
 *   el router publica en su pagina de modelos (Kimi K2.7 Code, Kimi K3,
 *   DeepSeek V4 Pro...). No hay que reordenar nada.
 * - **`available` miente a medias.** Marca 244 disponibles, pero varios
 *   responden 404 "not in the catalog" al pedirles algo. Son entradas
 *   "slot"/alias (Opus slot, Sonnet slot, Haiku slot) que reenvian a otro
 *   modelo, mas `auto` y `fusion`. Se filtran por nombre.
 */
type ModeloCatalogo = {
  id: string;
  name?: string;
  available?: boolean;
  supported_parameters?: string[];
};

let cacheModelos: { cuando: number; lista: ModeloCatalogo[] } | null = null;
const CACHE_MODELOS_MS = 10 * 60 * 1000;

/** Alias y huecos que no son modelos de verdad y contestan 404. */
function esAlias(m: ModeloCatalogo): boolean {
  if (m.id === 'auto' || m.id === 'fusion') return true;
  const n = m.name ?? '';
  // Por palabra, no por subcadena: "llama-3.2-1b-unsloth" contiene "slot".
  return /\bslot\b/i.test(n) || /auto-routed/i.test(n);
}

async function catalogo(): Promise<ModeloCatalogo[]> {
  if (cacheModelos && Date.now() - cacheModelos.cuando < CACHE_MODELOS_MS) {
    return cacheModelos.lista;
  }
  try {
    const res = await fetch(`${BASE}/models`, {
      headers: llmHeaders(),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return cacheModelos?.lista ?? [];
    const data = (await res.json()) as { data?: ModeloCatalogo[] };
    const lista = data.data ?? [];
    if (lista.length) cacheModelos = { cuando: Date.now(), lista };
    return lista;
  } catch {
    // Si el catalogo no se puede leer se sigue con lo ultimo que se supo; y si
    // no se supo nada, sin suplentes. Nunca tumbar el turno por esto.
    return cacheModelos?.lista ?? [];
  }
}

/**
 * Los modelos a los que caer, en orden de ranking.
 *
 * @param conHerramientas cuando el turno lleva herramientas, se descartan los
 *   modelos que no las admiten: contestarian ignorandolas y el archivo que se
 *   pedia no llegaria a crearse nunca.
 */
export async function colaDeSuplentes(conHerramientas: boolean): Promise<string[]> {
  const lista = await catalogo();
  return lista
    .filter((m) => m.available !== false && !esAlias(m))
    .filter((m) => !conHerramientas || (m.supported_parameters ?? []).includes('tools'))
    .map((m) => m.id);
}
