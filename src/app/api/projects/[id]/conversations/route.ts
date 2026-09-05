import { currentUser } from '@/lib/auth';
import { ready, sql } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/** Las conversaciones que cuelgan de un proyecto, de la mas reciente a la mas antigua. */
export async function GET(_req: Request, { params }: Params) {
  const user = await currentUser();
  if (!user) return new Response('No autenticado', { status: 401 });
  await ready();

  const { id } = await params;
  const conversations = await sql`
    SELECT id, title FROM conversations
    WHERE project_id = ${id} AND user_id = ${user.id}
    ORDER BY created_at DESC
    LIMIT 50
  `;
  return Response.json({ conversations });
}
