'use server'

import { consultarTransaccionEpayco, type EpaycoDesglose } from '@/lib/epayco'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { revalidatePath } from 'next/cache'

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

// ── consultarEpayco ──────────────────────────────────────────────────────────

/**
 * Server action: consulta una transaccion ePayco por ref_payco
 * y devuelve el desglose completo de comisiones.
 */
export async function consultarEpayco(
  refPayco: string | number
): Promise<{ success: true; data: EpaycoDesglose } | { success: false; error: string }> {
  try {
    const ref = typeof refPayco === 'string' ? parseInt(refPayco, 10) : refPayco
    if (isNaN(ref) || ref <= 0) {
      return { success: false, error: 'Referencia de pago invalida' }
    }

    const desglose = await consultarTransaccionEpayco(ref)

    // Validate transaction was approved
    if (desglose.estado !== 'Aceptada') {
      return {
        success: false,
        error: `Transaccion ${desglose.estado.toLowerCase()} — solo se procesan transacciones aprobadas`,
      }
    }

    return { success: true, data: desglose }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error consultando ePayco'
    console.error('[ePayco]', message)
    return { success: false, error: message }
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
export async function registrarPagoEpayco(
  negocioBloqueId: string,
  negocioId: string,
  desglose: EpaycoDesglose,
  tipoCobro: string
): Promise<{ success: true; pagos: PagoRegistrado[] } | { success: false; error: string }> {
  try {
    const { supabase, workspaceId, error } = await getWorkspace()
    if (error || !workspaceId) {
      return { success: false, error: error ?? 'Sin workspace' }
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
    if (currentPagos.some(p => p.ref_payco === desglose.ref_payco)) {
      return { success: true, pagos: currentPagos } // Ya registrado
    }

    // ── 3. Crear cobro (idempotente via external_ref) ──────────────────────
    const { data: existingCobro } = await db(supabase)
      .from('cobros')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('negocio_id', negocioId)
      .eq('external_ref', String(desglose.ref_payco))
      .limit(1)

    if (!existingCobro || (existingCobro as unknown[]).length === 0) {
      const cobro = {
        workspace_id: workspaceId,
        negocio_id: negocioId,
        notas: tipoCobro === 'anticipo' ? 'Anticipo' : 'Pago',
        monto: desglose.monto_bruto,
        tipo_cobro: tipoCobro,
        estado_causacion: 'PENDIENTE',
        fecha: new Date().toISOString().split('T')[0],
        external_ref: String(desglose.ref_payco),
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: cobroError } = await (db(supabase) as any).from('cobros').insert(cobro)
      if (cobroError) return { success: false, error: (cobroError as { message: string }).message }
    }

    // ── 4. Crear gasto por comision (idempotente via external_ref) ─────────
    const gastoRef = `epayco-comision-${desglose.ref_payco}`
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
        fecha: new Date().toISOString().split('T')[0],
        monto: desglose.total_descuentos,
        categoria: 'servicios_profesionales',
        descripcion: `Comision ePayco — Ref ${desglose.ref_payco}`,
        tipo: 'operativo',
        estado_causacion: 'PENDIENTE',
        external_ref: gastoRef,
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (db(supabase) as any).from('gastos').insert(gasto)
    }

    // ── 5. Agregar pago al bloque y marcar completo ────────────────────────
    const newPago: PagoRegistrado = {
      ref_payco: desglose.ref_payco,
      monto_bruto: desglose.monto_bruto,
      pagador_nombre: desglose.pagador_nombre,
      total_descuentos: desglose.total_descuentos,
      monto_neto: desglose.monto_neto,
      tipo_cobro: tipoCobro,
      fecha: new Date().toISOString().split('T')[0],
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
