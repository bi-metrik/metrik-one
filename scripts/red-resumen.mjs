#!/usr/bin/env node
// Resumen diario por persona y operador del piloto de red (lineas `[red-piloto]`, ver
// `src/app/api/red/eventos/route.ts`).
//
// Uso (desde metrik-one/, con el proyecto de Vercel vinculado):
//   node scripts/red-resumen.mjs --bajar 3d            # baja los logs y resume
//   node scripts/red-resumen.mjs --bajar 3d --json     # lo mismo, en JSON
//   vercel logs ... --query red-piloto --json | node scripts/red-resumen.mjs
//
// Por que baja en tramos de 30 min: `vercel logs --json` repite filas y con `--limit` grande
// se queda en una sola ventana (medido 2026-10-06: 3000 filas = 50 reportes reales). Cada tramo
// se pide aparte y todo se deduplica: las filas por `id` del log y los eventos por su propio
// `id` (la bandeja del navegador puede mandar el mismo evento dos veces).
//
// Los logs de runtime de Vercel duran 30 dias. Para el antes/despues del service worker: la
// columna `sw%` dice que parte del tiempo medido la pagina estaba controlada por el SW.

import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'

const PREFIJO = '[red-piloto] '
const TZ = 'America/Bogota'

/** Lineas crudas de `vercel logs --json` → lotes `[red-piloto]` sin repetidos. */
export function lotesDeLogs(lineas) {
  const vistos = new Set()
  const lotes = []
  for (const linea of lineas) {
    let fila
    try {
      fila = JSON.parse(linea)
    } catch {
      continue
    }
    const mensaje = typeof fila?.message === 'string' ? fila.message : ''
    if (!mensaje.startsWith(PREFIJO)) continue
    const clave = fila.id ?? mensaje
    if (vistos.has(clave)) continue
    vistos.add(clave)
    try {
      lotes.push(JSON.parse(mensaje.slice(PREFIJO.length)))
    } catch {
      // linea cortada
    }
  }
  return lotes
}

const dia = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: TZ })
const fechaEvento = (e) => (e.tipo === 'pulso' ? e.t1 : e.tipo === 'corte' ? e.inicio : e.t)

function fila() {
  return {
    minutos: 0,
    swMs: 0,
    vercel: { n: 0, perdidas: 0, p95: [] },
    control: { n: 0, perdidas: 0, p95: [] },
    cortes: { total: 0, internet: 0, soloVercel: 0, soloControl: 0, segundos: 0, maxSeg: 0 },
    fallas: {},
  }
}

/** Agrega por dia (Bogota) + persona + operador. Los eventos se cuentan una vez por `id`. */
export function resumir(lotes) {
  const vistos = new Set()
  const grupos = new Map()
  for (const lote of lotes) {
    const persona = lote.persona ?? '(sin identificar)'
    const operador = lote.operador ?? lote.asn_nombre ?? '(operador?)'
    for (const e of lote.eventos ?? []) {
      if (!e?.id || vistos.has(e.id)) continue
      vistos.add(e.id)
      const clave = `${dia(fechaEvento(e))}|${persona}|${operador}`
      if (!grupos.has(clave)) grupos.set(clave, fila())
      const g = grupos.get(clave)
      if (e.tipo === 'pulso') {
        g.minutos += e.visible_ms / 60_000
        if (e.sw) g.swMs += e.visible_ms
        for (const d of ['vercel', 'control']) {
          g[d].n += e[d]?.n ?? 0
          g[d].perdidas += e[d]?.perdidas ?? 0
          if (typeof e[d]?.p95 === 'number') g[d].p95.push(e[d].p95)
        }
      } else if (e.tipo === 'corte') {
        g.cortes.total++
        if (e.vercel && e.control) g.cortes.internet++
        else if (e.vercel) g.cortes.soloVercel++
        else g.cortes.soloControl++
        const s = e.dur_ms / 1000
        g.cortes.segundos += s
        g.cortes.maxSeg = Math.max(g.cortes.maxSeg, s)
      } else if (e.tipo === 'falla') {
        const f = (g.fallas[e.superficie] ??= { total: 0, recuperadas: 0 })
        f.total++
        if (e.recuperado) f.recuperadas++
      }
    }
  }
  return [...grupos.entries()]
    .map(([clave, g]) => {
      const [fecha, persona, operador] = clave.split('|')
      const mediana = (xs) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null)
      return {
        fecha,
        persona,
        operador,
        minutosMedidos: Math.round(g.minutos),
        swPct: g.minutos > 0 ? Math.round((g.swMs / 60_000 / g.minutos) * 100) : 0,
        vercel: { sondas: g.vercel.n, perdidas: g.vercel.perdidas, p95Mediana: mediana(g.vercel.p95) },
        control: { sondas: g.control.n, perdidas: g.control.perdidas, p95Mediana: mediana(g.control.p95) },
        cortes: { ...g.cortes, segundos: Math.round(g.cortes.segundos), maxSeg: Math.round(g.cortes.maxSeg) },
        fallas: g.fallas,
      }
    })
    .sort((a, b) => (a.fecha + a.persona + a.operador).localeCompare(b.fecha + b.persona + b.operador))
}

const pct = (a, n) => (n ? `${((a / n) * 100).toFixed(1)}%` : '-')

export function tabla(filas) {
  const out = []
  out.push(
    ['fecha', 'persona', 'operador', 'min', 'sw%', 'perd.Vercel', 'perd.control', 'p95V', 'p95C', 'cortes', 'internet', 'soloVercel', 'seg', 'max', 'fallas']
      .join('\t'),
  )
  for (const f of filas) {
    const fallas = Object.entries(f.fallas)
      .map(([s, x]) => `${s}:${x.total}${x.recuperadas ? `(${x.recuperadas} solas)` : ''}`)
      .join(' ')
    out.push(
      [
        f.fecha,
        f.persona,
        f.operador,
        f.minutosMedidos,
        f.swPct,
        pct(f.vercel.perdidas, f.vercel.sondas),
        pct(f.control.perdidas, f.control.sondas),
        f.vercel.p95Mediana ?? '-',
        f.control.p95Mediana ?? '-',
        f.cortes.total,
        f.cortes.internet,
        f.cortes.soloVercel,
        f.cortes.segundos,
        f.cortes.maxSeg,
        fallas || '-',
      ].join('\t'),
    )
  }
  return out.join('\n')
}

function duracionMs(texto) {
  const m = /^(\d+)([hd])$/.exec(texto ?? '')
  if (!m) throw new Error(`--bajar espera algo como 2d o 12h, no ${texto}`)
  return Number(m[1]) * (m[2] === 'd' ? 86_400_000 : 3_600_000)
}

function bajarTramo(desde, hasta) {
  return new Promise((resolve) => {
    const p = spawn('vercel', [
      'logs', '--environment', 'production', '--since', desde.toISOString(), '--until', hasta.toISOString(),
      '--query', 'red-piloto', '--limit', '3000', '--json',
    ])
    let out = ''
    p.stdout.on('data', (d) => (out += d))
    p.on('close', () => resolve(out.split('\n')))
    p.on('error', () => resolve([]))
  })
}

async function bajar(rango) {
  const fin = Date.now()
  const tramos = []
  for (let t = fin - duracionMs(rango); t < fin; t += 30 * 60_000) tramos.push([new Date(t), new Date(Math.min(fin, t + 30 * 60_000))])
  const lineas = []
  for (let i = 0; i < tramos.length; i += 6) {
    const partes = await Promise.all(tramos.slice(i, i + 6).map(([a, b]) => bajarTramo(a, b)))
    for (const p of partes) lineas.push(...p)
    process.stderr.write(`\rtramos ${Math.min(i + 6, tramos.length)}/${tramos.length}`)
  }
  process.stderr.write('\n')
  return lineas
}

async function main() {
  const args = process.argv.slice(2)
  const i = args.indexOf('--bajar')
  let lineas
  if (i >= 0) lineas = await bajar(args[i + 1])
  else {
    lineas = []
    for await (const l of createInterface({ input: process.stdin })) lineas.push(l)
  }
  const filas = resumir(lotesDeLogs(lineas))
  console.log(args.includes('--json') ? JSON.stringify(filas, null, 2) : tabla(filas))
}

if (import.meta.url === `file://${process.argv[1]}`) main()
