import { deleteArtifact, getArtifactPreview } from '@/lib/artifacts';
import { currentUser } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/** La vista previa guardada, para volver a abrirla en el panel sin regenerar el archivo. */
export async function GET(_req: Request, { params }: Params) {
  const user = await currentUser();
  if (!user) return new Response('No autenticado', { status: 401 });

  const { id } = await params;
  const row = await getArtifactPreview(user.id, id);
  if (!row) return new Response('No existe', { status: 404 });

  return Response.json({ name: row.name, kind: row.kind, previewHtml: row.preview_html });
}

export async function DELETE(_req: Request, { params }: Params) {
  const user = await currentUser();
  if (!user) return new Response('No autenticado', { status: 401 });

  const { id } = await params;
  await deleteArtifact(user.id, id);
  return new Response(null, { status: 204 });
}
