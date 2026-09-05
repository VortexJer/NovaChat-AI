import { currentUser } from '@/lib/auth';
import { ready, sql } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Busca en titulos y en el contenido de los mensajes.
 *
 * Usa ILIKE y no busqueda de texto completo a proposito: el corpus de una
 * instalacion personal son unos miles de mensajes, ILIKE los recorre en
 * milisegundos, y a cambio funciona en cualquier Postgres sin extensiones ni
 * indices que mantener. Es justo la leccion de haber intentado desplegar algo
 * que exigia pg_search.
 */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return new Response('No autenticado', { status: 401 });
  await ready();

  const q = new URL(req.url).searchParams.get('q')?.trim() ?? '';
  if (q.length < 2) return Response.json({ results: [] });

  // Se escapan los comodines de LIKE para que un % escrito por el usuario
  // busque un % y no lo convierta en "cualquier cosa".
  const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

  const results = await sql`
    SELECT
      c.id,
      c.title,
      c.updated_at,
      -- Primer fragmento coincidente, para enseñar por que sale ese resultado.
      (
        SELECT substring(m.content from greatest(1, position(lower(${q}) in lower(m.content)) - 40) for 160)
        FROM messages m
        WHERE m.conversation_id = c.id AND m.content ILIKE ${pattern}
        ORDER BY m.created_at
        LIMIT 1
      ) AS snippet
    FROM conversations c
    WHERE c.user_id = ${user.id}
      AND (
        c.title ILIKE ${pattern}
        OR EXISTS (
          SELECT 1 FROM messages m
          WHERE m.conversation_id = c.id AND m.content ILIKE ${pattern}
        )
      )
    ORDER BY c.updated_at DESC
    LIMIT 40
  `;

  return Response.json({ results });
}
