import { getArtifact } from '@/lib/artifacts';
import { currentUser } from '@/lib/auth';
import { getFile } from '@/lib/files';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const user = await currentUser();
  if (!user) return new Response('No autenticado', { status: 401 });

  const { id } = await params;

  // Primero la cache del proceso, que es donde esta el archivo recien
  // generado; si ya caduco o el proceso se reinicio, se lee de la tabla de
  // artefactos, que ademas comprueba ahi que es de quien lo pide.
  const cached = getFile(id);
  const stored = cached ?? (await getArtifact(user.id, id));
  if (!stored) return new Response('El archivo no existe.', { status: 404 });

  const bytes = 'buffer' in stored ? stored.buffer : stored.bytes;

  return new Response(new Uint8Array(bytes), {
    headers: {
      'Content-Type': stored.mime,
      'Content-Disposition': `attachment; filename="${encodeURIComponent(stored.name)}"`,
      'Content-Length': String(bytes.length),
      'Cache-Control': 'private, no-store',
    },
  });
}
