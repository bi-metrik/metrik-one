/**
 * ¿Cada id del `siigo_config` existe y está activo en ESA empresa de Siigo? (adenda Siigo, ola 4).
 * Lo corre `scripts/check-siigo.ts` el día de las credenciales, antes de encender.
 *
 * Solo lee: recibe una función `get` (el `siigoRequest` del producto con método GET) y nunca
 * otra cosa. Separado del script para probarlo con un doble sin red.
 */

import type { SiigoConfig } from './client'
import { entornoSiigo, faltantesConfigViaje, type EntornoSiigo } from './config-viaje'

type Get = <T>(path: string) => Promise<T>

interface Doc { id: number; name: string; active?: boolean }
interface Pay { id: number; name: string; active?: boolean }
interface Tax { id: number; name: string; active?: boolean }
interface User { id: number; username: string; active?: boolean }
interface Prod { code: string; name: string; active?: boolean }
interface Cc { id: number; name: string; active?: boolean }

export interface LineaVerificacion {
  ok: boolean
  texto: string
}

export interface Verificacion {
  ok: boolean
  entorno: EntornoSiigo
  lineas: LineaVerificacion[]
  /** Lo que el config no trae y un espacio con viajes necesita. */
  faltan: string[]
}

function activo(x: { active?: boolean } | undefined): boolean {
  return !!x && x.active !== false
}

/** Verifica el catálogo. `viajes`: exige además los productos y el mapa por cuenta. */
export async function verificarCatalogo(
  cfg: Partial<SiigoConfig>,
  get: Get,
  opciones: { viajes?: boolean } = {},
): Promise<Verificacion> {
  const lineas: LineaVerificacion[] = []
  const esViaje = opciones.viajes ?? !!(cfg.productoPropioCode || cfg.productoTercerosCode || cfg.reciboPaymentIdPorCuenta)
  const [fv, rc, taxes, payFV, payRC, users, prods] = await Promise.all([
    get<Doc[]>('/v1/document-types?type=FV'),
    get<Doc[]>('/v1/document-types?type=RC'),
    get<Tax[]>('/v1/taxes'),
    get<Pay[]>('/v1/payment-types?document_type=FV'),
    get<Pay[]>('/v1/payment-types?document_type=RC'),
    get<{ results: User[] }>('/v1/users'),
    get<{ results: Prod[] }>('/v1/products?page_size=100'),
  ])

  const revisar = (texto: string, item: { active?: boolean; name?: string; username?: string } | undefined) => {
    lineas.push({
      ok: activo(item),
      texto: item
        ? `${texto}: «${item.name ?? item.username}»${item.active === false ? ' (INACTIVO)' : ''}`
        : `${texto}: NO EXISTE en esta empresa`,
    })
  }

  revisar(`Comprobante de factura (${cfg.facturaDocumentId})`, fv.find(d => d.id === cfg.facturaDocumentId))
  revisar(`Comprobante de recibo de caja (${cfg.reciboDocumentId})`, rc.find(d => d.id === cfg.reciboDocumentId))
  revisar(`Vendedor (${cfg.sellerId})`, (users.results ?? []).find(u => u.id === cfg.sellerId))
  revisar(`IVA (${cfg.ivaId})`, taxes.find(t => t.id === cfg.ivaId))
  revisar(`Forma de pago de la factura (${cfg.facturaPaymentId})`, payFV.find(p => p.id === cfg.facturaPaymentId))
  revisar(`Forma de pago del recibo (${cfg.reciboPaymentId})`, payRC.find(p => p.id === cfg.reciboPaymentId))
  const productos = prods.results ?? []
  if (cfg.productoCode) revisar(`Producto de siempre (${cfg.productoCode})`, productos.find(p => p.code === cfg.productoCode))
  if (cfg.productoPropioCode) revisar(`Producto de ingreso propio (${cfg.productoPropioCode})`, productos.find(p => p.code === cfg.productoPropioCode))
  if (cfg.productoTercerosCode) revisar(`Producto recibido para terceros (${cfg.productoTercerosCode})`, productos.find(p => p.code === cfg.productoTercerosCode))
  for (const [cuenta, id] of Object.entries(cfg.reciboPaymentIdPorCuenta ?? {})) {
    revisar(`Forma de pago del recibo para la cuenta ${cuenta} (${id})`, payRC.find(p => p.id === id))
  }
  if (typeof cfg.centroCostoId === 'number') {
    const ccs = await get<Cc[]>('/v1/cost-centers')
    revisar(`Centro de costo (${cfg.centroCostoId})`, ccs.find(c => c.id === cfg.centroCostoId))
  }

  const faltan = esViaje ? faltantesConfigViaje(cfg) : []
  if (esViaje && !cfg.reciboPaymentIdPorCuenta) faltan.push('la forma de pago del recibo por cuenta (reciboPaymentIdPorCuenta)')
  if (esViaje && !cfg.entorno) faltan.push('el entorno (pruebas o produccion)')
  return { ok: lineas.every(l => l.ok) && faltan.length === 0, entorno: entornoSiigo(cfg), lineas, faltan }
}
