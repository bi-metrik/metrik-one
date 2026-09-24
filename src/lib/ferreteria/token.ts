/**
 * Tokens del endpoint `/api/ferreteria/*` para los dos escritores sin sesión (el agente de
 * MeTRIK y el cron del Mac). La base guarda solo el sha256; el token en claro se muestra una
 * vez al emitirlo (`scripts/emitir-token-ferreteria.ts`) y no se puede recuperar después.
 */
import { createHash, randomBytes } from 'node:crypto'

export const PREFIJO_TOKEN = 'fer_'

export function generarToken(): string {
  return PREFIJO_TOKEN + randomBytes(32).toString('base64url')
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

/** Lo que se guarda para reconocer el token en una lista sin poder usarlo. */
export function prefijoVisible(token: string): string {
  return token.slice(0, PREFIJO_TOKEN.length + 6)
}

/** El token de `Authorization: Bearer fer_...`, o `null` si la cabecera no tiene esa forma. */
export function tokenDeCabecera(authorization: string | null | undefined): string | null {
  if (!authorization) return null
  const m = /^Bearer\s+(\S+)\s*$/i.exec(authorization)
  if (!m) return null
  const token = m[1]
  if (!token.startsWith(PREFIJO_TOKEN) || token.length < PREFIJO_TOKEN.length + 32) return null
  return token
}
