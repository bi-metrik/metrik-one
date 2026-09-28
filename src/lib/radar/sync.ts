/**
 * El barrido diario del Radar: baja el universo de procesos abiertos de SECOP II y lo deja en
 * `radar_procesos` por upsert. La red y la base entran por parámetro, así que esto se prueba entero
 * sin tocar ninguna de las dos.
 *
 * Spec: `proyectos/metrik/one/2026-09-28_spec-radar-secop-en-one.md`, bloque D. Es el ÚNICO cron
 * nuevo de la entrega.
 *
 * ## Las dos cosas que no son obvias
 *
 * 1. **Un barrido corto se lee igual que uno completo.** El `$limit` de Socrata corta en silencio,
 *    así que la única señal de «se acabó» es que un lote venga con menos filas que el tope. Si la
 *    página viene completa, se pide la siguiente. `TOPE_PAGINAS` existe para que un dataset que
 *    creciera sin control no deje el cron girando: se llega al tope y se DICE, en vez de guardar
 *    un universo parcial como si fuera todo.
 * 2. **El barrido no borra.** Un proceso que desaparece del dataset (cerró) se queda en la tabla
 *    con su `visto_at` viejo. Borrarlo se llevaría la marca de seguimiento del cliente, que es la
 *    razón por la que lo estaba mirando. Quién se muestra lo decide la consulta por
 *    `fecha_cierre`, no un DELETE.
 */

import { prepararProcesos, urlPaginaSocrata, type FilaSocrata, type ProcesoRadar } from './socrata'
import { BIBLIOTECA } from './biblioteca'

/** Cuántas filas se mandan por upsert. Un lote muy grande revienta el tamaño del request. */
export const LOTE_UPSERT = 500

/**
 * Tope de páginas. A 20.000 filas por página son 200.000 filas, ~100× el universo real del
 * 2026-09-28 (2.075). Llegar aquí no es normal y por eso se reporta.
 */
export const TOPE_PAGINAS = 10

export interface ResumenSync {
  ok: boolean
  hoy: string
  /** Filas como vinieron del dataset, antes de deduplicar. */
  filasCrudas: number
  /** Procesos únicos por `notice_uid`. La diferencia con `filasCrudas` son las fases repetidas. */
  procesosUnicos: number
  paginas: number
  /** Se alcanzó `TOPE_PAGINAS`: lo guardado es un universo PARCIAL. */
  truncado: boolean
  escritos: number
  errores: string[]
}

export interface DepsSync {
  /** Trae una página. En pruebas se mockea; en el cron es `fetch`. */
  traerPagina: (url: string) => Promise<FilaSocrata[]>
  /** Escribe un lote por upsert sobre `notice_uid`. Devuelve el error, o `null`. */
  upsert: (filas: readonly ProcesoRadar[]) => Promise<string | null>
}

/** Todas las páginas del barrido. Devuelve las filas crudas y si se cortó por tope. */
export async function barrer(
  hoy: string,
  traerPagina: DepsSync['traerPagina'],
): Promise<{ filas: FilaSocrata[]; paginas: number; truncado: boolean }> {
  const filas: FilaSocrata[] = []
  let paginas = 0

  for (let p = 0; p < TOPE_PAGINAS; p++) {
    const lote = await traerPagina(urlPaginaSocrata(hoy, filas.length))
    paginas++
    filas.push(...lote)
    // Un lote incompleto es la única señal de que no hay más. Un lote COMPLETO puede ser el
    // final exacto o un corte: se pide otra página y la siguiente vendrá vacía.
    if (lote.length < 20000) return { filas, paginas, truncado: false }
  }

  return { filas, paginas, truncado: true }
}

/** Parte en lotes de `LOTE_UPSERT`. */
export function lotes<T>(xs: readonly T[], tamano = LOTE_UPSERT): T[][] {
  const salida: T[][] = []
  for (let i = 0; i < xs.length; i += tamano) salida.push(xs.slice(i, i + tamano))
  return salida
}

/**
 * El barrido completo. Un lote que falla no tumba los demás: se anota y se sigue, porque medio
 * universo actualizado es mejor que ninguno y el barrido de mañana vuelve a pasar por todos.
 */
export async function sincronizarRadar(hoy: string, deps: DepsSync): Promise<ResumenSync> {
  const errores: string[] = []
  let barrido: { filas: FilaSocrata[]; paginas: number; truncado: boolean }
  try {
    barrido = await barrer(hoy, deps.traerPagina)
  } catch (e) {
    return {
      ok: false,
      hoy,
      filasCrudas: 0,
      procesosUnicos: 0,
      paginas: 0,
      truncado: false,
      escritos: 0,
      errores: [e instanceof Error ? e.message : String(e)],
    }
  }

  const procesos = prepararProcesos(barrido.filas, {
    sinRup: BIBLIOTECA.sinRup,
    tiposCompra: BIBLIOTECA.tiposCompra,
  })

  let escritos = 0
  for (const lote of lotes(procesos)) {
    const err = await deps.upsert(lote)
    if (err) errores.push(`lote de ${lote.length}: ${err}`)
    else escritos += lote.length
  }

  if (barrido.truncado) {
    errores.push(`se alcanzó el tope de ${TOPE_PAGINAS} páginas: el universo guardado es PARCIAL`)
  }

  return {
    ok: errores.length === 0,
    hoy,
    filasCrudas: barrido.filas.length,
    procesosUnicos: procesos.length,
    paginas: barrido.paginas,
    truncado: barrido.truncado,
    escritos,
    errores,
  }
}
