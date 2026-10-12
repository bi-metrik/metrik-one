/**
 * «Así puedes pagar» (F2, PR 7; Noor §4.1, Vera C2 y F2-1): el plan sugerido escrito para el
 * cliente, en «Revisar y enviar» y en el PDF de la cotización, debajo del total.
 *
 * Puro. Sale de la MISMA función que arma el sugerido de «El cliente confirmó» (`planSugerido`),
 * sobre el total que se le pasa: el PDF le pasa el TOTAL que imprime, así que las filas suman ese
 * total por construcción (la última absorbe el residuo del redondeo).
 *
 * Sin fecha de salida, o con la salida ya pasada, no hay montos: la regla en palabras.
 *
 * Interruptor: `lineas_negocio.config_extra.plan_pagos.activo` (lo resuelve quien llama). Apagado,
 * nadie arma esto y el PDF no cambia.
 */

import { configPlanPagos, planSugerido, REGLA_POR_DEFECTO, type ReglaPlan } from './plan-pagos'

/** Lo que el PDF y la pantalla necesitan para armar la sección, además del total. */
export interface EntradaAsiPuedesPagar {
  /** `YYYY-MM-DD` o `null` si el viaje no tiene fecha de salida exacta. */
  fechaSalida: string | null
  /** Hoy en Bogotá, `YYYY-MM-DD`. */
  hoy: string
  regla: ReglaPlan
}

export interface FilaAsiPuedesPagar {
  monto: number
  /** «al confirmar (anticipo)», «hasta el 19 de noviembre», «hasta el 4 de diciembre, día del viaje». */
  cuando: string
  /** En la fila que completa el mínimo: lo acumulado hasta ahí (el resto, `null`). */
  llevas: number | null
}

export interface AsiPuedesPagar {
  /** `null` = sin montos (sin fecha o salida pasada): solo la regla en palabras. */
  filas: FilaAsiPuedesPagar[] | null
  /** Suma de las filas (= el total que se le pasó). 0 sin filas. */
  suma: number
  /** La regla en palabras: va siempre, debajo de las filas o sola. */
  regla: string
  /** El porcentaje de la regla (80), para la nota de la fila que lo completa. */
  pctMinimo: number
  /** «Puedes repartirlo en más cuotas: lo acordamos contigo.» */
  pie: string
}

export const TITULO_ASI_PUEDES_PAGAR = 'Así puedes pagar'
export const PIE_ASI_PUEDES_PAGAR = 'Puedes repartirlo en más cuotas: lo acordamos contigo.'

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

/** «19 de noviembre» (sin depender del ICU del servidor). */
export function fechaLarga(f: string): string {
  const d = new Date(`${f.slice(0, 10)}T00:00:00Z`)
  return `${d.getUTCDate()} de ${MESES[d.getUTCMonth()]}`
}

function diasEnPalabras(n: number): string {
  const palabras: Record<number, string> = { 7: 'siete', 10: 'diez', 15: 'quince', 20: 'veinte', 30: 'treinta' }
  return palabras[n] ?? String(n)
}

/** «El 80 % quince días antes de salir y el resto el día del viaje.» */
export function reglaEnPalabras(regla: ReglaPlan = REGLA_POR_DEFECTO): string {
  return `El ${regla.pct_minimo} % ${diasEnPalabras(regla.dias_antes)} días antes de salir y el resto el día del viaje.`
}

export function asiPuedesPagar(total: number, entrada: EntradaAsiPuedesPagar): AsiPuedesPagar {
  const regla = entrada.regla ?? REGLA_POR_DEFECTO
  const base = { regla: reglaEnPalabras(regla), pctMinimo: regla.pct_minimo, pie: PIE_ASI_PUEDES_PAGAR }
  const cuotas = planSugerido({ total, fechaSalida: entrada.fechaSalida, hoy: entrada.hoy, regla })
  if (!cuotas || cuotas.length === 0 || !entrada.fechaSalida) return { ...base, filas: null, suma: 0 }

  const salida = entrada.fechaSalida
  let acumulado = 0
  const minimo = Math.min(Math.round(total), Math.ceil((Math.round(total) * regla.pct_minimo) / 100 / 1000) * 1000)
  const filas: FilaAsiPuedesPagar[] = cuotas.map((c, i) => {
    acumulado += c.monto
    const completaMinimo = acumulado >= minimo && acumulado - c.monto < minimo
    const esAnticipo = i === 0
    const esElViaje = c.fecha === salida && !esAnticipo
    const cuando = esAnticipo
      ? 'al confirmar (anticipo)'
      : esElViaje
        ? `hasta el ${fechaLarga(c.fecha)}, día del viaje`
        : `hasta el ${fechaLarga(c.fecha)}`
    return { monto: c.monto, cuando, llevas: completaMinimo && acumulado < Math.round(total) ? acumulado : null }
  })
  return { ...base, filas, suma: filas.reduce((a, f) => a + f.monto, 0) }
}

/** «con esto llevas el 80 % ($3.242.000)», o `null`. El formato de pesos lo pone quien pinta. */
export function notaDeFila(f: FilaAsiPuedesPagar, pctMinimo: number, pesos: (v: number) => string): string | null {
  return f.llevas === null ? null : `con esto llevas el ${pctMinimo} % (${pesos(f.llevas)})`
}

/** Lee `plan_pagos` de la línea para esta sección: `null` = apagado (el PDF queda como hoy). */
export function entradaAsiPuedesPagar(
  configLinea: unknown,
  datos: { fechaSalida: string | null; hoy: string },
): EntradaAsiPuedesPagar | null {
  const cfg = configPlanPagos(configLinea)
  if (!cfg.activo) return null
  return { fechaSalida: datos.fechaSalida, hoy: datos.hoy, regla: cfg.regla }
}

/**
 * El TOTAL que imprime el PDF, visto desde la pantalla, para que «Así puedes pagar» de «Revisar y
 * enviar» sume lo mismo que el documento (Vera F2-1).
 *
 * El PDF imprime `fiscal.totalBruto`. Con el IVA sobre el ingreso propio (Trappvel), eso es el
 * precio de la cascada (`valor_total`) más el IVA si va aparte, o el precio tal cual si va
 * incluido (`fiscalSobreIngresoPropio`). Sin esa configuración el PDF suma el IVA genérico del
 * perfil fiscal, que la pantalla no liquida: `null`, y la pantalla dice la regla sin montos.
 */
export function totalDelDocumento(p: {
  precioVenta: number
  ivaSobreIngresoPropio: boolean
  iva: { valor: number; precio: 'iva_aparte' | 'iva_incluido' } | null
}): number | null {
  if (!p.ivaSobreIngresoPropio || !p.iva) return null
  return Math.round(p.precioVenta + (p.iva.precio === 'iva_aparte' ? p.iva.valor : 0))
}
