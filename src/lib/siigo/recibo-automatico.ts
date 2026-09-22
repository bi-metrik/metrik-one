// ============================================================
// Lo que pasa en Siigo cuando entra plata.
//
// Dos documentos, con dos reglas distintas desde el brief del 2026-09-22 («Tesorería
// solo emite recibos de la tarifa UPME»):
//
//   1. El ABONO del honorario a la factura (RC-1 `DebtPayment`) — SIEMPRE, si el negocio
//      ya tiene factura y la línea declara el honorario como abono. Es 100 % automático:
//      no tiene botón, no genera PDF ni correo, y **no depende de `recibo_automatico`**.
//      Lo hace `abonarAlRegistrarPago`.
//   2. El RECIBO de la tarifa UPME (RC-3) — solo si la línea lo pide con
//      `siigo.recibo_automatico`. Ese interruptor ahora gobierna ÚNICAMENTE al RC-3: el
//      honorario ya no sale como recibo por ninguna vía (ni anticipo ni a mano).
//
// ── Por qué esto es una función y no un trigger sobre `cobros` ──────────────
//
// `cobros` es una tabla MIXTA a nivel producto. En SOENA sus filas son plata recibida
// (medido el 2026-09-02: 383 de 383 con `external_ref`, ninguna con `plan_cobro_id` ni
// `fecha_esperada`), pero en los workspaces `metrik` y `advise` hay cuentas por cobrar
// generadas por un plan de pagos: 47 y 3 filas con `plan_cobro_id`. Un trigger por
// INSERT les emitiría documentos por plata que nadie ha entregado, en la contabilidad real
// de esos workspaces y sin vuelta atrás.
//
// Por eso el disparo lo hacen los caminos que sí son plata recibida:
//
//   - ePayco y pago externo, que conocen el cobro → `alRegistrarCobro` (abono + RC-3).
//   - El panel de conciliación y el FAB (`registrarPagoEnNegocio`), el anticipo y el
//     multipago de los bloques (`autoCrearCobros*`), el reparto, su aceptación por la
//     financiera y la redistribución → `abonarAlRegistrarPago` (solo el abono: el RC-3 de
//     esos caminos sigue saliendo desde Tesorería, como antes).
//
// ⚠️ NUNCA lanza y NUNCA devuelve error al llamador. Registrar el pago es la operación
// que la persona pidió; el documento es una consecuencia. Un fallo de Siigo no puede
// deshacer ni ensuciar el registro del pago: el cobro queda sin marca, el error queda en
// el log, y el abono se reintenta con el siguiente pago del mismo negocio o con el lote
// del rezago (`scripts/abonar-rezago.ts`).
//
// Server-only.
// ============================================================

import { createServiceClient } from '@/lib/supabase/server'
import { emitirReciboDeCobro } from './recibos'
import { leerReciboPorConcepto, tieneRecibo } from './recibo-componentes'
import { abonarPagosDelNegocio } from './abonos-factura'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(client: unknown): any {
  return client
}

/**
 * Abona a la factura el honorario de los pagos del negocio que todavía no lo tengan.
 *
 * Se llama DESPUÉS de registrar un pago. Recorre el negocio y no solo el cobro nuevo, así
 * que también recoge un abono que falló la vez anterior. Sin factura, o en una línea que
 * no declara el abono, no hace nada.
 */
export async function abonarAlRegistrarPago(workspaceId: string, negocioId: string): Promise<void> {
  try {
    const r = await abonarPagosDelNegocio(workspaceId, negocioId, null)
    // Lo que falló queda sin marca: lo reintenta el siguiente pago o el lote. Se deja en
    // el log con el cobro para que quien corra el lote sepa qué buscar.
    for (const f of r.fallidos) {
      console.error('[abono-automatico] no se abonó el cobro', f.cobro_id, 'del negocio', negocioId, f.motivo)
    }
  } catch (e) {
    console.error('[abono-automatico] falló para el negocio', negocioId, (e as Error).message)
  }
}

/**
 * Todo lo que Siigo necesita cuando se registra UN cobro: el abono del honorario (siempre)
 * y el RC-3 de la tarifa (solo con `recibo_automatico`).
 *
 * Silenciosa por diseño: una línea que no declara nada de esto no cambia en nada, que es
 * lo que mantiene a los demás workspaces fuera.
 */
export async function alRegistrarCobro(workspaceId: string, cobroId: string): Promise<void> {
  try {
    const svc = createServiceClient()

    const { data: cobro } = await db(svc)
      .from('cobros')
      .select('id, negocio_id, siigo_recibo, anulado_at')
      .eq('id', cobroId)
      .eq('workspace_id', workspaceId)
      .maybeSingle()

    if (!cobro?.negocio_id || cobro.anulado_at) return

    // ── 1. El abono: no mira `recibo_automatico` ──
    await abonarAlRegistrarPago(workspaceId, cobro.negocio_id)

    // ── 2. El RC-3: solo si la línea lo pide ──
    await emitirReciboAutomatico(workspaceId, cobroId, cobro.negocio_id)
  } catch (e) {
    console.error('[recibo-automatico] falló para el cobro', cobroId, (e as Error).message)
  }
}

/**
 * El recibo de caja de la tarifa UPME, si la línea tiene encendido `recibo_automatico`.
 *
 * No se exporta: el único camino para llegar aquí es `alRegistrarCobro`, que antes hizo
 * el abono. Así no queda una función que emita el RC-3 de un pago y deje su honorario sin
 * abonar.
 */
async function emitirReciboAutomatico(workspaceId: string, cobroId: string, negocioId: string): Promise<void> {
  const svc = createServiceClient()

  const { data: neg } = await db(svc)
    .from('negocios').select('linea_id').eq('id', negocioId).maybeSingle()
  if (!neg?.linea_id) return

  const { data: linea } = await db(svc)
    .from('lineas_negocio').select('config_extra').eq('id', neg.linea_id).maybeSingle()

  const cfgSiigo = ((linea?.config_extra ?? {}) as Record<string, unknown>).siigo as
    { recibo_automatico?: boolean; bloque_recibo_slug?: string; recibo_concepto?: string } | undefined

  // El interruptor. Arranca apagado a propósito: emitir consume numeración en la
  // contabilidad del cliente y no se deshace, así que la primera emisión automática
  // la autoriza una persona, igual que se hizo con la factura.
  if (cfgSiigo?.recibo_automatico !== true) return

  const porConcepto = leerReciboPorConcepto(cfgSiigo)

  // Una línea que parte sus recibos emite aquí SOLO la tarifa: el honorario ya salió como
  // abono (o espera la factura), y como anticipo no sale nunca más.
  //
  // Una línea sin `recibo_por_concepto` conserva el recibo por el total de siempre. Hoy no
  // la tiene ningún workspace con Siigo, y la vía manual ya no la emite (ver
  // `emitirReciboDeNegocio`).
  if (!porConcepto) {
    const { data: cobro } = await db(svc)
      .from('cobros').select('siigo_recibo').eq('id', cobroId).eq('workspace_id', workspaceId).maybeSingle()
    // ⚠️ `tieneRecibo`, no la verdad del valor: la marca puede ser una LISTA, y una lista
    // vacía es `truthy`.
    if (tieneRecibo(cobro?.siigo_recibo)) return
  }

  const r = await emitirReciboDeCobro(workspaceId, cobroId, null, {
    bloqueReciboSlug: cfgSiigo.bloque_recibo_slug,
    concepto: cfgSiigo.recibo_concepto,
    porConcepto,
    ...(porConcepto ? { soloComponentes: ['pasante'] as const } : {}),
    avisarAlCliente: true,
  })

  // `ya_emitido` y `duplicado_en_siigo` no son fallos aquí: son la idempotencia
  // haciendo su trabajo cuando el mismo cobro se toca dos veces.
  const noEsFallo = ['ya_emitido', 'duplicado_en_siigo']
  if (!r.ok && !noEsFallo.includes(r.motivo)) {
    console.error('[recibo-automatico] no se emitió el RC-3 del cobro', cobroId, r.motivo)
  }
}
