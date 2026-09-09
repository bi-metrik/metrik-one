/**
 * Qué adaptador atiende cada pasarela. En Fase 1 solo existe `manual`; `bold` y
 * `epayco` devuelven `null` a propósito: una suscripción declarada con una pasarela
 * que todavía no tiene adaptador NO se cobra por otra vía, se reporta.
 */

import { pasarelaManual } from './manual'
import type { PasarelaAdapter } from './adapter'

export function adapterPara(pasarela: string): PasarelaAdapter | null {
  switch (pasarela) {
    case 'manual': return pasarelaManual
    default: return null
  }
}
