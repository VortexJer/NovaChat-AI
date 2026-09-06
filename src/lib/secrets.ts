import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

import { ready, sql } from './db';

/**
 * Claves de servicios externos (busqueda web, imagenes).
 *
 * Se guardan en la base de datos, no en variables de entorno, porque el usuario
 * las anade y las cambia desde la propia aplicacion sin volver a desplegar.
 *
 * Van cifradas con AES-256-GCM si existe SECRETS_KEY. GCM y no CBC porque
 * autentica: si alguien con acceso a la base de datos altera un valor cifrado,
 * el descifrado falla en vez de devolver basura silenciosamente.
 *
 * Sin SECRETS_KEY se guardan en claro. Es una decision explicita y visible en
 * la interfaz: preferible a inventar un cifrado con una clave que estaria
 * guardada al lado del dato, que da sensacion de seguridad sin darla.
 */

const ALGORITHM = 'aes-256-gcm';
const PLAIN_PREFIX = 'plain:';
const ENC_PREFIX = 'gcm:';

function key(): Buffer | null {
  const secret = process.env.SECRETS_KEY;
  if (!secret || secret.length < 16) return null;
  // scrypt para admitir un SECRETS_KEY de cualquier longitud y forma, en vez de
  // exigir exactamente 32 bytes en hexadecimal.
  return scryptSync(secret, 'novachat-secrets', 32);
}

export function encryptionEnabled(): boolean {
  return key() !== null;
}

function encrypt(value: string): string {
  const k = key();
  if (!k) return PLAIN_PREFIX + Buffer.from(value, 'utf8').toString('base64');

  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, k, iv);
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [ENC_PREFIX + iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join('.');
}

function decrypt(stored: string): string | null {
  if (stored.startsWith(PLAIN_PREFIX)) {
    return Buffer.from(stored.slice(PLAIN_PREFIX.length), 'base64').toString('utf8');
  }
  if (!stored.startsWith(ENC_PREFIX)) return null;

  const k = key();
  if (!k) return null; // se cifro con SECRETS_KEY y ahora no esta

  try {
    const [ivPart, tagPart, dataPart] = stored.split('.');
    const decipher = createDecipheriv(ALGORITHM, k, Buffer.from(ivPart.slice(ENC_PREFIX.length), 'base64'));
    decipher.setAuthTag(Buffer.from(tagPart, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataPart, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    // Clave cambiada o valor manipulado. Se trata como ausente.
    return null;
  }
}

export type Provider =
  | 'tavily'
  | 'jina'
  | 'pexels'
  | 'unsplash'
  | 'pixabay'
  | 'stackexchange';

export const PROVIDERS: { id: Provider; name: string; kind: 'web' | 'imagen'; help: string }[] = [
  { id: 'tavily', name: 'Tavily', kind: 'web', help: 'Busqueda web pensada para modelos. Es la que se usa primero.' },
  { id: 'jina', name: 'Jina', kind: 'web', help: 'Alternativa de busqueda y lectura de paginas. Se usa si Tavily falla.' },
  { id: 'pexels', name: 'Pexels', kind: 'imagen', help: 'Fotografia libre de derechos.' },
  { id: 'unsplash', name: 'Unsplash', kind: 'imagen', help: 'Fotografia libre de derechos.' },
  { id: 'pixabay', name: 'Pixabay', kind: 'imagen', help: 'Fotografia e ilustracion libres.' },
  { id: 'stackexchange', name: 'StackExchange', kind: 'web', help: 'Busqueda en Stack Overflow y afines.' },
];

/**
 * Devuelve la clave de un proveedor.
 *
 * Primero la que el usuario haya guardado; si no hay, la variable de entorno
 * equivalente. Asi se pueden dejar puestas por despliegue y sobreescribirlas
 * desde la interfaz sin tocar Render.
 */
export async function getKey(userId: string, provider: Provider): Promise<string | null> {
  await ready();
  const [row] = await sql<{ value: string }[]>`
    SELECT value FROM api_keys WHERE user_id = ${userId} AND provider = ${provider}
  `;
  if (row) {
    const value = decrypt(row.value);
    if (value) return value;
  }
  return process.env[`${provider.toUpperCase()}_API_KEY`] ?? null;
}

export async function setKey(userId: string, provider: Provider, value: string) {
  await ready();

  if (!value.trim()) {
    await sql`DELETE FROM api_keys WHERE user_id = ${userId} AND provider = ${provider}`;
    return;
  }

  await sql`
    INSERT INTO api_keys (user_id, provider, value)
    VALUES (${userId}, ${provider}, ${encrypt(value.trim())})
    ON CONFLICT (user_id, provider) DO UPDATE SET value = EXCLUDED.value
  `;
}

/**
 * Estado de cada proveedor, sin devolver ninguna clave.
 *
 * La interfaz solo necesita saber si hay clave y de donde sale. Devolver el
 * valor, aunque fuera enmascarado, lo pondria en el HTML de la pagina sin
 * ninguna necesidad.
 */
export async function keyStatus(userId: string) {
  await ready();
  const rows = await sql<{ provider: string }[]>`
    SELECT provider FROM api_keys WHERE user_id = ${userId}
  `;
  const saved = new Set(rows.map((r) => r.provider));

  return PROVIDERS.map((p) => ({
    ...p,
    configured: saved.has(p.id) || Boolean(process.env[`${p.id.toUpperCase()}_API_KEY`]),
    fromEnv: !saved.has(p.id) && Boolean(process.env[`${p.id.toUpperCase()}_API_KEY`]),
  }));
}

/**
 * Los conectores guardan su token igual que las claves de API: mismo cifrado y
 * mismo respaldo en claro cuando no hay `SECRETS_KEY`, para no tener dos
 * formatos de secreto en la misma base de datos.
 */
export const encryptSecret = encrypt;
export const decryptSecret = decrypt;
