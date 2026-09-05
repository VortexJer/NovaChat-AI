# NovaChat — estado

## Base

- [x] Esquema idempotente, sin migraciones que puedan matar el arranque
- [x] Esquema propio `novachat` para no chocar con las tablas de LobeChat
- [x] Contraseñas con scrypt (OWASP) y comparación en tiempo constante
- [x] Sesiones en cookie httpOnly + tabla, caducidad validada en la consulta
- [x] Registro cerrado por lista de correos, o solo la primera cuenta
- [x] Clave del router solo en el servidor, nunca en el navegador
- [x] Catálogo de 248 modelos con nombres legibles, agrupado y cacheado (`/api/models` — ya no se consulta desde el cliente, ver "Simplificación" más abajo)
- [x] System prompt propio con la estructura de los publicados de Claude
- [x] Presets: NovaChat, Programación, Mínimo, Sin prompt
- [x] Descarga de los prompts publicados de Claude, con adaptación de identidad
- [x] Fecha y hora reales (con zona horaria) en el prompt de sistema

## Herramientas

- [x] `buscar_web` (Tavily, con Jina de reserva) — traza con consulta real y páginas abiertas
- [x] `buscar_imagenes` (Pexels/Unsplash/Pixabay) — rejilla de miniaturas con crédito
- [x] `leer_pagina` (Jina Reader)
- [x] `crear_documento_word` / `crear_presentacion` / `crear_hoja_calculo` — sin clave externa, con `docx`/`pptxgenjs`/`exceljs` (MIT, no las skills propietarias de Anthropic)
- [x] `buscar_historial` — busca en conversaciones pasadas del propio usuario con búsqueda de texto completo de Postgres (`to_tsvector`/`plainto_tsquery` + extensión `unaccent`), sin servicio externo. Excluye la conversación actual, y cada resultado es un enlace clicable que abre esa conversación (evento `novachat:open-conversation`). Siempre disponible, no depende de ninguna clave
- [x] `crear_presentacion` rediseñada: comparado un `.pptx` real de claude.ai (desunzipeado y su XML leído) contra el nuestro — el suyo usa tarjetas numeradas (mini-título + texto), eyebrow de sección, notas del orador reales y hasta un gráfico nativo; el nuestro solo hacía viñetas planas. Ahora `diapositivas` lleva `puntos` estructurados, `seccion`, `notas` (van al panel de notas real de PowerPoint vía `addNotes`) y un `grafico` de barras opcional (`addChart`) — con la vista previa HTML rediseñada para que se vea igual que el archivo real
- [x] `crear_hoja_calculo` rediseñada: fórmulas de verdad (`{"formula": "SUM(B2:B5)"}` escribe una etiqueta `<f>` en el XML, no texto — Excel la recalcula al abrir), formato por columna (moneda/porcentaje/entero/número/texto), cabecera con relleno oscuro, bordes finos y franjas alternas, y ancho de columna calculado sobre el contenido más largo de verdad, no solo la cabecera
- [x] Fórmulas siempre con el nombre de función **en inglés** (`SUM`, no `SUMA`) — descubierto probándolo de verdad: generé la hoja con `SUMA`, la rendericé con LibreOffice y las cuatro celdas salían `#¿NOMBRE?`. Es un requisito del propio formato .xlsx (ECMA-376), no del idioma de la respuesta. Documentado como aviso explícito en la skill `xlsx` para que el modelo no lo traduzca
- [x] `crear_documento_word` rediseñada contra un `.docx` real de claude.ai (descargado, desunzipeado y su `document.xml` leído): título en azul marino con línea inferior, subtítulo en cursiva gris, encabezados en azul marino con su jerarquía de tamaños, y **tablas de Word reales** desde sintaxis Markdown de barras verticales — cabecera azul marino sobre blanco que se repite al saltar de página (`tblHeader`), bordes grises y anchos de columna repartidos según lo que ocupa cada columna
- [x] Los anchos de tabla se fijan en la rejilla (`w:tblGrid` en twips, con `tblLayout` fijo), no como porcentaje por celda: con porcentajes Word y LibreOffice ignoran el reparto y dejan las columnas iguales — verificado mirando el XML generado y volviendo a renderizar
- [x] Metodología de "pruébalo tú mismo" para las tres herramientas de Office: generar el archivo llamando a la función directamente (`npx tsx`), convertirlo a PDF con LibreOffice headless, mirar el render y corregir — así se cazaron el `#¿NOMBRE?` de las fórmulas, las columnas uniformes y las cabeceras de tabla partidas en dos líneas
- [x] Arreglado el motivo real de que no saliera el archivo: probando la peticion de produccion tal cual (prompt de sistema completo + lista de herramientas completa contra el router) el modelo no llamaba a nada — se paraba a pedir "los datos reales del proyecto" o escribia el informe entero en el chat. No era el router ignorando herramientas, era el propio prompt: `<uncertainty>` decia "no inventa cifras" y `<documents>` invitaba a preguntar si faltaban datos. Ahora `<documents>` dice que el archivo **es** la respuesta (nunca el cuerpo del documento en el chat) y que sin datos se entrega el borrador completo con cifras de muestra avisando de que lo son, con la excepcion correspondiente escrita en `<uncertainty>` para que las dos secciones no se contradigan
- [x] Verificado ejecutando el bucle de herramientas de verdad contra el router, no solo leyendo el prompt: Word y Excel encadenan `usar_skill` → `crear_documento_word` / `crear_hoja_calculo` (el .docx sale con subtitulo y 13 lineas de tabla; la hoja, con 10 formulas reales y formatos moneda/porcentaje por columna). Antes, 2 de cada 3 intentos no llamaban a ninguna herramienta
- [x] Comprobado que `tool_choice` no hace falta como parche: `required` funciona y `{"type":"function"}` con nombre lo rechazan los proveedores (400), pero con el prompt arreglado `auto` ya acierta — mejor eso que forzar una herramienta por palabras clave del mensaje
- [x] Skill `diseno-web` ampliada con el metodo, no solo con la lista de lo que no hay que hacer — comparando contra una pagina real generada por claude.ai con el mismo encargo: sacar la paleta del significado del nombre y no de la categoria ("cafe" no implica marron), un elemento firma dibujado en SVG que sea del oficio y que ademas organice otra seccion, una sola accion principal, movil como rediseno y no como encogimiento, y marcar como muestra los datos inventados
- [x] `crear_presentacion` rehecha contra el `.pptx` real de claude.ai renderizado a PDF y mirado diapositiva a diapositiva, no solo desunzipeado: portada indigo con circulos que se salen del borde, titular en serif e **indice de secciones en fichas**; el contenido pasa a **fondo blanco** con los puntos como **tarjetas en columnas**, cada una con insignia redonda numerada de color rotativo (indigo/naranja/verde), mini-titulo en serif y su texto; y una franja oscura de cierre (`cierre`) con la conclusion de la diapositiva
- [x] Arreglado el solape de la portada: con un titulo de dos lineas, la barra de acento y el subtitulo se pintaban **encima del texto**. La caja del titulo termina ahora antes de donde empieza lo de debajo y el cuerpo encoge si el titular es largo — se veia al renderizar, no leyendo el codigo
- [x] `crear_hoja_calculo` rehecha contra un `.xlsx` real de claude.ai leido celda a celda con ExcelJS (relleno, fuente, borde, formato y vistas de cada una): bloque de titulo con subtitulo y leyenda, cabecera azul marino, **celdas de entrada en amarillo con texto azul frente a las calculadas**, fila de totales con fondo azul claro y filete superior, bloque de "Notas y supuestos" al pie, formatos con seccion de negativos y de cero (`#,##0.00 €;(#,##0.00 €);-`) y **paneles congelados** en la cabecera y la primera columna
- [x] Las formulas se trasladan solas a la fila donde acaba la tabla: el bloque de titulo la baja cinco filas, asi que `SUM(B2:B7)` escrito por el modelo sumaba el hueco en blanco de encima y daba un total **silenciosamente equivocado** (75.000 € en vez de 123.000 €). Cazado renderizando el archivo y sumando a mano. El modelo sigue escribiendo como si la cabecera estuviera en la fila 1, que es lo natural, y `shiftFormulaRows` ajusta las referencias respetando los tramos entre comillas
- [x] HTML comparado igual que los tres formatos de Office, con el mismo encargo en claude.ai y en NovaChat (una tostadora de cafe de especialidad). Aqui no hay herramienta que reescribir — el modelo escribe el HTML y `ArtifactPane` lo renderiza — asi que lo que se rehizo fue la skill `diseno-web`, que era solo una lista de prohibiciones, para que ademas explique el metodo: paleta sacada del significado del nombre y no de la categoria, un elemento firma en SVG que sea del oficio y trabaje dos veces, una sola accion principal, movil como rediseno, y marcar como muestra los datos inventados
- [x] Verificado en produccion, no supuesto: con la skill nueva NovaChat razona "Torrente es agua que corre" y saca una paleta de pizarra mojada y verde-agua con ambar solo donde hay calor real, dibuja **la curva de tueste en SVG** con el primer crack marcado y la reutiliza para organizar los pasos del proceso, empareja una serif de titulares con una sans de datos, deja un unico boton solido, y cierra listando que precios, telefono y horarios son de muestra. Las fuentes de Google Fonts cargan bien dentro del iframe con sandbox
- [x] Reintento forzado cuando el modelo se queda a medias: los modelos pequenos del router cargan la skill del documento, anuncian "voy a generar la presentacion" y **terminan el turno sin llamar a la herramienta** (reproducido tres veces seguidas en produccion). Ahora, si en ese turno se cargo una skill de documento y no salio ningun archivo, se repite la vuelta con `tool_choice: "required"` — una sola vez, y solo con esa senal, para no forzar herramientas en una conversacion normal
- [x] Arreglada la contradiccion que hacia que la presentacion se parase a preguntar: la skill `pptx` decia "no inventes cifras" para el grafico justo donde `<documents>` dice que no hay que pararse. Ahora: si te dieron las cifras usa las suyas, si no tira de un dato publico citando la fuente, y si tampoco lo hay pon cifras de ejemplo avisando — pero nunca pares la presentacion para pedirlas
- [x] Escritura suavizada: el router entrega los tokens a rafagas, y pintar en cada token era ademas cuadratico (`Markdown` reparsea el mensaje entero cada vez, asi que cuanto mas largo mas caro cada token) — de ahi que saliera "lento y a trompicones". Los deltas se acumulan y se vuelcan por fotograma drenando una fraccion de lo pendiente: una rafaga se reparte en unos pocos fotogramas, un goteo lento sale igual, y los repintados quedan acotados a los del monitor
- [x] Bloques de codigo de mas de 12 lineas plegados por defecto, con una cabecera que dice cuantas lineas son y los despliega — una pagina web entera son cientos de lineas que habia que pasar en rueda para llegar a lo que el mensaje dice despues
- [x] La aplicacion no se duerme: workflow `keepalive` que hace ping cada diez minutos a `/api/health` (ruta nueva, sin sesion ni base de datos, para que el ping no gaste conexiones). En el plan gratuito de Render el servicio se suspende a los quince minutos y la siguiente visita pagaba casi un minuto de arranque en frio
- [x] Repertorio de maquetas de diapositiva, porque con una sola la baraja se leia como una plantilla rellenada aunque cada pagina estuviera bien dibujada: `proceso` (tarjetas encadenadas con flechas), `comparacion` (dos columnas enfrentadas con banda de color), `seccion` (separador oscuro con el numero grande), `cita` (frase a pagina completa en oscuro), mas `destacado` (una cifra enorme en su panel), `callout` (caja con insignia bajo el titulo) y `etiqueta` por punto (pildora de color). El .pptx real de claude.ai cambia de forma casi en cada pagina y eso es lo que hace que se siga
- [x] Las medidas de la tarjeta se calculan contra su alto real: con un callout o un dato destacado encima las tarjetas quedan bajas, y con medidas fijas el texto se metia **debajo de la pildora**. Ahora el titulo encoge y la pildora se mueve junto a la insignia cuando no cabe al pie — visto renderizando, no leyendo el codigo
- [x] Cuando el modelo se salta la herramienta, se le vuelve a preguntar **dandole una salida**, no clasificando el mensaje por palabras: el reintento va con `tool_choice: "required"` y con una herramienta `sin_herramienta` en la lista para que pueda decir "mi respuesta ya estaba completa". Decide el modelo, que es quien entiende la peticion. Una lista de palabras clave fallaria con "resume el informe que te pase" y con cualquier frase que no estuviera en ella
- [x] Se dispara con dos senales estructurales, no de contenido: que hubiera cargado una skill de documento (iba a generar y se quedo a medias) o que haya soltado una respuesta larga sin usar nada — las dos formas en que se salta la herramienta, ambas reproducidas en produccion. Una contestacion corta de chat no entra, asi que hablar normal no paga ninguna llamada de mas
- [x] Boton de "Reintentar" bajo **cada** respuesta, no solo la ultima: se busca por `reply_to` el mensaje al que contestaba, con caida al ultimo mensaje de usuario anterior para las respuestas viejas que no lo tienen guardado
- [x] **Artefactos**: galeria con todo lo generado (Word, PowerPoint, Excel y paginas), con la vista previa real de cada uno como miniatura — dentro de un iframe con sandbox y sin `allow-same-origin`, porque ese HTML lo escribio un modelo. Entre cinco presentaciones lo que las distingue es como se ven, no el nombre del archivo
- [x] Los archivos se guardan de verdad en Postgres (tabla `artifacts`, con sus bytes) en vez de vivir treinta minutos en memoria: antes volver al dia siguiente a por el .pptx era imposible, y una galeria habria listado tarjetas que ya no se pueden descargar. El almacen en memoria sigue delante como cache, y `/api/files/[id]` cae a la base de datos cuando el archivo ya no esta ahi — el id es el mismo en los dos sitios, asi que el enlace de descarga vale igual recien generado que meses despues
- [x] Investigado clicando en claude.ai antes de diseñar: sus Artefactos son solo paginas HTML (los .docx y .pptx generados **no** salen ahi). El de NovaChat lista tambien los documentos de Office, que es lo que se pierde de verdad cuando caduca
- [x] **Proyectos**: carpeta de conversaciones con instrucciones propias y un contexto de notas que se le da al modelo en cada chat de dentro (tablas `projects` y `project_docs`). El contexto va marcado como material del usuario y no como ordenes: si dentro hay una frase que parece una instruccion, no se obedece por estar ahi. Borrar un proyecto **no** borra sus conversaciones, solo las saca
- [x] **Personalizar**: como quieres que te llame, a que te dedicas, instrucciones permanentes y movimiento reducido. Van en un bloque `<persona>` **aparte del prompt de sistema**, para que cambiar el prompt por probar algo no te borre el nombre ni las preferencias
- [x] **Programado**: un encargo y su horario; a su hora se abre una conversacion nueva con el y queda en el historial. Con herramientas, via un bucle propio sin streaming (`completeRound`), porque un resumen diario sin busqueda web no sirve de nada
- [x] El disparador de las tareas es externo (`.github/workflows/tasks.yml`, cada cuarto de hora con un secreto compartido) y no un temporizador dentro de la aplicacion: la instancia gratuita de Render se suspende sin trafico, asi que un `setInterval` dejaria de existir justo cuando toca ejecutar
- [x] La paleta del `.pptx` la elige el modelo, no esta escrita en el codigo: antes eran siempre los mismos indigo, naranja y verde y los mismos dos circulos, asi que por bien maquetada que estuviera **rellenaba una plantilla en vez de diseñar** — el mismo error que la skill de web ya tenia corregido. Ahora `tema` lleva fondo, acentos, tratamiento de portada (`circulos`, `diagonal`, `lineas`, `arco`, `limpia`) y familia de titulares, y la skill le dice que saque el color del significado del tema y no de la categoria
- [x] Lo que **no** decide el modelo es el contraste: la portada va siempre oscura con texto claro y el contenido sobre blanco, porque de eso depende que se lea proyectado. Un `fondo` claro se oscurece solo en vez de rechazarlo, y los textos claros se calculan mezclando con el propio fondo para que la portada se vea de una pieza
- [x] Herramientas siempre activas: no hay interruptor que las apague, ni en el cliente ni en el servidor — `availableTools` se calcula siempre, no depende de un flag `useTools` que ya no existe
- [x] Ventana de claves cifradas (AES-256-GCM con `SECRETS_KEY`)
- [x] Traza de herramientas persistida por mensaje (columna `trace` jsonb), sobrevive a recargar
- [x] Tarjeta de archivo descargable, servida desde `/api/files/[id]` con caducidad de 30 min, sin tocar disco
- [x] Reintento sin herramientas cuando el modelo elegido no las admite (evita el error 400)
- [x] Paridad visual con claude.ai (investigado clicando en vivo, no leído): aviso "en curso" con cronómetro real en una sola línea (antes decía "Trabajando" a secas); documentos (docx/pptx/xlsx) generan una vista previa en HTML que se abre sola en el panel de artefactos al terminar, en vez de solo una tarjeta de descarga; usar una skill enseña su nombre como enlace que abre el contenido real de la skill en el mismo panel
- [x] Comando de barra ("/") en el redactor: escribir "/" y el nombre filtra las skills instaladas y al elegir una rellena "Usa la skill X para: ", igual que el selector "/skill-creator" de claude.ai

## Interfaz

- [x] Tema oscuro, un único acento sólido (rojo de competición), sin degradados
- [x] Esquinas biseladas en vez de redondeadas; botones con desplazamiento al pulsar
- [x] Tipografía Rajdhani (interfaz) + JetBrains Mono (datos), autoalojadas con `next/font`
- [x] Logo y favicon nuevos: roundel hexagonal con doble chevron, sin degradado ni sparkle
- [x] Login y registro, con primera cuenta detectada
- [x] Barra lateral: agrupado por fecha, fijadas, renombrar, borrar, exportar
- [x] Markdown con código resaltado y copiar por bloque
- [x] Streaming con botón de detener
- [x] Razonamiento plegable para modelos que lo devuelven
- [x] Redactor: Enter envía, Shift+Enter salta, altura automática
- [x] Adjuntar archivos de texto, arrastrar y pegar
- [x] Dictado por voz donde el navegador lo soporta
- [x] Reintentar: guarda la respuesta anterior como versión navegable ("‹ 1/2 ›"), no la pierde
- [x] Editar mensaje propio: borra de verdad en el servidor lo que venía después (antes solo se recortaba en el cliente y reaparecía duplicado al recargar)
- [x] Ajustes: prompt, presets, temperatura
- [x] Responsive con barra lateral deslizante
- [x] Estado vacío con saludo según la hora y sugerencias
- [x] Pie del redactor avisa de verificar fuentes tras una búsqueda web

## Paridad con claude.ai (investigado en vivo)

- [x] Ocultar y mostrar barra lateral
- [x] Buscar en títulos y contenido, con flechas y Enter
- [x] Menú de usuario
- [x] Modo incógnito que no toca la base de datos
- [x] Panel de artefactos con iframe aislado, vista previa y descarga
- [x] Saludo según la hora
- [x] Traza de herramientas colapsada/expandible al estilo "Ejecutó N acciones"
- [x] Generación de documentos con tarjeta de archivo descargable
- [x] Proyectos, entendidos creando uno de verdad en claude.ai antes de construirlo: no son una etiqueta que se le pone a una conversacion ya empezada, sino **un sitio desde el que se chatea**. Tienen su propio redactor, sus instrucciones y su contexto en el lateral derecho, y las conversaciones nacen dentro ya con todo puesto. La primera version (etiqueta + boton "mover") estaba mal y se tiro entera
- [x] Artefactos: galeria de todo lo generado, con miniatura real en iframe y descarga
- [x] Programado: tareas que se repiten (diaria/laborables/semanal), disparadas desde fuera por GitHub Actions porque el plan gratuito de Render duerme el servicio
- [x] Personalizar: el antiguo modal de Ajustes, con el perfil que se inyecta como `<persona>` aparte del prompt de sistema
- [x] Los cuatro sitios (Proyectos, Artefactos, Programado, Personalizar) van arriba en la barra lateral, donde claude.ai los tiene, no escondidos en el menu del pie. La lista de proyectos cuelga de su cabecera con el "+" al lado, para verlos sin entrar a ningun sitio
- [ ] Conectores externos (Gmail, Drive, Slack...) — fuera de alcance por ahora
- [ ] Redimensionar la barra lateral arrastrando — pendiente
- [x] Interruptor de esfuerzo de razonamiento, al estilo del selector "Esfuerzo" de claude.ai (Automático/Bajo/Medio/Alto), dentro del modal de modelo. Investigado el backend propio (freellmapi/`server/src/lib/sampling-params.ts`) para confirmar que admite un `reasoning_effort` real por peticion antes de construir la interfaz — no es decorativo, se manda al router y se persiste por conversación (columna `reasoning_effort`)
- [x] Panel de atajos de teclado (abierto con `?`/`Ctrl+/` o desde el menú de usuario)
- [x] Esc detiene la respuesta en curso (antes no hacía nada si no había ningún menú abierto)
- [x] Iconos en vez de texto donde claude.ai usa icono: "Adjuntar"/"Dictar" del redactor pasan a clip y micrófono (`icons.tsx`, `.act.icon-only`)
- [x] Lista de conversaciones y mensajes en caché de `localStorage` (`localCache.ts`): se pintan al instante al abrir la app o cambiar de chat con lo que ya había en el navegador, y se corrigen en cuanto llega la respuesta real del servidor — sin nada que hacer si es el único dispositivo
- [x] Editar un mensaje es igual de instantáneo: el truncado en el servidor se dispara en paralelo al reenvío, no antes (con el cuidado de no dejar que la inserción del mensaje nuevo adelante al borrado del historial viejo)
- [x] Skills incorporadas para docx/pptx/xlsx/diseño web (`skills.ts`), que el modelo lee con `usar_skill` antes de llamar a `crear_documento_word`/`crear_presentacion`/`crear_hoja_calculo` — igual que claude.ai carga su skill antes de generar cada tipo de archivo. Escritas desde cero y adaptadas a lo que las herramientas de aquí saben producir de verdad (Markdown sencillo, viñetas, celdas sin fórmulas), no al flujo con Python/LibreOffice de las skills de terceros investigadas (`appautomaton/document-SKILLs`, MIT) ni a las propias de Anthropic (propietarias). `diseño-web` sí es adaptación directa de `frontend-design` (Apache 2.0, `anthropics/skills`)
- [x] Leer en voz alta (Web Speech API, `SpeechSynthesisUtterance`) en cada respuesta, junto a Copiar/Reintentar — el complemento simétrico del dictado que ya tenía el redactor, con el markdown limpiado antes de leerlo
- [x] Marca de tiempo relativa ("hace 12 h") junto a las acciones de cada mensaje, propio y de NovaChat — no hacía falta ningún campo nuevo, `created_at` ya llegaba del servidor y solo faltaba pintarlo
- [x] Descartado a propósito: anuncios, patrocinados, Cowork

## Lo que se ha arreglado probandolo en produccion, no leyendo el codigo

- [x] Adjuntar archivos en el redactor: el texto lo saca el servidor (`/api/attachments`), no el navegador. Antes se leian con `file.text()` y por eso solo colaban los de texto plano — de ahi el "no me deja subir archivos". Mismo extractor que el contexto de los proyectos: PDF, Word, PowerPoint, Excel, OpenDocument, texto y codigo
- [x] Bug encontrado en produccion, invisible en local: **todos** los PDF fallaban con un "no se ha podido leer" que no decia nada, mientras en local se leia cualquiera. Dos causas encadenadas — webpack empaquetaba pdf.js y le rompia la resolucion de sus piezas, y el rastreo de ficheros de Next no copiaba `pdf.worker.mjs` porque pdf.js no lo importa, lo carga por ruta. Arreglado marcandolo como paquete externo y añadiendo el worker al rastreo
- [x] De paso, el aviso de error lleva ahora el motivo real y el servidor loguea la excepcion: sin eso este fallo era literalmente invisible
- [x] Tope por archivo a 25 MB en proyectos y adjuntos: lo caro no son los megas —un PDF de apuntes son escaneos— sino el texto, que ya se recorta aparte
- [x] Un `.docx` de veinte mil caracteres se volcaba entero en la burbuja del hilo y escondia la pregunta. Ahora cada adjunto es una ficha con nombre y tamaño que se abre si se quiere leer
- [x] La skill se cargaba entera en **cada** mensaje: 6.251 caracteres del skill de presentaciones repetidos por turno, sin tope. Ahora se inyecta una sola vez por conversacion (`<skills_cargadas>`), leyendo la traza de los mensajes anteriores
- [x] Bug encontrado en produccion: el boton de ocultar la barra lateral rompia la pantalla entera — `display:none` sacaba la barra de la rejilla y `.main` caia en la columna de 0px. Reproducido en produccion antes de tocar nada
- [x] Tablas del chat copiables como celdas: se escribe `text/html` y `text/plain` a la vez en el portapapeles, que es como Excel recibe celdas de verdad y no una linea de texto
- [x] Bloques de codigo plegados con su interruptor, y el streaming deja de reparsear todo el markdown en cada trozo (cabecera memoizada + cola en texto plano)

## Simplificación por petición directa del usuario (no exploración de claude.ai)

- [x] Se quita el selector de modelo por completo: `ModelPicker.tsx` borrado, el campo "Modelo por defecto" de Ajustes fuera, `/api/models` ya no se consulta desde el cliente. Nova enruta siempre en automático (`model: 'auto'` fijo, ya no es estado). El selector de esfuerzo de razonamiento se muda a un componente propio y más ligero (`EffortPicker.tsx`, un desplegable de 4 opciones con `.pop`, no un modal de 248 modelos)
- [x] Nueva sección `<documents>` en el prompt de sistema: crear un documento/presentación/hoja de cálculo llama a la herramienta en la misma respuesta — nunca pregunta "¿lo quieres en un archivo?" ni ofrece un script como sustituto, motivado por verlo pasar de verdad en una respuesta real

## Verificado en local, no solo compilado

- [x] Registro, sesión y persistencia contra Supabase
- [x] Streaming real contra FreeLLMAPI, con razonamiento
- [x] Autotítulo generado
- [x] 248 modelos cargados
- [x] Los tres tipos de documento (docx/pptx/xlsx) se generan, descargan y son archivos Office válidos de verdad (verificado abriendo el zip interno)
- [x] Búsqueda web e imágenes con claves reales (Tavily, Pexels)
- [x] Traza persistida y releída correctamente tras recargar la conversación
- [x] Bug encontrado y corregido en el propio desarrollo: `trace` se guardaba doblemente serializado (`JSON.stringify` en vez de `sql.json()`), lo que rompía la interfaz al recargar — reproducido, arreglado y vuelto a verificar
- [x] Bug encontrado y corregido: reintentar/editar solo truncaba el array del cliente, sin borrar en la base de datos — las respuestas viejas reaparecían duplicadas al recargar. Arreglado con versionado real (`reply_to`/`version_index`) y un borrado server-side de verdad
- [x] Bug encontrado y corregido (condición de carrera): abrir la última conversación al cargar la página podía resolver tarde y pisar una conversación nueva creada mientras tanto — guardia con `desiredConversationRef`
- [x] Bug encontrado y corregido (clave de React duplicada): la burbuja de usuario y el grupo de respuestas de un mismo turno compartían la misma `key` en el hilo (ambas derivan del mismo id), lo que dejaba nodos fantasma en el DOM tras reintentar/editar aunque el estado y la base de datos fueran correctos
- [x] Cache optimista verificada de verdad, no solo leída: al recargar la página, la conversación con su respuesta larga (bloques de código incluidos) se pinta completa en menos de 2 s, con el scroll ya en el sitio correcto — no una pantalla en blanco esperando a la red
- [x] Editar un mensaje verificado en vivo: el mensaje cambia, la respuesta vieja desaparece y empieza a generar de nuevo en la misma captura de pantalla que sigue al clic, antes de que la petición de red al servidor pudiera haber terminado
- [x] Catálogo de skills (`docx`/`pptx`/`xlsx`/`diseño-web`) verificado por `GET /api/skills` tanto en local como ya desplegado en producción
- [x] Selector de esfuerzo verificado de punta a punta en vivo: se elige "Alto" en el modal, sobrevive a recargar la página, y el `fetch` real a `/api/chat` lleva `"reasoningEffort":"high"` en el cuerpo (interceptado con `window.fetch` desde la consola) — no solo se ve bien, hace lo que dice
- [x] Leer en voz alta verificado en vivo: el botón cambia a "Detener" con el icono tachado mientras habla, sin errores nuevos en consola (el único warning es la extensión de Chrome del propio navegador, ya identificado antes), y la marca de tiempo aparece junto a las acciones tanto en local como ya desplegado en producción
- [x] Límite del "Nova Auto" gratuito, encontrado antes: a veces acepta la lista de herramientas sin llamarlas, respondiendo en texto plano con un script de Python en vez de invocar la herramienta real. Confirmado que no es un límite fijo — en una prueba posterior, con las herramientas ya siempre activas y el nuevo texto del prompt de sistema, "Nova Auto" sí llamó `crear_presentacion` (y por separado `buscar_historial`) de punta a punta sin pedir permiso ni ofrecer un script, generando el archivo real con notas de orador y todo — pero sigue siendo un router gratuito de terceros, así que el comportamiento puede variar de una petición a otra según qué modelo del panel esté detrás en ese momento
- [x] `buscar_historial` verificado en vivo con dos casos reales: una búsqueda con resultados (mientras la conversación de origen seguía existiendo, encontró el título correcto y el enlace abrió esa conversación) y una sin resultados (tras borrar la conversación de origen, contestó "no he encontrado nada" en vez de inventar algo)
- [x] Bug encontrado y corregido en el propio desarrollo: la rama de "sin resultados" de `buscar_historial` no incluía el campo `ui`, así que la traza caía al renderizado genérico en vez de mostrar "sin resultados" con la consulta entre comillas — reproducido en vivo (`"dinosaurios" ` sin el sufijo esperado), arreglado, y vuelto a verificar (`"dinosaurios" — sin resultados`)
- [x] `crear_presentacion` rediseñada verificada en vivo: el panel de artefactos mostró las tarjetas numeradas (mini-título en negrita + texto) y el eyebrow de sección tal como se diseñaron, y la respuesta confirmó que las notas del orador se guardaron en el panel de notas real de PowerPoint
- [x] Quitar el selector de modelo no rompió nada: verificado que `EffortPicker` sigue funcionando solo (persiste al recargar, se manda en el `fetch`), que Ajustes guarda sin el campo de modelo por defecto, y que el catálogo de Skills sigue abriendo bien sin la clase CSS que por error se había borrado a la vez que `ModelPicker` (`.model-group`, compartida con `SkillsModal`/`KeysModal`/`KeyboardShortcutsModal` — encontrado y corregido en el propio desarrollo antes de desplegar)

## Despliegue

- [x] Dockerfile multifase, salida standalone, usuario sin privilegios
- [x] Workflow hacia GHCR
- [x] Variables en Render, renombrando las que ya tenían el valor secreto
- [x] Imagen compilada y servicio en marcha (`ghcr.io/vortexjer/novachat-app`)
- [x] Verificación en vivo

## Pendiente de limpieza

- [ ] Borrar `C:\Users\escri\Downloads\mis-api-keys.csv` (ocho claves en texto plano)
- [ ] Borrar `C:\Users\escri\freellm-stack.secrets.txt`
- [ ] Revocar la OAuth App de GitHub, que ya no se usa
- [ ] Borrar las tablas de LobeChat del esquema `public` de Supabase
