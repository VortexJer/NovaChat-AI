import { currentUser } from '@/lib/auth';
import { ready, sql } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/**
 * Borra de verdad, en el servidor, todo lo que quede a partir de un mensaje.
 *
 * Editar un mensaje reemplaza lo que venia despues, pero hasta ahora el
 * cliente solo recortaba su propio array en memoria: las filas viejas
 * seguian en la base de datos y volvian a aparecer duplicadas al recargar
 * la conversacion. Este endpoint hace el borrado que faltaba.
 */
export async function POST(req: Request, { params }: Params) {
  const user = await currentUser();
  if (!user) return new Response('No autenticado', { status: 401 });
  await ready();

  const { id } = await params;
  const { fromMessageId } = (await req.json()) as { fromMessageId?: string };
  if (typeof fromMessageId !== 'string' || !fromMessageId) {
    return new Response('Peticion invalida', { status: 400 });
  }

  const [conv] = await sql<{ id: string }[]>`
    SELECT id FROM conversations WHERE id = ${id} AND user_id = ${user.id} LIMIT 1
  `;
  if (!conv) return new Response('Conversacion no encontrada', { status: 404 });

  const [target] = await sql<{ created_at: string }[]>`
    SELECT created_at FROM messages WHERE id = ${fromMessageId} AND conversation_id = ${id} LIMIT 1
  `;
  if (!target) return new Response('Mensaje no encontrado', { status: 404 });

  await sql`
    DELETE FROM messages
    WHERE conversation_id = ${id} AND created_at >= ${target.created_at}
  `;

  return Response.json({ ok: true });
}
