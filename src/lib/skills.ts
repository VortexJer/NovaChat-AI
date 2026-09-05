import { ready, sql } from './db';

/**
 * Skills instalables: instrucciones reutilizables que el modelo carga bajo
 * demanda, no en cada turno.
 *
 * Es el mecanismo que describe claude.ai en Ajustes -> Personalizar -> Skills,
 * distinto de las skills de generacion de archivos (docx/pptx/xlsx), que aqui
 * son herramientas propias en `tools.ts`. La divulgacion progresiva es lo que
 * lo hace barato: el catalogo (nombre + una linea) va siempre en la
 * descripcion de la herramienta `usar_skill`; el contenido completo de una
 * skill concreta solo entra en el contexto cuando el modelo decide que hace
 * falta y la pide por su nombre — la primera llamada carga la skill, la
 * segunda ya hace el trabajo con ella.
 *
 * Las incorporadas cubren tareas de desarrollo habituales. La idea de que
 * herramientas de este tipo existan viene de mirar el catalogo abierto
 * `openagentskills` (github.com/Notysoty/openagentskills, MIT, Copyright (c)
 * 2026 OpenAgentSkills Contributors) para saber que categorias tienen sentido
 * — pero el texto de cada una esta escrito aqui desde cero, en el tono de
 * NovaChat, no copiado de ese repositorio.
 *
 * `docx`/`pptx`/`xlsx`/`diseno-web` son el equivalente de las skills que
 * claude.ai carga solo antes de generar ese tipo de archivo. Las suyas
 * (github.com/anthropics/skills, carpetas docx/pptx/xlsx) llevan licencia
 * propietaria, asi que no se puede reusar ni su texto ni su codigo — lo de
 * aqui esta escrito desde cero y adaptado a lo que `crear_documento_word`,
 * `crear_presentacion` y `crear_hoja_calculo` (`officeTools.ts`) realmente
 * saben producir (Markdown sencillo sin tablas ni imagenes; diapositivas de
 * titulo + viñetas sin graficos; celdas de texto o numero sin formulas), no
 * al flujo con Python/uv/LibreOffice de una skill pensada para un entorno
 * agentic con terminal. `diseno-web` si es una adaptacion directa —
 * traducida y resumida, no copiada literal— de `frontend-design` del mismo
 * repositorio, que esa carpeta si publica bajo Apache License 2.0 con su
 * propio LICENSE.txt.
 */

export type BuiltinSkill = { name: string; description: string; content: string };

export const BUILTIN_SKILLS: BuiltinSkill[] = [
  {
    name: 'commits-convencionales',
    description: 'Redacta el mensaje de un commit siguiendo Conventional Commits a partir de un diff.',
    content: `Cuando te pidan un mensaje de commit a partir de un diff o una descripcion de cambios, sigue Conventional Commits:

- Formato: \`tipo(alcance opcional): resumen en imperativo, en minuscula, sin punto final\`.
- Tipos: feat, fix, docs, style, refactor, perf, test, chore, ci, build.
- El resumen no pasa de 72 caracteres. Si el cambio es grande, anade un cuerpo separado por una linea en blanco explicando el porque, no el que (el diff ya dice el que).
- Un cambio que rompe compatibilidad lleva \`!\` tras el tipo/alcance y una linea \`BREAKING CHANGE:\` en el cuerpo.
- Si el diff mezcla cambios sin relacion, dilo y sugiere dividirlo en varios commits en vez de forzar un solo tipo.
- Nunca inventes que archivos cambiaron si no estan en el diff que te han dado.`,
  },
  {
    name: 'descripcion-pr',
    description: 'Escribe la descripcion de un pull request a partir de un diff o una lista de cambios.',
    content: `Cuando te pidan describir un pull request:

- Empieza con un resumen de una o dos frases: que hace el cambio y por que, no una lista de archivos tocados.
- Sigue con una seccion "Cambios" en lista, agrupada por tema si hay varios, no archivo por archivo.
- Si el diff sugiere una forma de probarlo, incluye una seccion "Como probarlo" con pasos concretos y reproducibles.
- Menciona riesgos o efectos secundarios solo si son reales y visibles en el diff; no inventes advertencias genericas.
- Si falta contexto para explicar el porque (una decision de diseno, un enlace a un ticket), dilo en vez de rellenarlo.`,
  },
  {
    name: 'redactar-readme',
    description: 'Genera un README.md completo a partir del codigo o de una descripcion del proyecto.',
    content: `Cuando te pidan un README:

- Orden: titulo y una frase que diga que hace el proyecto, instalacion, uso con un ejemplo minimo que funcione copiado y pegado, configuracion si la hay, y licencia si se conoce.
- El ejemplo de uso va primero que cualquier explicacion de arquitectura: quien llega a un README quiere ver que funciona antes de saber como esta hecho por dentro.
- No inventes badges, enlaces de CI o nombres de paquete que no te hayan dado; si faltan, deja el hueco marcado en vez de rellenarlo con un placeholder que parezca real.
- Si el proyecto tiene una unica forma de instalarlo (un gestor de paquetes concreto, una version de lenguaje), usa esa, no una lista de alternativas genericas.`,
  },
  {
    name: 'revision-codigo',
    description: 'Revisa un diff o archivo con una checklist sistematica: correccion, seguridad, rendimiento, legibilidad.',
    content: `Cuando te pidan revisar codigo, repasa en este orden y solo comenta lo que de verdad encuentres, no la lista entera por sistema:

1. Correccion: ¿hace lo que dice que hace? ¿hay casos borde sin cubrir (vacio, nulo, concurrencia)?
2. Seguridad: entrada de usuario sin validar, inyeccion, secretos en claro, permisos de mas.
3. Rendimiento: bucles o consultas que escalan mal con el tamano real de los datos, no micro-optimizaciones que no importan aqui.
4. Legibilidad: nombres, funciones que hacen demasiado, duplicacion que ya deberia ser una funcion.

Para cada hallazgo real: donde esta, por que es un problema (con el caso concreto que lo dispara), y que cambiarias. Si no hay nada que objetar en una categoria, no la menciones solo por rellenar.`,
  },
  {
    name: 'curar-changelog',
    description: 'Mantiene un CHANGELOG.md siguiendo Keep a Changelog a partir del historial de git o una lista de PRs.',
    content: `Cuando te pidan actualizar un CHANGELOG a partir de commits o PRs:

- Agrupa bajo Added, Changed, Fixed, Removed, Security — solo las secciones que de verdad tengan entradas.
- Cada entrada es una frase desde el punto de vista de quien usa el proyecto, no desde el commit: "Se puede exportar a CSV", no "feat: csv export en el modulo de reportes".
- Sin tecnicismos internos (nombres de funcion, de archivo) salvo que el propio changelog del proyecto ya los use.
- Version y fecha en el encabezado de cada bloque; si no te dan la version, pregunta antes de inventarla.`,
  },
  {
    name: 'escribir-tests-unitarios',
    description: 'Genera tests unitarios para una funcion o modulo, incluyendo casos borde.',
    content: `Cuando te pidan tests para una funcion o modulo:

- Cubre primero el camino feliz con un caso representativo, no el mas trivial posible.
- Despues casos borde reales para esa funcion concreta: entradas vacias, valores limite, tipos inesperados si el lenguaje lo permite, y el camino de error si la funcion puede fallar.
- Un test, una afirmacion clara de que se comprueba; el nombre del test dice que se espera, no "test1".
- Usa el framework de testing que ya se use en el proyecto si es visible en el codigo que te han dado; si no hay pista, dilo y elige el mas comun para ese lenguaje.
- No generes tests para comportamiento que no esta en el codigo, aunque parezca que "deberia" estar.`,
  },
  {
    name: 'diagnostico-de-bug',
    description: 'Diagnostica un bug de forma sistematica: traza el flujo de ejecucion y separa causa raiz de sintoma.',
    content: `Cuando te den un bug para diagnosticar (un error, un stack trace, un comportamiento inesperado):

- Primero describe el sintoma tal como se observa, sin saltar a la causa todavia.
- Traza el flujo de ejecucion hacia atras desde donde falla hasta donde se origina el dato o la condicion que lo causa.
- Distingue causa raiz de sintoma: dos errores que se ven parecidos pueden venir de sitios distintos; no asumas que el primer punto sospechoso es el origen.
- Si el codigo que te han dado no alcanza para confirmar la causa, dilo y pide lo que falta (el resto del stack trace, la funcion que llama a esta) en vez de adivinar.
- Termina con la causa raiz en una frase y el cambio minimo que la arregla, separado de cualquier mejora adicional que no sea necesaria para arreglar el bug.`,
  },
  {
    name: 'plan-de-refactor',
    description: 'Crea un plan de refactor seguro y por pasos para limpiar codigo sin romper el comportamiento actual.',
    content: `Cuando te pidan planificar un refactor:

- Divide en pasos pequenos que cada uno deje el codigo funcionando; nunca un paso que rompa algo a mitad de camino.
- Cada paso dice que cambia y por que ese orden importa (que paso depende de cual).
- Senala donde hace falta un test antes de tocar el codigo, si no lo hay ya, para poder confirmar que el comportamiento no cambio.
- No mezcles refactor con cambios de comportamiento nuevo en el mismo plan; si detectas que hace falta lo segundo, dilo aparte.
- Si el alcance que piden es demasiado grande para un solo plan razonable, dilo y propon dividirlo en fases.`,
  },
  {
    name: 'optimizar-sql',
    description: 'Revisa consultas SQL por problemas de rendimiento y las reescribe con un plan de ejecucion mejor.',
    content: `Cuando te den una consulta SQL para optimizar:

- Primero identifica el problema real: falta de indice, un JOIN que multiplica filas, una subconsulta correlacionada, un SELECT * innecesario, ausencia de LIMIT donde deberia haberlo.
- Explica el porque en terminos del plan de ejecucion (que esta obligando a un escaneo completo, por que), no solo "esto es mas lento".
- Da la version reescrita completa, no un fragmento.
- Si la mejora depende de un indice que no sabes si existe, dilo explicitamente en vez de asumir que esta.
- No reescribas una consulta que ya esta bien solo por cambiar algo.`,
  },
  {
    name: 'documentar-api',
    description: 'Genera documentacion de endpoints REST compatible con OpenAPI a partir del codigo o las rutas.',
    content: `Cuando te pidan documentar una API a partir de codigo o definiciones de rutas:

- Por cada endpoint: metodo, ruta, que hace en una frase, parametros (de ruta, query y cuerpo) con su tipo y si son obligatorios, y las respuestas posibles con su codigo de estado.
- Los ejemplos de petición y respuesta reflejan la forma real de los datos que veas en el codigo, no un ejemplo generico inventado.
- Si el codigo no deja claro un tipo o si un campo es opcional, marcalo como incierto en vez de decidirlo por tu cuenta.
- Agrupa los endpoints por recurso, en el orden en que aparecen en el codigo salvo que haya un agrupamiento mas natural.`,
  },
  {
    name: 'docx',
    description: 'Como redactar el contenido antes de llamar a crear_documento_word: estructura, jerarquia de titulos, tablas y que evitar.',
    content: `Antes de llamar a \`crear_documento_word\`, piensa el documento como una pieza para leer en Word, no como una respuesta de chat pegada dentro de un archivo.

**Formato disponible**: el "contenido" es Markdown, pero solo un subconjunto se convierte de verdad — \`#\`/\`##\`/\`###\` a titulo/subtitulo/subapartado, lineas con \`-\` o \`*\` a vineta, \`**texto**\` a negrita, y tablas con barras verticales. No hay imagenes, enlaces con formato ni listas numeradas: si el contenido las necesita de verdad, describelas en prosa o en vinetas en vez de escribir sintaxis que no se va a renderizar.

**Tablas**: usalas siempre que los datos tengan la misma forma repetida — hitos con fecha y estado, comparativas, presupuestos, requisitos con responsable. Salen como tabla real de Word, con la cabecera en azul marino sobre blanco y bordes grises, no como texto tabulado. La sintaxis es la de Markdown de toda la vida, con la fila separadora obligatoria:

\`\`\`
| Hito | Fecha | Responsable | Estado |
|---|---|---|---|
| Auditoria de sistemas | 15 de enero | Infraestructura | Completado |
| Migracion de datos | 3 de marzo | Datos | En riesgo |
\`\`\`

Todas las filas tienen que tener el mismo numero de columnas que la cabecera. Manten las celdas cortas (una frase como mucho): un parrafo entero dentro de una celda es senal de que eso va en el cuerpo del texto, no en una tabla. Y no metas una tabla de dos columnas solo para poner dos datos sueltos — para eso vale una vineta.

**El titulo va aparte**: el parametro \`titulo\` ya se muestra como titulo del documento en Word, en azul marino y con una linea debajo. No repitas ese mismo texto como un \`#\` al principio del \`contenido\` — la primera linea del cuerpo deberia ser ya la primera seccion real.

**Subtitulo**: si el documento tiene contexto que situa al lector (a quien va dirigido, el periodo que cubre, la version), ponlo en \`subtitulo\` — sale en cursiva gris bajo el titulo. Ej: "Estado del proyecto | Comite de Direccion | Marzo 2026". Un memo o una carta corta no lo necesita.

**Jerarquia**: usa \`#\` para las secciones principales del documento (2-5 en un documento normal), \`##\` para subsecciones dentro de cada una, y \`###\` solo si de verdad hace falta un tercer nivel. Un documento corto (una carta, un memo de una pagina) no necesita ningun encabezado — son parrafos seguidos.

**Segun el tipo de documento**:
- Informe: resumen ejecutivo primero (uno o dos parrafos sin encabezado, antes de la primera seccion), luego las secciones con sus hallazgos, y una seccion final de conclusiones o proximos pasos.
- Carta o memo: sin encabezados; fecha y destinatario en el primer parrafo si aplica, cuerpo en parrafos cortos, cierre formal.
- Documentacion tecnica: una seccion por tema, vinetas para pasos o requisitos, negrita solo en los terminos clave que alguien buscaria con Ctrl+F.

**Vinetas con criterio**: una vineta por idea, no una vineta por frase larga con varias ideas dentro. Si una lista pasa de 7-8 elementos, agrupa en subsecciones en vez de una vineta gigante.`,
  },
  {
    name: 'pptx',
    description: 'Como estructurar diapositivas antes de llamar a crear_presentacion: puntos numerados, secciones, notas, cuando usar un grafico.',
    content: `Antes de llamar a \`crear_presentacion\`, piensa cada diapositiva como dos o tres **tarjetas puestas en columnas** que se comparan de un vistazo — no como una lista de vinetas sueltas. La herramienta dibuja cada elemento de \`puntos\` como su propia tarjeta, con una insignia redonda numerada de color, un mini-titulo en serif y su texto, sobre fondo blanco; la portada es la unica diapositiva oscura y lleva sola un indice con las secciones. Asi que el contenido tiene que venir ya partido en esa forma, no como frases largas.

**Dos o tres puntos por diapositiva, no cinco**: en columnas, tres tarjetas es el maximo que se lee de un vistazo. Si tienes cinco ideas, son dos diapositivas. Con \`grafico\` el limite baja a tres, porque las tarjetas se apilan en la mitad derecha.

**Portada**: \`titulo\` (el nombre de la presentacion) y opcionalmente \`subtitulo\` (una frase que aclare el enfoque o el publico). No repitas el titulo dentro del subtitulo.

**Por cada diapositiva**:
- \`seccion\` (opcional pero recomendable): una palabra o dos que agrupan el tema — "Introduccion", "Riesgos", "Conclusion". Sale como "01 · INTRODUCCION" encima del titulo, se numera sola.
- \`titulo\`: corto, menos de 8 palabras, que diga la idea de la diapositiva, no la categoria.
- \`puntos\`: de 2 a 3 (nunca mas). Cada uno lleva \`titulo\` (mini-cabecera de 2-5 palabras, tipo etiqueta: "Automatizacion inteligente") y \`texto\` (una o dos frases que lo explican, sin repetir las palabras del mini-titulo). Si una idea necesita mas de dos frases, es que necesita su propia diapositiva, no un punto mas largo.
- \`notas\` (recomendado): las notas del orador — el guion detallado de que decir en voz alta. Van al panel de notas real de PowerPoint (Ver > Notas), nunca se ven en la diapositiva, asi que aqui si puedes escribir en parrafos largos.
- \`cierre\` (recomendado en las diapositivas que defienden una idea): una frase que sale en una franja oscura al pie. Tiene que ser la **conclusion** que se saca de los puntos, no un resumen de ellos: si se puede borrar sin perder nada, sobra. "La pregunta ya no es cuanto tardo en hacerlo, sino cuanto tardo en revisarlo bien" vale; "en resumen, la IA ahorra tiempo" no.
- \`grafico\` (opcional, cuando hay algo que comparar): \`titulo\`, \`categorias\` (nombres) y \`valores\` (numeros) para una barra por categoria. Si la persona te dio las cifras, usa las suyas; si no, tira de un dato publico conocido y **di la fuente en el titulo del grafico o en las notas**; y si tampoco lo hay, pon cifras de ejemplo coherentes y avisa en una linea de que lo son. Lo que no se hace es **parar la presentacion para pedir los numeros**: se entrega montada y se dice que hay que sustituirlos.

**Elige el \`tema\`, no lo dejes por defecto.** Es lo que separa una baraja diseñada de una plantilla rellenada: si no lo pones, todas las presentaciones salen del mismo color y con la misma portada, hable de cafe o de ciberseguridad.

- \`fondo\`: el color oscuro de la portada, en hexadecimal. **Sacalo del significado del tema, no de la categoria**: una tostadora de cafe no tiene por que ser marron ni una empresa de salud azul corporativo. Piensa de que esta hecho el asunto — un obrador de tueste es grano oscuro y cobre caliente; una auditoria de seguridad es acero y ambar de alarma; un plan de expansion en el Mediterraneo es noche marina y cal.
- \`acentos\`: dos o tres colores que rotan por tarjeta. Que se distingan entre si de verdad: tres tonos del mismo azul no diferencian nada. El primero es el que mas sale.
- \`portada\`: \`circulos\`, \`diagonal\`, \`lineas\`, \`arco\` o \`limpia\`. Elige por el tono del encargo, no por variar: \`limpia\` para un comite o un asunto grave, \`lineas\` para algo tecnico o de datos, \`circulos\` o \`arco\` para algo mas calido.
- \`titulares\`: \`serif\` da un aire editorial y reposado; \`sans\`, tecnico y actual.

No hace falta que aciertes con un color de marca real: hace falta que la baraja parezca hecha **para este tema**. El contraste no lo decides tu — la portada siempre va oscura con texto claro y el contenido sobre blanco, porque de eso depende que se lea proyectado.

**Cambia de maqueta, no repitas la misma diapositiva seis veces**. Es lo que separa una baraja de una plantilla rellenada: aunque cada diapositiva este bien dibujada, seis iguales seguidas se leen como un formulario. Elige el \`tipo\` segun la **forma** del contenido, no por variar porque si:

- \`tarjetas\` (por defecto): dos o tres ideas que conviven, sin orden entre ellas.
- \`proceso\`: pasos que van en orden. Salen encadenados con flechas, asi que solo vale si el segundo depende del primero de verdad.
- \`comparacion\`: exactamente dos opciones enfrentadas (antes/despues, hacerlo bien/hacerlo mal, comprar/construir), cada una con su banda de color. Aqui el \`texto\` puede ser mas largo, un parrafo corto.
- \`seccion\`: separador oscuro con el numero y el nombre de la seccion, sin puntos. Uno antes de cada bloque grande en una presentacion larga; en una de seis diapositivas, ninguno o uno.
- \`cita\`: una frase a pagina completa sobre fondo oscuro. Para rematar o para abrir un giro, nunca dos veces.

Y tres piezas que cambian la diapositiva sin cambiar de tipo:

- \`destacado\`: un numero grande con su explicacion, en un panel a la derecha ("20-40%", "3 de cada 4"). Cuando la diapositiva se sostiene sobre una cifra, esa cifra tiene que verse desde el fondo de la sala. No lo combines con \`grafico\`.
- \`callout\`: caja destacada bajo el titulo con una insignia, para la definicion o el contexto que hace falta **antes** de poder leer los puntos.
- \`etiqueta\` en cada punto: una o dos palabras que lo categorizan ("Alto", "Humano", "Analitica"), como pildora de color. Sirve para que tres tarjetas se distingan de un vistazo; si las tres etiquetas dicen practicamente lo mismo, no las pongas.

Una baraja de seis diapositivas bien montada usa tres o cuatro formas distintas, no una.

**Flujo de la presentacion**: una diapositiva de contexto o problema al principio, el cuerpo dividido en secciones logicas (una idea por diapositiva), y una de cierre con conclusion o proximos pasos.

**Cuenta el numero real de diapositivas** que pide la persona: si dicen "una presentacion corta", 5-7 diapositivas totales (portada incluida) es corto de verdad, no 15.`,
  },
  {
    name: 'xlsx',
    description: 'Como organizar columnas, formatos y formulas antes de llamar a crear_hoja_calculo.',
    content: `Antes de llamar a \`crear_hoja_calculo\`, ten en cuenta lo que la herramienta ya hace sola: bloque de titulo con subtitulo y leyenda, cabecera en azul marino, bordes, resaltado en amarillo de las celdas que son datos de entrada frente a las calculadas, fila de totales destacada y cabecera congelada. Lo que tienes que decidir es la estructura de los datos, el formato de cada columna, y donde va una formula de verdad en vez de un numero suelto.

**Escribe las formulas como si la tabla empezara arriba del todo**: cabecera en la fila 1, primer dato en la fila 2. La herramienta desplaza sola las referencias para colocarlas donde acaba quedando la tabla despues del bloque de titulo, asi que no cuentes filas de cabecera ni intentes compensar el desplazamiento tu — si lo haces, lo descuadras.

**La fila de totales va la ultima y su primera celda empieza por "Total"**: asi la herramienta la reconoce y la pinta como fila de totales (fondo azul, negrita, filete arriba) en vez de como una fila de datos mas. Sus celdas tambien van con formula, y la de un porcentaje se recalcula sobre los totales, nunca es la media de las filas de arriba.

**\`subtitulo\` y \`notas\`**: el subtitulo dice las unidades y el periodo ("Importes en euros. Ejercicio natural: enero-diciembre 2026."), que es lo primero que alguien pregunta al abrir una hoja ajena. Las notas van al pie y explican de donde salen las cifras, como se calcula cada columna derivada y como ampliar la tabla sin romper las formulas. Si las cifras son de ejemplo, la primera nota lo dice.

**Usa formulas siempre que un valor sea el resultado de calcular otros de la misma hoja**: un total, un margen, un porcentaje sobre otra columna, una media. En vez de calcularlo tu y escribir el numero, pon \`{"formula": "SUM(B2:B5)"}\` (celdas en notacion A1, sin el "=" inicial — lo pone la herramienta). Esto es justo lo que \`crear_hoja_calculo\` soporta de verdad: Excel/LibreOffice recalcula la formula al abrir el archivo, no es texto. Solo pon un numero suelto cuando el dato viene de fuera (algo que te dieron o que sabes de memoria), nunca cuando es el resultado de una cuenta con datos que ya estan en la hoja.

**Los nombres de función van siempre en inglés** (\`SUM\`, no \`SUMA\`; \`AVERAGE\`, no \`PROMEDIO\`; \`COUNT\`, no \`CONTAR\`; \`IF\`, no \`SI\`) — es un requisito del formato del archivo .xlsx en si, no una cuestion de idioma de la respuesta: una formula con el nombre en español no es una formula valida y Excel la marca como error (\`#¿NOMBRE?\`) al abrir el archivo, aunque el resto de la hoja este en español sin problema.

**Formato por columna** (\`formato\` en cada entrada de \`columnas\`): \`moneda\` para dinero (con signo y separador de miles), \`porcentaje\` para tantos por ciento, \`entero\` para cifras sin decimales, \`numero\` para decimales normales, y \`texto\` (el por defecto) para todo lo demas. No metas el simbolo de moneda o el "%" a mano en el texto de la celda si ya vas a poner ese formato — se duplicaria.

**Cabeceras**: una por columna, cortas y sin abreviaturas raras. Si una columna no lleva formato numerico especial pero tiene una unidad (duracion, distancia), ponla en la propia cabecera — "Duracion (min)" — ya que ahi si hace falta escribirla a mano.

**Un tipo de dato por columna**: si una columna es numerica, todas sus filas deben llevar numero o formula, no algunas como texto plano. Si una fila no tiene dato para esa columna, deja la celda vacia (cadena vacia), no escribas "N/A" salvo que la columna entera sea de texto.

**Orden de filas**: el que tenga mas sentido para leerlo — cronologico si hay fechas, de mayor a menor si el interes esta en el valor mas alto, alfabetico si son nombres sin jerarquia.

**Cuantas columnas**: las necesarias para responder lo que pidieron, no todas las que se te ocurran — una hoja con 15 columnas para una pregunta de 3 datos es peor que una hoja con 3.`,
  },
  {
    name: 'diseno-web',
    description: 'Guia de diseno para paginas o maquetas HTML antes de escribirlas: como evitar que se vea generico por IA.',
    content: `Cuando te pidan una pagina web, landing page, maqueta de interfaz o cualquier pieza visual en HTML/CSS (que se muestra en un bloque \`\`\`html previsualizable), trata cada encargo como un diseno con personalidad propia, no como la plantilla que saldria para cualquier otro encargo parecido.

**Parte del tema real**: antes de elegir colores o tipografia, identifica de que trata esto de verdad — el sector, el publico, el tono. Una pagina para un taller de ceramica y un dashboard para analistas financieros no deberian parecerse nada. Si el encargo no dice el tema con claridad, decide uno concreto tu mismo antes de diseñar.

**Saca la paleta del significado, no de la categoria**: "cafe" no tiene por que llevar marron, ni "ecologico" verde hoja, ni "finanzas" azul corporativo — eso es exactamente el color que habria elegido cualquiera. Tira del nombre o del proceso concreto: en una tostadora llamada "Torrente", un torrente es agua fria sobre piedra mojada, y de ahi sale una pagina de pizarra y verde-agua donde el ambar aparece solo donde hay calor de verdad, en la seccion de tueste. Decide dos o tres colores con ese razonamiento y aplicalos con disciplina; el acento vale mas cuanto menos aparece.

**Un elemento firma que sea del oficio**: cada encargo tiene un objeto propio que solo tiene sentido ahi — la curva de tueste (temperatura contra tiempo, con el primer crack marcado) en una tostadora, el corte de una pieza en un taller, la linea de tiempo real de un proyecto. Dibujalo en SVG en linea, con datos coherentes, y hazlo trabajar dos veces: que abra la pagina y que luego organice otra seccion (los pasos del proceso colgados de esa misma curva, por ejemplo). Eso es lo contrario de una foto de archivo o un degradado decorativo, y es lo que hace que la pagina no se pueda reutilizar para otro negocio.

**Una sola accion principal**: un boton solido, y una vez. Los demas enlaces van como texto o como boton fantasma para que no compitan con el. Tres botones del mismo peso equivalen a ninguno.

**Movil es rediseno, no encogimiento**: una tabla ancha se convierte en bloques con su etiqueta encima, la navegacion pasa a una fila completa, las areas tactiles suben a unos 44 px y lo que estaba escalonado se endereza. Si en movil solo cambia el tamano de la letra, no esta resuelto.

**Marca lo que te has inventado**: precios, telefonos, direcciones, horarios y resenas que no te han dado son de muestra. Dejalos puestos para que la pagina se vea entera, senalados con un comentario HTML, y di en una linea al final cuales hay que sustituir. Ni dejar huecos vacios ni colar datos falsos como si fueran reales.

**Evita estos rasgos por defecto — son la señal mas clara de que algo lo genero una IA sin pensarlo**:
- Fondo crema calido (cerca de #F4F1EA) con una serif de mucho contraste y un acento terracota (cerca de #D97757).
- Fondo casi negro con un unico acento verde acido o bermellon muy saturado.
- Maqueta tipo periodico: filetes finos, radio de borde cero, columnas densas.
- El kit de tarjetas SaaS: todo troceado en tarjetas identicas con el mismo radio de borde y la misma sombra gris suave, con degradados de fondo como decoracion.
- Adornos de plantilla: etiquetas en MAYUSCULAS con tracking encima de cada titulo, textos separados por puntos medios ("A · B · C"), etiquetas con guion largo ("PALABRA — fragmento"), letras pequeñas en monoespaciada para datos, una flecha "→" al final de cada enlace.

**Tipografia con intencion**: una o dos familias, no mas; si son dos, que se distingan claramente entre si (una para titulares, otra para cuerpo). Lineas de menos de 80 caracteres. Nada de acentuar una sola palabra del titular en cursiva o color, ni etiquetas en mayusculas sobre cada bloque solo por decoracion.

**Un solo protagonista**: elige un unico elemento que se lleve todo el atrevimiento visual (un titular, una imagen, una animacion de entrada) y manten todo lo demas alrededor sobrio. No repitas el mismo efecto de aparicion en cada seccion ni un hover distinto en cada tarjeta — eso es lo que mas delata una pagina generica.

**Estructura como informacion, no decoracion**: si usas numeros (01/02/03), lineas divisorias o marcadores, que reflejen algo real del contenido (pasos de un proceso, una linea de tiempo) — no los añadas porque "quedan bien".

**Accesibilidad como base, no como extra**: contraste suficiente, foco de teclado visible, que la pagina responda bien en movil sin que haya que decirlo explicitamente.`,
  },
];

function findBuiltin(name: string) {
  return BUILTIN_SKILLS.find((s) => s.name === name);
}

export type SkillSummary = { name: string; description: string; builtin: boolean; edited: boolean };

/** Catalogo de un usuario: incorporadas + las suyas propias. */
export async function listSkills(userId: string): Promise<SkillSummary[]> {
  await ready();
  const custom = await sql<{ name: string; description: string }[]>`
    SELECT name, description FROM skills WHERE user_id = ${userId} ORDER BY name
  `;
  const overrides = new Map(custom.map((c) => [c.name, c]));

  // Una incorporada que se ha editado aparece una sola vez, con la
  // descripcion editada y marcada como retocada: son la misma skill, no dos.
  const builtins = BUILTIN_SKILLS.map((s) => {
    const mine = overrides.get(s.name);
    return {
      name: s.name,
      description: mine?.description ?? s.description,
      builtin: true,
      edited: Boolean(mine),
    };
  });

  return [
    ...builtins,
    ...custom.filter((c) => !findBuiltin(c.name)).map((s) => ({ ...s, builtin: false, edited: false })),
  ];
}

/**
 * Contenido completo de una skill.
 *
 * La version del usuario manda sobre la incorporada: editar una de fabrica
 * guarda una copia con el mismo nombre que la sustituye, y borrarla devuelve
 * la original. Asi se puede retocar lo que trae la aplicacion sin perder
 * nunca el texto de partida, que sigue en el codigo.
 */
export async function getSkillContent(userId: string, name: string): Promise<string | null> {
  await ready();
  const [row] = await sql<{ content: string }[]>`
    SELECT content FROM skills WHERE user_id = ${userId} AND name = ${name}
  `;
  if (row) return row.content;

  return findBuiltin(name)?.content ?? null;
}

/** El texto de fabrica, para poder enseñar de que se parte al editar. */
export function builtinContent(name: string): string | null {
  return findBuiltin(name)?.content ?? null;
}

export async function saveSkill(userId: string, name: string, description: string, content: string) {
  await ready();
  await sql`
    INSERT INTO skills (id, user_id, name, description, content)
    VALUES (${crypto.randomUUID()}, ${userId}, ${name}, ${description}, ${content})
    ON CONFLICT (user_id, name) DO UPDATE
      SET description = EXCLUDED.description, content = EXCLUDED.content
  `;
}

/**
 * Borra la skill del usuario.
 *
 * En una incorporada eso no la borra: quita la copia editada y vuelve a valer
 * la de fabrica, que vive en el codigo y no se puede perder.
 */
export async function deleteSkill(userId: string, name: string) {
  await ready();
  await sql`DELETE FROM skills WHERE user_id = ${userId} AND name = ${name}`;
}
