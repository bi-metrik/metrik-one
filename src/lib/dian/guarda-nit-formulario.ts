/**
 * Guarda de los formularios DIAN: no se genera con el DV pegado al NIT.
 *
 * La normalización (`@/lib/documentos/normalizaciones`) corrige el NIT al extraer o
 * reprocesar el RUT, pero no alcanza a lo que YA estaba guardado, ni a un override que
 * alguien escribió a mano en la casilla. Un Formulario 010 radicado con la cédula y
 * el DV pegados identifica a otra persona ante la DIAN, así que la última barrera va
 * justo antes de generar el PDF.
 *
 * El testigo es el mismo de la normalización: la casilla 26 (`numero_identificacion`)
 * del MISMO bloque del que sale el NIT. Si el NIT que se va a imprimir es esa
 * identificación seguida de su DV, se frena. Sin identificación no se adivina: la
 * trampa de `separarNitDv` (ver `nit.ts`) es exactamente adivinar.
 *
 * Puro: quien llama resuelve los valores con `resolverCamposFuente`.
 */

import { nitTraeDvDeLaIdentificacion } from './nit'

export const MENSAJE_NIT_CON_DV_PEGADO =
  'El NIT del RUT trae pegado el dígito de verificación: corrígelo en el bloque RUT antes de generar'

/** Los formularios DIAN que imprimen el NIT del solicitante con su DV aparte. */
const TEMPLATES_CON_NIT = new Set(['formulario-010', 'formulario-1668'])

/** Lo mínimo de `CampoFuente` que la guarda necesita leer. */
export interface FuenteConSlug {
  bloque_slug?: string
  etapa_orden: number
  bloque_orden: number
  campo_slug?: string
  campos_slug?: string[]
  join?: string
  tipo: string
}

export interface CampoFuenteMinimo {
  slug: string
  optional?: boolean
  source: FuenteConSlug
}

const PREFIJO_SONDA = '__identificacion_de__'

/**
 * Las casillas del formulario que se llenan con el campo `nit` de un documento.
 *
 * En SOENA son dos formas distintas y las dos cuentan: el 010 lo llama `nit`, el 1668
 * lo llama `numero_identificacion`. Por eso se decide por la FUENTE (`campo_slug`), no
 * por el nombre de la casilla.
 */
function casillasConNit(template: string, campos: CampoFuenteMinimo[]): CampoFuenteMinimo[] {
  if (!TEMPLATES_CON_NIT.has(template)) return []
  return campos.filter((c) => c.source?.tipo === 'ai' && c.source.campo_slug === 'nit' && !c.source.campos_slug?.length)
}

/**
 * Campos de fuente adicionales que leen la identificación del mismo bloque de cada NIT.
 * Opcionales: si el documento no la trae, no aparecen como faltantes.
 */
export function sondasDeIdentificacion(template: string, campos: CampoFuenteMinimo[]): CampoFuenteMinimo[] {
  return casillasConNit(template, campos).map((c) => ({
    slug: PREFIJO_SONDA + c.slug,
    optional: true,
    source: { ...c.source, campo_slug: 'numero_identificacion', campos_slug: undefined },
  }))
}

/** Saca los valores de las sondas de `datos` (los muta) y los devuelve aparte. */
export function separarSondas(datos: Record<string, string | null>): Record<string, string | null> {
  const sondas: Record<string, string | null> = {}
  for (const k of Object.keys(datos)) {
    if (!k.startsWith(PREFIJO_SONDA)) continue
    sondas[k] = datos[k]
    delete datos[k]
  }
  return sondas
}

/**
 * ¿Alguna casilla con NIT va a salir con el DV pegado? Devuelve el mensaje, o null.
 *
 * @param datosFinal  los valores que se van a imprimir, YA con los overrides aplicados.
 * @param sondas      lo que devolvió `separarSondas`.
 */
export function nitConDvPegadoEnFormulario(
  template: string,
  campos: CampoFuenteMinimo[],
  datosFinal: Record<string, string | null>,
  sondas: Record<string, string | null>,
): string | null {
  for (const c of casillasConNit(template, campos)) {
    const identificacion = sondas[PREFIJO_SONDA + c.slug]
    if (nitTraeDvDeLaIdentificacion(datosFinal[c.slug], identificacion)) return MENSAJE_NIT_CON_DV_PEGADO
  }
  return null
}
