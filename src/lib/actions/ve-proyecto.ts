'use server'

/**
 * ve-proyecto.ts — Server actions para el flujo operativo VE/HEV/PHEV
 *
 * Los proyectos VE tienen un estado operativo en custom_data.estado_ve
 * independiente del campo proyectos.estado (que solo se usa para routing
 * de tabs en /negocios).
 *
 * Mapping estado_ve → proyectos.estado:
 *   por_inclusion  → en_ejecucion
 *   por_radicar    → en_ejecucion
 *   por_certificar → en_ejecucion
 *   certificado    → en_ejecucion
 *   por_cobrar     → entregado     (aparece en tab "Por cobrar")
 *   cerrado        → cerrado
 */

import { getWorkspace } from '@/lib/actions/get-workspace'
import { revalidatePath } from 'next/cache'
import { logSystemChange } from '@/app/(app)/activity-actions'

export type EstadoVe =
  | 'por_inclusion'
  | 'por_radicar'
  | 'por_certificar'
  | 'certificado'
  | 'por_cobrar'
  | 'cerrado'

const ESTADO_VE_VALIDOS: EstadoVe[] = [
  'por_inclusion',
  'por_radicar',
  'por_certificar',
  'certificado',
  'por_cobrar',
  'cerrado',
]

/** Devuelve el proyectos.estado correspondiente a un estado_ve */
function proyectoEstadoFromVe(estadoVe: EstadoVe): string {
  if (estadoVe === 'por_cobrar') return 'entregado'
  if (estadoVe === 'cerrado') return 'cerrado'
  return 'en_ejecucion'
}

/**
 * Mueve un proyecto VE a un nuevo estado operativo.
 * Actualiza custom_data.estado_ve y ajusta proyectos.estado para routing.
 * Registra el cambio en activity_log.
 */
export async function moveProyectoVe(
  proyectoId: string,
  nuevoEstadoVe: EstadoVe,
): Promise<{ success: boolean; error?: string }> {
  if (!ESTADO_VE_VALIDOS.includes(nuevoEstadoVe)) {
    return { success: false, error: `Estado VE inválido: ${nuevoEstadoVe}` }
  }

  const { supabase, workspaceId, staffId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  // Leer estado actual para log y merge de custom_data
  const { data: proyecto } = await supabase
    .from('proyectos')
    .select('custom_data, estado, oportunidad_id, presupuesto_total')
    .eq('id', proyectoId)
    .single()

  if (!proyecto) return { success: false, error: 'Proyecto no encontrado' }

  const currentCustomData = (proyecto.custom_data as Record<string, unknown>) ?? {}
  const estadoVeAnterior = (currentCustomData.estado_ve as string) ?? null

  // Gate: validar campos requeridos en la oportunidad vinculada antes de avanzar
  if (proyecto.oportunidad_id && (nuevoEstadoVe === 'por_certificar' || nuevoEstadoVe === 'certificado')) {
    const { data: opp } = await supabase
      .from('oportunidades')
      .select('custom_data')
      .eq('id', proyecto.oportunidad_id)
      .single()
    const oppData = (opp?.custom_data as Record<string, unknown>) ?? {}

    if (nuevoEstadoVe === 'por_certificar') {
      const radicado = oppData.numero_radicado_certificacion
      if (!radicado || String(radicado).trim() === '') {
        return { success: false, error: 'Debes ingresar el Nro. Radicado de Certificación antes de continuar' }
      }
    }
    if (nuevoEstadoVe === 'certificado') {
      const certUrl = oppData.cert_upme_url
      if (!certUrl || String(certUrl).trim() === '') {
        return { success: false, error: 'Debes cargar el certificado UPME antes de continuar' }
      }
    }
  }

  // Flags especiales al avanzar desde por_inclusion → por_radicar
  const extraCustomData: Record<string, unknown> = {}
  if (estadoVeAnterior === 'por_inclusion' && nuevoEstadoVe === 'por_radicar') {
    extraCustomData.viene_de_inclusion = true
  }

  const nuevoEstadoProyecto = proyectoEstadoFromVe(nuevoEstadoVe)

  const { error: dbError } = await supabase
    .from('proyectos')
    .update({
      estado: nuevoEstadoProyecto,
      custom_data: {
        ...currentCustomData,
        ...extraCustomData,
        estado_ve: nuevoEstadoVe,
      } as unknown as Record<string, never>,
      updated_at: new Date().toISOString(),
    })
    .eq('id', proyectoId)
    .eq('workspace_id', workspaceId)

  if (dbError) return { success: false, error: dbError.message }

  // Auto-crear cobro saldo cuando llega a por_cobrar
  // (tipo_cobro se agrega via migration 20260404000002 — cast necesario hasta regenerar tipos)
  if (nuevoEstadoVe === 'por_cobrar') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anticiposQ = (supabase.from('cobros') as any)
      .select('monto')
      .eq('proyecto_id', proyectoId)
      .eq('tipo_cobro', 'anticipo')
    const { data: anticipos } = await anticiposQ as { data: { monto: number }[] | null }

    const totalAnticipo = (anticipos ?? []).reduce((s, c) => s + (c.monto ?? 0), 0)
    const saldo = (proyecto.presupuesto_total ?? 0) - totalAnticipo

    if (saldo > 0) {
      // (tipo_cobro y factura_id nullable se agregan via migration 20260404000002)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.from('cobros') as any).insert({
        workspace_id: workspaceId,
        proyecto_id: proyectoId,
        fecha: new Date().toISOString().split('T')[0],
        monto: saldo,
        tipo_cobro: 'saldo',
        notas: 'Saldo VE — Pendiente de cobro',
      })
    }
  }

  // Log en activity (registrado en proyecto; ActivityLog unificado lo recoge via oportunidadId)
  await logSystemChange(
    workspaceId,
    'proyecto',
    proyectoId,
    'estado_ve',
    estadoVeAnterior,
    nuevoEstadoVe,
    staffId,
  )

  revalidatePath(`/proyectos/${proyectoId}`)
  revalidatePath('/proyectos')
  revalidatePath('/negocios')
  if (proyecto.oportunidad_id) {
    revalidatePath(`/pipeline/${proyecto.oportunidad_id}`)
  }

  return { success: true }
}
