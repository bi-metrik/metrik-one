/**
 * Siigo listo para enchufar (adenda de la ola 4): lo que un espacio con viajes necesita además del
 * `SiigoConfig` de siempre, y las guardas que impiden emitir donde no se debe. Módulo PURO: lo
 * usan la emisión, la cola, `scripts/setup-siigo-workspace.ts`, `scripts/check-siigo.ts` y la
 * simulación (`scripts/simular-siigo-desde-one.ts --viajes`), así que el payload que se simula es
 * el que se emitiría.
 *
 * Compatible hacia atrás: SOENA no tiene ninguno de los campos nuevos y sigue igual
 * (`entorno` ausente = `produccion`, sin mapa por cuenta = la forma de pago de siempre).
 */

import type { SiigoConfig } from './client'
import { baseYTotalGravado, SUCURSAL_POR_DEFECTO, type Borrador, type BorradorFactura } from './mapeo'

export type EntornoSiigo = 'pruebas' | 'produccion'

/** `entorno` ausente = producción (SOENA no lo declara y emite en sus libros reales). */
export function entornoSiigo(cfg: Partial<SiigoConfig> | null | undefined): EntornoSiigo {
  return cfg?.entorno === 'pruebas' ? 'pruebas' : 'produccion'
}

/** El negocio del viaje de prueba (F8): `metadata.prueba` o `metadata.es_prueba`. */
export function esNegocioDePrueba(metadata: Record<string, unknown> | null | undefined): boolean {
  const m = metadata ?? {}
  return m.prueba === true || m.es_prueba === true
}

export const MENSAJE_PRUEBA_EN_PRODUCCION =
  'Este es un negocio de prueba y Siigo está conectado a los libros reales: no se emite nada.'

/**
 * Un negocio de prueba NUNCA emite contra un Siigo de producción (C7.3, F8-5). Devuelve el motivo
 * en palabras o `null` si puede seguir.
 */
export function bloqueoPorEntorno(
  cfg: Partial<SiigoConfig> | null | undefined,
  metadata: Record<string, unknown> | null | undefined,
): string | null {
  return esNegocioDePrueba(metadata) && entornoSiigo(cfg) === 'produccion' ? MENSAJE_PRUEBA_EN_PRODUCCION : null
}

/**
 * La forma de pago del recibo de caja según la cuenta donde entró la plata.
 *  · Con mapa por cuenta (`reciboPaymentIdPorCuenta`): la cuenta TIENE que estar en él (o traer su
 *    propio `siigo_payment_id`); si no, «falta configurar» y no se emite con la forma de otra.
 *  · Sin mapa (SOENA): la de la cuenta si la trae, y si no la de siempre (`reciboPaymentId`).
 */
export function formaDePagoRecibo(
  cfg: Partial<SiigoConfig> | null | undefined,
  cuentaId: string | null | undefined,
  idDeLaCuenta?: number | null,
): { ok: true; id: number } | { ok: false; falta: string } {
  const mapa = cfg?.reciboPaymentIdPorCuenta
  if (mapa && typeof mapa === 'object') {
    const id = (cuentaId ? mapa[cuentaId] : undefined) ?? idDeLaCuenta ?? null
    if (typeof id === 'number' && Number.isFinite(id)) return { ok: true, id }
    return { ok: false, falta: `configurar en Siigo la forma de pago de la cuenta ${cuentaId ?? '(sin cuenta)'}` }
  }
  const id = idDeLaCuenta ?? cfg?.reciboPaymentId ?? null
  return typeof id === 'number' && Number.isFinite(id) ? { ok: true, id } : { ok: false, falta: 'configurar la forma de pago del recibo' }
}

/** Lo que le falta al `siigo_config` para facturar viajes. Vacío = listo. */
export function faltantesConfigViaje(cfg: Partial<SiigoConfig> | null | undefined): string[] {
  const out: string[] = []
  if (!cfg) return ['conectar Siigo']
  if (!cfg.productoPropioCode) out.push('configurar en Siigo el producto de ingreso propio')
  if (!cfg.productoTercerosCode) out.push('configurar en Siigo el producto recibido para terceros')
  return out
}

/** El total del viaje partido en lo que es de la agencia (con IVA) y lo recibido para terceros. */
export interface RepartoFacturaViaje {
  /** Ingreso propio (fee, margen, recargo) CON su IVA. */
  propioConIva: number
  /** Lo que la agencia recibe para pagarle a los proveedores. Sin IVA. */
  terceros: number
}

/**
 * La factura de un viaje: dos conceptos (Max §7, P3). El ingreso propio va con IVA (Siigo recibe la
 * base y calcula el impuesto) y lo recibido para terceros va sin IVA. Nunca se emite con el
 * producto de otro: sin los dos productos, el borrador sale con faltantes.
 */
export function borradorFacturaViaje(
  cfg: SiigoConfig,
  identificacion: string,
  reparto: RepartoFacturaViaje | null,
  fecha: string,
  ivaPct: number,
  opciones?: { emitir?: boolean; enviarCorreo?: boolean; branchOffice?: number; observaciones?: string },
): Borrador<BorradorFactura> {
  const faltantes = faltantesConfigViaje(cfg)
  if (!identificacion) faltantes.push('identificación')
  if (!reparto) faltantes.push('el reparto del valor entre ingreso propio y terceros')
  const propio = Math.max(0, Number(reparto?.propioConIva ?? 0) || 0)
  const terceros = Math.max(0, Math.round((Number(reparto?.terceros ?? 0) || 0) * 100) / 100)
  if (reparto && propio + terceros <= 0) faltantes.push('valor del viaje')
  const { base, total } = baseYTotalGravado(propio, ivaPct)

  const items: BorradorFactura['items'] = []
  if (base > 0) items.push({ code: cfg.productoPropioCode ?? '', quantity: 1, price: base, taxes: [{ id: cfg.ivaId }] })
  if (terceros > 0) items.push({ code: cfg.productoTercerosCode ?? '', quantity: 1, price: terceros, taxes: [] })

  return {
    payload: {
      document: { id: cfg.facturaDocumentId },
      date: fecha,
      customer: { identification: identificacion, branch_office: opciones?.branchOffice ?? SUCURSAL_POR_DEFECTO },
      ...(typeof cfg.centroCostoId === 'number' ? { cost_center: cfg.centroCostoId } : {}),
      seller: cfg.sellerId,
      items,
      payments: [{ id: cfg.facturaPaymentId, value: Math.round((total + terceros) * 100) / 100, due_date: fecha }],
      ...(opciones?.observaciones ? { observations: opciones.observaciones } : {}),
      stamp: { send: opciones?.emitir === true },
      mail: { send: opciones?.enviarCorreo === true },
    },
    faltantes,
  }
}
