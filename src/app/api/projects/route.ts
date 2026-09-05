import { currentUser } from '@/lib/auth';
import { createProject, listProjects } from '@/lib/projects';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await currentUser();
  if (!user) return new Response('No autenticado', { status: 401 });
  return Response.json({ projects: await listProjects(user.id) });
}

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return new Response('No autenticado', { status: 401 });

  const body = (await req.json()) as { name?: string; description?: string };
  const name = (body.name ?? '').trim();
  if (!name) return Response.json({ error: 'Hace falta un nombre.' }, { status: 400 });

  const id = await createProject(user.id, name.slice(0, 80), (body.description ?? '').trim() || null);
  return Response.json({ id });
}
