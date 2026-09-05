'use client';

/**
 * Cache en localStorage para pintar la interfaz al instante mientras se
 * confirma con el servidor por detrás — optimista: en el caso normal (un
 * solo dispositivo) lo que había en cache es exactamente lo que devuelve la
 * base de datos, así que no se nota nada; si hay otro dispositivo de por
 * medio, la respuesta del servidor corrige lo que haga falta en cuanto
 * llega, y esta cache queda al día para la próxima vez.
 *
 * Con espacio en `localStorage`, nunca revienta la interfaz por quedarse sin
 * cuota o por venir de una pestaña privada que lo bloquea: falla en
 * silencio, que es preferible a perder la conversación por un error de
 * cache.
 */

const NS = 'novachat';

function safeGet<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function safeSet(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Cuota agotada, modo privado, o localStorage inexistente: se sigue sin
    // cache, no es motivo para romper nada visible.
  }
}

function safeRemove(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    // Igual que arriba.
  }
}

export function readConversationsCache<T>(userId: string): T | null {
  return safeGet<T>(`${NS}:${userId}:conversations`);
}

export function writeConversationsCache(userId: string, value: unknown) {
  safeSet(`${NS}:${userId}:conversations`, value);
}

export function readMessagesCache<T>(userId: string, conversationId: string): T | null {
  return safeGet<T>(`${NS}:${userId}:messages:${conversationId}`);
}

export function writeMessagesCache(userId: string, conversationId: string, value: unknown) {
  safeSet(`${NS}:${userId}:messages:${conversationId}`, value);
}

export function removeMessagesCache(userId: string, conversationId: string) {
  safeRemove(`${NS}:${userId}:messages:${conversationId}`);
}
