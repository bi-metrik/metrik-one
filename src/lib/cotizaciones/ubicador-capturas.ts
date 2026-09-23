/**
 * La fila que ubica las capturas de la bandeja (P7), sacada del componente para poder probarla.
 *
 * Detectar y leer van en paralelo, pero UBICAR va en fila: dos capturas del mismo vuelo nuevo
 * pegadas a la vez crearían dos ranuras si las dos preguntaran al mismo tiempo. La fila recuerda
 * las ranuras que ella misma creó, porque la lectura de la primera opción puede no haber
 * terminado (ni la base haberla devuelto) cuando llega la segunda captura.
 *
 * ⚠️ Lo que recuerda se OLVIDA cuando la última opción de esa ranura se borra (la × de la fila o
 * una lectura rechazada). Hasta el 2026-09-23 la memoria solo crecía: la ranura desaparecía de la
 * base y seguía siendo candidata, así que todo hotel pegado después iba como «hermana» a un grupo
 * muerto y el asesor veía «Esa ranura ya no tiene opciones» en rojo (COT-2026-0011).
 *
 * Red de seguridad: si aun así la ranura elegida ya no tiene opciones (la base cambió entre la
 * detección y la creación), se crea una nueva y se sigue. Ese error nunca llega al asesor.
 *
 * Puro de red: las acciones del servidor entran por parámetro.
 */

import { ubicarCaptura, type CapturaDetectada, type RanuraCandidata } from './bandeja-capturas'

/** Una ranura que la cotización ya tiene, con su nombre visible (`ranurasConLugar`). */
export interface RanuraExistente {
  grupo: string
  etiqueta: string
  lugar: string | null
  origen: string | null
  destino: string | null
}

export type ResultadoCrear =
  | { success: true; itemId: string; grupo: string; etiqueta?: string | null }
  | { success: false; error: string }

export type ResultadoAgregar =
  | { success: true; itemId: string; grupo: string }
  | { success: false; error: string; codigo?: string }

export interface AccionesDeUbicacion {
  agregar: (grupo: string) => Promise<ResultadoAgregar>
  crear: (captura: CapturaDetectada) => Promise<ResultadoCrear>
}

export type Ubicada =
  | { ok: true; itemId: string; grupo: string; como: 'hermana' | 'nueva'; etiqueta: string | null }
  | { ok: false; error: string }

/** El código con el que `agregarOpcionARanura` dice que la ranura ya no existe. */
export const SIN_OPCIONES = 'SIN_OPCIONES'

interface Creada extends RanuraCandidata {
  etiqueta: string | null
  /** Las opciones de esta ranura que salieron de la bandeja. Vacía = la ranura ya no existe. */
  opciones: Set<string>
}

export function crearUbicador(acciones: AccionesDeUbicacion) {
  let fila: Promise<unknown> = Promise.resolve()
  const creadas: Creada[] = []

  async function crearNueva(captura: CapturaDetectada): Promise<Ubicada> {
    const r = await acciones.crear(captura)
    if (!r.success) return { ok: false, error: r.error }
    creadas.push({
      grupo: r.grupo,
      tipo: captura.tipo,
      lugar: captura.lugar,
      origen: captura.origen,
      destino: captura.destino,
      etiqueta: r.etiqueta ?? null,
      opciones: new Set([r.itemId]),
    })
    return { ok: true, itemId: r.itemId, grupo: r.grupo, como: 'nueva', etiqueta: r.etiqueta ?? null }
  }

  async function ubicarAhora(captura: CapturaDetectada, ranuras: readonly RanuraExistente[]): Promise<Ubicada> {
    // Lo que la base sabe de cada ranura, completado con lo que esta fila recuerda de las que
    // creó: la lectura de su primera opción puede no haber terminado todavía.
    const candidatas: RanuraCandidata[] = [
      ...ranuras.map(r => {
        const aqui = creadas.find(c => c.grupo === r.grupo)
        return {
          grupo: r.grupo,
          tipo: captura.tipo,
          lugar: r.lugar ?? aqui?.lugar ?? null,
          origen: r.origen ?? aqui?.origen ?? null,
          destino: r.destino ?? aqui?.destino ?? null,
        }
      }),
      ...creadas.filter(c => !ranuras.some(r => r.grupo === c.grupo)),
    ]
    const u = ubicarCaptura(captura, candidatas)
    if (u.como === 'nueva') return crearNueva(captura)

    const r = await acciones.agregar(u.grupo)
    if (!r.success) {
      if (r.codigo === SIN_OPCIONES) {
        // La ranura murió entre la detección y ahora: se olvida y la captura abre una nueva.
        const i = creadas.findIndex(c => c.grupo === u.grupo)
        if (i >= 0) creadas.splice(i, 1)
        return crearNueva(captura)
      }
      return { ok: false, error: r.error }
    }
    const aqui = creadas.find(c => c.grupo === r.grupo)
    aqui?.opciones.add(r.itemId)
    const etiqueta = ranuras.find(x => x.grupo === r.grupo)?.etiqueta ?? aqui?.etiqueta ?? null
    return { ok: true, itemId: r.itemId, grupo: r.grupo, como: 'hermana', etiqueta }
  }

  return {
    /** Ubica una captura. Nunca corren dos a la vez. */
    ubicar(captura: CapturaDetectada, ranuras: readonly RanuraExistente[]): Promise<Ubicada> {
      const tarea = fila.then(() => ubicarAhora(captura, ranuras))
      fila = tarea.catch(() => undefined)
      return tarea
    },
    /** La opción se borró: si era la última de una ranura creada aquí, la ranura se olvida. */
    olvidarOpcion(itemId: string) {
      for (let i = creadas.length - 1; i >= 0; i--) {
        const c = creadas[i]
        if (!c.opciones.delete(itemId)) continue
        if (c.opciones.size === 0) creadas.splice(i, 1)
      }
    },
    /** Para las pruebas: los grupos que la fila recuerda. */
    recordadas(): string[] {
      return creadas.map(c => c.grupo)
    },
  }
}

export type Ubicador = ReturnType<typeof crearUbicador>
