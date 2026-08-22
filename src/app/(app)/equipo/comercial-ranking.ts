// Helper PURO de ranking comercial. Reusa get_comercial_resumen_soena;
// NO duplica la fuente. El bucket "(sin responsable)" NO entra al ranking de personas.
//
// ── Que premia el ranking (punto #31) ────────────────────────────────────────
//
// La metrica PRIMARIA es la VENTA BONIFICABLE: la que paso el umbral que declara la
// linea (#13, "venta completa = paso Documentacion"). Antes era `num_ventas`, que
// cuenta el primer pago: premiaba haber cobrado un anticipo aunque el caso se
// quedara sin avanzar.
//
// Medido en SOENA antes de cambiarlo, sobre julio y agosto de 2026: el orden del
// ranking NO se mueve en ninguno de los dos meses (agosto 21/7/6/4 ventas contra
// 20/6/5/4 bonificables; julio 33/6/3/2/1 en ambas). Cambia el numero, no el podio.
//
// Los items COMPARATIVOS del leaderboard (transparente entre comerciales) son:
//   1. ventas bonificables  <- primaria
//   2. honorario recaudado
//   3. % de cumplimiento de meta (requiere meta por vendedor; sin meta -> null,
//      degrada con gracia y NO entra al ranking de cumplimiento).
//
// ⚠️ Una persona cuyas ventas NO se pudieron medir (`num_bonificables === null`,
// porque su linea no declaro umbral) NO se ordena en el ultimo lugar: caer al fondo
// por falta de dato es exactamente el cero disfrazado que este frente prohibe. Su
// posicion queda en 0 (fuera de ese ranking) y la fila lo dice.

import type { ComercialResumenRow } from './comercial-types'

/** Metrica sobre la que se ordena el ranking. */
export type RankingMetrica = 'num_ventas' | 'honorario_recaudado' | 'valor_aprobado' | 'negocios_abiertos'

/** Posicion de una persona en el ranking del equipo, por metrica. */
export interface RankingPersona {
  responsable_id: string
  nombre: string
  position: string | null
  num_ventas: number
  /** Ventas que pasaron el umbral de la linea. `null` = no se pudo medir, NO es cero. */
  num_bonificables: number | null
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
  /**
   * Posicion por ventas bonificables — la metrica PRIMARIA (#31). `0` cuando esa
   * persona no se pudo medir: queda fuera de este ranking, no de ultima.
   */
  rank_bonificables: number
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
  /**
   * Quienes lideran el equipo, fuera del ranking pero CON sus casos a la vista.
   * Esconderlos del todo dejaria la suma del equipo corta sin decir por que.
   */
  lideres: ComercialResumenRow[]
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
  // El ranking es entre quienes ejecutan. Quien lidera queda fuera de la competencia
  // (decision de Mauricio, 2026-08-10) pero conserva sus casos a la vista.
  const personas = resumen.filter((r) => !r.sin_responsable && r.responsable_id && !r.es_lider)
  const lideres = resumen.filter((r) => !r.sin_responsable && r.responsable_id && r.es_lider)
  const sinResponsable = resumen.find((r) => r.sin_responsable) ?? null

  const rVentas = posiciones(personas, 'num_ventas')
  const rHon = posiciones(personas, 'honorario_recaudado')
  // Bonificables: solo entre quienes SI se pudieron medir. Quien tiene `null` no
  // compite en esta metrica en vez de aparecer con un cero que nadie midio.
  const medibles = personas.filter((r) => r.num_bonificables !== null)
  const rBonif = new Map<string, number>()
  {
    const ordenados = [...medibles].sort(
      (a, b) => (b.num_bonificables ?? 0) - (a.num_bonificables ?? 0),
    )
    let ultimoValor: number | null = null
    let ultimoRank = 0
    ordenados.forEach((r, i) => {
      const v = r.num_bonificables ?? 0
      if (ultimoValor === null || v !== ultimoValor) {
        ultimoRank = i + 1
        ultimoValor = v
      }
      if (r.responsable_id) rBonif.set(r.responsable_id, ultimoRank)
    })
  }

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
      num_bonificables: r.num_bonificables,
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
      rank_bonificables: rBonif.get(id) ?? 0,
      rank_honorario: rHon.get(id) ?? 0,
      rank_cumplimiento: rankCumpl.get(id) ?? 0,
    }
  })

  // Orden de presentacion por defecto: la metrica PRIMARIA, ventas bonificables.
  // Quien no se pudo medir (rank 0) va al final de la lista pero SIN posicion: no
  // se le asigna un puesto que nadie calculo. Entre ellos manda el numero de ventas,
  // que es lo unico que de esa persona si esta medido.
  filas.sort((a, b) => {
    const ra = a.rank_bonificables === 0 ? Number.MAX_SAFE_INTEGER : a.rank_bonificables
    const rb = b.rank_bonificables === 0 ? Number.MAX_SAFE_INTEGER : b.rank_bonificables
    if (ra !== rb) return ra - rb
    return b.num_ventas - a.num_ventas
  })

  return { personas: filas, total: personas.length, sinResponsable, lideres }
}

/** Busca la posicion de una persona por su staff_id. null si no esta (o es el bucket). */
export function rankingDePersona(ranking: RankingEquipo, staffId: string | null): RankingPersona | null {
  if (!staffId) return null
  return ranking.personas.find((p) => p.responsable_id === staffId) ?? null
}
