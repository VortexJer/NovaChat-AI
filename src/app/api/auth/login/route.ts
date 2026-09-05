import { createSession, verifyPassword } from '@/lib/auth';
import { ready, sql } from '@/lib/db';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  await ready();
  const { email, password } = (await req.json()) as { email?: string; password?: string };
  if (!email || !password) return bad('Faltan datos.');

  const [user] = await sql<{ id: string; password_hash: string }[]>`
    SELECT id, password_hash FROM users WHERE email = ${email.toLowerCase().trim()} LIMIT 1
  `;

  // Mismo mensaje exista o no la cuenta: decir "ese correo no existe" confirma
  // a un atacante que correos estan registrados.
  const ok = user ? await verifyPassword(password, user.password_hash) : false;
  if (!ok) return bad('Correo o contrasena incorrectos.');

  await createSession(user.id);
  return Response.json({ ok: true });
}

const bad = (error: string) => Response.json({ error }, { status: 400 });
