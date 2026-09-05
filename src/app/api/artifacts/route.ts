import { listArtifacts } from '@/lib/artifacts';
import { currentUser } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await currentUser();
  if (!user) return new Response('No autenticado', { status: 401 });

  return Response.json({ artifacts: await listArtifacts(user.id) });
}
