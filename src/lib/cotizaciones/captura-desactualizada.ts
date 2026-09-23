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
 * ## Qué frena (decisión de Mauricio, 2026-09-22)
 *
 * Mientras una línea esté en esta lista, la cotización **no sale de borrador**: ni «Enviar»
 * (editor y bloque), ni «Aprobar» desde borrador, ni el `estado` por la puerta genérica. El
 * control es del servidor (`captura-desactualizada-datos.ts`) y el botón del editor se
 * deshabilita con el MISMO texto, `motivoParaNoEnviar`: pantalla y servidor salen de estas
 * dos funciones y no se pueden separar.
 *
 * El PDF NO se frena: descargarlo en borrador sigue saliendo con el aviso. Y una cotización
 * que ya salió (`enviada`) se sigue pudiendo aprobar: registra lo que el cliente aceptó.
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
  /**
   * Qué la arregla. `pantallazo`: alguna captura es de otros pasajeros y hay que pegar una
   * nueva (y después confirmar). `confirmacion`: las capturas ya son las de hoy, falta
   * volver a confirmar el costo (otros pasajeros u otra moneda que la confirmada).
   */
  arreglo: 'pantallazo' | 'confirmacion'
}

/**
 * ¿Alguna línea tiene tarifa por pasajero (casillas leídas o un costo confirmado)?
 *
 * Es la puerta de R6: sin esto no hay nada que pueda quedar viejo, y quien pregunta (el PDF,
 * el freno de salida) se ahorra leer los pasajeros del viaje. Una cotización que no es de
 * viaje no paga esa consulta.
 */
export function hayTarifaPorPasajero(lineas: Array<{ tarifa_pax?: unknown }>): boolean {
  return lineas.some(l => {
    const t = leerTarifaPax(l.tarifa_pax)
    return !!t.confirmada || Object.keys(t.casillas ?? {}).length > 0
  })
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
    out.push({
      itemId: linea.id,
      nombre: (linea.nombre ?? '').trim() || 'Línea sin nombre',
      motivos,
      arreglo: capturas.length > 0 ? 'pantallazo' : 'confirmacion',
    })
  }
  return out
}

/** Cómo va a salir la cotización: el verbo del mensaje. */
export type SalidaDeBorrador = 'enviar' | 'aprobar'

/**
 * Por qué la cotización no puede salir, en lenguaje de operadora, o `null` si puede.
 *
 * Nombra las líneas y dice qué hacer con cada una, en dos grupos: las que necesitan un
 * pantallazo nuevo y las que solo necesitan volver a confirmar el costo. El detalle de
 * cada línea (para cuántos era la captura) ya lo dice su alerta y el aviso de la
 * cotización; esto es la orden corta que cabe en un toast y en el `title` del botón.
 *
 * Es el MISMO texto en la pantalla (botón deshabilitado) y en el servidor (el rechazo).
 */
export function motivoParaNoEnviar(
  lineas: LineaDesactualizada[],
  salida: SalidaDeBorrador = 'enviar',
): string | null {
  if (lineas.length === 0) return null
  const lista = (ls: LineaDesactualizada[]) => ls.map(l => `«${l.nombre}»`).join(', ')
  const pegar = lineas.filter(l => l.arreglo === 'pantallazo')
  const confirmar = lineas.filter(l => l.arreglo === 'confirmacion')
  const antes = salida === 'aprobar' ? 'Antes de aprobar' : 'Antes de enviar'
  const partes: string[] = []
  if (pegar.length > 0) partes.push(`${antes}, pega el pantallazo nuevo en: ${lista(pegar)}.`)
  if (confirmar.length > 0) {
    partes.push(
      pegar.length > 0
        ? `Y vuelve a confirmar el costo de: ${lista(confirmar)}.`
        : `${antes}, vuelve a confirmar el costo de: ${lista(confirmar)}.`,
    )
  }
  return partes.join(' ')
}
