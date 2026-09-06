import { getArtifact } from '@/lib/artifacts';
import { currentUser } from '@/lib/auth';
import { getFile } from '@/lib/files';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const user = await currentUser();
  if (!user) return new Response('No autenticado', { status: 401 });

  const { id } = await params;

  // Primero la cache del proceso, que es donde esta el archivo recien
  // generado; si ya caduco o el proceso se reinicio, se lee de la tabla de
  // artefactos, que ademas comprueba ahi que es de quien lo pide.
  const cached = getFile(id);
  const stored = cached ?? (await getArtifact(user.id, id));
  if (!stored) return new Response('El archivo no existe.', { status: 404 });

  const bytes = 'buffer' in stored ? stored.buffer : stored.bytes;

  return new Response(new Uint8Array(bytes), {
    headers: {
      'Content-Type': stored.mime,
      'Content-Disposition': `attachment; ${disposicion(stored.name)}`,
      'Content-Length': String(bytes.length),
      'Cache-Control': 'private, no-store',
    },
  });
}

/**
 * El nombre del archivo, como manda la norma.
 *
 * Antes se metia el nombre porcentaje-codificado **dentro de las comillas**
 * del parametro `filename`. Chrome lo tolera decodificandolo por su cuenta,
 * asi que parecia funcionar, pero es incorrecto: un cliente que lo tome
 * literal guarda "Acta%20de%20Reunion.docx". Y basta con eso para que el
 * archivo llegue con un nombre que no es y, si el remate se rompe, sin la
 * extension que le dice al sistema con que abrirlo.
 *
 * La forma correcta (RFC 5987 / 6266) es dar las dos: un `filename` en ASCII
 * puro como respaldo para clientes viejos, y un `filename*` en UTF-8 con el
 * nombre de verdad, que es el que se usa cuando se entiende. Los acentos y
 * los espacios sobreviven, y la extension va siempre pegada.
 */
function disposicion(nombre: string): string {
  // Comillas y saltos de linea romperian la cabecera; fuera antes de nada.
  const limpio = nombre.replace(/["\\\r\n]/g, '').trim() || 'archivo';

  // Respaldo en ASCII puro, conservando espacios y la extension.
  const ascii =
    limpio
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^\x20-\x7e]/g, '_') || 'archivo';

  return `filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(limpio)}`;
}
