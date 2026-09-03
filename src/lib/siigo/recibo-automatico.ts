// ============================================================
// Emisión automática del recibo de caja cuando entra plata.
//
// Decisión de Mauricio (2026-09-03): cada entrega de dinero del cliente lleva su
// recibo, y el cliente recibe el correo avisándole que su pago quedó registrado.
//
// ── Por qué esto es una función y no un trigger sobre `cobros` ──────────────
//
// `cobros` es una tabla MIXTA a nivel producto. En SOENA sus filas son plata recibida
// (medido el 2026-09-02: 383 de 383 con `external_ref`, ninguna con `plan_cobro_id` ni
// `fecha_esperada`), pero en los workspaces `metrik` y `advise` hay cuentas por cobrar
// generadas por un plan de pagos: 47 y 3 filas con `plan_cobro_id`. Un trigger por
// INSERT les emitiría recibos de caja por plata que nadie ha entregado, en la
// contabilidad real de esos workspaces y sin vuelta atrás.
//
// Por eso el disparo lo hacen los TRES caminos que sí son plata recibida (ePayco, pago
// externo y conciliación bancaria), y solo actúa si la línea lo declara.
//
// ⚠️ NUNCA lanza y NUNCA devuelve error al llamador. Registrar el pago es la operación
// que la persona pidió; el recibo es una consecuencia. Un fallo de Siigo no puede
// deshacer ni ensuciar el registro del pago.
//
// Server-only.
// ============================================================

import { createServiceClient } from '@/lib/supabase/server'
import { emitirReciboDeCobro } from './recibos'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(client: unknown): any {
  return client
}

/**
 * Emite el recibo de caja del cobro si la línea del negocio lo pide.
 *
 * Silenciosa por diseño: una línea que no declara `siigo.recibo_automatico` no cambia en
 * nada, que es lo que mantiene a los demás workspaces fuera de esto.
 */
export async function emitirReciboAutomatico(workspaceId: string, cobroId: string): Promise<void> {
  try {
    const svc = createServiceClient()

    const { data: cobro } = await db(svc)
      .from('cobros')
      .select('id, negocio_id, siigo_recibo, anulado_at')
      .eq('id', cobroId)
      .eq('workspace_id', workspaceId)
      .maybeSingle()

    if (!cobro?.negocio_id) return
    if (cobro.siigo_recibo || cobro.anulado_at) return

    const { data: neg } = await db(svc)
      .from('negocios').select('linea_id').eq('id', cobro.negocio_id).maybeSingle()
    if (!neg?.linea_id) return

    const { data: linea } = await db(svc)
      .from('lineas_negocio').select('config_extra').eq('id', neg.linea_id).maybeSingle()

    const cfgSiigo = ((linea?.config_extra ?? {}) as Record<string, unknown>).siigo as
      { recibo_automatico?: boolean; bloque_recibo_slug?: string; recibo_concepto?: string } | undefined

    // El interruptor. Arranca apagado a propósito: emitir consume numeración en la
    // contabilidad del cliente y no se deshace, así que la primera emisión automática
    // la autoriza una persona, igual que se hizo con la factura.
    if (cfgSiigo?.recibo_automatico !== true) return

    const r = await emitirReciboDeCobro(workspaceId, cobroId, null, {
      bloqueReciboSlug: cfgSiigo.bloque_recibo_slug,
      concepto: cfgSiigo.recibo_concepto,
      avisarAlCliente: true,
    })

    // `ya_emitido` y `duplicado_en_siigo` no son fallos aquí: son la idempotencia
    // haciendo su trabajo cuando el mismo cobro se toca dos veces.
    if (!r.ok && r.motivo !== 'ya_emitido' && r.motivo !== 'duplicado_en_siigo') {
      console.error('[recibo-automatico] no se emitió para el cobro', cobroId, r.motivo)
    }
  } catch (e) {
    console.error('[recibo-automatico] falló para el cobro', cobroId, (e as Error).message)
  }
}
