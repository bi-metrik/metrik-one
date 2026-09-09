/**
 * Qué adaptador atiende cada pasarela. `bold` y `epayco` devuelven `null` a
 * propósito: una suscripción declarada con una pasarela que todavía no tiene
 * adaptador NO se cobra por otra vía, se reporta.
 *
 * `wompi` SÍ tiene adaptador aunque todavía no cobre, y la diferencia no es
 * cosmética: en el `default` una pasarela sin conectar es indistinguible de una
 * pasarela escrita mal, y las dos merecen respuestas distintas. Con adaptador, el
 * ciclo recibe un error con motivo escrito en vez de un `null` mudo. Ver `wompi.ts`.
 */

import { pasarelaManual } from './manual'
import { pasarelaWompi } from './wompi'
import type { PasarelaAdapter } from './adapter'

export function adapterPara(pasarela: string): PasarelaAdapter | null {
  switch (pasarela) {
    case 'manual': return pasarelaManual
    case 'wompi': return pasarelaWompi
    default: return null
  }
}
