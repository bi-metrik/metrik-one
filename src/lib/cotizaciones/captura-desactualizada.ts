/**
 * Las líneas de una cotización cuyo pantallazo o cuyo costo cargado es de OTROS pasajeros.
 *
 * Brief del 2026-09-22, parte 1: *«a nivel de la cotización, un aviso visible que liste las
 * líneas con captura desactualizada»*. La alerta de cada línea vive dentro de la línea
 * (`tarifa-pasajero-item.tsx`); esto es la lista para quien mira la cotización entera, que
 * con nueve líneas cerradas no ve ninguna de esas alertas.
 *
 * ## Por qué hace falta aparte
 *
 * El cambio que deja viejas las capturas casi nunca ocurre en la cotización: ocurre en el
 * negocio, cuando alguien corrige los pasajeros del viaje. Quien vuelve a la cotización no
 * tiene por qué abrir línea por línea para enterarse de que el precio ya no corresponde.
 *
 * ## Qué NO hace
 *
 * No bloquea nada. En este producto no existe un control antes de enviar ni de emitir la
 * cotización donde sumar esta condición (enviar solo cambia el estado; el PDF no tiene
 * candado), y el brief pide no inventar un flujo: el aviso se ve, y la confirmación del costo
 * de cada línea sí se niega mientras su captura esté vieja.
 *
 * Puro: sin red, sin base.
 */

import { ranuraDeGrupo } from './ranuras-pantallazo'
import {
  capturasDesactualizadas,
  composicionDeLinea,
  confirmacionDesactualizada,
  leerTarifaPax,
  type Composicion,
} from './tarifa-pasajero'

export interface LineaParaAviso {
  id: string
  nombre?: string | null
  grupo?: string | null
  es_ajuste?: boolean | null
  tarifa_pax?: unknown
}

export interface LineaDesactualizada {
  itemId: string
  nombre: string
  /** Lo que dice cada alerta de la línea, en el mismo texto que la línea. */
  motivos: string[]
}

/**
 * Las líneas con algo desactualizado, en el orden en que llegan.
 *
 * Una línea sin ranura (sin contrato de pantallazo) no tiene capturas: nunca aparece. Por eso
 * esto no cambia nada en una cotización que no es de viaje (R6).
 *
 * ⚠️ Si las capturas de la línea ya están viejas, la confirmación también lo está por la misma
 * causa: se dice UNA vez, con el texto de las capturas, que es el que dice qué reemplazar.
 */
export function lineasDesactualizadas(
  lineas: LineaParaAviso[],
  composicionViaje: Composicion | null,
): LineaDesactualizada[] {
  const out: LineaDesactualizada[] = []
  for (const linea of lineas) {
    if (linea.es_ajuste) continue
    const ranura = ranuraDeGrupo(linea.grupo ?? null)
    if (!ranura) continue
    const tarifa = leerTarifaPax(linea.tarifa_pax)
    const composicion = composicionDeLinea(tarifa, composicionViaje)
    const capturas = capturasDesactualizadas(composicion, tarifa.casillas ?? {}, ranura.slug).map(c => c.mensaje)
    const confirmacion = confirmacionDesactualizada(tarifa, composicion)
    const motivos = capturas.length > 0 ? capturas : confirmacion ? [confirmacion.mensaje] : []
    if (motivos.length === 0) continue
    out.push({ itemId: linea.id, nombre: (linea.nombre ?? '').trim() || 'Línea sin nombre', motivos })
  }
  return out
}
