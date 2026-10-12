import 'server-only'

/**
 * La regla del viaje contra la base (F5): qué negocios de una línea con `facturacion.por_titular`
 * entran hoy a la cola. La lee la cola (`armarColaFacturacion`), la emisión y la píldora de la
 * cabecera, con la misma función pura (`entraALaColaViaje`).
 *
 * Se llama con el cliente de servicio, acotado al workspace de quien pregunta.
 */

import { cobradoConfirmado } from '@/lib/cobros/saldo-negocio'
import {
  configFacturacionLinea,
  confirmacionRegistrada,
  entraALaColaViaje,
  paqueteEnviado,
  type EstadoViajeParaFactura,
  type MotivoEntrada,
} from './regla-viaje'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

export interface NegocioParaColaViaje {
  id: string
  precio_aprobado: number | null
  metadata: Record<string, unknown> | null
}

/** Las líneas del workspace que facturan por evento (y no están apagadas). */
export function lineasPorTitular(lineas: ReadonlyArray<{ id: string; config_extra?: unknown }>): Set<string> {
  return new Set(
    lineas
      .filter(l => {
        const c = configFacturacionLinea(l.config_extra)
        return c.activo && c.porTitular
      })
      .map(l => l.id),
  )
}

/** El estado de cada negocio para la regla, leído de la base en dos consultas. */
export async function estadosViaje(
  svc: Db,
  workspaceId: string,
  negocios: readonly NegocioParaColaViaje[],
): Promise<Map<string, EstadoViajeParaFactura>> {
  const out = new Map<string, EstadoViajeParaFactura>()
  if (negocios.length === 0) return out
  const ids = negocios.map(n => n.id)
  const [cobrosRes, forzadasRes] = await Promise.all([
    svc.from('cobros').select('negocio_id, monto, fecha, retencion_iva, anulado_at').eq('workspace_id', workspaceId).in('negocio_id', ids),
    svc
      .from('aprobaciones_excepcion')
      .select('negocio_id')
      .eq('workspace_id', workspaceId)
      .eq('tipo', 'forzar_factura')
      .eq('estado', 'aprobada')
      .in('negocio_id', ids),
  ])
  // Si no se pudieron leer, se lanza: una cola recortada parece entera (regla de la cola).
  if (cobrosRes.error) throw new Error(`No se pudieron leer los pagos de los viajes: ${cobrosRes.error.message}`)
  if (forzadasRes.error) throw new Error(`No se pudieron leer las facturas forzadas: ${forzadasRes.error.message}`)
  const cobrosPor = new Map<string, Parameters<typeof cobradoConfirmado>[0][number][]>()
  for (const c of (cobrosRes.data ?? []) as Array<{ negocio_id: string } & Parameters<typeof cobradoConfirmado>[0][number]>) {
    const lista = cobrosPor.get(c.negocio_id) ?? []
    lista.push(c)
    cobrosPor.set(c.negocio_id, lista)
  }
  const forzadas = new Set(((forzadasRes.data ?? []) as Array<{ negocio_id: string }>).map(a => a.negocio_id))
  for (const n of negocios) {
    const precio = Number(n.precio_aprobado ?? 0) || 0
    out.set(n.id, {
      titular: ((n.metadata ?? {}).titular_facturacion ?? null) as { tipo_documento?: unknown } | null,
      confirmado: confirmacionRegistrada(n.metadata),
      paqueteEnviado: paqueteEnviado(n.metadata),
      saldo: precio - cobradoConfirmado(cobrosPor.get(n.id) ?? []),
      forzada: forzadas.has(n.id),
    })
  }
  return out
}

/** Los que entran hoy, con su motivo. */
export async function entradasViaje(
  svc: Db,
  workspaceId: string,
  negocios: readonly NegocioParaColaViaje[],
): Promise<Map<string, MotivoEntrada>> {
  const estados = await estadosViaje(svc, workspaceId, negocios)
  const out = new Map<string, MotivoEntrada>()
  for (const [id, e] of estados) {
    const r = entraALaColaViaje(e)
    if (r.entra && r.motivo) out.set(id, r.motivo)
  }
  return out
}

/**
 * La factura de viajes sale con dos conceptos (ingreso propio con IVA y recibido para terceros sin
 * IVA). Hasta que el espacio declare los dos productos de Siigo, el caso queda incompleto con este
 * motivo y NUNCA se emite con el producto de otro (adenda Siigo de la ola 4).
 */
export const FALTA_FACTURA_VIAJE = 'configurar en Siigo los productos de viaje (ingreso propio y recibido para terceros)'

export type ReglaDelNegocio =
  | { regla: 'etapa' }
  | { regla: 'apagada' }
  | { regla: 'viaje'; entra: boolean; motivo: MotivoEntrada | null; estado: EstadoViajeParaFactura }

/** La regla que aplica a UN negocio (para la emisión y la píldora). */
export async function reglaDelNegocio(svc: Db, workspaceId: string, negocioId: string): Promise<ReglaDelNegocio | null> {
  const { data } = await svc
    .from('negocios')
    .select('id, precio_aprobado, metadata, lineas_negocio(config_extra)')
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  if (!data) return null
  const n = data as NegocioParaColaViaje & { lineas_negocio?: unknown }
  const l = Array.isArray(n.lineas_negocio) ? n.lineas_negocio[0] : n.lineas_negocio
  const cfg = configFacturacionLinea((l as { config_extra?: unknown } | null)?.config_extra)
  if (!cfg.activo) return { regla: 'apagada' }
  if (!cfg.porTitular) return { regla: 'etapa' }
  const estado = (await estadosViaje(svc, workspaceId, [n])).get(n.id)!
  const r = entraALaColaViaje(estado)
  return { regla: 'viaje', entra: r.entra, motivo: r.motivo, estado }
}
