/**
 * Gate `cotizacion_requerida` (barrido ámbar de «Viaje a medida», 2026-10-22).
 *
 * Un negocio sin ninguna cotización pasaba de la etapa de cotizar a la siguiente: el gate
 * `margen_sobre_piso` solo juzga las cotizaciones que EXISTEN (a propósito, lo usan otras
 * líneas), así que con cero cotizaciones no tenía nada que frenar. Este gate es la otra
 * mitad: exige que haya al menos una cotización viva.
 *
 * Viva = no rechazada ni vencida (la misma vara de `cotizacionesQueFijanElPrecio`).
 *
 * Opt-in por `etapas_negocio.config_extra.gates`: una etapa que no lo declara no consulta
 * nada. Si la lectura falla, retiene (fail-closed, como los demás gates de etapa).
 */

import { esCotizacionViva } from '@/lib/cotizaciones/gate-margen'

export const GATE_COTIZACION_REQUERIDA = 'cotizacion_requerida'

export const MENSAJE_GATE_COTIZACION_REQUERIDA = 'Falta armar la cotización'

const MENSAJE_SIN_LECTURA = 'No se pudieron leer las cotizaciones del negocio. Reintenta.'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

/** Mensaje que frena, o `null` si pasa (o si la etapa no declara el gate). */
export async function evaluarGateCotizacionRequerida(
  supabase: Db,
  args: { workspaceId: string; negocioId: string; gates: readonly string[]; mensajes: Record<string, string> },
): Promise<string | null> {
  if (!args.gates.includes(GATE_COTIZACION_REQUERIDA)) return null
  const { data, error } = await supabase
    .from('cotizaciones')
    .select('id, estado')
    .eq('workspace_id', args.workspaceId)
    .eq('negocio_id', args.negocioId)
  if (error) return MENSAJE_SIN_LECTURA
  const vivas = ((data ?? []) as Array<{ estado: string | null }>).filter(esCotizacionViva)
  if (vivas.length > 0) return null
  return args.mensajes[GATE_COTIZACION_REQUERIDA] ?? MENSAJE_GATE_COTIZACION_REQUERIDA
}
