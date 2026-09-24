/**
 * Metas del piloto Marketplace (Dimpro x MeTRIK), escenario realista.
 *
 * Fuente: `proyectos/dimpro/piloto-marketplace/docs/trabajo/metas-tablero-piloto.md`, en el repo
 * metrik (fuera de ONE), fijadas por Mik el 24-sep-2026 por encargo de Mauricio. Salen de
 * volúmenes SUPUESTOS, no medidos, y se recalibran al cierre de octubre con lo medido: por eso
 * viven aquí, en un solo módulo de configuración, y no en la base. Recalibrar = editar este
 * archivo; la lógica de abajo no cambia.
 *
 * El piloto arranca el 1-oct: antes de octubre no hay meta y el tablero muestra los datos solos.
 */

export interface MetaMes {
  /** `YYYY-MM`. */
  mes: string
  /** Ventas PAGADAS en el mes (el mes sale de `fecha_primer_pago`). */
  ventas: number
  /** Ganancia del mes, línea completa, antes del reparto 50/50. */
  ganancia: number
  conversaciones: number
  /** Piso de publicaciones activas. */
  activasPiso: number
}

export const METAS_MENSUALES: readonly MetaMes[] = [
  { mes: '2026-10', ventas: 10, ganancia: 195_581, conversaciones: 90, activasPiso: 47 },
  { mes: '2026-11', ventas: 21, ganancia: 821_640, conversaciones: 188, activasPiso: 52 },
  { mes: '2026-12', ventas: 32, ganancia: 1_447_699, conversaciones: 286, activasPiso: 52 },
]

export const META_TOTAL_PILOTO = { ventas: 63, ganancia: 2_464_920 } as const

/** Tasas de diagnóstico, no metas de volumen. `null` = todavía sin meta. */
export const TASAS_META = {
  /** Conversación a venta (tasa del embudo de Santiago). */
  conversacionAVenta: 0.112,
  /** Clic a conversación: sin meta. Los clics de Marketplace subcuentan; se fija al cierre de octubre. */
  clicAConversacion: null as number | null,
} as const

export const TEXTO_SIN_META_CLIC_CONVERSACION = 'Meta se fija al cierre de octubre'

/** Bajo esta tasa, con al menos `CONVERSACIONES_MINIMAS_DIAGNOSTICO`, el problema es el cierre. */
export const TASA_ALARMA_CIERRE = 0.05
export const CONVERSACIONES_MINIMAS_DIAGNOSTICO = 30
export const TEXTO_ALARMA_CIERRE = 'El problema es el cierre, no el alcance.'

/** Piso de alarma del escenario pesimista: ventas de octubre al cerrar el mes. */
export const PISO_ALARMA_OCTUBRE = { mes: '2026-10', ventas: 3 } as const
export const TEXTO_PISO_ALARMA = 'El piloto no está midiendo nada.'

/** Umbrales del semáforo de ritmo (acumulado / meta prorrateada a hoy). */
export const RITMO_VERDE = 0.9
export const RITMO_AMARILLO = 0.6

// ── Lógica ────────────────────────────────────────────────────────────────────────────

export function metaDelMes(mes: string): MetaMes | null {
  return METAS_MENSUALES.find((m) => m.mes === mes) ?? null
}

export function diasDelMes(mes: string): number {
  const [a, m] = mes.split('-').map(Number)
  return new Date(Date.UTC(a, m, 0)).getUTCDate()
}

/** Meta del mes prorrateada hasta el día `dia` (1..días del mes), en línea recta. */
export function metaProrrateada(metaMes: number, mes: string, dia: number): number {
  return (metaMes * dia) / diasDelMes(mes)
}

export type Semaforo = 'verde' | 'amarillo' | 'rojo'

/** `null` si no hay meta con qué comparar (meta prorrateada en cero). */
export function semaforoRitmo(acumulado: number, metaAHoy: number): { semaforo: Semaforo; ritmo: number } | null {
  if (!(metaAHoy > 0)) return null
  const ritmo = acumulado / metaAHoy
  const semaforo: Semaforo = ritmo >= RITMO_VERDE ? 'verde' : ritmo >= RITMO_AMARILLO ? 'amarillo' : 'rojo'
  return { semaforo, ritmo }
}

/** ¿Se enciende el aviso "el problema es el cierre"? */
export function alarmaCierre(conversaciones: number, ventas: number): boolean {
  if (conversaciones < CONVERSACIONES_MINIMAS_DIAGNOSTICO) return false
  return ventas / conversaciones < TASA_ALARMA_CIERRE
}

/** ¿Se enciende el piso de alarma de octubre? Solo con el mes ya cerrado. */
export function alarmaPisoOctubre(ventasOctubre: number, hoy: string): boolean {
  return hoy.slice(0, 7) > PISO_ALARMA_OCTUBRE.mes && ventasOctubre < PISO_ALARMA_OCTUBRE.ventas
}
