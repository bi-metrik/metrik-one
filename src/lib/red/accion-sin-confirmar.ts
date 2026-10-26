/**
 * Una ESCRITURA cuya respuesta no llegó: no se sabe si quedó hecha.
 *
 * El aviso de red de siempre (`MENSAJE_SIN_CONEXION`: «No se pudo completar. Intenta de
 * nuevo») es correcto para lo que no alcanzó a salir, pero no para una acción larga: en una
 * línea que pierde paquetes (Claro/Telmex, medido el 2026-10-05) la petición llega, el
 * servidor termina —emite la factura, mueve la etapa, genera la versión— y lo que se pierde
 * es la respuesta. «Intenta de nuevo» invita a repetir algo que ya pasó.
 *
 * Lo que hace la pantalla en cambio, siempre en este orden:
 *   1. Dice que NO SE CONFIRMÓ, sin culpar a la conexión de la persona.
 *   2. Relee el estado real (la ficha, la cola) para que se vea si quedó hecho.
 *   3. Solo ofrece «Reintentar» si quien llama declara que repetir es seguro (la acción es
 *      idempotente: gana el último, o el servidor reconoce el duplicado).
 *
 * Puro: el hook (`useTransitionTolerante`) pone el toast y llama a `releer`.
 */

export const MENSAJE_NO_CONFIRMADO =
  'No se confirmó: la respuesta no llegó. Revisa cómo quedó antes de repetirlo.'

export interface OpcionesSinConfirmar {
  /** Relee el estado real: `router.refresh()` en la ficha, la relectura de la cola, etc. */
  releer: () => void
  /** Solo para acciones idempotentes. Sin esto no se ofrece reintentar. */
  reintentar?: () => void
}

export interface AvisoSinConfirmar {
  mensaje: string
  accion?: { etiqueta: string; alHacer: () => void }
}

/** Qué decir y qué ofrecer. `releer` se llama aparte, siempre. */
export function avisoSinConfirmar(opciones: OpcionesSinConfirmar): AvisoSinConfirmar {
  return {
    mensaje: MENSAJE_NO_CONFIRMADO,
    ...(opciones.reintentar ? { accion: { etiqueta: 'Reintentar', alHacer: opciones.reintentar } } : {}),
  }
}

/**
 * Lo que corre cuando la red cortó una escritura: avisa y relee. Si `releer` lanza (otra
 * falla de red), no se pierde el aviso.
 */
export function alNoConfirmarse(
  opciones: OpcionesSinConfirmar,
  avisar: (a: AvisoSinConfirmar) => void,
): void {
  avisar(avisoSinConfirmar(opciones))
  try {
    opciones.releer()
  } catch {
    // La relectura también puede fallar por la red: el aviso ya está dado.
  }
}
