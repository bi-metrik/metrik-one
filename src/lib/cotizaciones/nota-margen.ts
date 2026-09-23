/**
 * Qué dice la nota del margen mínimo, según lo que de verdad le pasa a la cotización.
 *
 * P1 del ensayo del 2026-09-23 (caso Providencia): con la cotización recién creada ya salía
 * en rojo «Bajo el margen mínimo: no se puede enviar ni aprobar», y pedía la firma del dueño.
 * Trataba «todavía no hay datos» como «el margen está por debajo del mínimo».
 *
 * Tres estados, y el bloqueo del servidor NO cambia en ninguno (`piso-salida.ts`): lo que
 * cambia es cómo se dice.
 *
 *  · **Sin líneas:** no hay nota. El botón de enviar queda apagado y dice por qué.
 *  · **Líneas sin costo ni precio:** un aviso neutro que dice cuántas faltan.
 *  · **Margen calculado y bajo el mínimo:** la nota roja de siempre, con el margen real.
 *
 * Puro: lo usan el panel y el botón «Enviar» del editor, para que el motivo del botón y el
 * de la nota no se puedan contradecir.
 */

import { pctTexto } from './piso-salida'

/** Lo que el servidor manda de la salida (`SalidaVista`), sin lo que no se usa aquí. */
export interface SalidaParaNota {
  aplica: boolean
  bloquea: boolean
  pisoPct: number | null
  excepcion: unknown | null
  lineas?: number
  lineasSinCosto?: number
  bajoMinimo?: { nombre: string | null; margenPct: number | null }[]
}

export type NotaDeMargen =
  /** Nada que decir: la línea no exige el piso, o está en el mínimo o encima. */
  | { tipo: 'nada' }
  /** Autorizada por el dueño: la nota verde de siempre. */
  | { tipo: 'autorizada' }
  /** Cotización vacía: sin nota, y el botón apagado con `motivoBoton`. */
  | { tipo: 'sin_lineas'; motivoBoton: string }
  /** Líneas sin costo ni precio: aviso neutro. */
  | { tipo: 'faltan_costos'; texto: string; motivoBoton: string | null }
  /** Margen medido y bajo el mínimo: la nota roja, con el margen real. */
  | { tipo: 'bajo_minimo'; titulo: string; motivoBoton: string }
  /** Frena por otra razón que no se resume en una cifra (una tarifa incompleta). */
  | { tipo: 'bloquea'; motivoBoton: string }

export const MOTIVO_SIN_LINEAS = 'Agrega al menos una línea con costo y precio'

/** «Falta el costo de 2 líneas para calcular el margen.» */
export function textoFaltanCostos(n: number): string {
  return n === 1
    ? 'Falta el costo de 1 línea para calcular el margen.'
    : `Falta el costo de ${n} líneas para calcular el margen.`
}

export function notaDeMargen(salida: SalidaParaNota | null | undefined): NotaDeMargen {
  if (!salida || !salida.aplica) return { tipo: 'nada' }
  if (salida.excepcion) return { tipo: 'autorizada' }

  const lineas = salida.lineas
  // `undefined` = una vista que no trae el conteo: se cae a la nota de siempre.
  if (lineas === 0) return { tipo: 'sin_lineas', motivoBoton: MOTIVO_SIN_LINEAS }

  const medidos = (salida.bajoMinimo ?? []).filter(s => s.margenPct !== null)
  if (salida.bloquea && medidos.length > 0 && salida.pisoPct !== null) {
    const piso = salida.pisoPct
    const minimo = pctTexto(piso)
    const titulo = medidos
      .map(s => {
        const cifra = `${pctTexto(s.margenPct as number, piso)}, mínimo ${minimo}`
        return s.nombre ? `${s.nombre}: margen ${cifra}` : `Margen ${cifra}`
      })
      .join(' · ')
    return { tipo: 'bajo_minimo', titulo: `${titulo}.`, motivoBoton: `${titulo}. Necesita la autorización del dueño.` }
  }

  const sinCosto = salida.lineasSinCosto ?? 0
  if (sinCosto > 0) {
    const texto = textoFaltanCostos(sinCosto)
    return { tipo: 'faltan_costos', texto, motivoBoton: salida.bloquea ? texto : null }
  }

  if (salida.bloquea) return { tipo: 'bloquea', motivoBoton: 'Bajo el margen mínimo: no se puede enviar.' }
  return { tipo: 'nada' }
}
