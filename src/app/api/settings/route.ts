import { currentUser } from '@/lib/auth';
import { ready, sql } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await currentUser();
  if (!user) return new Response('No autenticado', { status: 401 });
  await ready();

  const [settings] = await sql`
    SELECT system_prompt, temperature, display_name, about_you, instructions, reduced_motion
    FROM settings WHERE user_id = ${user.id}
  `;
  return Response.json({ settings: settings ?? null });
}

export async function PUT(req: Request) {
  const user = await currentUser();
  if (!user) return new Response('No autenticado', { status: 401 });
  await ready();

  const body = (await req.json()) as {
    systemPrompt?: string | null;
    temperature?: number;
    displayName?: string | null;
    aboutYou?: string | null;
    instructions?: string | null;
    reducedMotion?: boolean;
  };

  // Un prompt vacio significa "usa el de fabrica", no "sin prompt": para eso
  // esta el preset "Sin prompt", que guarda un espacio en blanco.
  const prompt = body.systemPrompt === null ? null : (body.systemPrompt ?? null);
  const temperature = Math.min(2, Math.max(0, Number(body.temperature ?? 1)));

  // Los tres campos de perfil se recortan: van en cada peticion, y un texto
  // largo aqui se paga en todas.
  const cut = (v: string | null | undefined, max: number) =>
    v === undefined ? null : v === null ? null : v.trim().slice(0, max) || null;

  await sql`
    INSERT INTO settings (user_id, system_prompt, temperature, display_name, about_you, instructions, reduced_motion)
    VALUES (${user.id}, ${prompt}, ${temperature}, ${cut(body.displayName, 60)},
            ${cut(body.aboutYou, 400)}, ${cut(body.instructions, 2000)}, ${Boolean(body.reducedMotion)})
    ON CONFLICT (user_id) DO UPDATE
      SET system_prompt   = EXCLUDED.system_prompt,
          temperature     = EXCLUDED.temperature,
          display_name    = EXCLUDED.display_name,
          about_you       = EXCLUDED.about_you,
          instructions    = EXCLUDED.instructions,
          reduced_motion  = EXCLUDED.reduced_motion
  `;
  return Response.json({ ok: true });
}
