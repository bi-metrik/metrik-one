/**
 * Qué paga la AGENCIA por esta captura, cuando la pantalla lo dice de alguna forma.
 *
 * Hasta el 2026-09-18 ese número salía de un solo campo (`total_a_pagar_agencia`) y con
 * una sola etiqueta, la de la liquidación de Decameron. Medido contra el banco real: la
 * captura de Altos Ushuaia (`4.03.08_PM`) muestra el precio grande **799.016,38** y, en un
 * globo, **«Precio neto» 687.154,09** — el mismo hecho dicho con otras palabras. Ese neto
 * es lo que paga la agencia (decisión de Mauricio del 2026-09-19, que cierra la D4 que
 * había quedado abierta con Bedsonline), así que la pantalla traía un margen servido que
 * nadie tomaba y la línea se vendía con el margen general de la cotización.
 *
 * ## Las dos vías, y por qué NO se cruzan entre sí
 *
 *  · **El neto LEÍDO manda siempre.** Es el hallazgo 7.1 del diseño: en Decameron la resta
 *    de comisión y prestación NO da el «total a pagar agencia» (faltan 7.287 sin concepto,
 *    y por el lado del porcentaje la diferencia sube a 22.911). El costo es el número
 *    escrito en la pantalla, nunca uno recalculado. Si aquí se exigiera que la resta
 *    cuadre con el neto, **Decameron perdería su margen** — que es justo el caso que hoy
 *    funciona.
 *
 *  · **La comisión solo RELLENA el hueco.** Cuando la pantalla muestra el precio al público
 *    y la comisión de la agencia, pero no el neto, el neto se deriva restando.
 *
 * ## Dónde sí hay cruce, y por qué ahí sí
 *
 * La comisión puede venir escrita dos veces —en plata y en porcentaje— y son la misma
 * afirmación: Ushuaia dice «Descuento (14%) 111.862,29» y `14% × 799.016,38 = 111.862,29`
 * al centavo. Si esos dos caminos NO dan lo mismo, la pantalla se contradice a sí misma y
 * no hay forma de saber cuál de los dos leyó mal el modelo: **no se escribe margen y se
 * dice por qué**. Abstenerse nunca es una regresión — deja la línea heredando el margen de
 * la cotización, que es el comportamiento de siempre.
 */

/** De dónde salió el número: leído tal cual, o derivado de la comisión. */
export type OrigenCostoAgencia = 'neto_leido' | 'derivado_comision'

export interface CostoAgencia {
  costoAgencia: number
  origen: OrigenCostoAgencia
  /** Qué comisión se usó para derivarlo. `null` cuando el neto venía escrito. */
  comision: number | null
}

/** La pantalla se contradice: hay con qué calcular, y los caminos no coinciden. */
export interface AbstencionCostoAgencia {
  costoAgencia: null
  /** Qué se le dice a quien revisa. Se cuelga de las alertas de la casilla. */
  motivo: string
}

export type ResolucionCostoAgencia = CostoAgencia | AbstencionCostoAgencia | null

/** Lo que hace falta leer de la captura para responder la pregunta. */
export interface PreciosLeidos {
  /** El precio al público ya resuelto por su `base_precio`. */
  precioCliente: number
  /** «Total a pagar agencia», «precio neto», «tarifa neta»… si la pantalla lo muestra. */
  netoLeido: number | null
  /** La comisión de la agencia en plata, si la pantalla la muestra. */
  comisionValor: number | null
  /** La misma comisión en porcentaje, si la pantalla la muestra. */
  comisionPct: number | null
}

/**
 * Cuánto pueden diferir los dos caminos de la comisión antes de abstenerse.
 *
 * Un porcentaje se imprime redondeado («14%» para un 14,004% real), así que exigir
 * igualdad exacta abstendría sobre capturas que dicen la verdad: en Ushuaia ese redondeo
 * vale 32 pesos sobre una comisión de 111.862. El 1% de la comisión lo cubre de sobra y
 * sigue atrapando la contradicción de verdad — un «14%» que en realidad era 13,5 se
 * separa un 3,7% y no pasa.
 *
 * El piso de 1 evita que una comisión diminuta exija una coincidencia al centésimo.
 */
const TOLERANCIA_RELATIVA = 0.01
const TOLERANCIA_MINIMA = 1

/**
 * El costo de la agencia según esta captura, o por qué no se puede afirmar.
 *
 * `null` es la respuesta normal y frecuente: un buscador de hoteles o el detalle de un
 * vuelo muestran UN precio, y ahí no hay nada que resolver.
 */
export function resolverCostoAgencia(p: PreciosLeidos): ResolucionCostoAgencia {
  const precio = Number(p.precioCliente)
  const neto = p.netoLeido

  // 1 · El neto escrito gana. Se conserva el criterio de `montoDeCosto`, que ya tomaba
  // cualquier «a pagar agencia» mayor que cero como costo: cambiarlo aquí movería el
  // costo de líneas ya confirmadas.
  if (neto !== null && Number.isFinite(neto) && neto > 0) {
    return { costoAgencia: neto, origen: 'neto_leido', comision: null }
  }

  if (!Number.isFinite(precio) || precio <= 0) return null

  // 2 · Sin neto, la comisión lo deriva. Las dos formas de escribirla se cruzan entre sí.
  const valor = validoPositivo(p.comisionValor) ? (p.comisionValor as number) : null
  const pct = validoPositivo(p.comisionPct) ? (p.comisionPct as number) : null
  if (valor === null && pct === null) return null

  const desdePct = pct !== null ? (precio * pct) / 100 : null

  if (valor !== null && pct !== null && desdePct !== null) {
    const tolerancia = Math.max(TOLERANCIA_MINIMA, valor * TOLERANCIA_RELATIVA)
    if (Math.abs(valor - desdePct) > tolerancia) {
      return {
        costoAgencia: null,
        motivo:
          `La captura dice que la comisión es ${redondear(valor)} y también que es ${redondear(pct)}% ` +
          `de ${redondear(precio)}, que son ${redondear(desdePct)}. No coinciden, así que no se fija ` +
          'margen desde el pantallazo: la línea usa el margen de la cotización.',
      }
    }
  }

  // Con las dos escritas y coincidentes manda la de PLATA: el porcentaje viene redondeado
  // en pantalla y arrastraría ese redondeo al costo.
  const comision = valor ?? (desdePct as number)

  // Una comisión que se come el precio entero no es una comisión: es una lectura cruzada.
  // Dejar pasar un costo de cero o negativo pondría la línea a precio infinito.
  if (comision >= precio) {
    return {
      costoAgencia: null,
      motivo:
        `La comisión leída (${redondear(comision)}) no es menor que el precio (${redondear(precio)}). ` +
        'No se fija margen desde el pantallazo: la línea usa el margen de la cotización.',
    }
  }

  return { costoAgencia: precio - comision, origen: 'derivado_comision', comision }
}

function validoPositivo(n: number | null | undefined): boolean {
  return n !== null && n !== undefined && Number.isFinite(n) && n > 0
}

function redondear(n: number): string {
  return n.toLocaleString('es-CO', { maximumFractionDigits: 2 })
}
