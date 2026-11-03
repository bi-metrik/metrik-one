/**
 * Por qué una tarifa (o la cotización) pide la autorización del dueño, dicho por su causa real.
 *
 * Brief del 2026-10-28 (falla 2): con las reglas de margen un hotel con 15 % y 7 puntos de
 * descuento queda en 8 %, bajo el piso de hotel (10 %), y eso pide la autorización aunque el
 * margen global esté en 12,4 %. El aviso decía «Margen 12,4 %, mínimo 12 %», que se lee como una
 * contradicción. Ahora cada causa se dice por separado:
 *
 *  · **Hotel:** «Hotel Ficticio (recomendada) queda en 8 %, mínimo 10 %».
 *  · **Global:** lo de siempre, «Recomendada: margen 11,9 %, mínimo 12 %» (o «Margen …» sin tarifa).
 *  · **Las dos, o varios hoteles:** todas, en orden: hoteles primero, global después.
 *
 * Puro: lo usan la nota del editor (`nota-margen.ts`), el paso «Tarifas», y el pedido y el registro
 * de la autorización (`por-pasos-actions.ts`, `margen-salida-actions.ts`), para que lo que ve el
 * equipo y lo que le llega al dueño no se puedan contradecir.
 */

import { pctTexto } from './piso-salida'

export interface SujetoConCausas {
  /** La tarifa como se lee («Recomendada», «Opción 4»). `null` = la cotización entera. */
  nombre: string | null
  /** El margen global de la tarifa. `null` = no se puede medir. */
  margenPct: number | null
  /** Los hoteles que, con su descuento, quedaron bajo el piso de hotel. */
  hoteles?: readonly { nombre: string | null; margenPct: number }[]
  pisoHotelPct?: number
}

/** La opción entre paréntesis y en minúscula: «(recomendada)». Sin tarifa, nada. */
function opcion(nombre: string | null): string {
  if (!nombre) return ''
  return ` (${nombre.charAt(0).toLocaleLowerCase('es') + nombre.slice(1)})`
}

/**
 * Las causas de un sujeto, en el orden en que se leen. Vacío = nada que ver con el margen (está
 * en el mínimo o encima, o no se puede medir y no tiene hoteles bajos).
 */
export function causasBajoMinimo(s: SujetoConCausas, pisoPct: number): string[] {
  const causas: string[] = []
  const pisoHotel = s.pisoHotelPct ?? 0
  for (const h of s.hoteles ?? []) {
    causas.push(`${h.nombre || 'Un hotel'}${opcion(s.nombre)} queda en ${pctTexto(h.margenPct, pisoHotel)}, mínimo ${pctTexto(pisoHotel)}`)
  }
  if (s.margenPct !== null && s.margenPct < pisoPct) {
    const cifra = `${pctTexto(s.margenPct, pisoPct)}, mínimo ${pctTexto(pisoPct)}`
    causas.push(s.nombre ? `${s.nombre}: margen ${cifra}` : `Margen ${cifra}`)
  }
  return causas
}

/** Un sujeto de la salida (`SujetoDeSalida`), con lo que hace falta para decir sus causas. */
export interface SujetoQueFrena {
  tipo: 'tarifa' | 'cotizacion'
  nombre: string | null
  margenRealPct: number | null
  hotelesBajoPiso?: readonly { nombre: string | null; margenPct: number }[]
  pisoHotelPct?: number
}

/**
 * Lo que la vista de la salida (`getSalidaDeCotizacion`) le pasa a la nota: cada sujeto que frena
 * con su margen y, si los hay, los hoteles bajo su piso.
 */
export function bajoMinimoParaNota(sujetos: readonly SujetoQueFrena[]): { nombre: string | null; margenPct: number | null; hoteles?: { nombre: string | null; margenPct: number }[]; pisoHotelPct?: number }[] {
  return sujetos.map(s => ({
    nombre: s.nombre,
    margenPct: s.margenRealPct,
    ...(s.hotelesBajoPiso?.length ? { hoteles: [...s.hotelesBajoPiso], pisoHotelPct: s.pisoHotelPct } : {}),
  }))
}

/**
 * El paréntesis del pedido y del registro de la autorización. Los hoteles bajo su piso, con su
 * nombre; el margen global, como siempre («tarifa Recomendada al 11,9 %»), solo si es causa o si
 * no hay otra (no se puede medir).
 */
export function detalleDeCausas(sujetos: readonly SujetoQueFrena[], pisoPct: number): string {
  let conHotel = false
  const partes = sujetos.flatMap(s => {
    const hoteles = causasBajoMinimo({ nombre: s.nombre, margenPct: null, hoteles: s.hotelesBajoPiso, pisoHotelPct: s.pisoHotelPct }, pisoPct)
    if (hoteles.length > 0) conHotel = true
    const globalEsCausa = s.margenRealPct === null || s.margenRealPct < pisoPct
    if (hoteles.length > 0 && !globalEsCausa) return hoteles
    const quien = s.tipo === 'tarifa' ? `tarifa ${s.nombre}` : 'cotización'
    return [...hoteles, `${quien} al ${s.margenRealPct === null ? 'sin margen medible' : pctTexto(s.margenRealPct, pisoPct)}`]
  })
  // La causa de un hotel ya lleva coma («queda en 8 %, mínimo 10 %»): con ella, punto y coma.
  return partes.join(conHotel ? '; ' : ', ')
}
