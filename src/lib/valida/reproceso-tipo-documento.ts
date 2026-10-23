/**
 * Reproceso de las consultas de la carga masiva que quedaron en error por el tipo de documento
 * (antes del 2026-10-23 el lote mandaba «CEDULA», «PP», «TI»… tal cual y Valida respondía 400).
 *
 * Lo puro del script `scripts/valida/reprocesar-tipo-documento.ts`: qué filas se reprocesan, con qué
 * cuerpo, y qué se escribe en la MISMA fila de `valida_consultas`. Sin red ni base: el script inyecta
 * la llamada a Valida y el cliente de Supabase, y las pruebas, dobles.
 */

import type { TipoDocumento, TipoPersona, ValidaConsultaInput, ValidaResultado } from '@/lib/actions/valida-consultas'
import { TIPOS_DOCUMENTO_VALIDA, leerTipoDocumento, type TipoDocumentoPendiente } from './tipo-documento'

/** La fila de `valida_consultas` que se mira. */
export type ConsultaEnError = {
  id: string
  tipo_persona: string
  nombre_consultado: string | null
  documento_tipo: string | null
  documento_numero: string | null
  negocio_id: string | null
  lote_fila_id: string | null
}

export type PlanReproceso =
  | { accion: 'reprocesar'; tipo: TipoDocumento; inferido: boolean; input: ValidaConsultaInput }
  /** TI, PPT o RC: Valida todavía no los acepta (metrik-valida#70). Se saltan hasta entonces. */
  | { accion: 'esperar_valida'; tipo: TipoDocumentoPendiente }
  /** No se puede deducir el tipo con seguridad. Se lista aparte, no se consulta. */
  | { accion: 'aparte'; motivo: 'tipo_no_deducible' | 'sin_numero' | 'tipo_persona_invalido' }

/** Lo que se filtra en la base: severidad error y un tipo que Valida no acepta. */
export const TIPOS_ACEPTADOS_HOY: readonly string[] = TIPOS_DOCUMENTO_VALIDA

/**
 * Qué hacer con una fila.
 *
 * Con un tipo reconocible (CEDULA, PP, PA…), el de `leerTipoDocumento`, la misma función del lote.
 * Con un tipo irreconocible («X», el NIT puesto en la columna): solo una persona JURÍDICA se deduce
 * con seguridad, porque en Colombia se identifica por NIT. Una natural puede ser CC, CE o pasaporte, y
 * esa fila se lista aparte.
 */
export function planReproceso(c: ConsultaEnError): PlanReproceso {
  const persona = c.tipo_persona
  if (persona !== 'natural' && persona !== 'juridica') return { accion: 'aparte', motivo: 'tipo_persona_invalido' }
  const numero = (c.documento_numero ?? '').trim()
  if (!numero) return { accion: 'aparte', motivo: 'sin_numero' }

  const leido = leerTipoDocumento(c.documento_tipo, numero, persona)
  let tipo: TipoDocumento
  let inferido: boolean
  if (leido.estado === 'aceptado') {
    tipo = leido.tipo
    inferido = leido.inferido
  } else if (leido.estado === 'pendiente') {
    return { accion: 'esperar_valida', tipo: leido.tipo }
  } else if (persona === 'juridica' && /^\d[\d.\s-]*$/.test(numero)) {
    tipo = 'NIT'
    inferido = true
  } else {
    return { accion: 'aparte', motivo: 'tipo_no_deducible' }
  }

  const nombre = (c.nombre_consultado ?? '').trim()
  return {
    accion: 'reprocesar',
    tipo,
    inferido,
    // El mismo cuerpo que manda ONE: tipo de persona, nombre y documento. ONE no manda sujeto obligado.
    input: { tipo: persona as TipoPersona, ...(nombre ? { nombre } : {}), documento: { tipo, numero } },
  }
}

/** La llave de idempotencia del reproceso: correrlo dos veces no consulta dos veces. */
export function claveIdempotenciaReproceso(consultaId: string): string {
  return `one-reproceso-tipo-${consultaId}`
}

/** Lo que se escribe en la MISMA fila de `valida_consultas` cuando Valida respondió. */
export function actualizacionConsulta(
  c: ConsultaEnError,
  plan: Extract<PlanReproceso, { accion: 'reprocesar' }>,
  data: ValidaResultado,
  ahora: Date,
): Record<string, unknown> {
  return {
    documento_tipo: plan.tipo,
    severidad: data.severidad,
    total_matches: data.total_matches,
    matches: data.matches ?? null,
    valida_consulta_id: data.consulta_id,
    hash_reporte: data.hash_reporte,
    // Constancia: la fila conserva su `created_at` (cuando se cargó), pero la consulta a Valida es de
    // hoy. Sin esto el historial diría que ese resultado salió el día del cargue.
    reprocesada_at: ahora.toISOString(),
    reproceso: {
      motivo: 'tipo_documento',
      tipo_original: c.documento_tipo,
      tipo_inferido: plan.inferido,
      severidad_anterior: 'error',
      fecha_reporte: data.fecha_reporte ?? null,
    },
  }
}

/** ¿El resultado es un hallazgo que hay que reportar? */
export function esHallazgo(severidad: string): boolean {
  return severidad === 'alto' || severidad === 'medio' || severidad === 'bajo'
}

/** El conteo del lote tras pasar una fila de `error` a `nueva`. */
export function moverConteo(severidades: Record<string, number>, nueva: string): Record<string, number> {
  const out = { ...severidades }
  if ((out.error ?? 0) > 0) out.error -= 1
  if (out.error === 0) delete out.error
  out[nueva] = (out[nueva] ?? 0) + 1
  return out
}

// ─── La corrida, con la red y la base inyectadas ────────────────────────────────

export type RespuestaReproceso =
  | { ok: true; data: ValidaResultado }
  /** `detener`: las siguientes darían lo mismo o costarían plata (p. ej. Valida no confirmó el «sin cobro»). */
  | { ok: false; error: string; status?: number; detener?: boolean }

export type DependenciasReproceso = {
  /** POST /api/v1/validate sin cobro, con la llave del espacio y la `Idempotency-Key` dada. */
  llamar: (input: ValidaConsultaInput, clave: string) => Promise<RespuestaReproceso>
  /** Escribe la fila SOLO si sigue en error sin consulta de Valida. Devuelve si la escribió. */
  actualizarConsulta: (id: string, cambios: Record<string, unknown>) => Promise<boolean>
  /** Pone al día la fila del lote y el conteo del lote, si la consulta salió de uno. */
  actualizarFilaLote: (loteFilaId: string, tipo: TipoDocumento, data: ValidaResultado) => Promise<void>
  ahora?: () => Date
}

export type ResumenReproceso = {
  revisadas: number
  reprocesadas: number
  siguenEnError: number
  esperanValida: number
  aparte: string[]
  conHallazgo: string[]
  /** Negocios cuyo score SARLAFT habría que recalcular (el script no lo hace). */
  negocios: number
  /** Se detuvo antes de terminar (llave o marca sin cobro rechazada, bolsa cortada, cobro sin confirmar). */
  detenido: string | null
}

/** Clasifica sin llamar a nadie: es el modo de ensayo. */
export function ensayarReproceso(consultas: readonly ConsultaEnError[]) {
  const porAccion = { reprocesar: [] as string[], esperar_valida: [] as string[], aparte: [] as string[] }
  for (const c of consultas) porAccion[planReproceso(c).accion].push(c.id)
  return porAccion
}

/** Reprocesa en serie (son cientos, no miles): una llamada a la vez no aprieta a Valida. */
export async function ejecutarReproceso(
  consultas: readonly ConsultaEnError[],
  deps: DependenciasReproceso,
): Promise<ResumenReproceso> {
  const ahora = deps.ahora ?? (() => new Date())
  const r: ResumenReproceso = {
    revisadas: consultas.length,
    reprocesadas: 0,
    siguenEnError: 0,
    esperanValida: 0,
    aparte: [],
    conHallazgo: [],
    negocios: 0,
    detenido: null,
  }
  const negocios = new Set<string>()

  for (const c of consultas) {
    const plan = planReproceso(c)
    if (plan.accion === 'esperar_valida') {
      r.esperanValida += 1
      continue
    }
    if (plan.accion === 'aparte') {
      r.aparte.push(c.id)
      continue
    }

    const res = await deps.llamar(plan.input, claveIdempotenciaReproceso(c.id))
    if (!res.ok) {
      r.siguenEnError += 1
      // 401/402/403: llave rechazada, bolsa cortada o marca sin cobro rechazada. Todas las siguientes
      // responderían lo mismo. `detener`: Valida respondió sin confirmar el «sin cobro».
      if (res.detener || res.status === 401 || res.status === 402 || res.status === 403) {
        r.detenido = res.error
        break
      }
      continue
    }

    const escrita = await deps.actualizarConsulta(c.id, actualizacionConsulta(c, plan, res.data, ahora()))
    // No escrita: otra corrida ya la puso al día (la llave de idempotencia evitó la consulta doble).
    if (!escrita) continue
    if (c.lote_fila_id) await deps.actualizarFilaLote(c.lote_fila_id, plan.tipo, res.data)
    if (c.negocio_id) negocios.add(c.negocio_id)
    r.reprocesadas += 1
    if (esHallazgo(res.data.severidad)) r.conHallazgo.push(c.id)
  }
  r.negocios = negocios.size
  return r
}
