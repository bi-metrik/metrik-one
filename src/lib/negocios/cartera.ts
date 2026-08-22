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
 * La fuente es `v_cartera_negocio`; aca solo se agrega y se ordena.
 */

/** Una fila de `v_cartera_negocio`. Los numericos de Postgres llegan como string. */
export interface FilaCartera {
  codigo: string | null
  nombre: string | null
  honorario: number | string
  honorario_recaudado: number | string
  saldo: number | string
  dias: number | null
}

export interface ItemCartera {
  negocioNombre: string
  negocioCodigo: string
  saldo: number
  /** Dias desde que nacio el negocio, no vencimiento de factura: no hay factura. */
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

/** Un saldo se considera vencido pasados estos dias desde que nacio el negocio. */
export const DIAS_CARTERA_VENCIDA = 30

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
      saldo: Number(f.saldo),
      dias: f.dias ?? 0,
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
    carteraVencida: conSaldo
      .filter(f => (f.dias ?? 0) > DIAS_CARTERA_VENCIDA)
      .reduce((s, f) => s + Number(f.saldo), 0),
    detalle,
  }
}
