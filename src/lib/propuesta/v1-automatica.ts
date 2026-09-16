import 'server-only'

/**
 * Inicialización automática de la v1 de un bloque `propuesta_economica`.
 *
 * ⚠️ POR QUÉ ESTE ARCHIVO EXISTE. La función vivía exportada desde
 * `propuesta-economica-actions.ts`, que es `'use server'`: todo export de ese archivo es
 * una server action, o sea un endpoint alcanzable por POST desde cualquier navegador con
 * sesión (o sin ella), aunque ninguna pantalla lo invoque. Y la función no pedía sesión
 * ni miraba el workspace: con un `bloqueId` cualquiera, sobrescribía el `data` del bloque
 * con uno vacío, borrando versiones, aprobación, plan elegido y honorario congelado de
 * una propuesta ajena. Aquí ya no es invocable como acción: `server-only` impide que un
 * componente de cliente la importe, y un módulo sin `'use server'` no genera endpoint.
 *
 * Los dos llamadores (`crearNegocio` y el auto-init de `getNegocioDetalle`, en
 * `negocio-v2-actions.ts`) ya resolvieron el negocio con la sesión del usuario antes de
 * llegar aquí; por eso esta función sigue usando el cliente de servicio y no repite el
 * guard.
 *
 * ⚠️ GUARDA: NUNCA sobrescribe un bloque que ya tiene algo. Si trae aprobación, versiones
 * o la base ya inicializada, sale sin escribir. Los dos llamadores solo la invocan sobre
 * un bloque recién creado o sin `precio_base_con_iva`, así que para ellos la guarda no
 * cambia nada; lo que cierra es cualquier otro camino que llegue con un bloque vivo.
 */

import { createServiceClient } from '@/lib/supabase/server'
import { calcularPropuesta } from '@/lib/propuesta/calculo'
import type { PropuestaData } from '@/lib/actions/propuesta-economica-actions'

export type ResultadoV1Automatica = {
  ok: boolean
  error?: string
  /** Motivo por el que no se escribió nada sobre un bloque que ya tenía contenido. */
  omitido?: 'aprobada' | 'con_versiones' | 'ya_inicializada'
}

/**
 * Decide si un bloque ya tiene contenido que la inicialización no puede pisar.
 * Devuelve el motivo, o `null` si el bloque está vacío y se puede inicializar.
 */
export function motivoParaNoInicializar(
  data: Partial<PropuestaData> | null | undefined,
): ResultadoV1Automatica['omitido'] | null {
  const d = data ?? {}
  if (d.aprobado_at) return 'aprobada'
  if (Array.isArray(d.versiones) && d.versiones.length > 0) return 'con_versiones'
  if (d.precio_base_con_iva !== undefined && d.precio_base_con_iva !== null) return 'ya_inicializada'
  return null
}

export async function crearV1Automatica(
  bloqueId: string,
  servicioId: string,
): Promise<ResultadoV1Automatica> {
  const sb = createServiceClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: bloque } = await (sb as any)
    .from('negocio_bloques')
    .select(`
      id, data, negocio_id,
      bloque_configs ( config_extra, workspace_id, bloque_definitions(tipo) )
    `)
    .eq('id', bloqueId)
    .single()
  if (!bloque) return { ok: false, error: 'Bloque no encontrado' }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b = bloque as any
  if (b.bloque_configs?.bloque_definitions?.tipo !== 'propuesta_economica') {
    return { ok: false, error: 'Bloque no es propuesta_economica' }
  }

  const omitido = motivoParaNoInicializar(b.data as Partial<PropuestaData> | null)
  if (omitido) {
    console.warn(`[propuesta] v1 automatica omitida para bloque ${bloqueId}: ${omitido}`)
    return { ok: true, omitido }
  }

  const workspaceId = b.bloque_configs.workspace_id as string

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: servicio } = await (sb as any)
    .from('servicios')
    .select('precio_estandar, tarifa_iva')
    .eq('id', servicioId)
    .single()
  if (!servicio) return { ok: false, error: 'Servicio no encontrado' }

  const ivaPct = Number(servicio.tarifa_iva ?? 0.19)
  const precioBase = Math.round(Number(servicio.precio_estandar ?? 0) * (1 + ivaPct))
  const calc = calcularPropuesta(precioBase, 0, 0)

  // Inicializar data con ambos descuentos en 0, SIN generar PDF
  // (PDF se genera cuando el usuario edite o explicitamente lo pida)
  const dataInicial: PropuestaData = {
    precio_base_con_iva: precioBase,
    iva_pct: ivaPct,
    descuento_pct_plan1: 0,
    descuento_pct_plan2: 0,
    valor_final_plan1: calc.plan1_valor,
    valor_final_plan2: calc.plan2_valor,
    // Tarifa se computa al generar la 1ª versión (necesita la Factura del negocio).
    tarifa_upme: 0,
    tarifa_upme_editada: false,
    tarifa_upme_detalle: null,
    versiones: [],
    version_activa: null,
    aprobado_at: null,
    aprobado_por: null,
    aprobado_version: null,
    aprobado_plan: null,
    aprobado_honorario: null,
    aprobado_tarifa_upme: null,
    aprobado_servicio: null,
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (sb as any)
    .from('negocio_bloques')
    .update({ data: dataInicial })
    .eq('id', bloqueId)

  console.log(`[propuesta] v1 base inicializada para bloque ${bloqueId} (ws=${workspaceId})`)
  return { ok: true }
}
