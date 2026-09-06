/**
 * Cliente MCP minimo, del lado del servidor.
 *
 * MCP (Model Context Protocol) es lo que hay detras de los "Conectores" de
 * claude.ai: un servidor publica una lista de herramientas y quien conecta las
 * llama por JSON-RPC. Aqui se implementa solo lo que hace falta para eso —
 * `initialize`, `tools/list` y `tools/call`— sobre el transporte HTTP, que es
 * el unico posible desde un servidor alojado: los servidores MCP locales
 * hablan por entrada y salida estandar y viven en la maquina de quien los usa.
 *
 * Del transporte hay dos generaciones y los servidores de ahi fuera usan las
 * dos, asi que se aceptan las dos respuestas: JSON a secas y `text/event-stream`
 * con la respuesta dentro de un evento. La cabecera `Mcp-Session-Id` que
 * devuelve el `initialize` se reenvia en las llamadas siguientes, que es como
 * el servidor reconoce la sesion.
 */

const PROTOCOLO = '2025-06-18';
const TIMEOUT_MS = 20_000;

export type McpTool = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};

export class McpError extends Error {}

type Rpc = { jsonrpc: '2.0'; id?: number; method: string; params?: unknown };

function cabeceras(token: string | null, sesion: string | null): Record<string, string> {
  const h: Record<string, string> = {
    'Content-Type': 'application/json',
    // Se admiten las dos formas de contestar, que es lo que pide el transporte
    // HTTP en streaming.
    Accept: 'application/json, text/event-stream',
    'MCP-Protocol-Version': PROTOCOLO,
  };
  if (token) h.Authorization = token.startsWith('Bearer ') ? token : `Bearer ${token}`;
  if (sesion) h['Mcp-Session-Id'] = sesion;
  return h;
}

/**
 * Saca el objeto JSON-RPC de la respuesta, venga como venga.
 *
 * En `text/event-stream` el cuerpo son bloques `data: {...}`; puede haber
 * varios (pings, progreso) y el que interesa es el que trae `result` o `error`.
 */
function extraer(texto: string, tipo: string | null): Record<string, unknown> {
  if (tipo?.includes('text/event-stream')) {
    const datos = texto
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trim())
      .filter(Boolean);

    for (const d of datos.reverse()) {
      try {
        const obj = JSON.parse(d) as Record<string, unknown>;
        if ('result' in obj || 'error' in obj) return obj;
      } catch {
        // Un bloque suelto que no es JSON: se ignora y se sigue con el anterior.
      }
    }
    throw new McpError('El conector no ha devuelto ninguna respuesta util.');
  }

  try {
    return JSON.parse(texto) as Record<string, unknown>;
  } catch {
    throw new McpError(`El conector ha contestado algo que no es JSON: ${texto.slice(0, 120)}`);
  }
}

async function llamar(
  url: string,
  token: string | null,
  sesion: string | null,
  cuerpo: Rpc,
): Promise<{ resultado: Record<string, unknown>; sesion: string | null }> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: cabeceras(token, sesion),
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const motivo = (err as Error)?.name === 'TimeoutError' ? 'no ha contestado a tiempo' : 'no responde';
    throw new McpError(`El conector ${motivo}.`);
  }

  const nuevaSesion = res.headers.get('Mcp-Session-Id') ?? sesion;

  if (!res.ok) {
    const detalle = (await res.text().catch(() => '')).slice(0, 160);
    if (res.status === 401 || res.status === 403) {
      throw new McpError('El conector ha rechazado la credencial (401/403). Revisa el token.');
    }
    throw new McpError(`El conector ha devuelto ${res.status}. ${detalle}`);
  }

  // Las notificaciones no llevan respuesta: 202 sin cuerpo es lo correcto.
  if (res.status === 202 || cuerpo.id === undefined) return { resultado: {}, sesion: nuevaSesion };

  const obj = extraer(await res.text(), res.headers.get('content-type'));
  if (obj.error) {
    const e = obj.error as { message?: string };
    throw new McpError(e?.message ? `El conector ha fallado: ${e.message}` : 'El conector ha fallado.');
  }
  return { resultado: (obj.result ?? {}) as Record<string, unknown>, sesion: nuevaSesion };
}

/** Abre la sesion y devuelve el identificador que hay que reenviar despues. */
async function abrir(url: string, token: string | null): Promise<string | null> {
  const { sesion } = await llamar(url, token, null, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: PROTOCOLO,
      capabilities: {},
      clientInfo: { name: 'NovaChat', version: '1.0' },
    },
  });

  // El servidor espera saber que el apreton de manos termino. Si falla no se
  // aborta: hay servidores que no la necesitan y contestan igual.
  await llamar(url, token, sesion, { jsonrpc: '2.0', method: 'notifications/initialized' }).catch(
    () => undefined,
  );

  return sesion;
}

/** Las herramientas que publica el conector. */
export async function listarHerramientas(url: string, token: string | null): Promise<McpTool[]> {
  const sesion = await abrir(url, token);
  const { resultado } = await llamar(url, token, sesion, {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/list',
  });

  const tools = Array.isArray(resultado.tools) ? resultado.tools : [];
  return tools
    .filter((t): t is McpTool => Boolean(t) && typeof (t as McpTool).name === 'string')
    .map((t) => ({
      name: t.name,
      description: typeof t.description === 'string' ? t.description : undefined,
      inputSchema:
        t.inputSchema && typeof t.inputSchema === 'object'
          ? (t.inputSchema as Record<string, unknown>)
          : undefined,
    }));
}

/**
 * Ejecuta una herramienta del conector y devuelve su texto.
 *
 * Lo que vuelve es contenido de un servidor de terceros: se trata como dato,
 * nunca como instrucciones, y por eso quien lo recibe lo entrega al modelo
 * envuelto y avisando de donde sale.
 */
export async function ejecutarHerramienta(
  url: string,
  token: string | null,
  nombre: string,
  args: Record<string, unknown>,
): Promise<string> {
  const sesion = await abrir(url, token);
  const { resultado } = await llamar(url, token, sesion, {
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: nombre, arguments: args },
  });

  const partes = Array.isArray(resultado.content) ? resultado.content : [];
  const texto = partes
    .map((p) => {
      const parte = p as { type?: string; text?: string; resource?: { text?: string } };
      if (parte?.type === 'text' && typeof parte.text === 'string') return parte.text;
      if (parte?.resource?.text) return parte.resource.text;
      // Imagenes y demas: no hay forma de darselas al modelo por este camino.
      return parte?.type ? `[contenido de tipo ${parte.type}, no legible como texto]` : '';
    })
    .filter(Boolean)
    .join('\n\n');

  if (resultado.isError) {
    throw new McpError(texto || 'La herramienta del conector ha devuelto un error.');
  }
  return texto || 'La herramienta no ha devuelto nada.';
}
