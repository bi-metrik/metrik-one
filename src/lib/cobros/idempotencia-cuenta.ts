/**
 * ¿Ya hay una cuenta de cobro para este grupo de cobros? — la regla, en UN sitio.
 *
 * Antes la idempotencia del generador uniforme preguntaba "¿existe UNA cuenta de
 * esta empresa en este periodo?" con `.maybeSingle()` y descartaba el `error`.
 * Dos defectos en la misma linea:
 *
 *   1. Con DOS filas (la agrupada de AFI mas su cuenta de licencias, que sale por
 *      el camino del cronograma explicito) `maybeSingle` devuelve `data: null` y
 *      un error. El null se leia como "no hay cuenta" y se emitia otra. Desde que
 *      la ventana abre el dia 10 y no cierra, eso paso TODOS los dias:
 *      CC-2026-09-002, 005, 006, 007 y 008, identicas.
 *   2. No miraba el estado: una cuenta anulada bloqueaba la re-emision legitima,
 *      y la de otro plan (licencias) bloqueaba la agrupada si el camino uniforme
 *      habia fallado el dia 10.
 *
 * El criterio ahora es por COBROS, no por empresa+periodo: un grupo ya esta
 * emitido si sus cobros estan dentro de alguna cuenta viva (no anulada). La
 * consulta que alimenta esta funcion trae las cuentas del workspace cuyo
 * `cobros_ids` se cruza con el grupo, sin filtrar empresa ni periodo: un cobro
 * que ya esta en una cuenta viva no se vuelve a cobrar, venga de donde venga.
 *
 * Una interseccion PARCIAL (parte del grupo ya esta en una cuenta viva y parte
 * no) no se resuelve sola: emitir el resto seria inventar una re-emision parcial
 * que nadie pidio, y emitir el grupo entero cobraria dos veces lo ya cubierto.
 * Se omite y se reporta para que lo mire una persona.
 *
 * Modulo puro: sin Supabase, sin red. Se prueba sin dobles.
 */

export type CuentaExistente = {
  id: string
  numero: string
  estado: string
  cobros_ids: string[]
}

export type DecisionEmisionGrupo =
  | { accion: 'emitir' }
  | {
      accion: 'ya_emitida'
      /** Cuentas vivas que ya contienen cobros del grupo, en el orden recibido. */
      cuentas: CuentaExistente[]
    }
  | {
      accion: 'parcial'
      cuentas: CuentaExistente[]
      /** Cobros del grupo que ya estan en alguna cuenta viva. */
      cubiertos: string[]
      /** Cobros del grupo que no estan en ninguna. */
      sinCuenta: string[]
    }

/** Estado con el que una cuenta deja de contar: su cobro queda libre para emitirse. */
export const ESTADO_CUENTA_ANULADA = 'anulada'

export function decidirEmisionGrupo(
  cobrosGrupo: readonly string[],
  cuentas: readonly CuentaExistente[],
): DecisionEmisionGrupo {
  const grupo = new Set(cobrosGrupo)
  const vivasQueCruzan = cuentas.filter(
    (c) =>
      c.estado !== ESTADO_CUENTA_ANULADA &&
      (c.cobros_ids ?? []).some((id) => grupo.has(id)),
  )

  if (vivasQueCruzan.length === 0) return { accion: 'emitir' }

  const enCuenta = new Set(vivasQueCruzan.flatMap((c) => c.cobros_ids ?? []))
  const cubiertos = cobrosGrupo.filter((id) => enCuenta.has(id))
  const sinCuenta = cobrosGrupo.filter((id) => !enCuenta.has(id))

  if (sinCuenta.length === 0) return { accion: 'ya_emitida', cuentas: vivasQueCruzan }
  return { accion: 'parcial', cuentas: vivasQueCruzan, cubiertos, sinCuenta }
}

/** Texto del aviso de interseccion parcial. Nombra las cuentas y los cobros sueltos. */
export function mensajeInterseccionParcial(
  decision: Extract<DecisionEmisionGrupo, { accion: 'parcial' }>,
): string {
  const numeros = decision.cuentas.map((c) => c.numero).join(', ')
  return (
    `No se emitió: ${decision.cubiertos.length} de ` +
    `${decision.cubiertos.length + decision.sinCuenta.length} cobros ya están en ${numeros}. ` +
    `Cobros sin cuenta: ${decision.sinCuenta.join(', ')}. Revisar a mano antes de emitir.`
  )
}
