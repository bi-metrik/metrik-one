/**
 * Segmentador Fase -> Etapa de la lista de negocios.
 *
 * La regla que justifica que esto viva aparte: **un contador no se filtra a sí mismo**.
 * Los contadores de etapa se calculan sobre la fase con todos los demás filtros aplicados
 * pero SIN el filtro de etapa; si se calcularan sobre la lista ya filtrada, al elegir una
 * etapa las demás caerían a cero y se perdería la foto de la fase justo al entrar a mirarla.
 *
 * La lista y los contadores salen de la misma base, así que el número del chip es siempre
 * el largo de la lista que ese chip abre.
 *
 * **"Todos" es abiertos + cerrados.** Antes era solo abiertos, y como la descarga a Excel
 * es WYSIWYG (baja los ids que la pantalla decidió mostrar), desde "Todos" nunca salía un
 * caso con fecha de cierre: el nombre prometía algo que la pestaña no daba. Las fases de
 * stage siguen siendo solo abiertos — un cerrado conserva el `stage_actual` que tenía al
 * salir, y contarlo ahí diría que sigue en Cobro.
 */

type NegocioSegmentable = {
  stage_actual?: string | null
  etapa_numero?: number | null
}

export type Segmentacion<T> = {
  /** Lo que se lista: fase + etapa + resto de filtros. */
  lista: T[]
  /** Contador de una etapa: fase + resto de filtros, sin el filtro de etapa. */
  contarEtapa: (numero: number) => number
}

/**
 * @param abiertos   negocios abiertos (ya con el alcance del rol resuelto en el servidor)
 * @param cerrados   negocios cerrados, ya filtrados por motivo de cierre
 * @param fase       'todos' (abiertos + cerrados) | 'cerrados' | un stage
 *                   ('venta' | 'ejecucion' | 'cobro', solo abiertos)
 * @param etapaNum   etapa seleccionada dentro de la fase, o null
 * @param aplicar    resto de filtros (responsable, seccional, búsqueda, atrasados)
 */
export function segmentarNegocios<T extends NegocioSegmentable>(
  abiertos: T[],
  cerrados: T[],
  fase: string,
  etapaNum: number | null,
  aplicar: (xs: T[]) => T[],
): Segmentacion<T> {
  const deLaFase =
    fase === 'cerrados' ? cerrados
    : fase === 'todos' ? [...abiertos, ...cerrados]
    : abiertos.filter((n) => n.stage_actual === fase)

  const base = aplicar(deLaFase)

  return {
    lista: etapaNum !== null ? base.filter((n) => n.etapa_numero === etapaNum) : base,
    contarEtapa: (numero: number) => base.filter((n) => n.etapa_numero === numero).length,
  }
}

export type ConteoDeEtapa = { total: number; atrasados: number }

/**
 * Conteos de la línea de flujo: por etapa, cuántos casos y cuántos atrasados.
 *
 * La línea muestra TODAS las etapas en cualquier fase, y un clic en una etapa fija la fase
 * a la de la etapa. Por eso el número de cada etapa se cuenta con SU fase y no con la que
 * está puesta: tiene que ser el largo de la lista que ese clic abre. Contarlo con la fase
 * «Todos» sumaría los cerrados que siguen marcados con esa etapa, y el clic abriría menos
 * casos de los que el número promete.
 *
 * Sale de `segmentarNegocios` (una llamada por fase, no una por etapa), así que respeta
 * los demás filtros exactamente como la lista.
 *
 * @param esAtrasado  el criterio del filtro «Atrasados»; entra por parámetro para que haya
 *                    uno solo.
 */
export function contarLineaDeFlujo<T extends NegocioSegmentable>(
  abiertos: T[],
  etapas: ReadonlyArray<{ numero: number; stage: string }>,
  aplicar: (xs: T[]) => T[],
  esAtrasado: (n: T) => boolean,
): Map<number, ConteoDeEtapa> {
  const conteos = new Map<number, ConteoDeEtapa>()
  for (const e of etapas) conteos.set(e.numero, { total: 0, atrasados: 0 })

  for (const stage of new Set(etapas.map((e) => e.stage))) {
    const deLaFase = new Set(etapas.filter((e) => e.stage === stage).map((e) => e.numero))
    for (const n of segmentarNegocios(abiertos, [], stage, null, aplicar).lista) {
      if (n.etapa_numero == null || !deLaFase.has(n.etapa_numero)) continue
      const c = conteos.get(n.etapa_numero)!
      c.total += 1
      if (esAtrasado(n)) c.atrasados += 1
    }
  }
  return conteos
}
