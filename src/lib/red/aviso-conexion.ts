import { PALETA } from '@/lib/marca/paleta'

/**
 * Aviso de conexión fallida: ONE nunca se queda cargando para siempre ni en blanco.
 *
 * Nació el 2026-10-06 (capturas de Deisy, SOENA, Chrome/Windows con Claro/Telmex fijo): la
 * ruta de su ISP hacia Vercel cortaba chunks y streams RSC, y ONE se quedaba
 *   1. en `/negocios/[id]` con el shell pintado y el área de contenido en la animación de
 *      carga para siempre (el stream de la página nunca terminó);
 *   2. en `/login` en el splash con el nombre del espacio, sin formulario (React no hidrató);
 *   3. en `/tableros` en blanco.
 * La escalera de `auto-recarga.ts` solo actúa cuando React montó una pantalla de error: si la
 * red se corta ANTES de hidratar, o el stream se queda colgado sin error, nadie la dispara.
 *
 * Tres piezas, ninguna depende de que baje un chunk de JS:
 *   - `ESTILO_AVISO_CONEXION`: CSS en línea del layout raíz. Un aviso que ya viene en el HTML
 *     (`AvisoConexionDiferido`) está oculto y aparece SOLO con una animación CSS de retardo
 *     `LIMITE_ESPERA_RUTA_MS`. Si la página llega antes, React quita el fallback y el aviso se
 *     va con él: no hay temporizador que cancelar.
 *   - `scriptAvisoConexion()`: script en línea del `<head>`. Si la app no hidrató en
 *     `LIMITE_HIDRATACION_MS` (o falló un chunk de `/_next/static/` antes de hidratar), pinta
 *     el aviso a pantalla completa con DOM puro. Además reporta cada aviso que aparece y
 *     atiende el botón Reintentar de los avisos que React no alcanzó a hidratar.
 *   - `marcarHidratada()`: lo llama el vigía del layout raíz al montar. Cancela el aviso de
 *     pantalla completa y, si ya estaba pintado (carga lenta pero exitosa), lo quita.
 *
 * El botón Reintentar es una recarga dura y borra la escalera de la ruta: un clic de la
 * persona no es un bucle. Nada de esto recarga solo.
 */

/** Texto del aviso. Aprobado por Mauricio el 2026-10-06 (no dice "proceso"). */
export const AVISO_CONEXION = {
  titulo: 'No pudimos conectar con ONE',
  cuerpo: 'Puede ser tu conexión a internet. Si sigue pasando, prueba desde otra red o con los datos del celular.',
  boton: 'Reintentar',
} as const

/**
 * Sin hidratar a los 20 s: el aviso a pantalla completa. Holgado a propósito: una carga lenta
 * pero sana de Claro (771 KB de JS) cabe; y si hidrata después, el aviso se quita solo.
 */
export const LIMITE_HIDRATACION_MS = 20_000

/**
 * Animación de carga de una ruta (o de una navegación) a los 25 s: el aviso dentro del área
 * de contenido. Más largo que el de hidratación porque aquí el servidor sí puede estar
 * trabajando (Tableros llegó a tardar 10-15 s el 2026-10-03).
 */
export const LIMITE_ESPERA_RUTA_MS = 25_000

/** Tras un chunk que no bajó, cuánto esperar a que React igual hidrate antes de avisar. */
export const GRACIA_TRAS_CHUNK_MS = 3_000

/** Marca de la animación CSS que hace aparecer el aviso diferido (la escucha el script). */
export const ANIMACION_APARECER = 'one-aviso-conexion-aparecer'
/** Marca de la animación CSS que oculta la espera cuando aparece el aviso. */
export const ANIMACION_OCULTAR = 'one-aviso-conexion-ocultar'
/** Id del aviso a pantalla completa (lo pinta el script, lo quita `marcarHidratada`). */
export const ID_AVISO_PANTALLA = 'one-aviso-conexion'
/** Atributo del botón Reintentar. Valor = destino a cargar; vacío = la página actual. */
export const ATRIBUTO_REINTENTAR = 'data-one-reintentar'
/** Atributo del aviso diferido: su valor es la causa que se reporta. */
export const ATRIBUTO_CAUSA = 'data-one-aviso-causa'

/** Por qué apareció el aviso: viaja en el reporte `aviso-conexion-mostrado`. */
export type CausaAvisoConexion =
  | 'sin-hidratar'
  | 'chunk'
  | 'espera-ruta'
  | 'navegacion'
  | 'agotado'

export const CAUSAS_AVISO_CONEXION = ['sin-hidratar', 'chunk', 'espera-ruta', 'navegacion', 'agotado'] as const

/** Mensaje del reporte: con él se cuentan los avisos en los logs `[error-cliente]`. */
export const MENSAJE_REPORTE_AVISO = 'aviso-conexion-mostrado'

/** Prefijo de la escalera en sessionStorage (igual que `auto-recarga.ts`). */
const PREFIJO_ESCALERA = 'metrik:auto-recarga:'

/**
 * El CSS en línea. `visibility` y no `display`: el aviso diferido y la espera comparten
 * celda de una grilla (se apilan), y animar `visibility` es discreto en todos los navegadores.
 * Una animación CSS pisa el `style` en línea, así que el estado inicial va en el atributo
 * `style` del componente (oculto aunque esta hoja no llegara) y la animación lo cambia.
 */
export const ESTILO_AVISO_CONEXION =
  `@keyframes ${ANIMACION_APARECER}{from,to{visibility:visible}}` +
  `@keyframes ${ANIMACION_OCULTAR}{from,to{visibility:hidden}}`

/** El `animation` del aviso diferido y de lo que tapa, con el retardo dado. */
export function animacionAparecer(retardoMs: number): string {
  return `${ANIMACION_APARECER} 1ms linear ${retardoMs}ms forwards`
}
export function animacionOcultar(retardoMs: number): string {
  return `${ANIMACION_OCULTAR} 1ms linear ${retardoMs}ms forwards`
}

interface VentanaAviso {
  __oneHidratada?: boolean
  __oneAvisoConexion?: { hidratada?: () => void }
}

/**
 * Lo llama el vigía del layout raíz al montar: React ya manda. Cancela el aviso a pantalla
 * completa y lo quita si ya estaba pintado. Nunca lanza.
 */
export function marcarHidratada(): void {
  try {
    if (typeof window === 'undefined') return
    const w = window as unknown as VentanaAviso
    w.__oneHidratada = true
    w.__oneAvisoConexion?.hidratada?.()
  } catch {
    // El aviso es lo de menos.
  }
}

/** Borra la escalera de la ruta: el clic de la persona no es un bucle (igual que `olvidarRecargas`). */
export function claveEscalera(pathname: string): string {
  return PREFIJO_ESCALERA + (pathname || '/')
}

/**
 * El script en línea del `<head>`. JavaScript sin transpilar (ES2017, lo que entienden
 * Chrome, Safari y Firefox de hace años) y sin dependencias: corre antes que cualquier chunk.
 *
 * - `version`: id del deployment, para el reporte (mismo valor que `NEXT_DEPLOYMENT_ID`).
 *
 * Va como `<script type="module" async>` (ver `app/layout.tsx`): asi no espera a las hojas de
 * estilo de Next. Y antes de pintar el aviso QUITA las hojas que siguen colgadas (`sheet`
 * nulo): una hoja pendiente en el `<head>` bloquea el pintado de toda la pagina, que es la
 * pantalla en blanco de `/tableros`. Sin quitarlas, el aviso existiria en el DOM y nadie lo
 * veria. Las hojas que si bajaron se quedan, y las quitadas vuelven al `<head>` si React
 * termina hidratando (carga lenta pero exitosa). Codigo valido en modo estricto (los modulos lo son).
 *
 * El reporte se anota en la cola de `[error-cliente]` (`errores-cliente/cola.ts`, mismo
 * formato) y sale por `fetch` con `keepalive`; si la red no lo deja salir, la carga
 * siguiente lo reenvía. Tope de 5 avisos reportados por carga.
 */
export function scriptAvisoConexion(version: string): string {
  const c = {
    v: version,
    lh: LIMITE_HIDRATACION_MS,
    gc: GRACIA_TRAS_CHUNK_MS,
    an: ANIMACION_APARECER,
    id: ID_AVISO_PANTALLA,
    ar: ATRIBUTO_REINTENTAR,
    ac: ATRIBUTO_CAUSA,
    pe: PREFIJO_ESCALERA,
    m: MENSAJE_REPORTE_AVISO,
    t: AVISO_CONEXION.titulo,
    b: AVISO_CONEXION.cuerpo,
    bt: AVISO_CONEXION.boton,
    ct: PALETA.tinta,
    ca: PALETA.acento,
  }
  // JSON.stringify deja los textos escapados; `<` se escapa aparte para no cerrar el <script>.
  const conf = JSON.stringify(c).replace(/</g, '\\u003c')
  return `(function(){try{
var C=${conf},w=window,d=document,t0=Date.now(),enviados=0;
if(w.__oneAvisoConexion)return;
var api=w.__oneAvisoConexion={},quitadas=[];
function nid(){try{if(w.crypto&&crypto.randomUUID)return crypto.randomUUID()}catch(e){}return Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,10)}
function reportar(causa){try{
if(enviados>=5)return;enviados++;
var id=nid(),cu={message:C.m,name:'AvisoConexion',causa:causa,id:id,pathname:location.pathname,host:location.host,version:C.v,userAgent:navigator.userAgent,enLinea:navigator.onLine!==false,segDesdeCarga:Math.round((Date.now()-t0)/1000)};
var K='metrik:errores-cliente:cola',ls=null;try{ls=w.localStorage}catch(e){}
if(ls){try{var l=JSON.parse(ls.getItem(K)||'[]');if(!Array.isArray(l))l=[];l.push({id:id,creado:Date.now(),reenvios:0,cuerpo:cu});ls.setItem(K,JSON.stringify(l.slice(-10)))}catch(e){}}
if(typeof fetch!=='function')return;
fetch('/api/errores-cliente',{method:'POST',body:JSON.stringify(cu),headers:{'Content-Type':'text/plain;charset=UTF-8'},keepalive:true,credentials:'omit'}).then(function(r){
if(r.status<500&&ls){try{var l=JSON.parse(ls.getItem(K)||'[]');if(Array.isArray(l))ls.setItem(K,JSON.stringify(l.filter(function(e){return e&&e.id!==id})))}catch(e){}}
}).catch(function(){})
}catch(e){}}
api.reportar=reportar;
function reintentar(destino){
try{w.sessionStorage.setItem(C.pe+(location.pathname||'/'),'{"r":[]}')}catch(e){}
if(destino)location.assign(destino);else location.reload()}
d.addEventListener('click',function(e){
var el=e.target&&e.target.closest?e.target.closest('['+C.ar+']'):null;
if(!el)return;e.preventDefault();reintentar(el.getAttribute(C.ar))},true);
d.addEventListener('animationstart',function(e){
if(e.animationName!==C.an)return;
var el=e.target;if(!el||!el.getAttribute||el.__oneVisto)return;el.__oneVisto=1;
if(d.getElementById(C.id))return;
reportar(el.getAttribute(C.ac)||'espera-ruta')},true);
function pintar(causa){
if(w.__oneHidratada||d.getElementById(C.id)||!d.body)return;
var ls2=d.querySelectorAll('link[rel="stylesheet"]');for(var i=0;i<ls2.length;i++){if(!ls2[i].sheet&&ls2[i].parentNode){quitadas.push(ls2[i]);ls2[i].parentNode.removeChild(ls2[i])}}
var r=d.createElement('div');r.id=C.id;r.setAttribute('role','alert');
r.style.cssText='position:fixed;inset:0;z-index:2147483647;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:24px;text-align:center;background:#fff;color:'+C.ct+';font-family:system-ui,-apple-system,Segoe UI,sans-serif';
var h=d.createElement('h2');h.textContent=C.t;h.style.cssText='margin:0;font-size:18px;font-weight:600';
var p=d.createElement('p');p.textContent=C.b;p.style.cssText='margin:0;max-width:32rem;font-size:14px;line-height:1.5;color:#525252';
var bt=d.createElement('button');bt.type='button';bt.textContent=C.bt;bt.setAttribute(C.ar,'');
bt.style.cssText='padding:8px 16px;border-radius:6px;border:none;background:'+C.ca+';color:#fff;font-size:14px;font-weight:500;cursor:pointer';
r.appendChild(h);r.appendChild(p);r.appendChild(bt);d.body.appendChild(r);
reportar(causa)}
api.pintar=pintar;
var tm=setTimeout(function(){pintar('sin-hidratar')},C.lh),tc=null;
api.hidratada=function(){clearTimeout(tm);if(tc)clearTimeout(tc);var r=d.getElementById(C.id);if(r&&r.parentNode)r.parentNode.removeChild(r);
while(quitadas.length)d.head.appendChild(quitadas.shift())};
w.addEventListener('error',function(e){
var s=e.target;if(w.__oneHidratada||tc||!s||!s.tagName)return;
var u=s.src||s.href||'';if(String(u).indexOf('/_next/static/')<0)return;
tc=setTimeout(function(){pintar('chunk')},C.gc)},true);
}catch(e){}})();`
}
