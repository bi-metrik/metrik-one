/**
 * Qué adaptador atiende cada pasarela. Una pasarela sin adaptador devuelve `null`
 * a propósito: una suscripción declarada con ella NO se cobra por otra vía, se reporta.
 *
 * `wompi` SÍ tiene adaptador aunque todavía no cobre, y la diferencia no es
 * cosmética: en el `default` una pasarela sin conectar es indistinguible de una
 * pasarela escrita mal, y las dos merecen respuestas distintas. Con adaptador, el
 * ciclo recibe un error con motivo escrito en vez de un `null` mudo. Ver `wompi.ts`.
 */

import { pasarelaBold } from './bold'
import { pasarelaEpayco } from './epayco'
import { pasarelaManual } from './manual'
import { pasarelaWompi } from './wompi'
import type { PasarelaAdapter } from './adapter'

export function adapterPara(pasarela: string): PasarelaAdapter | null {
  switch (pasarela) {
    case 'manual': return pasarelaManual
    case 'wompi': return pasarelaWompi
    // Enlace por cuota + webhook (`bold.ts`). Sin suscripciones en `bold` (0 filas en
    // `suscripciones` al 2026-09-23), registrarlo no cambia lo que corre hoy el cron.
    case 'bold': return pasarelaBold
    // Link de cobro por cuota + URL de confirmación (`epayco.ts`). Reemplaza a Bold plan por plan:
    // un plan pasa a ePayco cuando su `planes_cobro.pasarela` dice 'epayco'.
    case 'epayco': return pasarelaEpayco
    default: return null
  }
}
