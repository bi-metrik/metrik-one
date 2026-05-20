'use server'

import { revalidatePath } from 'next/cache'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { generarCuentasCobroPeriodo, type GenerarCuentasResult } from '@/lib/cobros/generar-cuentas-cobro'
import { enviarCuentaCobroEmail } from '@/lib/email/send-cuenta-cobro'
import { enviarEmailAprobacionPendiente } from '@/lib/email/send-aprobacion-cuenta-cobro'

type ActionResult<T> = { success: true; data: T } | { success: false; error: string }

/**
 * Server action: dispara emisión de cuentas de cobro del período (anio + mes).
 *
 * Usado desde:
 *   - UI manual: módulo /cobros-recurrentes (botón "Generar mes")
 *   - Retroactivo: ejecución manual desde script de QA
 *
 * Validaciones:
 *   - Usuario autenticado con workspace
 *   - Workspace tiene modules.cobros_recurrentes=true
 *   - Solo roles owner/admin pueden ejecutar
 */
export async function ejecutarGenerarCuentasCobroPeriodo(
  anio: number,
  mes: number,
  options: { dryRun?: boolean; isDraft?: boolean } = {},
): Promise<ActionResult<GenerarCuentasResult>> {
  const { supabase, workspaceId, role, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  if (role !== 'owner' && role !== 'admin') {
    return { success: false, error: 'Solo owner o admin pueden generar cuentas de cobro' }
  }

  const { data: ws } = await supabase
    .from('workspaces')
    .select('modules, slug')
    .eq('id', workspaceId)
    .single()

  const modules = (ws as { modules: Record<string, boolean> | null } | null)?.modules
  if (!modules?.cobros_recurrentes) {
    return { success: false, error: 'Módulo cobros_recurrentes no activo en este workspace' }
  }

  try {
    const result = await generarCuentasCobroPeriodo(supabase, workspaceId, anio, mes, options)

    // Notificar a Mauricio (email) por cada cuenta creada pendiente de aprobación.
    // La notificación in-app ya quedó persistida dentro de generarCuentasCobroPeriodo.
    const workspaceSlug = (ws as { slug: string } | null)?.slug ?? 'workspace'
    for (const detalle of result.detalles) {
      if (detalle.estado !== 'creada' || !detalle.numero) continue
      await enviarEmailAprobacionPendiente({
        workspaceSlug,
        numero: detalle.numero,
        empresaNombre: detalle.empresa_nombre,
        montoTotal: detalle.monto_total,
      })
    }

    revalidatePath('/cobros-recurrentes')
    return { success: true, data: result }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { success: false, error: `Error generando cuentas: ${msg}` }
  }
}

/**
 * Server action: aprobar y enviar una cuenta de cobro al cliente.
 *
 * Gate humano único — solo owner del workspace puede llamarla.
 * Flujo: estado='emitida_pendiente_aprobacion' → aprobada_lista_envio → enviada
 *
 * Side effects:
 *   - Marca aprobado_at + aprobado_por
 *   - Envía email al cliente con PDF adjunto (helper)
 *   - Marca email_resend_id + email_enviado_at + estado='enviada'
 */
export async function aprobarYEnviarCuentaCobro(
  cuentaId: string,
): Promise<ActionResult<{ resend_id: string }>> {
  const { supabase, workspaceId, userId, role, error } = await getWorkspace()
  if (error || !workspaceId || !userId) return { success: false, error: 'No autenticado' }

  if (role !== 'owner') {
    return { success: false, error: 'Solo el owner del workspace puede aprobar cuentas de cobro' }
  }

  // 1. Validar que la cuenta existe, pertenece al workspace y está en estado correcto
  const { data: cuenta } = await supabase
    .from('cuentas_cobro_emitidas')
    .select('id, numero, estado, workspace_id')
    .eq('id', cuentaId)
    .maybeSingle()

  if (!cuenta) return { success: false, error: 'Cuenta no encontrada' }

  const c = cuenta as { id: string; numero: string; estado: string; workspace_id: string }

  if (c.workspace_id !== workspaceId) {
    return { success: false, error: 'La cuenta no pertenece a este workspace' }
  }

  if (c.estado !== 'emitida_pendiente_aprobacion') {
    return { success: false, error: `La cuenta no está pendiente de aprobación (estado: ${c.estado})` }
  }

  // 2. Marcar como aprobada
  const ahora = new Date().toISOString()
  const { error: aprErr } = await supabase
    .from('cuentas_cobro_emitidas')
    .update({
      estado: 'aprobada_lista_envio',
      aprobado_at: ahora,
      aprobado_por: userId,
    })
    .eq('id', cuentaId)

  if (aprErr) return { success: false, error: `No se pudo marcar aprobada: ${aprErr.message}` }

  // 3. Enviar email (helper marca enviada + email_resend_id)
  const envio = await enviarCuentaCobroEmail(supabase, cuentaId)
  if (!envio.success) {
    // Dejamos la cuenta en 'aprobada_lista_envio' para reintentar el envío sin re-aprobar.
    return { success: false, error: envio.error }
  }

  revalidatePath('/cobros-recurrentes')
  return { success: true, data: { resend_id: envio.resend_id } }
}
