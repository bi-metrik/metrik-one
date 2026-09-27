import { TOLERANCIA_SALDO_COP } from './tolerancia-saldo'
import { compararPorAntiguedad } from './antiguedad'

/**
 * Cartera de honorarios: quien debe, cuanto y desde cuando.
 *
 * Vive aparte de la accion porque es la cuenta que estaba mal. /numeros la
 * calculaba como `facturas - cobros`, y como `facturas` tiene 0 filas en los 15
 * workspaces (medido 2026-08-22), el resultado era el recaudo historico EN
 * NEGATIVO: -$88.973.023 en SOENA contra $79.936.645 reales. Una cuenta que se
 * equivoco por $168 millones merece una prueba, no un comentario.
 *
 * Que cuenta como deuda: **solo los negocios que ya se vendieron**, y un negocio
 * se vuelve venta con el primer pago (regla de Mauricio, 2026-08-22; misma vara
 * que `v_venta_mes_comercial`). Un precio aprobado sin un peso encima no es una
 * venta, asi que no es deuda. El filtro lo aplica la vista, no esta funcion.
 *
 * La fuente es `v_cartera_negocio`; aca solo se agrega y se ordena.
 *
 * Que es "vencido" depende de si el negocio tiene cronograma de cuotas
 * (migracion 20260927120000). Con cronograma, lo vencido es la suma de las
 * cuotas que ya debieron pagarse y no se pagaron (`saldo_vencido`), y la
 * antiguedad es la mora de la mas vieja (`dias_mora`); las cuotas futuras son
 * saldo por vencer, nunca vencido. Sin cronograma no hay fecha de vencimiento,
 * asi que sigue la regla de siempre: todo el saldo vence pasados
 * `DIAS_CARTERA_VENCIDA` desde que nacio el negocio. Detonante: ALMA figuraba
 * con $3.600.000 vencidos a 159 dias cuando debia una sola cuota de $400.000.
 */

/** Una fila de `v_cartera_negocio`. Los numericos de Postgres llegan como string. */
export interface FilaCartera {
  codigo: string | null
  nombre: string | null
  honorario: number | string
  honorario_recaudado: number | string
  saldo: number | string
  dias: number | null
  /** Tiene cuotas programadas. Ausente o null = sin cronograma. */
  con_cronograma?: boolean | null
  /** Con cronograma: cuotas esperadas hasta hoy sin pagar, topadas en `saldo`. */
  saldo_vencido?: number | string | null
  /** Con cronograma: dias desde la cuota vencida sin pagar mas antigua. */
  dias_mora?: number | null
}

export interface ItemCartera {
  negocioNombre: string
  negocioCodigo: string
  /** Honorario aprobado. Se llama honorario y no "facturado" porque no hay factura. */
  honorario: number
  recaudado: number
  saldo: number
  /** Parte del saldo que ya vencio. Con cronograma, solo las cuotas vencidas. */
  vencido: number
  /** Parte del saldo que todavia no vence (cuotas futuras). Nunca es vencido. */
  porVencer: number
  conCronograma: boolean
  /**
   * Antiguedad de la deuda. Con cronograma: dias de mora de la cuota vencida mas
   * antigua (0 si esta al dia). Sin cronograma: dias desde que nacio el negocio,
   * porque no hay fecha de vencimiento (no hay factura).
   */
  dias: number
}

export interface ResumenCartera {
  carteraPendiente: number
  honorarioAprobado: number
  honorarioRecaudado: number
  carteraNegocios: number
  carteraVencida: number
  detalle: ItemCartera[]
}

/**
 * Sin cronograma de cuotas, un saldo se considera vencido pasados estos dias
 * desde que nacio el negocio. Con cronograma no aplica: vence cada cuota en su fecha.
 */
export const DIAS_CARTERA_VENCIDA = 30

/** Cuanto del saldo de una fila esta vencido, cuanto no, y desde hace cuanto. */
export function vencimientoDeFila(f: FilaCartera): {
  conCronograma: boolean
  vencido: number
  porVencer: number
  dias: number
} {
  const saldo = Number(f.saldo)
  if (f.con_cronograma) {
    const vencido = Math.min(saldo, Math.max(0, Number(f.saldo_vencido ?? 0)))
    return {
      conCronograma: true,
      vencido,
      porVencer: saldo - vencido,
      dias: vencido > 0 ? (f.dias_mora ?? 0) : 0,
    }
  }
  const dias = f.dias ?? 0
  const vencido = dias > DIAS_CARTERA_VENCIDA ? saldo : 0
  return { conCronograma: false, vencido, porVencer: saldo - vencido, dias }
}

/**
 * El universo son TODAS las filas (incluidas las de saldo cero): son las que dan
 * el denominador de la tasa de cobro. La lista de deudores, en cambio, se
 * recorta con `TOLERANCIA_SALDO_COP`, el mismo piso de materialidad que usa
 * /conciliacion — un residuo de redondeo no es una deuda que perseguir.
 *
 * El orden es por antiguedad y el monto solo desempata ([[compararPorAntiguedad]],
 * PR #325): en SOENA 70 de 125 saldos valen exactamente lo mismo, asi que
 * ordenar por plata no ordena nada.
 *
 * Puro: no toca DB, red ni reloj.
 */
export function resumirCartera(filas: FilaCartera[]): ResumenCartera {
  const conSaldo = filas.filter(f => Number(f.saldo) > TOLERANCIA_SALDO_COP)

  const detalle: ItemCartera[] = conSaldo
    .map(f => ({
      negocioNombre: f.nombre ?? 'Sin nombre',
      negocioCodigo: f.codigo ?? 'Sin codigo',
      honorario: Number(f.honorario),
      recaudado: Number(f.honorario_recaudado),
      saldo: Number(f.saldo),
      ...vencimientoDeFila(f),
    }))
    .sort((a, b) => compararPorAntiguedad(
      { dias_desde_creacion: a.dias, saldo: a.saldo },
      { dias_desde_creacion: b.dias, saldo: b.saldo },
    ))

  return {
    carteraPendiente: conSaldo.reduce((s, f) => s + Number(f.saldo), 0),
    honorarioAprobado: filas.reduce((s, f) => s + Number(f.honorario), 0),
    honorarioRecaudado: filas.reduce((s, f) => s + Number(f.honorario_recaudado), 0),
    carteraNegocios: conSaldo.length,
    carteraVencida: detalle.reduce((s, d) => s + d.vencido, 0),
    detalle,
  }
}
