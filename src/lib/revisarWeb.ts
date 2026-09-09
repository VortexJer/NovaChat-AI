/**
 * Revisor de paginas antes de entregarlas.
 *
 * Nace de una pagina que parecia impecable leyendo el codigo y estaba rota en
 * cuanto se dibujaba. El fallo grande era una linea:
 *
 *   header { position: fixed; top: 0 }
 *
 * Parece que apunta a la barra de navegacion. Pero la pagina tenia cuatro
 * <header> — el del menu y el de cada seccion — y los clavo los cuatro
 * arriba, con el mismo z-index, unos encima de otros: quince solapamientos de
 * texto y la navegacion entera tapada al 100%. Ninguna lectura del codigo lo
 * habria cazado; abrir la pagina, si.
 *
 * Todo lo de aqui es estatico y determinista: se comprueba sobre el texto del
 * HTML, sin navegador. No cubre lo estetico ni mide solapamientos de verdad
 * —para eso hay que dibujar la pagina— pero si caza la clase de fallo que se
 * cuela por descuido y salta a la vista en cuanto se abre.
 */

export type Aviso = { grave: boolean; que: string };

/** Etiquetas de las que una pagina normal tiene mas de una. */
const ESTRUCTURALES = ['header', 'section', 'nav', 'article', 'aside', 'footer', 'main'];

export function revisarHtml(html: string): Aviso[] {
  const avisos: Aviso[] = [];
  // Los comentarios se quitan antes de nada: el selector suele venir detras de
  // uno ("/* Header */\n header { ... }") y sin quitarlos la regla de abajo no
  // reconoce que la etiqueta empieza una declaracion nueva.
  const css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)]
    .map((m) => m[1])
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, ' ');

  // 1. Reglas que colocan aplicadas a una etiqueta desnuda.
  for (const tag of ESTRUCTURALES) {
    const cuantos = (html.match(new RegExp('<' + tag + '[\\s>]', 'gi')) || []).length;
    if (cuantos < 2) continue;

    // El selector tiene que ser la etiqueta sola: al principio de la regla o
    // detras de una llave, nunca precedida de un punto (.mi-header) ni de un
    // guion (.dish-header), que son clases distintas y perfectamente validas.
    const regla = new RegExp('(?:^|[{}])\\s*' + tag + '\\s*\\{([^}]*)\\}', 'gi');
    for (const m of css.matchAll(regla)) {
      const pos = m[1].match(/position\s*:\s*(fixed|absolute|sticky)/i);
      if (!pos) continue;
      avisos.push({
        grave: true,
        que:
          `La regla "${tag} { position: ${pos[1]} }" apunta a la etiqueta desnuda, y esta pagina tiene ${cuantos} <${tag}>. ` +
          `Los coloca todos, no solo el que querias: se apilan unos sobre otros y tapan lo que haya debajo. Ponle una clase.`,
      });
    }
  }

  // 2. Anclas que no llevan a ninguna parte.
  const ids = new Set([...html.matchAll(/id="([^"]+)"/gi)].map((m) => m[1]));
  const rotas = new Set<string>();
  for (const m of html.matchAll(/href="#([^"]+)"/gi)) if (!ids.has(m[1])) rotas.add(m[1]);
  if (rotas.size) {
    avisos.push({
      grave: true,
      que: `Enlaces rotos: no existe ningun id para ${[...rotas].map((r) => '#' + r).join(', ')}.`,
    });
  }

  // 3. Enlaces que apuntan a la nada.
  const muertos = [...html.matchAll(/<a[^>]*href="(?:#|javascript:void\(0\))"[^>]*>([\s\S]*?)<\/a>/gi)]
    .map((m) => m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
    .filter((t) => t && t.length < 40);
  if (muertos.length) {
    avisos.push({
      grave: false,
      que:
        `href="#" no lleva a ningun sitio, y esta en: ${muertos.slice(0, 4).join(', ')}. ` +
        `Si alguno es un boton de accion, ponle un tel:, un mailto:, una URL o un ancla que exista.`,
    });
  }

  // 4. Lo mismo contado dos veces, normalmente con datos distintos.
  const titulos = [...html.matchAll(/<h[234][^>]*>([\s\S]*?)<\/h[234]>/gi)]
    .map((m) => m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
    .filter((t) => t && t.length < 50);
  const veces = new Map<string, number>();
  for (const t of titulos) veces.set(t.toLowerCase(), (veces.get(t.toLowerCase()) ?? 0) + 1);
  const repes = [...veces].filter(([, n]) => n > 1).map(([t]) => t);
  if (repes.length) {
    avisos.push({
      grave: false,
      que:
        `Sale mas de una vez, y en secciones distintas suele venir con datos distintos: ${repes.slice(0, 5).join(', ')}. ` +
        `Quien lo lee no sabe cual vale.`,
    });
  }

  // 5. Cifras inventadas marcadas a medias.
  const precios = (html.match(/\d+[.,]\d{2}\s*€|€\s*\d+[.,]\d{2}/g) || []).length;
  const marcas = (html.match(/MUESTRA/gi) || []).length;
  if (precios >= 3 && marcas > 0 && marcas < precios / 2) {
    avisos.push({
      grave: false,
      que:
        `Hay ${precios} precios y solo ${marcas} marca(s) de muestra. Marcar uno y dejar el resto sin marcar ` +
        `es peor que no marcar ninguno: da a entender que los demas son reales.`,
    });
  }

  // 6. Descuidos que no deberian llegar a entregarse.
  const sinAlt = [...html.matchAll(/<img[^>]*>/gi)].filter((m) => !/\salt=/i.test(m[0])).length;
  if (sinAlt) avisos.push({ grave: false, que: `${sinAlt} <img> sin alt.` });

  const h1 = (html.match(/<h1[\s>]/gi) || []).length;
  if (h1 !== 1) avisos.push({ grave: false, que: `Hay ${h1} <h1>; deberia haber exactamente uno.` });

  return avisos;
}
