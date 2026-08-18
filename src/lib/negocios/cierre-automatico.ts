/**
 * La etapa de cierre no es una parada obligatoria: si el caso llega con su gate ya
 * resuelto, no hay nada que pedirle a nadie y el negocio se cierra solo.
 *
 * En SOENA, Facturacion existe para los casos que llegan al final SIN factura, y su propia
 * guia lo dice: *"El caso solo cae aqui si financiera no alcanzo a facturar antes, porque se
 * puede facturar desde Documentacion en adelante."* La intencion estaba escrita desde que se
 * configuro la etapa; el comportamiento nunca existio, asi que un caso ya facturado aterrizaba
 * igual en una bandeja de pendientes y alguien tenia que cerrarlo a mano.
 *
 * ── Por que el aviso obliga a fusionar el movimiento con el cierre ────────────────────
 * El aviso de entrada (`avisar_al_entrar`) lo dispara un trigger colgado del UPDATE de
 * `negocios.etapa_actual_id`, y en esta etapa lleva `email: true`. Si el caso se mueve
 * primero y se cierra despues, financiera recibe **un correo** pidiendo emitir una factura
 * que ya existe, sobre un negocio que ya cerro. Un correo no se desmanda. Por eso la etapa y
 * el cierre viajan en el MISMO update, y el trigger aprendio a callarse cuando el negocio
 * llega cerrado (migracion `20260818000001`).
 *
 * ── Que NO hace ───────────────────────────────────────────────────────────────────────
 * No decide si el gate esta cumplido: eso lo sigue respondiendo `validarGateFacturaEmitida`,
 * la MISMA funcion que valida el cierre manual. Dos criterios distintos para "esta facturado"
 * divergirian, y el sintoma seria un negocio que cierra solo cuando a mano no dejaria.
 *
 * Tampoco cierra un caso que YA ESTA parado en la etapa de cierre y luego recibe su factura:
 * eso es otro disparador (la emision, no la llegada) y otra superficie. Ver el pendiente.
 */

/** Lo minimo que hay que saber de la etapa DESTINO para decidir. */
export interface DestinoCierre {
  /** `config_extra.etapa_cierre === true`: la linea declara que aqui cierra el proceso. */
  esCierre: boolean
  /**
   * ¿El gate de la etapa destino esta satisfecho AHORA?
   *
   * Lo resuelve quien llama con la funcion de siempre. `null` significa "no se pudo
   * comprobar", y NO es lo mismo que `false`.
   */
  gateCumplido: boolean | null
}

/**
 * ¿Esta linea cierra sola cuando el caso llega resuelto?
 *
 * Opt-in por LINEA (`config_extra.cierre_automatico.activa`). Solo el booleano `true` la
 * enciende: cerrar un negocio es irreversible para el equipo que lo mira, demasiado caro para
 * que lo dispare una config a medio escribir. Mismo criterio que `reversaActiva`.
 */
export function cierreAutomaticoActivo(
  configExtraLinea: Record<string, unknown> | null | undefined,
): boolean {
  const cfg = configExtraLinea?.cierre_automatico as { activa?: unknown } | undefined
  return cfg?.activa === true
}

/**
 * ¿Este arribo cierra el negocio?
 *
 * Las tres condiciones son duras y ninguna se asume:
 *  1. la linea lo declaro,
 *  2. la etapa destino es la de cierre,
 *  3. su gate esta cumplido **comprobado**, no simplemente "sin error conocido".
 *
 * ⚠️ `gateCumplido: null` (no se pudo comprobar) NO cierra. El lado seguro de un control es
 * frenar y dejar el caso en la bandeja, que es exactamente lo que pasaba antes de este
 * cambio; cerrar por no poder leer el estado convierte una falla de lectura en un negocio
 * cerrado, y eso no se deshace desde la pantalla.
 */
export function cierraAlLlegar(destino: DestinoCierre, lineaActiva: boolean): boolean {
  if (!lineaActiva) return false
  if (!destino.esCierre) return false
  return destino.gateCumplido === true
}

/** El motivo que queda escrito en el timeline. Un cierre sin causa visible es un misterio. */
export const MOTIVO_CIERRE_AUTOMATICO =
  'Cerrado automáticamente al llegar a la etapa de cierre: la factura ya estaba emitida.'
