/*
 * Service worker del piloto de red de MeTRIK ONE (soena, 2026-10-06).
 * Brief: proyectos/soena/ve/2026-10-06_brief-max-piloto-red-documentos.md
 *
 * QUÉ HACE, y nada más:
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
 *  - NO guarda respuestas (no hay Cache Storage): nunca puede servir la pantalla de otra
 *    persona ni de otro workspace, ni datos viejos después de cerrar sesión.
 *  - NO toca nada que no sea GET (server actions, subidas, formularios pasan directo), ni
 *    /api/, ni /auth/ (el código del enlace mágico es de un solo uso: no se repite), ni otros
 *    dominios, ni prefetch.
 *
 * INTERRUPTOR DE APAGADO: poner `APAGADO = true` y publicar. El navegador revisa este archivo
 * en cada navegación (se registra con `updateViaCache: 'none'`); la versión apagada se instala,
 * borra todo lo suyo y se desregistra sola. La app además desregistra si el piloto se apaga en
 * código (`SW_PILOTO_ACTIVO` en src/lib/red/piloto.ts). Probado en scripts/sw-piloto.e2e.mjs.
 */

const VERSION = '2026-10-06.1'
const APAGADO = false

const DB = 'metrik-red-piloto'
const STORE = 'eventos'
const MAX_EVENTOS = 300
const RUTA_EVENTOS = '/api/red/eventos'

/** Esperas antes de cada reintento (ms) y tope por intento. */
const ESPERAS = [600, 1800]
const TOPE_PRIMERO_MS = 20000
const TOPE_REINTENTO_MS = 10000

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Este SW no guarda respuestas; si alguna vez quedó algo en Cache Storage, fuera.
      const claves = await caches.keys()
      await Promise.all(claves.map((k) => caches.delete(k)))
      if (APAGADO) {
        await borrarBase()
        await self.registration.unregister()
        return
      }
      if (self.registration.navigationPreload) {
        try {
          await self.registration.navigationPreload.enable()
        } catch {
          // sin navigation preload: el primer intento usa fetch normal
        }
      }
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
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/') || url.pathname.startsWith('/_next/')) return

  if (req.mode === 'navigate') {
    event.respondWith(navegar(event, url))
    return
  }
  if (req.headers.get('rsc') === '1' && !req.headers.get('next-router-prefetch')) {
    event.respondWith(rscConReintento(event, url))
  }
})

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
