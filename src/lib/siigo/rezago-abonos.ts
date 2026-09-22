// ============================================================
// El rezago: pagos de negocios YA facturados cuyo honorario nunca se abonó.
//
// Regla 6 del brief del 2026-09-22 («Tesorería solo emite recibos de la tarifa UPME»).
// Desde este PR el abono sale solo cuando entra un pago o cuando se factura; los pagos que
// entraron ANTES, en negocios que ya tenían factura, no tienen ningún disparo que los
// alcance. Medido el 2026-09-22 en SOENA: 34 cobros, $17.204.707 de honorario.
//
// ⚠️ Esto EMITE DOCUMENTOS CONTABLES en el Siigo real del cliente y no se deshace desde
// ONE. Por eso:
//
//   - no es una server action (una acción exportada es un endpoint que cualquiera con el
//     rol podría llamar, y sería una vía «manual» de RC-1 que la regla 1 prohíbe): lo corre
//     `scripts/abonar-rezago.ts`, a mano, con autorización de Mauricio;
//   - SIMULA por defecto: sin `aplicar` solo lee la base, no le habla a Siigo, y devuelve
//     la lista exacta de lo que abonaría;
//   - es IDEMPOTENTE: qué cobro se abona lo decide `porQueNoSeAbona`, el mismo criterio del
//     abono automático, y un cobro abonado queda con su marca. Una segunda corrida no
//     encuentra nada. Si la marca se perdiera, la clave de idempotencia (`<cobro>abhon`)
//     hace que Siigo devuelva el abono que ya existe en vez de crear otro.
//
// Cada negocio pasa por `abonarPagosDelNegocio`, la misma rutina del abono automático: el
// saldo de la factura se consume del pago más viejo al más nuevo y lo que no cabe queda
// dicho (excedente, factura saldada, retención…) para Tesorería.
//
// Server-only.
// ============================================================

import { createServiceClient } from '@/lib/supabase/server'
import { traerTodo } from '@/lib/supabase/paginar'
import { leerReciboPorConcepto } from './recibo-componentes'
import { porQueNoSeAbona } from './abono-pendiente'
import { abonarPagosDelNegocio, type ResultadoAbonosFactura } from './abonos-factura'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(client: unknown): any {
  return client
}

const num = (v: unknown): number => {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

export interface CandidatoRezago {
  cobro_id: string
  negocio_id: string
  negocio_codigo: string | null
  fecha: string | null
  /** Honorario del pago según `v_cobro_valor`. El abono llega hasta el saldo de la factura. */
  honorario: number
  factura: string
  /** Con retención el abono no sale: queda «a mano» para Tesorería (se sabe antes de correr). */
  retencion: number
}

export interface ResultadoRezago extends ResultadoAbonosFactura {
  candidatos: CandidatoRezago[]
  /** Suma de los honorarios candidatos. */
  valor: number
  /** Negocios con al menos un candidato. */
  negocios: number
  aplicado: boolean
}

/**
 * Busca el rezago y, con `aplicar`, lo abona.
 *
 * @param opciones.aplicar      sin esto, NO se emite nada ni se consulta Siigo.
 * @param opciones.staffNombre  quién corre el lote, para la marca de cada abono.
 * @param opciones.soloNegocios acota el lote (para una prueba sobre un caso conocido).
 */
export async function abonarRezago(
  workspaceId: string,
  opciones: { aplicar: boolean; staffNombre?: string | null; soloNegocios?: string[] },
): Promise<ResultadoRezago> {
  const svc = createServiceClient()

  // ── Las líneas que abonan el honorario ──
  const lineas = await traerTodo<{ id: string; config_extra: Record<string, unknown> | null }>(
    (d, h) => db(svc).from('lineas_negocio').select('id, config_extra')
      .eq('workspace_id', workspaceId).order('id').range(d, h),
    { etiqueta: 'rezago/lineas' },
  )
  const lineasConAbono = new Set(
    lineas
      .filter(l => leerReciboPorConcepto((l.config_extra ?? {}).siigo)?.honorario?.tipo === 'abono')
      .map(l => l.id),
  )

  // ── Los negocios facturados CON vínculo a Siigo ──
  // Sin vínculo no hay a qué cruzar: esos no son rezago, son un «a mano» (factura sin
  // vínculo) que se resuelve adoptando la factura.
  const negocios = await traerTodo<{
    id: string; codigo: string | null; linea_id: string | null; metadata: Record<string, unknown> | null
  }>(
    (d, h) => db(svc).from('negocios').select('id, codigo, linea_id, metadata')
      .eq('workspace_id', workspaceId).order('id').range(d, h),
    { etiqueta: 'rezago/negocios' },
  )
  const facturados = new Map<string, { codigo: string | null; factura: string }>()
  for (const n of negocios) {
    if (!n.linea_id || !lineasConAbono.has(n.linea_id)) continue
    if (opciones.soloNegocios && !opciones.soloNegocios.includes(n.id)) continue
    const f = (n.metadata ?? {}).siigo_factura as { numero?: string; siigo_id?: string } | undefined
    if (f?.numero && f?.siigo_id) facturados.set(n.id, { codigo: n.codigo, factura: f.numero })
  }

  const vacio: ResultadoRezago = {
    candidatos: [], valor: 0, negocios: 0, aplicado: opciones.aplicar, emitidos: [], a_mano: [], fallidos: [],
  }
  if (facturados.size === 0) return vacio

  // ── Sus cobros, su reparto y su conciliación ──
  type FilaCobro = {
    id: string; negocio_id: string; fecha: string | null; siigo_recibo: unknown
    recibo_no_aplica: unknown; retencion: unknown
    split_json?: { origen?: string; confirmado_at?: string | null } | null
  }
  const ids = [...facturados.keys()]
  const cobros: FilaCobro[] = []
  // Por lotes: la lista de ids viaja en la URL de PostgREST.
  for (let i = 0; i < ids.length; i += 150) {
    const lote = ids.slice(i, i + 150)
    cobros.push(...await traerTodo<FilaCobro>(
      (d, h) => db(svc).from('cobros')
        .select('id, negocio_id, fecha, siigo_recibo, recibo_no_aplica, retencion, split_json')
        .eq('workspace_id', workspaceId)
        .in('negocio_id', lote)
        .is('anulado_at', null)
        .not('fecha', 'is', null)
        .order('id').range(d, h),
      { etiqueta: 'rezago/cobros' },
    ))
  }

  const reparto = await traerTodo<{ cobro_id: string; a_tramo1: unknown; a_tramo2: unknown; excedente: unknown }>(
    (d, h) => db(svc).from('v_cobro_valor').select('cobro_id, a_tramo1, a_tramo2, excedente')
      .eq('workspace_id', workspaceId).order('cobro_id').range(d, h),
    { etiqueta: 'rezago/reparto' },
  )
  const honorarioPorCobro = new Map(reparto.map(f => [f.cobro_id, num(f.a_tramo1) + num(f.a_tramo2) + num(f.excedente)]))

  const conciliacion = await traerTodo<{ negocio_id: string; conciliado: boolean | null }>(
    (d, h) => db(svc).from('negocio_conciliacion').select('negocio_id, conciliado')
      .eq('workspace_id', workspaceId).order('negocio_id').range(d, h),
    { etiqueta: 'rezago/conciliacion' },
  )
  const conciliado = new Set(conciliacion.filter(c => c.conciliado === true).map(c => c.negocio_id))

  // ── El mismo criterio del abono automático ──
  const candidatos: CandidatoRezago[] = []
  for (const c of cobros) {
    const neg = facturados.get(c.negocio_id)
    if (!neg) continue
    const honorario = honorarioPorCobro.has(c.id) ? honorarioPorCobro.get(c.id)! : null
    const razon = porQueNoSeAbona(c, {
      honorario,
      negocioConciliado: conciliado.has(c.negocio_id),
      facturaVinculada: true,
    })
    if (razon) continue
    candidatos.push({
      cobro_id: c.id,
      negocio_id: c.negocio_id,
      negocio_codigo: neg.codigo,
      fecha: c.fecha,
      honorario: honorario ?? 0,
      factura: neg.factura,
      retencion: num(c.retencion),
    })
  }
  candidatos.sort((a, b) =>
    (a.negocio_codigo ?? '').localeCompare(b.negocio_codigo ?? '') || (a.fecha ?? '').localeCompare(b.fecha ?? ''))

  const negociosConCandidatos = [...new Set(candidatos.map(c => c.negocio_id))]
  const resultado: ResultadoRezago = {
    ...vacio,
    candidatos,
    valor: candidatos.reduce((s, c) => s + c.honorario, 0),
    negocios: negociosConCandidatos.length,
  }
  if (!opciones.aplicar) return resultado

  // ── Aplicar: negocio por negocio, en serie ──
  // En serie a propósito: Siigo pide ~19 s cuando se pasa el límite de peticiones, y la
  // emisión ya sabe esperarlo. En paralelo se llegaría al límite en el primer segundo.
  for (const negocioId of negociosConCandidatos) {
    const r = await abonarPagosDelNegocio(workspaceId, negocioId, opciones.staffNombre ?? null)
    resultado.emitidos.push(...r.emitidos)
    resultado.a_mano.push(...r.a_mano)
    resultado.fallidos.push(...r.fallidos)
  }
  return resultado
}
