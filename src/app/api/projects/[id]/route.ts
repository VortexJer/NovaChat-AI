import { currentUser } from '@/lib/auth';
import { addDoc, deleteDoc, deleteProject, listDocs, updateProject } from '@/lib/projects';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/** Los textos de contexto del proyecto. */
export async function GET(_req: Request, { params }: Params) {
  const user = await currentUser();
  if (!user) return new Response('No autenticado', { status: 401 });

  const { id } = await params;
  return Response.json({ docs: await listDocs(user.id, id) });
}

export async function PATCH(req: Request, { params }: Params) {
  const user = await currentUser();
  if (!user) return new Response('No autenticado', { status: 401 });

  const { id } = await params;
  const body = (await req.json()) as {
    name?: string;
    description?: string;
    instructions?: string;
    /** Añadir un texto de contexto en la misma llamada que edita el proyecto. */
    doc?: { name: string; content: string };
    /** Quitar uno por id. */
    removeDoc?: string;
  };

  if (body.doc?.content?.trim()) {
    await addDoc(user.id, id, (body.doc.name || 'Nota').trim().slice(0, 80), body.doc.content);
  }
  if (body.removeDoc) await deleteDoc(user.id, body.removeDoc);

  if (body.name !== undefined || body.description !== undefined || body.instructions !== undefined) {
    await updateProject(user.id, id, {
      name: body.name?.trim() || undefined,
      description: body.description ?? undefined,
      instructions: body.instructions ?? undefined,
    });
  }

  return Response.json({ docs: await listDocs(user.id, id) });
}

export async function DELETE(_req: Request, { params }: Params) {
  const user = await currentUser();
  if (!user) return new Response('No autenticado', { status: 401 });

  const { id } = await params;
  await deleteProject(user.id, id);
  return new Response(null, { status: 204 });
}
