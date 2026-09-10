/**
 * Cuántas coincidencias de la búsqueda existen FUERA de la pestaña activa.
 *
 * El defecto que resuelve: en `/negocios`, buscar el código exacto de un negocio
 * cerrado con un chip de fase puesto devuelve vacío. `segmentarNegocios` pasa solo
 * los abiertos a las fases de stage —un cerrado conserva el `stage_actual` que tenía
 * al salir, y listarlo ahí diría que sigue en Cobro—, así que el caso existe y la
 * pantalla dice que no. Medido en producción el 2026-09-10: los 48 cerrados de la
 * base están en ese estado (43 con stage de una fase abierta, 5 con `cerrado`), y
 * ninguno aparece bajo su propio chip. Pasó en QA con V0419 (`completado`,
 * `stage_actual='cobro'`) en soena.
 *
 * Lo que NO se hace: ignorar el chip de fase cuando hay término. Eso mueve el piso
 * bajo los pies del usuario —la pestaña dejaría de significar lo que dice— y además
 * rompería el contrato de la descarga a Excel, que baja lo que la pantalla muestra.
 * Lo que falta es el aviso, y este módulo es su número.
 *
 * Qué cuenta y qué no:
 *
 * - **Se aplican los filtros transversales** (seccional, responsable, origen,
 *   servicio, atrasados y el propio término). Son elecciones deliberadas del usuario
 *   y siguen valiendo: si filtró por un responsable, no tiene sentido avisarle de
 *   coincidencias de otro.
 * - **Se ignoran las tres dimensiones de pestaña**: fase, etapa y motivo de cierre.
 *   Son las que el aviso existe para atravesar.
 * - Fuera = sobrevive a lo anterior y NO está en la lista visible, comparado por id.
 *
 * NO es un contador de fase: `faseCount` y `etapaCount` siguen bajo la regla «un
 * contador no se filtra a sí mismo» (ver `segmentador.ts`), que es otra cosa.
 */

type Identificable = { id: string }

/**
 * @param universo    todos los negocios cargados en la pantalla, abiertos + cerrados,
 *                    SIN filtrar por fase, etapa ni motivo de cierre
 * @param visibles    la lista que la pestaña activa está mostrando (`currentFiltrado`)
 * @param transversales  aplica los filtros que sí valen (seccional, responsable,
 *                    origen, servicio, atrasados, término)
 * @returns cuántas coincidencias hay fuera de la pestaña. 0 = no se pinta nada.
 */
export function contarCoincidenciasFuera<T extends Identificable>(
  universo: readonly T[],
  visibles: readonly T[],
  transversales: (xs: T[]) => T[],
): number {
  const enPantalla = new Set(visibles.map((n) => n.id))
  // Un id se cuenta UNA vez aunque llegue por dos ramas del universo. El aviso
  // manda a una pestaña que después tiene que poder mostrar ese mismo número:
  // contar dos veces la misma fila haría que el destino contradijera al aviso.
  const contados = new Set<string>()

  for (const n of transversales([...universo])) {
    if (enPantalla.has(n.id) || contados.has(n.id)) continue
    contados.add(n.id)
  }
  return contados.size
}
