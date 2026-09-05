/**
 * Cache en memoria de los archivos generados.
 *
 * Los documentos que crea una herramienta (Word, PowerPoint, Excel) se guardan
 * de verdad en Postgres, en la tabla de artefactos. Esto es solo la copia
 * caliente para que la descarga inmediata —que llega segundos despues de
 * generarlos— no tenga que ir a la base de datos. Como la app corre en una
 * unica instancia sin escalado horizontal, un Map del propio proceso es
 * coherente sin coordinarlo con nada mas.
 */

type Stored = { buffer: Buffer; name: string; mime: string; expires: number };

/**
 * Diez minutos y treinta megas como mucho.
 *
 * Esto dejo de ser el almacen y paso a ser solo una cache: los archivos viven
 * ahora en Postgres, y `/api/files/[id]` los lee de ahi cuando ya no estan
 * aqui. Asi que no hace falta retenerlos media hora ni sin limite — en una
 * instancia de 512 MB, unas cuantas presentaciones con graficos empiezan a
 * notarse, y perder una entrada de cache no cuesta mas que una consulta.
 */
const TTL_MS = 10 * 60_000;
const MAX_BYTES = 30 * 1024 * 1024;

const store = new Map<string, Stored>();

function bytesHeld() {
  let total = 0;
  for (const f of store.values()) total += f.buffer.length;
  return total;
}

function sweep() {
  const now = Date.now();
  for (const [id, f] of store) if (f.expires < now) store.delete(id);

  // Si aun asi se pasa del tope, se van los mas antiguos. El Map de JavaScript
  // conserva el orden de insercion, asi que el primero es el mas viejo.
  while (bytesHeld() > MAX_BYTES) {
    const oldest = store.keys().next();
    if (oldest.done) break;
    store.delete(oldest.value);
  }
}

// Una unica limpieza periodica para todo el proceso, no una por archivo.
setInterval(sweep, 5 * 60_000).unref();

export function storeFile(buffer: Buffer, name: string, mime: string): string {
  const id = crypto.randomUUID();
  store.set(id, { buffer, name, mime, expires: Date.now() + TTL_MS });
  sweep();
  return id;
}

/**
 * Igual, pero con un id ya decidido fuera.
 *
 * Lo usa el almacen de artefactos para que el id de la fila en Postgres y el
 * de la cache en memoria sean el mismo: asi el enlace de descarga vale tanto
 * recien generado el archivo como meses despues, sin dos identificadores
 * distintos para la misma cosa.
 */
export function storeFileWithId(id: string, buffer: Buffer, name: string, mime: string): void {
  store.set(id, { buffer, name, mime, expires: Date.now() + TTL_MS });
  sweep();
}

export function getFile(id: string): Stored | null {
  const f = store.get(id);
  if (!f || f.expires < Date.now()) return null;
  return f;
}
