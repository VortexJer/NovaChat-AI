/**
 * Artefactos: lo que NovaChat genera y se puede volver a abrir.
 *
 * Los documentos de Office y las paginas HTML del panel de vista previa se
 * guardan en Postgres con sus bytes, no en memoria. Antes vivian treinta
 * minutos y se perdian: volver al dia siguiente a por el .pptx que te habia
 * hecho no era posible, y una galeria de lo generado habria enseñado tarjetas
 * que ya no se pueden descargar.
 *
 * El almacen en memoria (`files.ts`) sigue existiendo delante como cache del
 * proceso, para que la descarga inmediata no vuelva a leer los bytes de la
 * base de datos.
 */
import { ready, sql } from './db';
import { storeFileWithId } from './files';

export type ArtifactKind = 'docx' | 'pptx' | 'xlsx' | 'html';

export type ArtifactSummary = {
  id: string;
  kind: ArtifactKind;
  name: string;
  created_at: string;
  conversation_id: string | null;
  bytes: number;
};

/** Guarda un artefacto y devuelve su id, que es el mismo con el que se descarga. */
export async function saveArtifact(opts: {
  userId: string;
  conversationId: string | null;
  kind: ArtifactKind;
  name: string;
  mime: string;
  buffer: Buffer;
  previewHtml?: string;
}): Promise<string> {
  const id = crypto.randomUUID();
  // En memoria primero: la descarga suele llegar segundos despues de generar
  // el archivo, y no tiene sentido que pase por la base de datos.
  storeFileWithId(id, opts.buffer, opts.name, opts.mime);

  try {
    await ready();
    await sql`
      INSERT INTO artifacts (id, user_id, conversation_id, kind, name, mime, bytes, preview_html)
      VALUES (${id}, ${opts.userId}, ${opts.conversationId}, ${opts.kind}, ${opts.name},
              ${opts.mime}, ${opts.buffer}, ${opts.previewHtml ?? null})
    `;
  } catch (err) {
    // Que falle el guardado no puede tumbar la respuesta: el archivo ya esta
    // en memoria y la persona puede descargarlo igualmente en esta sesion.
    console.warn('[novachat] no se ha podido guardar el artefacto:', (err as Error).message);
  }

  return id;
}

/** Los artefactos de una persona, del mas reciente al mas antiguo, sin los bytes. */
export async function listArtifacts(userId: string, limit = 60): Promise<ArtifactSummary[]> {
  await ready();
  const rows = await sql<
    { id: string; kind: string; name: string; created_at: Date; conversation_id: string | null; bytes: number }[]
  >`
    SELECT id, kind, name, created_at, conversation_id, octet_length(bytes) AS bytes
    FROM artifacts
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind as ArtifactKind,
    name: r.name,
    created_at: r.created_at.toISOString(),
    conversation_id: r.conversation_id,
    bytes: Number(r.bytes),
  }));
}

/** Bytes y metadatos de un artefacto, comprobando que es de quien lo pide. */
export async function getArtifact(userId: string, id: string) {
  await ready();
  const [row] = await sql<{ name: string; mime: string; bytes: Buffer }[]>`
    SELECT name, mime, bytes FROM artifacts WHERE id = ${id} AND user_id = ${userId}
  `;
  return row ?? null;
}

/** La vista previa guardada, para volver a abrirla en el panel sin regenerar nada. */
export async function getArtifactPreview(userId: string, id: string) {
  await ready();
  const [row] = await sql<{ name: string; kind: string; preview_html: string | null }[]>`
    SELECT name, kind, preview_html FROM artifacts WHERE id = ${id} AND user_id = ${userId}
  `;
  return row ?? null;
}

export async function deleteArtifact(userId: string, id: string) {
  await ready();
  await sql`DELETE FROM artifacts WHERE id = ${id} AND user_id = ${userId}`;
}
