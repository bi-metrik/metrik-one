#!/usr/bin/env node
// Prueba de punta a punta del service worker del piloto de red (`public/sw.js`) en Chromium
// real, contra un servidor local que simula la red mala. No corre en CI (necesita navegador):
//
//   PW_CHROMIUM=/ruta/a/chrome node scripts/sw-piloto.e2e.mjs
//
// Requiere `playwright-core` resoluble (p. ej. `npm i --no-save playwright-core`).
//
// Casos (los del brief del 2026-10-06):
//   b) /negocios/[id] sin red: se ve «Reconectando», no el error de Chrome, y vuelve sola.
//   b') la conexión se cae 2 veces al pedir la página: el SW reintenta y la persona no ve nada.
//   a') una navegación interna (RSC) cortada a la mitad: el SW la repite y llega entera, una vez.
//   -) un POST (server action) NO se repite ni se intercepta.
//   -) las fallas anotadas llegan a /api/red/eventos con la siguiente carga.
//   d) el interruptor de apagado (APAGADO = true en sw.js) desregistra el SW y borra su base.

import http from 'node:http'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PW_CORE ?? 'playwright-core')
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')
const SW = readFileSync(join(RAIZ, 'public/sw.js'), 'utf8')
const PNG = readFileSync(join(RAIZ, 'public/pulso.png'))

// ── Servidor que simula la red ────────────────────────────────────────────────────────
const estado = { apagado: false, cortarPagina: 0, cortarRscAMedias: 0, pedidosRsc: 0, posts: 0, eventos: [] }

const PAGINA = (titulo) => `<!doctype html><html><head><meta charset="utf-8"><title>${titulo}</title></head>
<body><h1 id="t">${titulo}</h1><script>
navigator.serviceWorker.register('/sw.js',{scope:'/',updateViaCache:'none'});
</script></body></html>`

const RSC_CUERPO = '0:' + 'x'.repeat(200_000) + '\n'

const servidor = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  if (url.pathname === '/sw.js') {
    res.writeHead(200, { 'content-type': 'application/javascript', 'cache-control': 'no-cache' })
    return res.end(estado.apagado ? SW.replace('const APAGADO = false', 'const APAGADO = true') : SW)
  }
  if (url.pathname === '/pulso.png') {
    res.writeHead(200, { 'content-type': 'image/png' })
    return res.end(PNG)
  }
  if (url.pathname === '/api/red/eventos') {
    let b = ''
    req.on('data', (d) => (b += d))
    req.on('end', () => {
      try {
        estado.eventos.push(...JSON.parse(b).eventos)
      } catch {}
      res.writeHead(204)
      res.end()
    })
    return
  }
  if (req.method === 'POST') {
    estado.posts++
    req.socket.destroy() // una acción que se corta: NO debe repetirse
    return
  }
  if (req.headers.rsc === '1') {
    estado.pedidosRsc++
    if (estado.cortarRscAMedias > 0) {
      estado.cortarRscAMedias--
      res.writeHead(200, { 'content-type': 'text/x-component', 'content-length': String(RSC_CUERPO.length) })
      res.write(RSC_CUERPO.slice(0, 50_000))
      setTimeout(() => req.socket.destroy(), 50)
      return
    }
    res.writeHead(200, { 'content-type': 'text/x-component' })
    return res.end(RSC_CUERPO)
  }
  if (url.pathname.startsWith('/negocios')) {
    if (estado.cortarPagina > 0) {
      estado.cortarPagina--
      req.socket.destroy()
      return
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    return res.end(PAGINA('Ficha del negocio'))
  }
  res.writeHead(404)
  res.end()
})

await new Promise((r) => servidor.listen(0, '127.0.0.1', r))
const BASE = `http://localhost:${servidor.address().port}`

// ── Navegador ─────────────────────────────────────────────────────────────────────────
const navegador = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined, headless: true })
const contexto = await navegador.newContext()
const pagina = await contexto.newPage()
const resultados = []
const ok = (nombre, cond, detalle = '') => {
  resultados.push({ nombre, ok: !!cond })
  console.log(`${cond ? 'OK  ' : 'FALLA'} ${nombre}${detalle ? ` — ${detalle}` : ''}`)
}
const titulo = () => pagina.evaluate(() => document.querySelector('h1')?.textContent ?? '')
const esperar = (ms) => new Promise((r) => setTimeout(r, ms))

async function esperarHasta(fn, ms = 20_000) {
  const fin = Date.now() + ms
  while (Date.now() < fin) {
    try {
      if (await fn()) return true
    } catch {}
    await esperar(250)
  }
  return false
}

try {
  // Instalar y quedar controlada.
  await pagina.goto(`${BASE}/negocios/84630bca-1111-4222-8333-444455556666`)
  await pagina.evaluate(() => navigator.serviceWorker.ready)
  await pagina.reload()
  ok('la página queda controlada por el SW', await pagina.evaluate(() => !!navigator.serviceWorker.controller))

  // b') dos cortes de conexión al pedir la página: el SW reintenta, la persona no ve nada.
  estado.cortarPagina = 2
  await pagina.goto(`${BASE}/negocios/84630bca-1111-4222-8333-444455556666`)
  ok('b\') 2 cortes al cargar: llega la ficha sin error', (await titulo()) === 'Ficha del negocio')

  // a') RSC cortado a medias una vez: llega entero, con un solo reintento.
  estado.pedidosRsc = 0
  estado.cortarRscAMedias = 1
  const largo = await pagina.evaluate(async () => {
    const r = await fetch('/negocios/84630bca-1111-4222-8333-444455556666?_rsc=abc', { headers: { RSC: '1' } })
    return (await r.text()).length
  })
  ok('a\') RSC cortado a medias: llega entero', largo === RSC_CUERPO.length, `${largo} bytes, ${estado.pedidosRsc} pedidos`)
  ok('a\') RSC: un reintento, no más', estado.pedidosRsc === 2)

  // POST: el SW no lo intercepta ni lo repite. Chromium por su cuenta reintenta UNA vez una
  // petición cuyo socket reusado se cierra sin responder (medido: también sin SW), así que se
  // compara contra una pestaña de control sin service worker.
  const mandarPost = (p) =>
    p.evaluate(async () => {
      try {
        await fetch('/negocios/84630bca-1111-4222-8333-444455556666', { method: 'POST', body: 'x', headers: { 'Next-Action': 'abc' } })
        return 'llegó'
      } catch {
        return 'falló'
      }
    })
  const contextoControl = await navegador.newContext()
  const control = await contextoControl.newPage()
  await control.route('**/sw.js', (r) => r.abort())
  await control.goto(`${BASE}/negocios/control`)
  estado.posts = 0
  await mandarPost(control)
  await esperar(500)
  const postsSinSw = estado.posts
  await contextoControl.close()
  estado.posts = 0
  const post = await mandarPost(pagina)
  await esperar(500)
  ok(
    'un POST cortado: el SW no agrega reintentos',
    post === 'falló' && estado.posts === postsSinSw,
    `con SW ${estado.posts}, sin SW ${postsSinSw}`,
  )

  // b) sin red: «Reconectando» en vez del error de Chrome; vuelve sola.
  estado.cortarPagina = 1000
  await pagina.goto(`${BASE}/negocios/84630bca-1111-4222-8333-444455556666`).catch(() => {})
  const reconectando = await pagina.evaluate(() => !!document.querySelector('[data-sw-reconectando]'))
  const errorChrome = await pagina.evaluate(() => location.href.startsWith('chrome-error://'))
  ok('b) sin red: se ve «Reconectando», no el error de Chrome', reconectando && !errorChrome)
  estado.cortarPagina = 0
  ok('b) vuelve sola cuando hay red', await esperarHasta(async () => (await titulo()) === 'Ficha del negocio', 15_000))

  // Las fallas anotadas llegan con la carga que sí llega.
  ok(
    'las fallas llegan a /api/red/eventos',
    await esperarHasta(() => estado.eventos.some((e) => e.superficie === 'carga' && e.recuperado === false && e.ruta === '/negocios/[id]')),
    `${estado.eventos.length} eventos: ${[...new Set(estado.eventos.map((e) => `${e.superficie}/${e.recuperado}`))].join(', ')}`,
  )
  ok('… incluida la navegación RSC que se salvó reintentando', estado.eventos.some((e) => e.superficie === 'navegacion' && e.recuperado === true))

  // b con setOffline (red del navegador apagada, no el servidor).
  await contexto.setOffline(true)
  await pagina.goto(`${BASE}/negocios/otro`).catch(() => {})
  const offlineReconectando = await pagina.evaluate(() => !!document.querySelector('[data-sw-reconectando]')).catch(() => false)
  ok('b) setOffline: «Reconectando» en vez del error de Chrome', offlineReconectando)
  await contexto.setOffline(false)
  ok('b) setOffline: vuelve sola', await esperarHasta(async () => (await titulo()) === 'Ficha del negocio', 40_000))

  // d) interruptor de apagado.
  estado.apagado = true
  await pagina.reload() // la navegación dispara la revisión de sw.js
  const desregistrado = await esperarHasta(
    () => pagina.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length === 0),
    20_000,
  )
  ok('d) APAGADO = true desregistra el SW', desregistrado)
  const sinBase = await pagina.evaluate(async () => {
    if (!indexedDB.databases) return true
    return !(await indexedDB.databases()).some((d) => d.name === 'metrik-red-piloto')
  })
  ok('d) y borra su base de eventos', sinBase)
  await pagina.reload()
  ok('d) la siguiente carga ya no está controlada', await pagina.evaluate(() => !navigator.serviceWorker.controller))
} finally {
  await navegador.close()
  servidor.close()
}

const fallas = resultados.filter((r) => !r.ok)
console.log(`\n${resultados.length - fallas.length}/${resultados.length} casos bien`)
process.exit(fallas.length ? 1 : 0)
