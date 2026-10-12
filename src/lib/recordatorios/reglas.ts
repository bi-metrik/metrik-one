/**
 * Reglas y calendario del motor de recordatorios hacia atrás (post-cotización, PR 4).
 *
 * Puro: sin base ni red. Lo usan el cron (`/api/crons/recordatorios`) y las pruebas.
 *
 * Una regla dice «a N días de ESTA fecha, avísale a ESTOS por ESTE canal». La fecha la pone una
 * fuente (`fuentes.ts`): el envío de la cotización, la fecha límite de pago de un servicio, etc.
 * El desfase lleva signo: −3 = tres días antes, +1 = un día después.
 *
 * Día no hábil (diseño técnico §4.2, Vera §7.7):
 *   · desfase negativo → se ADELANTA al día hábil anterior: nunca se avisa tarde de un pago;
 *   · cero o positivo → se CORRE al siguiente día hábil;
 *   · `dias: 'habiles'` cuenta días hábiles desde la fecha (los toques: «1, 3 y 7 días hábiles»).
 *
 * Interruptor: `lineas_negocio.config_extra.recordatorios.activo === true`. Ausente o cualquier
 * otro valor = apagado = la línea no tiene recordatorios (como hoy).
 */

import { esDiaHabil } from '@/lib/dates/dias-habiles'

/** Fuentes que el motor sabe leer hoy. Las de cuota, salida y regreso llegan con F2-F6. */
export const FUENTES_SOPORTADAS = ['envio', 'pago_proveedor'] as const
export type FuenteRecordatorio = (typeof FUENTES_SOPORTADAS)[number]

/** Canales que el motor manda hoy. `email` y `wa_manual` llegan con los avisos al viajero (F2). */
export const CANALES_SOPORTADOS = ['in_app'] as const
export type CanalRecordatorio = 'in_app' | 'email' | 'wa_manual'

/** `responsable` · `aprobadores` · `area:<comercial|operaciones|financiera>` · `cliente`. */
export type Destino = string

export interface ReglaRecordatorio {
  id: string
  fuente: FuenteRecordatorio
  /** Días con signo respecto a la fecha de la fuente. */
  offset: number
  dias: 'calendario' | 'habiles'
  /** Solo mientras el negocio esté en la etapa con este número (los toques de Seguimiento). */
  etapa_numero: number | null
  a: Destino[]
  canales: CanalRecordatorio[]
}

/**
 * Las reglas que trae una línea que enciende el motor sin escribir las suyas. Solo las de las
 * fuentes que existen hoy (diseño técnico §4.2): toques de Seguimiento y pago a proveedor.
 *
 * Los toques cuentan desde el envío en días hábiles y solo mientras el negocio siga en la etapa 3
 * (Seguimiento en el mapa nuevo de 9 etapas). Una línea con otra numeración declara sus reglas.
 */
export const REGLAS_POR_DEFECTO: readonly ReglaRecordatorio[] = [
  { id: 'prov_t3', fuente: 'pago_proveedor', offset: -3, dias: 'calendario', etapa_numero: null, a: ['area:operaciones'], canales: ['in_app', 'email'] },
  { id: 'prov_t0', fuente: 'pago_proveedor', offset: 0, dias: 'calendario', etapa_numero: null, a: ['area:operaciones'], canales: ['in_app', 'email'] },
  { id: 'prov_vencido', fuente: 'pago_proveedor', offset: 1, dias: 'calendario', etapa_numero: null, a: ['aprobadores'], canales: ['in_app', 'email'] },
  { id: 'toque_1', fuente: 'envio', offset: 1, dias: 'habiles', etapa_numero: 3, a: ['responsable'], canales: ['in_app'] },
  { id: 'toque_3', fuente: 'envio', offset: 3, dias: 'habiles', etapa_numero: 3, a: ['responsable'], canales: ['in_app'] },
  { id: 'toque_7', fuente: 'envio', offset: 7, dias: 'habiles', etapa_numero: 3, a: ['responsable'], canales: ['in_app'] },
]

/**
 * Cuántos días atrás se recupera un aviso que no salió el día que tocaba (cron caído, deploy a
 * esa hora). Cubre un fin de semana largo; más atrás, el aviso ya no sirve y no se manda.
 */
export const VENTANA_RECUPERACION_DIAS = 4

/** Intentos por aviso fallido antes de rendirse (Vera §7.7). */
export const MAX_INTENTOS = 3

const DIA_MS = 86_400_000
const msDe = (f: string) => Date.parse(`${f.slice(0, 10)}T00:00:00Z`)
const isoDe = (ms: number) => new Date(ms).toISOString().slice(0, 10)

export function sumarDias(fechaISO: string, dias: number): string {
  return isoDe(msDe(fechaISO) + dias * DIA_MS)
}

/** Días calendario de `a` a `b` (b − a). */
export function diasEntre(a: string, b: string): number {
  return Math.round((msDe(b) - msDe(a)) / DIA_MS)
}

/** El día hábil en o antes de la fecha (con `incluirMismoDia = false`, estrictamente antes). */
export function anteriorDiaHabil(fechaISO: string, pais?: string | null, incluirMismoDia = true): string {
  let ms = msDe(fechaISO) - (incluirMismoDia ? 0 : DIA_MS)
  for (let i = 0; i < 31; i++) {
    const f = isoDe(ms)
    if (esDiaHabil(f, pais)) return f
    ms -= DIA_MS
  }
  throw new Error(`sin dia habil en 31 dias antes de ${fechaISO}`)
}

function siguienteHabil(fechaISO: string, pais?: string | null): string {
  let ms = msDe(fechaISO)
  for (let i = 0; i < 31; i++) {
    const f = isoDe(ms)
    if (esDiaHabil(f, pais)) return f
    ms += DIA_MS
  }
  throw new Error(`sin dia habil en 31 dias desde ${fechaISO}`)
}

/** N días hábiles después (N > 0) o antes (N < 0) de la fecha. Con 0, la fecha si es hábil o la siguiente. */
export function sumarDiasHabiles(fechaISO: string, n: number, pais?: string | null): string {
  if (n === 0) return siguienteHabil(fechaISO, pais)
  const paso = n > 0 ? 1 : -1
  let f = fechaISO.slice(0, 10)
  let faltan = Math.abs(n)
  while (faltan > 0) {
    f = sumarDias(f, paso)
    if (esDiaHabil(f, pais)) faltan--
  }
  return f
}

/** El día en que sale el aviso de una regla para una fecha objetivo. Siempre es día hábil. */
export function fechaDeDisparo(regla: Pick<ReglaRecordatorio, 'offset' | 'dias'>, fechaObjetivo: string, pais?: string | null): string {
  if (regla.dias === 'habiles') return sumarDiasHabiles(fechaObjetivo, regla.offset, pais)
  const bruta = sumarDias(fechaObjetivo, regla.offset)
  return regla.offset < 0 ? anteriorDiaHabil(bruta, pais) : siguienteHabil(bruta, pais)
}

/**
 * ¿Toca mandar hoy? Sale el día de disparo, o hasta `VENTANA_RECUPERACION_DIAS` después si no
 * salió (la llave única del log evita el repetido). Nunca antes, y nunca en día no hábil.
 */
export function tocaHoy(disparo: string, hoy: string, pais?: string | null): boolean {
  if (!esDiaHabil(hoy, pais)) return false
  const atraso = diasEntre(disparo, hoy)
  return atraso >= 0 && atraso <= VENTANA_RECUPERACION_DIAS
}

function esFuente(v: unknown): v is FuenteRecordatorio {
  return typeof v === 'string' && (FUENTES_SOPORTADAS as readonly string[]).includes(v)
}

const CANALES: readonly string[] = ['in_app', 'email', 'wa_manual']

/** Lee una regla de la configuración; `null` si no se entiende (una regla mal escrita no se adivina). */
export function leerRegla(raw: unknown): ReglaRecordatorio | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const id = typeof r.id === 'string' ? r.id.trim() : ''
  if (!id || id.length > 60) return null
  if (!esFuente(r.fuente)) return null
  if (typeof r.offset !== 'number' || !Number.isInteger(r.offset) || Math.abs(r.offset) > 365) return null
  const a = Array.isArray(r.a) ? r.a.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : []
  const canales = Array.isArray(r.canales)
    ? r.canales.filter((x): x is CanalRecordatorio => typeof x === 'string' && CANALES.includes(x))
    : []
  if (a.length === 0 || canales.length === 0) return null
  const etapa = typeof r.etapa_numero === 'number' && Number.isInteger(r.etapa_numero) ? r.etapa_numero : null
  return {
    id,
    fuente: r.fuente,
    offset: r.offset,
    dias: r.dias === 'habiles' ? 'habiles' : 'calendario',
    etapa_numero: etapa,
    a,
    canales,
  }
}

export interface ConfigRecordatorios {
  activo: boolean
  reglas: ReglaRecordatorio[]
  /** Reglas de la configuración que no se entendieron (se reportan, no se adivinan). */
  descartadas: number
}

/** Lee `config_extra.recordatorios` de una línea. Sin `reglas` propias, las de por defecto. */
export function configDeLinea(configExtra: unknown): ConfigRecordatorios {
  const raw = (configExtra && typeof configExtra === 'object'
    ? (configExtra as Record<string, unknown>).recordatorios
    : null) as Record<string, unknown> | null | undefined
  const activo = !!raw && typeof raw === 'object' && raw.activo === true
  if (!activo) return { activo: false, reglas: [], descartadas: 0 }
  if (!Array.isArray(raw.reglas)) return { activo, reglas: [...REGLAS_POR_DEFECTO], descartadas: 0 }
  const reglas: ReglaRecordatorio[] = []
  let descartadas = 0
  const vistos = new Set<string>()
  for (const r of raw.reglas) {
    const regla = leerRegla(r)
    // Una regla de una fuente que el motor aún no lee (cuota, salida…) no es error: se salta.
    if (!regla) {
      const fuente = (r as Record<string, unknown> | null)?.fuente
      if (!(typeof fuente === 'string' && !esFuente(fuente))) descartadas++
      continue
    }
    if (vistos.has(regla.id)) { descartadas++; continue }
    vistos.add(regla.id)
    reglas.push(regla)
  }
  return { activo, reglas, descartadas }
}

/** Aprobadores de la línea (`config_extra.aprobaciones.staff_ids`): Edgar por defecto en Trappvel (D8). */
export function aprobadoresDeConfig(configExtra: unknown): string[] {
  const ap = (configExtra as Record<string, unknown> | null)?.aprobaciones as Record<string, unknown> | undefined
  const ids = Array.isArray(ap?.staff_ids) ? ap.staff_ids : []
  return ids.filter((x): x is string => typeof x === 'string' && x.length > 0)
}
