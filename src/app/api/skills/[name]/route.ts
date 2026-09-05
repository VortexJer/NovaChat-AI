import { currentUser } from '@/lib/auth';
import { builtinContent, deleteSkill, getSkillContent, saveSkill } from '@/lib/skills';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ name: string }> };

/** El contenido de una skill, y el de fabrica si la han editado. */
export async function GET(_req: Request, { params }: Params) {
  const user = await currentUser();
  if (!user) return new Response('No autenticado', { status: 401 });

  const { name } = await params;
  const decoded = decodeURIComponent(name);
  const content = await getSkillContent(user.id, decoded);
  if (content === null) return new Response('No existe', { status: 404 });

  return Response.json({ name: decoded, content, original: builtinContent(decoded) });
}

export async function PUT(req: Request, { params }: Params) {
  const user = await currentUser();
  if (!user) return new Response('No autenticado', { status: 401 });

  const { name } = await params;
  const decoded = decodeURIComponent(name);
  const body = (await req.json()) as { description?: string; content?: string };
  const content = (body.content ?? '').trim();
  if (!content) return Response.json({ error: 'La skill no puede quedarse vacia.' }, { status: 400 });

  // Editar una incorporada guarda una copia con su mismo nombre que la
  // sustituye; la de fabrica sigue en el codigo y se recupera al borrarla.
  await saveSkill(user.id, decoded, (body.description ?? '').trim().slice(0, 200), content);
  return Response.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: Params) {
  const user = await currentUser();
  if (!user) return new Response('No autenticado', { status: 401 });

  const { name } = await params;
  // En una incorporada esto no la borra: quita la copia editada y vuelve a
  // valer la de fabrica.
  await deleteSkill(user.id, decodeURIComponent(name));
  return Response.json({ ok: true });
}
