/**
 * Qué plantilla visual usa la cotización de cada workspace.
 *
 * La pregunta «qué formato tiene la cotización de este cliente» ya tenía UNA columna:
 * `workspaces.cotizacion_template_slug`. Nació apuntando a las plantillas HTML del
 * servicio externo `metrik-pdf-render` (WeasyPrint, Cloud Run), y hoy la usa un solo
 * workspace (`wmc-sm` → `wmc`).
 *
 * Este registro amplía esa misma columna en vez de abrir una segunda: un slug puede
 * resolverse ADENTRO, con @react-pdf, sin depender de que el servicio externo esté
 * configurado ni desplegado. La regla es explícita y vive aquí:
 *
 *   · slug en este registro   → se renderiza aquí, con @react-pdf.
 *   · slug fuera del registro → comportamiento intacto: servicio externo si el slug
 *                               no es `metrik` y las env vars están; si no, plantilla
 *                               por defecto.
 *
 * Un workspace que no declare un slug de este registro produce EXACTAMENTE el mismo
 * PDF que hoy: no cambia el componente, ni el orden de las ramas, ni las props que
 * recibe la plantilla por defecto.
 *
 * Dos columnas para la misma pregunta se desincronizan y el síntoma es mudo (el PDF
 * sale con el formato de otro). Por eso: una sola columna, un solo registro.
 */

import type { ComponentType } from 'react'

import type { CotizacionPDFProps } from './cotizacion-props'
import CotizacionTermotechPDF from './cotizacion-termotech-pdf'

/** Slug de la plantilla genérica de MeTRIK. Es el default de la columna. */
export const PLANTILLA_POR_DEFECTO = 'metrik'

const PLANTILLAS: Record<string, ComponentType<CotizacionPDFProps>> = {
  termotech: CotizacionTermotechPDF,
}

/**
 * Plantilla @react-pdf declarada para ese slug, o `null` si el slug no está aquí.
 *
 * `null` NO significa «no hay plantilla»: significa «esta capa no la resuelve», y el
 * llamador sigue con las ramas que ya existían.
 */
export function plantillaCotizacionPropia(
  slug: string | null | undefined,
): ComponentType<CotizacionPDFProps> | null {
  if (!slug) return null
  // `Object.hasOwn` y no `PLANTILLAS[slug]`: el slug viene de una columna de texto que
  // edita una persona, y sobre un objeto literal `PLANTILLAS['constructor']` devuelve
  // una función heredada del prototipo. Esa función acabaría en `createElement` y
  // reventaría el PDF de ese workspace. Probado.
  if (!Object.hasOwn(PLANTILLAS, slug)) return null
  return PLANTILLAS[slug]
}

/** Slugs con plantilla propia. Expuesto para pruebas y para el PR. */
export function slugsConPlantillaPropia(): string[] {
  return Object.keys(PLANTILLAS)
}
