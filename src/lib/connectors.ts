import { randomUUID } from 'node:crypto';

import { ready, sql } from './db';
import { listarHerramientas, McpError, type McpTool } from './mcp';
import { decryptSecret, encryptSecret } from './secrets';

/**
 * Conectores: servidores MCP que el usuario enchufa para que el modelo pueda
 * usar sus herramientas, igual que los "Conectores" de claude.ai.
 *
 * Lo que aqui no hay, y conviene tener claro: los conectores de Gmail, Drive y
 * Slack de claude.ai **no son servidores MCP publicos**, son integraciones con
 * OAuth registrado a nombre de Anthropic y aprobado por Google y por Slack para
 * esos permisos. No se pueden reutilizar desde fuera. Lo que si funciona hoy es
 * lo otro: los servidores MCP remotos que cada servicio publica y que se
 * autentican con un token tuyo (GitHub, Notion, Linear, Sentry...), mas
 * cualquiera que quieras montar.
 */

export type Connector = {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  /** Solo si tiene token guardado; el valor nunca sale de aqui. */
  hasToken: boolean;
  tools: number | null;
  lastError: string | null;
  created_at: string;
};

/** Catalogo de los que se pueden enchufar con un token y nada mas. */
export const CATALOGO: { id: string; name: string; url: string; help: string }[] = [
  {
    id: 'github',
    name: 'GitHub',
    url: 'https://api.githubcopilot.com/mcp/',
    help: 'Token personal de GitHub (Settings → Developer settings → Personal access tokens).',
  },
  {
    id: 'notion',
    name: 'Notion',
    url: 'https://mcp.notion.com/mcp',
    help: 'Token de una integracion interna de Notion, con las paginas compartidas con ella.',
  },
  {
    id: 'linear',
    name: 'Linear',
    url: 'https://mcp.linear.app/mcp',
    help: 'Clave de API de Linear (Settings → API).',
  },
  {
    id: 'sentry',
    name: 'Sentry',
    url: 'https://mcp.sentry.dev/mcp',
    help: 'Token de usuario de Sentry con permiso de lectura.',
  },
  {
    id: 'deepwiki',
    name: 'DeepWiki',
    url: 'https://mcp.deepwiki.com/mcp',
    help: 'Documentacion de repositorios publicos. No necesita token.',
  },
];

export async function listConnectors(userId: string): Promise<Connector[]> {
  await ready();
  const rows = await sql<
    {
      id: string;
      name: string;
      url: string;
      enabled: boolean;
      token: string | null;
      tools: number | null;
      last_error: string | null;
      created_at: string;
    }[]
  >`
    SELECT id, name, url, enabled, token, tools, last_error, created_at
    FROM connectors WHERE user_id = ${userId}
    ORDER BY created_at
  `;

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    url: r.url,
    enabled: r.enabled,
    hasToken: Boolean(r.token),
    tools: r.tools,
    lastError: r.last_error,
    created_at: r.created_at,
  }));
}

/**
 * Da de alta un conector, pero solo despues de hablar con el.
 *
 * Guardar primero y descubrir despues que la URL no era un servidor MCP deja
 * al usuario con una fila rota y sin saber por que: aqui se pide la lista de
 * herramientas antes de escribir nada, y lo que se guarda ya se sabe que
 * funciona.
 */
export async function addConnector(
  userId: string,
  name: string,
  url: string,
  token: string | null,
): Promise<{ id: string; tools: number }> {
  await ready();

  const herramientas = await listarHerramientas(url, token);
  if (!herramientas.length) {
    throw new McpError('El servidor responde, pero no publica ninguna herramienta.');
  }

  const id = randomUUID();
  await sql`
    INSERT INTO connectors (id, user_id, name, url, token, tools)
    VALUES (${id}, ${userId}, ${name}, ${url}, ${token ? encryptSecret(token) : null}, ${herramientas.length})
  `;
  return { id, tools: herramientas.length };
}

export async function setConnectorEnabled(userId: string, id: string, enabled: boolean) {
  await ready();
  await sql`UPDATE connectors SET enabled = ${enabled} WHERE id = ${id} AND user_id = ${userId}`;
}

export async function deleteConnector(userId: string, id: string) {
  await ready();
  await sql`DELETE FROM connectors WHERE id = ${id} AND user_id = ${userId}`;
}

// --- lo que usa el bucle de herramientas ------------------------------------

type Activo = { id: string; name: string; url: string; token: string | null };

async function activos(userId: string): Promise<Activo[]> {
  await ready();
  const rows = await sql<{ id: string; name: string; url: string; token: string | null }[]>`
    SELECT id, name, url, token FROM connectors
    WHERE user_id = ${userId} AND enabled = true
    ORDER BY created_at
  `;
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    url: r.url,
    token: r.token ? decryptSecret(r.token) : null,
  }));
}

/**
 * Cache de las listas de herramientas.
 *
 * Sin esto habria una vuelta a cada conector **en cada mensaje**, antes incluso
 * de empezar a responder, y eso se nota en lo unico que ya iba justo: el tiempo
 * hasta la primera palabra. Cinco minutos es suficiente para no repetirla en
 * una conversacion y lo bastante corto para que al añadir una herramienta al
 * servidor aparezca sola.
 */
const CACHE_MS = 5 * 60 * 1000;
const cache = new Map<string, { hasta: number; tools: McpTool[] }>();

/** Nombre que ve el modelo. Tiene que ser unico y valer como identificador. */
export function toolName(connectorId: string, tool: string): string {
  return `mcp_${connectorId.slice(0, 8)}_${tool}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
}

export type ConnectorTool = {
  connector: Activo;
  tool: McpTool;
  /** El nombre con el que se le ofrece al modelo. */
  publicName: string;
};

/**
 * Todas las herramientas de los conectores encendidos, con tope.
 *
 * El tope no es decorativo: cada herramienta viaja con su esquema completo en
 * **cada** peticion, y el router que hay detras ya elige mal cuando hay muchas.
 * Un conector con cuarenta herramientas hundiria la eleccion de las cuatro que
 * de verdad se usan.
 */
const MAX_POR_CONECTOR = 12;
const MAX_TOTAL = 24;

export async function connectorTools(userId: string): Promise<ConnectorTool[]> {
  const lista = await activos(userId);
  if (!lista.length) return [];

  const salida: ConnectorTool[] = [];

  await Promise.all(
    lista.map(async (c) => {
      const guardado = cache.get(c.id);
      let tools: McpTool[];

      if (guardado && guardado.hasta > Date.now()) {
        tools = guardado.tools;
      } else {
        try {
          tools = await listarHerramientas(c.url, c.token);
          cache.set(c.id, { hasta: Date.now() + CACHE_MS, tools });
          await sql`UPDATE connectors SET tools = ${tools.length}, last_error = NULL WHERE id = ${c.id}`;
        } catch (err) {
          // Un conector caido no puede dejar sin responder al usuario: se anota
          // el motivo para que se vea en su pantalla y se sigue sin el.
          const motivo = err instanceof Error ? err.message.slice(0, 200) : 'Error desconocido';
          await sql`UPDATE connectors SET last_error = ${motivo} WHERE id = ${c.id}`.catch(() => undefined);
          cache.set(c.id, { hasta: Date.now() + CACHE_MS, tools: [] });
          return;
        }
      }

      for (const t of tools.slice(0, MAX_POR_CONECTOR)) {
        salida.push({ connector: c, tool: t, publicName: toolName(c.id, t.name) });
      }
    }),
  );

  return salida.slice(0, MAX_TOTAL);
}

/** Encuentra a quien pertenece un nombre de herramienta que empieza por `mcp_`. */
export async function findConnectorTool(
  userId: string,
  publicName: string,
): Promise<ConnectorTool | null> {
  const todas = await connectorTools(userId);
  return todas.find((t) => t.publicName === publicName) ?? null;
}
