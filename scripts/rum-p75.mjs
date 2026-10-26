#!/usr/bin/env node
// p75 por ruta de las lineas `[rum]` (ver `src/app/api/rum/route.ts`).
//
// Uso (desde metrik-one/, con el proyecto de Vercel vinculado):
//   vercel logs --environment production --since 72h --query rum --limit 20000 --json \
//     | node scripts/rum-p75.mjs [--ws soena] [--min 5]
//
// Lo que corrige al leer:
//   - `vercel logs --json` repite filas (medido 2026-10-03): se deduplica por el `id` del log.
//   - Las vitales de una carga pueden llegar en varios ciclos (INP y CLS se reportan otra
//     vez si cambian): se queda la ultima por `carga` + metrica.
//   - `--query rum` busca texto suelto: solo cuentan las lineas que empiezan con `[rum] `.
//
// Salida: una tabla por metrica (LCP, INP, CLS, FCP, TTFB, NAV) con n, p50, p75 y p95 por
// ruta. Las rutas con menos de `--min` datos no salen (un p75 de 3 datos no dice nada).

import { createInterface } from 'node:readline'

const PREFIJO = '[rum] '

/** Percentil por rango mas cercano sobre una lista ya ordenada. */
export function percentil(ordenados, p) {
  if (ordenados.length === 0) return null
  const i = Math.min(ordenados.length - 1, Math.max(0, Math.ceil((p / 100) * ordenados.length) - 1))
  return ordenados[i]
}

/** Las lineas crudas de `vercel logs --json` → los beacons `[rum]`, sin repetidos. */
export function beaconsDeLogs(lineas, ws = null) {
  const vistos = new Set()
  const beacons = []
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
    let b
    try {
      b = JSON.parse(mensaje.slice(PREFIJO.length))
    } catch {
      continue
    }
    if (ws && b.ws !== ws) continue
    beacons.push(b)
  }
  return beacons
}

/** { metrica: { ruta: [valores] } }. Las navegaciones van como `NAV`, por ruta destino. */
export function valoresPorRuta(beacons) {
  const ultimaVital = new Map() // `${carga}|${n}` → { ciclo, ruta, v }
  const navs = []
  // Un mismo beacon puede llegar dos veces (dos filas de log distintas para el mismo envio).
  const ciclosVistos = new Set()
  for (const b of beacons) {
    const ciclo = `${b.carga}|${b.ciclo}`
    if (ciclosVistos.has(ciclo)) continue
    ciclosVistos.add(ciclo)
    for (const v of b.vitales ?? []) {
      const k = `${b.carga}|${v.n}`
      const previa = ultimaVital.get(k)
      if (!previa || previa.ciclo < b.ciclo) ultimaVital.set(k, { ciclo: b.ciclo, ruta: v.ruta, v: v.v, n: v.n })
    }
    for (const n of b.navs ?? []) navs.push(n)
  }
  const salida = {}
  const anotar = (metrica, ruta, valor) => {
    salida[metrica] ??= {}
    ;(salida[metrica][ruta] ??= []).push(valor)
  }
  for (const v of ultimaVital.values()) anotar(v.n, v.ruta, v.v)
  for (const n of navs) anotar('NAV', n.a, n.ms)
  return salida
}

export function resumir(porRuta, min = 5) {
  const filas = []
  for (const [metrica, rutas] of Object.entries(porRuta)) {
    for (const [ruta, valores] of Object.entries(rutas)) {
      if (valores.length < min) continue
      const o = [...valores].sort((a, b) => a - b)
      filas.push({ metrica, ruta, n: o.length, p50: percentil(o, 50), p75: percentil(o, 75), p95: percentil(o, 95) })
    }
  }
  return filas.sort((a, b) => a.metrica.localeCompare(b.metrica) || b.n - a.n)
}

async function main() {
  const args = process.argv.slice(2)
  const valor = (flag) => {
    const i = args.indexOf(flag)
    return i >= 0 ? args[i + 1] : null
  }
  const ws = valor('--ws')
  const min = Number(valor('--min') ?? 5)
  const lineas = []
  for await (const l of createInterface({ input: process.stdin })) lineas.push(l)
  const beacons = beaconsDeLogs(lineas, ws)
  const filas = resumir(valoresPorRuta(beacons), min)
  console.log(`${beacons.length} beacons${ws ? ` de ${ws}` : ''}`)
  console.table(filas)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
