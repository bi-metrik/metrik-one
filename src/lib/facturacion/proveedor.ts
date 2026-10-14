import 'server-only'

/**
 * Capa de proveedor de facturación electrónica (F5, Max §7). Siigo hoy; la interfaz queda lista
 * para Aliaddo. `workspaces.config_extra.facturacion_proveedor` elige el adaptador; ausente =
 * Siigo, así que ningún workspace cambia.
 *
 * Solo la usa el camino NUEVO (viajes). El camino de SOENA sigue llamando directo a
 * `emitirFacturaNegocio` y `emitirReciboDeCobro`: no se refactoriza la facturación de SOENA para
 * habilitar a otro cliente (Max A8, Vera F5-5).
 */

import { emitirFacturaNegocio, type OpcionesEmision, type ResultadoEmision } from '@/lib/siigo/facturas'
import { emitirReciboDeCobro, type ResultadoRecibo } from '@/lib/siigo/recibos'

export type NombreProveedor = 'siigo' | 'aliaddo'

export const PROVEEDORES: readonly NombreProveedor[] = ['siigo', 'aliaddo']

/** Lo que la capa necesita de un proveedor. Cada método nunca lanza por un rechazo del proveedor. */
export interface ProveedorFacturacion {
  nombre: NombreProveedor
  /** ¿El adaptador está construido? Aliaddo todavía no. */
  disponible: boolean
  emitirFactura(args: {
    workspaceId: string
    negocioId: string
    staffNombre: string | null
    staffId: string | null
    opciones: OpcionesEmision
  }): Promise<ResultadoEmision>
  emitirRecibo(args: {
    workspaceId: string
    cobroId: string
    staffNombre: string | null
    opciones: Parameters<typeof emitirReciboDeCobro>[3]
  }): Promise<ResultadoRecibo>
}

/** El proveedor que declara el espacio. Un valor desconocido NO cae a Siigo: se rechaza. */
export function nombreDelProveedor(configWorkspace: unknown): NombreProveedor | null {
  const v = (configWorkspace && typeof configWorkspace === 'object'
    ? (configWorkspace as { facturacion_proveedor?: unknown }).facturacion_proveedor
    : undefined)
  if (v === undefined || v === null || v === '') return 'siigo'
  return PROVEEDORES.includes(v as NombreProveedor) ? (v as NombreProveedor) : null
}

export const adaptadorSiigo: ProveedorFacturacion = {
  nombre: 'siigo',
  disponible: true,
  emitirFactura: ({ workspaceId, negocioId, staffNombre, staffId, opciones }) =>
    emitirFacturaNegocio(workspaceId, negocioId, staffNombre, opciones, { staffId }),
  emitirRecibo: ({ workspaceId, cobroId, staffNombre, opciones }) =>
    emitirReciboDeCobro(workspaceId, cobroId, staffNombre, opciones),
}

const NO_CONECTADO = 'Aliaddo todavía no está conectado en ONE: la factura se hace por fuera.'

/** Aliaddo: el lugar donde va su adaptador. Hoy dice que no está, nunca emite a medias. */
export const adaptadorAliaddo: ProveedorFacturacion = {
  nombre: 'aliaddo',
  disponible: false,
  emitirFactura: async () => ({ ok: false, motivo: 'error', mensaje: NO_CONECTADO }),
  emitirRecibo: async () => ({ ok: false, motivo: 'error', mensaje: NO_CONECTADO }),
}

export function proveedorDeFacturacion(configWorkspace: unknown): ProveedorFacturacion | { error: string } {
  const nombre = nombreDelProveedor(configWorkspace)
  if (nombre === 'siigo') return adaptadorSiigo
  if (nombre === 'aliaddo') return adaptadorAliaddo
  return { error: 'El proveedor de facturación configurado no existe en ONE.' }
}
