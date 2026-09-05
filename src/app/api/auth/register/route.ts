import { canRegister, createSession, createUser } from '@/lib/auth';
import { ready, sql } from '@/lib/db';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  await ready();
  const { email, password } = (await req.json()) as { email?: string; password?: string };

  const mail = email?.toLowerCase().trim() ?? '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) return bad('Ese correo no es valido.');
  if (!password || password.length < 8) return bad('La contrasena necesita al menos 8 caracteres.');

  const permission = await canRegister(mail);
  if (!permission.ok) return bad(permission.reason!);

  const [existing] = await sql`SELECT 1 FROM users WHERE email = ${mail} LIMIT 1`;
  if (existing) return bad('Ese correo ya tiene cuenta.');

  const user = await createUser(mail, password);
  await createSession(user.id);
  return Response.json({ ok: true });
}

const bad = (error: string) => Response.json({ error }, { status: 400 });
