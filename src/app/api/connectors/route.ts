import { currentUser } from '@/lib/auth';
import { addConnector, CATALOGO, listConnectors } from '@/lib/connectors';
import { McpError } from '@/lib/mcp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await currentUser();
  if (!user) return new Response('No autenticado', { status: 401 });

  return Response.json({ connectors: await listConnectors(user.id), catalogo: CATALOGO });
}

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return new Response('No autenticado', { status: 401 });

  const { name, url, token } = (await req.json().catch(() => ({}))) as {
    name?: string;
    url?: string;
    token?: string;
  };

  const direccion = (url ?? '').trim();
  if (!name?.trim() || !direccion) {
    return Response.json({ error: 'Hacen falta un nombre y una URL.' }, { status: 400 });
  }

  // Solo https, y nada de direcciones internas: este servidor puede alcanzar
  // la red privada de Render, y un conector es una URL que escribe el usuario.
  let destino: URL;
  try {
    destino = new URL(direccion);
  } catch {
    return Response.json({ error: 'Esa URL no es valida.' }, { status: 400 });
  }
  if (destino.protocol !== 'https:') {
    return Response.json({ error: 'La URL tiene que ser https.' }, { status: 400 });
  }
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[?::1)/i.test(destino.hostname)) {
    return Response.json({ error: 'No se admiten direcciones de la red local.' }, { status: 400 });
  }

  try {
    const { id, tools } = await addConnector(
      user.id,
      name.trim().slice(0, 60),
      destino.toString(),
      token?.trim() || null,
    );
    return Response.json({ id, tools });
  } catch (err) {
    // El error de MCP ya viene explicado en castellano y es lo unico que le
    // sirve a quien esta intentando conectar algo.
    const motivo = err instanceof McpError ? err.message : 'No se ha podido conectar.';
    return Response.json({ error: motivo }, { status: 400 });
  }
}
