'use server'

import { consultarTransaccionEpayco, type EpaycoDesglose } from '@/lib/epayco'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { revalidatePath } from 'next/cache'
import { todayBogotaISO } from '@/lib/dates/bogota'

// Cast a untyped para tablas nuevas no en database.ts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(client: unknown): any { return client }

// ── Types ────────────────────────────────────────────────────────────────────

export interface PagoRegistrado {
  ref_payco: number
  monto_bruto: number
  pagador_nombre: string
  total_descuentos: number
  monto_neto: number
  tipo_cobro: string
  fecha: string
}

/** Negocio donde una referencia ePayco ya fue registrada (cobro existente). */
export interface NegocioExistente {
  negocio_id: string
  codigo: string | null
  nombre: string | null
}

// ── Estados ePayco ────────────────────────────────────────────────────────────
//
// El endpoint APIFY de ePayco (apify.epayco.co) devuelve `status` en español, tal
// como aparece en el dashboard. El ÚNICO estado que se acepta como pago real es
// "Aceptada". Cualquier otro valor (Rechazada, Pendiente, Fallida, Abandonada,
// Cancelada, Reversada, o una referencia inexistente que el endpoint reporte con
// otro estado) NO debe crear un cobro. Mantener la regla como allowlist exacta
// (== 'Aceptada') es conservador: un estado nuevo desconocido se trata como NO
// aprobado, no como aprobado por defecto.
const ESTADO_APROBADO = 'Aceptada'

// ── consultarEpayco ──────────────────────────────────────────────────────────

/**
 * Server action: consulta una transaccion ePayco por ref_payco, valida que la
 * transacción esté APROBADA en ePayco y (opcional) que la referencia no haya sido
 * registrada antes en CUALQUIER negocio del workspace.
 *
 * - Estado inválido (no 'Aceptada') → `{ error: 'epayco_no_aprobada' }` con el
 *   estado real devuelto por ePayco en `detalle`. NUNCA crea cobro.
 * - Referencia ya registrada en el workspace → `{ error: 'referencia_duplicada' }`
 *   con el negocio donde existe. Solo se evalúa cuando `validarDuplicado` es true
 *   (opt-in por bloque/workspace); retrocompatible si no se pasa.
 *
 * El registro (`registrarPagoEpayco`) re-valida ambos en servidor — esta función
 * es para feedback temprano en UI.
 */
export async function consultarEpayco(
  refPayco: string | number,
  validarDuplicado = false,
): Promise<
  | { success: true; data: EpaycoDesglose }
  | { success: false; error: string; code?: 'epayco_no_aprobada' | 'referencia_duplicada'; detalle?: string; negocio_existente?: NegocioExistente }
> {
  try {
    const ref = typeof refPayco === 'string' ? parseInt(refPayco, 10) : refPayco
    if (isNaN(ref) || ref <= 0) {
      return { success: false, error: 'Referencia de pago invalida' }
    }

    const desglose = await consultarTransaccionEpayco(ref)

    // ── Validar estado real en ePayco ──────────────────────────────────────
    if (desglose.estado !== ESTADO_APROBADO) {
      return {
        success: false,
        code: 'epayco_no_aprobada',
        detalle: desglose.estado,
        error: `La transacción está "${desglose.estado}" en ePayco — solo se registran pagos aprobados (Aceptada).`,
      }
    }

    // ── Validar duplicado en el workspace (opt-in) ─────────────────────────
    if (validarDuplicado) {
      const dup = await buscarReferenciaDuplicada(ref)
      if (dup) {
        return {
          success: false,
          code: 'referencia_duplicada',
          negocio_existente: dup,
          error: `Esta referencia ePayco ya fue registrada en el negocio ${dup.codigo ?? dup.negocio_id}.`,
        }
      }
    }

    return { success: true, data: desglose }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error consultando ePayco'
    console.error('[ePayco]', message)
    return { success: false, error: message }
  }
}

// ── buscarReferenciaDuplicada ────────────────────────────────────────────────

/**
 * Busca si una referencia ePayco ya está registrada como cobro en CUALQUIER
 * negocio del workspace actual. Retorna el negocio donde existe, o null.
 */
async function buscarReferenciaDuplicada(refPayco: number): Promise<NegocioExistente | null> {
  const { supabase, workspaceId } = await getWorkspace()
  if (!workspaceId) return null

  const { data: cobro } = await db(supabase)
    .from('cobros')
    .select('negocio_id')
    .eq('workspace_id', workspaceId)
    .eq('external_ref', String(refPayco))
    .not('negocio_id', 'is', null)
    .limit(1)
    .maybeSingle()

  const negocioId = (cobro as { negocio_id: string | null } | null)?.negocio_id
  if (!negocioId) return null

  const { data: negocio } = await db(supabase)
    .from('negocios')
    .select('id, codigo, nombre')
    .eq('id', negocioId)
    .single()

  const n = negocio as { id: string; codigo: string | null; nombre: string | null } | null
  return {
    negocio_id: negocioId,
    codigo: n?.codigo ?? null,
    nombre: n?.nombre ?? null,
  }
}

// ── registrarPagoEpayco ──────────────────────────────────────────────────────

/**
 * Server action: registra un pago ePayco en el bloque del negocio.
 *
 * 1. Crea cobro (idempotente via external_ref)
 * 2. Crea gasto por comision (idempotente via external_ref)
 * 3. Actualiza negocio_bloques.data.pagos + marca bloque completo
 * 4. Revalida la ruta del negocio
 */
export interface RegistrarPagoEpaycoOpts {
  /** Si true, re-valida estado + duplicado en servidor (opt-in por bloque/ws). */
  validarEpayco?: boolean
  /** Justificación para forzar el registro de una referencia duplicada. */
  justificacion?: string
}

export async function registrarPagoEpayco(
  negocioBloqueId: string,
  negocioId: string,
  desglose: EpaycoDesglose,
  tipoCobro: string,
  opts: RegistrarPagoEpaycoOpts = {},
): Promise<
  | { success: true; pagos: PagoRegistrado[] }
  | { success: false; error: string; code?: 'epayco_no_aprobada' | 'referencia_duplicada' | 'justificacion_requerida'; negocio_existente?: NegocioExistente }
> {
  try {
    const { supabase, workspaceId, staffId, error } = await getWorkspace()
    if (error || !workspaceId) {
      return { success: false, error: error ?? 'Sin workspace' }
    }

    // ── 0. Re-validar en servidor cuando la validación está activada ────────
    // El cliente ya pasó por consultarEpayco, pero el desglose llega del cliente
    // → no se puede confiar en él como barrera. Re-consultamos ePayco para el
    // estado real + los montos reales (autoritativos) y revalidamos duplicado
    // workspace-wide.
    let desgloseFinal = desglose
    if (opts.validarEpayco) {
      const fresh = await consultarTransaccionEpayco(desglose.ref_payco)
      if (fresh.estado !== ESTADO_APROBADO) {
        return {
          success: false,
          code: 'epayco_no_aprobada',
          error: `La transacción está "${fresh.estado}" en ePayco — solo se registran pagos aprobados.`,
        }
      }
      // El desglose recién consultado es la fuente de verdad (montos/comisiones),
      // no el que envió el cliente.
      desgloseFinal = fresh

      const dup = await buscarReferenciaDuplicada(desgloseFinal.ref_payco)
      if (dup) {
        const justificacion = (opts.justificacion ?? '').trim()
        if (!justificacion) {
          // Bloqueo con override: el cliente debe reenviar con justificación.
          return {
            success: false,
            code: 'referencia_duplicada',
            negocio_existente: dup,
            error: `Esta referencia ePayco ya fue registrada en el negocio ${dup.codigo ?? dup.negocio_id}. Justifica el registro para continuar.`,
          }
        }
        // Override autorizado → registrar la justificación en el activity log
        // del negocio (visible en el timeline) antes de crear el cobro.
        try {
          await db(supabase).from('activity_log').insert({
            workspace_id: workspaceId,
            entidad_tipo: 'negocio',
            entidad_id: negocioId,
            tipo: 'comentario',
            ...(staffId ? { autor_id: staffId } : {}),
            contenido: `Referencia ePayco ${desgloseFinal.ref_payco} registrada pese a estar duplicada (ya existía en ${dup.codigo ?? dup.negocio_id}). Justificación: ${justificacion.slice(0, 500)}`,
          })
        } catch (logErr) {
          console.error('[ePayco registrar] No se pudo registrar justificación en activity_log:', logErr)
        }
      }
    }

    // ── 1. Leer datos actuales del bloque ──────────────────────────────────
    const { data: bloque } = await db(supabase)
      .from('negocio_bloques')
      .select('data')
      .eq('id', negocioBloqueId)
      .single()

    const currentData = (bloque?.data as Record<string, unknown>) ?? {}
    const currentPagos = (currentData.pagos ?? []) as PagoRegistrado[]

    // ── 2. Idempotencia en bloque ──────────────────────────────────────────
    if (currentPagos.some(p => p.ref_payco === desgloseFinal.ref_payco)) {
      return { success: true, pagos: currentPagos } // Ya registrado
    }

    // ── 3. Crear cobro (idempotente via external_ref) ──────────────────────
    const { data: existingCobro } = await db(supabase)
      .from('cobros')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('negocio_id', negocioId)
      .eq('external_ref', String(desgloseFinal.ref_payco))
      .limit(1)

    if (!existingCobro || (existingCobro as unknown[]).length === 0) {
      const cobro = {
        workspace_id: workspaceId,
        negocio_id: negocioId,
        notas: tipoCobro === 'anticipo' ? 'Anticipo' : 'Pago',
        monto: desgloseFinal.monto_bruto,
        tipo_cobro: tipoCobro,
        fecha: todayBogotaISO(),
        external_ref: String(desgloseFinal.ref_payco),
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: cobroError } = await (db(supabase) as any).from('cobros').insert(cobro)
      if (cobroError) return { success: false, error: (cobroError as { message: string }).message }
    }

    // ── 4. Crear gasto por comision (idempotente via external_ref) ─────────
    const gastoRef = `epayco-comision-${desgloseFinal.ref_payco}`
    const { data: existingGasto } = await db(supabase)
      .from('gastos')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('negocio_id', negocioId)
      .eq('external_ref', gastoRef)
      .limit(1)

    if (!existingGasto || (existingGasto as unknown[]).length === 0) {
      const gasto = {
        workspace_id: workspaceId,
        negocio_id: negocioId,
        fecha: todayBogotaISO(),
        monto: desgloseFinal.total_descuentos,
        categoria: 'servicios_profesionales',
        descripcion: `Comision ePayco — Ref ${desgloseFinal.ref_payco}`,
        tipo: 'operativo',
        external_ref: gastoRef,
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (db(supabase) as any).from('gastos').insert(gasto)
    }

    // ── 5. Agregar pago al bloque y marcar completo ────────────────────────
    const newPago: PagoRegistrado = {
      ref_payco: desgloseFinal.ref_payco,
      monto_bruto: desgloseFinal.monto_bruto,
      pagador_nombre: desgloseFinal.pagador_nombre,
      total_descuentos: desgloseFinal.total_descuentos,
      monto_neto: desgloseFinal.monto_neto,
      tipo_cobro: tipoCobro,
      fecha: todayBogotaISO(),
    }
    const updatedPagos = [...currentPagos, newPago]
    const updatedData = { ...currentData, pagos: updatedPagos }

    await db(supabase)
      .from('negocio_bloques')
      .update({
        data: updatedData,
        estado: 'completo',
        completado_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', negocioBloqueId)

    // ── 6. Revalidar y retornar ────────────────────────────────────────────
    revalidatePath(`/negocios/${negocioId}`)
    return { success: true, pagos: updatedPagos }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error registrando pago ePayco'
    console.error('[ePayco registrar]', message)
    return { success: false, error: message }
  }
}
