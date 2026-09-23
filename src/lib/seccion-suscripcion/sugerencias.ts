/**
 * El bloque de Sustenta en la sección Suscripción: cuándo se muestra y qué dice el aviso a MeTRIK.
 * Puro.
 *
 * Diseño (Noor, 2026-09-23): tarjeta al pie del Resumen, descartable («Ahora no» vuelve a los 30
 * días), nunca arriba de la tarjeta de pago, nunca en la pantalla del operador, nunca como modal.
 * Tampoco se ofrece a quien ya pidió la demostración: en su lugar queda la confirmación.
 *
 * Marketing (Mateo y Ren, 2026-09-23): dos CTAs («Quiero una demostración» y «Ver cómo funciona»),
 * confirmación persistente y medición de vista, panel, clic y descarte por espacio y persona.
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
  return `[ONE · ${d.espacioSlug}] ${d.empresa} pidió una demostración de Sustenta`
}

export function textoAvisoLead(d: DatosLead): string {
  return [
    `${d.persona} (${d.rol}) de ${d.empresa} pidió una demostración de Sustenta desde la sección Suscripción de su espacio en ONE. Hay que escribirle para agendarla.`,
    d.correo ? `Correo: ${d.correo}` : 'Sin correo registrado.',
    `Espacio: ${d.espacioSlug}`,
    'El contacto quedó creado en el directorio de metrik.',
  ].join('\n')
}

// ── Confirmación de la demostración ───────────────────────────────────────────────────────

/** El primer nombre de un `full_name`, o `null` si no hay. */
export function primerNombre(nombreCompleto: string | null | undefined): string | null {
  const primero = (nombreCompleto ?? '').trim().split(/\s+/)[0]
  return primero ? primero : null
}

/**
 * Lo que reemplaza a la tarjeta después de pedir la demostración, y se queda visible.
 * - `recien`: esta persona acaba de pedirla (con su nombre si se conoce).
 * - `previa`: ya estaba pedida (por ella en otra visita, o por otra persona del mismo espacio).
 */
export function textoConfirmacion(p: { tipo: 'recien'; nombre: string | null } | { tipo: 'previa' }): string {
  if (p.tipo === 'previa') return 'Ya recibimos tu solicitud. Te escribiremos para agendar la demostración.'
  const saludo = p.nombre ? `Listo, ${p.nombre}.` : 'Listo.'
  return `${saludo} Mauricio Moreno, de MéTRIK, te escribirá para agendar la demostración.`
}

// ── Medición ──────────────────────────────────────────────────────────────────────────────

export type EventoSugerencia = 'vista' | 'panel' | 'cta' | 'descarte'
export type OrigenCta = 'tarjeta' | 'panel'

/** Los eventos que el navegador puede reportar por sí solo. `cta` y `descarte` los registra la acción que los ejecuta. */
export function eventoDelNavegador(x: unknown): 'vista' | 'panel' | null {
  return x === 'vista' || x === 'panel' ? x : null
}

export function origenCta(x: unknown): OrigenCta {
  return x === 'panel' ? 'panel' : 'tarjeta'
}
