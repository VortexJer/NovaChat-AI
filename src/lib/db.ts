import postgres from 'postgres';

declare global {
  // eslint-disable-next-line no-var
  var __novachatSql: postgres.Sql | undefined;
  // eslint-disable-next-line no-var
  var __novachatReady: Promise<void> | undefined;
}

/** Esquema propio de NovaChat dentro de la base de datos. */
const SCHEMA = 'novachat';

function connect() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL no esta definida');

  return postgres(url, {
    // El plan gratuito de Render corre una sola instancia y Supabase cobra
    // conexiones caras, asi que un pool pequeno con reciclado agresivo evita
    // agotar el limite del pooler cuando el servicio duerme y despierta.
    max: 4,
    idle_timeout: 20,
    connect_timeout: 15,
    prepare: false, // el pooler de Supabase en modo transaccion no soporta prepared statements

    // Esquema propio. La misma base de datos puede tener ya tablas de otra
    // aplicacion con nombres identicos (users, sessions, messages son de lo mas
    // comun); sin aislar, CREATE TABLE IF NOT EXISTS no crearia nada y las
    // consultas irian contra tablas ajenas con otra forma.
    connection: { search_path: `${SCHEMA},public` },
  });
}

// Next reinicia modulos en caliente durante el desarrollo; sin esto se abriria
// un pool nuevo en cada recarga hasta tumbar la base de datos.
function client(): postgres.Sql {
  globalThis.__novachatSql ??= connect();
  return globalThis.__novachatSql;
}

/**
 * El cliente, conectado en el primer uso y no al importar el modulo.
 *
 * Next importa cada ruta durante `next build` para recoger sus metadatos, y en
 * ese momento no hay DATABASE_URL: conectar al importar hacia fallar la
 * compilacion entera. El Proxy difiere la conexion hasta que alguien ejecuta de
 * verdad una consulta, que solo pasa ya en ejecucion.
 *
 * `apply` cubre el uso como plantilla etiquetada (sql`SELECT ...`) y `get` el
 * resto de la API del cliente.
 */
export const sql: postgres.Sql = new Proxy(function () {} as unknown as postgres.Sql, {
  apply(_target, _thisArg, args: unknown[]) {
    return (client() as unknown as (...a: unknown[]) => unknown)(...args);
  },
  get(_target, prop) {
    const instance = client() as unknown as Record<string | symbol, unknown>;
    const value = instance[prop];
    return typeof value === 'function' ? value.bind(instance) : value;
  },
});

/**
 * Crea el esquema si no existe.
 *
 * Se ejecuta una sola vez por proceso, la primera vez que alguien toca la base
 * de datos. Es idempotente a proposito: no hay ficheros de migracion que
 * mantener ni un paso de despliegue que pueda fallar y dejar el contenedor
 * muerto antes de arrancar.
 */
async function migrate() {
  // El search_path apunta aqui, pero el esquema tiene que existir antes de que
  // la primera sentencia intente crear una tabla dentro.
  await sql.unsafe(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);

  // Para que buscar_historial (tools.ts) encuentre "presentacion" dentro de
  // texto con "presentación": el diccionario 'spanish' de to_tsvector por si
  // solo no ignora tildes.
  await sql`CREATE EXTENSION IF NOT EXISTS unaccent`;

  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      email         TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS sessions (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id)`;

  await sql`
    CREATE TABLE IF NOT EXISTS conversations (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title      TEXT NOT NULL DEFAULT 'Nueva conversacion',
      model      TEXT NOT NULL,
      pinned     BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS conversations_user_idx
      ON conversations(user_id, updated_at DESC)
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS messages (
      id              TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role            TEXT NOT NULL,
      content         TEXT NOT NULL,
      reasoning       TEXT,
      model           TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS messages_conversation_idx
      ON messages(conversation_id, created_at)
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS api_keys (
      user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      value    TEXT NOT NULL,
      PRIMARY KEY (user_id, provider)
    )
  `;

  // Interruptor de herramientas por conversacion. Se anade con ALTER porque la
  // tabla puede existir ya de una version anterior, y CREATE TABLE IF NOT
  // EXISTS no anadiria la columna.
  await sql`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS tools BOOLEAN NOT NULL DEFAULT false`;

  // Nivel de esfuerzo de razonamiento por conversacion, al estilo del
  // selector "Esfuerzo" que claude.ai pone junto al modelo. NULL significa
  // "automatico": no se manda `reasoning_effort` y el proveedor decide, igual
  // que hace freellmapi cuando el cliente no manda el campo.
  await sql`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS reasoning_effort TEXT`;

  // Traza de herramientas del mensaje: que se llamo, con que argumentos, y el
  // resultado estructurado para pintar tarjetas de archivo o imagen. Sin esto
  // el aviso de "buscando..." desaparecia al terminar y no quedaba rastro de
  // que se habia buscado algo al recargar la conversacion.
  await sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS trace JSONB`;

  // Versiones de respuesta: al reintentar, la respuesta anterior no se borra
  // ni se pierde, se guarda como otra fila con el mismo reply_to y un
  // version_index mayor, y el frontend deja navegar entre ellas ("1/2 < >")
  // en vez de sobrescribir sin mas.
  await sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to TEXT REFERENCES messages(id) ON DELETE CASCADE`;
  await sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS version_index INTEGER NOT NULL DEFAULT 1`;
  await sql`CREATE INDEX IF NOT EXISTS messages_reply_to_idx ON messages(reply_to)`;

  // Relleno para filas de antes de que existiera la columna: sin esto, las
  // respuestas de conversaciones ya guardadas se quedarian con reply_to en
  // blanco y no engancharian con un reintento nuevo. Barato de repetir en
  // cada arranque porque la condicion WHERE ya no encuentra nada una vez
  // relleno.
  await sql`
    UPDATE messages a SET reply_to = (
      SELECT u.id FROM messages u
      WHERE u.conversation_id = a.conversation_id AND u.role = 'user' AND u.created_at <= a.created_at
      ORDER BY u.created_at DESC LIMIT 1
    )
    WHERE a.role = 'assistant' AND a.reply_to IS NULL
  `;
  await sql`UPDATE messages SET reply_to = id WHERE role = 'user' AND reply_to IS NULL`;

  // Skills instalables por el usuario, ademas de las incorporadas que viven en
  // codigo (src/lib/skills.ts). Solo las propias necesitan tabla.
  await sql`
    CREATE TABLE IF NOT EXISTS skills (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      description TEXT NOT NULL,
      content     TEXT NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (user_id, name)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS settings (
      user_id       TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      system_prompt TEXT,
      temperature   REAL NOT NULL DEFAULT 1,
      default_model TEXT
    )
  `;

  // Artefactos: todo lo que NovaChat genera y se puede volver a abrir — los
  // documentos de Office y las paginas HTML del panel de vista previa.
  //
  // Los bytes van en la propia fila. Es lo que convierte la galeria en algo
  // util: antes el archivo vivia treinta minutos en memoria, asi que una
  // lista de lo generado habria enseñado tarjetas que ya no se pueden
  // descargar. Postgres aguanta de sobra estos tamanos (un .pptx con graficos
  // ronda los 200 KB) y evita depender de un disco que el plan gratuito de
  // Render no garantiza entre reinicios.
  await sql`
    CREATE TABLE IF NOT EXISTS artifacts (
      id              TEXT PRIMARY KEY,
      user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
      kind            TEXT NOT NULL,
      name            TEXT NOT NULL,
      mime            TEXT NOT NULL,
      bytes           BYTEA NOT NULL,
      preview_html    TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS artifacts_user_created ON artifacts (user_id, created_at DESC)`;

  // Proyectos: una carpeta de conversaciones con instrucciones propias y unos
  // cuantos textos de contexto que se le dan al modelo en cada chat de dentro.
  await sql`
    CREATE TABLE IF NOT EXISTS projects (
      id           TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name         TEXT NOT NULL,
      description  TEXT,
      instructions TEXT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  // El contexto va en filas de texto, no en archivos binarios: lo que se le
  // pasa al modelo es texto, asi que guardar el .pdf original no serviria de
  // nada sin un extractor que aqui no hay.
  await sql`
    CREATE TABLE IF NOT EXISTS project_docs (
      id         TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name       TEXT NOT NULL,
      content    TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  // La columna se anade aparte porque la tabla ya existe de versiones
  // anteriores, donde CREATE TABLE IF NOT EXISTS no la habria añadido.
  await sql`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS project_id TEXT`;
  await sql`CREATE INDEX IF NOT EXISTS conversations_project ON conversations (project_id)`;

  // Conectores: servidores MCP que el usuario enchufa. `tools` y `last_error`
  // son lo ultimo que se supo de el, para poder pintar su estado sin tener que
  // llamarlo cada vez que se abre la pantalla.
  await sql`
    CREATE TABLE IF NOT EXISTS connectors (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name       TEXT NOT NULL,
      url        TEXT NOT NULL,
      token      TEXT,
      enabled    BOOLEAN NOT NULL DEFAULT true,
      tools      INTEGER,
      last_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS connectors_user ON connectors (user_id)`;

  // Tareas programadas: un encargo y su horario. `next_run` se calcula al
  // guardar y despues de cada ejecucion, para poder pedir "las que tocan ya"
  // con una comparacion simple en vez de interpretar horarios en SQL.
  await sql`
    CREATE TABLE IF NOT EXISTS tasks (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name       TEXT NOT NULL,
      prompt     TEXT NOT NULL,
      cadence    TEXT NOT NULL,
      hour       INTEGER NOT NULL DEFAULT 8,
      enabled    BOOLEAN NOT NULL DEFAULT true,
      last_run   TIMESTAMPTZ,
      next_run   TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS tasks_next_run ON tasks (enabled, next_run)`;

  // Perfil y preferencias, lo que en claude.ai es "Personalizar".
  await sql`ALTER TABLE settings ADD COLUMN IF NOT EXISTS display_name TEXT`;
  await sql`ALTER TABLE settings ADD COLUMN IF NOT EXISTS about_you TEXT`;
  await sql`ALTER TABLE settings ADD COLUMN IF NOT EXISTS instructions TEXT`;
  await sql`ALTER TABLE settings ADD COLUMN IF NOT EXISTS reduced_motion BOOLEAN NOT NULL DEFAULT false`;
}

/** Espera a que el esquema exista. Idempotente y compartido por todo el proceso. */
export function ready(): Promise<void> {
  globalThis.__novachatReady ??= migrate();
  return globalThis.__novachatReady;
}
