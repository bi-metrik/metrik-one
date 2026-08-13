/**
 * La ayuda de una etapa: qué significa estar aquí, qué se hace y qué falta para avanzar.
 *
 * Vive en `etapas_negocio.config_extra.guia` y la escribe quien configura la línea.
 * Es texto plano, sin marcado.
 *
 * El tipo vive en este módulo neutro —y no junto a las server actions— porque lo
 * consumen DOS superficies que no comparten nada más: el detalle del negocio
 * (`GuiaEtapaCard`, donde se trabaja el caso) y la vista del flujo (`WorkflowRutas`,
 * donde se lee el proceso completo). Duplicarlo las dejaría divergir en silencio.
 */
export type GuiaEtapa = {
  /** Qué significa que un caso esté aquí. Una frase. */
  definicion?: string
  /** Lo que hay que hacer, en pasos cortos. */
  hacer?: string[]
  /** Qué retiene el caso, en las palabras del equipo. */
  avanzar?: string
  /** Quién responde esta etapa. */
  responsable?: string
}

/**
 * ¿Hay algo que mostrar?
 *
 * Sin esto, ninguna de las dos superficies renderiza nada: la guía es opt-in y una
 * línea que no la configuró debe verse exactamente igual que antes.
 *
 * `responsable` NO cuenta a solas a propósito: un nombre suelto, sin definición ni
 * pasos ni condición de avance, no explica nada — es un recuadro por llenar.
 */
export function guiaTieneContenido(guia: GuiaEtapa | null | undefined): guia is GuiaEtapa {
  return Boolean(guia?.definicion || guia?.hacer?.length || guia?.avanzar)
}

/** ¿Hay algo más allá de la definición? Es lo que la tarjeta del negocio pliega. */
export function guiaTieneDetalle(guia: GuiaEtapa | null | undefined): boolean {
  return Boolean(guia?.hacer?.length || guia?.avanzar || guia?.responsable)
}
