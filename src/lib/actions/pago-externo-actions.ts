'use server'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { guardEditarBloque } from '@/lib/permissions/guard-negocio'
import { revalidatePath } from 'next/cache'
import { todayBogotaISO } from '@/lib/dates/bogota'

// Cast a untyped para columnas/tipos nuevos no en database.ts (tipo_cobro 'externo')
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(client: unknown): any {
  return client
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface PagoExternoRegistrado {
  cobro_id: string
  referencia: string
  monto_bruto: number
  retefuente: number
  reteica: number
  monto_neto: number
  fecha: string
}

export interface RegistrarPagoExternoInput {
  monto: number
  referencia: string
  fecha?: string // 'YYYY-MM-DD'. Default: hoy (Bogota)
  retefuente?: number
  reteica?: number
}

// ── registrarPagoExterno ──────────────────────────────────────────────────────

/**
 * Registra un pago EXTERNO (no ePayco) atado a un negocio.
 *
 * Caso: pagos que NO entran por la pasarela ePayco — "cuenta de vivienda" + B2B.
 * Inserta en `cobros` con `tipo_cobro='externo'`, `external_ref`=referencia manual,
 * `fecha` seteada → cuenta para el saldo del negocio automáticamente (la lógica de
 * saldo suma `cobros.monto` por `negocio_id` sin filtrar por tipo).
 *
 * Permisos: respeta `canEditBloque` por stage/área vía `guardEditarBloque`.
 * Idempotencia: por `external_ref` (referencia) dentro del negocio — un doble
 * click no duplica el cobro.
 */
export async function registrarPagoExterno(
  negocioBloqueId: string,
  negocioId: string,
  input: RegistrarPagoExternoInput,
): Promise<
  | { success: true; pagos: PagoExternoRegistrado[] }
  | { success: false; error: string }
> {
  try {
    // ── 0. Permisos (stage/área) ────────────────────────────────────────────
    const guard = await guardEditarBloque(negocioBloqueId)
    if (!guard.ok) {
      return { success: false, error: guard.error ?? 'Sin permiso' }
    }

    const { supabase, workspaceId, error } = await getWorkspace()
    if (error || !workspaceId) {
      return { success: false, error: error ?? 'Sin workspace' }
    }

    // ── 1. Validación de entrada ────────────────────────────────────────────
    const monto = Number(input.monto)
    if (!Number.isFinite(monto) || monto <= 0) {
      return { success: false, error: 'El monto debe ser mayor a cero' }
    }
    const referencia = (input.referencia ?? '').trim()
    if (!referencia) {
      return { success: false, error: 'La referencia o comprobante es obligatorio' }
    }
    const retefuente = Math.max(0, Number(input.retefuente ?? 0) || 0)
    const reteica = Math.max(0, Number(input.reteica ?? 0) || 0)
    const fecha = (input.fecha ?? '').trim() || todayBogotaISO()
    const externalRef = `externo-${referencia}`

    // ── 2. Idempotencia: ¿ya existe un cobro externo con esta referencia? ────
    const { data: existing } = await db(supabase)
      .from('cobros')
      .select('id, monto, fecha, retencion, notas')
      .eq('workspace_id', workspaceId)
      .eq('negocio_id', negocioId)
      .eq('external_ref', externalRef)
      .limit(1)

    let cobroId: string
    if (existing && (existing as unknown[]).length > 0) {
      // Ya registrado (doble click / reintento) — no duplicar.
      cobroId = (existing as { id: string }[])[0].id
    } else {
      // ── 3. Insertar cobro ─────────────────────────────────────────────────
      // `retencion` (NUMERIC simple) guarda el total retenido; el desglose
      // retefuente/reteica queda en `notas` para trazabilidad.
      const retencionTotal = retefuente + reteica
      const desglose: string[] = []
      if (retefuente > 0) desglose.push(`ReteFuente $${retefuente.toLocaleString('es-CO')}`)
      if (reteica > 0) desglose.push(`ReteICA $${reteica.toLocaleString('es-CO')}`)
      const notas = `Pago externo — Ref ${referencia}${desglose.length ? ` (${desglose.join(' + ')})` : ''}`

      const cobro = {
        workspace_id: workspaceId,
        negocio_id: negocioId,
        monto,
        tipo_cobro: 'externo',
        fecha,
        external_ref: externalRef,
        retencion: retencionTotal > 0 ? retencionTotal : null,
        notas,
      }
      const { data: inserted, error: cobroError } = await db(supabase)
        .from('cobros')
        .insert(cobro)
        .select('id')
        .single()
      if (cobroError || !inserted) {
        return {
          success: false,
          error: (cobroError as { message?: string } | null)?.message ?? 'No se pudo registrar el cobro',
        }
      }
      cobroId = (inserted as { id: string }).id
    }

    // ── 4. Persistir en el bloque (lista de pagos externos) + marcar completo ─
    const { data: bloque } = await db(supabase)
      .from('negocio_bloques')
      .select('data')
      .eq('id', negocioBloqueId)
      .single()

    const currentData = (bloque?.data as Record<string, unknown>) ?? {}
    const currentPagos = (currentData.pagos_externos ?? []) as PagoExternoRegistrado[]

    const yaEnBloque = currentPagos.some(p => p.cobro_id === cobroId)
    const updatedPagos = yaEnBloque
      ? currentPagos
      : [
          ...currentPagos,
          {
            cobro_id: cobroId,
            referencia,
            monto_bruto: monto,
            retefuente,
            reteica,
            monto_neto: monto - retefuente - reteica,
            fecha,
          } satisfies PagoExternoRegistrado,
        ]

    if (!yaEnBloque) {
      await db(supabase)
        .from('negocio_bloques')
        .update({
          data: { ...currentData, pagos_externos: updatedPagos },
          estado: 'completo',
          completado_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', negocioBloqueId)
    }

    // ── 5. Revalidar y retornar ──────────────────────────────────────────────
    revalidatePath(`/negocios/${negocioId}`)
    return { success: true, pagos: updatedPagos }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error registrando pago externo'
    console.error('[pago externo]', message)
    return { success: false, error: message }
  }
}
