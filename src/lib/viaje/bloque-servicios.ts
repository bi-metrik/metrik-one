/**
 * Lo que el bloque «Servicios del viaje» pinta, calculado sin React (lo prueban las pruebas
 * puras). Módulo puro: lo usan el servidor (tipo de los datos) y el navegador.
 *
 * Copy literal de Noor (`noor-hana-diseno-post-cotizacion-2026-10-12.md` §3 y §8).
 */

import type { ServicioDelNegocio } from './servicios-viaje-datos'
import { estadoDelServicio, pagadoDelServicio, valorAPagar, type EstadoServicio, type QuienEdita } from './estado-servicio'

/** Lo que el servidor deja en `config_extra._servicios` del bloque. */
export interface DatosBloqueServicios {
  /** `servicios_viaje.activo` de la línea. Apagado: se ve, no se edita. */
  activo: boolean
  hayCotizacionAceptada: boolean
  filas: ServicioDelNegocio[]
  /** Quién mira, sin la responsabilidad: esa la sabe la ficha (`_esResponsable`). */
  quien: Omit<QuienEdita, 'esResponsable'>
}

export type ColorFecha = 'verde' | 'ambar' | 'rojo'

const MS_DIA = 24 * 60 * 60 * 1000

function diasEntre(desde: string, hasta: string): number {
  return Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / MS_DIA)
}

/**
 * Fecha límite en palabras y color (Noor §3.2): verde a más de 3 días, ámbar a 3 o menos, rojo
 * vencida. Una fila pagada, confirmada o que no va no muestra fecha límite.
 */
export function fechaLimiteEnPalabras(
  fecha: string | null,
  estado: EstadoServicio,
  hoy: string,
): { texto: string; color: ColorFecha } | null {
  if (!fecha || estado === 'pagado' || estado === 'confirmado' || estado === 'cancelado') return null
  const d = diasEntre(hoy, fecha)
  const dia = new Date(`${fecha}T12:00:00Z`).toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
  if (d < 0) {
    return { texto: d === -1 ? 'Venció ayer sin pagar' : `Venció hace ${-d} días sin pagar`, color: 'rojo' }
  }
  if (d === 0) return { texto: 'Vence hoy', color: 'ambar' }
  if (d <= 3) return { texto: `Paga antes del ${dia} (en ${d} ${d === 1 ? 'día' : 'días'})`, color: 'ambar' }
  return { texto: `Paga antes del ${dia}`, color: 'verde' }
}

export interface FilaVista {
  servicio: ServicioDelNegocio
  estado: EstadoServicio
  pagado: number
  aPagar: number
  /** Desviación hacia arriba (Vera C5): pagado − a pagar, solo si es positiva. */
  sobrecosto: number
}

export function filasVista(filas: readonly ServicioDelNegocio[]): FilaVista[] {
  return filas.map(s => {
    const pagado = pagadoDelServicio(s.gastos)
    const aPagar = valorAPagar(s)
    return {
      servicio: s,
      estado: estadoDelServicio(s, s.gastos, s.aprobaciones),
      pagado,
      aPagar,
      sobrecosto: Math.max(0, pagado - s.costo_cotizado),
    }
  })
}

/** «{n} servicios · {n} confirmados · {n} esperando a Edgar · {n} pago vencido» (Noor §8). */
export function resumenDelTablero(vista: readonly FilaVista[], hoy: string): string {
  const vivas = vista.filter(v => v.estado !== 'cancelado')
  const partes = [`${vivas.length} ${vivas.length === 1 ? 'servicio' : 'servicios'}`]
  const confirmados = vivas.filter(v => v.estado === 'confirmado').length
  if (confirmados > 0) partes.push(`${confirmados} ${confirmados === 1 ? 'confirmado' : 'confirmados'}`)
  const esperando = vivas.filter(v => v.estado === 'esperando').length
  if (esperando > 0) partes.push(`${esperando} esperando a Edgar`)
  const vencidos = vivas.filter(v => fechaLimiteEnPalabras(v.servicio.fecha_limite_pago, v.estado, hoy)?.color === 'rojo').length
  if (vencidos > 0) partes.push(`${vencidos} ${vencidos === 1 ? 'pago vencido' : 'pagos vencidos'}`)
  return partes.join(' · ')
}

/** Costo cotizado y costo real hasta hoy de las filas que van (las «No va» no cuentan). */
export function totalesDelTablero(vista: readonly FilaVista[]): { cotizado: number; pagado: number } {
  const vivas = vista.filter(v => v.estado !== 'cancelado')
  return {
    cotizado: vivas.reduce((s, v) => s + v.servicio.costo_cotizado, 0),
    pagado: vista.reduce((s, v) => s + v.pagado, 0),
  }
}
