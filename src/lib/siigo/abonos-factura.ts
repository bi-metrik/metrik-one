// ============================================================
// El honorario de los pagos de un negocio se ABONA a su factura.
//
// Brief del 2026-09-22 («Tesorería solo emite recibos de la tarifa UPME»): el abono a la
// factura (RC-1 `DebtPayment`) es 100 % automático, no tiene botón y no aparece como
// recibo en el panel. Sale por aquí en los tres momentos en que puede faltar:
//
//   - Se emite la factura y el negocio YA tenía pagos → `facturas.ts` (#818).
//   - Entra un pago y el negocio YA tiene factura → `abonarAlRegistrarPago`
//     (`recibo-automatico.ts`), desde cada camino que registra plata. **No depende de
//     `recibo_automatico`**, que desde este brief gobierna solo al RC-3.
//   - Pagos que quedaron sin abono (el rezago) → `rezago-abonos.ts`, en lote.
//
// Es la MISMA rutina en los tres, y recorre el NEGOCIO, no un cobro suelto: así un abono
// que falló la vez pasada (Siigo caído, un 429) se vuelve a intentar con el siguiente pago
// del mismo caso, sin que nadie tenga que acordarse. Qué cobro se abona lo decide
// `porQueNoSeAbona` (`abono-pendiente.ts`), que también usa el lote.
//
// ── Qué NO hace ─────────────────────────────────────────────────────────────
//
//   - No toca la tarifa: sus recibos (el RC-3) no son asunto de la factura.
//   - No emite abono sobre un cobro que ya tiene el anticipo del honorario (RC-1
//     `AdvancePayment`), ni sobre una marca vieja por el total. Esos los cruza o los
//     anula Tesorería a mano: dos documentos por la misma plata no se deshacen.
//   - No abona una porción que el comercial propuso y la financiera no ha aceptado.
//   - No reintenta lo que ya quedó «a mano» con su razón (salvo la factura sin vínculo,
//     que sí se resuelve adoptándola).
//   - No genera PDF ni le avisa al cliente (regla 5 del brief): es un asiento interno
//     para cerrar la cuenta por cobrar. El «recibimos tu pago» sale solo con el RC-3.
//   - No revisa los pagos marcados `recibo_no_aplica` (el corte histórico del
//     2026-09-07): no llevan recibo retroactivo, y un abono lo es.
//
// ⚠️ NUNCA lanza. Quien la llama acaba de hacer algo que la persona pidió (emitir la
// factura, registrar el pago) y ya quedó hecho: nada de lo que pase aquí puede
// convertirlo en un fallo. Lo que no salga queda sin marca y lo recoge el siguiente pago
// del negocio o el lote del rezago.
//
// Server-only.
// ============================================================

import { createServiceClient } from '@/lib/supabase/server'
import { emitirReciboDeCobro, type AbonoAMano } from './recibos'
import { leerReciboPorConcepto } from './recibo-componentes'
import { porQueNoSeAbona } from './abono-pendiente'
import { leerFacturaDeUnNegocio } from '@/lib/facturacion/leer-factura-del-negocio'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(client: unknown): any {
  return client
}

export interface ResultadoAbonosFactura {
  /** Abonos que salieron, en orden de fecha del pago. */
  emitidos: Array<{ cobro_id: string; numero: string; valor: number }>
  /** Cobros cuyo abono quedó para Tesorería, con la razón. */
  a_mano: Array<{ cobro_id: string } & AbonoAMano>
  /** Cobros en los que la emisión falló o quedó retenida (duplicado, error). */
  fallidos: Array<{ cobro_id: string; motivo: string }>
}

const VACIO: ResultadoAbonosFactura = { emitidos: [], a_mano: [], fallidos: [] }

const num = (v: unknown): number => {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

/**
 * Abona a la factura del negocio el honorario de cada pago que todavía no lo tenga.
 *
 * Solo actúa si la línea declara el honorario como abono
 * (`config_extra.siigo.recibo_por_concepto.honorario.tipo = 'abono'`): una línea que no
 * lo declara no cambia en nada.
 */
export async function abonarPagosDelNegocio(
  workspaceId: string,
  negocioId: string,
  staffNombre: string | null,
): Promise<ResultadoAbonosFactura> {
  try {
    const svc = createServiceClient()

    const { data: neg } = await db(svc)
      .from('negocios').select('linea_id, metadata').eq('id', negocioId).eq('workspace_id', workspaceId).maybeSingle()
    if (!neg?.linea_id) return VACIO

    const { data: linea } = await db(svc)
      .from('lineas_negocio').select('config_extra').eq('id', neg.linea_id).maybeSingle()
    const cfgSiigo = ((linea?.config_extra ?? {}) as Record<string, unknown>).siigo as
      { bloque_recibo_slug?: string } | undefined
    const porConcepto = leerReciboPorConcepto(cfgSiigo)
    if (porConcepto?.honorario?.tipo !== 'abono') return VACIO

    // ── ¿Hay factura a la cual abonar? ──
    // Sin factura no hay nada que hacer: el abono sale el día que se facture. Se decide UNA
    // vez aquí, y no cobro por cobro, porque este camino corre con CADA pago que entra y la
    // mayoría de los negocios todavía no tiene factura: preguntarlo por cobro costaría
    // cuatro lecturas por pago sin emitir nada. La factura CARGADA sin vínculo sí sigue: no
    // se puede abonar, pero el pendiente tiene que quedar dicho para Tesorería.
    const marcaFactura = ((neg.metadata ?? {}) as Record<string, unknown>).siigo_factura as
      { numero?: string; siigo_id?: string } | undefined
    const facturaVinculada = !!(marcaFactura?.numero && marcaFactura?.siigo_id)
    if (!facturaVinculada && !marcaFactura?.numero) {
      let cargada = false
      try {
        cargada = !!(await leerFacturaDeUnNegocio(svc, workspaceId, negocioId))?.resolucion.factura?.numero
      } catch (e) {
        // Sin poder leer el bloque se trata como "sin factura": un abono que no sale se
        // reintenta con el siguiente pago; uno cruzado a ciegas no se deshace.
        console.error('[abonos-factura] no se pudo leer la factura cargada del negocio:', (e as Error).message)
      }
      if (!cargada) return VACIO
    }

    // El más viejo primero: el saldo de la factura se va consumiendo en el orden en que
    // entró la plata, que es el orden en que Tesorería lo cruzaría a mano.
    const { data: filas, error } = await db(svc)
      .from('cobros')
      .select('id, fecha, siigo_recibo, recibo_no_aplica, split_json')
      .eq('workspace_id', workspaceId)
      .eq('negocio_id', negocioId)
      .is('anulado_at', null)
      .not('fecha', 'is', null)
      .order('fecha', { ascending: true })
    if (error) {
      console.error('[abonos-factura] no se pudieron leer los pagos del negocio:', error.message)
      return VACIO
    }
    const cobros = (filas ?? []) as Array<{
      id: string; siigo_recibo: unknown; recibo_no_aplica: unknown
      split_json?: { origen?: string; confirmado_at?: string | null } | null
    }>
    if (cobros.length === 0) return VACIO

    // El honorario de cada cobro sale del reparto canónico. Una sola lectura para todos:
    // un cobro de pura tarifa no pide abono, y descartarlo aquí ahorra su ida a la emisión.
    const { data: reparto } = await db(svc)
      .from('v_cobro_valor')
      .select('cobro_id, a_tramo1, a_tramo2, excedente')
      .in('cobro_id', cobros.map(c => c.id))
    const honorarioPorCobro = new Map<string, number>(
      ((reparto ?? []) as Array<Record<string, unknown>>).map(f => [
        String(f.cobro_id), num(f.a_tramo1) + num(f.a_tramo2) + num(f.excedente),
      ]),
    )

    const { data: conc } = await db(svc)
      .from('negocio_conciliacion')
      .select('conciliado')
      .eq('workspace_id', workspaceId)
      .eq('negocio_id', negocioId)
      .maybeSingle()
    const negocioConciliado = (conc as { conciliado?: boolean } | null)?.conciliado === true

    const resultado: ResultadoAbonosFactura = { emitidos: [], a_mano: [], fallidos: [] }
    for (const c of cobros) {
      const razon = porQueNoSeAbona(c, {
        honorario: honorarioPorCobro.has(c.id) ? honorarioPorCobro.get(c.id)! : null,
        negocioConciliado,
        facturaVinculada,
      })
      if (razon) continue

      const r = await emitirReciboDeCobro(workspaceId, c.id, staffNombre, {
        bloqueReciboSlug: cfgSiigo?.bloque_recibo_slug,
        porConcepto,
        soloComponentes: ['honorario'],
        // Regla 5: el abono no le avisa a nadie. Tampoco genera PDF (lo decide la
        // emisión: ningún abono se renderiza).
        avisarAlCliente: false,
      })

      if (r.ok) {
        for (const rec of r.recibos) resultado.emitidos.push({ cobro_id: c.id, numero: rec.numero, valor: rec.valor })
        for (const m of r.a_mano ?? []) resultado.a_mano.push({ cobro_id: c.id, ...m })
        continue
      }
      // `ya_emitido`: el cobro no tiene porción honorario, o ya la acusó. `espera_factura`:
      // el negocio no tiene factura. Ninguno es trabajo.
      if (r.motivo === 'ya_emitido' || r.motivo === 'espera_factura') continue
      if (r.motivo === 'abono_a_mano') {
        for (const m of r.a_mano) resultado.a_mano.push({ cobro_id: c.id, ...m })
        continue
      }
      resultado.fallidos.push({
        cobro_id: c.id,
        motivo: r.motivo === 'error' ? r.mensaje
          : r.motivo === 'faltan_datos' ? `faltan datos: ${r.faltantes.join(', ')}`
          : r.motivo,
      })
    }
    return resultado
  } catch (e) {
    console.error('[abonos-factura] falló el abono de los pagos del negocio:', (e as Error).message)
    return VACIO
  }
}
