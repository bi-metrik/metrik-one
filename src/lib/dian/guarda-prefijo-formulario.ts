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
 *
 * Tampoco se imprime si una de las dos casillas es la otra con uno o dos dígitos de más,
 * sea o no el DV lo que sobra (la casilla 26 nunca lleva DV): V0326 520238523 / 52023852, V0354 168394259 / 16839425,
 * V0361 397853081 / 39785308. No se sabe cuál de las dos está mal leída sin mirar el PDF,
 * así que se niega igual si lo que se imprime es la corta: el documento sale para la DIAN
 * con un número que el mismo RUT contradice. Números del todo distintos (una cédula de
 * extranjería, un NIT asignado antes de la cédula) no se parecen y no frenan nada.
 */

import type { CampoFuenteMinimo } from './guarda-nit-formulario'
import { conDigitosDeMas, sinPrefijoDeTipo } from './prefijo-tipo-documento'

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
  const d = (v: unknown) => String(v ?? '').replace(/\D/g, '')
  for (const c of casillasConIdentificacion(campos)) {
    const impreso = datosFinal[c.slug]
    const testigo = sondas[PREFIJO_SONDA + c.slug]
    const limpio = sinPrefijoDeTipo(impreso, testigo)
    if (limpio) {
      return (
        `El número de identificación ${d(impreso)} trae pegado delante el código del ` +
        `tipo de documento (13 = cédula de ciudadanía): el número es ${limpio}. Corrígelo en el RUT antes de generar.`
      )
    }
    const [i, t] = [d(impreso), d(testigo)]
    if (conDigitosDeMas(i, t) || conDigitosDeMas(t, i)) {
      const [casilla, otra] = c.source?.campo_slug === 'nit' ? ['5', '26'] : ['26', '5']
      return (
        `El RUT no cuadra: la casilla ${casilla} dice ${i} y la casilla ${otra} dice ${t}. Una de las dos tiene ` +
        `dígitos de más o de menos. Mira el PDF del RUT y corrige la que esté mal leída antes de generar.`
      )
    }
  }
  return null
}
