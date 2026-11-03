/**
 * H10-2 (QA de punta a punta del 2026-10-29, viaje 10): tras «Desistir», la ficha seguía en
 * «E3 SEGUIMIENTO · ¿Cerró o no cerró?» sin ninguna marca de perdido. El banner de cierre de
 * siempre (`CerradoHeaderBanner`) solo sale con `cierre_motivo`, que un negocio perdido en venta
 * no tiene (ver `vista-negocio.tsx`): aquí el texto de la marca, sin el botón «Reabrir».
 *
 * Puro: el estado, el motivo y la fecha entran ya leídos.
 */

import { motivoCierreDeEstado } from './motivo-cierre'
import { etiquetaMotivoPerdida, type ConfigSeguimiento } from './seguimiento'
import { fechaCortaBogota } from '@/lib/cotizaciones/marco-negocio'

const TITULO = { perdido: 'Negocio perdido', cancelado: 'Negocio cancelado', exitoso: 'Negocio cerrado' } as const

export function avisoNegocioCerrado(args: {
  estado: string | null | undefined
  razonCierre: string | null | undefined
  closedAt: string | null | undefined
  seguimiento: ConfigSeguimiento
}): { titulo: string; detalle: string | null } | null {
  const motivo = motivoCierreDeEstado(args.estado)
  if (!motivo) return null
  const partes: string[] = []
  if (motivo !== 'exitoso' && args.razonCierre) partes.push(`Motivo: ${etiquetaMotivoPerdida(args.seguimiento, args.razonCierre)}`)
  const fecha = fechaCortaBogota(args.closedAt ?? null)
  if (fecha) partes.push(`cerrado el ${fecha}`)
  return { titulo: TITULO[motivo], detalle: partes.length > 0 ? partes.join(' · ') : null }
}
