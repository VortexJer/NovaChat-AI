import {
  randomBytes,
  randomUUID,
  scrypt,
  type ScryptOptions,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';
import { cookies } from 'next/headers';

import { ready, sql } from './db';

// promisify pierde la sobrecarga de scrypt que acepta opciones, asi que se
// declara la firma que de verdad se usa.
const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

export const SESSION_COOKIE = 'novachat_session';
const SESSION_DAYS = 30;

// --- contrasenas -----------------------------------------------------------
//
// scrypt del propio Node, sin dependencias. Los parametros son los que
// recomienda OWASP para scrypt (N=2^16, r=8, p=1): sobre 100 ms por hash en el
// hardware de Render, suficiente para que un ataque por fuerza bruta sobre el
// volcado de la base de datos no sea practico, y despreciable para un login.

const SCRYPT = { N: 65_536, r: 8, p: 1, maxmem: 128 * 65_536 * 8 * 2 };
const KEYLEN = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password.normalize('NFKC'), salt, KEYLEN, SCRYPT);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, keyHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !keyHex) return false;

  const expected = Buffer.from(keyHex, 'hex');
  const actual = await scryptAsync(
    password.normalize('NFKC'),
    Buffer.from(saltHex, 'hex'),
    expected.length,
    SCRYPT,
  );

  // Comparacion en tiempo constante: una comparacion normal filtra por cuanto
  // tarda en fallar cuantos bytes iniciales acerto el atacante.
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// --- registro --------------------------------------------------------------

/**
 * Quien puede registrarse.
 *
 * NovaChat vive en una URL publica, asi que sin esto cualquiera que diera con
 * ella podria crearse una cuenta y gastar las claves del router. La lista va en
 * ALLOWED_EMAILS separada por comas; si esta vacia solo se permite crear la
 * PRIMERA cuenta, y a partir de ahi el registro queda cerrado.
 */
export async function canRegister(email: string): Promise<{ ok: boolean; reason?: string }> {
  const allowed = (process.env.ALLOWED_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  if (allowed.length > 0) {
    return allowed.includes(email.toLowerCase())
      ? { ok: true }
      : { ok: false, reason: 'Este correo no tiene permiso para registrarse.' };
  }

  const [{ count }] = await sql<{ count: string }[]>`SELECT count(*)::text FROM users`;
  return Number(count) === 0
    ? { ok: true }
    : { ok: false, reason: 'El registro esta cerrado.' };
}

export async function createUser(email: string, password: string) {
  const id = randomUUID();
  const hash = await hashPassword(password);
  await sql`
    INSERT INTO users (id, email, password_hash)
    VALUES (${id}, ${email.toLowerCase()}, ${hash})
  `;
  return { id, email: email.toLowerCase() };
}

// --- sesiones --------------------------------------------------------------

export async function createSession(userId: string) {
  const id = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);

  await sql`INSERT INTO sessions (id, user_id, expires_at) VALUES (${id}, ${userId}, ${expires})`;

  (await cookies()).set(SESSION_COOKIE, id, {
    httpOnly: true, // fuera del alcance de cualquier script en la pagina
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires,
  });
}

export type SessionUser = { id: string; email: string };

/** Usuario de la peticion actual, o null. Valida la caducidad en la consulta. */
export async function currentUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;

  await ready();
  const rows = await sql<SessionUser[]>`
    SELECT u.id, u.email
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.id = ${token} AND s.expires_at > now()
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await sql`DELETE FROM sessions WHERE id = ${token}`;
  jar.delete(SESSION_COOKIE);
}
