#!/usr/bin/env node
// Prueba de punta a punta del aviso "No pudimos conectar con ONE" (`src/lib/red/aviso-conexion.ts`)
// en Chromium real, contra un `next start` LOCAL. No corre en CI (necesita navegador y build):
//
//   npx next build && npx next start -p 3917 &
//   PW_CHROMIUM=/ruta/a/chrome BASE=http://localhost:3917 node scripts/aviso-conexion.e2e.mjs [A B ...]
//
// Requiere `playwright-core` resoluble (p. ej. `npm i --no-save playwright-core`, o PW_CORE=<ruta>).
// La falla de red se simula con `page.route` sobre `/_next/static/chunks/**` (lo que vio Deisy
// desde Claro/Telmex el 2026-10-06). `/api/errores-cliente` se intercepta: nada sale del equipo.
//
// Casos:
//   A) carga normal de /login: sin aviso, React hidrata, formulario visible.
//   B) chunks abortados (connection reset): aviso a pantalla completa a los ~3 s, causa `chunk`.
//   C) chunks lentos 12 s pero sanos: sin aviso.
//   D) chunks colgados sin error, JS Y CSS (la pantalla en blanco): aviso a los 20 s, causa
//      `sin-hidratar`, y PINTADO (la hoja colgada bloqueaba el pintado: el script la quita).
//      Con SHOTS=<carpeta> deja la captura.
//   G) solo el JS colgado (la portada del login sin formulario): aviso a los 20 s.
//   E) chunks de 23 s: el aviso sale a los 20 s y se quita solo al hidratar, y las hojas de
//      estilo que el aviso quito vuelven.
//   F) espera con tope (CSS): un fallback con el aviso diferido lo muestra al vencer, y se reporta
//      una vez con su causa.

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
  console.log(`${cond ? 'OK  ' : 'FALLA'} ${nombre}${cond ? '' : ` -> ${JSON.stringify(detalle)}`}`)
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
  while (Date.now() - t0 < esperaMs) {
    const hay = await page.evaluate(() => !!document.getElementById('one-aviso-conexion')).catch(() => false)
    if (hay && aparecio === null) aparecio = Date.now() - t0
    if (!hay && aparecio !== null && desaparecio === null) desaparecio = Date.now() - t0
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
  return { aparecio, desaparecio, ...final, avisos, consola }
}

const chunks = '**/_next/static/chunks/**'
const casos = {
  async A() {
    const r = await escenario('/login?redirectTo=%2Fnegocios', null, 25_000)
    comprobar('A normal: sin aviso, hidrata, formulario', r.aparecio === null && r.hidratada && r.form && r.avisos.length === 0 && !r.consola.some((c) => /hydrat/i.test(c)), r)
  },
  async B() {
    const r = await escenario('/login?redirectTo=%2Fnegocios', (p) => p.route(chunks, (x) => x.abort('connectionreset')), 8_000)
    comprobar(
      'B chunks abortados: aviso a los ~3 s, causa chunk, una vez',
      r.aparecio !== null && r.aparecio < 6_000 && /No pudimos conectar con ONE/.test(r.aviso ?? '') && r.avisos.join() === 'chunk',
      r,
    )
  },
  async C() {
    const r = await escenario('/login', (p) => p.route(chunks, async (x) => { await espera(12_000); await x.continue() }), 25_000)
    comprobar('C lenta pero sana (12 s): sin aviso', r.aparecio === null && r.hidratada && r.avisos.length === 0, r)
  },
  async D() {
    const r = await escenario('/tableros', (p) => p.route(chunks, () => {}), 23_000, null, 'D-todo-colgado')
    comprobar(
      'D JS y CSS colgados: aviso a los 20 s, causa sin-hidratar, pintado',
      r.aparecio !== null && r.aparecio >= 19_000 && r.aparecio < 22_500 && r.avisos.join() === 'sin-hidratar' && r.pintado,
      r,
    )
  },
  async G() {
    const r = await escenario('/login?redirectTo=%2Fnegocios', (p) => p.route('**/_next/static/chunks/*.js', () => {}), 23_000, null, 'G-js-colgado')
    comprobar(
      'G solo JS colgado: aviso a los 20 s, causa sin-hidratar',
      r.aparecio !== null && r.aparecio >= 19_000 && r.avisos.join() === 'sin-hidratar' && r.pintado,
      r,
    )
  },
  async E() {
    const r = await escenario('/login', (p) => p.route(chunks, async (x) => { await espera(23_000); await x.continue() }), 32_000)
    comprobar('E hidrata a los 23 s: el aviso sale y se quita solo', r.aparecio !== null && r.desaparecio !== null && r.hidratada && r.form && r.hojasCargadas >= 1, r)
  },
  async F() {
    // Un fallback como el de `EsperaConLimite`, con 3 s en vez de 25 para no esperar.
    const r = await escenario('/login', null, 6_000, async (page) => {
      await page.waitForFunction(() => !!window.__oneHidratada)
      await page.evaluate(() => {
        const caja = document.createElement('div')
        caja.innerHTML =
          '<div style="visibility:hidden;animation:one-aviso-conexion-aparecer 1ms linear 3000ms forwards" data-one-aviso-causa="espera-ruta">No pudimos conectar con ONE</div>'
        document.body.appendChild(caja)
      })
    })
    comprobar('F espera con tope: CSS lo muestra y se reporta una vez', r.diferido === 'visible' && r.avisos.join() === 'espera-ruta', r)
  },
}

const elegidos = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(casos)
await Promise.all(elegidos.map((k) => casos[k]()))
await browser.close()
process.exit(fallas ? 1 : 0)
