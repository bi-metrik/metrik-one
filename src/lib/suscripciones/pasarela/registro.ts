/**
 * Qué adaptador atiende cada pasarela. `epayco` devuelve `null` mientras esté apagada
 * (`EPAYCO_HABILITADO`): una suscripción declarada con una pasarela que no opera NO se
 * cobra por otra vía, se reporta. Encendida, va en modo prueba salvo `EPAYCO_PRODUCCION=1`
 * (ver `epayco.ts`).
 *
 * `wompi` SÍ tiene adaptador aunque todavía no cobre, y la diferencia no es
 * cosmética: en el `default` una pasarela sin conectar es indistinguible de una
 * pasarela escrita mal, y las dos merecen respuestas distintas. Con adaptador, el
 * ciclo recibe un error con motivo escrito en vez de un `null` mudo. Ver `wompi.ts`.
 */

import { pasarelaBold } from './bold'
import { epaycoHabilitado, pasarelaEpayco } from './epayco'
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
    case 'epayco': return epaycoHabilitado() ? pasarelaEpayco : null
    default: return null
  }
}
