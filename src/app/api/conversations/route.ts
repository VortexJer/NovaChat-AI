import { randomUUID } from 'node:crypto';

import { currentUser } from '@/lib/auth';
import { ready, sql } from '@/lib/db';
import { DEFAULT_MODEL } from '@/lib/llm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await currentUser();
  if (!user) return new Response('No autenticado', { status: 401 });
  await ready();

  const conversations = await sql`
    SELECT id, title, model, pinned, updated_at, reasoning_effort
    FROM conversations
    WHERE user_id = ${user.id}
    ORDER BY pinned DESC, updated_at DESC
    LIMIT 200
  `;
  return Response.json({ conversations });
}

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return new Response('No autenticado', { status: 401 });
  await ready();

  const { model, reasoningEffort, projectId } = (await req.json().catch(() => ({}))) as {
    model?: string;
    reasoningEffort?: 'low' | 'medium' | 'high' | null;
    projectId?: string | null;
  };

  const [settings] = await sql<{ default_model: string | null }[]>`
    SELECT default_model FROM settings WHERE user_id = ${user.id}
  `;

  const id = randomUUID();
  const chosen = model || settings?.default_model || DEFAULT_MODEL;
  const effort = reasoningEffort ?? null;

  // Una conversacion que nace dentro de un proyecto se queda dentro: es lo que
  // hace que herede sus instrucciones y su contexto sin tener que moverla luego.
  // Se comprueba que el proyecto sea de quien pregunta, que el id viene del
  // navegador.
  let project: string | null = null;
  if (projectId) {
    const [own] = await sql<{ id: string }[]>`
      SELECT id FROM projects WHERE id = ${projectId} AND user_id = ${user.id}
    `;
    project = own?.id ?? null;
  }

  await sql`
    INSERT INTO conversations (id, user_id, model, reasoning_effort, project_id)
    VALUES (${id}, ${user.id}, ${chosen}, ${effort}, ${project})
  `;
  return Response.json({
    id,
    model: chosen,
    title: 'Nueva conversacion',
    pinned: false,
    reasoning_effort: effort,
  });
}
