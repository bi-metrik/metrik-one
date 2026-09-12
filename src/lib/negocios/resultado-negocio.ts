// ============================================================
// El RESULTADO de un negocio: qué se ganó, no cuánta plata se movió.
//
// La versión anterior medía el margen sobre lo COBRADO. Con un anticipo del 30% y los
// costos ya incurridos, un negocio sano se pintaba en rojo, y esa lectura lleva a
// apretar a un cliente que va bien o a matar un negocio rentable. La utilidad se mide
// contra el precio que el cliente aceptó; lo cobrado es caja, que es otra pregunta.
// ============================================================

export interface EntradaResultado {
  /** Precio de la cotización aprobada. Sin él no hay resultado que medir. */
  precioAprobado?: number | null
  /** Gastos + costo de horas ya ejecutados. */
  costosEjecutados: number
  /** Plata efectivamente recibida. */
  totalCobrado: number
}

export interface Resultado {
  /** Contra qué se midió: el precio aceptado, o lo cobrado a falta de precio. */
  base: 'precio_aprobado' | 'cobrado' | 'ninguna'
  valorBase: number
  costo: number
  utilidad: number
  /** Porcentaje entero. `null` cuando no hay base contra la cual medir. */
  margenPct: number | null
  /** Caja: lo que entró y lo que falta por entrar. */
  cobrado: number
  porCobrar: number
}

/**
 * Resultado del negocio.
 *
 * Regla de base, en este orden:
 *   1. Precio aprobado, si existe y es mayor que cero. Es lo que el cliente aceptó.
 *   2. Lo cobrado, si no hay precio aprobado pero sí plata recibida. Es una base
 *      parcial y quien la muestre debe decirlo.
 *   3. Ninguna: hay costos pero nada contra qué medirlos. El margen se declara nulo
 *      en vez de devolver 0%, que se lee como "margen cero" y no como "no se sabe".
 */
export function calcularResultado(e: EntradaResultado): Resultado {
  const precio = e.precioAprobado ?? 0
  const cobrado = e.totalCobrado
  const costo = e.costosEjecutados

  const base: Resultado['base'] =
    precio > 0 ? 'precio_aprobado' : cobrado > 0 ? 'cobrado' : 'ninguna'
  const valorBase = base === 'precio_aprobado' ? precio : base === 'cobrado' ? cobrado : 0

  return {
    base,
    valorBase,
    costo,
    utilidad: valorBase - costo,
    margenPct: valorBase > 0 ? Math.round(((valorBase - costo) / valorBase) * 100) : null,
    cobrado,
    // Lo que falta por cobrar solo tiene sentido contra el precio aceptado. Sin precio
    // no se inventa: un "por cobrar" calculado sobre cero siempre daría cero y se leería
    // como "ya está todo cobrado".
    porCobrar: precio > 0 ? Math.max(0, precio - cobrado) : 0,
  }
}
