import { currentUser } from '@/lib/auth';
import { deleteConnector, setConnectorEnabled } from '@/lib/connectors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Params) {
  const user = await currentUser();
  if (!user) return new Response('No autenticado', { status: 401 });

  const { id } = await params;
  const { enabled } = (await req.json().catch(() => ({}))) as { enabled?: boolean };
  if (typeof enabled !== 'boolean') {
    return Response.json({ error: 'Falta `enabled`.' }, { status: 400 });
  }

  await setConnectorEnabled(user.id, id, enabled);
  return Response.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: Params) {
  const user = await currentUser();
  if (!user) return new Response('No autenticado', { status: 401 });

  const { id } = await params;
  await deleteConnector(user.id, id);
  return new Response(null, { status: 204 });
}
