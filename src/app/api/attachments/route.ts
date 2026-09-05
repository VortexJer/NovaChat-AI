import { currentUser } from '@/lib/auth';
import { extractText, readFailure } from '@/lib/extract';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Tope por archivo. Lo que se adjunta acaba en el contexto, y ahi cada caracter se paga. */
const MAX_BYTES = 25 * 1024 * 1024;

/** Y un tope al texto ya extraido: un PDF de doscientas paginas no cabe en el contexto. */
const MAX_CHARS = 60_000;

/**
 * Extrae el texto de lo que se adjunta a un mensaje.
 *
 * Se hace en el servidor y no en el navegador porque un PDF o un .docx no son
 * texto: hay que abrirlos. Es el mismo extractor que usa el contexto de los
 * proyectos, asi que lo que vale en un sitio vale en el otro.
 */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return new Response('No autenticado', { status: 401 });

  const form = await req.formData();
  const files = form.getAll('files').filter((f): f is File => f instanceof File);
  if (!files.length) return Response.json({ error: 'No se ha subido ningun archivo.' }, { status: 400 });

  const out: { name: string; text: string; truncated: boolean }[] = [];
  const errors: string[] = [];

  for (const file of files) {
    if (file.size > MAX_BYTES) {
      errors.push(`"${file.name}" pasa de 25 MB.`);
      continue;
    }
    try {
      const full = await extractText(file.name, Buffer.from(await file.arrayBuffer()));
      if (!full.trim()) {
        errors.push(`"${file.name}" no tiene texto legible.`);
        continue;
      }
      const truncated = full.length > MAX_CHARS;
      out.push({
        name: file.name,
        text: truncated ? `${full.slice(0, MAX_CHARS)}\n\n[...recortado: el archivo era mas largo]` : full,
        truncated,
      });
    } catch (err) {
      errors.push(readFailure(file.name, err));
    }
  }

  return Response.json({ files: out, errors });
}
