import { createHash } from 'node:crypto'
import { whatsappDesdeTelefono } from '@/lib/contactos/telefono'

/**
 * Huellas de la lista de supresión (R15: solo se guarda la huella, nunca el dato).
 * FUENTE ÚNICA de la normalización: la carga de bajas y la consulta usan lo mismo, o una baja
 * cargada de una forma no se encuentra con otra.
 */

export type TipoSupresion = 'email' | 'telefono' | 'nit'

export function huella(tipo: TipoSupresion, valorNormalizado: string): string {
  return createHash('sha256').update(`metrik-supresion-v1:${tipo}:${valorNormalizado}`).digest('hex')
}

export function normalizarEmail(raw: string | null | undefined): string | null {
  const v = raw?.trim().toLowerCase().replace(/^mailto:/, '')
  return v && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : null
}

/** Móvil colombiano en E.164 sin `+`; si no lo es, solo dígitos (mínimo 7). */
export function normalizarTelefono(raw: string | null | undefined): string | null {
  if (!raw) return null
  const wa = whatsappDesdeTelefono(raw)
  if (wa) return wa
  const d = raw.trim().replace(/[.,]0+$/, '').replace(/\D/g, '')
  return d.length >= 7 ? d : null
}

/**
 * NIT: dígitos sin puntos. Con guion se descarta el dígito de verificación (`902.079.601-9` ->
 * `902079601`). Sin guion se conserva tal cual: la consulta prueba también sin el último dígito
 * cuando trae 10 (NIT con DV pegado).
 */
export function normalizarNit(raw: string | null | undefined): string | null {
  if (!raw) return null
  const base = raw.trim().split('-')[0]
  const d = base.replace(/\D/g, '')
  return d.length >= 5 ? d : null
}

/** Claves con las que se busca un NIT en la lista (el principal y la variante sin DV). */
export function candidatosNit(raw: string | null | undefined): string[] {
  const n = normalizarNit(raw)
  if (!n) return []
  const solo = !raw!.includes('-') && n.length === 10 ? [n.slice(0, -1)] : []
  return [n, ...solo]
}

/** Huellas a consultar para un conjunto de datos de contacto. */
export function huellasDe(d: { email?: string | null; telefono?: string | null; nit?: string | null }) {
  const out: { tipo: TipoSupresion; huella: string }[] = []
  const e = normalizarEmail(d.email)
  if (e) out.push({ tipo: 'email', huella: huella('email', e) })
  const t = normalizarTelefono(d.telefono)
  if (t) out.push({ tipo: 'telefono', huella: huella('telefono', t) })
  for (const n of candidatosNit(d.nit)) out.push({ tipo: 'nit', huella: huella('nit', n) })
  return out
}
