#!/usr/bin/env node
// En celular el «+» del shell no tapa el botón «Lo que suma» de la barra de abajo (brief del
// 2026-10-16, punto 2; observación de Vera en V10). Mide en Chromium REAL el `FAB` y el `LoQueSuma`
// de verdad, montados por `test/arnes-boton-mas/` (vite + Tailwind). No corre en CI (necesita
// navegador):
//
//   PW_CHROMIUM=/ruta/a/chrome node scripts/boton-mas-barra.e2e.mjs
//   (opcional) SHOTS=<carpeta> deja las capturas; DETALLE=1 imprime cada medida.
//
// `vite` llega con vitest y `puppeteer-core` es dependencia de la app: no hay que instalar nada.
//
// Comprueba, a 390 y 1023 px con la barra: los dos se ven y se pueden tocar (prueba de impacto con
// `elementFromPoint` en 15 puntos de cada uno), no se tocan, y el menú del «+» abre por encima de la
// barra. Sin la barra (cualquier otra pantalla, o el interruptor apagado) y a 1280 px con la barra
// (escondida), el «+» queda exactamente donde estaba: 80 px sobre el borde de abajo.
//
// Sobre `origin/main` antes del arreglo (a2c64e9a) falla a 390 y a 1023 px: el «+» tapa parte de
// «Lo que suma» y de «Cerrar», y queda dentro de la barra (8 comprobaciones).

import { createServer } from 'node:http'
import { mkdirSync, readFileSync, existsSync, mkdtempSync } from 'node:fs'
import { join, extname, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ARNES = join(RAIZ, 'test/arnes-boton-mas')
const SHOTS = process.env.SHOTS

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
      return [...nombres].map(n => `export const ${n} = async () => ({})`).join('\n') || 'export {}'
    },
  }
}

const dobles = join(ARNES, 'dobles.ts')
const dist = mkdtempSync(join(tmpdir(), 'arnes-boton-mas-'))
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
      { find: /^next\/dynamic$/, replacement: dobles },
      { find: /^sonner$/, replacement: dobles },
      { find: /^server-only$/, replacement: join(RAIZ, 'test/modulo-vacio.ts') },
      { find: /^@\//, replacement: join(RAIZ, 'src') + '/' },
    ],
  },
  build: { outDir: dist, emptyOutDir: true, minify: false, sourcemap: false, chunkSizeWarningLimit: 100000 },
})

const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' }
const servidor = createServer((req, res) => {
  const ruta = join(dist, decodeURIComponent(new URL(req.url, 'http://x').pathname))
  const archivo = existsSync(ruta) && !ruta.endsWith('/') ? ruta : join(dist, 'index.html')
  res.writeHead(200, { 'content-type': TIPOS[extname(archivo)] ?? 'application/octet-stream' })
  res.end(readFileSync(archivo))
})
await new Promise(r => servidor.listen(0, '127.0.0.1', r))
const BASE = `http://127.0.0.1:${servidor.address().port}/`

const puppeteer = (await import('puppeteer-core')).default
const navegador = await puppeteer.launch({ executablePath: process.env.PW_CHROMIUM, headless: true, args: ['--no-sandbox'] })
if (SHOTS) mkdirSync(SHOTS, { recursive: true })

let fallas = 0
function comprobar(nombre, cond, detalle) {
  if (!cond) fallas++
  console.log(`${cond ? 'OK   ' : 'FALLA'} ${nombre}${!cond || process.env.DETALLE ? ` -> ${JSON.stringify(detalle)}` : ''}`)
}

async function abrir(ancho, conBarra) {
  const pagina = await navegador.newPage()
  const errores = []
  pagina.on('pageerror', e => errores.push(String(e)))
  pagina.on('console', m => { if (m.type() === 'error') errores.push(m.text()) })
  await pagina.setViewport({ width: ancho, height: 844, deviceScaleFactor: 2 })
  await pagina.goto(`${BASE}?barra=${conBarra ? 1 : 0}`, { waitUntil: 'networkidle0' })
  // La transición del «+» (`transition-all`, 150 ms) y el ResizeObserver de la barra.
  await new Promise(r => setTimeout(r, 400))
  return { pagina, errores }
}

/** Dónde quedó cada uno y qué hay de verdad bajo el centro de cada uno. */
async function medir(pagina) {
  return pagina.evaluate(() => {
    const caja = el => { if (!el) return null; const r = el.getBoundingClientRect(); return r.width ? { x: r.left, y: r.top, r: r.right, b: r.bottom } : null }
    const fab = document.querySelector('button.fixed.bottom-20')
    const barra = document.querySelector('[data-barra-suma]')
    const boton = barra && [...barra.querySelectorAll('button')].find(b => /Lo que suma|Cerrar/.test(b.textContent))
    // Una rejilla de 5 × 3 puntos dentro de la caja (a 3 px del borde): TODOS tienen que caer en él.
    // Con solo el centro no basta: el «+» es redondo y a 390 px tapaba el texto sin tapar el centro.
    // El «+» es un círculo: su rejilla va dentro del cuadrado inscrito.
    const golpe = (el, redondo = false) => {
      const c0 = caja(el)
      if (!c0) return null
      const m = redondo ? (c0.r - c0.x) * 0.15 : 0
      const c = { x: c0.x + m, y: c0.y + m, r: c0.r - m, b: c0.b - m }
      for (let i = 0; i < 5; i++) for (let j = 0; j < 3; j++) {
        const t = document.elementFromPoint(c.x + 3 + (c.r - c.x - 6) * i / 4, c.y + 3 + (c.b - c.y - 6) * j / 2)
        if (!(t === el || el.contains(t))) return false
      }
      return true
    }
    const f = caja(fab)
    const s = caja(boton)
    return {
      fab: f,
      fondoFab: f ? window.innerHeight - f.b : null,
      botonSuma: s,
      barra: caja(barra),
      tocaFab: golpe(fab, true),
      tocaSuma: s ? golpe(boton) : null,
      seTocan: !!(f && s && f.x < s.r && f.r > s.x && f.y < s.b && f.b > s.y),
    }
  })
}

// Con la barra, en celular y en tableta.
for (const ancho of [390, 1023]) {
  const { pagina, errores } = await abrir(ancho, true)
  const m = await medir(pagina)
  if (SHOTS) await pagina.screenshot({ path: join(SHOTS, `barra-${ancho}.png`) })
  comprobar(`${ancho}px · se puede tocar «Lo que suma» (el «+» no está encima)`, m.tocaSuma === true, m)
  comprobar(`${ancho}px · se puede tocar el «+»`, m.tocaFab === true, m)
  comprobar(`${ancho}px · el «+» y «Lo que suma» no se tocan`, !m.seTocan, m)
  comprobar(`${ancho}px · el «+» queda por encima de la barra`, !!m.fab && !!m.barra && m.fab.b <= m.barra.y - 8, m)
  // El menú del «+» abre por encima de la barra y del «+».
  await pagina.click('button.fixed.bottom-20')
  await new Promise(r => setTimeout(r, 300))
  const menu = await pagina.evaluate(() => {
    const el = document.querySelector('div.fixed.bottom-\\[9\\.5rem\\]')
    const fab = document.querySelector('button.fixed.bottom-20')?.getBoundingClientRect()
    const r = el?.getBoundingClientRect()
    return r && fab ? { b: r.bottom, fabY: fab.top } : null
  })
  if (SHOTS && ancho === 390) await pagina.screenshot({ path: join(SHOTS, `barra-${ancho}-menu.png`) })
  comprobar(`${ancho}px · el menú del «+» abre por encima del «+»`, !!menu && menu.b <= menu.fabY, menu)
  await pagina.keyboard.press('Escape')
  await pagina.close()
  // La hoja de «Lo que suma» abre y su botón «Cerrar» se sigue pudiendo tocar.
  const h = await abrir(ancho, true)
  await h.pagina.evaluate(() => [...document.querySelectorAll('[data-barra-suma] button')].find(b => /Lo que suma/.test(b.textContent))?.click())
  await new Promise(r => setTimeout(r, 200))
  const mh = await medir(h.pagina)
  if (SHOTS && ancho === 390) await h.pagina.screenshot({ path: join(SHOTS, `barra-${ancho}-hoja.png`) })
  comprobar(`${ancho}px · con la hoja abierta, «Cerrar» se puede tocar`, mh.tocaSuma === true, mh)
  comprobar(`${ancho}px · sin errores`, errores.length === 0 && h.errores.length === 0, [...errores, ...h.errores])
  await h.pagina.close()
}

// Donde no hay barra (o está escondida), el «+» no se mueve: 80 px sobre el borde de abajo.
for (const [ancho, conBarra] of [[390, false], [1023, false], [1280, true], [1280, false]]) {
  const { pagina } = await abrir(ancho, conBarra)
  const m = await medir(pagina)
  if (SHOTS && ancho === 390) await pagina.screenshot({ path: join(SHOTS, `sin-barra-${ancho}.png`) })
  await pagina.close()
  comprobar(`${ancho}px ${conBarra ? 'con la barra escondida' : 'sin la barra'} · el «+» queda donde estaba (80 px)`, Math.abs(m.fondoFab - 80) < 0.5, m)
}

await navegador.close()
servidor.close()
console.log(fallas === 0 ? '\nTodo en orden.' : `\n${fallas} comprobaciones fallaron.`)
process.exit(fallas === 0 ? 0 : 1)
