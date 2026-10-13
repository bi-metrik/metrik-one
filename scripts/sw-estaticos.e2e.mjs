#!/usr/bin/env node
// Prueba de punta a punta del caché de estáticos del service worker (`public/sw.js`, 2026-10-12)
// en Chromium real, contra un `next start` LOCAL con un proxy que PIERDE conexiones hacia
// `/_next/static/` (lo que vio Mauricio desde Claro móvil el 2026-10-12). No corre en CI:
//
//   VERCEL_DEPLOYMENT_ID=dpl_x npx next build && VERCEL_DEPLOYMENT_ID=dpl_x npx next start -p 3917 &
//   PW_CHROMIUM=/ruta/a/chrome ORIGEN=http://localhost:3917 node scripts/sw-estaticos.e2e.mjs
//
// Requiere `playwright-core` resoluble (o PW_CORE=<ruta>). El proxy corta el socket (como un
// reset de la red) con la probabilidad que toque; `page.route` no sirve aquí porque no ve lo que
// pide el service worker.
//
// Casos:
//   1) Sin SW, pérdida del 40 % (PERDIDA=<n>, SEMILLA=<texto> cambia qué pedidos se pierden): la página igual hidrata (reintentos de la página).
//   2) Con SW instalado y los dos cachés vacíos (SW y HTTP), pérdida del 40 %: hidrata sin aviso.
//   3) Segunda carga con caché HTTP borrado y pérdida del 100 % hacia /_next/static: hidrata,
//      CERO pedidos de estáticos llegan al proxy (todo sale del Cache Storage del SW) y el HTML
//      sí va a la red (el SW no lo guarda).
//   4) Interruptor: sw.js con `APAGADO = true` → el SW se desregistra y borra su caché.

import http from 'node:http'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PW_CORE ?? 'playwright-core')
const ORIGEN = new URL(process.env.ORIGEN ?? 'http://localhost:3917')
const RUTA = process.env.RUTA ?? '/login'
const PERDIDA = Number(process.env.PERDIDA ?? 40)
const SEMILLA = process.env.SEMILLA ?? ''

const estado = { perdida: 0, apagado: false, estaticos: 0, cortados: 0, html: 0, n: 0, rutas: [] }
const azar = (clave) => createHash('md5').update(clave).digest().readUInt32BE(0) % 100

const proxy = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  if (url.pathname.startsWith('/_next/static/')) {
    estado.estaticos++
    estado.rutas.push(url.pathname.split('/').pop())
    if (azar(`${SEMILLA}${req.url}#${estado.n++}`) < estado.perdida) {
      estado.cortados++
      setTimeout(() => req.socket.destroy(), 50)
      return
    }
  }
  if (req.headers.accept?.includes('text/html')) estado.html++
  const sw = url.pathname === '/sw.js'
  const sale = http.request(
    { host: ORIGEN.hostname, port: ORIGEN.port, path: req.url, method: req.method, headers: { ...req.headers, host: ORIGEN.host, 'accept-encoding': 'identity' } },
    (r) => {
      if (sw && estado.apagado) {
        let cuerpo = ''
        r.on('data', (d) => (cuerpo += d))
        r.on('end', () => {
          const nuevo = cuerpo.replace('const APAGADO = false', 'const APAGADO = true')
          const h = { ...r.headers }
          delete h['content-length']
          res.writeHead(r.statusCode, h)
          res.end(nuevo)
        })
        return
      }
      res.writeHead(r.statusCode, r.headers)
      r.pipe(res)
    },
  )
  sale.on('error', () => req.socket.destroy())
  req.pipe(sale)
})
await new Promise((r) => proxy.listen(0, '127.0.0.1', r))
const BASE = `http://localhost:${proxy.address().port}`

const navegador = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined })
const espera = (ms) => new Promise((r) => setTimeout(r, ms))
let fallas = 0
const comprobar = (nombre, cond, detalle) => {
  if (!cond) fallas++
  console.log(`${cond ? 'OK  ' : 'FALLA'} ${nombre}${detalle ? ` -> ${JSON.stringify(detalle)}` : ''}`)
}

/** Carga RUTA y espera a que React hidrate (o se rinda). */
async function cargar(page, ms = 60_000) {
  const t0 = Date.now()
  await page.goto(BASE + RUTA, { waitUntil: 'commit' }).catch(() => {})
  let r = { hidratada: false, aviso: false }
  while (Date.now() - t0 < ms) {
    r = await page
      .evaluate(() => ({ hidratada: !!window.__oneHidratada, aviso: !!document.getElementById('one-aviso-conexion') }))
      .catch(() => r)
    if (r.hidratada || r.aviso) break
    await espera(250)
  }
  return { ...r, ms: Date.now() - t0 }
}

const contadores = () => ({ estaticos: estado.estaticos, cortados: estado.cortados, html: estado.html })
const reiniciar = () => Object.assign(estado, { estaticos: 0, cortados: 0, html: 0, rutas: [] })

try {
  // 1) Sin SW, pérdida del 40 %.
  {
    const ctx = await navegador.newContext({ serviceWorkers: 'block' })
    const page = await ctx.newPage()
    reiniciar()
    estado.perdida = PERDIDA
    const r = await cargar(page)
    comprobar(`1 sin SW, pérdida ${PERDIDA} %: hidrata sin aviso`, r.hidratada && !r.aviso, { ...r, ...contadores() })
    await ctx.close()
  }

  // 2-4) Con SW.
  const ctx = await navegador.newContext()
  const page = await ctx.newPage()
  const cdp = await ctx.newCDPSession(page)
  estado.perdida = 0
  await cargar(page)
  // La app lo registra desde el layout de (app); /login no lo monta: se registra igual que allá.
  await page.evaluate(() => navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }))
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.reload()
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 10_000 })
  await cargar(page)

  // Caché del SW vacío y caché HTTP borrado: cada estático pasa por el reintento del SW.
  await page.evaluate(() => caches.delete('one-estaticos-v1'))
  await cdp.send('Network.clearBrowserCache')
  reiniciar()
  estado.perdida = PERDIDA
  const r2 = await cargar(page)
  // Hidratar no es terminar: el runtime sigue pidiendo chunks diferidos (con sus reintentos).
  // Se espera a que el caché deje de crecer 5 s antes de la segunda carga.
  const enCacheAhora = () => page.evaluate(async () => (await (await caches.open('one-estaticos-v1')).keys()).length)
  let enCache = await enCacheAhora()
  for (let quieto = 0, t = Date.now(); quieto < 20 && Date.now() - t < 60_000; ) {
    await espera(250)
    const n = await enCacheAhora()
    quieto = n === enCache ? quieto + 1 : 0
    enCache = n
  }
  comprobar(`2 con SW, cachés vacíos, pérdida ${PERDIDA} %: hidrata sin aviso`, r2.hidratada && !r2.aviso, { ...r2, ...contadores(), enCache })

  await cdp.send('Network.clearBrowserCache')
  reiniciar()
  estado.perdida = 100
  const r3 = await cargar(page)
  comprobar(
    '3 segunda carga, sin red hacia /_next/static: hidrata desde el caché del SW, 0 estáticos pedidos, HTML de la red',
    r3.hidratada && !r3.aviso && estado.estaticos === 0 && estado.html >= 1,
    { ...r3, ...contadores(), rutas: estado.rutas },
  )

  // 4) Interruptor de apagado.
  estado.perdida = 0
  estado.apagado = true
  // Lo que hace el navegador solo en la siguiente navegación: revisar sw.js contra el servidor.
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.update()).catch(() => {})
  let fin = null
  for (let i = 0; i < 40; i++) {
    await espera(250)
    fin = await page.evaluate(async () => ({
      registros: (await navigator.serviceWorker.getRegistrations()).length,
      caches: await caches.keys(),
    }))
    if (fin.registros === 0 && fin.caches.length === 0) break
  }
  comprobar('4 APAGADO: se desregistra y borra su caché', fin.registros === 0 && fin.caches.length === 0, fin)
  await ctx.close()
} finally {
  await navegador.close()
  proxy.close()
}
process.exit(fallas ? 1 : 0)
