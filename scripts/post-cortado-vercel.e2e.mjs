#!/usr/bin/env node
// ¿Chromium repite un POST cortado cuando pasa por el borde de Vercel? (brief del doble
// guardado, 2026-10-06). No corre en CI: necesita navegador y red.
//
//   PW_CHROMIUM=/ruta/a/chrome node scripts/post-cortado-vercel.e2e.mjs <reset|agujero> [idle_ms]
//
// Requiere `playwright-core` resoluble (p. ej. `npm i --no-save playwright-core`, o PW_CORE=<ruta>).
//
// Chromium real -> proxy CONNECT local -> metrikone.co:443 (TLS y HTTP/2 de punta a punta: el
// proxy solo ve bytes). Al «armar» el corte, el proxy deja pasar la petición hacia Vercel y desde
// ese momento PIERDE la respuesta:
//   reset   : además cierra la conexión del navegador (la red que se cae)
//   agujero : no cierra nada, solo deja de entregar (señal que se pierde; el caso de Claro/Telmex)
// El POST va a /api/version (solo GET: responde 405 y no escribe nada) con `?sonda=<id>`. Cuántas
// veces llegó al servidor se cuenta en los logs de Vercel buscando la sonda.
//
// Medido el 2026-10-06 (3 de 3): Chromium abrió una conexión nueva y REENVIÓ el POST; la página
// recibió el 405 de la segunda como si nada. reset: 0,8 s. agujero tras 12 s de reposo: 10 s
// (falla el PING de HTTP/2). agujero sin reposo: 75 s. HTTP/3 (QUIC) no se probó: con proxy
// Chromium no lo usa.

import net from 'node:net'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PW_CORE ?? 'playwright-core')

const MODO = process.argv[2] ?? 'reset'
const ESPERA_IDLE_MS = Number(process.argv[3] ?? 12_000)
const HOST = process.env.HOST_SONDA ?? 'metrikone.co'

let armado = false
const tuneles = []

const proxy = net.createServer((cli) => {
  cli.once('data', (head) => {
    const [metodo, destino] = head.toString().split('\r\n')[0].split(' ')
    if (metodo !== 'CONNECT' || !destino?.endsWith(':443') || !destino.includes(HOST)) return cli.destroy()
    const [h, p] = destino.split(':')
    const up = net.connect(Number(p), h, () => {
      cli.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      const t = { n: tuneles.length + 1, arriba: 0, abajo: 0, perdido: 0, cortado: false, retenido: false }
      tuneles.push(t)
      let corte = null
      cli.on('data', (d) => {
        if (t.cortado && MODO === 'agujero') return
        t.arriba += d.length
        up.write(d)
        if (armado && corte === null) {
          // La petición ya salió hacia Vercel: desde ahora su respuesta se pierde.
          t.retenido = true
          corte = setTimeout(() => {
            t.cortado = true
            armado = false
            if (MODO === 'reset') {
              cli.destroy()
              up.destroy()
            }
          }, 400)
        }
      })
      up.on('data', (d) => {
        if (t.cortado || t.retenido) {
          t.perdido += d.length
          return
        }
        t.abajo += d.length
        cli.write(d)
      })
      for (const s of [up, cli]) s.on('error', () => {})
      up.on('close', () => cli.destroy())
      cli.on('close', () => up.destroy())
    })
    up.on('error', () => cli.destroy())
  })
})
await new Promise((r) => proxy.listen(0, '127.0.0.1', r))

const navegador = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM,
  args: [`--proxy-server=http://127.0.0.1:${proxy.address().port}`],
})
const pagina = await (await navegador.newContext()).newPage()
await pagina.goto(`https://${HOST}/pulso.png`)
// Una petición previa: la conexión queda abierta y probada (Chromium solo reenvía en una reusada).
await pagina.evaluate(() => fetch('/api/version', { cache: 'no-store' }).then((r) => r.status))
await new Promise((r) => setTimeout(r, ESPERA_IDLE_MS))

const sonda = `sonda-${MODO}-${randomUUID().slice(0, 8)}`
const inicio = Date.now()
armado = true
const resultado = await pagina.evaluate(async (s) => {
  try {
    const r = await fetch(`/api/version?sonda=${s}`, { method: 'POST', body: 'x', cache: 'no-store' })
    return `respuesta ${r.status}`
  } catch (e) {
    return `error ${e.message}`
  }
}, sonda)
const reenvio = tuneles.length > 1 && resultado.startsWith('respuesta')
console.log(JSON.stringify({ sonda, modo: MODO, idle_ms: ESPERA_IDLE_MS, resultado, ms: Date.now() - inicio, reenvio, tuneles }, null, 1))
await navegador.close()
proxy.close()
