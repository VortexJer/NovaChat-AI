'use client';

import { useMemo } from 'react';

import { Markdown } from './Markdown';

/**
 * El cuerpo del mensaje que se esta escribiendo.
 *
 * Renderizar el Markdown entero en cada actualizacion es cuadratico: el parser
 * vuelve a leer todo el mensaje cada vez, asi que cuanto mas largo va siendo,
 * mas cuesta cada trozo nuevo — y de ahi que la escritura fuera bien al
 * principio y a trompicones al final.
 *
 * Aqui el texto se parte por el ultimo salto de parrafo. Lo de arriba es la
 * parte que ya no va a cambiar, y va por `Markdown`, que esta memoizado: solo
 * se reparsea cuando se cierra un parrafo nuevo, no en cada fotograma. Lo de
 * abajo es el parrafo en curso y sale como texto plano, que no cuesta nada.
 *
 * El precio es que el ultimo parrafo no tiene formato hasta que se cierra —
 * una negrita a medias aparece con sus asteriscos durante un segundo. A cambio
 * la escritura va fluida en mensajes largos, que es donde se notaba.
 */
export function StreamingBody({ content }: { content: string }) {
  const [head, tail] = useMemo(() => {
    const cut = content.lastIndexOf('\n\n');
    if (cut === -1) return ['', content];
    return [content.slice(0, cut), content.slice(cut + 2)];
  }, [content]);

  return (
    <>
      {head && <Markdown>{head}</Markdown>}
      {tail && <p className="stream-tail">{tail}</p>}
    </>
  );
}
