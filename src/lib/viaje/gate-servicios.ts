/**
 * Gate `servicios_listos` de Reservas y pagos (Max §5, Vera F3-7, Noor etapa 5). Módulo puro: lo
 * usan el avance de etapa en el servidor y el «Sigue:» del tablero, con la misma regla.
 *
 * Una fila que va cuenta cuando está CONFIRMADA (C6): pagada con soporte, medio y titular, sin
 * aprobación pedida ni rechazada abierta y con la confirmación del proveedor final (si la línea la
 * exige). Las «No va» no cuentan. Una fila sin nada que pagarle a un proveedor (costo y valor a
 * pagar en 0, sin pagos: el recargo fijo que F0 trae como «otro») tampoco frena: no hay a quién
 * pagarle ni quién confirme.
 *
 * Lo que falta sale en palabras, máximo 3 líneas y «y N más» (Noor §5).
 */

import { estadoDelServicio, pagadoDelServicio, valorAPagar, type EstadoServicio } from './estado-servicio'
import type { ServicioDelNegocio } from './servicios-viaje-datos'

export const GATE_SERVICIOS_LISTOS = 'servicios_listos'

export const MAX_LINEAS_GATE = 3

type FilaGate = Pick<
  ServicioDelNegocio,
  'id' | 'nombre' | 'estado' | 'costo_cotizado' | 'valor_por_pagar' | 'confirmacion_ref' | 'gastos' | 'aprobaciones'
>

/** Lo que le falta a una fila para contar, en palabras; `null` si ya cuenta o no aplica. */
export function faltaDeLaFila(s: FilaGate, exigeConfirmacion: boolean): string | null {
  const estado: EstadoServicio = estadoDelServicio(s, s.gastos, s.aprobaciones)
  if (estado === 'cancelado') return null
  const aPagar = valorAPagar(s)
  if (aPagar <= 0 && s.gastos.length === 0) return null
  if (estado === 'esperando') return 'esperando a Edgar'
  if (estado === 'no_aprobado') return 'Edgar no aprobó el pago'
  if (estado === 'confirmado') return null
  if (estado === 'pagado') return exigeConfirmacion ? 'falta la confirmación del proveedor final' : null
  // Sin pagar del todo: qué le falta exactamente.
  if (s.gastos.length === 0) return 'falta registrar el pago'
  if (s.gastos.some(g => !g.soporte_url)) return 'falta el soporte de pago'
  if (s.gastos.some(g => !g.medio_pago || !g.titular_medio)) return 'falta el medio de pago'
  const faltan = aPagar - pagadoDelServicio(s.gastos)
  if (faltan > 0) return `falta pagar $${Math.round(faltan).toLocaleString('es-CO').replace(/,/g, '.')}`
  return 'falta registrar el pago'
}

export interface FaltaServicio {
  servicioId: string
  texto: string
}

/** Todas las filas que frenan, en el orden del viaje. */
export function serviciosQueFaltan(filas: readonly FilaGate[], exigeConfirmacion: boolean): FaltaServicio[] {
  const out: FaltaServicio[] = []
  for (const s of filas) {
    const f = faltaDeLaFila(s, exigeConfirmacion)
    if (f) out.push({ servicioId: s.id, texto: `${s.nombre}: ${f}` })
  }
  return out
}

export const TEXTO_SIN_SERVICIOS = 'No hay servicios del viaje registrados.'

/**
 * La regla ÚNICA de `servicios_listos`: la usan el gate, la cabecera del bloque «Servicios del
 * viaje» (Completo/Pendiente) y el punto de color del tablero. Sin ninguna fila que vaya no hay
 * nada listo: un viaje sin servicios no sale de Reservas y pagos (barrido 2026-10-22).
 */
export function faltaParaServiciosListos(filas: readonly FilaGate[], exigeConfirmacion: boolean): FaltaServicio[] {
  if (!filas.some(f => f.estado !== 'cancelado')) return [{ servicioId: '', texto: TEXTO_SIN_SERVICIOS }]
  return serviciosQueFaltan(filas, exigeConfirmacion)
}

/** ¿Pasa el gate? Lo mismo que `faltaParaServiciosListos(...).length === 0`. */
export function serviciosListos(filas: readonly FilaGate[], exigeConfirmacion: boolean): boolean {
  return faltaParaServiciosListos(filas, exigeConfirmacion).length === 0
}

/** Las líneas del gate: máximo 3 y «y N más». */
export function lineasDelGate(faltan: readonly FaltaServicio[]): string[] {
  if (faltan.length === 0) return []
  const lineas = faltan.slice(0, MAX_LINEAS_GATE).map(f => f.texto)
  const resto = faltan.length - MAX_LINEAS_GATE
  if (resto > 0) lineas.push(`y ${resto} más`)
  return lineas
}

/** Encabezado del gate (Noor §5): «Faltan 3 servicios para pasar a Documentos y entrega:». */
export function encabezadoGate(n: number, siguiente: string | null): string {
  const destino = siguiente ? ` para pasar a ${siguiente}` : ''
  return n === 1 ? `Falta 1 servicio${destino}:` : `Faltan ${n} servicios${destino}:`
}
