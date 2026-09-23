/**
 * Confirmar el pago de un COBRO PROGRAMADO: la única escritura con la que ONE da por pagada una
 * cuota de un plan de cobro. La usan el botón «Confirmar pago manual» del bloque de cobros
 * (`confirmarCobroProgramado`, con la sesión) y el registro del pago en línea (`pago-en-linea.ts`, con el
 * cliente de servicio). Por eso recibe el cliente y el espacio por parámetro, y no lee la sesión.
 *
 * Qué hace, y nada más:
 *   1. Pone `fecha` y apaga `vencido` en el cobro, SOLO si sigue sin fecha (guarda dentro del
 *      `update`, no en un `if` previo: dos confirmaciones simultáneas no pisan una a la otra).
 *   2. Si la pasarela la trae, deja la referencia del pago (`external_ref`) y la `fuente`.
 *   3. Si llegó un monto distinto al esperado, deja el monto REAL: es la plata que entró. El
 *      excedente se descuenta de la siguiente cuota al generar su enlace (reparto FIFO de
 *      `cuotasConEstado`), no aquí.
 *   4. Cierra las notificaciones `cobro_vencido` de ese cobro.
 *
 * El trigger `trg_cobro_programado_completado` apaga el plan cuando se confirma la última cuota.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export interface ConfirmacionPago {
  cobroId: string
  workspaceId: string
  /** 'YYYY-MM-DD' Bogotá en que entró la plata. */
  fecha: string
  externalRef?: string | null
  fuente?: string | null
  /** Monto recibido, si difiere del programado. */
  monto?: number | null
  notas?: string | null
  /**
   * El cliente pagó el total y no retuvo el IVA: se quita la retención que el enlace por el neto
   * había dejado en «certificado pendiente» (`retencion-iva.ts`).
   */
  quitarRetencionIva?: boolean
}

export type ResultadoConfirmacion =
  | { ok: true }
  | { ok: false; motivo: 'ya_confirmado' | 'no_encontrado' | 'error'; error: string }

export async function confirmarPagoCobroProgramado(
  db: SupabaseClient,
  c: ConfirmacionPago,
): Promise<ResultadoConfirmacion> {
  const patch: Record<string, unknown> = { fecha: c.fecha, vencido: false }
  if (c.externalRef) patch.external_ref = c.externalRef
  if (c.fuente) patch.fuente = c.fuente
  if (typeof c.monto === 'number' && Number.isFinite(c.monto) && c.monto > 0) patch.monto = c.monto
  if (c.notas) patch.notas = c.notas
  if (c.quitarRetencionIva) Object.assign(patch, { retencion_iva: 0, retencion_iva_estado: null, retencion: 0 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (db as any)
    .from('cobros')
    .update(patch)
    .eq('id', c.cobroId)
    .eq('workspace_id', c.workspaceId)
    .eq('tipo_cobro', 'programado')
    .is('fecha', null)
    .is('anulado_at', null)
    .select('id')
  if (error) return { ok: false, motivo: 'error', error: error.message }
  if (!data || data.length === 0) {
    return { ok: false, motivo: 'ya_confirmado', error: 'El cobro ya estaba confirmado, anulado o no es programado.' }
  }

  // Cierre de avisos: si falla, el pago igual quedó registrado; se deja rastro y se sigue.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: errNotif } = await (db as any)
    .from('notificaciones')
    .update({ estado: 'completada', updated_at: new Date().toISOString() })
    .eq('entidad_tipo', 'cobro')
    .eq('entidad_id', c.cobroId)
    .eq('estado', 'pendiente')
  if (errNotif) console.error('[confirmar-cobro] cerrar notificaciones:', errNotif.message)

  return { ok: true }
}
