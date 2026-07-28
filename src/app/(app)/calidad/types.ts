/**
 * Tipos del modulo de calidad de llamadas.
 *
 * Dos ejes que NO se promedian y que el tipo mantiene separados a proposito:
 *   - tecnica:      `puntaje_tecnico` 0-100, desglosado en `bloques`.
 *   - cumplimiento: `semaforo` + `banderas`.
 * Una llamada de 81 de tecnica puede estar en rojo. Fundirlos en un solo numero
 * borraria justamente lo que la muestra quiere hacer ver.
 */

export type Semaforo = 'verde' | 'amarillo' | 'rojo'
export type Severidad = 'critica' | 'alta' | 'media'
export type Direccion = 'entrante' | 'saliente'

export interface LlamadaResumen {
  id: string
  /** Identificador opaco. La tabla no guarda el nombre del cliente final. */
  clienteRef: string
  fechaHora: string
  direccion: Direccion
  duracionSeg: number
  agenteNombre: string
  puntajeTecnico: number
  semaforo: Semaforo
  /** true = tiene transcripcion auditada → hay pantalla de detalle. */
  detalleCompleto: boolean
  /** false = dato de demostracion. Se rotula de forma permanente. */
  esReal: boolean
  /** Codigos de bandera de la llamada, ordenados: C1 C2 C4… */
  codigos: string[]
  criticas: number
}

export interface BloqueTecnica {
  orden: number
  nombre: string
  puntaje: number
  puntajeMax: number
}

export interface Hallazgo {
  id: string
  codigo: string
  severidad: Severidad
  titulo: string
  hecho: string | null
  cita: string | null
  segundo: number
  turnoRef: string | null
}

/** Punto de la cinta temporal que no levanta bandera. */
export interface EventoCinta {
  id: string
  titulo: string
  segundo: number
}

export interface LlamadaDetalle extends LlamadaResumen {
  hablaAgentePct: number | null
  hablaClientePct: number | null
  turnos: number | null
  repreguntas: number | null
  monologos45s: number | null
  bloques: BloqueTecnica[]
  banderas: Hallazgo[]
  eventos: EventoCinta[]
}

export interface MuroData {
  fecha: string
  cobertura: {
    recibidas: number
    auditadas: number
    baseline: number
    pct: number
    pctBaseline: number
  } | null
  ultimas: {
    hora: string
    /** Nombre de pila unicamente: el muro es publico por enlace. */
    agente: string
    duracion: number
    tecnica: number
    semaforo: Semaforo
  }[]
  semaforos: { verde: number; amarillo: number; rojo: number; total: number } | null
  banderaTop: { codigo: string; titulo: string; veces: number } | null
}

export interface DineroCuota {
  cuota: number
  ventas: number
  vendidoUsd: number
  recaudadoUsd: number
}

export interface DuenoData {
  cuotas: DineroCuota[]
  vendidoTotal: number
  recaudadoTotal: number
  recaudoPct: number
  ventasCerradas: number
  llegaronCuota6: number
  criticasAbiertas: { codigo: string; titulo: string; veces: number }[]
}

/**
 * Disclaimer obligatorio en toda pieza que muestre banderas. Fijado por el memo
 * legal de Emilio (2026-07-27): MeTRIK entrega observaciones sobre hechos
 * verificables en la grabacion, no dictamina derecho estadounidense.
 */
export const DISCLAIMER_BANDERAS =
  'Observaciones sobre hechos registrados en la grabación. No constituyen concepto jurídico sobre normativa de Estados Unidos.'

export const SEVERIDAD_LABEL: Record<Severidad, string> = {
  critica: 'Crítica',
  alta: 'Alta',
  media: 'Media',
}

export const SEMAFORO_LABEL: Record<Semaforo, string> = {
  verde: 'Verde',
  amarillo: 'Amarillo',
  rojo: 'Rojo',
}

/** mm:ss a partir de segundos. 3914 → "65:14". */
export function mmss(segundos: number): string {
  const m = Math.floor(segundos / 60)
  const s = segundos % 60
  return `${m}:${String(s).padStart(2, '0')}`
}
