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
 * @param fase       'todos' | 'cerrados' | un stage ('venta' | 'ejecucion' | 'cobro')
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
    : fase === 'todos' ? abiertos
    : abiertos.filter((n) => n.stage_actual === fase)

  const base = aplicar(deLaFase)

  return {
    lista: etapaNum !== null ? base.filter((n) => n.etapa_numero === etapaNum) : base,
    contarEtapa: (numero: number) => base.filter((n) => n.etapa_numero === numero).length,
  }
}
