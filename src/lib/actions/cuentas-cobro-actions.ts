'use server'

import { revalidatePath } from 'next/cache'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { generarCuentasCobroPeriodo, type GenerarCuentasResult } from '@/lib/cobros/generar-cuentas-cobro'
import { enviarCuentaCobroEmail } from '@/lib/email/send-cuenta-cobro'
import { enviarEmailAprobacionPendiente } from '@/lib/email/send-aprobacion-cuenta-cobro'
import {
  planearCobrosCompletos,
  planearAbonoParcial,
  anotar,
  formatCOP,
  EVIDENCIA_MIN_CARACTERES,
  type CobroDeCuenta,
  type RegistrarPagoInput,
  type RegistrarPagoResult,
} from '@/lib/cobros/registrar-pago-cuenta'

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

    // Un dry-run devuelve los detalles con estado 'creada' (es el preview de lo que
    // se crearia), asi que sin este corte un PREVIEW mandaria los correos de
    // aprobacion de cuentas que no existen. Nada de lo que sigue puede correr en
    // dry-run: no se escribio nada que notificar ni que revalidar.
    if (options.dryRun) return { success: true, data: result }

    // Notificar por correo cada cuenta creada pendiente de aprobación.
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

/**
 * Server action: reenvía una cuenta de cobro ya aprobada al cliente.
 *
 * Caso de uso:
 *   - Cuenta enviada con código viejo (sin PILA adjunta) → reenviar para que
 *     el cliente reciba ahora con la planilla.
 *   - Cuenta en estado 'aprobada_lista_envio' que quedó stuck por falla previa
 *     del envío.
 *
 * Validaciones:
 *   - Solo owner
 *   - Estado en {'enviada', 'aprobada_lista_envio'}
 *   - No re-aprueba — usa la aprobación previa
 *
 * Side effects:
 *   - Sobrescribe email_resend_id + email_enviado_at (queda el del último envío)
 *   - Si estado era 'aprobada_lista_envio', pasa a 'enviada'
 *   - No toca aprobado_at, aprobado_por, pagado_at
 */
export async function reenviarCuentaCobro(
  cuentaId: string,
): Promise<ActionResult<{ resend_id: string }>> {
  const { supabase, workspaceId, userId, role, error } = await getWorkspace()
  if (error || !workspaceId || !userId) return { success: false, error: 'No autenticado' }

  if (role !== 'owner') {
    return { success: false, error: 'Solo el owner del workspace puede reenviar cuentas de cobro' }
  }

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

  if (c.estado !== 'enviada' && c.estado !== 'aprobada_lista_envio') {
    return { success: false, error: `La cuenta no se puede reenviar (estado: ${c.estado})` }
  }

  const envio = await enviarCuentaCobroEmail(supabase, cuentaId)
  if (!envio.success) {
    return { success: false, error: envio.error }
  }

  revalidatePath('/cobros-recurrentes')
  return { success: true, data: { resend_id: envio.resend_id } }
}

// ── Registro de pago de una cuenta de cobro ────────────────────────

/**
 * Estados desde los que se puede registrar un pago. Una cuenta que todavia
 * espera aprobacion no es un cobro que el cliente pueda haber pagado, y una
 * anulada ya no reclama nada.
 */
const ESTADOS_QUE_ADMITEN_PAGO = ['enviada', 'aprobada_lista_envio']

/**
 * Registra el pago (total o parcial) de una cuenta de cobro.
 *
 * Hasta hoy no existia: cada pago se venia registrando a mano por SQL desde
 * mayo. El modelo lo fijan las decisiones de `proyectos/metrik/one/decisions.md`
 * (2026-06-22 y 2026-07-08); las reglas puras viven en
 * `src/lib/cobros/registrar-pago-cuenta.ts`.
 *
 * NO envia nada al cliente ni toca la aprobacion.
 */
export async function registrarPagoCuentaCobro(
  input: RegistrarPagoInput,
): Promise<ActionResult<RegistrarPagoResult>> {
  const { supabase, workspaceId, userId, role, error } = await getWorkspace()
  if (error || !workspaceId || !userId) return { success: false, error: 'No autenticado' }

  if (role !== 'owner' && role !== 'admin') {
    return { success: false, error: 'Solo owner o admin pueden registrar pagos' }
  }

  // La evidencia es un requisito del modelo, no un adorno: un comprobante de
  // transferencia entre cuentas propias NO prueba el ingreso del cliente
  // (decision 2026-06-22, a raiz del caso AFI de $500k).
  const evidencia = input.evidencia.trim()
  if (evidencia.length < EVIDENCIA_MIN_CARACTERES) {
    return {
      success: false,
      error: `Describe la evidencia del crédito entrante (mínimo ${EVIDENCIA_MIN_CARACTERES} caracteres). Un comprobante de transferencia entre cuentas propias no prueba el ingreso del cliente.`,
    }
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.fecha)) {
    return { success: false, error: 'Fecha inválida' }
  }

  const { data: cuentaRow, error: cErr } = await supabase
    .from('cuentas_cobro_emitidas')
    .select('id, numero, estado, workspace_id, cobros_ids, notas, monto_total')
    .eq('id', input.cuentaId)
    .maybeSingle()

  if (cErr) return { success: false, error: `No se pudo leer la cuenta: ${cErr.message}` }
  if (!cuentaRow) return { success: false, error: 'Cuenta no encontrada' }

  const cuenta = cuentaRow as {
    id: string; numero: string; estado: string; workspace_id: string
    cobros_ids: string[]; notas: string | null; monto_total: number
  }

  if (cuenta.workspace_id !== workspaceId) {
    return { success: false, error: 'La cuenta no pertenece a este workspace' }
  }
  if (!ESTADOS_QUE_ADMITEN_PAGO.includes(cuenta.estado)) {
    return { success: false, error: `No se puede registrar un pago sobre una cuenta ${cuenta.estado}` }
  }

  // Los cobros se releen de la base, no llegan del navegador: el monto que
  // decide si el pago calza es el vigente, no el que la pantalla vio al abrirse.
  const { data: cobrosRows, error: cobErr } = await supabase
    .from('cobros')
    .select('id, monto, fecha, negocio_id, notas')
    .in('id', cuenta.cobros_ids)

  if (cobErr) return { success: false, error: `No se pudieron leer los cobros: ${cobErr.message}` }

  const cobros = ((cobrosRows ?? []) as { id: string; monto: number; fecha: string | null; negocio_id: string | null; notas: string | null }[])
  const cobrosDeLaCuenta: CobroDeCuenta[] = cobros.map(c => ({
    id: c.id,
    monto: Number(c.monto),
    fecha: c.fecha,
  }))

  const hoy = new Date().toISOString().slice(0, 10)

  if (input.modo === 'cobros_completos') {
    const plan = planearCobrosCompletos(cobrosDeLaCuenta, input.cobrosIds, input.monto)
    if (!plan.ok) return { success: false, error: plan.error }

    const { error: updErr } = await supabase
      .from('cobros')
      .update({ fecha: input.fecha, revisado: true, vencido: false })
      .in('id', plan.aMarcar)

    if (updErr) return { success: false, error: `No se pudieron marcar los cobros: ${updErr.message}` }

    const linea = plan.cierraLaCuenta
      ? `[${hoy}] Pago ${formatCOP(plan.montoPagado)} (fecha valor ${input.fecha}). Cuenta saldada. Evidencia: ${evidencia}`
      : `[${hoy}] Abono ${formatCOP(plan.montoPagado)} (fecha valor ${input.fecha}). Saldo pendiente ${formatCOP(plan.saldoPendiente)}. Evidencia: ${evidencia}`

    // La cuenta pasa a `pagada` SOLO cuando todos sus cobros tienen fecha. El
    // enum no tiene "parcial", asi que un pago que cubre parte la deja en
    // `enviada` con el abono y el saldo escritos en `notas`.
    const patch: Record<string, unknown> = { notas: anotar(cuenta.notas, linea) }
    if (plan.cierraLaCuenta) {
      patch.estado = 'pagada'
      patch.pagado_at = new Date().toISOString()
    }

    const { error: ccErr } = await supabase
      .from('cuentas_cobro_emitidas')
      .update(patch)
      .eq('id', cuenta.id)

    if (ccErr) {
      // Los cobros ya quedaron marcados: no se puede fingir que el pago no ocurrio.
      return {
        success: false,
        error: `Los cobros quedaron marcados como pagados, pero no se pudo actualizar la cuenta: ${ccErr.message}`,
      }
    }

    revalidatePath('/cobros-recurrentes')
    return {
      success: true,
      data: {
        cuentaCerrada: plan.cierraLaCuenta,
        saldoPendiente: plan.saldoPendiente,
        mensaje: plan.cierraLaCuenta
          ? `Cuenta ${cuenta.numero} saldada.`
          : `Abono registrado. Saldo pendiente ${formatCOP(plan.saldoPendiente)}.`,
      },
    }
  }

  // ── Abono parcial ────────────────────────────────────────────────
  // La cuota programada NO se puede partir en dos cobros programados: lo impide
  // el indice unico parcial `idx_cobros_plan_cuota_unique` sobre
  // (plan_cobro_id, numero_cuota). Por eso la porcion pagada entra como cobro
  // MANUAL (sin plan ni cuota, exento del indice) y la cuota original baja al
  // saldo. La suma de las dos es la cuota original: el total de la cuenta no se
  // mueve.
  const plan = planearAbonoParcial(cobrosDeLaCuenta, input.cobroId, input.monto)
  if (!plan.ok) return { success: false, error: plan.error }

  const original = cobros.find(c => c.id === plan.cobroReducidoId)!

  const { data: nuevoCobro, error: insErr } = await supabase
    .from('cobros')
    .insert({
      workspace_id: workspaceId,
      negocio_id: original.negocio_id,
      plan_cobro_id: null,
      numero_cuota: null,
      tipo_cobro: 'pago',
      monto: plan.montoAbono,
      fecha: input.fecha,
      revisado: true,
      vencido: false,
      retencion: 0,
      notas: `Abono parcial de la cuenta ${cuenta.numero}. Evidencia: ${evidencia}`,
    })
    .select('id')
    .single()

  if (insErr || !nuevoCobro) {
    return { success: false, error: `No se pudo registrar el abono: ${insErr?.message ?? 'sin id'}` }
  }

  const { error: redErr } = await supabase
    .from('cobros')
    .update({
      monto: plan.montoReducido,
      notas: anotar(original.notas, `Reducido a ${formatCOP(plan.montoReducido)} por abono parcial del ${input.fecha}.`),
    })
    .eq('id', plan.cobroReducidoId)

  if (redErr) {
    return {
      success: false,
      error: `El abono quedó registrado pero la cuota original no se redujo: ${redErr.message}. Corrígelo antes de seguir: la cuenta está descuadrada.`,
    }
  }

  const nuevoCobroId = (nuevoCobro as { id: string }).id
  const saldoPendiente = cobrosDeLaCuenta
    .filter(c => !c.fecha)
    .reduce((s, c) => s + c.monto, 0) - plan.montoAbono

  const linea = `[${hoy}] Abono parcial ${formatCOP(plan.montoAbono)} (fecha valor ${input.fecha}). La cuota baja a ${formatCOP(plan.montoReducido)}. Saldo pendiente ${formatCOP(saldoPendiente)}. Evidencia: ${evidencia}`

  const { error: ccErr } = await supabase
    .from('cuentas_cobro_emitidas')
    .update({
      // El cobro manual se agrega a `cobros_ids` para preservar el total de la cuenta.
      cobros_ids: [...cuenta.cobros_ids, nuevoCobroId],
      notas: anotar(cuenta.notas, linea),
    })
    .eq('id', cuenta.id)

  if (ccErr) {
    return {
      success: false,
      error: `El abono se registró pero la cuenta no se actualizó: ${ccErr.message}`,
    }
  }

  revalidatePath('/cobros-recurrentes')
  return {
    success: true,
    data: {
      cuentaCerrada: false,
      saldoPendiente,
      mensaje: `Abono parcial registrado. Saldo pendiente ${formatCOP(saldoPendiente)}.`,
    },
  }
}
