/**
 * Tareas programadas.
 *
 * Una tarea es un encargo y su horario. Al llegar la hora se abre una
 * conversacion nueva con ese encargo, igual que si lo hubieras escrito tu, y
 * queda en el historial para leerla cuando entres.
 *
 * Quien despierta a las tareas es un workflow de GitHub Actions que llama a
 * `/api/tasks/run`, el mismo mecanismo que el keepalive. No hay temporizador
 * dentro de la aplicacion a proposito: la instancia gratuita de Render se
 * suspende sin trafico, asi que un `setInterval` dejaria de existir justo
 * cuando hace falta. El disparador tiene que venir de fuera por narices.
 */
import { ready, sql } from './db';

export type Cadence = 'diaria' | 'laborables' | 'semanal';

export type Task = {
  id: string;
  name: string;
  prompt: string;
  cadence: Cadence;
  hour: number;
  enabled: boolean;
  last_run: string | null;
  next_run: string;
};

export const CADENCES: Cadence[] = ['diaria', 'laborables', 'semanal'];

export const cadenceLabel = (c: Cadence, hour: number) =>
  ({
    diaria: `Todos los días a las ${hour}:00`,
    laborables: `Días laborables a las ${hour}:00`,
    semanal: `Cada lunes a las ${hour}:00`,
  })[c];

/**
 * La siguiente vez que toca, en UTC.
 *
 * Se guarda calculada en vez de interpretar el horario en cada consulta: asi
 * "las que tocan ya" es una comparacion de fechas, que cualquier indice
 * resuelve, y no hay que replicar la logica del calendario en SQL.
 */
export function nextRun(cadence: Cadence, hour: number, from = new Date()): Date {
  const next = new Date(from);
  next.setUTCMinutes(0, 0, 0);
  next.setUTCHours(hour);
  if (next <= from) next.setUTCDate(next.getUTCDate() + 1);

  const day = () => next.getUTCDay(); // 0 domingo, 6 sabado
  if (cadence === 'laborables') {
    while (day() === 0 || day() === 6) next.setUTCDate(next.getUTCDate() + 1);
  } else if (cadence === 'semanal') {
    while (day() !== 1) next.setUTCDate(next.getUTCDate() + 1);
  }
  return next;
}

export async function listTasks(userId: string): Promise<Task[]> {
  await ready();
  const rows = await sql<
    {
      id: string;
      name: string;
      prompt: string;
      cadence: string;
      hour: number;
      enabled: boolean;
      last_run: Date | null;
      next_run: Date;
    }[]
  >`
    SELECT id, name, prompt, cadence, hour, enabled, last_run, next_run
    FROM tasks WHERE user_id = ${userId}
    ORDER BY enabled DESC, next_run
  `;
  return rows.map((r) => ({
    ...r,
    cadence: r.cadence as Cadence,
    last_run: r.last_run?.toISOString() ?? null,
    next_run: r.next_run.toISOString(),
  }));
}

export async function createTask(
  userId: string,
  t: { name: string; prompt: string; cadence: Cadence; hour: number },
) {
  await ready();
  const id = crypto.randomUUID();
  await sql`
    INSERT INTO tasks (id, user_id, name, prompt, cadence, hour, next_run)
    VALUES (${id}, ${userId}, ${t.name}, ${t.prompt}, ${t.cadence}, ${t.hour},
            ${nextRun(t.cadence, t.hour)})
  `;
  return id;
}

export async function toggleTask(userId: string, id: string, enabled: boolean) {
  await ready();
  await sql`UPDATE tasks SET enabled = ${enabled} WHERE id = ${id} AND user_id = ${userId}`;
}

export async function deleteTask(userId: string, id: string) {
  await ready();
  await sql`DELETE FROM tasks WHERE id = ${id} AND user_id = ${userId}`;
}

/** Las que ya tocaban. El disparador externo las pide y las ejecuta. */
export async function dueTasks(): Promise<(Task & { user_id: string })[]> {
  await ready();
  const rows = await sql<
    { id: string; user_id: string; name: string; prompt: string; cadence: string; hour: number; next_run: Date }[]
  >`
    SELECT id, user_id, name, prompt, cadence, hour, next_run
    FROM tasks
    WHERE enabled AND next_run <= now()
    ORDER BY next_run
    LIMIT 5
  `;
  return rows.map((r) => ({
    ...r,
    cadence: r.cadence as Cadence,
    enabled: true,
    last_run: null,
    next_run: r.next_run.toISOString(),
  }));
}

/** Marca la ejecucion y deja apuntada la siguiente. */
export async function markRan(id: string, cadence: Cadence, hour: number) {
  await ready();
  await sql`
    UPDATE tasks SET last_run = now(), next_run = ${nextRun(cadence, hour)}
    WHERE id = ${id}
  `;
}
