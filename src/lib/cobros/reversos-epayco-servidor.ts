import type { SupabaseClient } from '@supabase/supabase-js'
import { todayBogotaISO } from '@/lib/dates/bogota'
import type { PasarelaAdapter } from '@/lib/suscripciones/pasarela/adapter'
import { epaycoHabilitado } from '@/lib/suscripciones/pasarela/epayco'
import { adapterPara } from '@/lib/suscripciones/pasarela/registro'
import { procesarEventoPasarela, type RepoPagoEnLinea } from './pago-en-linea'
import { repoPagoEnLinea } from './pago-en-linea-servidor'
import { referenciaEnlaceCobro } from './referencia-enlace'

/**
 * Conciliación de REVERSOS de ePayco (paso 7d del cron `procesar-planes-cobro`).
 *
 * ePayco reversó la 390720992 desde su panel el 2026-10-22. Sí mandó la confirmación del reverso
 * (`pasarela_eventos` 390720992-6, 16:45:13Z; antes se creyó que no), pero nada en la documentación
 * garantiza que siempre llegue (el reverso que pide la red de procesamiento puede tardar días, y una
 * confirmación caída no se reintenta para siempre). Esto es la red: se le PREGUNTA a ePayco (`adapter.consultar`, `POST /payment/transaction`)
 * por los cobros que ONE registró como pagados con ePayco en los últimos `DIAS_VENTANA_REVERSOS` días, y
 * el que ePayco reporte como reversado (estado 6) entra por el MISMO camino de la confirmación
 * (`procesarEventoPasarela`, evento `anulado`) con el MISMO id de evento (`<ref_payco>-6`): si la
 * confirmación del reverso llega antes o después, es un duplicado y nada se hace dos veces.
 *
 * Lo que hace un reverso: anular el cobro y avisar a MéTRIK (`reverso-pasarela-servidor.ts`). Lo que
 * NO hace: tocar la suscripción, el ciclo de consultas o la factura.
 *
 * Ventana: la documentación de ePayco no pone límite a la consulta; reversar desde el panel solo se
 * puede el mismo día hasta las 9 p. m., y después lo pide la red de procesamiento, que puede tardar.
 * 60 días cubre eso. Un cobro anulado sale de la lista: no se vuelve a consultar.
 *
 * Con ePayco apagado (`EPAYCO_HABILITADO`) no consulta nada, igual que el cobro con tarjeta (7b).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

export const DIAS_VENTANA_REVERSOS = 60
/** Consultas por corrida (cada una es login + consulta). Los más recientes primero. */
export const TOPE_CONSULTAS_REVERSOS = 80

export interface ResumenReversos {
  /** `true` = ePayco apagado: no se consultó nada. */
  apagado: boolean
  revisados: number
  reversados: { cobroId: string; referencia: string; resultado: string }[]
  errores: { cobroId: string; error: string }[]
}

export interface DepsReversos {
  db: SupabaseClient
  /** 'YYYY-MM-DD' Bogotá. */
  hoy: string
  adapterPara?: (p: string) => PasarelaAdapter | null
  /** El repositorio del pago en línea. Por defecto el de Supabase (`repoPagoEnLinea`). */
  repo?: (db: SupabaseClient, adapter: PasarelaAdapter) => RepoPagoEnLinea
  ahoraMs?: number
  dias?: number
  tope?: number
}

function adapterPorDefecto(p: string): PasarelaAdapter | null {
  return p === 'epayco' && epaycoHabilitado() ? adapterPara(p) : null
}

function restarDias(ymd: string, dias: number): string {
  return new Date(Date.parse(`${ymd}T12:00:00Z`) - dias * 86_400_000).toISOString().slice(0, 10)
}

export async function detectarReversosEpayco(deps: DepsReversos): Promise<ResumenReversos> {
  const resumen: ResumenReversos = { apagado: false, revisados: 0, reversados: [], errores: [] }
  const adapter = (deps.adapterPara ?? adapterPorDefecto)('epayco')
  if (!adapter) return { ...resumen, apagado: true }
  const db = deps.db as Db
  const ahoraMs = deps.ahoraMs ?? Date.now()
  const desde = restarDias(deps.hoy, deps.dias ?? DIAS_VENTANA_REVERSOS)

  const q = await db
    .from('cobros')
    .select('id, external_ref, fecha')
    .eq('tipo_cobro', 'programado')
    .eq('fuente', 'epayco')
    .not('fecha', 'is', null)
    .is('anulado_at', null)
    .gte('fecha', desde)
    .order('fecha', { ascending: false })
    .limit(deps.tope ?? TOPE_CONSULTAS_REVERSOS)
  if (q.error) throw new Error(`cobros pagados con ePayco: ${q.error.message}`)
  // Solo las transacciones de ePayco (`epayco-<ref_payco>`): un link sin pago o una referencia ajena no se consulta.
  const cobros = ((q.data ?? []) as { id: string; external_ref: string | null }[]).filter((c) => /^epayco-\d+$/.test(c.external_ref ?? ''))

  const repo = deps.repo ? deps.repo(deps.db, adapter) : repoPagoEnLinea(deps.db, 'epayco', adapter)
  for (const c of cobros) {
    const externalRef = c.external_ref as string
    resumen.revisados += 1
    try {
      const r = await adapter.consultar(externalRef)
      if (r.estado === 'error') {
        resumen.errores.push({ cobroId: c.id, error: r.mensaje })
        continue
      }
      if (r.estado !== 'reversado') continue
      const refPayco = externalRef.replace(/^epayco-/, '')
      const codigo = /^\d+$/.test(r.codigo) ? r.codigo : '6'
      const salida = await procesarEventoPasarela(
        {
          tipo: 'anulado',
          // El mismo id que la confirmación del reverso, si llegara.
          eventoId: `${refPayco}-${codigo}`,
          tipoOriginal: `${codigo} ${r.mensaje} (consulta)`.slice(0, 120),
          transaccionId: refPayco,
          referenciaPago: externalRef,
          referencia: referenciaEnlaceCobro(c.id, ahoraMs),
          idEnlace: null,
          monto: null,
          moneda: 'COP',
          ocurridoAt: null,
          crudo: { origen: 'conciliacion_reversos', cobroId: c.id },
        },
        repo,
        todayBogotaISO(new Date(ahoraMs)),
      )
      resumen.reversados.push({ cobroId: c.id, referencia: externalRef, resultado: salida.resultado })
      if (salida.resultado === 'requiere_revision') console.warn(`[reversos-epayco] revisar: ${salida.detalle}`)
    } catch (e) {
      resumen.errores.push({ cobroId: c.id, error: e instanceof Error ? e.message : String(e) })
    }
  }
  return resumen
}
