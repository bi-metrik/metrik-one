/**
 * Relectura del veredicto guardado de un documento (`data._cross_check`) AL LEER el negocio.
 *
 * El veredicto se calcula una vez, al cargar el archivo, y se guarda. Dos cosas lo dejan
 * viejo sin que nadie toque el documento:
 *
 * - **Cambia la regla.** Medido en SOENA el 2026-10-01: certificados que avisaban «MG»
 *   contra «MG» o «79485203» contra «79485203» porque se evaluaron con una versión
 *   anterior de las comparaciones, y nombres que hoy coinciden (la N griega de V0507, el
 *   segundo apellido que falta en el RUT de V0521).
 * - **Llega el otro lado.** Un certificado cargado antes que el RUT guardó «esperado: (vacío)»
 *   y falla para siempre, aunque el RUT ya diga lo mismo.
 *
 * Por eso cada fila que FALLA se vuelve a comparar contra los datos de hoy, con las mismas
 * fuentes y las mismas comparaciones de la carga (`comparar-check.ts`).
 *
 * ⚠️ Solo absuelve, nunca condena. Una fila que pasó al cargar no se vuelve falla aquí:
 * la lectura de la ficha no siempre trae todos los bloques que la carga consultó (la
 * condición de `required_when`, por ejemplo), y decidir una falla con datos incompletos es
 * peor que dejar el veredicto que ya estaba. Lo que SÍ puede pasar con datos incompletos es
 * que la fila siga fallando, que es lo que ya mostraba. Las contradicciones en vivo son
 * trabajo de los cruces de la línea (`negocios/cruces.ts`), que se evalúan en cada lectura.
 *
 * La vigencia no pasa por aquí: tiene su propio refresco (`refrescar-vigencia.ts`), porque
 * su veredicto depende del día de hoy y de la cita, no de un texto. Derivado, no se persiste.
 */

import { sociedadAcompananteSeSalta } from './check-opcional'
import { resolverDesdeFuente, type CrossCheckMatchMode, type CrossCheckSource } from './comparar-check'
import type { CondicionBloque } from '@/lib/negocios/condicion-bloque'
import type { CrossCheckGuardado, ResultadoCrossCheck } from './refrescar-vigencia'

/** La parte de la config de un check que hace falta para volver a compararlo. */
export type SpecRelectura = CrossCheckSource & {
  slug: string
  match_mode?: string
  tolerancia_cop?: number
  source_alternatives?: CrossCheckSource[] | null
  optional?: boolean
  required_when?: CondicionBloque | null
}

/** Los datos de hoy de los bloques del negocio, por slug y (legacy) por etapa y nombre. */
export type DatosRelectura = {
  porSlug: Record<string, Record<string, unknown>>
  porEtapaBloque?: Record<number, Record<string, Record<string, unknown>>>
}

const MODOS_DE_TEXTO = new Set(['exact', 'tokens', 'subset', 'id_prefix', 'overlap', 'monto'])

function estadoDe(r: ResultadoCrossCheck): 'ok' | 'falla' | 'no_comprobable' {
  return r.estado ?? (r.ok ? 'ok' : 'falla')
}

function datosDeFuente(src: CrossCheckSource, datos: DatosRelectura): Record<string, unknown> | undefined {
  return (src.source_bloque_slug ? datos.porSlug[src.source_bloque_slug] : undefined)
    ?? datos.porEtapaBloque?.[src.source_etapa_orden]?.[String(src.source_bloque_nombre ?? '').trim().toLowerCase()]
}

/**
 * El veredicto con las filas que hoy coinciden pasadas a `ok`. Devuelve el MISMO objeto
 * si nada cambió, para que quien llama no reescriba el `data` del bloque por gusto.
 */
export function absolverCrossCheck(
  cc: CrossCheckGuardado | null | undefined,
  checks: SpecRelectura[] | null | undefined,
  datos: DatosRelectura,
): CrossCheckGuardado | null | undefined {
  if (!cc || !Array.isArray(cc.results) || cc.results.length === 0) return cc
  const specPorSlug = new Map((checks ?? []).filter(c => c?.slug).map(c => [c.slug, c]))
  if (specPorSlug.size === 0) return cc

  let cambio = false
  const results = cc.results.map(r => {
    if (estadoDe(r) !== 'falla') return r
    const spec = specPorSlug.get(r.slug)
    if (!spec) return r
    const modo = (spec.match_mode ?? 'exact') as CrossCheckMatchMode
    if (!MODOS_DE_TEXTO.has(modo)) return r
    // Sin valor extraído no hay nada que absolver: un dato que falta (el segundo
    // solicitante de una copropiedad) sigue faltando.
    const extraido = String(r.extracted ?? '')
    if (!extraido) return r
    let esperadoHoy = ''
    for (const src of [spec, ...(spec.source_alternatives ?? [])]) {
      const srcData = datosDeFuente(src, datos)
      if (!srcData) continue
      const v = resolverDesdeFuente(src, srcData, extraido, modo, { tolerancia_cop: spec.tolerancia_cop })
      if (v.estado === 'ok') {
        cambio = true
        return { ...r, expected: v.expected, ok: true, estado: 'ok' as const }
      }
      if (!esperadoHoy && v.expected) esperadoHoy = v.expected
    }
    // La misma excepción que en la carga: una sociedad en el lugar opcional, sin nada
    // contra qué compararla hoy, en un negocio que no exige ese lugar.
    const fuentes = { porSlug: datos.porSlug, porEtapaOrden: {} }
    if (!esperadoHoy && sociedadAcompananteSeSalta(spec, extraido, '', fuentes)) {
      cambio = true
      return { ...r, ok: true, estado: 'ok' as const }
    }
    return r
  })
  if (!cambio) return cc
  return { ...cc, results, passed: results.every(r => estadoDe(r) !== 'falla') }
}
