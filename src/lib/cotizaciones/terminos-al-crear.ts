/**
 * Los términos con los que NACE una cotización (C5, decisión de Mauricio del 2026-09-23).
 *
 * Hasta el PR #841 el texto base de la línea (`lineas_negocio.config_extra.terminos_base`)
 * solo se PROPONÍA al abrir el panel «Texto para el cliente» y había que guardarlo a mano:
 * si nadie abría el panel, el PDF salía sin términos. Ahora, al crear la cotización, se
 * guarda una COPIA en `cotizaciones.terminos_condiciones`. El asesor la edita después en el
 * mismo panel; si el texto base cambia, las cotizaciones ya creadas no cambian.
 *
 * Solo aplica donde el documento imprime el texto para el cliente
 * (`plantillaUsaTextoDelCliente`, hoy solo la plantilla de Trappvel). Cualquier otro
 * workspace nace como siempre, con `terminos_condiciones` en null, aunque su línea tuviera
 * un `terminos_base` escrito.
 *
 * El panel sigue proponiendo el texto base cuando una cotización NO tiene términos
 * (`terminosAlAbrir`): es lo que cubre a las creadas antes de este cambio, que no se tocan.
 * Con términos guardados, el panel muestra esos y no propone nada, así que no duplica ni
 * pisa lo que nació aquí.
 */

import { leerConfigTextoDeLinea } from './documento-cliente'
import { plantillaUsaTextoDelCliente } from '@/lib/pdf/plantillas-cotizacion'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Supabase = any

/**
 * La regla, pura: el texto base de la línea, normalizado, si la plantilla del workspace
 * imprime el texto del cliente. `null` en cualquier otro caso.
 */
export function terminosAlCrear(p: {
  plantillaSlug: string | null | undefined
  configExtraLinea: unknown
}): string | null {
  if (!plantillaUsaTextoDelCliente(p.plantillaSlug)) return null
  return leerConfigTextoDeLinea(p.configExtraLinea).terminosBase
}

/**
 * Lee la plantilla del workspace y, solo si es una que imprime el texto del cliente, la
 * línea del negocio. Devuelve los términos con los que debe nacer la cotización, o `null`.
 *
 * Tolerante a propósito: una lectura que falla deja la cotización sin términos, como antes
 * de este cambio (el panel los sigue proponiendo). Crear la cotización no puede depender de
 * que una consulta secundaria responda.
 */
export async function terminosInicialesDeCotizacion(
  supabase: Supabase,
  args: { workspaceId: string; negocioId: string | null },
): Promise<string | null> {
  if (!args.negocioId) return null
  try {
    const { data: ws, error: errWs } = await supabase
      .from('workspaces')
      .select('cotizacion_template_slug')
      .eq('id', args.workspaceId)
      .maybeSingle()
    if (errWs) return null
    const slug = (ws as { cotizacion_template_slug?: string | null } | null)?.cotizacion_template_slug ?? null
    // Los demás workspaces no pagan la segunda consulta.
    if (!plantillaUsaTextoDelCliente(slug)) return null

    const { data: negocio, error: errNeg } = await supabase
      .from('negocios')
      .select('lineas_negocio(config_extra)')
      .eq('id', args.negocioId)
      .maybeSingle()
    if (errNeg) return null
    // El embed llega como objeto o como array de uno según cómo resuelva PostgREST la FK.
    const linea = (negocio as { lineas_negocio?: unknown } | null)?.lineas_negocio
    const fila = Array.isArray(linea) ? linea[0] : linea
    const configExtra = (fila as { config_extra?: unknown } | null | undefined)?.config_extra ?? null
    return terminosAlCrear({ plantillaSlug: slug, configExtraLinea: configExtra })
  } catch {
    return null
  }
}
