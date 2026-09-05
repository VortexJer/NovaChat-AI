import { currentUser } from '@/lib/auth';
import { ready, sql } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const user = await currentUser();
  if (!user) return new Response('No autenticado', { status: 401 });
  await ready();

  const { id } = await params;

  // El user_id va en el WHERE, no en una comprobacion posterior: sin esto un id
  // de otra cuenta devolveria la conversacion entera.
  const [conversation] = await sql`
    SELECT id, title, model, pinned, reasoning_effort FROM conversations
    WHERE id = ${id} AND user_id = ${user.id}
  `;
  if (!conversation) return new Response('No encontrada', { status: 404 });

  const rows = await sql<{ trace: unknown }[]>`
    SELECT id, role, content, reasoning, model, trace, reply_to, version_index, created_at
    FROM messages WHERE conversation_id = ${id}
    ORDER BY created_at
  `;

  // Defensivo: postgres.js ya deserializa jsonb a array/objeto, pero si algun
  // registro quedo guardado como texto (p. ej. de una version anterior), se
  // interpreta igualmente en vez de tumbar la interfaz con un tipo inesperado.
  const messages = rows.map((m) => ({
    ...m,
    trace: typeof m.trace === 'string' ? JSON.parse(m.trace) : m.trace,
  }));

  return Response.json({ conversation, messages });
}

export async function PATCH(req: Request, { params }: Params) {
  const user = await currentUser();
  if (!user) return new Response('No autenticado', { status: 401 });
  await ready();

  const { id } = await params;
  const body = (await req.json()) as {
    title?: string;
    model?: string;
    pinned?: boolean;
    reasoning_effort?: string | null;
    projectId?: string | null;
  };

  if (typeof body.title === 'string') {
    const title = body.title.trim().slice(0, 120);
    if (!title) return new Response('Titulo vacio', { status: 400 });
    await sql`UPDATE conversations SET title = ${title} WHERE id = ${id} AND user_id = ${user.id}`;
  }
  if (typeof body.model === 'string' && body.model) {
    await sql`UPDATE conversations SET model = ${body.model} WHERE id = ${id} AND user_id = ${user.id}`;
  }
  if (typeof body.pinned === 'boolean') {
    await sql`UPDATE conversations SET pinned = ${body.pinned} WHERE id = ${id} AND user_id = ${user.id}`;
  }
  // Igual que el esfuerzo: null aqui significa "sacala del proyecto", no
  // "deja el campo como estaba".
  if ('projectId' in body) {
    await sql`UPDATE conversations SET project_id = ${body.projectId ?? null} WHERE id = ${id} AND user_id = ${user.id}`;
  }
  // Presente en el body aunque sea null: null es "automatico" a proposito,
  // no "no tocar este campo" (por eso se comprueba con "in", no con typeof).
  if ('reasoning_effort' in body) {
    await sql`UPDATE conversations SET reasoning_effort = ${body.reasoning_effort ?? null} WHERE id = ${id} AND user_id = ${user.id}`;
  }
  return Response.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: Params) {
  const user = await currentUser();
  if (!user) return new Response('No autenticado', { status: 401 });
  await ready();

  const { id } = await params;
  // Los mensajes caen con ella por la clave foranea ON DELETE CASCADE.
  await sql`DELETE FROM conversations WHERE id = ${id} AND user_id = ${user.id}`;
  return Response.json({ ok: true });
}
