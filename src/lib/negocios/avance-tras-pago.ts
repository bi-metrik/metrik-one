/**
 * Qué se le ofrece a quien acaba de registrar un pago.
 *
 * Después de anotar la plata, el caso casi siempre está listo para seguir y nadie se
 * entera: quien registra el pago (financiera) no es quien mueve el caso (el comercial),
 * así que el negocio se queda quieto hasta que alguien vuelve a entrar solo a oprimir
 * Avanzar. Este módulo decide QUÉ se le muestra ahí mismo.
 *
 * ⚠️ Lo que se ofrece es un BOTÓN, nunca un avance automático, y esa decisión ya costó
 * caro tres veces:
 *
 *   1. "Sin gates pendientes" no es lo mismo que "listo". El motor resuelve routing por
 *      `dato_de_decision` y la etapa destino puede exigir una confirmación entre áreas
 *      (`confirmar_al_avanzar`, la que nació de los tres casos que entraron a Cobro en
 *      46 segundos el 2026-08-13).
 *   2. Un avance disparado por un insert queda atribuido a quien registró la plata, no a
 *      quien decidió mover el caso.
 *   3. El salto por saldo encadena varias etapas de un solo avance: es la decisión más
 *      cara del motor y no debe ocurrir sin que nadie la haya pedido.
 *
 * ⚠️ `avanzar` significa "nada de lo que este módulo puede ver lo retiene", NO "el
 * servidor lo va a dejar pasar". Los gates que viven en `cambiarEtapaNegocioConGate`
 * (saldo, handoff, campo, sobrepago, conciliación, duplicado) no se reimplementan aquí:
 * reescribirlos sería la segunda vara que este repo ya pagó varias veces. Si alguno
 * retiene, el clic devuelve `gate_bloqueado` y la pantalla lo lista entonces. El
 * ofrecimiento es un atajo, no una promesa.
 *
 * Módulo puro: quien llama resuelve el estado y lo pasa. Sin IO.
 */

import { negocioCerrado } from './motivo-cierre'

export type OfrecimientoAvance =
  /** Se dibuja el botón. `etapaDestinoNombre` es el destino POR DEFECTO del flujo: el
   *  routing puede mandarlo a otra parte, y el destino real lo nombra el servidor al
   *  responder. Por eso el botón dice "Avanzar de etapa" y el nombre va como referencia. */
  | { tipo: 'avanzar'; etapaDestinoNombre: string }
  /** Se listan, con sus nombres, las cosas que retienen el caso. */
  | { tipo: 'retenido'; motivos: string[] }
  /** Su rol o su área no avanzan esta etapa. No se dibuja un botón que el servidor va a rechazar. */
  | { tipo: 'sin_permiso' }
  /** No hay avance que ofrecer: negocio cerrado o pausado, o última etapa de la línea. */
  | { tipo: 'no_aplica' }

export interface EstadoTrasPago {
  /** `negocios.estado`. El criterio de "cerrado" lo pone `negocioCerrado`, no una lista nueva. */
  estado: string | null
  /** `negocios.pausado`. */
  pausado: boolean
  /**
   * Nombre de la etapa a la que apunta el flujo por defecto (`siguienteEtapaPorDefecto`),
   * o `null` si la línea termina aquí.
   */
  etapaDestinoNombre: string | null
  /** ¿El rol y el área de quien registró el pago avanzan esta etapa? (`guardAvanzarStage`). */
  puedeAvanzar: boolean
  /**
   * Lo que retiene el caso, ya nombrado y ya sin los gates que esta persona puede
   * declarar vencidos (`puedeOmitirGate`). Vacío = nada visible lo retiene.
   */
  motivos: string[]
}

/**
 * ¿Este gate es de los que el MOTOR cierra solo, cuando el anticipo ya está cubierto?
 *
 * `cambiarEtapaNegocioConGate` corre `autocompletarGatesAnticipoPorSaldo` ANTES de
 * preguntarle a `puede_avanzar_etapa`: un bloque de pagos (`es_pagos_epayco`) cuyo
 * anticipo esperado ya está cubierto por el saldo pasa a `completo` en ese momento, sin
 * importar por qué vía entró la plata.
 *
 * Sin este filtro, el panel decía "retenido: Pagos" justo después de registrar el
 * anticipo, escondía el botón, y el clic desde la ficha del negocio SÍ habría avanzado.
 * O sea que fallaba precisamente en el caso que este frente viene a resolver. Medido en
 * SOENA el 2026-09-14: los gates vivos con esa marca son dos, "Pagos" de Negociación
 * (por donde pasa todo caso a registrar su anticipo) y "Pagos" de Cartera.
 *
 * ⚠️ NO decide si el anticipo está cubierto. Eso lo responde `anticipoCubiertoPorSaldo`,
 * la misma función que usa el motor, y entra ya resuelto por parámetro: una segunda
 * cuenta de la misma plata es el error que este repo ya pagó varias veces.
 */
export function esGateDeAnticipo(configExtra: Record<string, unknown> | null | undefined): boolean {
  return (configExtra as { es_pagos_epayco?: unknown } | null | undefined)?.es_pagos_epayco === true
}

/**
 * El orden de las preguntas no es arbitrario.
 *
 * `no_aplica` va primero porque un negocio cerrado o pausado no recibe ninguna oferta,
 * pase lo que pase con los gates. Es el mismo corte que ya hace la ficha del negocio:
 * con el negocio pausado esconde "Avanzar" y deja solo "Reactivar".
 *
 * `sin_permiso` va ANTES que `retenido` a propósito. Listarle los gates a quien de todas
 * formas no puede avanzar sugiere que resolverlos lo desbloquea, y es falso: seguiría sin
 * poder. Decirle que esa etapa no la avanza su área es la única respuesta que le sirve.
 */
export function ofrecimientoDeAvance(estado: EstadoTrasPago): OfrecimientoAvance {
  if (negocioCerrado(estado.estado)) return { tipo: 'no_aplica' }
  if (estado.pausado) return { tipo: 'no_aplica' }
  if (!estado.etapaDestinoNombre) return { tipo: 'no_aplica' }
  if (!estado.puedeAvanzar) return { tipo: 'sin_permiso' }
  if (estado.motivos.length > 0) return { tipo: 'retenido', motivos: estado.motivos }
  return { tipo: 'avanzar', etapaDestinoNombre: estado.etapaDestinoNombre }
}
