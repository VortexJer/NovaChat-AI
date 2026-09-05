import { ready, sql } from '@/lib/db';
import { completeRound, type ChatMessage } from '@/lib/llm';
import { DEFAULT_SYSTEM_PROMPT, renderPrompt } from '@/lib/prompt';
import { dueTasks, markRan } from '@/lib/tasks';
import { availableTools, runTool, type ToolUI } from '@/lib/tools';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_ROUNDS = 6;

/**
 * Ejecuta las tareas que ya tocaban.
 *
 * La llama un workflow de GitHub Actions con la cabecera del secreto, no una
 * sesion de navegador: aqui no hay usuario delante. No hay temporizador dentro
 * de la aplicacion porque la instancia gratuita de Render se suspende sin
 * trafico, asi que un `setInterval` dejaria de existir justo cuando toca.
 *
 * Cada tarea abre una conversacion nueva con su encargo, igual que si lo
 * hubieras escrito tu, y queda en el historial.
 */
export async function POST(req: Request) {
  const secret = process.env.TASKS_SECRET;
  if (!secret) return new Response('Las tareas programadas no estan configuradas.', { status: 503 });
  if (req.headers.get('x-tasks-secret') !== secret) return new Response('No autorizado', { status: 401 });

  await ready();
  const tasks = await dueTasks();
  const done: string[] = [];

  for (const task of tasks) {
    try {
      const conversationId = crypto.randomUUID();
      await sql`
        INSERT INTO conversations (id, user_id, title, model)
        VALUES (${conversationId}, ${task.user_id}, ${task.name}, 'auto')
      `;
      await sql`
        INSERT INTO messages (id, conversation_id, role, content)
        VALUES (${crypto.randomUUID()}, ${conversationId}, 'user', ${task.prompt})
      `;

      const tools = await availableTools(task.user_id);
      const conversation: ChatMessage[] = [
        { role: 'system', content: renderPrompt(DEFAULT_SYSTEM_PROMPT) },
        { role: 'user', content: task.prompt },
      ];

      let text = '';
      const trace: { id: string; name: string; args: unknown; ui?: ToolUI }[] = [];

      for (let round = 0; round <= MAX_ROUNDS; round++) {
        const offer = round < MAX_ROUNDS ? tools : [];
        const result = await completeRound('auto', conversation, offer);
        if (!result) break;

        if (result.content) text += result.content;
        if (!result.toolCalls.length) break;

        conversation.push({
          role: 'assistant',
          content: result.content,
          tool_calls: result.toolCalls.map((c) => ({
            id: c.id,
            type: 'function',
            function: { name: c.name, arguments: c.args },
          })),
        });

        for (const call of result.toolCalls) {
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(call.args || '{}');
          } catch {
            // Argumentos malformados: la herramienta contestara que falta algo.
          }
          const outcome = await runTool(task.user_id, call.name, args, conversationId);
          conversation.push({ role: 'tool', tool_call_id: call.id, content: outcome.forModel });
          trace.push({ id: call.id, name: call.name, args, ui: outcome.ui });
        }
      }

      await sql`
        INSERT INTO messages (id, conversation_id, role, content, model, trace)
        VALUES (${crypto.randomUUID()}, ${conversationId}, 'assistant', ${text}, 'auto', ${trace.length ? sql.json(trace as unknown as Parameters<typeof sql.json>[0]) : null})
      `;
      await markRan(task.id, task.cadence, task.hour);
      done.push(task.name);
    } catch (err) {
      // Una tarea que falla no puede impedir que corran las demas; se reprograma
      // igualmente para no quedarse atascada reintentando en cada ping.
      console.warn('[novachat] tarea fallida:', task.name, (err as Error).message);
      await markRan(task.id, task.cadence, task.hour);
    }
  }

  return Response.json({ ejecutadas: done });
}
