// ============================================================
// Al emitir la factura, se abonan los pagos que llegaron ANTES.
//
// Regla 2 del brief del 2026-09-22: el abono se dispara con lo que ocurra de último.
//
//   - Entra un pago y el negocio YA tiene factura → el abono sale con el pago
//     (`emitirReciboDeCobro`, desde el recibo automático o desde Tesorería).
//   - Se emite la factura y el negocio YA tenía pagos → sale AQUÍ: un abono por cada
//     cobro con porción honorario que todavía no tenga ni abono ni anticipo.
//
// Sin esta mitad, la factura que ahora sale sin esperar el recaudo nacería con saldo
// completo aunque el cliente ya hubiera pagado todo, y quedaría abierta en Siigo hasta
// que alguien la cruzara a mano, que es justo lo que ONE viene a quitarle a Tesorería.
//
// ── Qué NO hace ─────────────────────────────────────────────────────────────
//
//   - No toca la tarifa: sus recibos (el RC-3) salen con el pago, no con la factura.
//   - No emite abono sobre un cobro que ya tiene el anticipo del honorario (RC-1
//     `AdvancePayment`), ni sobre una marca vieja por el total. Esos los cruza o los
//     anula Tesorería a mano (regla 3): dos documentos por la misma plata no se deshacen.
//   - No le avisa al cliente. El «recibimos tu pago» de esos pagos ya salió (o no salió
//     porque solo traían honorario y no había factura, regla 8); mandarlo semanas
//     después, junto con la factura, se leería como un cobro nuevo.
//   - No revisa los pagos marcados `recibo_no_aplica` (el corte histórico del
//     2026-09-07): no llevan recibo retroactivo, y un abono lo es.
//
// ⚠️ NUNCA lanza. La factura ya existe en Siigo y es irreversible: nada de lo que pase
// aquí puede convertir su emisión en un fallo. Lo que no salga queda pendiente en el
// control de recibos de Tesorería, que lo reintenta cobro por cobro.
//
// Server-only.
// ============================================================

import { createServiceClient } from '@/lib/supabase/server'
import { emitirReciboDeCobro, type AbonoAMano } from './recibos'
import {
  componentesEmitidos,
  hayReciboPorElTotal,
  leerReciboPorConcepto,
} from './recibo-componentes'

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

/**
 * Abona a la factura recién emitida el honorario de cada pago anterior del negocio.
 *
 * Solo actúa si la línea declara el honorario como abono
 * (`config_extra.siigo.recibo_por_concepto.honorario.tipo = 'abono'`): una línea que no
 * lo declara no cambia en nada.
 */
export async function abonarPagosPreviosALaFactura(
  workspaceId: string,
  negocioId: string,
  staffNombre: string | null,
): Promise<ResultadoAbonosFactura> {
  try {
    const svc = createServiceClient()

    const { data: neg } = await db(svc)
      .from('negocios').select('linea_id').eq('id', negocioId).eq('workspace_id', workspaceId).maybeSingle()
    if (!neg?.linea_id) return VACIO

    const { data: linea } = await db(svc)
      .from('lineas_negocio').select('config_extra').eq('id', neg.linea_id).maybeSingle()
    const cfgSiigo = ((linea?.config_extra ?? {}) as Record<string, unknown>).siigo as
      { bloque_recibo_slug?: string } | undefined
    const porConcepto = leerReciboPorConcepto(cfgSiigo)
    if (porConcepto?.honorario?.tipo !== 'abono') return VACIO

    // El más viejo primero: el saldo de la factura se va consumiendo en el orden en que
    // entró la plata, que es el orden en que Tesorería lo cruzaría a mano.
    const { data: filas, error } = await db(svc)
      .from('cobros')
      .select('id, fecha, siigo_recibo, recibo_no_aplica')
      .eq('workspace_id', workspaceId)
      .eq('negocio_id', negocioId)
      .is('anulado_at', null)
      .not('fecha', 'is', null)
      .order('fecha', { ascending: true })
    if (error) {
      console.error('[abonos-factura] no se pudieron leer los pagos del negocio:', error.message)
      return VACIO
    }

    const resultado: ResultadoAbonosFactura = { emitidos: [], a_mano: [], fallidos: [] }
    for (const c of (filas ?? []) as Array<{
      id: string; siigo_recibo: unknown; recibo_no_aplica: unknown
    }>) {
      if (c.recibo_no_aplica) continue
      // Lo que ya está acusado no se vuelve a mirar. `emitirReciboDeCobro` lo filtraría
      // igual, pero saltarlo aquí ahorra una ida a Siigo por cobro.
      if (hayReciboPorElTotal(c.siigo_recibo) || componentesEmitidos(c.siigo_recibo).has('honorario')) continue

      const r = await emitirReciboDeCobro(workspaceId, c.id, staffNombre, {
        bloqueReciboSlug: cfgSiigo?.bloque_recibo_slug,
        porConcepto,
        soloComponentes: ['honorario'],
        avisarAlCliente: false,
      })

      if (r.ok) {
        for (const rec of r.recibos) resultado.emitidos.push({ cobro_id: c.id, numero: rec.numero, valor: rec.valor })
        for (const m of r.a_mano ?? []) resultado.a_mano.push({ cobro_id: c.id, ...m })
        continue
      }
      // `ya_emitido`: el cobro no tiene porción honorario, o ya la acusó. No es trabajo.
      if (r.motivo === 'ya_emitido') continue
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
    console.error('[abonos-factura] falló el abono de los pagos anteriores:', (e as Error).message)
    return VACIO
  }
}
