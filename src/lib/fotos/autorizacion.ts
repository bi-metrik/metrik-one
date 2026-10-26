/**
 * La autorización de una foto SUBIDA o PEGADA a la biblioteca (Emilio, 2026-10-16): quien la sube
 * marca «Tengo autorización para usar esta foto» y ONE guarda quién (el usuario), cuándo y, si lo
 * dice, de dónde viene («kit de medios del hotel», «mayorista X»). Sin la casilla no se guarda.
 * PURO: el navegador manda el pedido; el servidor lo revisa aquí y pone él el usuario y la hora.
 */
import { esDeAgenciaDeViajes, MENSAJE_AGENCIA } from './agencias'

export const TEXTO_CASILLA_AUTORIZACION = 'Tengo autorización para usar esta foto'
export const MENSAJE_SIN_AUTORIZACION = 'Marca «Tengo autorización para usar esta foto» para guardarla.'
export const MAX_PROCEDENCIA = 200

/** Lo que manda el navegador al subir. */
export interface PedidoAutorizacion {
  autorizada: boolean
  /** De dónde viene, texto libre opcional. */
  procedencia?: string | null
}

/** Lo que el servidor guarda en la fila (`autorizada_por`, `autorizada_at`, `procedencia`). */
export interface AutorizacionFoto {
  userId: string
  procedencia: string | null
}

/**
 * Revisa el pedido: la casilla tiene que venir marcada (`true`, no algo «verdadero») y la
 * procedencia, si viene, es texto de hasta 200 caracteres que no nombra una agencia en línea.
 */
export function revisarAutorizacion(p: unknown): { ok: true; procedencia: string | null } | { ok: false; error: string } {
  if (!p || typeof p !== 'object' || (p as PedidoAutorizacion).autorizada !== true) return { ok: false, error: MENSAJE_SIN_AUTORIZACION }
  const cruda = (p as PedidoAutorizacion).procedencia
  if (cruda !== undefined && cruda !== null && typeof cruda !== 'string') return { ok: false, error: 'La procedencia de la foto no se entiende.' }
  const procedencia = typeof cruda === 'string' ? cruda.replace(/\s+/g, ' ').trim() : ''
  if (procedencia.length > MAX_PROCEDENCIA) return { ok: false, error: `La procedencia de la foto es muy larga (máximo ${MAX_PROCEDENCIA} caracteres).` }
  if (esDeAgenciaDeViajes(procedencia)) return { ok: false, error: MENSAJE_AGENCIA }
  return { ok: true, procedencia: procedencia || null }
}
