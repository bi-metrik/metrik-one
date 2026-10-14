/*
 * Service worker de MeTRIK ONE.
 *
 * Nació como piloto de red de soena (2026-10-06, brief
 * proyectos/soena/ve/2026-10-06_brief-max-piloto-red-documentos.md). Desde el 2026-10-12 corre en
 * TODOS los workspaces, pero lo que hace cada uno depende del subdominio:
 *
 * EN TODOS (desde 2026-10-12, Claro móvil perdía chunks de Vercel en trappvel):
 *  0. Estáticos inmutables de Next (`/_next/static/chunks/*` y `/_next/static/media/*` con hash en
 *     el nombre): cache-first. Al pedirlos por primera vez, la red con reintento y el archivo
 *     se lee ENTERO antes de entregarlo (un corte a media descarga se repite aquí, no rompe la
 *     página); después salen del Cache Storage sin tocar la red.
 *     La llave es la RUTA sin `?dpl=`: Turbopack nombra cada archivo por el hash de su
 *     contenido, así que el mismo nombre en otro deployment es el mismo archivo (medido el
 *     2026-10-12 en producción: 16 de 20 archivos de /login idénticos byte a byte entre dos
 *     deployments; el runtime, que lleva el id del deployment adentro, cambia de nombre). Eso
 *     es lo que el cache HTTP del navegador no da: su llave incluye `?dpl=` y cada deploy
 *     (~76/semana) vuelve a bajar todo. En un fallo de caché se pide la URL TAL CUAL (con
 *     `?dpl=`), así que Skew Protection sigue mandando.
 *     Limpieza: cada entrada anota el deployment que la usó por última vez y se re-anota (al
 *     final de la fila) la primera vez que la pide un deployment nuevo; pasado el tope de
 *     entradas sale lo que lleva más deploys sin usarse.
 *
 * SOLO EN LOS WORKSPACES DEL PILOTO (`PILOTO`, igual que `WORKSPACES_PILOTO_RED` en
 * src/lib/red/piloto.ts):
 *  1. Carga de página (navegación GET a una pantalla de la app): si la red no responde, la
 *     reintenta dos veces con espera creciente; si sigue sin red, en vez del error de Chrome
 *     («No se puede acceder a este sitio», ERR_TIMED_OUT) muestra «Reconectando» y la página
 *     vuelve sola en cuanto hay conexión.
 *  2. Navegación interna (petición RSC GET de Next, sin prefetch): la lee completa antes de
 *     entregarla y, si la red la corta a medias, la repite (es una lectura: repetirla no cambia
 *     nada en el servidor). Si no hay caso, falla igual que antes y la app sigue con su
 *     escalera de recuperación.
 *  3. Anota cada carga o navegación que falló (o que se salvó reintentando) en IndexedDB y la
 *     manda a /api/red/eventos con la siguiente carga que sí llega.
 *
 * QUÉ NO HACE, a propósito:
 *  - NO guarda nada que no sea un estático con hash: ni HTML, ni RSC (`?_rsc=`, cabecera RSC),
 *    ni /api/, ni nada con sesión, ni Supabase (otro dominio). Nunca puede servir la pantalla
 *    de otra persona ni de otro workspace, ni datos viejos después de cerrar sesión.
 *  - NO toca nada que no sea GET (server actions, subidas, formularios pasan directo), ni
 *    /auth/ (el código del enlace mágico es de un solo uso: no se repite), ni otros dominios,
 *    ni prefetch.
 *  - Fuera del piloto, las peticiones que no son estáticos ni siquiera despiertan al SW
 *    (Static Routing API, Chrome 123+): van directo a la red.
 *
 * INTERRUPTOR DE APAGADO: poner `APAGADO = true` y publicar. El navegador revisa este archivo
 * en cada navegación (se registra con `updateViaCache: 'none'`); la versión apagada se instala,
 * borra todo lo suyo (caché incluido) y se desregistra sola. La app además desregistra si el
 * interruptor en código se apaga (`SW_ACTIVO` en src/lib/red/piloto.ts). Probado en
 * scripts/sw-piloto.e2e.mjs.
 */

const VERSION = '2026-10-12.1'
const APAGADO = false

/** Subdominios con navegación y RSC atendidos por el SW (el piloto de red). */
const PILOTO = ['soena']

const DB = 'metrik-red-piloto'
const STORE = 'eventos'
const MAX_EVENTOS = 300
const RUTA_EVENTOS = '/api/red/eventos'

/** Esperas antes de cada reintento (ms) y tope por intento. */
const ESPERAS = [600, 1800]
const TOPE_PRIMERO_MS = 20000
const TOPE_REINTENTO_MS = 10000

/** Estáticos: caché, tope de entradas y reintentos de red dentro del SW. */
const CACHE_ESTATICOS = 'one-estaticos-v1'
const MAX_ESTATICOS = 600
const ESPERAS_ESTATICO = [500, 1500]
const TOPE_ESTATICO_MS = 30000
const CABECERA_DPL = 'x-one-dpl'

const ES_PILOTO = PILOTO.includes(String(self.location.hostname).split('.')[0])

self.addEventListener('install', (event) => {
  self.skipWaiting()
  // Fuera del piloto el SW solo atiende estáticos: todo lo demás va directo a la red sin
  // arrancar el SW (ahorra el arranque en cada navegación en teléfonos lentos). Navegadores
  // sin Static Routing API: el `fetch` de abajo devuelve sin `respondWith`, igual de inocuo.
  if (!APAGADO && !ES_PILOTO && event.addRoutes && typeof URLPattern === 'function') {
    try {
      event.waitUntil(
        Promise.resolve(
          event.addRoutes([
            { condition: { urlPattern: new URLPattern({ pathname: '/_next/static/*' }) }, source: 'fetch-event' },
            { condition: { urlPattern: new URLPattern({ pathname: '*' }) }, source: 'network' },
          ]),
        ).catch(() => {}),
      )
    } catch {
      // sin rutas estáticas: sigue por el fetch
    }
  }
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Fuera todo caché que no sea el de estáticos vigente (versiones viejas, o lo que fuera).
      const claves = await caches.keys()
      await Promise.all(claves.filter((k) => APAGADO || k !== CACHE_ESTATICOS).map((k) => caches.delete(k)))
      if (APAGADO) {
        await borrarBase()
        await self.registration.unregister()
        return
      }
      if (self.registration.navigationPreload) {
        try {
          // Solo el piloto atiende navegaciones: fuera de él, un preload pediría cada página dos veces.
          if (ES_PILOTO) await self.registration.navigationPreload.enable()
          else await self.registration.navigationPreload.disable()
        } catch {
          // sin navigation preload: el primer intento usa fetch normal
        }
      }
      await podarEstaticos()
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  if (APAGADO) return
  const req = event.request
  if (req.method !== 'GET') return
  let url
  try {
    url = new URL(req.url)
  } catch {
    return
  }
  if (url.origin !== self.location.origin) return

  if (url.pathname.startsWith('/_next/')) {
    if (esEstaticoInmutable(url) && !req.headers.has('range')) event.respondWith(estatico(event, url))
    return
  }
  if (!ES_PILOTO) return
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) return

  if (req.mode === 'navigate') {
    event.respondWith(navegar(event, url))
    return
  }
  if (req.headers.get('rsc') === '1' && !req.headers.get('next-router-prefetch')) {
    event.respondWith(rscConReintento(event, url))
  }
})

// ── Estáticos inmutables ──────────────────────────────────────────────────────────────

/** Un archivo de `/_next/static/chunks|media/` con hash (8+ hex) en el nombre. */
function esEstaticoInmutable(url) {
  const m = /^\/_next\/static\/(chunks|media)\/(.+)$/.exec(url.pathname)
  if (!m) return false
  const nombre = m[2].split('/').pop() || ''
  return /[0-9a-f]{8,}/i.test(nombre)
}

async function abrirCache() {
  try {
    return await caches.open(CACHE_ESTATICOS)
  } catch {
    return null
  }
}

async function estatico(event, url) {
  const llave = new Request(url.origin + url.pathname)
  const dpl = url.searchParams.get('dpl') || ''
  const cache = await abrirCache()
  if (cache) {
    let guardada = null
    try {
      guardada = await cache.match(llave, { ignoreVary: true })
    } catch {
      guardada = null
    }
    if (guardada) {
      // Primer uso desde un deployment nuevo: se re-anota al final de la fila (la poda saca
      // primero lo que lleva más deploys sin usarse).
      if (dpl && guardada.headers.get(CABECERA_DPL) !== dpl) {
        event.waitUntil(reanotar(cache, llave, guardada.clone(), dpl))
      }
      return guardada
    }
  }

  let ultimo = null
  for (let intento = 0; intento <= ESPERAS_ESTATICO.length; intento++) {
    if (intento > 0) {
      if (event.request.signal && event.request.signal.aborted) break
      await dormir(ESPERAS_ESTATICO[intento - 1])
    }
    const ac = typeof AbortController === 'function' ? new AbortController() : null
    const tope = setTimeout(() => ac && ac.abort(), TOPE_ESTATICO_MS)
    try {
      const res = await fetch(event.request, ac ? { signal: ac.signal } : undefined)
      // 404 (deployment fuera de Skew Protection), 5xx, opaco, redirigido: tal cual y sin guardar.
      if (res.status !== 200 || res.redirected || res.type === 'opaque' || res.type === 'opaqueredirect') {
        clearTimeout(tope)
        return res
      }
      // Entero antes de entregarlo: un corte a media descarga lanza aquí y se repite.
      const cuerpo = await res.arrayBuffer()
      clearTimeout(tope)
      const cabeceras = new Headers(res.headers)
      if (dpl) cabeceras.set(CABECERA_DPL, dpl)
      const lista = new Response(cuerpo, { status: 200, statusText: res.statusText, headers: cabeceras })
      if (cache) event.waitUntil(guardar(cache, llave, lista.clone()))
      return lista
    } catch (e) {
      clearTimeout(tope)
      ultimo = e
      if (event.request.signal && event.request.signal.aborted) break
    }
  }
  // Sin red: la página lo ve como un chunk que no bajó y aplica su propio reintento.
  void ultimo
  return Response.error()
}

let guardadas = 0
async function guardar(cache, llave, res) {
  try {
    await cache.put(llave, res)
    guardadas++
    if (guardadas % 25 === 0) await podarEstaticos()
  } catch {
    // Cuota llena u otro error: el archivo ya llegó a la página, solo no queda guardado.
  }
}

async function reanotar(cache, llave, res, dpl) {
  try {
    const cabeceras = new Headers(res.headers)
    cabeceras.set(CABECERA_DPL, dpl)
    const cuerpo = await res.arrayBuffer()
    // `put` sobre una llave existente la borra y la agrega al final (orden de inserción).
    await cache.put(llave, new Response(cuerpo, { status: 200, statusText: res.statusText, headers: cabeceras }))
  } catch {
    // no importa
  }
}

/** Deja a lo sumo `MAX_ESTATICOS` entradas: salen las primeras (las menos recientes). */
async function podarEstaticos() {
  try {
    const cache = await caches.open(CACHE_ESTATICOS)
    const llaves = await cache.keys()
    const sobran = llaves.length - MAX_ESTATICOS
    if (sobran > 0) await Promise.all(llaves.slice(0, sobran).map((k) => cache.delete(k)))
  } catch {
    // no importa
  }
}

// ── Utilidades ────────────────────────────────────────────────────────────────────────

const dormir = (ms) => new Promise((r) => setTimeout(r, ms))

function conTope(promesa, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`sin respuesta en ${ms} ms`)), ms)
    promesa.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e) => {
        clearTimeout(t)
        reject(e)
      },
    )
  })
}

function rutaNormalizada(pathname) {
  return pathname.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '[id]').slice(0, 200)
}

function textoError(e) {
  if (!e) return 'Error'
  return `${e.name || 'Error'}: ${e.message || String(e)}`.slice(0, 300)
}

function nuevoId() {
  try {
    return self.crypto.randomUUID()
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  }
}

// ── Carga de página ───────────────────────────────────────────────────────────────────

async function navegar(event, url) {
  const inicio = Date.now()
  let ultimo = null
  for (let intento = 0; intento <= ESPERAS.length; intento++) {
    if (intento > 0) await dormir(ESPERAS[intento - 1])
    try {
      let res = null
      if (intento === 0 && event.preloadResponse) {
        res = await conTope(event.preloadResponse.then((r) => r || null), TOPE_PRIMERO_MS)
      }
      if (!res) res = await conTope(fetch(event.request), intento === 0 ? TOPE_PRIMERO_MS : TOPE_REINTENTO_MS)
      if (intento > 0) {
        await anotar({ superficie: 'carga', ruta: rutaNormalizada(url.pathname), error: textoError(ultimo), dur_ms: Date.now() - inicio, recuperado: true, intentos: intento + 1 })
      }
      // Llegó: buen momento para mandar lo anotado (sin demorar la respuesta).
      event.waitUntil(vaciar())
      return res
    } catch (e) {
      ultimo = e
    }
  }
  await anotar({ superficie: 'carga', ruta: rutaNormalizada(url.pathname), error: textoError(ultimo), dur_ms: Date.now() - inicio, recuperado: false, intentos: ESPERAS.length + 1 })
  return paginaReconectando()
}

// ── Navegación interna (RSC) ──────────────────────────────────────────────────────────

async function rscConReintento(event, url) {
  const inicio = Date.now()
  let ultimo = null
  for (let intento = 0; intento <= ESPERAS.length; intento++) {
    if (intento > 0) {
      if (event.request.signal && event.request.signal.aborted) break
      await dormir(ESPERAS[intento - 1])
    }
    try {
      const res = await conTope(fetch(event.request), intento === 0 ? TOPE_PRIMERO_MS : TOPE_REINTENTO_MS)
      // Una redirección (sesión vencida → /login, pestaña de otro workspace) o algo que no es
      // RSC va tal cual: Next mira `redirected` y `url` de la respuesta original.
      const tipo = res.headers.get('content-type') || ''
      if (res.redirected || !res.ok || !tipo.startsWith('text/x-component')) return res
      // Se lee entera: un corte a media respuesta se ve aquí y se puede repetir.
      const cuerpo = await res.arrayBuffer()
      if (intento > 0) {
        await anotar({ superficie: 'navegacion', ruta: rutaNormalizada(url.pathname), error: textoError(ultimo), dur_ms: Date.now() - inicio, recuperado: true, intentos: intento + 1 })
      }
      return new Response(cuerpo, { status: res.status, statusText: res.statusText, headers: res.headers })
    } catch (e) {
      ultimo = e
      if (e && e.name === 'AbortError') break
    }
  }
  if (!(ultimo && ultimo.name === 'AbortError')) {
    await anotar({ superficie: 'navegacion', ruta: rutaNormalizada(url.pathname), error: textoError(ultimo), dur_ms: Date.now() - inicio, recuperado: false, intentos: ESPERAS.length + 1 })
  }
  return Response.error()
}

// ── «Reconectando» ────────────────────────────────────────────────────────────────────

function paginaReconectando() {
  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Reconectando · MéTRIK one</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#F7F7F5;color:#1A1A1A}
  main{max-width:340px;padding:32px 24px;text-align:center}
  .punto{width:14px;height:14px;border-radius:50%;background:#10B981;margin:0 auto 20px;animation:latido 1.4s ease-in-out infinite}
  @keyframes latido{0%,100%{opacity:.25;transform:scale(.8)}50%{opacity:1;transform:scale(1.15)}}
  h1{font-size:18px;font-weight:600;margin:0 0 8px}
  p{font-size:14px;line-height:1.45;color:#6B7280;margin:0 0 20px}
  button{font:inherit;font-size:14px;padding:10px 18px;border-radius:8px;border:1px solid #E5E7EB;background:#fff;color:#1A1A1A;cursor:pointer}
  #estado{font-size:12px;color:#9CA3AF;margin-top:14px;min-height:16px}
</style></head>
<body><main data-sw-reconectando="${VERSION}">
  <div class="punto" aria-hidden="true"></div>
  <h1>Reconectando…</h1>
  <p>La conexión se interrumpió un momento. Seguimos intentando solos y la página vuelve apenas haya red. No necesitas cerrar la pestaña.</p>
  <button id="ya" type="button">Reintentar ahora</button>
  <div id="estado" role="status"></div>
</main>
<script>
(function(){
  var esperas=[2000,4000,8000,15000,30000];var i=0;var t=null;var probando=false;
  var estado=document.getElementById('estado');
  function siguiente(){var ms=esperas[Math.min(i,esperas.length-1)];i++;estado.textContent=navigator.onLine===false?'Sin conexión. Seguimos esperando…':'Nuevo intento en '+Math.round(ms/1000)+' s';clearTimeout(t);t=setTimeout(probar,ms);}
  function probar(){if(probando)return;probando=true;estado.textContent='Probando la conexión…';
    var ac=typeof AbortController==='function'?new AbortController():null;var tope=setTimeout(function(){if(ac)ac.abort();},6000);
    fetch('/pulso.png?n='+Math.random().toString(36).slice(2),{cache:'no-store',credentials:'omit',signal:ac?ac.signal:undefined})
      .then(function(){clearTimeout(tope);estado.textContent='Volvió la conexión. Cargando…';location.reload();})
      .catch(function(){clearTimeout(tope);probando=false;siguiente();});}
  document.getElementById('ya').addEventListener('click',function(){clearTimeout(t);probar();});
  window.addEventListener('online',function(){clearTimeout(t);probar();});
  siguiente();
})();
</script></body></html>`
  return new Response(html, {
    status: 503,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Retry-After': '5' },
  })
}

// ── Bandeja de eventos (IndexedDB) ────────────────────────────────────────────────────

function abrirBase() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1)
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' })
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
}

function borrarBase() {
  return new Promise((resolve) => {
    try {
      const r = indexedDB.deleteDatabase(DB)
      r.onsuccess = r.onerror = r.onblocked = () => resolve()
    } catch {
      resolve()
    }
  })
}

async function anotar(f) {
  try {
    const db = await abrirBase()
    const ev = Object.assign({ tipo: 'falla', id: nuevoId(), t: Date.now(), sw: true }, f)
    await new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readwrite')
      const st = tx.objectStore(STORE)
      st.put(ev)
      // Tope: si se acumula de más, sale lo más viejo.
      const c = st.count()
      c.onsuccess = () => {
        const sobran = c.result - MAX_EVENTOS
        if (sobran > 0) {
          let n = 0
          st.openCursor().onsuccess = (e) => {
            const cur = e.target.result
            if (cur && n < sobran) {
              cur.delete()
              n++
              cur.continue()
            }
          }
        }
      }
      tx.oncomplete = tx.onerror = tx.onabort = () => resolve()
    })
    db.close()
  } catch {
    // La medición nunca rompe la carga.
  }
}

let vaciando = false
async function vaciar() {
  if (vaciando) return
  vaciando = true
  try {
    const db = await abrirBase()
    const eventos = await new Promise((resolve) => {
      const r = db.transaction(STORE).objectStore(STORE).getAll()
      r.onsuccess = () => resolve(r.result || [])
      r.onerror = () => resolve([])
    })
    if (eventos.length === 0) {
      db.close()
      return
    }
    const lote = eventos.slice(0, 100)
    const res = await conTope(
      fetch(RUTA_EVENTOS, {
        method: 'POST',
        body: JSON.stringify({ eventos: lote }),
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        credentials: 'same-origin',
        redirect: 'manual',
      }),
      10000,
    )
    if (res.status === 204) {
      await new Promise((resolve) => {
        const tx = db.transaction(STORE, 'readwrite')
        const st = tx.objectStore(STORE)
        for (const e of lote) st.delete(e.id)
        tx.oncomplete = tx.onerror = tx.onabort = () => resolve()
      })
    }
    db.close()
  } catch {
    // Queda para la próxima.
  } finally {
    vaciando = false
  }
}
