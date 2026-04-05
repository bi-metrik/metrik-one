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
    .select('custom_data, estado')
    .eq('id', proyectoId)
    .single()

  if (!proyecto) return { success: false, error: 'Proyecto no encontrado' }

  const currentCustomData = (proyecto.custom_data as Record<string, unknown>) ?? {}
  const estadoVeAnterior = (currentCustomData.estado_ve as string) ?? null

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

  // Log en activity
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

  return { success: true }
}
