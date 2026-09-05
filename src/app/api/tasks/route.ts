import { currentUser } from '@/lib/auth';
import { CADENCES, createTask, deleteTask, listTasks, toggleTask, type Cadence } from '@/lib/tasks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await currentUser();
  if (!user) return new Response('No autenticado', { status: 401 });
  return Response.json({ tasks: await listTasks(user.id) });
}

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return new Response('No autenticado', { status: 401 });

  const body = (await req.json()) as { name?: string; prompt?: string; cadence?: string; hour?: number };
  const name = (body.name ?? '').trim();
  const prompt = (body.prompt ?? '').trim();
  if (!name || !prompt) return Response.json({ error: 'Hacen falta nombre y encargo.' }, { status: 400 });

  const cadence: Cadence = CADENCES.includes(body.cadence as Cadence) ? (body.cadence as Cadence) : 'diaria';
  const hour = Math.min(23, Math.max(0, Math.round(Number(body.hour ?? 8))));

  await createTask(user.id, { name: name.slice(0, 80), prompt: prompt.slice(0, 4000), cadence, hour });
  return Response.json({ tasks: await listTasks(user.id) });
}

export async function PATCH(req: Request) {
  const user = await currentUser();
  if (!user) return new Response('No autenticado', { status: 401 });

  const body = (await req.json()) as { id?: string; enabled?: boolean };
  if (!body.id) return Response.json({ error: 'Falta el id.' }, { status: 400 });

  await toggleTask(user.id, body.id, Boolean(body.enabled));
  return Response.json({ tasks: await listTasks(user.id) });
}

export async function DELETE(req: Request) {
  const user = await currentUser();
  if (!user) return new Response('No autenticado', { status: 401 });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return Response.json({ error: 'Falta el id.' }, { status: 400 });

  await deleteTask(user.id, id);
  return Response.json({ tasks: await listTasks(user.id) });
}
