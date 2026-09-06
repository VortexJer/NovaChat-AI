'use client';

import { useEffect } from 'react';

/**
 * Ajusta la aplicacion a lo que de verdad se ve en el movil.
 *
 * Dos problemas que el CSS solo no resuelve en iOS:
 *
 * **El teclado.** Al enfocar el redactor, Safari no encoge la ventana: la deja
 * igual y sube la pagina por encima del teclado. El resultado es que la
 * cabecera se va hacia arriba y el redactor queda tapado o a medias. `100dvh`
 * tampoco lo arregla, porque el alto "dinamico" cuenta la barra del navegador,
 * no el teclado. Lo unico que sabe cuanto queda visible es `visualViewport`, y
 * de ahi sale `--alto-visible`, que es lo que mide la aplicacion.
 *
 * **El zoom de dos dedos.** Con la aplicacion anclada a la pantalla completa,
 * un pellizco no amplia "un poco": desplaza todo y deja la interfaz corrida,
 * sin barra del navegador con la que volver. Se bloquea el gesto propio de
 * Safari (`gesturestart`) ademas de declararlo en el viewport, porque Safari
 * ignora `user-scalable=no` cuando se navega desde el navegador.
 *
 * Es una decision consciente para una aplicacion instalada, no un descuido: el
 * texto se puede seguir agrandando desde los ajustes del sistema, que es el
 * sitio donde de verdad se cambia el tamano de letra en iOS.
 */
export function MobileViewport() {
  useEffect(() => {
    const vv = window.visualViewport;

    const medir = () => {
      const alto = vv ? vv.height : window.innerHeight;
      document.documentElement.style.setProperty('--alto-visible', `${Math.round(alto)}px`);

      // Al abrirse el teclado, iOS deja la pagina desplazada hacia arriba: sin
      // esto la cabecera se queda fuera de la pantalla aunque la aplicacion ya
      // mida lo correcto.
      if (window.scrollY !== 0) window.scrollTo(0, 0);
    };

    medir();
    vv?.addEventListener('resize', medir);
    vv?.addEventListener('scroll', medir);
    window.addEventListener('orientationchange', medir);

    // Gestos de pellizco de Safari. `preventDefault` en el primero basta para
    // que no empiece el zoom.
    const sinZoom = (e: Event) => e.preventDefault();
    document.addEventListener('gesturestart', sinZoom);
    document.addEventListener('gesturechange', sinZoom);
    document.addEventListener('gestureend', sinZoom);

    return () => {
      vv?.removeEventListener('resize', medir);
      vv?.removeEventListener('scroll', medir);
      window.removeEventListener('orientationchange', medir);
      document.removeEventListener('gesturestart', sinZoom);
      document.removeEventListener('gesturechange', sinZoom);
      document.removeEventListener('gestureend', sinZoom);
    };
  }, []);

  return null;
}
