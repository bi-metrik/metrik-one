/**
 * A que se abona cada peso que entra por un negocio.
 *
 * DEFINICION (Mauricio, 2026-08-11): **un pago no es una transaccion, es un HITO.**
 * "Pago 1" es que se COMPLETE el tramo 1 del honorario; "pago 2", que se complete el
 * tramo 2. Al cliente no se le puede exigir que pague de forma estructurada: si hace su
 * 50% en cinco transferencias, es su decision — lo que importa es que complete.
 *
 * De ahi que el grano NO sea el cobro sino la CUENTA. Un negocio tiene tres:
 *
 *   | Cuenta            | Plan 1 (50/50)   | Plan 2 (100% anticipado) |
 *   | tramo 1           | 50% del honorario| 100% del honorario       |
 *   | tramo 2           | el otro 50%      | no existe                |
 *   | tarifa UPME       | valor confirmado | valor confirmado         |
 *
 * Cada transaccion se imputa contra ellas en un orden duro, decidido por Mauricio:
 * **honorario (tramo VIGENTE) → tarifa UPME → excedente.** Sin prorrateo. Los tres
 * techos son duros, asi que el orden no puede inflar ninguna cuenta: cada una recibe
 * como maximo lo suyo.
 *
 * ⚠️ "Tramo VIGENTE", no "el honorario entero": el tramo 2 del Plan 1 se paga al exito,
 * asi que NO puede llenarse con la misma plata que trae la tarifa. El orden efectivo es
 * **tramo 1 → tarifa → tramo 2 → excedente**, y esto NO es una interpretacion comoda:
 * es lo unico que reproduce los cinco casos reales de Plan 1 medidos el 2026-08-11.
 *
 *   V0025 / V0099 / V0103: primer giro = $1.126.812 = 425.000 (50%) + 701.812 (tarifa), exacto
 *   V0277 / V0287:         primer giro = $701.812 = la tarifa sola, exacto
 *
 * Con "honorario entero primero", V0103 apareceria con su honorario COMPLETO tras un
 * solo giro (y el hito "pago 2" disparado el dia uno), cuando lo que pago fue su mitad
 * mas la tarifa. Los cinco casos darian falso. Pendiente de confirmacion de Mauricio;
 * cambiarlo es mover una franja en `imputarCobros` y en su espejo SQL.
 *
 * ⚠️ La tarifa UPME NO es "lo que sobra": tiene techo propio y conocido
 * (`tarifa_upme_confirmada`). Tratarla como sobrante rompe el Plan 1 — un pago de 50%
 * mas tarifa se veria como un adelanto del tramo 2. Medido el 2026-08-11: 65 de los 70
 * negocios con cobro de SOENA ya la tienen confirmada, y cero exceden el honorario sin
 * tenerla.
 *
 * Este modulo es PURO (sin DB, sin red) y es el CONTRATO de la vista `v_cobro_valor`,
 * que lo espeja en SQL. Si cambia una regla aca, cambia alli — y los tests son la unica
 * forma de notar que se desincronizaron.
 */

/** Techos del negocio, en pesos CON IVA (que es como entra la plata). */
export interface TechosNegocio {
  /** Honorario del tramo 1. Plan 1 → 50%; Plan 2 → 100%. */
  tramo1: number
  /** Honorario del tramo 2. Solo Plan 1; en Plan 2 es 0 porque el tramo no existe. */
  tramo2: number
  /** Tarifa UPME confirmada. 0 si el negocio no la declara. */
  tarifa: number
  /**
   * El negocio no declara NINGUN valor (ni aprobado ni estimado): no hay techo que
   * aplicar y todo lo cobrado cuenta como propio. Ausencia de dato no es cero — un
   * techo de cero haria desaparecer del P&L plata realmente cobrada.
   */
  sinTecho: boolean
}

export interface CobroEntrada {
  id: string
  /** Puede ser negativo (devolucion). Un cobro anulado llega en 0 y no mueve nada. */
  monto: number
}

export interface ImputacionCobro {
  cobroId: string
  aTramo1: number
  aTramo2: number
  aTarifa: number
  /** Plata que entro y no es ingreso: tarifa por encima de su techo, o sobrepago. */
  excedente: number
  /** Esta transaccion es la que COMPLETO el tramo 1 (el hito "pago 1"). */
  completaTramo1: boolean
  /** Esta transaccion es la que COMPLETO el tramo 2 (el hito "pago 2"). */
  completaTramo2: boolean
}

/** Cuanto del intervalo (desde, hasta] cae dentro de la franja (inicio, fin]. */
function franja(desde: number, hasta: number, inicio: number, fin: number): number {
  return Math.max(0, Math.min(hasta, fin) - Math.max(desde, inicio))
}

/**
 * Imputa una lista de cobros YA ORDENADA cronologicamente (fecha, luego id, para que
 * dos cobros del mismo dia se resuelvan siempre igual).
 *
 * Los montos negativos van enteros a `excedente` y NO descuentan tramos: una devolucion
 * regresa plata que nunca fue ingreso, era excedente. Tampoco consumen techo, asi que no
 * "liberan" espacio para que el siguiente cobro vuelva a llenar un tramo ya completo.
 */
export function imputarCobros(techos: TechosNegocio, cobros: CobroEntrada[]): ImputacionCobro[] {
  // Franjas acumuladas EN EL ORDEN DE IMPUTACION: tramo 1, tarifa, tramo 2, excedente.
  // La tarifa va en medio a proposito (ver la nota del encabezado).
  const finTramo1 = techos.sinTecho ? Infinity : Math.max(0, techos.tramo1)
  const finTarifa = techos.sinTecho ? Infinity : finTramo1 + Math.max(0, techos.tarifa)
  const finTramo2 = techos.sinTecho ? Infinity : finTarifa + Math.max(0, techos.tramo2)

  let consumido = 0
  let tramo1YaCompleto = finTramo1 <= 0
  let tramo2YaCompleto = finTramo2 <= finTarifa

  return cobros.map((c) => {
    const monto = Number.isFinite(c.monto) ? c.monto : 0

    if (monto <= 0) {
      return {
        cobroId: c.id,
        aTramo1: 0,
        aTramo2: 0,
        aTarifa: 0,
        excedente: monto,
        completaTramo1: false,
        completaTramo2: false,
      }
    }

    const desde = consumido
    const hasta = consumido + monto

    const aTramo1 = franja(desde, hasta, 0, finTramo1)
    const aTarifa = franja(desde, hasta, finTramo1, finTarifa)
    const aTramo2 = franja(desde, hasta, finTarifa, finTramo2)
    const excedente = Math.max(0, hasta - Math.max(desde, finTramo2))

    const completaTramo1 = !tramo1YaCompleto && hasta >= finTramo1
    const completaTramo2 = !tramo2YaCompleto && hasta >= finTramo2
    if (completaTramo1) tramo1YaCompleto = true
    if (completaTramo2) tramo2YaCompleto = true

    consumido = hasta

    return { cobroId: c.id, aTramo1, aTramo2, aTarifa, excedente, completaTramo1, completaTramo2 }
  })
}

/**
 * Techos a partir del plan aprobado. `honorario` va CON IVA (es `precio_aprobado`).
 *
 * Plan 1 = tarifa plena, pago 50%/50%. Plan 2 = 100% anticipado. Sin plan declarado se
 * asume un solo tramo, que es el comportamiento de todo workspace que no usa propuesta
 * economica con planes.
 */
export function techosDelNegocio(
  honorario: number | null,
  plan: 1 | 2 | null,
  tarifaConfirmada: number | null,
): TechosNegocio {
  if (honorario == null || !Number.isFinite(honorario)) {
    return { tramo1: 0, tramo2: 0, tarifa: Math.max(0, tarifaConfirmada ?? 0), sinTecho: true }
  }
  const total = Math.max(0, honorario)
  const tramo1 = plan === 1 ? total / 2 : total
  return {
    tramo1,
    tramo2: total - tramo1,
    tarifa: Math.max(0, tarifaConfirmada ?? 0),
    sinTecho: false,
  }
}
