// Helper PURO de ranking comercial. Reusa get_comercial_resumen_soena (iteracion 1);
// NO duplica la fuente. El bucket "(sin responsable)" NO entra al ranking de personas.
//
// Metrica PRIMARIA del ranking = numero de ventas del periodo (Daniela: "el
// ranking es con respecto a las ventas"). Recaudo y valor quedan secundarios.
// Transparente entre comerciales: cada uno ve nombres y posiciones de todos.

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
  /** Posicion (1 = mejor) por metrica. Empates comparten posicion (ranking estandar). */
  rank_ventas: number
  rank_honorario: number
  rank_valor: number
  rank_negocios: number
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
 */
export function computeRanking(resumen: ComercialResumenRow[]): RankingEquipo {
  const personas = resumen.filter((r) => !r.sin_responsable && r.responsable_id)
  const sinResponsable = resumen.find((r) => r.sin_responsable) ?? null

  const rVentas = posiciones(personas, 'num_ventas')
  const rHon = posiciones(personas, 'honorario_recaudado')
  const rVal = posiciones(personas, 'valor_aprobado')
  const rNeg = posiciones(personas, 'negocios_abiertos')

  const filas: RankingPersona[] = personas.map((r) => ({
    responsable_id: r.responsable_id as string,
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
    rank_ventas: rVentas.get(r.responsable_id as string) ?? 0,
    rank_honorario: rHon.get(r.responsable_id as string) ?? 0,
    rank_valor: rVal.get(r.responsable_id as string) ?? 0,
    rank_negocios: rNeg.get(r.responsable_id as string) ?? 0,
  }))

  // Orden de presentacion por defecto: numero de ventas desc (metrica primaria).
  filas.sort((a, b) => a.rank_ventas - b.rank_ventas)

  return { personas: filas, total: personas.length, sinResponsable }
}

/** Busca la posicion de una persona por su staff_id. null si no esta (o es el bucket). */
export function rankingDePersona(ranking: RankingEquipo, staffId: string | null): RankingPersona | null {
  if (!staffId) return null
  return ranking.personas.find((p) => p.responsable_id === staffId) ?? null
}
