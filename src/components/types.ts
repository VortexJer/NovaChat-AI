/** Los mismos cuatro niveles que ofrece freellmapi, sin "none"/"minimal": son
 * mas granularidad de la que un selector sencillo necesita. `null` es
 * "automatico" — no se manda `reasoning_effort` y el proveedor decide. */
export type ReasoningEffort = 'low' | 'medium' | 'high' | null;

export type Conversation = {
  id: string;
  title: string;
  model: string;
  pinned: boolean;
  updated_at: string;
  reasoning_effort?: ReasoningEffort;
};

/**
 * Lo que pinta la interfaz para el resultado de una herramienta, sin
 * depender de que el modelo lo describa bien en su propio texto. Duplicado a
 * mano desde `src/lib/tools.ts` en vez de importado: ese modulo tira de
 * `secrets.ts` (node:crypto) y no debe entrar en el bundle del cliente.
 */
export type ToolUI =
  | { kind: 'web'; query: string; results: { title: string; url: string }[] }
  | { kind: 'page'; url: string; title?: string }
  | { kind: 'images'; query: string; items: { url: string; thumb: string; credit: string; page: string }[] }
  | { kind: 'file'; name: string; type: 'docx' | 'pptx' | 'xlsx'; fileId: string; previewHtml?: string }
  | { kind: 'skill'; name: string; previewHtml?: string }
  | {
      kind: 'history';
      query: string;
      items: { conversationId: string; title: string; snippet: string; date: string }[];
    };

export type TraceStep = { id: string; name: string; args: Record<string, unknown>; ui?: ToolUI };

export type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string | null;
  model?: string | null;
  trace?: TraceStep[] | null;
  created_at?: string;
  /**
   * Id del mensaje de usuario al que responde (para el propio usuario, a si
   * mismo) y numero de version dentro de ese turno. Varias respuestas de
   * asistente pueden compartir `reply_to` cuando una es un reintento de otra
   * — no se pierde la anterior, se guarda como version aparte navegable.
   */
  reply_to?: string | null;
  version_index?: number;
};
