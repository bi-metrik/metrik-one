/**
 * Lo que la pestaña Consumo muestra, calculado del resumen de Valida. Puro.
 *
 * Valida ya trae `saldo` y `consumidas`; aquí solo se decide QUÉ decir, sobre todo en los bordes:
 * una bolsa sin consultas compradas no tiene porcentaje (no es 0 %), y un cliente de plan mensual
 * no tiene bolsa (no es «bolsa agotada»).
 */

import type { BolsaEnEspera, BolsaHistorial, ResumenValidaApi } from './tipos'

export interface VistaBolsaVigente {
  compradas: number
  consumidas: number
  saldo: number
  /** 0 a 100, redondeado. null cuando no hay consultas compradas: no se inventa un 0 %. */
  porcentajeUsado: number | null
  venceEn: string
  diasParaVencer: number
  estado: 'vigente' | 'agotada' | 'vencida'
  /** La API ya responde 402 con esta bolsa. */
  cortada: boolean
}

export type VistaConsumo =
  | {
      tipo: 'bolsa'
      vigente: VistaBolsaVigente | null
      enEspera: BolsaEnEspera | null
      historial: BolsaHistorial[]
    }
  | { tipo: 'mensual' }
  | { tipo: 'sin_datos' }

export function porcentajeUsado(consumidas: number, compradas: number): number | null {
  if (!Number.isFinite(compradas) || compradas <= 0) return null
  const p = Math.round((consumidas / compradas) * 100)
  return Math.min(100, Math.max(0, p))
}

export function vistaConsumo(resumen: ResumenValidaApi): VistaConsumo {
  const consumo = resumen.consumo
  if (!consumo) return { tipo: 'sin_datos' }
  if (consumo.modalidad === 'mensual') return { tipo: 'mensual' }

  const b = consumo.bolsa
  const vigente: VistaBolsaVigente | null = b
    ? {
        compradas: b.consultas_compradas,
        consumidas: b.consumidas,
        saldo: b.saldo,
        porcentajeUsado: porcentajeUsado(b.consumidas, b.consultas_compradas),
        venceEn: b.vence_en,
        diasParaVencer: b.dias_para_vencer,
        estado: b.estado,
        cortada: b.estado !== 'vigente' || b.bloqueada === true,
      }
    : null

  // El historial más reciente primero, sin la vigente repetida.
  const historial = [...(resumen.bolsas ?? [])]
    .filter((h) => !b || h.bolsa_id !== b.bolsa_id)
    .sort((x, y) => y.secuencia - x.secuencia)

  return { tipo: 'bolsa', vigente, enEspera: resumen.bolsa_en_espera ?? null, historial }
}
