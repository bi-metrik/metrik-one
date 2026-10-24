/**
 * Barrido interno de las consultas de AFI que quedaron en error por el tipo de documento.
 *
 * Decisión de Mauricio (2026-10-24): esas ~750 filas ya NO se reprocesan en la cuenta de AFI ni se
 * reescriben. Se consultan por dentro con la cuenta de MéTRIK en Valida («MeTRIK — Consulta de
 * listas», ligada al workspace metrik) y, si sale algo significativo, se le reporta a AFI. Las filas
 * de AFI quedan como están; las consultas viven solo en Valida, a nombre de MéTRIK.
 *
 * Lo puro del script `scripts/valida/barrido-interno-afi.ts`: el cuerpo de cada consulta, la
 * referencia que la ata a la fila de AFI, la corrida con la red inyectada y las líneas que se
 * imprimen (sin nombres ni documentos).
 */

import type { Severidad, ValidaConsultaInput, ValidaResultado } from '@/lib/actions/valida-consultas'
import { esHallazgo, planReproceso, type ConsultaEnError } from './reproceso-tipo-documento'

export const WORKSPACE_AFI = '77ddc3f2-83aa-4a29-aa7f-18a6f6196c5b'
/** El workspace de ONE cuya llave de Valida es la del cliente MéTRIK. */
export const WORKSPACE_METRIK = 'a21bfc88-1a60-48c3-afcd-144226aa2392'
/** «MeTRIK — Consulta de listas» en Valida. */
export const CLIENTE_VALIDA_METRIK = 'eb9bb933-f4dc-4edd-8405-3f1b6a87dbda'

/**
 * `referencia_externa` de la consulta en Valida (máx. 128): el id de la fila de AFI en
 * `valida_consultas` de ONE. Con ella se rastrea la fila original y se filtra en
 * `GET /api/v1/consultas?referencia_externa=`.
 */
export function referenciaBarrido(afiId: string): string {
  return `afi-valida-consultas-${afiId}`
}

/** `Idempotency-Key` por fila (1–64 ASCII). Valida la guarda 24 h. */
export function claveIdempotenciaBarrido(afiId: string): string {
  return `metrik-barrido-afi-${afiId}`
}

export type CuerpoBarrido = ValidaConsultaInput & { referencia_externa: string }

export type PlanBarrido =
  | { accion: 'consultar'; tipoOriginal: string | null; tipo: string; inferido: boolean; cuerpo: CuerpoBarrido }
  | { accion: 'aparte'; tipoOriginal: string | null; motivo: string }

/** Qué se hace con una fila de AFI: el tipo se normaliza con la misma función del lote. */
export function planBarrido(c: ConsultaEnError): PlanBarrido {
  const p = planReproceso(c)
  if (p.accion === 'aparte') return { accion: 'aparte', tipoOriginal: c.documento_tipo, motivo: p.motivo }
  return {
    accion: 'consultar',
    tipoOriginal: c.documento_tipo,
    tipo: p.tipo,
    inferido: p.inferido,
    cuerpo: { ...p.input, referencia_externa: referenciaBarrido(c.id) },
  }
}

// ─── La corrida ─────────────────────────────────────────────────────────────────

export type RespuestaValida = { ok: true; data: ValidaResultado } | { ok: false; error: string; status?: number }

/** Una consulta que Valida ya tiene con esa referencia (de una corrida anterior). */
export type ConsultaPrevia = { consulta_id: string; severidad: Severidad | string; total_matches: number }

/** Lo que queda en el JSON (fuera del repo). Aquí sí va el detalle completo de Valida. */
export type RegistroBarrido = {
  afi_id: string
  estado: 'consultada' | 'previa' | 'error' | 'aparte'
  tipo_original: string | null
  tipo_enviado?: string
  tipo_inferido?: boolean
  motivo?: string
  valida_consulta_id?: string
  severidad?: string
  total_matches?: number
  matches?: ValidaResultado['matches'] | null
  hash_reporte?: string
  fecha_reporte?: string
  error?: string
  status?: number
  en: string
}

export type DependenciasBarrido = {
  /** POST /api/v1/validate con la llave de MéTRIK y la `Idempotency-Key` dada. */
  llamar: (cuerpo: CuerpoBarrido, clave: string) => Promise<RespuestaValida>
  /** La consulta que Valida ya tiene con esa referencia, o null. Evita repetir pasadas las 24 h. */
  previa: (referencia: string) => Promise<ConsultaPrevia | null>
  /** Guarda el registro de la fila (el script lo agrega a un JSONL). */
  registrar: (r: RegistroBarrido) => void | Promise<void>
  ahora?: () => Date
}

export type Hallazgo = {
  afi_id: string
  valida_consulta_id: string
  severidad: string
  /** Lista y criterio de cada coincidencia. null = consulta previa, sin el detalle a mano. */
  coincidencias: Array<{ lista: string; resultado: string; match_por: string | null }> | null
}

export type ResumenBarrido = {
  revisadas: number
  /** Ya estaban en el registro de una corrida anterior: no se tocan. */
  yaHechas: number
  porSeveridad: Record<string, number>
  errores: Array<{ afi_id: string; error: string; status?: number }>
  aparte: Array<{ afi_id: string; motivo: string }>
  hallazgos: Hallazgo[]
  /** Se detuvo antes de terminar: las siguientes darían lo mismo. */
  detenido: string | null
}

/** Estados con los que Valida responde igual a todas las siguientes: no tiene sentido seguir. */
const DETIENE = new Set([401, 402, 403])
/** Errores de red o del servidor seguidos que detienen la corrida (no se martilla a Valida). */
export const MAX_ERRORES_SEGUIDOS = 5

function coincidencias(data: ValidaResultado): Hallazgo['coincidencias'] {
  return (data.matches ?? []).map((m) => ({ lista: m.lista, resultado: m.resultado, match_por: m.match_por ?? null }))
}

/**
 * Consulta en serie (son cientos, no miles). `hechas`: ids de AFI que el registro de una corrida
 * anterior ya tiene resueltos; no se vuelven a consultar.
 */
export async function ejecutarBarrido(
  consultas: readonly ConsultaEnError[],
  hechas: ReadonlySet<string>,
  deps: DependenciasBarrido,
): Promise<ResumenBarrido> {
  const ahora = deps.ahora ?? (() => new Date())
  const r: ResumenBarrido = {
    revisadas: consultas.length,
    yaHechas: 0,
    porSeveridad: {},
    errores: [],
    aparte: [],
    hallazgos: [],
    detenido: null,
  }
  let seguidos = 0

  for (const c of consultas) {
    if (hechas.has(c.id)) {
      r.yaHechas += 1
      continue
    }
    const plan = planBarrido(c)
    if (plan.accion === 'aparte') {
      r.aparte.push({ afi_id: c.id, motivo: plan.motivo })
      await deps.registrar({ afi_id: c.id, estado: 'aparte', tipo_original: plan.tipoOriginal, motivo: plan.motivo, en: ahora().toISOString() })
      continue
    }

    const base = { afi_id: c.id, tipo_original: plan.tipoOriginal, tipo_enviado: plan.tipo, tipo_inferido: plan.inferido }
    let previa: ConsultaPrevia | null
    try {
      previa = await deps.previa(plan.cuerpo.referencia_externa)
    } catch (err) {
      // Sin poder confirmar que no existe, no se consulta a ciegas: se para y se retoma luego.
      r.detenido = `no se pudo revisar la consulta previa (${err instanceof Error ? err.message : 'error'})`
      break
    }
    if (previa) {
      r.porSeveridad[previa.severidad] = (r.porSeveridad[previa.severidad] ?? 0) + 1
      if (esHallazgo(previa.severidad)) {
        r.hallazgos.push({ afi_id: c.id, valida_consulta_id: previa.consulta_id, severidad: previa.severidad, coincidencias: null })
      }
      await deps.registrar({
        ...base,
        estado: 'previa',
        valida_consulta_id: previa.consulta_id,
        severidad: previa.severidad,
        total_matches: previa.total_matches,
        en: ahora().toISOString(),
      })
      seguidos = 0
      continue
    }

    const res = await deps.llamar(plan.cuerpo, claveIdempotenciaBarrido(c.id))
    if (!res.ok) {
      r.errores.push({ afi_id: c.id, error: res.error, ...(res.status ? { status: res.status } : {}) })
      await deps.registrar({ ...base, estado: 'error', error: res.error, status: res.status, en: ahora().toISOString() })
      if (res.status && DETIENE.has(res.status)) {
        r.detenido = res.error
        break
      }
      // Un 4xx de contrato es de esa fila; la red caída o un 5xx se repetirían.
      seguidos = res.status && res.status < 500 ? 0 : seguidos + 1
      if (seguidos >= MAX_ERRORES_SEGUIDOS) {
        r.detenido = `${MAX_ERRORES_SEGUIDOS} errores seguidos (${res.error})`
        break
      }
      continue
    }

    seguidos = 0
    const d = res.data
    r.porSeveridad[d.severidad] = (r.porSeveridad[d.severidad] ?? 0) + 1
    if (esHallazgo(d.severidad)) {
      r.hallazgos.push({ afi_id: c.id, valida_consulta_id: d.consulta_id, severidad: d.severidad, coincidencias: coincidencias(d) })
    }
    await deps.registrar({
      ...base,
      estado: 'consultada',
      valida_consulta_id: d.consulta_id,
      severidad: d.severidad,
      total_matches: d.total_matches,
      matches: d.matches ?? null,
      hash_reporte: d.hash_reporte,
      fecha_reporte: d.fecha_reporte,
      en: ahora().toISOString(),
    })
  }
  return r
}

/**
 * Los ids ya resueltos según el registro (JSONL) de corridas anteriores: consultadas, previas y
 * apartadas. Los errores se reintentan. Líneas rotas se ignoran.
 */
export function idsResueltos(lineas: readonly string[]): Set<string> {
  const ids = new Set<string>()
  for (const l of lineas) {
    if (!l.trim()) continue
    try {
      const r = JSON.parse(l) as Partial<RegistroBarrido>
      if (r.afi_id && (r.estado === 'consultada' || r.estado === 'previa' || r.estado === 'aparte')) ids.add(r.afi_id)
      // Un error posterior no deshace una consulta resuelta antes; uno anterior sí se supera.
    } catch {
      /* línea cortada por una corrida interrumpida */
    }
  }
  return ids
}

/**
 * El estado de TODAS las filas según el registro, no solo las de esta corrida: por cada fila manda su
 * último registro. Es lo que se imprime al final, para que una corrida retomada muestre el total.
 */
export function resumirRegistro(lineas: readonly string[]): Pick<ResumenBarrido, 'porSeveridad' | 'errores' | 'aparte' | 'hallazgos'> {
  const ultimo = new Map<string, RegistroBarrido>()
  for (const l of lineas) {
    if (!l.trim()) continue
    try {
      const r = JSON.parse(l) as RegistroBarrido
      if (!r.afi_id) continue
      const previo = ultimo.get(r.afi_id)
      // Un error no pisa una consulta ya resuelta (no debería pasar: las resueltas no se repiten).
      if (previo && previo.estado !== 'error' && r.estado === 'error') continue
      ultimo.set(r.afi_id, r)
    } catch {
      /* línea cortada */
    }
  }
  const out: Pick<ResumenBarrido, 'porSeveridad' | 'errores' | 'aparte' | 'hallazgos'> = {
    porSeveridad: {},
    errores: [],
    aparte: [],
    hallazgos: [],
  }
  for (const r of ultimo.values()) {
    if (r.estado === 'aparte') out.aparte.push({ afi_id: r.afi_id, motivo: r.motivo ?? '' })
    else if (r.estado === 'error') out.errores.push({ afi_id: r.afi_id, error: r.error ?? '', ...(r.status ? { status: r.status } : {}) })
    else if (r.severidad) {
      out.porSeveridad[r.severidad] = (out.porSeveridad[r.severidad] ?? 0) + 1
      if (esHallazgo(r.severidad) && r.valida_consulta_id) {
        out.hallazgos.push({
          afi_id: r.afi_id,
          valida_consulta_id: r.valida_consulta_id,
          severidad: r.severidad,
          coincidencias:
            r.estado === 'previa'
              ? null
              : (r.matches ?? []).map((m) => ({ lista: m.lista, resultado: m.resultado, match_por: m.match_por ?? null })),
        })
      }
    }
  }
  return out
}

/**
 * Lo que se imprime de un hallazgo: ids, severidad, lista y criterio. Nunca el nombre consultado,
 * el nombre de la coincidencia ni un documento.
 */
export function lineasHallazgo(h: Hallazgo): string[] {
  const cabeza = `${h.afi_id}  valida=${h.valida_consulta_id}  ${h.severidad}`
  if (h.coincidencias === null) return [`${cabeza}  (consulta previa: lista y criterio en el reporte de Valida)`]
  if (h.coincidencias.length === 0) return [`${cabeza}  (sin coincidencias en la respuesta)`]
  return [
    cabeza,
    ...h.coincidencias.map((m) => `    lista=${m.lista}  criterio=${m.resultado}${m.match_por ? `/${m.match_por}` : ''}`),
  ]
}

// ─── Antes de correr: que la cuenta de MéTRIK no se corte a mitad ───────────────

export type EstadoCuenta =
  | { puede: true; detalle: string }
  | { puede: false; detalle: string }

/**
 * Lee la respuesta de `GET /api/v1/cuenta/consumo` con la llave de MéTRIK y dice si alcanzan las
 * `pendientes` consultas sin que Valida corte. El fair-use es blando (solo alerta interna), no corta.
 *
 *   409 sin_plan_asignado  sin plan: no hay bolsa que se agote ni bloqueo por mora.
 *   200 bolsa              alcanza si el saldo cubre las pendientes y no está bloqueada.
 *   200 mensual            corta solo por mora (cuenta vencida sin pago y consumo > 100 %).
 */
export function leerEstadoCuenta(status: number, cuerpo: unknown, pendientes: number): EstadoCuenta {
  const b = (cuerpo ?? {}) as Record<string, unknown>
  if (status === 401) return { puede: false, detalle: 'Valida rechazó la llave (401).' }
  if (status === 409 && b.error === 'sin_plan_asignado') {
    return { puede: true, detalle: 'Cuenta sin plan: sin bolsa que se agote ni bloqueo por mora; el fair-use solo alerta.' }
  }
  if (status !== 200) return { puede: false, detalle: `Respuesta inesperada de la cuenta (${status}).` }

  const cliente = (b.cliente ?? {}) as Record<string, unknown>
  if (cliente.cliente_id && cliente.cliente_id !== CLIENTE_VALIDA_METRIK) {
    return { puede: false, detalle: 'La llave no es la del cliente MéTRIK en Valida.' }
  }
  if (b.modalidad === 'bolsa') {
    const bolsa = (b.bolsa ?? {}) as Record<string, unknown>
    const saldo = typeof bolsa.saldo === 'number' ? bolsa.saldo : 0
    if (bolsa.bloqueada === true) return { puede: false, detalle: `Bolsa cortada (${String(bolsa.estado)}).` }
    if (saldo < pendientes) return { puede: false, detalle: `La bolsa tiene ${saldo} consultas y faltan ${pendientes}.` }
    return { puede: true, detalle: `Bolsa con ${saldo} consultas para ${pendientes} pendientes.` }
  }
  const cobro = (b.cobro ?? {}) as Record<string, unknown>
  if (cobro.bloqueado === true) return { puede: false, detalle: 'Cuenta mensual bloqueada por mora.' }
  if (cobro.cuenta_vencida_sin_pago === true) {
    return { puede: false, detalle: 'Cuenta mensual vencida sin pago: puede bloquearse a mitad al pasar el 100 %.' }
  }
  return { puede: true, detalle: 'Plan mensual al día: solo bloquea por mora.' }
}
