import 'server-only'

import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * La firma de un BORRADOR de la bandeja (H2 de la prueba del 2026-09-24).
 *
 * Lo que sigue en la bandeja no toca Componentes: la lectura vive en el navegador hasta
 * «Aceptar». Pero el costo con el que se mide el margen no puede venir del navegador
 * (`tarifa-pax-actions.ts`, «El servidor recalcula, no confía»). La lectura sale del
 * servidor firmada, viaja tal cual, y al aceptar solo se usa si la firma coincide: es la
 * misma lectura que hizo el servidor, byte a byte, para ESTA cotización y ESTE tipo.
 *
 * Sin tabla ni migración: el borrador no se guarda en ninguna parte.
 */

/** Cuánto vale un borrador: la bandeja no sobrevive a recargar, así que un día sobra. */
const VIGENCIA_MS = 24 * 60 * 60 * 1000

function secreto(): string | null {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || null
}

function mensaje(cotizacionId: string, tipo: string, emitida: number, lecturaJson: string): string {
  return `borrador-captura.v1\n${cotizacionId}\n${tipo}\n${emitida}\n${lecturaJson}`
}

export function firmarBorrador(cotizacionId: string, tipo: string, lecturaJson: string, ahora = Date.now()): string | null {
  const s = secreto()
  if (!s) return null
  const h = createHmac('sha256', s).update(mensaje(cotizacionId, tipo, ahora, lecturaJson), 'utf8').digest('hex')
  return `${ahora}.${h}`
}

export function borradorValido(
  cotizacionId: string,
  tipo: string,
  lecturaJson: string,
  firma: string,
  ahora = Date.now(),
): boolean {
  const s = secreto()
  if (!s || typeof firma !== 'string' || typeof lecturaJson !== 'string') return false
  const [marca, h] = firma.split('.')
  const emitida = Number(marca)
  if (!Number.isFinite(emitida) || !h || ahora - emitida > VIGENCIA_MS || emitida - ahora > 60_000) return false
  const esperado = createHmac('sha256', s).update(mensaje(cotizacionId, tipo, emitida, lecturaJson), 'utf8').digest('hex')
  const a = Buffer.from(h, 'hex')
  const b = Buffer.from(esperado, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}
