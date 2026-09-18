/**
 * Cuándo un reproceso queda rehecho: el caso volvió a ALCANZAR la etapa de la que salió.
 *
 * El reproceso devuelve el caso a una etapa anterior para rehacer un tramo. La marca
 * (`negocios.metadata.reproceso`) queda `activo: true` hasta que alguien pulse "Cerrar" en
 * el banner rojo. Medido el 2026-09-18 en SOENA: 27 casos con marca, **22 seguían activos y
 * solo 5 se habían cerrado a mano**. El contador de "reprocesos abiertos" del tablero de
 * proceso queda inflado, y el botón "Reprocesar" se escondía mientras hubiera uno activo.
 *
 * ── El criterio, y lo que NO es ────────────────────────────────────────────────────
 * Cierra cuando el caso alcanza su **etapa de origen** (`etapa_origen`: de dónde salió),
 * NO cuando supera su etapa de retorno (a dónde volvió). La diferencia es todo el
 * mecanismo: si un reproceso devuelve el caso de Seguimiento a Cita y el caso avanza un
 * paso a Notificación, ya superó la etapa de retorno pero el tramo NO está rehecho —
 * cerrarlo ahí sería cerrar de mentiras. Criterio explícito de Vera (2026-09-18).
 *
 * "Alcanzar" se mide por el **FLUJO del routing**, no por `orden`, con la misma primitiva
 * que usa `tramoDelReproceso` (`alcanzablesPorFlujo`). En la línea GIT EV/HEV de SOENA el
 * flujo DIAN es Cita (16) → Notificación (17) → Anexos (18) → Generación (13) → Envío (14)
 * → Seguimiento (19) → Facturación (15): un caso que salió de Seguimiento (19) y hoy está
 * en Facturación (15) SÍ rehizo el tramo, y comparando `orden` parecería que retrocedió.
 * Al revés, uno que salió de Envío (14) y está en Generación (13) NO lo rehizo, porque
 * Generación va ANTES de Envío en el flujo aunque su `orden` sea menor.
 *
 * ── Tres formas de NO cerrar, todas deliberadas ────────────────────────────────────
 * 1. **Sin `etapa_origen`**: los 22 reprocesos vivos nacieron antes de que la marca lo
 *    guardara. No se adivina de dónde salieron: se quedan con el botón manual hasta que el
 *    backfill les escriba el dato. Un cierre falso borra un pendiente real.
 * 2. **`etapa_origen` que ya no existe en la línea** (alguien renombró la etapa): tampoco
 *    se cierra. El lado seguro de este control es dejarlo abierto, que es visible y se
 *    corrige con un clic; cerrarlo de más lo vuelve invisible.
 * 3. **No alcanzado**: el caso todavía está recorriendo el tramo.
 *
 * Puro: no toca base ni red.
 */

import { alcanzablesPorFlujo, type EtapaRetorno } from './retorno-reproceso'

/** Lo que el cierre automático necesita de `negocios.metadata.reproceso`. */
export interface MarcaParaCierre {
  activo?: boolean
  ciclo?: number
  etapa_origen?: string | null
}

export type MotivoNoCierra =
  | 'sin_marca'
  | 'no_activo'
  | 'sin_origen'
  | 'origen_desconocido'
  | 'no_alcanzado'

export type DecisionCierre =
  | { cierra: false; motivo: MotivoNoCierra }
  | { cierra: true; ciclo: number; etapaOrigen: string }

/**
 * ¿El avance a `ordenDestino` deja el reproceso rehecho?
 *
 * `ordenDestino` es la etapa a la que el caso ACABA de llegar (ya resuelto el routing),
 * no la que pidió la pantalla: un salto por saldo puede aterrizar en otra.
 */
export function reprocesoQuedaRehecho(input: {
  marca: MarcaParaCierre | null | undefined
  etapas: readonly EtapaRetorno[]
  ordenDestino: number
}): DecisionCierre {
  const { marca, etapas, ordenDestino } = input
  if (!marca) return { cierra: false, motivo: 'sin_marca' }
  if (marca.activo !== true) return { cierra: false, motivo: 'no_activo' }

  const origen = typeof marca.etapa_origen === 'string' ? marca.etapa_origen.trim() : ''
  if (!origen) return { cierra: false, motivo: 'sin_origen' }

  const etapaOrigen = etapas.find((e) => e.nombre === origen)
  if (!etapaOrigen) return { cierra: false, motivo: 'origen_desconocido' }

  if (!alcanzablesPorFlujo(etapas, etapaOrigen.orden).has(ordenDestino)) {
    return { cierra: false, motivo: 'no_alcanzado' }
  }

  // El ciclo identifica qué fila de `reproceso_eventos` hay que cerrar. Sin él no se
  // toca el evento: cerrar el ciclo equivocado corrompe el insumo del 40% del bono.
  const ciclo = typeof marca.ciclo === 'number' ? marca.ciclo : 0
  if (ciclo <= 0) return { cierra: false, motivo: 'sin_marca' }

  return { cierra: true, ciclo, etapaOrigen: origen }
}
