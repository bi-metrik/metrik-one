/**
 * Resolución del avance de etapas: FUENTE ÚNICA.
 *
 * Antes esta regla estaba escrita tres veces, con tres criterios distintos:
 *
 *   - `/flujo` (WorkflowDiagram)  → `orden + 1` literal
 *   - botón "Avanzar" (cliente)   → la siguiente por orden ASCENDENTE
 *   - motor de avance (servidor)  → routing, con autocorrección del destino
 *
 * El `orden` de una etapa no es contiguo (al fusionar o insertar etapas quedan
 * huecos: SOENA tiene uno en el 3), así que `orden + 1` y "siguiente ascendente"
 * NO son la misma regla. Resultado: el diagrama podía dibujar un flujo distinto del
 * que ejecuta el sistema, y quien mira `/flujo` para entender el proceso veía algo
 * que no correspondía con lo que le pasa a un negocio real.
 *
 * Regla canónica, en este orden:
 *   1. Si la etapa declara `routing.default_etapa_orden` apuntándose a SÍ MISMA,
 *      el flujo termina ahí. Es como se declara una etapa de cierre.
 *   2. Si declara `routing.default_etapa_orden`, ese es el destino por defecto.
 *   3. Si no declara routing, sigue la siguiente etapa por orden ascendente
 *      (nunca `orden + 1`, que asume contigüidad y falla con huecos).
 *
 * Las condiciones (`routing.conditional`) NO se resuelven aquí: dependen de los datos
 * de un negocio concreto. Este helper responde "por dónde sigue el proceso", que es
 * lo que necesitan el diagrama y el botón de avanzar. El motor las evalúa aparte.
 */

export interface EtapaFlujo {
  orden: number
  routing?: { default_etapa_orden?: number } | null
}

/**
 * Orden de la siguiente etapa por defecto, o `null` si el flujo termina aquí.
 * `null` significa cierre: o la etapa se apunta a sí misma, o no hay ninguna después.
 */
export function siguienteOrdenPorDefecto<T extends EtapaFlujo>(
  etapaActual: T,
  etapas: readonly T[],
): number | null {
  const destino = etapaActual.routing?.default_etapa_orden
  if (typeof destino === 'number') {
    // Apuntarse a sí misma es la forma de declarar "el proceso cierra aquí".
    return destino === etapaActual.orden ? null : destino
  }
  const siguiente = [...etapas]
    .sort((a, b) => a.orden - b.orden)
    .find(e => e.orden > etapaActual.orden)
  return siguiente?.orden ?? null
}

/** La etapa siguiente, ya resuelta. `null` si el flujo termina aquí. */
export function siguienteEtapaPorDefecto<T extends EtapaFlujo>(
  etapaActual: T,
  etapas: readonly T[],
): T | null {
  const orden = siguienteOrdenPorDefecto(etapaActual, etapas)
  if (orden === null) return null
  return etapas.find(e => e.orden === orden) ?? null
}
