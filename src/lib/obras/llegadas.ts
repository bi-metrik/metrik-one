/**
 * Llegadas a la obra que la oficina agrega o corrige en la web (C7, canal `app`).
 *
 * La base guarda la marca (colaborador, obra, día de Bogotá, hora) y el trigger
 * `llegadas_obra_guardar` hace cumplir las invariantes: colaborador y obra del workspace, máximo
 * dos obras distintas por día y el valor de la jornada vigente copiado. El reparto (completa o
 * media) lo calcula `v_jornadas_dia`; aquí no se calcula nada.
 *
 * En la web la hora la pone la oficina (es una corrección); por WhatsApp es la del mensaje.
 */
import { todayBogotaISO } from '@/lib/dates/bogota'

export interface JornadaDia {
  id: string
  collaborator_id: string
  colaborador: string
  negocio_id: string
  fecha: string
  hora: string
  valor_jornada: number | null
  fraccion: number
  costo: number | null
}

export const COLUMNAS_JORNADA = 'id, collaborator_id, colaborador, negocio_id, fecha, hora, valor_jornada, fraccion, costo'

export function normalizarJornada(f: Record<string, unknown>): JornadaDia {
  const valor = f.valor_jornada === null || f.valor_jornada === undefined ? null : Number(f.valor_jornada)
  const costo = f.costo === null || f.costo === undefined ? null : Number(f.costo)
  return {
    id: String(f.id ?? ''),
    collaborator_id: String(f.collaborator_id ?? ''),
    colaborador: String(f.colaborador ?? ''),
    negocio_id: String(f.negocio_id ?? ''),
    fecha: String(f.fecha ?? ''),
    hora: String(f.hora ?? ''),
    valor_jornada: valor !== null && Number.isFinite(valor) ? valor : null,
    fraccion: Number(f.fraccion ?? 1) || 1,
    costo: costo !== null && Number.isFinite(costo) ? costo : null,
  }
}

/** `Completa` o `Media` (las dos únicas fracciones del Anexo 2.3). */
export function textoFraccion(fraccion: number): string {
  return fraccion < 1 ? 'Media' : 'Completa'
}

export interface DatosLlegada {
  collaborator_id: string
  negocio_id: string
  fecha: string
  /** Instante con la zona de Bogotá: `2026-10-21T07:12:00-05:00`. */
  hora: string
}

type Resultado<T> = { ok: true; datos: T } | { ok: false; error: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const FECHA = /^\d{4}-\d{2}-\d{2}$/
const HORA = /^([01]\d|2[0-3]):([0-5]\d)$/

/** El instante de la llegada a partir del día y la hora de Bogotá (Colombia no tiene horario de verano). */
export function horaDeLlegada(fecha: string, hhmm: string): string {
  return `${fecha}T${hhmm}:00-05:00`
}

export function validarLlegada(entrada: unknown, hoy: string = todayBogotaISO()): Resultado<DatosLlegada> {
  const e = (entrada ?? {}) as Record<string, unknown>
  const colaborador = typeof e.collaborator_id === 'string' ? e.collaborator_id : ''
  if (!UUID.test(colaborador)) return { ok: false, error: 'Elige quién llegó.' }
  const negocio = typeof e.negocio_id === 'string' ? e.negocio_id : ''
  if (!UUID.test(negocio)) return { ok: false, error: 'Elige la obra.' }
  const fecha = typeof e.fecha === 'string' ? e.fecha.trim() : ''
  if (!FECHA.test(fecha)) return { ok: false, error: 'El día no es válido.' }
  if (fecha > hoy) return { ok: false, error: 'No se puede registrar una llegada de un día que no ha pasado.' }
  const hhmm = typeof e.hora === 'string' ? e.hora.trim().slice(0, 5) : ''
  if (!HORA.test(hhmm)) return { ok: false, error: 'Escribe la hora de llegada.' }
  return { ok: true, datos: { collaborator_id: colaborador, negocio_id: negocio, fecha, hora: horaDeLlegada(fecha, hhmm) } }
}

/**
 * El error de la base, en palabras de la oficina. El tope de dos obras por día y la llegada
 * repetida los pone la base (trigger e índice único), no esta pantalla.
 */
export function mensajeErrorLlegada(err: { code?: string | null; message?: string | null } | null | undefined): string {
  const msg = err?.message ?? ''
  if (/dos obras ese d[ií]a/i.test(msg)) {
    return 'Ese día ya tiene llegadas en dos obras distintas: la jornada es completa o media. Borra o cambia una de esas llegadas antes de agregar otra.'
  }
  if (err?.code === '23505') return 'Esa persona ya tiene una llegada a esta obra ese día. Corrige la que existe.'
  if (/colaborador no es de este workspace/i.test(msg)) return 'Ese colaborador no es de este espacio.'
  if (/obra no es de este workspace/i.test(msg)) return 'Esa obra no es de este espacio.'
  return 'No se pudo guardar la llegada. Vuelve a intentarlo.'
}
