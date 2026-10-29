/**
 * Lo que dice «Ver el cálculo (costo, margen, descuento comercial)»: las cifras de la cascada
 * dichas como las mide el encabezado (brief del 2026-10-29, falla 2, Trappvel).
 *
 * La cascada guarda el costo de una Pública como su PRECIO PÚBLICO (`costoDeVentaLinea`), porque es
 * lo que cuesta la línea antes de la comisión y es la base de la comisión en %. Pero lo que la agencia
 * paga por ella es el precio público menos su comisión (D2 de Mauricio, 2026-10-29), y así lo mide el
 * margen del encabezado (`margenMedible`). Si «Ver el cálculo» pintara la cascada en crudo, con un
 * hotel Público de $2.000.000 al 20 % y una actividad Neta de $1.000.000 al 0 % la asesora vería
 * «Costo de venta $3.000.000» y «Margen real 0,0 %» al lado de un encabezado de 13,3 %.
 *
 * Solo dice: no cambia ni un peso del precio, que sale de la cascada tal cual.
 */
import { margenMedible } from './itinerarios'
import type { Cascada } from './totales'

export interface CalculoEnPantalla {
  /** La comisión de las Públicas que la tienen escrita, en pesos. 0 sin Públicas. */
  comisionPublicas: number
  /** Lo que paga la agencia: el costo de venta de la cascada menos esa comisión. */
  costoDeVenta: number
  /**
   * El margen del viaje, el MISMO que el encabezado (`margenDelEncabezado`). `null` sin precio, o con
   * una Pública sin comisión (no hay con qué medirlo: D3).
   */
  margenDelViajePct: number | null
  /** Cuántas Públicas no tienen su comisión escrita. */
  publicasSinComision: number
  /**
   * Con reglas de margen, cuántas líneas toman el margen de la cotización (los hoteles Neta sin
   * margen propio: `ReglasDeLinea.tomaElGeneral`). `null` sin reglas: ahí lo toman todas las que no
   * traen el suyo, como siempre.
   */
  lineasQueTomanElMargen: number | null
}

export function calculoEnPantalla(cascada: Cascada): CalculoEnPantalla {
  const p = cascada.publicas
  const comisionPublicas = p.lineas > 0 ? p.comision : 0
  const conReglas = cascada.reglas !== undefined
  let margenDelViajePct = cascada.margenRealPct
  if (conReglas || p.lineas > 0) {
    // La misma regla que `margenDelEncabezado`, salvo con una Pública sin comisión: ahí el
    // encabezado frena con su aviso, y aquí no se inventa una cifra.
    margenDelViajePct = p.sinComision > 0 ? null : (margenMedible(cascada) ?? cascada.margenRealPct)
  }
  return {
    comisionPublicas,
    costoDeVenta: cascada.costoDeVenta - comisionPublicas,
    margenDelViajePct,
    publicasSinComision: p.sinComision,
    lineasQueTomanElMargen: conReglas ? cascada.lineas.filter(l => l.reglas?.tomaElGeneral === true).length : null,
  }
}
