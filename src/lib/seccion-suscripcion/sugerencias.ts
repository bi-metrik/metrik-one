/**
 * El bloque de Sustenta en la sección Suscripción: cuándo se muestra y qué dice el aviso a MeTRIK.
 * Puro.
 *
 * Diseño (Noor, 2026-09-23): tarjeta al pie del Resumen, descartable («Ahora no» vuelve a los 30
 * días), nunca arriba de la tarjeta de pago, nunca en la pantalla del operador, nunca como modal.
 * Tampoco se muestra a quien ya pidió que lo contacten.
 */

export const CLAVE_SUSTENTA = 'sustenta'
export const DIAS_DESCARTE = 30

/** Hasta cuándo queda oculta una sugerencia descartada ahora. */
export function descartadaHasta(ahora: Date, dias: number = DIAS_DESCARTE): string {
  return new Date(ahora.getTime() + dias * 86_400_000).toISOString()
}

export function mostrarSugerencia(p: {
  /** ISO de `sugerencias_descartadas.descartada_hasta`, o `null` si nunca se descartó. */
  descartadaHasta: string | null
  /** Ya existe un «Quiero que me contacten» del espacio para este servicio. */
  yaSolicitado: boolean
  ahora: Date
}): boolean {
  if (p.yaSolicitado) return false
  if (!p.descartadaHasta) return true
  const hasta = Date.parse(p.descartadaHasta)
  // Una fecha ilegible no esconde la tarjeta para siempre.
  return Number.isNaN(hasta) || hasta <= p.ahora.getTime()
}

export interface DatosLead {
  empresa: string
  espacioSlug: string
  persona: string
  correo: string | null
  rol: string
}

export function asuntoAvisoLead(d: DatosLead): string {
  return `[ONE · ${d.espacioSlug}] ${d.empresa} quiere conocer Sustenta`
}

export function textoAvisoLead(d: DatosLead): string {
  return [
    `${d.persona} (${d.rol}) de ${d.empresa} pidió que lo contacten para conocer Sustenta, desde la sección Suscripción de su espacio en ONE.`,
    d.correo ? `Correo: ${d.correo}` : 'Sin correo registrado.',
    `Espacio: ${d.espacioSlug}`,
    'El contacto quedó creado en el directorio de metrik.',
  ].join('\n')
}
