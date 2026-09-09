/**
 * Sustitutos para las APIs que el sandbox del visualizador deja inservibles.
 *
 * La vista previa corre con `allow-scripts` pero sin `allow-same-origin`, que
 * es lo que impide que el codigo generado se quite el sandbox y hable con la
 * API en nombre del usuario. El precio es que el iframe vive en un **origen
 * opaco**: `location.origin` vale "null" y el navegador lo trata como si fuera
 * un archivo abierto a doble clic.
 *
 * Medido con una sonda en el sandbox exacto del panel:
 *
 *   localStorage      SecurityError al LEER
 *   sessionStorage    SecurityError
 *   document.cookie   SecurityError al escribir
 *   history.pushState SecurityError
 *   serviceWorker     SecurityError
 *   URL relativa      TypeError (location.href es about:srcdoc)
 *
 * Lo que hace dano es el primero, y no por lo que se pierde sino por COMO se
 * pierde: `localStorage` no devuelve vacio, **lanza**. Una app que guarde
 * estado muere en su primera linea, antes de pintar nada, y lo que se ve es un
 * panel en blanco sin ninguna pista de por que.
 *
 * Esto no convierte el iframe en una web de verdad —sigue sin persistir entre
 * recargas y sin cookies reales— pero cambia "revienta" por "funciona y se
 * olvida al cerrar", que para una vista previa es exactamente lo que se quiere.
 * Arreglarlo del todo pide servir la vista desde OTRO origen, no un remiendo.
 *
 * Se inyecta antes que nada, y solo se activa si las APIs estan rotas de
 * verdad: si algun dia la vista se sirve desde su propio origen, este codigo
 * se aparta solo sin tener que acordarse de quitarlo.
 */
export const SANDBOX_SHIM = `
<script>
(function(){
  var roto = false;
  try { window.localStorage.getItem('x'); } catch (e) { roto = true; }
  if (!roto) return;

  function memoria(){
    var m = new Map();
    var api = {
      getItem: function(k){ return m.has(String(k)) ? m.get(String(k)) : null; },
      setItem: function(k,v){ m.set(String(k), String(v)); },
      removeItem: function(k){ m.delete(String(k)); },
      clear: function(){ m.clear(); },
      key: function(i){ var ks = Array.from(m.keys()); return i in ks ? ks[i] : null; }
    };
    Object.defineProperty(api, 'length', { get: function(){ return m.size; } });
    // Proxy y no un objeto pelado porque hay codigo que usa corchetes
    // (localStorage.tema) en vez de getItem, y con un objeto normal eso
    // guardaria la propiedad pero no contaria para length ni para key().
    return new Proxy(api, {
      get: function(t,p){ return p in t ? t[p] : (m.has(String(p)) ? m.get(String(p)) : undefined); },
      set: function(t,p,v){ if (p in t) { t[p] = v; } else { m.set(String(p), String(v)); } return true; },
      has: function(t,p){ return p in t || m.has(String(p)); },
      deleteProperty: function(t,p){ m.delete(String(p)); return true; }
    });
  }

  Object.defineProperty(window, 'localStorage',   { value: memoria(), configurable: true });
  Object.defineProperty(window, 'sessionStorage', { value: memoria(), configurable: true });

  var galletas = '';
  Object.defineProperty(document, 'cookie', {
    get: function(){ return galletas; },
    set: function(v){ galletas = galletas ? galletas + '; ' + v : String(v); },
    configurable: true
  });

  // Sin origen no se puede reescribir la barra de direcciones, y no hay barra
  // que reescribir. Se anulan en vez de dejarlas lanzar: una SPA con rutas
  // seguira funcionando, solo que sin cambiar una URL que nadie ve.
  history.pushState = function(){};
  history.replaceState = function(){};
})();
<\/script>
`;

/**
 * Mete el remiendo lo antes posible sin romper el documento.
 *
 * Delante del <!doctype> no puede ir: un script antes del doctype tira al
 * navegador a modo quirks y cambia el renderizado de toda la pagina, que es
 * peor que el problema que se venia a arreglar. El orden de preferencia es
 * justo despues de <head>, luego de <html>, luego del doctype, y solo si no
 * hay nada de eso se pone delante.
 */
export function conRemiendo(html: string): string {
  const tras = (re: RegExp): string | null => {
    const m = html.match(re);
    if (!m || m.index === undefined) return null;
    const corte = m.index + m[0].length;
    return html.slice(0, corte) + SANDBOX_SHIM + html.slice(corte);
  };
  return tras(/<head[^>]*>/i) ?? tras(/<html[^>]*>/i) ?? tras(/<!doctype[^>]*>/i) ?? SANDBOX_SHIM + html;
}
