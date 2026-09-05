import { currentUser } from '@/lib/auth';
import { saveSkill, listSkills } from '@/lib/skills';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await currentUser();
  if (!user) return new Response('No autenticado', { status: 401 });
  return Response.json({ skills: await listSkills(user.id) });
}

const NAME = /^[a-z0-9][a-z0-9-]{1,48}$/;

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return new Response('No autenticado', { status: 401 });

  const body = (await req.json()) as { name?: string; description?: string; content?: string };
  const name = body.name?.trim().toLowerCase() ?? '';
  const description = body.description?.trim() ?? '';
  const content = body.content?.trim() ?? '';

  // Solo minusculas, numeros y guiones: es el nombre que el modelo escribe
  // literalmente al llamar a la herramienta, y con espacios o acentos
  // aumenta las posibilidades de que lo escriba mal.
  if (!NAME.test(name)) {
    return Response.json(
      { error: 'El nombre solo puede llevar minusculas, numeros y guiones, entre 2 y 49 caracteres.' },
      { status: 400 },
    );
  }
  if (!description || !content) {
    return Response.json({ error: 'Faltan la descripcion o las instrucciones.' }, { status: 400 });
  }

  try {
    await saveSkill(user.id, name, description, content);
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 400 });
  }
  return Response.json({ ok: true });
}
