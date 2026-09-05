import { currentUser } from '@/lib/auth';
import { encryptionEnabled, keyStatus, type Provider, PROVIDERS, setKey } from '@/lib/secrets';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await currentUser();
  if (!user) return new Response('No autenticado', { status: 401 });

  // Nunca se devuelve el valor de una clave, ni enmascarado: la interfaz solo
  // necesita saber si esta puesta y de donde viene.
  return Response.json({
    providers: await keyStatus(user.id),
    encrypted: encryptionEnabled(),
  });
}

export async function PUT(req: Request) {
  const user = await currentUser();
  if (!user) return new Response('No autenticado', { status: 401 });

  const { keys } = (await req.json()) as { keys?: Record<string, string> };
  if (!keys) return new Response('Peticion invalida', { status: 400 });

  const valid = new Set(PROVIDERS.map((p) => p.id));
  for (const [provider, value] of Object.entries(keys)) {
    if (!valid.has(provider as Provider)) continue;
    await setKey(user.id, provider as Provider, value);
  }

  return Response.json({ ok: true });
}
