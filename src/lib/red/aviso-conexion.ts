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
 * Sin hidratar a los 8 s: el indicador «tu conexión está lenta», que NO tapa nada (una píldora
 * arriba, sin capturar clics). La página que ya mandó el servidor se sigue viendo y sus enlaces
 * funcionan como enlaces normales. Se quita solo al hidratar.
 *
 * Nació el 2026-10-07: con Claro/Movistar/Telmex hacia Vercel cada chunk tardaba 6-16 s pero
 * TERMINABA en 200; el aviso de los 20 s salía sobre una carga sana, la persona tocaba
 * Reintentar y la carga volvía a empezar desde cero.
 */
export const LIMITE_AVISO_LENTA_MS = 8_000

/**
 * El aviso a pantalla completa ya no sale por reloj sino por FALTA DE AVANCE: sin hidratar,
 * pasados `LIMITE_HIDRATACION_MS` desde la carga Y `SIN_AVANCE_MS` sin que termine de bajar
 * ningún recurso de `/_next/` ni llegue HTML nuevo del stream. Mientras algo siga llegando,
 * se espera (con la píldora a la vista). Todo colgado de verdad: el aviso a los 25 s.
 */
export const LIMITE_HIDRATACION_MS = 20_000
export const SIN_AVANCE_MS = 25_000
/** Tope duro aunque algo siga llegando gota a gota: a los 2 min sin hidratar, el aviso. */
export const TOPE_HIDRATACION_MS = 120_000

/**
 * Un chunk o una hoja de `/_next/static/` que falló se pide de nuevo con estas esperas antes
 * de rendirse (antes del 2026-10-07, un solo fallo bastaba para el aviso o la pantalla de
 * error). Vale para los del HTML (antes de hidratar) y para los que pide el runtime después
 * (una ruta nueva, un modal): Turbopack guarda el fallo para siempre, así que el reintento
 * tiene que pasar ANTES de que el runtime se entere.
 */
export const ESPERAS_REINTENTO_CHUNK_MS = [1_000, 3_000, 8_000] as const

/**
 * Una navegación interna (petición RSC GET) que falla ANTES de recibir respuesta se repite con
 * estas esperas. Sin esto Next cae a una carga completa de la página (más pesada). No aplica si
 * hay service worker controlando la página: el del piloto ya repite.
 */
export const ESPERAS_REINTENTO_RSC_MS = [1_000, 3_000] as const

/**
 * Animación de carga de una ruta (o de una navegación): a los 8 s aparece debajo «tu conexión
 * está lenta, seguimos cargando», y a los 45 s el aviso dentro del área de contenido. Antes
 * del 2026-10-07 el aviso salía a los 25 s sin etapa intermedia.
 */
export const LIMITE_ESPERA_LENTA_MS = 8_000
export const LIMITE_ESPERA_RUTA_MS = 45_000

/** Tras un chunk que no bajó (ni con reintentos), cuánto esperar a que React igual hidrate. */
export const GRACIA_TRAS_CHUNK_MS = 3_000

/** Texto del indicador de red lenta (no culpa a nadie ni pide hacer nada). */
export const AVISO_LENTA = 'Tu conexión está lenta. Seguimos cargando…'

/** Marca de la animación CSS que hace aparecer el aviso diferido (la escucha el script). */
export const ANIMACION_APARECER = 'one-aviso-conexion-aparecer'
/** Marca de la animación CSS que oculta la espera cuando aparece el aviso. */
export const ANIMACION_OCULTAR = 'one-aviso-conexion-ocultar'
/** Marca de la animación CSS que hace aparecer «tu conexión está lenta» en una espera. */
export const ANIMACION_LENTA = 'one-aviso-conexion-lenta'
/** Id de la píldora «tu conexión está lenta» antes de hidratar. */
export const ID_AVISO_LENTA = 'one-aviso-lenta'
/** Id del aviso a pantalla completa (lo pinta el script, lo quita `marcarHidratada`). */
export const ID_AVISO_PANTALLA = 'one-aviso-conexion'
/** Atributo del botón Reintentar. Valor = destino a cargar; vacío = la página actual. */
export const ATRIBUTO_REINTENTAR = 'data-one-reintentar'
/** Atributo del aviso diferido: su valor es la causa que se reporta. */
export const ATRIBUTO_CAUSA = 'data-one-aviso-causa'
/** Atributo de la línea «tu conexión está lenta» de una espera: su valor es la causa que se reporta. */
export const ATRIBUTO_CAUSA_LENTA = 'data-one-lenta-causa'

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
/** Se mostró «tu conexión está lenta» (no es un error: cuenta cuántas esperas largas hubo). */
export const MENSAJE_REPORTE_LENTA = 'conexion-lenta-mostrada'
/** Un chunk falló y se pidió de nuevo: `recuperado` dice si el reintento lo salvó. */
export const MENSAJE_REPORTE_CHUNK = 'chunk-reintentado'

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
  `@keyframes ${ANIMACION_OCULTAR}{from,to{visibility:hidden}}` +
  `@keyframes ${ANIMACION_LENTA}{from,to{visibility:visible}}`

/** El `animation` del aviso diferido y de lo que tapa, con el retardo dado. */
export function animacionAparecer(retardoMs: number): string {
  return `${ANIMACION_APARECER} 1ms linear ${retardoMs}ms forwards`
}
export function animacionOcultar(retardoMs: number): string {
  return `${ANIMACION_OCULTAR} 1ms linear ${retardoMs}ms forwards`
}
/** La línea «tu conexión está lenta» de una espera: aparece a `desdeMs` y se va a `hastaMs`. */
export function animacionLenta(desdeMs: number, hastaMs: number): string {
  return `${ANIMACION_LENTA} 1ms linear ${desdeMs}ms forwards, ${ANIMACION_OCULTAR} 1ms linear ${hastaMs}ms forwards`
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
 * Desde el 2026-10-07 ademas AGUANTA una red lenta antes de rendirse:
 *   - Sin hidratar a los 8 s: la pildora «tu conexion esta lenta», que no tapa nada.
 *   - El aviso a pantalla completa sale por falta de AVANCE (nada de `/_next/` termino de bajar
 *     y no llego HTML nuevo en `SIN_AVANCE_MS`), no por reloj; tope duro `TOPE_HIDRATACION_MS`.
 *   - Un chunk u hoja de `/_next/static/` que falla se pide de nuevo (`ESPERAS_REINTENTO_CHUNK_MS`):
 *     los del HTML desde el listener de `error`, y los que pide el runtime de Turbopack despues
 *     (envolviendo `document.head.appendChild`: el runtime pone `onerror` y guarda el fallo para
 *     siempre, asi que el reintento va antes de avisarle).
 *   - Una navegacion RSC (GET con cabecera `rsc: 1`, sin prefetch) que falla antes de recibir
 *     respuesta se repite (`ESPERAS_REINTENTO_RSC_MS`) en vez de caer a una carga completa.
 *
 * Lo que este script inserta lleva la marca `__oneP`: no cuenta como avance del HTML. El `load`
 * de un elemento se escucha en `document` y no en `window`: por especificación, un evento
 * `load` no sube hasta la ventana (el `error`, sí).
 *
 * El reporte se anota en la cola de `[error-cliente]` (`errores-cliente/cola.ts`, mismo
 * formato) y sale por `fetch` con `keepalive`; si la red no lo deja salir, la carga
 * siguiente lo reenvía. Tope de 5 reportes por carga.
 */
export function scriptAvisoConexion(version: string): string {
  const c = {
    v: version,
    ll: LIMITE_AVISO_LENTA_MS,
    lh: LIMITE_HIDRATACION_MS,
    sa: SIN_AVANCE_MS,
    th: TOPE_HIDRATACION_MS,
    gc: GRACIA_TRAS_CHUNK_MS,
    rc: ESPERAS_REINTENTO_CHUNK_MS,
    rr: ESPERAS_REINTENTO_RSC_MS,
    an: ANIMACION_APARECER,
    al: ANIMACION_LENTA,
    id: ID_AVISO_PANTALLA,
    il: ID_AVISO_LENTA,
    ar: ATRIBUTO_REINTENTAR,
    ac: ATRIBUTO_CAUSA,
    acl: ATRIBUTO_CAUSA_LENTA,
    pe: PREFIJO_ESCALERA,
    m: MENSAJE_REPORTE_AVISO,
    ml: MENSAJE_REPORTE_LENTA,
    mc: MENSAJE_REPORTE_CHUNK,
    t: AVISO_CONEXION.titulo,
    b: AVISO_CONEXION.cuerpo,
    bt: AVISO_CONEXION.boton,
    tl: AVISO_LENTA,
    ct: PALETA.tinta,
    ca: PALETA.acento,
  }
  // JSON.stringify deja los textos escapados; `<` se escapa aparte para no cerrar el <script>.
  const conf = JSON.stringify(c).replace(/</g, '\\u003c')
  return `(function(){try{
var C=${conf},w=window,d=document,t0=Date.now(),enviados=0;
if(w.__oneAvisoConexion)return;
var api=w.__oneAvisoConexion={},quitadas=[],avance=t0,intentos={},tm=null,tc=null,mo=null,ap=null;
function nid(){try{if(w.crypto&&crypto.randomUUID)return crypto.randomUUID()}catch(e){}return Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,10)}
function reportar(m,causa,extra){try{
if(enviados>=5)return;enviados++;
var id=nid(),cu={message:m,name:'AvisoConexion',id:id,pathname:location.pathname,host:location.host,version:C.v,userAgent:navigator.userAgent,enLinea:navigator.onLine!==false,segDesdeCarga:Math.round((Date.now()-t0)/1000)};
if(causa)cu.causa=causa;if(extra)for(var k in extra)cu[k]=extra[k];
var K='metrik:errores-cliente:cola',ls=null;try{ls=w.localStorage}catch(e){}
if(ls){try{var l=JSON.parse(ls.getItem(K)||'[]');if(!Array.isArray(l))l=[];l.push({id:id,creado:Date.now(),reenvios:0,cuerpo:cu});ls.setItem(K,JSON.stringify(l.slice(-10)))}catch(e){}}
if(typeof fetch!=='function')return;
fetch('/api/errores-cliente',{method:'POST',body:JSON.stringify(cu),headers:{'Content-Type':'text/plain;charset=UTF-8'},keepalive:true,credentials:'omit'}).then(function(r){
if(r.status<500&&ls){try{var l=JSON.parse(ls.getItem(K)||'[]');if(Array.isArray(l))ls.setItem(K,JSON.stringify(l.filter(function(e){return e&&e.id!==id})))}catch(e){}}
}).catch(function(){})
}catch(e){}}
api.reportar=function(causa){reportar(C.m,causa)};
function quitar(i){var r=d.getElementById(i);if(r&&r.parentNode)r.parentNode.removeChild(r)}
function propio(n){return !!(n&&n.__oneP)}
function avanzo(){avance=Date.now()}
try{if(typeof MutationObserver==='function'){mo=new MutationObserver(function(rs){for(var i=0;i<rs.length;i++){var r=rs[i],j;
for(j=0;j<r.addedNodes.length;j++)if(!propio(r.addedNodes[j]))return avanzo();
for(j=0;j<r.removedNodes.length;j++)if(!propio(r.removedNodes[j]))return avanzo()}});mo.observe(d.documentElement,{childList:true,subtree:true})}}catch(e){}
try{if(typeof PerformanceObserver==='function'){new PerformanceObserver(function(l){var es=l.getEntries();for(var i=0;i<es.length;i++)if(String(es[i].name).indexOf('/_next/')>=0)return avanzo()}).observe({type:'resource'})}}catch(e){}
d.addEventListener('load',function(e){var s=e.target;if(s&&(s.tagName==='SCRIPT'||s.tagName==='LINK')){avanzo();
if(s.__oneIntento&&!s.__oneDinamico)reportar(C.mc,null,{recuperado:true,intento:s.__oneIntento})}},true);
function reintentar(destino){
try{w.sessionStorage.setItem(C.pe+(location.pathname||'/'),'{"r":[]}')}catch(e){}
if(destino)location.assign(destino);else location.reload()}
d.addEventListener('click',function(e){
var el=e.target&&e.target.closest?e.target.closest('['+C.ar+']'):null;
if(!el)return;e.preventDefault();reintentar(el.getAttribute(C.ar))},true);
d.addEventListener('animationstart',function(e){
var el=e.target;if(!el||!el.getAttribute)return;
if(e.animationName===C.al){if(el.__oneVistoL)return;el.__oneVistoL=1;reportar(C.ml,el.getAttribute(C.acl)||'espera-ruta');return}
if(e.animationName!==C.an||el.__oneVisto)return;el.__oneVisto=1;
if(d.getElementById(C.id))return;
reportar(C.m,el.getAttribute(C.ac)||'espera-ruta')},true);
function lenta(){
if(w.__oneHidratada||d.getElementById(C.id)||d.getElementById(C.il)||!d.body)return;
var r=d.createElement('div');r.id=C.il;r.__oneP=1;r.setAttribute('role','status');r.setAttribute('aria-live','polite');r.textContent=C.tl;
r.style.cssText='position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483646;pointer-events:none;max-width:calc(100% - 24px);padding:8px 14px;border-radius:999px;border:1px solid #E5E7EB;background:#fff;color:'+C.ct+';box-shadow:0 2px 8px rgba(0,0,0,.08);font:500 13px/1.3 system-ui,-apple-system,Segoe UI,sans-serif;text-align:center';
d.body.appendChild(r);reportar(C.ml,'sin-hidratar')}
function pintar(causa){
if(w.__oneHidratada||d.getElementById(C.id)||!d.body)return;
clearTimeout(tm);quitar(C.il);
var ls2=d.querySelectorAll('link[rel="stylesheet"]');for(var i=0;i<ls2.length;i++){if(!ls2[i].sheet&&ls2[i].parentNode){ls2[i].__oneP=1;quitadas.push(ls2[i]);ls2[i].parentNode.removeChild(ls2[i])}}
var r=d.createElement('div');r.id=C.id;r.__oneP=1;r.setAttribute('role','alert');
r.style.cssText='position:fixed;inset:0;z-index:2147483647;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:24px;text-align:center;background:#fff;color:'+C.ct+';font-family:system-ui,-apple-system,Segoe UI,sans-serif';
var h=d.createElement('h2');h.textContent=C.t;h.style.cssText='margin:0;font-size:18px;font-weight:600';
var p=d.createElement('p');p.textContent=C.b;p.style.cssText='margin:0;max-width:32rem;font-size:14px;line-height:1.5;color:#525252';
var bt=d.createElement('button');bt.type='button';bt.textContent=C.bt;bt.setAttribute(C.ar,'');
bt.style.cssText='padding:8px 16px;border-radius:6px;border:none;background:'+C.ca+';color:#fff;font-size:14px;font-weight:500;cursor:pointer';
r.appendChild(h);r.appendChild(p);r.appendChild(bt);d.body.appendChild(r);
reportar(C.m,causa)}
api.pintar=pintar;
function vigilar(){
if(w.__oneHidratada||d.getElementById(C.id))return;
var ahora=Date.now(),t=ahora-t0;
if(t>=C.ll)lenta();
if((t>=C.lh&&ahora-avance>=C.sa)||t>=C.th)return pintar('sin-hidratar');
tm=setTimeout(vigilar,1000)}
tm=setTimeout(vigilar,C.ll);
api.hidratada=function(){clearTimeout(tm);if(tc)clearTimeout(tc);quitar(C.id);quitar(C.il);
if(mo){try{mo.disconnect()}catch(e){}mo=null}
while(quitadas.length){var q=quitadas.shift();if(ap)ap.call(d.head,q);else d.head.appendChild(q)}};
function esChunk(s){if(!s||(s.tagName!=='SCRIPT'&&s.tagName!=='LINK'))return '';var u=String(s.src||s.href||'');return u.indexOf('/_next/static/')<0?'':u}
function copia(s,u,n){var x=d.createElement(s.tagName==='LINK'?'link':'script');x.__oneP=1;x.__oneIntento=n;
if(s.tagName==='LINK'){x.rel='stylesheet';x.href=u}else{x.src=u;x.async=true}return x}
ap=d.head&&d.head.appendChild;
if(ap){d.head.appendChild=function(el){
try{var u=esChunk(el);if(u&&!el.__oneP&&typeof el.onerror==='function')envolver(el,u)}catch(e){}
return ap.apply(this,arguments)}}
function envolver(el,u){
el.__oneDinamico=1;var oe=el.onerror,ol=el.onload,n=0;
function fallo(ev){
if(n>=C.rc.length){reportar(C.mc,null,{recuperado:false,intento:n});return oe.call(el,ev)}
var espera=C.rc[n++];
setTimeout(function(){var x=copia(el,u,n);x.__oneDinamico=1;x.onerror=fallo;
x.onload=function(e2){reportar(C.mc,null,{recuperado:true,intento:n});if(ol)ol.call(el,e2)};
ap.call(d.head,x)},espera)}
el.onerror=fallo}
w.addEventListener('error',function(e){
var s=e.target,u=esChunk(s);if(!u||s.__oneDinamico||w.__oneHidratada||tc)return;
var n=intentos[u]||0;
if(n<C.rc.length){intentos[u]=n+1;setTimeout(function(){if(w.__oneHidratada)return;var x=copia(s,u,n+1);
if(s.tagName==='LINK'&&s.parentNode)s.parentNode.insertBefore(x,s.nextSibling);else if(ap)ap.call(d.head,x);else d.head.appendChild(x)},C.rc[n]);return}
reportar(C.mc,null,{recuperado:false,intento:n});
tc=setTimeout(function(){pintar('chunk')},C.gc)},true);
var of=w.fetch;
function esRsc(init){if(!init||!init.headers)return false;if(String(init.method||'GET').toUpperCase()!=='GET')return false;
var h=init.headers,rsc=null,pf=null;
if(typeof h.get==='function'){rsc=h.get('rsc');pf=h.get('next-router-prefetch')}else{for(var k in h){var lk=String(k).toLowerCase();if(lk==='rsc')rsc=h[k];else if(lk==='next-router-prefetch')pf=h[k]}}
return String(rsc)==='1'&&!pf}
if(typeof of==='function'){w.fetch=function(input,init){
var self=this,args=arguments,pr=of.apply(self,args);
try{if(!esRsc(init)||(navigator.serviceWorker&&navigator.serviceWorker.controller))return pr}catch(e){return pr}
var n=0,sg=init.signal;
function intentar(p){return p.catch(function(err){
if((err&&err.name==='AbortError')||(sg&&sg.aborted)||n>=C.rr.length)throw err;
var espera=C.rr[n++];
return new Promise(function(r){setTimeout(r,espera)}).then(function(){if(sg&&sg.aborted)throw err;return intentar(of.apply(self,args))})})}
return intentar(pr)}}
}catch(e){}})();`
}
