/**
 * Quien puede cerrar un negocio: lo declara la LINEA, no el `stage`.
 *
 * El `stage` de una etapa dice QUIEN trabaja ahi (venta, ejecucion, cobro), no si el
 * proceso termina ahi. Son dos preguntas distintas que el codigo venia respondiendo con
 * el mismo dato, y por eso una etapa final de `stage: 'venta'` mostraba el boton "Perder"
 * en vez de "Cerrar": el equipo veia la opcion de dar por perdido un caso que acababa de
 * entregarse bien.
 *
 * Lo que costo (SOENA, medido 2026-08-18): **Entrega** (orden 12) y **Seguimiento**
 * (orden 19) son los dos finales reales de las dos ramas y ambas son `stage: 'venta'`.
 * Entre las dos tenian **32 negocios abiertos** cuyo unico boton de cierre decia "Perder",
 * y en las que la excepcion de cierre no facturable no aparecia, porque estaba amarrada a
 * `stage === 'cobro'`.
 *
 * ── Compatibilidad hacia atras, que aqui no es opcional ───────────────────────────────
 * Al 2026-08-18 **una sola etapa en toda la base declara `etapa_cierre`** (Facturacion de
 * SOENA). Todas las demas lineas dependen hoy del criterio viejo, asi que cambiarlo de
 * golpe les moveria el cierre sin que nadie lo pidiera. Por eso el criterio nuevo solo
 * gobierna **cuando la linea declara al menos una etapa de cierre**; si no declara
 * ninguna, se responde exactamente como antes.
 *
 * Es el mismo patron que ya usa `isTerminalStage` en la pantalla de detalle, subido a
 * modulo para que las cinco decisiones de cierre (dos en pantalla, tres en el servidor)
 * lean la MISMA regla. Escribirla cinco veces es como termino la formula de saldo escrita
 * en cuatro sitios divergiendo entre si.
 */

/** El stage de una etapa. `cerrado` no es una etapa, es un estado del negocio. */
export type StageEtapa = 'venta' | 'ejecucion' | 'cobro'

/** Lo minimo que hay que saber de una etapa para decidir si ahi se cierra. */
export interface EtapaCierre {
  stage: StageEtapa | null
  /** `config_extra.etapa_cierre === true`. La linea lo declara etapa por etapa. */
  esCierre: boolean
  /**
   * ¿Es terminal segun el criterio VIEJO (las ultimas etapas por orden)?
   *
   * Solo se consulta cuando la linea no declara ninguna etapa de cierre. Quien llama ya
   * lo tiene calculado; este modulo no lo deriva para no asumir que conoce el orden.
   */
  terminalLegacy?: boolean
}

/**
 * ¿Esta linea declara donde cierra su proceso?
 *
 * Basta una etapa con `etapa_cierre: true`. Mientras no haya ninguna, la linea sigue
 * gobernada por el criterio viejo y este modulo no cambia nada para ella.
 */
export function lineaDeclaraCierre(
  etapas: ReadonlyArray<{ esCierre?: boolean }>,
): boolean {
  return etapas.some(e => e.esCierre === true)
}

/**
 * ¿Se puede COMPLETAR el negocio desde esta etapa?
 *
 * Con la linea declarando cierre, la respuesta es exactamente su declaracion: ni el stage
 * ni el orden entran. Sin declaracion, se conserva el criterio viejo intacto.
 *
 * ⚠️ Con declaracion, una etapa de `stage: 'cobro'` que NO sea la de cierre deja de poder
 * completar. Eso es deliberado: en SOENA, Pago UPME es `stage: 'cobro'` porque ahi paga la
 * financiera, y dar por completado un negocio desde ahi es cerrarlo a mitad del proceso.
 */
export function permiteCompletar(etapa: EtapaCierre, lineaDeclara: boolean): boolean {
  if (lineaDeclara) return etapa.esCierre
  return etapa.stage === 'cobro' || (etapa.stage === 'ejecucion' && etapa.terminalLegacy === true)
}

/**
 * ¿Se puede ofrecer la excepcion de cierre NO FACTURABLE desde esta etapa?
 *
 * Misma regla que completar, y a proposito: la excepcion es una forma de cerrar, no una
 * capacidad aparte. Tenerla amarrada a `stage === 'cobro'` mientras el cierre se declara
 * por config era justo la divergencia que dejaba la excepcion invisible en la etapa donde
 * el proceso de verdad termina.
 *
 * La AUTORIZACION (quien puede usarla) es otra pregunta y sigue en
 * `puedeAutorizarCierreNoFacturable`. Esto solo dice DONDE tiene sentido ofrecerla.
 */
export function permiteCierreNoFacturable(etapa: EtapaCierre, lineaDeclara: boolean): boolean {
  if (lineaDeclara) return etapa.esCierre
  return etapa.stage === 'cobro'
}

/**
 * El texto del boton de cierre.
 *
 * "Cerrar" es un final bueno; "Perder" y "Cancelar" son finales malos. Confundirlos es el
 * defecto visible que origino todo esto.
 */
export type AccionCierre = 'cerrar' | 'perder' | 'cancelar'

export function accionDeCierre(etapa: EtapaCierre, lineaDeclara: boolean): AccionCierre {
  if (permiteCompletar(etapa, lineaDeclara)) return 'cerrar'
  if (etapa.stage === 'ejecucion') return 'cancelar'
  return 'perder'
}
