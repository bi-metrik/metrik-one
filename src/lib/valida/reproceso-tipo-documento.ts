/**
 * Las consultas de la carga masiva que quedaron en error por el tipo de documento (antes del
 * 2026-10-23 el lote mandaba «CEDULA», «PP», «TI»… tal cual y Valida respondía 400).
 *
 * Aquí solo vive QUÉ filas son y con qué cuerpo se consultarían. Desde el 2026-10-24 esas filas ya no
 * se reprocesan en la cuenta del cliente ni se reescriben: se consultan por dentro con la cuenta de
 * MéTRIK (`scripts/valida/barrido-interno-afi.ts`, lógica en `./barrido-interno`).
 */

import type { TipoDocumento, TipoPersona, ValidaConsultaInput } from '@/lib/actions/valida-consultas'
import { leerTipoDocumento } from './tipo-documento'

/** La fila de `valida_consultas` que se mira. */
export type ConsultaEnError = {
  id: string
  tipo_persona: string
  nombre_consultado: string | null
  documento_tipo: string | null
  documento_numero: string | null
}

export type PlanReproceso =
  | { accion: 'reprocesar'; tipo: TipoDocumento; inferido: boolean; input: ValidaConsultaInput }
  /** No se puede deducir el tipo con seguridad. Se lista aparte, no se consulta. */
  | { accion: 'aparte'; motivo: 'tipo_no_deducible' | 'sin_numero' | 'tipo_persona_invalido' }

/**
 * Lo que se filtra en la base: severidad error y un tipo que Valida NO aceptaba cuando la fila
 * falló. Es la lista de antes de metrik-valida#70, fija a propósito: una fila en error con «TI» es
 * justo una de las que hay que consultar, aunque hoy TI ya se acepte. Una en error con CC, CE, NIT o
 * PAS falló por otra razón y no es de este frente.
 */
export const TIPOS_ACEPTADOS_ANTES: readonly string[] = ['CC', 'CE', 'NIT', 'PAS']

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

/** ¿El resultado es un hallazgo que hay que reportar? */
export function esHallazgo(severidad: string): boolean {
  return severidad === 'alto' || severidad === 'medio' || severidad === 'bajo'
}

/** Clasifica sin llamar a nadie: es el modo de ensayo. */
export function ensayarReproceso(consultas: readonly ConsultaEnError[]) {
  const porAccion = { reprocesar: [] as string[], aparte: [] as string[] }
  for (const c of consultas) porAccion[planReproceso(c).accion].push(c.id)
  return porAccion
}
