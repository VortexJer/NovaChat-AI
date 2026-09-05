import { currentUser } from '@/lib/auth';
import { listModels } from '@/lib/llm';

export const runtime = 'nodejs';

export async function GET() {
  // El catalogo se sirve solo a usuarios con sesion: revela que proveedores
  // hay detras del router y no hay razon para exponerlo en abierto.
  if (!(await currentUser())) return new Response('No autenticado', { status: 401 });
  return Response.json({ models: await listModels() });
}
