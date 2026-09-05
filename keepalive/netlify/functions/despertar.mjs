/**
 * Mantiene despiertos los dos servicios de Render, y de paso dispara las
 * tareas programadas de NovaChat.
 *
 * Por que Netlify y no el cron de GitHub: el cron de GitHub **nunca llego a
 * ejecutarse**. Dos workflows programados, uno cada diez minutos y otro cada
 * cuarto de hora, seis horas en `main` y cero ejecuciones que no vinieran de un
 * push. Las funciones
 * programadas de Netlify entran en el plan gratis y se ejecutan de verdad.
 *
 * Por que una ventana y no las 24 horas: Render regala **750 horas de
 * instancia al mes por cuenta**, compartidas entre todos los servicios
 * gratuitos, y suspende **todos** al agotarlas. Dos servicios despiertos
 * siempre son 1.460 horas: se suspenderia todo a mitad de mes. Doce horas al
 * día por servicio son 720, que caben. Fuera de la ventana los servicios se
 * duermen igual que hasta ahora y la primera visita paga el arranque.
 */

/** Lo que se despierta. El router tambien duerme, y su arranque es la mitad de la espera hasta la primera letra. */
const SERVICIOS = [
  'https://lobechat-yxbn.onrender.com/api/health',
  'https://freellmapi-ksgj.onrender.com/',
];

const TAREAS = 'https://lobechat-yxbn.onrender.com/api/tasks/run';

/**
 * Un servicio dormido tarda cerca de un minuto en levantarse y la funcion se
 * corta a los treinta segundos. No importa: la peticion ya ha llegado y Render
 * ya esta arrancando, asi que un corte por tiempo cuenta como exito.
 */
async function tocar(url, ms = 20_000) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'novachat-keepalive' },
      signal: AbortSignal.timeout(ms),
    });
    return `${url} → ${res.status} (${Date.now() - t0} ms)`;
  } catch (err) {
    const motivo = err?.name === 'TimeoutError' ? 'arrancando' : String(err?.message ?? err);
    return `${url} → ${motivo} (${Date.now() - t0} ms)`;
  }
}

export default async () => {
  const partes = await Promise.all(SERVICIOS.map((url) => tocar(url)));

  // Las tareas programadas solo si hay secreto: sin el, el endpoint contesta
  // 503 y no hay nada que disparar.
  const secreto = process.env.TASKS_SECRET;
  if (secreto) {
    try {
      const res = await fetch(TAREAS, {
        method: 'POST',
        headers: { 'x-tasks-secret': secreto, 'User-Agent': 'novachat-keepalive' },
        signal: AbortSignal.timeout(20_000),
      });
      partes.push(`tareas → ${res.status}`);
    } catch (err) {
      partes.push(`tareas → ${err?.name === 'TimeoutError' ? 'sin respuesta a tiempo' : String(err)}`);
    }
  }

  console.log(partes.join(' | '));
  return new Response(partes.join('\n'), { headers: { 'Content-Type': 'text/plain' } });
};

// De 08:00 a 19:59 UTC, cada diez minutos: en España son las 10:00-21:59 en
// verano y las 09:00-20:59 en invierno. Doce horas al dia por servicio.
// Ensancharla cuesta 60 horas de Render por cada hora diaria añadida (dos
// servicios × 30 dias), sobre un presupuesto de 750.
export const config = { schedule: '*/10 8-19 * * *' };
