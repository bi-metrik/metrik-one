/**
 * Gates de seguimiento (post-cotización, F1). Diseño técnico §5: gates de etapa en TS, opt-in
 * por `etapas_negocio.config_extra.gates`, evaluados desde UN punto de `cambiarEtapaNegocio`
 * (junto a los custom que ya existen). `condicion_cumplida` no se toca.
 *
 *   · `cotizacion_enviada`: el negocio tiene una cotización con `fecha_envio` (se escribe al
 *     enviar, al aprobar desde borrador o al descargar con las guardas pasadas, F1-1).
 *
 * El mensaje es el de `gate_messages[gate]` si la etapa lo declara, o el de Noor.
 * Una etapa sin estos ids no consulta nada: SOENA, AFI y Termotech no cambian.
 */

import { MENSAJE_GATE_COTIZACION_ENVIADA } from './seguimiento'
import { hayCotizacionEnviada } from './seguimiento-datos'

export const GATES_SEGUIMIENTO = ['cotizacion_enviada'] as const

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

/** Devuelve el mensaje del primer gate que bloquea, o `null` si pasan todos (o no hay). */
export async function evaluarGatesSeguimiento(
  supabase: Db,
  args: { negocioId: string; gates: readonly string[]; mensajes: Record<string, string> },
): Promise<string | null> {
  if (args.gates.includes('cotizacion_enviada')) {
    if (!(await hayCotizacionEnviada(supabase, args.negocioId))) {
      return args.mensajes.cotizacion_enviada ?? MENSAJE_GATE_COTIZACION_ENVIADA
    }
  }
  return null
}
