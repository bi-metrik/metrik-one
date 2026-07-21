// Helper PURO de ranking comercial. Reusa get_comercial_resumen_soena;
// NO duplica la fuente. El bucket "(sin responsable)" NO entra al ranking de personas.
//
// Metrica PRIMARIA del ranking = numero de ventas del periodo (Daniela: "el
// ranking es con respecto a las ventas"). Los 3 items COMPARATIVOS del leaderboard
// (transparente entre comerciales, incluido el operator) son:
//   1. numero de ventas
//   2. honorario recaudado
//   3. % de cumplimiento de meta (requiere meta por vendedor; sin meta -> null,
//      degrada con gracia y NO entra al ranking de cumplimiento).

import type { ComercialResumenRow } from './comercial-types'

/** Metrica sobre la que se ordena el ranking. */
export type RankingMetrica = 'num_ventas' | 'honorario_recaudado' | 'valor_aprobado' | 'negocios_abiertos'

/** Posicion de una persona en el ranking del equipo, por metrica. */
export interface RankingPersona {
  responsable_id: string
  nombre: string
  position: string | null
  num_ventas: number
  negocios_abiertos: number
  valor_aprobado: number
  honorario_recaudado: number
  en_venta: number
  en_ejecucion: number
  en_cobro: number
  tarifa_recaudada: number
  /** Meta de ventas del vendedor en el periodo. null = sin meta configurada. */
  meta_num_ventas: number | null
  /** % de cumplimiento (num_ventas / meta * 100). null si no hay meta. */
  pct_cumplimiento: number | null
  /** Posicion (1 = mejor) por metrica. Empates comparten posicion (ranking estandar). */
  rank_ventas: number
  rank_honorario: number
  /** Posicion por % cumplimiento. 0 si el vendedor no tiene meta (fuera de este ranking). */
  rank_cumplimiento: number
}

/** Resultado del ranking: personas ordenadas + total de personas (denominador "de N"). */
export interface RankingEquipo {
  personas: RankingPersona[]
  total: number
  /** Bucket sin responsable, aparte del ranking (informativo). null si no hay. */
  sinResponsable: ComercialResumenRow | null
}

function posiciones(rows: ComercialResumenRow[], metrica: RankingMetrica): Map<string, number> {
  // Orden descendente por la metrica; empates comparten la misma posicion (1,1,3...).
  const ordenados = [...rows].sort((a, b) => Number(b[metrica]) - Number(a[metrica]))
  const pos = new Map<string, number>()
  let ultimoValor: number | null = null
  let ultimoRank = 0
  ordenados.forEach((r, i) => {
    const v = Number(r[metrica])
    if (ultimoValor === null || v !== ultimoValor) {
      ultimoRank = i + 1
      ultimoValor = v
    }
    if (r.responsable_id) pos.set(r.responsable_id, ultimoRank)
  })
  return pos
}

/**
 * Construye el ranking del equipo desde el resumen. Excluye el bucket sin
 * responsable del ranking (no es una persona) y lo devuelve aparte.
 * Metrica primaria: numero de ventas.
 *
 * @param metasPorVendedor mapa staff_id -> meta_num_ventas del periodo (opcional).
 *   Sin entrada para un vendedor => ese vendedor no tiene meta => cumplimiento null
 *   y queda fuera del ranking de cumplimiento (rank_cumplimiento = 0). NO se reparte
 *   ni se inventa la meta global.
 */
export function computeRanking(
  resumen: ComercialResumenRow[],
  metasPorVendedor: Map<string, number | null> = new Map(),
): RankingEquipo {
  const personas = resumen.filter((r) => !r.sin_responsable && r.responsable_id)
  const sinResponsable = resumen.find((r) => r.sin_responsable) ?? null

  const rVentas = posiciones(personas, 'num_ventas')
  const rHon = posiciones(personas, 'honorario_recaudado')

  // Cumplimiento por vendedor (solo los que tienen meta > 0).
  const cumplimiento = new Map<string, number>()
  for (const r of personas) {
    if (!r.responsable_id) continue
    const meta = metasPorVendedor.get(r.responsable_id)
    if (meta && meta > 0) {
      cumplimiento.set(r.responsable_id, Math.round((r.num_ventas / meta) * 1000) / 10)
    }
  }
  // Ranking de cumplimiento: solo entre quienes tienen meta.
  const conMeta = personas.filter((r) => r.responsable_id && cumplimiento.has(r.responsable_id))
  const ordCumpl = [...conMeta].sort(
    (a, b) => (cumplimiento.get(b.responsable_id as string) ?? 0) - (cumplimiento.get(a.responsable_id as string) ?? 0),
  )
  const rankCumpl = new Map<string, number>()
  let ultimoV: number | null = null
  let ultimoR = 0
  ordCumpl.forEach((r, i) => {
    const v = cumplimiento.get(r.responsable_id as string) ?? 0
    if (ultimoV === null || v !== ultimoV) {
      ultimoR = i + 1
      ultimoV = v
    }
    rankCumpl.set(r.responsable_id as string, ultimoR)
  })

  const filas: RankingPersona[] = personas.map((r) => {
    const id = r.responsable_id as string
    const meta = metasPorVendedor.get(id) ?? null
    return {
      responsable_id: id,
      nombre: r.nombre,
      position: r.position,
      num_ventas: r.num_ventas,
      negocios_abiertos: r.negocios_abiertos,
      valor_aprobado: r.valor_aprobado,
      honorario_recaudado: r.honorario_recaudado,
      en_venta: r.en_venta,
      en_ejecucion: r.en_ejecucion,
      en_cobro: r.en_cobro,
      tarifa_recaudada: r.tarifa_recaudada,
      meta_num_ventas: meta && meta > 0 ? meta : null,
      pct_cumplimiento: cumplimiento.has(id) ? (cumplimiento.get(id) as number) : null,
      rank_ventas: rVentas.get(id) ?? 0,
      rank_honorario: rHon.get(id) ?? 0,
      rank_cumplimiento: rankCumpl.get(id) ?? 0,
    }
  })

  // Orden de presentacion por defecto: numero de ventas desc (metrica primaria).
  filas.sort((a, b) => a.rank_ventas - b.rank_ventas)

  return { personas: filas, total: personas.length, sinResponsable }
}

/** Busca la posicion de una persona por su staff_id. null si no esta (o es el bucket). */
export function rankingDePersona(ranking: RankingEquipo, staffId: string | null): RankingPersona | null {
  if (!staffId) return null
  return ranking.personas.find((p) => p.responsable_id === staffId) ?? null
}
