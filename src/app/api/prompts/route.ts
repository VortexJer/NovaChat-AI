import { currentUser } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Prompts de sistema publicados por Anthropic.
 *
 * Anthropic publica los prompts de sistema de claude.ai en sus notas de
 * version. Se descargan aqui en vez de guardarlos en el repositorio por dos
 * razones: siguen cambiando (cada modelo tiene su entrada y se actualizan), y
 * asi lo que se carga es siempre la fuente, no una copia envejecida.
 *
 * Va por el servidor porque el navegador no puede pedirlos directamente: el
 * dominio no envia cabeceras CORS.
 */

const INDEX = 'https://platform.claude.com/docs/en/release-notes/system-prompts';
const CACHE_MS = 60 * 60_000;

type Entry = { id: string; name: string };

let indexCache: { at: number; entries: Entry[] } | null = null;
const textCache = new Map<string, { at: number; text: string }>();

export async function GET(req: Request) {
  if (!(await currentUser())) return new Response('No autenticado', { status: 401 });

  const id = new URL(req.url).searchParams.get('id');
  return id ? fetchPrompt(id) : fetchIndex();
}

async function fetchIndex() {
  if (indexCache && Date.now() - indexCache.at < CACHE_MS) {
    return Response.json({ entries: indexCache.entries });
  }

  try {
    const res = await fetch(`${INDEX}.md`, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(String(res.status));
    const body = await res.text();

    // La pagina lista cada modelo en una tarjeta con su id y su titulo.
    const entries: Entry[] = [];
    const seen = new Set<string>();
    for (const m of body.matchAll(/id="([a-z0-9-]+)"\s+title="([^"]+)"/g)) {
      if (seen.has(m[1])) continue;
      seen.add(m[1]);
      entries.push({ id: m[1], name: m[2] });
    }

    if (entries.length === 0) throw new Error('sin entradas');

    indexCache = { at: Date.now(), entries };
    return Response.json({ entries });
  } catch {
    // Si la pagina cambia de formato o no responde, se devuelve lo ultimo bueno
    // en lugar de romper los ajustes.
    if (indexCache) return Response.json({ entries: indexCache.entries, stale: true });
    return Response.json(
      { entries: [], error: 'No se ha podido consultar la lista de prompts publicados.' },
      { status: 502 },
    );
  }
}

async function fetchPrompt(id: string) {
  // El id viaja en la URL de origen: se restringe a lo que produce el indice
  // para que no pueda usarse esta ruta como proxy hacia cualquier sitio.
  if (!/^[a-z0-9-]{1,64}$/.test(id)) return new Response('Id invalido', { status: 400 });

  const hit = textCache.get(id);
  if (hit && Date.now() - hit.at < CACHE_MS) return Response.json({ id, text: hit.text });

  try {
    const res = await fetch(`${INDEX}/${id}.md`, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(String(res.status));
    const body = await res.text();

    // El prompt viene dentro del primer bloque de codigo de la pagina, que es
    // la entrada mas reciente.
    const block = /```(?:text\s+wrap|text)?\n([\s\S]*?)```/.exec(body);
    const text = (block?.[1] ?? '').trim();
    if (!text) throw new Error('sin bloque');

    textCache.set(id, { at: Date.now(), text });
    return Response.json({ id, text });
  } catch {
    return Response.json(
      { error: 'No se ha podido descargar ese prompt.' },
      { status: 502 },
    );
  }
}
