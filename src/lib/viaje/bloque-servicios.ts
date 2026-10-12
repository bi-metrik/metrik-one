/**
 * Lo que el bloque «Servicios del viaje» pinta, calculado sin React (lo prueban las pruebas
 * puras). Módulo puro: lo usan el servidor (tipo de los datos) y el navegador.
 *
 * Copy literal de Noor (`noor-hana-diseno-post-cotizacion-2026-10-12.md` §3 y §8).
 */

import type { ServicioDelNegocio } from './servicios-viaje-datos'
import { estadoDelServicio, pagadoDelServicio, valorAPagar, type EstadoServicio, type QuienEdita } from './estado-servicio'
import type { ConfigReglasPago, MedioPagoProveedor } from './reglas-pago'

/** Lo que el servidor deja en `config_extra._servicios` del bloque. */
export interface DatosBloqueServicios {
  /** `servicios_viaje.activo` de la línea. Apagado: se ve, no se edita. */
  activo: boolean
  hayCotizacionAceptada: boolean
  filas: ServicioDelNegocio[]
  /** Quién mira, sin la responsabilidad: esa la sabe la ficha (`_esResponsable`). */
  quien: Omit<QuienEdita, 'esResponsable'>
  /** F3: medios de pago del espacio (`workspaces.config_extra.medios_pago_proveedor`). */
  medios?: MedioPagoProveedor[]
  /** F3: umbral, piso, abono mínimo y si se exige la confirmación (de la línea). */
  reglas?: ConfigReglasPago
  /** F3: cobrado confirmado al cliente y precio aprobado (para «sin abono» en vivo). */
  cobradoCliente?: number
  precioAprobado?: number
  /** F3: nombre de quien pidió cada aprobación (staff id → nombre). */
  nombres?: Record<string, string>
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

// ── F3: tablero de Reservas y pagos ──────────────────────────────────────────

/** «% pagado con tarjetas personales» (Noor §5): sobre todo lo pagado a proveedores del viaje. */
export function porcentajePersonal(vista: readonly FilaVista[]): number {
  let total = 0
  let personal = 0
  for (const v of vista) {
    for (const g of v.servicio.gastos) {
      const m = Number(g.monto) || 0
      total += m
      if (g.titular_medio === 'personal') personal += m
    }
  }
  return total > 0 ? Math.round((personal / total) * 1000) / 10 : 0
}

export type FiltroTablero = 'todos' | 'por_pagar' | 'esperando' | 'falta_confirmar'

export const ETIQUETA_FILTRO: Record<FiltroTablero, string> = {
  todos: 'Todos',
  por_pagar: 'Por pagar',
  esperando: 'Esperando a Edgar',
  falta_confirmar: 'Falta confirmar',
}

/** Píldoras de filtro (Noor §5): Todos · Por pagar · Esperando a Edgar · Falta confirmar. */
export function filtrarTablero(vista: readonly FilaVista[], filtro: FiltroTablero): FilaVista[] {
  switch (filtro) {
    case 'todos':
      return [...vista]
    case 'por_pagar':
      return vista.filter(v => v.estado === 'por_reservar' || v.estado === 'reservado')
    case 'esperando':
      return vista.filter(v => v.estado === 'esperando' || v.estado === 'no_aprobado')
    case 'falta_confirmar':
      return vista.filter(v => v.estado === 'pagado')
  }
}

/** Color de la etapa (Noor §5): rojo con un pago vencido, ámbar si algo vence en 3 días, verde si todo va. */
export function colorDeLaEtapa(vista: readonly FilaVista[], hoy: string): ColorFecha {
  let ambar = false
  for (const v of vista) {
    const f = fechaLimiteEnPalabras(v.servicio.fecha_limite_pago, v.estado, hoy)
    if (f?.color === 'rojo') return 'rojo'
    if (f?.color === 'ambar') ambar = true
  }
  return ambar ? 'ambar' : 'verde'
}

/**
 * «Sigue:» del tablero (Noor §5): el pago más urgente; si nada urge, lo siguiente por hacer.
 * `null` cuando todo lo que va está confirmado.
 */
export function sigueDelTablero(vista: readonly FilaVista[], hoy: string): { servicioId: string; texto: string } | null {
  const vivas = vista.filter(v => v.estado !== 'cancelado')
  const conFecha = vivas
    .map(v => ({ v, f: fechaLimiteEnPalabras(v.servicio.fecha_limite_pago, v.estado, hoy) }))
    .filter((x): x is { v: FilaVista; f: { texto: string; color: ColorFecha } } => !!x.f)
    .sort((a, b) => (a.v.servicio.fecha_limite_pago ?? '').localeCompare(b.v.servicio.fecha_limite_pago ?? ''))
  const vencida = conFecha.find(x => x.f.color === 'rojo')
  if (vencida) return { servicioId: vencida.v.servicio.id, texto: `${vencida.v.servicio.nombre}: ${minuscula(vencida.f.texto)}.` }
  const pronto = conFecha.find(x => x.f.color === 'ambar')
  if (pronto) return { servicioId: pronto.v.servicio.id, texto: `${pronto.v.servicio.nombre}: ${minuscula(pronto.f.texto)}.` }
  const esperando = vivas.find(v => v.estado === 'esperando')
  if (esperando) return { servicioId: esperando.servicio.id, texto: `${esperando.servicio.nombre} está esperando a Edgar.` }
  const porReservar = vivas.find(v => v.estado === 'por_reservar' && v.aPagar > 0)
  if (porReservar) return { servicioId: porReservar.servicio.id, texto: `Reserva ${porReservar.servicio.nombre}.` }
  const porPagar = vivas.find(v => v.estado === 'reservado' && v.aPagar > 0)
  if (porPagar) return { servicioId: porPagar.servicio.id, texto: `Registra el pago de ${porPagar.servicio.nombre}.` }
  const sinConfirmar = vivas.find(v => v.estado === 'pagado')
  if (sinConfirmar) return { servicioId: sinConfirmar.servicio.id, texto: `Adjunta la confirmación del proveedor final de ${sinConfirmar.servicio.nombre}.` }
  return null
}

function minuscula(t: string): string {
  return t.charAt(0).toLowerCase() + t.slice(1)
}
