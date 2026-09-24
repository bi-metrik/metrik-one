/**
 * Guarda de los documentos para la DIAN: ninguno se imprime con el código del tipo de
 * documento pegado al número de identificación.
 *
 * V0177 salió con la declaración juramentada y la relación de facturas a nombre de
 * 132747706 cuando la cédula es 32747706: la extracción del RUT pegó el «1» de la casilla
 * 25 (tipo de documento, «13» = cédula de ciudadanía) delante de la casilla 26. La
 * normalización lo corrige al extraer (`normalizarIdentificacionRut`) y el voto lo marca
 * dudoso, pero ninguno de los dos alcanza a un override escrito a mano en la casilla, ni a
 * una línea que no declare el voto. Esta es la última barrera, justo antes del PDF.
 *
 * El testigo es la OTRA casilla del mismo bloque: para una casilla que imprime el número
 * de identificación (casilla 26), el NIT (casilla 5); para una que imprime el NIT, la
 * casilla 26. Si lo que se va a imprimir es el testigo con el código pegado delante
 * (`sinPrefijoDeTipo`), se niega la generación. Sin testigo no se adivina.
 *
 * Aplica a toda plantilla: el número de un titular no se imprime con el prefijo en ningún
 * documento. Puro: quien llama resuelve los valores con `resolverCamposFuente`.
 */

import type { CampoFuenteMinimo } from './guarda-nit-formulario'
import { sinPrefijoDeTipo } from './prefijo-tipo-documento'

const PREFIJO_SONDA = '__contraparte_de__'

/** Casilla 26 ↔ casilla 5: cada una es el testigo de la otra. */
const CONTRAPARTE: Record<string, string> = { numero_identificacion: 'nit', nit: 'numero_identificacion' }

/** Las casillas que se llenan con el número de un titular, leído de un documento. */
function casillasConIdentificacion(campos: CampoFuenteMinimo[]): CampoFuenteMinimo[] {
  return campos.filter(
    (c) =>
      c.source?.tipo === 'ai' &&
      !!c.source.campo_slug &&
      c.source.campo_slug in CONTRAPARTE &&
      !c.source.campos_slug?.length,
  )
}

/**
 * Campos de fuente adicionales que leen la casilla contraparte del mismo bloque. Opcionales:
 * si el documento no la trae, no aparecen como faltantes.
 */
export function sondasDeContraparte(campos: CampoFuenteMinimo[]): CampoFuenteMinimo[] {
  return casillasConIdentificacion(campos).map((c) => ({
    slug: PREFIJO_SONDA + c.slug,
    optional: true,
    source: { ...c.source, campo_slug: CONTRAPARTE[c.source.campo_slug as string], campos_slug: undefined },
  }))
}

/** Saca los valores de estas sondas de `datos` (los muta) y los devuelve aparte. */
export function separarSondasDeContraparte(datos: Record<string, string | null>): Record<string, string | null> {
  const sondas: Record<string, string | null> = {}
  for (const k of Object.keys(datos)) {
    if (!k.startsWith(PREFIJO_SONDA)) continue
    sondas[k] = datos[k]
    delete datos[k]
  }
  return sondas
}

/**
 * ¿Alguna casilla va a salir con el código del tipo de documento pegado? Devuelve el
 * mensaje, o null.
 *
 * @param datosFinal  los valores que se van a imprimir, YA con los overrides aplicados.
 * @param sondas      lo que devolvió `separarSondasDeContraparte`.
 */
export function identificacionConPrefijoEnFormulario(
  campos: CampoFuenteMinimo[],
  datosFinal: Record<string, string | null>,
  sondas: Record<string, string | null>,
): string | null {
  for (const c of casillasConIdentificacion(campos)) {
    const impreso = datosFinal[c.slug]
    const limpio = sinPrefijoDeTipo(impreso, sondas[PREFIJO_SONDA + c.slug])
    if (limpio) {
      return (
        `El número de identificación ${String(impreso).replace(/\D/g, '')} trae pegado delante el código del ` +
        `tipo de documento (13 = cédula de ciudadanía): el número es ${limpio}. Corrígelo en el RUT antes de generar.`
      )
    }
  }
  return null
}
