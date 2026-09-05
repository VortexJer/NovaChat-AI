/**
 * Señal de vida, sin sesion ni base de datos.
 *
 * La usa el workflow de keepalive para que la instancia gratuita de Render no
 * se suspenda. A proposito no toca Postgres: el objetivo es que el proceso
 * siga en pie, y una consulta cada diez minutos solo gastaria conexiones del
 * plan gratuito sin comprobar nada que importe aqui. Tampoco pide sesion, o
 * el ping recibiria un 401 y no despertaria nada util.
 */
export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json(
    { ok: true, at: new Date().toISOString() },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
