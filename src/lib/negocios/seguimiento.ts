/**
 * F1 · Seguimiento (post-cotización, PR 5). Lo puro: configuración de la línea, motivos de
 * pérdida, origen de una versión y canal de envío.
 *
 * Interruptor: `lineas_negocio.config_extra.seguimiento.activo === true`. Apagado (ausente), el
 * envío, la pérdida, el aplazamiento y el duplicado hacen exactamente lo de hoy (Vera §7.1.6).
 *
 * Plazo del aplazamiento: `config_extra.pausa.max_dias` de la línea (P6 de Edgar: 60 días en
 * Trappvel). Sin el dato, 14 (`MAX_DIAS_PAUSA`), como hoy. Es independiente del interruptor:
 * una línea puede alargar la pausa sin encender nada más.
 */

import { MAX_DIAS_PAUSA, RAZONES_PERDIDA_NEGOCIO } from './constants'

export interface MotivoPerdida {
  /** Uno de los `value` globales de `RAZONES_PERDIDA_NEGOCIO`: los reportes no se rompen. */
  value: string
  label: string
}

/**
 * Los cinco de Noor (Vera C10), cada uno sobre un `value` global que ya existe: «Precio» →
 * precio, «Se fue con otra agencia» → competencia, «Cambió de planes» → timing, «No respondió» →
 * no_responde, «Otro» → otro.
 */
export const MOTIVOS_PERDIDA_SEGUIMIENTO: readonly MotivoPerdida[] = [
  { value: 'precio', label: 'Precio' },
  { value: 'competencia', label: 'Se fue con otra agencia' },
  { value: 'timing', label: 'Cambió de planes' },
  { value: 'no_responde', label: 'No respondió' },
  { value: 'otro', label: 'Otro' },
]

/** De dónde salió una versión nueva de la cotización (F1-3). La prerreserva vencida la pone el sistema (C9). */
export const ORIGENES_VERSION = [
  { value: 'cliente', label: 'La pidió el cliente' },
  { value: 'direccion', label: 'La pidió dirección' },
  { value: 'proveedor', label: 'Cambió el proveedor' },
  { value: 'prerreserva_vencida', label: 'Venció la prerreserva' },
] as const
export type OrigenVersion = (typeof ORIGENES_VERSION)[number]['value']

export function esOrigenVersion(v: unknown): v is OrigenVersion {
  return typeof v === 'string' && ORIGENES_VERSION.some((o) => o.value === v)
}

/** Cómo salió la cotización. «descargado» = PDF descargado desde «Revisar y enviar» (Vera C3). */
export type CanalEnvio = 'enviar' | 'descargado' | 'aprobada'

export const ETIQUETA_CANAL: Record<CanalEnvio, string> = {
  enviar: 'con «Enviar»',
  descargado: 'descargando el PDF',
  aprobada: 'al aprobarla',
}

export interface ConfigSeguimiento {
  activo: boolean
  motivosPerdida: MotivoPerdida[]
  maxDiasAplazar: number
}

function objeto(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

/** Días máximos de una pausa en la línea (`config_extra.pausa.max_dias`, entero 1-365). */
export function maxDiasPausaDeLinea(configExtra: unknown): number {
  const n = objeto(objeto(configExtra)?.pausa)?.max_dias
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 365 ? n : MAX_DIAS_PAUSA
}

const GLOBALES = new Set<string>(RAZONES_PERDIDA_NEGOCIO.map((r) => r.value))

export function configSeguimiento(configExtra: unknown): ConfigSeguimiento {
  const raw = objeto(objeto(configExtra)?.seguimiento)
  const activo = raw?.activo === true
  let motivos = [...MOTIVOS_PERDIDA_SEGUIMIENTO]
  // La línea puede declarar los suyos, siempre sobre un `value` global (si no, se ignoran).
  if (Array.isArray(raw?.motivos_perdida)) {
    const propios = raw.motivos_perdida
      .map((m) => objeto(m))
      .filter((m): m is Record<string, unknown> => !!m)
      .filter((m) => typeof m.value === 'string' && GLOBALES.has(m.value) && typeof m.label === 'string' && m.label.trim() !== '')
      .map((m) => ({ value: m.value as string, label: (m.label as string).trim() }))
    if (propios.length > 0) motivos = propios
  }
  return { activo, motivosPerdida: motivos, maxDiasAplazar: maxDiasPausaDeLinea(configExtra) }
}

/** Con el seguimiento encendido, «Se perdió» exige uno de los motivos de la línea (F1-4). */
export function motivoPerdidaInvalido(cfg: ConfigSeguimiento, razon: string): string | null {
  if (!cfg.activo) return null
  if (cfg.motivosPerdida.some((m) => m.value === razon)) return null
  return 'Escoge un motivo: con eso sabemos por qué se pierden las ventas.'
}

/** Etiqueta del motivo para la actividad: la de la línea si está encendida, la global si no. */
export function etiquetaMotivoPerdida(cfg: ConfigSeguimiento, razon: string): string {
  if (cfg.activo) {
    const propia = cfg.motivosPerdida.find((m) => m.value === razon)
    if (propia) return propia.label
  }
  return RAZONES_PERDIDA_NEGOCIO.find((r) => r.value === razon)?.label ?? razon
}

/**
 * La versión de una cotización = su posición en la cadena `duplicada_de` (v1 = la original).
 * `padreDe` devuelve el `duplicada_de` de cada id conocido. Una cadena rota o un ciclo cortan
 * la cuenta donde se rompen (tope de 50).
 */
export function versionEnCadena(id: string, padreDe: Map<string, string | null>): number {
  let v = 1
  let actual: string | null | undefined = padreDe.get(id)
  const vistos = new Set([id])
  while (actual && !vistos.has(actual) && v < 50) {
    vistos.add(actual)
    v++
    actual = padreDe.get(actual)
  }
  return v
}

/** Mensaje del gate `cotizacion_enviada` (copy de Noor, §2 etapa 3, sin «gate» ni «bloque»). */
export const MENSAJE_GATE_COTIZACION_ENVIADA =
  'La cotización no se ha enviado desde ONE. Envíala o descárgala desde «Revisar y enviar» para que arranque el seguimiento.'

/** Mensaje del cuarto aplazamiento (Vera C10): el negocio no se pierde solo. */
export function mensajeTopeAplazamientos(maxPausas: number): string {
  return `Ya lo aplazaste ${maxPausas} veces. El negocio sigue abierto: marca si el cliente confirmó o si se perdió.`
}
