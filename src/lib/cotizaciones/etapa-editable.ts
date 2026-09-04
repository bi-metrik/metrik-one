/**
 * ¿El negocio sigue parado donde su cotización todavía se trabaja?
 *
 * Es la condición que habilita corregir una cotización aceptada
 * (`validateCorregir` en ./state-machine). Se lee de la configuración del flujo que ya
 * existe, sin columnas nuevas ni marcas en el negocio: **el bloque de cotización de la
 * etapa actual está declarado `editable`**. Cuando el caso pasa a una etapa donde ese
 * bloque es `visible` (Aprobación en adelante), la condición deja de cumplirse sola.
 *
 * Es genérico por construcción: cada workspace declara en qué etapa se cotiza, y esto
 * pregunta por esa declaración en vez de por un nombre de etapa.
 *
 * Vive aparte del state machine a propósito: aquel razona sobre estados de la
 * cotización, esto lee la forma de los `bloque_configs`. La función es pura para que
 * el detalle del negocio (que ya tiene los bloques en memoria) y la server action (que
 * los consulta) apliquen EL MISMO criterio, y no dos copias que se separan.
 */

export type BloqueDeEtapa = {
  /** `bloque_configs.estado`: 'editable' | 'visible'. */
  estado?: string | null
  /** `bloque_definitions.tipo`. */
  tipo?: string | null
  /** `bloque_configs.config_extra.desactivado`: el bloque salió del flujo sin borrarse. */
  desactivado?: boolean
}

export function hayCotizacionEditableEnEtapa(bloques: BloqueDeEtapa[]): boolean {
  return bloques.some(
    (b) => b.tipo === 'cotizacion' && b.estado === 'editable' && b.desactivado !== true,
  )
}
