/**
 * Lee de la base lo que `planRc3DelNegocio` necesita para UN negocio.
 *
 * Es la única puerta por la que la emisión sabe cuánto acusa el RC-3: la usan la acción de
 * Tesorería (`emitirReciboDeNegocio`) y `emitirReciboDeCobro` (que también la recorre el
 * recibo automático). El panel de Tesorería arma la misma entrada en lote y llama a la
 * misma función pura, así que la cifra de la pantalla y la del recibo son la misma cuenta.
 *
 * Server-only: recibe el cliente de servicio de quien llama.
 */

import {
  leerComprobanteUpme,
  motivoSinRc3,
  planRc3DelNegocio,
  SLUG_COMPROBANTE_UPME,
  type PagoParaRc3,
  type PlanRc3,
} from './rc3-negocio'
import { repartoDeCobro, type FilaReparto } from './recibo-componentes'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(client: unknown): any {
  return client
}

/**
 * El plan del RC-3 del negocio. Lanza si una lectura falla: decidir el valor de un
 * documento contable con una lectura a medias es peor que no emitir.
 */
export async function cargarPlanRc3(
  svc: unknown,
  workspaceId: string,
  negocioId: string,
): Promise<PlanRc3> {
  const [cobrosRes, repartoRes, techoRes, bloquesRes] = await Promise.all([
    db(svc)
      .from('cobros')
      .select('id, fecha, monto, tipo_cobro, siigo_recibo, anulado_at, recibo_no_aplica')
      .eq('workspace_id', workspaceId)
      .eq('negocio_id', negocioId),
    db(svc)
      .from('v_cobro_valor')
      .select('cobro_id, a_tramo1, a_tramo2, a_tarifa, excedente')
      .eq('negocio_id', negocioId),
    db(svc)
      .from('v_negocio_valor')
      .select('techo_tarifa')
      .eq('negocio_id', negocioId)
      .maybeSingle(),
    db(svc)
      .from('negocio_bloques')
      .select('data, bloque_configs!inner(slug)')
      .eq('negocio_id', negocioId)
      .eq('bloque_configs.slug', SLUG_COMPROBANTE_UPME),
  ])

  for (const [nombre, r] of [
    ['cobros', cobrosRes], ['v_cobro_valor', repartoRes], ['v_negocio_valor', techoRes], ['negocio_bloques', bloquesRes],
  ] as const) {
    if (r?.error) throw new Error(`No se pudo leer ${nombre} para el recibo de la tarifa UPME: ${r.error.message}`)
  }

  type FilaCobro = {
    id: string
    fecha: string | null
    monto: number | null
    tipo_cobro: string | null
    siigo_recibo: unknown
    anulado_at: string | null
    recibo_no_aplica: unknown
  }
  const repartoPorCobro = new Map<string, FilaReparto>(
    ((repartoRes.data ?? []) as Array<FilaReparto & { cobro_id: string }>).map(f => [f.cobro_id, f]),
  )

  const pagos: PagoParaRc3[] = ((cobrosRes.data ?? []) as FilaCobro[])
    .filter(c => !c.anulado_at && c.fecha != null)
    .map(c => ({
      id: c.id,
      fecha: c.fecha,
      aTarifa: repartoDeCobro(repartoPorCobro.get(c.id) ?? null, {
        monto: Number(c.monto ?? 0),
        tipo_cobro: c.tipo_cobro,
      })?.pasante ?? 0,
      marca: c.siigo_recibo,
      noAplica: c.recibo_no_aplica != null,
    }))

  const techo = (techoRes.data as { techo_tarifa?: number | string | null } | null)?.techo_tarifa
  return planRc3DelNegocio({
    comprobante: leerComprobanteUpme(((bloquesRes.data ?? []) as Array<{ data: unknown }>).map(b => b.data)),
    techoTarifa: techo == null ? null : Number(techo),
    pagos,
  })
}

/**
 * Lo que acusa el RC-3 si sale en ESTE pago, o por qué no sale. Es lo que consume la
 * emisión (`emitirReciboDeCobro`).
 */
export async function valorRc3DelCobro(
  svc: unknown,
  workspaceId: string,
  negocioId: string,
  cobroId: string,
): Promise<{ ok: true; valor: number } | { ok: false; mensaje: string; bloqueo: boolean }> {
  let plan: PlanRc3
  try {
    plan = await cargarPlanRc3(svc, workspaceId, negocioId)
  } catch (e) {
    return { ok: false, mensaje: (e as Error).message, bloqueo: true }
  }
  const motivo = motivoSinRc3(plan, cobroId)
  if (motivo) return { ok: false, ...motivo }
  return { ok: true, valor: plan.valor! }
}
