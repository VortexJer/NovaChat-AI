import { currentUser } from '@/lib/auth';
import { extractText, readFailure } from '@/lib/extract';
import { addDoc, listDocs } from '@/lib/projects';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/**
 * Lo caro no son los megas: es el texto que acaba en el prompt. Un PDF de
 * apuntes pesa 5 MB porque son escaneos, y su texto cabe de sobra. Asi que el
 * tope de bytes es generoso y el recorte de verdad va sobre los caracteres.
 */
const MAX_BYTES = 25 * 1024 * 1024;
const MAX_CHARS = 120_000;

export async function POST(req: Request, { params }: Params) {
  const user = await currentUser();
  if (!user) return new Response('No autenticado', { status: 401 });

  const { id } = await params;
  const form = await req.formData();
  const files = form.getAll('files').filter((f): f is File => f instanceof File);
  if (!files.length) return Response.json({ error: 'No se ha subido ningun archivo.' }, { status: 400 });

  const errors: string[] = [];
  for (const file of files) {
    if (file.size > MAX_BYTES) {
      errors.push(`"${file.name}" pasa de 25 MB.`);
      continue;
    }
    try {
      const text = await extractText(file.name, Buffer.from(await file.arrayBuffer()));
      if (!text.trim()) {
        errors.push(`"${file.name}" no tiene texto legible.`);
        continue;
      }
      const cropped =
        text.length > MAX_CHARS
          ? `${text.slice(0, MAX_CHARS)}

[...recortado: el archivo era mas largo]`
          : text;
      await addDoc(user.id, id, file.name.slice(0, 80), cropped);
    } catch (err) {
      errors.push(readFailure(file.name, err));
    }
  }

  return Response.json({ docs: await listDocs(user.id, id), errors });
}
