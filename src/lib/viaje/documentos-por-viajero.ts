/**
 * Documentos POR VIAJERO en «Documentos y entrega» (QA Trappvel 2026-10-29, H9-5 y H6-4). Puro.
 *
 * Antes bastaba UN pasaporte para todo el grupo (4 viajeros, 2 menores: pasaba con el de la bebé)
 * y se guardaba en el contacto titular sin decir de quién era. Ahora:
 *
 *   · Los viajeros salen de la composición de la etapa 1 (adultos, niños, infantes): «Laura
 *     (titular)», «Adulto 2», «Niño 1», «Infante 1». Sin composición, un solo viajero (como antes).
 *   · Cada documento se carga diciendo de quién es. El documento sigue en el CONTACTO titular
 *     (C11, `contacto_documentos`); a qué viajero de ESTE viaje pertenece queda en
 *     `negocios.metadata.documentos_viajero.asignados[documento_id]` (sin migración: la tabla no
 *     tiene a quién; la propuesta de modelo va en el PR).
 *   · Viaje internacional: pasaporte vigente de CADA viajero. Los menores (niños e infantes),
 *     además, registro civil; y si no viajan con sus dos padres, permiso de salida del país. Si
 *     viajan con los dos se pregunta una vez y queda anotado (`menores_con_ambos_padres`).
 *   · Con un solo viajero, un pasaporte sin asignar cuenta para él (lo de siempre). Con varios, el
 *     pasaporte sin asignar no cuenta: se ve como «sin viajero» para asignarlo.
 *
 * Registro civil y permiso de salida se guardan como `tipo = 'otro'` (el CHECK de la tabla no tiene
 * esos tipos); su clase va en la asignación.
 */

import type { Composicion } from '@/lib/cotizaciones/tarifa-pasajero'
import { avisoVencimiento, type DocumentoViajero } from './entrega'

export type ClaseDocumento = 'pasaporte' | 'registro_civil' | 'permiso_salida'

export const ETIQUETA_CLASE: Record<ClaseDocumento, string> = {
  pasaporte: 'Pasaporte',
  registro_civil: 'Registro civil',
  permiso_salida: 'Permiso de salida del país',
}

export const CLASES_DOCUMENTO: readonly ClaseDocumento[] = ['pasaporte', 'registro_civil', 'permiso_salida']

export interface ViajeroDelViaje {
  /** `adulto-1` (el titular), `adulto-2`, `nino-1`, `infante-1`… */
  clave: string
  etiqueta: string
  menor: boolean
  titular: boolean
}

/** Tope sensato: un grupo más grande no se lista viajero por viajero. */
const MAX_VIAJEROS = 30

export function viajerosDelViaje(c: Composicion | null, nombreTitular: string): ViajeroDelViaje[] {
  const primer = nombreTitular.trim().split(/\s+/)[0] ?? ''
  const titular: ViajeroDelViaje = { clave: 'adulto-1', etiqueta: primer ? `${primer} (titular)` : 'Titular', menor: false, titular: true }
  if (!c) return [titular]
  const out: ViajeroDelViaje[] = [titular]
  for (let i = 2; i <= c.adultos; i++) out.push({ clave: `adulto-${i}`, etiqueta: `Adulto ${i}`, menor: false, titular: false })
  for (let i = 1; i <= c.ninos; i++) out.push({ clave: `nino-${i}`, etiqueta: `Niño ${i}`, menor: true, titular: false })
  for (let i = 1; i <= c.infantes; i++) out.push({ clave: `infante-${i}`, etiqueta: `Infante ${i}`, menor: true, titular: false })
  return out.slice(0, MAX_VIAJEROS)
}

export interface AsignacionDocumento {
  viajero: string
  clase: ClaseDocumento
}

export interface DocumentosViajeroGuardados {
  asignados: Record<string, AsignacionDocumento>
  /** `true` viajan con los dos padres (no pide permiso), `false` no, `null` sin responder. */
  menoresConAmbosPadres: boolean | null
}

export const SIN_GUARDADOS: DocumentosViajeroGuardados = { asignados: {}, menoresConAmbosPadres: null }

/** Lee `negocios.metadata.documentos_viajero` sin confiar en su forma. */
export function leerDocumentosViajero(metadata: unknown): DocumentosViajeroGuardados {
  const raw = (metadata as { documentos_viajero?: unknown } | null | undefined)?.documentos_viajero
  if (!raw || typeof raw !== 'object') return SIN_GUARDADOS
  const r = raw as { asignados?: unknown; menores_con_ambos_padres?: unknown }
  const asignados: Record<string, AsignacionDocumento> = {}
  if (r.asignados && typeof r.asignados === 'object') {
    for (const [id, v] of Object.entries(r.asignados as Record<string, unknown>)) {
      const a = v as { viajero?: unknown; clase?: unknown } | null
      if (!a || typeof a.viajero !== 'string' || !CLASES_DOCUMENTO.includes(a.clase as ClaseDocumento)) continue
      asignados[id] = { viajero: a.viajero, clase: a.clase as ClaseDocumento }
    }
  }
  const m = r.menores_con_ambos_padres
  return { asignados, menoresConAmbosPadres: typeof m === 'boolean' ? m : null }
}

/** La forma en que se guarda (lo inverso de `leerDocumentosViajero`). */
export function documentosViajeroParaGuardar(g: DocumentosViajeroGuardados): Record<string, unknown> {
  return { asignados: g.asignados, menores_con_ambos_padres: g.menoresConAmbosPadres }
}

export interface EstadoViajero {
  viajero: ViajeroDelViaje
  pasaporte: DocumentoViajero | null
  /** Aviso rojo de vencimiento del pasaporte (6 meses tras el regreso). */
  avisoPasaporte: string | null
  registroCivil: DocumentoViajero | null
  permisoSalida: DocumentoViajero | null
  /** ¿Pide permiso de salida? `null`: no se sabe todavía (falta la respuesta de los padres). */
  pidePermiso: boolean | null
}

export interface EstadoDocumentosViaje {
  viajeros: EstadoViajero[]
  /** Pasaportes del contacto que no son de ningún viajero de este viaje (con varios viajeros). */
  sinAsignar: DocumentoViajero[]
  hayMenores: boolean
  menoresConAmbosPadres: boolean | null
  /** Lo que falta, en palabras sueltas («el pasaporte de Adulto 2»); vacío si nada. */
  faltan: string[]
  /** Avisos de vencimiento que frenan. */
  avisos: string[]
}

export const TEXTO_PREGUNTA_PADRES = 'saber si los menores viajan con sus dos padres'

function mejorPasaporte(docs: DocumentoViajero[], fechaRegreso: string | null, nombre: string): DocumentoViajero | null {
  if (docs.length === 0) return null
  const sinAviso = docs.filter(d => !avisoVencimiento(d, fechaRegreso, nombre))
  const pool = sinAviso.length > 0 ? sinAviso : docs
  return [...pool].sort((a, b) => String(b.fecha_vencimiento ?? '').localeCompare(String(a.fecha_vencimiento ?? '')))[0]
}

export function documentosPorViajero(p: {
  internacional: boolean | null
  documentos: readonly DocumentoViajero[]
  guardados: DocumentosViajeroGuardados
  viajeros: readonly ViajeroDelViaje[]
  fechaRegreso: string | null
}): EstadoDocumentosViaje {
  const viajeros = p.viajeros.length > 0 ? p.viajeros : viajerosDelViaje(null, '')
  const claves = new Set(viajeros.map(v => v.clave))
  const solo = viajeros.length === 1
  const porViajero = new Map<string, Record<ClaseDocumento, DocumentoViajero[]>>()
  for (const v of viajeros) porViajero.set(v.clave, { pasaporte: [], registro_civil: [], permiso_salida: [] })
  const sinAsignar: DocumentoViajero[] = []
  for (const d of p.documentos) {
    const a = p.guardados.asignados[d.id]
    if (a && claves.has(a.viajero)) {
      // Un documento marcado como pasaporte tiene que serlo en la tabla; los otros van como «otro».
      if (a.clase === 'pasaporte' && d.tipo !== 'pasaporte') continue
      porViajero.get(a.viajero)![a.clase].push(d)
      continue
    }
    if (d.tipo !== 'pasaporte') continue
    if (solo) porViajero.get(viajeros[0].clave)!.pasaporte.push(d)
    else sinAsignar.push(d)
  }

  const hayMenores = viajeros.some(v => v.menor)
  const ambos = p.guardados.menoresConAmbosPadres
  const estados: EstadoViajero[] = viajeros.map(v => {
    const docs = porViajero.get(v.clave)!
    const nombre = v.titular ? v.etiqueta.replace(/ \(titular\)$/, '') : ''
    const pasaporte = mejorPasaporte(docs.pasaporte, p.fechaRegreso, nombre)
    return {
      viajero: v,
      pasaporte,
      avisoPasaporte: pasaporte ? avisoVencimiento(pasaporte, p.fechaRegreso, nombre) : null,
      registroCivil: docs.registro_civil[0] ?? null,
      permisoSalida: docs.permiso_salida[0] ?? null,
      pidePermiso: v.menor ? (ambos === null ? null : !ambos) : false,
    }
  })

  const faltan: string[] = []
  const avisos: string[] = []
  if (p.internacional === true) {
    for (const e of estados) {
      if (!e.pasaporte) faltan.push(solo ? 'el pasaporte del viajero' : `el pasaporte de ${e.viajero.etiqueta}`)
      else if (e.avisoPasaporte) avisos.push(e.avisoPasaporte)
      if (e.viajero.menor && !e.registroCivil) faltan.push(`el registro civil de ${e.viajero.etiqueta}`)
      if (e.viajero.menor && e.pidePermiso === true && !e.permisoSalida) faltan.push(`el permiso de salida de ${e.viajero.etiqueta}`)
    }
    if (hayMenores && ambos === null) faltan.push(TEXTO_PREGUNTA_PADRES)
  }
  return { viajeros: estados, sinAsignar, hayMenores, menoresConAmbosPadres: ambos, faltan, avisos }
}

const enLista = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`)

/**
 * El mensaje del gate: «Falta el pasaporte del viajero.» (un viajero, lo de siempre), «Faltan el
 * pasaporte de Adulto 2 y el registro civil de Niño 1.», más los avisos de vencimiento. `null` si
 * no falta nada.
 */
export function mensajeDocumentosViaje(e: EstadoDocumentosViaje): string | null {
  const partes: string[] = []
  if (e.faltan.length > 0) {
    const t = enLista(e.faltan)
    partes.push(`${e.faltan.length === 1 ? 'Falta' : 'Faltan'} ${t}.`)
  }
  partes.push(...e.avisos)
  return partes.length > 0 ? partes.join(' ') : null
}
