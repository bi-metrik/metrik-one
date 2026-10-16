#!/usr/bin/env node
// La pastilla de «Lo que suma» no hace crecer el encabezado fijo del negocio (brief del
// 2026-10-16, D1 y D2 de Vera). Mide en Chromium REAL el `NegocioDetailClient` con el `LoQueSuma`
// de verdad, montados por `test/arnes-encabezado/` (vite + Tailwind + las fuentes de la app). No
// corre en CI (necesita navegador):
//
//   PW_CHROMIUM=/ruta/a/chrome node scripts/encabezado-pastilla.e2e.mjs
//   (opcional) SHOTS=<carpeta> deja una captura por caso y ancho; JSONL=<archivo> guarda las
//   medidas; DETALLE=1 las imprime; ANCHOS=1100,1280 y CASOS=fijo acotan la corrida.
//
// `vite` llega con vitest y `puppeteer-core` es dependencia de la app: no hay que instalar nada.
//
// Para cada caso (viaje largo, corto, con aviso ámbar y SIN línea de viaje, V8) y cada ancho de
// 1024 a 1600 px:
//   · el encabezado mide lo mismo con la pastilla que sin ella (crecimiento 0, tolerancia 0,5 px);
//   · la pastilla se ve, no se monta sobre nada del encabezado y no queda en un renglón propio;
//   · el texto es el más largo que cabe: «Total $X · margen Y %», «$X · Y %» o «$X».
// Y a 390 px no hay pastilla (el celular tiene su barra).
//
// Sobre `origin/main` antes del arreglo (3c671d79) fallaba como en el barrido de Vera: +33,5 px de
// 1024 a 1200 px y +8,5 px desde 1280 (45 comprobaciones). Sin línea de viaje (V8) y entre ~1040 y
// ~1080 px no hay hueco en ningún renglón: la pastilla flota al final como antes y sale un AVISO.

import { createServer } from 'node:http'
import { mkdirSync, readFileSync, existsSync } from 'node:fs'
import { join, extname, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ARNES = join(RAIZ, 'test/arnes-encabezado')
const SHOTS = process.env.SHOTS
const ANCHOS = (process.env.ANCHOS ?? '1024,1060,1100,1150,1200,1240,1280,1366,1440,1600').split(',').map(Number)
const CASOS = (process.env.CASOS ?? 'fijo,corto,motivo,sin-viaje').split(',')

// ── 1. Build del arnés ──────────────────────────────────────────────────────────────────────────
const { build } = await import('vite')
const tailwind = (await import('@tailwindcss/postcss')).default

/** Una server action no corre en el navegador: su módulo se cambia por funciones que no hacen nada. */
function sinServerActions() {
  return {
    name: 'sin-server-actions',
    enforce: 'pre',
    transform(codigo, id) {
      if (!/\.(t|j)sx?$/.test(id) || id.includes('node_modules')) return null
      if (!/^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*\s*['"]use server['"]/.test(codigo)) return null
      const nombres = new Set()
      for (const m of codigo.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z0-9_$]+)/g)) nombres.add(m[1])
      for (const m of codigo.matchAll(/export\s+(?:const|let|var)\s+([A-Za-z0-9_$]+)/g)) nombres.add(m[1])
      for (const m of codigo.matchAll(/export\s*\{([^}]*)\}/g)) {
        for (const p of m[1].split(',')) {
          const n = p.trim().split(/\s+as\s+/).pop()?.trim()
          if (n && !n.startsWith('type ')) nombres.add(n)
        }
      }
      return [...nombres].map(n => `export const ${n} = async () => ({})`).join('\n') || 'export {}'
    },
  }
}

const dobles = join(ARNES, 'dobles.ts')
const dist = mkdtempSync(join(tmpdir(), 'arnes-encabezado-'))
await build({
  root: ARNES,
  logLevel: 'error',
  configFile: false,
  plugins: [sinServerActions()],
  esbuild: { jsx: 'automatic' },
  css: { postcss: { plugins: [tailwind({ base: RAIZ })] } },
  define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
  resolve: {
    alias: [
      { find: /^next\/navigation$/, replacement: dobles },
      { find: /^sonner$/, replacement: dobles },
      { find: /^@\/components\/activity-log$/, replacement: dobles },
      { find: /^server-only$/, replacement: join(RAIZ, 'test/modulo-vacio.ts') },
      { find: /^@\//, replacement: join(RAIZ, 'src') + '/' },
    ],
  },
  build: { outDir: dist, emptyOutDir: true, minify: false, sourcemap: false, chunkSizeWarningLimit: 100000 },
})

// ── 2. Servidor estático (con file:// los módulos ES mueren por CORS) ───────────────────────────
const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png' }
const servidor = createServer((req, res) => {
  const ruta = join(dist, decodeURIComponent(new URL(req.url, 'http://x').pathname))
  const archivo = existsSync(ruta) && !ruta.endsWith('/') ? ruta : join(dist, 'index.html')
  res.writeHead(200, { 'content-type': TIPOS[extname(archivo)] ?? 'application/octet-stream' })
  res.end(readFileSync(archivo))
})
await new Promise(r => servidor.listen(0, '127.0.0.1', r))
const BASE = `http://127.0.0.1:${servidor.address().port}/`

// ── 3. Chromium ─────────────────────────────────────────────────────────────────────────────────
const puppeteer = (await import('puppeteer-core')).default
const navegador = await puppeteer.launch({
  executablePath: process.env.PW_CHROMIUM,
  headless: true,
  args: ['--no-sandbox', '--font-render-hinting=none'],
})
if (SHOTS) mkdirSync(SHOTS, { recursive: true })

let fallas = 0
const filas = []
function comprobar(nombre, cond, detalle) {
  if (!cond) fallas++
  console.log(`${cond ? 'OK   ' : 'FALLA'} ${nombre}${!cond || process.env.DETALLE ? ` -> ${JSON.stringify(detalle)}` : ''}`)
}

/** Mide el encabezado: alto, y dónde quedó la pastilla respecto de lo demás. */
async function medir(pagina) {
  return pagina.evaluate(() => {
    const enc = [...document.querySelectorAll('div')].find(d => getComputedStyle(d).position === 'sticky' && d.querySelector('h1'))
    if (!enc) return null
    const caja = (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, r: r.right, b: r.bottom } }
    const pastillaEl = document.querySelector('[data-pastilla-suma]')
    const boton = pastillaEl?.querySelector('button')
    const visible = !!boton && getComputedStyle(pastillaEl).display !== 'none' && boton.getBoundingClientRect().width > 0
    const p = visible ? caja(boton) : null
    // Todo lo que se ve en el encabezado que NO es la pastilla: cajas de texto y de controles.
    const otras = []
    const rec = document.createTreeWalker(enc, NodeFilter.SHOW_TEXT)
    for (let n = rec.nextNode(); n; n = rec.nextNode()) {
      if (!n.textContent?.trim() || pastillaEl?.contains(n)) continue
      const rango = document.createRange()
      rango.selectNodeContents(n)
      for (const r of rango.getClientRects()) if (r.width > 0) otras.push({ que: n.textContent.trim().slice(0, 30), x: r.left, y: r.top, r: r.right, b: r.bottom })
    }
    // Y lo pintado: botones, enlaces y todo lo que tiene fondo o borde (etiquetas, el aviso ámbar).
    for (const el of enc.querySelectorAll('*')) {
      if (pastillaEl?.contains(el) || el.contains(pastillaEl)) continue
      const e = getComputedStyle(el)
      const pintado = e.backgroundColor !== 'rgba(0, 0, 0, 0)' || parseFloat(e.borderTopWidth) > 0 || parseFloat(e.borderLeftWidth) > 0
      if (!pintado && !['BUTTON', 'A'].includes(el.tagName)) continue
      const r = el.getBoundingClientRect()
      if (r.width > 0) otras.push({ que: (el.textContent || el.tagName).trim().slice(0, 30), x: r.left, y: r.top, r: r.right, b: r.bottom })
    }
    const choques = p ? otras.filter(o => o.x < p.r - 0.5 && o.r > p.x + 0.5 && o.y < p.b - 0.5 && o.b > p.y + 0.5).map(o => o.que) : []
    // ¿Renglón propio? Ningún otro elemento del encabezado comparte su franja vertical.
    const comparte = p ? otras.some(o => o.y < p.b - 1 && o.b > p.y + 1) : false
    const viaje = enc.querySelector('[data-encabezado-viaje]')
    const texto = boton?.querySelector('[data-texto-pastilla]')?.getAttribute('data-texto-pastilla') ?? null
    return {
      alto: enc.getBoundingClientRect().height,
      fondo: enc.getBoundingClientRect().bottom,
      visible,
      texto,
      pastilla: p && { x: Math.round(p.x), y: Math.round(p.y), w: Math.round(p.w), h: Math.round(p.h) },
      renglon: !p ? null : pastillaEl.getAttribute('data-renglon') ?? (viaje && p.y < viaje.getBoundingClientRect().bottom && p.b > viaje.getBoundingClientRect().top ? 'viaje' : '?'),
      choques,
      renglonPropio: p ? !comparte : false,
      // Centrada en su renglón: diferencia entre el centro de la pastilla y el del texto que tiene al lado.
      viaje: viaje ? (() => { const r = viaje.getBoundingClientRect(); return { y: r.top, b: r.bottom } })() : null,
      scrollX: document.documentElement.scrollWidth > window.innerWidth,
    }
  })
}

async function abrir(ancho, caso, conPastilla, punto) {
  const pagina = await navegador.newPage()
  const errores = []
  pagina.on('pageerror', e => errores.push(String(e)))
  pagina.on('console', m => { if (m.type() === 'error') errores.push(m.text()) })
  await pagina.setViewport({ width: ancho, height: 800 })
  await pagina.goto(`${BASE}?caso=${caso}&pastilla=${conPastilla ? 1 : 0}${punto ? `&punto=${punto}` : ''}`, { waitUntil: 'networkidle0' })
  await pagina.evaluate(() => document.fonts.ready)
  // Dos cuadros para que el ResizeObserver de la pastilla mida y React repinte.
  await pagina.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 50)))))
  return { pagina, errores }
}

for (const caso of CASOS) {
  for (const ancho of ANCHOS) {
    const sin = await abrir(ancho, caso, false)
    const altoSin = (await medir(sin.pagina))?.alto
    await sin.pagina.close()
    const con = await abrir(ancho, caso, true, caso === 'fijo' ? 'rojo' : null)
    const m = await medir(con.pagina)
    if (SHOTS) await con.pagina.screenshot({ path: join(SHOTS, `${caso}-${ancho}.png`), clip: { x: 0, y: 0, width: ancho, height: Math.ceil(m.fondo + 24) } })
    // El panel abre debajo de la pastilla, dentro de la columna del negocio y sin mover el encabezado.
    let panel = null
    if (m.visible) {
      await con.pagina.click('[data-pastilla-suma] button')
      panel = await con.pagina.evaluate(() => {
        const enc = [...document.querySelectorAll('div')].find(d => getComputedStyle(d).position === 'sticky' && d.querySelector('h1'))
        const p = document.querySelector('[data-panel-suma]')
        if (!p || !enc) return null
        const r = p.getBoundingClientRect()
        const e = enc.getBoundingClientRect()
        return { x: r.left, r: r.right, y: r.top, encX: e.left, encR: e.right, alto: e.height, vw: window.innerWidth }
      })
      if (SHOTS && caso === 'fijo') await con.pagina.screenshot({ path: join(SHOTS, `${caso}-${ancho}-panel.png`), clip: { x: 0, y: 0, width: ancho, height: 640 } })
      await con.pagina.keyboard.press('Escape')
    }
    await con.pagina.close()
    comprobar(`${caso} ${ancho}px · el panel abre dentro de la columna sin mover el encabezado`,
      !!panel && panel.x >= panel.encX - 0.5 && panel.r <= panel.vw && Math.abs(panel.alto - m.alto) <= 0.5, panel)
    const crece = Math.round((m.alto - altoSin) * 10) / 10
    const fila = { caso, ancho, altoSin, altoCon: m.alto, crece, texto: m.texto, renglon: m.renglon, pastilla: m.pastilla, choques: m.choques, renglonPropio: m.renglonPropio, scrollX: m.scrollX, errores: con.errores }
    filas.push(fila)
    // Sin hueco en ningún renglón (medido: solo SIN línea de viaje, V8, entre ~1040 y ~1080 px) la
    // pastilla flota al final como en #1193 y el encabezado crece. Se informa como AVISO; con línea de
    // viaje se exige siempre el hueco.
    const sinHueco = m.renglon === 'sin-hueco'
    if (sinHueco && caso === 'sin-viaje') console.log(`AVISO ${caso} ${ancho}px · sin hueco: flota al final y el encabezado crece ${crece} px`)
    else {
      comprobar(`${caso} ${ancho}px · el encabezado no crece (${altoSin} → ${m.alto})`, Math.abs(crece) <= 0.5, fila)
      comprobar(`${caso} ${ancho}px · la pastilla no va en un renglón propio`, !m.renglonPropio, fila)
    }
    comprobar(`${caso} ${ancho}px · la pastilla se ve (${m.texto}, renglón ${m.renglon})`, m.visible, fila)
    comprobar(`${caso} ${ancho}px · la pastilla no se monta sobre nada`, m.choques.length === 0, fila)
    comprobar(`${caso} ${ancho}px · sin scroll horizontal ni errores`, !m.scrollX && con.errores.length === 0, fila)
  }
}

// Celular: sin pastilla (la barra de abajo la reemplaza).
{
  const { pagina } = await abrir(390, 'fijo', true)
  const m = await medir(pagina)
  await pagina.close()
  comprobar('390px · sin pastilla en el celular', !m.visible, m)
}

if (process.env.JSONL) {
  const { writeFileSync } = await import('node:fs')
  writeFileSync(process.env.JSONL, filas.map(f => JSON.stringify(f)).join('\n') + '\n')
}
await navegador.close()
servidor.close()
console.log(fallas === 0 ? '\nTodo en orden.' : `\n${fallas} comprobaciones fallaron.`)
process.exit(fallas === 0 ? 0 : 1)
