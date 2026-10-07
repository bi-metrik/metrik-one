#!/usr/bin/env node
// Prueba de punta a punta del aviso "No pudimos conectar con ONE" y de la tolerancia a red lenta
// (`src/lib/red/aviso-conexion.ts`) en Chromium real, contra un `next start` LOCAL. No corre en
// CI (necesita navegador y build):
//
//   npx next build && npx next start -p 3917 &
//   PW_CHROMIUM=/ruta/a/chrome BASE=http://localhost:3917 node scripts/aviso-conexion.e2e.mjs [A B ...]
//
// Requiere `playwright-core` resoluble (p. ej. `npm i --no-save playwright-core`, o PW_CORE=<ruta>).
// La red se simula con `page.route` sobre `/_next/static/chunks/**` (lo que vio Deisy desde
// Claro/Telmex el 2026-10-06, y Mauricio/SOENA el 2026-10-07). `/api/errores-cliente` se
// intercepta: nada sale del equipo.
//
// Casos:
//   A) carga normal de /login: sin aviso, sin píldora, React hidrata, formulario visible.
//   B) chunks abortados SIEMPRE (connection reset): se reintentan 3 veces (1, 3, 8 s) y recién
//      entonces el aviso, causa `chunk`.
//   C) chunks lentos 12 s pero sanos: píldora «conexión lenta», sin aviso, hidrata.
//   D) chunks colgados sin error, JS Y CSS (la pantalla en blanco): aviso a los 25 s sin
//      avance, causa `sin-hidratar`, y PINTADO (la hoja colgada bloqueaba el pintado: el script
//      la quita). Con SHOTS=<carpeta> deja la captura.
//   G) solo el JS colgado (la portada del login sin formulario): aviso a los 25 s.
//   E) chunks de 23 s: hidrata SIN que salga el aviso (antes del 2026-10-07 salía a los 20 s).
//   F) espera con tope (CSS): un fallback con el aviso diferido lo muestra al vencer, y se reporta
//      una vez con su causa.
//   H) LA RED DEL 2026-10-07: cada chunk tarda 8 a 15 s y llega entero. Sin aviso, con píldora,
//      hidrata. (Antes de este cambio: aviso a los 20 s sobre una carga sana.)
//   I) cada chunk falla la PRIMERA vez (connection reset) y baja al reintento: hidrata sin aviso.
//      (Antes: aviso `chunk` a los 3 s y la página no hidrataba nunca.)

import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PW_CORE ?? 'playwright-core')
const BASE = process.env.BASE ?? 'http://localhost:3917'
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM })
const espera = (ms) => new Promise((r) => setTimeout(r, ms))
let fallas = 0

function comprobar(nombre, cond, detalle) {
  if (!cond) fallas++
  const { consola: _consola, ...resumen } = detalle ?? {}
  const ver = !cond || process.env.DETALLE
  console.log(`${cond ? 'OK  ' : 'FALLA'} ${nombre}${ver ? ` -> ${JSON.stringify(cond ? resumen : detalle)}` : ''}`)
}

/** Espera determinista por URL entre `min` y `max` ms (la misma URL tarda lo mismo siempre). */
function demora(url, min, max) {
  let h = 0
  for (const c of url) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return min + (h % (max - min + 1))
}

async function escenario(ruta, preparar, esperaMs, despues, captura) {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  const reportes = []
  const consola = []
  page.on('console', (m) => { if (m.type() === 'error') consola.push(m.text().slice(0, 200)) })
  await page.route('**/api/errores-cliente', async (r) => {
    reportes.push(JSON.parse(r.request().postData() || '{}'))
    await r.fulfill({ status: 204 })
  })
  if (preparar) await preparar(page)
  const t0 = Date.now()
  await page.goto(BASE + ruta, { waitUntil: 'commit' })
  if (despues) await despues(page)
  let aparecio = null
  let desaparecio = null
  let pildora = null
  let hidratoEn = null
  while (Date.now() - t0 < esperaMs) {
    const e = await page
      .evaluate(() => ({
        aviso: !!document.getElementById('one-aviso-conexion'),
        lenta: !!document.getElementById('one-aviso-lenta'),
        hidratada: !!window.__oneHidratada,
      }))
      .catch(() => ({ aviso: false, lenta: false, hidratada: false }))
    const t = Date.now() - t0
    if (e.aviso && aparecio === null) aparecio = t
    if (!e.aviso && aparecio !== null && desaparecio === null) desaparecio = t
    if (e.lenta && pildora === null) pildora = t
    if (e.hidratada && hidratoEn === null) hidratoEn = t
    await espera(250)
  }
  const final = await page.evaluate(() => ({
    aviso: document.getElementById('one-aviso-conexion')?.innerText ?? null,
    hidratada: !!window.__oneHidratada,
    form: !!document.querySelector('input[type=email]'),
    hojasCargadas: [...document.querySelectorAll('link[rel="stylesheet"]')].filter((l) => l.sheet).length,
    diferido: (() => {
      const el = document.querySelector('[data-one-aviso-causa]')
      return el ? getComputedStyle(el).visibility : null
    })(),
  }))
  const avisos = reportes.filter((r) => r.message === 'aviso-conexion-mostrado').map((r) => r.causa)
  const otros = reportes.filter((r) => r.message !== 'aviso-conexion-mostrado').map((r) => `${r.message}${r.recuperado === undefined ? '' : `:${r.recuperado}`}`)
  // Captura por CDP: la de Playwright espera a las fuentes, y con la hoja colgada no llegan.
  // `pintado` = el compositor entrega un cuadro con el aviso (una hoja pendiente lo bloqueaba).
  const cdp = await ctx.newCDPSession(page)
  const cuadro = await Promise.race([
    cdp.send('Page.captureScreenshot', { format: 'png' }).then((r) => r.data),
    espera(5_000).then(() => null),
  ])
  final.pintado = !!cuadro
  if (cuadro && captura && process.env.SHOTS) writeFileSync(`${process.env.SHOTS}/${captura}.png`, Buffer.from(cuadro, 'base64'))
  await ctx.close()
  return { aparecio, desaparecio, pildora, hidratoEn, ...final, avisos, otros, consola }
}

const chunks = '**/_next/static/chunks/**'
const casos = {
  async A() {
    const r = await escenario('/login?redirectTo=%2Fnegocios', null, 25_000)
    comprobar('A normal: sin aviso ni píldora, hidrata, formulario', r.aparecio === null && r.pildora === null && r.hidratada && r.form && r.avisos.length === 0 && !r.consola.some((c) => /hydrat/i.test(c)), r)
  },
  async B() {
    const r = await escenario('/login?redirectTo=%2Fnegocios', (p) => p.route(chunks, (x) => x.abort('connectionreset')), 25_000)
    comprobar(
      'B chunks abortados siempre: 3 reintentos y luego aviso (causa chunk, una vez)',
      r.aparecio !== null && r.aparecio > 12_000 && r.aparecio < 20_000 && /No pudimos conectar con ONE/.test(r.aviso ?? '') && r.avisos.join() === 'chunk',
      r,
    )
  },
  async C() {
    const r = await escenario('/login', (p) => p.route(chunks, async (x) => { await espera(12_000); await x.continue() }), 25_000)
    comprobar('C lenta pero sana (12 s): sin aviso, hidrata', r.aparecio === null && r.hidratada && r.avisos.length === 0, r)
  },
  async D() {
    const r = await escenario('/tableros', (p) => p.route(chunks, () => {}), 30_000, null, 'D-todo-colgado')
    comprobar(
      'D JS y CSS colgados: aviso a los ~25 s, causa sin-hidratar, pintado',
      r.aparecio !== null && r.aparecio >= 24_000 && r.aparecio < 28_500 && r.avisos.join() === 'sin-hidratar' && r.pintado,
      r,
    )
  },
  async G() {
    const r = await escenario('/login?redirectTo=%2Fnegocios', (p) => p.route('**/_next/static/chunks/*.js', () => {}), 30_000, null, 'G-js-colgado')
    comprobar(
      'G solo JS colgado: píldora a los 8 s y aviso a los ~25 s, causa sin-hidratar',
      r.pildora !== null && r.pildora < 10_000 && r.aparecio !== null && r.aparecio >= 24_000 && r.avisos.join() === 'sin-hidratar' && r.pintado,
      r,
    )
  },
  async E() {
    const r = await escenario('/login', (p) => p.route(chunks, async (x) => { await espera(23_000); await x.continue() }), 32_000)
    comprobar('E hidrata a los 23 s: sin aviso, con píldora, hojas cargadas', r.aparecio === null && r.pildora !== null && r.hidratada && r.form && r.hojasCargadas >= 1, r)
  },
  async F() {
    // Un fallback como el de `EsperaConLimite`, con 3 s en vez de 45 para no esperar.
    const r = await escenario('/login', null, 6_000, async (page) => {
      await page.waitForFunction(() => !!window.__oneHidratada)
      await page.evaluate(() => {
        const caja = document.createElement('div')
        caja.innerHTML =
          '<p style="visibility:hidden;animation:one-aviso-conexion-lenta 1ms linear 1000ms forwards" data-one-lenta-causa="navegacion">lenta</p>' +
          '<div style="visibility:hidden;animation:one-aviso-conexion-aparecer 1ms linear 3000ms forwards" data-one-aviso-causa="espera-ruta">No pudimos conectar con ONE</div>'
        document.body.appendChild(caja)
      })
    })
    comprobar(
      'F espera con tope: la línea lenta y luego el aviso, cada uno reportado una vez',
      r.diferido === 'visible' && r.avisos.join() === 'espera-ruta' && r.otros.includes('conexion-lenta-mostrada'),
      r,
    )
  },
  async H() {
    // De a 4 a la vez: con pérdida de paquetes, los chunks de una conexión HTTP/2 se estorban
    // entre sí; así la carga entera pasa de los 20 s aunque cada chunk llegue (como el 7-oct).
    let enCurso = 0
    const cola = []
    const turno = () => new Promise((r) => { if (enCurso < 4) { enCurso++; r() } else cola.push(r) })
    const soltar = () => { const s = cola.shift(); if (s) s(); else enCurso-- }
    const r = await escenario(
      '/login?redirectTo=%2Fnegocios',
      (p) => p.route(chunks, async (x) => {
        await turno()
        await espera(demora(x.request().url(), 8_000, 15_000))
        soltar()
        await x.continue()
      }),
      75_000,
      null,
      'H-red-lenta',
    )
    comprobar('H cada chunk 8-15 s, de a 4: sin aviso, con píldora, hidrata', r.aparecio === null && r.pildora !== null && r.hidratada && r.form && r.avisos.length === 0, r)
  },
  async I() {
    const vistos = new Set()
    const r = await escenario(
      '/login?redirectTo=%2Fnegocios',
      (p) => p.route(chunks, async (x) => {
        const u = x.request().url()
        if (!vistos.has(u)) { vistos.add(u); await x.abort('connectionreset'); return }
        await x.continue()
      }),
      25_000,
    )
    comprobar('I cada chunk falla la primera vez y baja al reintento: hidrata sin aviso', r.aparecio === null && r.hidratada && r.form && r.avisos.length === 0, r)
  },
}

const elegidos = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(casos)
await Promise.all(elegidos.map((k) => casos[k]()))
await browser.close()
process.exit(fallas ? 1 : 0)
