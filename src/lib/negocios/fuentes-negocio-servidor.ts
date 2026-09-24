/**
 * El `ContextoFuentes` de UN negocio, leído de la base. Lo usan la ficha (tarjeta de
 * datos clave) y el avance de etapa (gate de cruces), que tienen que ver exactamente lo
 * mismo: si la tarjeta mostrara una contradicción que el gate no ve, o al revés, el
 * equipo aprendería a no creerle a ninguno de los dos.
 *
 * - Los datos se traen por el slug del bloque ORIGEN dentro de la línea (las copias
 *   heredadas tienen `slug` nulo y no entran). Misma consulta que usa el historial para
 *   resolver las fuentes de un bloque reactivado.
 * - «¿Le aplica?» lo decide `condicion_cumplida`, la función SQL de los gates y el
 *   routing, más `desactivado`. Nunca una lectura propia de la `condition`.
 * - Cada condición se resuelve una sola vez por lectura (memo por su JSON).
 *
 * No es un archivo `'use server'`: exportar esto desde uno lo volvería un endpoint.
 */

import { aplanarDataBloque } from './referencias-fuente'
import { memoizar, type ContextoFuentes } from './fuentes-negocio'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(client: unknown): any { return client }

type Opcion = { value?: unknown; label?: unknown }
type Campo = { slug?: unknown; opciones?: Opcion[] }

export async function contextoFuentesDelNegocio(
  supabase: unknown,
  args: { negocioId: string; lineaId: string; etapaActualId: string | null; slugs: string[] },
): Promise<ContextoFuentes> {
  const { negocioId, lineaId, etapaActualId } = args
  const vacio: ContextoFuentes = {
    porSlug: {},
    aplica: async () => false,
    evaluar: async () => false,
    etiqueta: () => null,
  }
  if (args.slugs.length === 0) return vacio

  // Configuraciones y datos en PARALELO: son dos lecturas independientes. Los bloques de
  // los que depende la `condition` de cada uno (el tipo de persona, el servicio) no hace
  // falta traerlos: esa condición la resuelve `condicion_cumplida` en la base.
  const [cfgRes, dataRes] = await Promise.all([
    db(supabase)
      .from('bloque_configs')
      .select('slug, config_extra, etapas_negocio!inner(linea_id)')
      .eq('etapas_negocio.linea_id', lineaId)
      .in('slug', args.slugs),
    db(supabase)
      .from('negocio_bloques')
      .select('data, bloque_configs!inner(slug, etapas_negocio!inner(linea_id))')
      .eq('negocio_id', negocioId)
      .eq('bloque_configs.etapas_negocio.linea_id', lineaId)
      .in('bloque_configs.slug', args.slugs),
  ])
  if (cfgRes.error) console.error('[fuentes-negocio] configs por slug:', cfgRes.error)
  if (dataRes.error) console.error('[fuentes-negocio] datos por slug:', dataRes.error)
  const configPorSlug: Record<string, Record<string, unknown>> = {}
  for (const c of (cfgRes.data ?? []) as Array<{ slug: string | null; config_extra: Record<string, unknown> | null }>) {
    if (c.slug) configPorSlug[c.slug] = c.config_extra ?? {}
  }
  const porSlug: Record<string, Record<string, unknown>> = {}
  for (const f of (dataRes.data ?? []) as Array<{ data: Record<string, unknown> | null; bloque_configs: { slug?: string | null } | null }>) {
    const slug = f.bloque_configs?.slug
    if (slug) porSlug[slug] = aplanarDataBloque(f.data)
  }

  const evaluarJson = memoizar(async (json: string) => {
    const { data: cumple, error } = await db(supabase).rpc('condicion_cumplida', {
      p_negocio_id: negocioId,
      p_linea_id: lineaId,
      p_etapa_actual_id: etapaActualId,
      p_cond: JSON.parse(json),
    })
    // Si la condición no se puede resolver, NO se inventa un «aplica»: un cruce que no
    // puede comprobarse calla, y la tarjeta muestra «Sin definir» en vez de afirmar.
    if (error) console.error('[fuentes-negocio] condicion_cumplida:', error)
    return cumple === true
  })
  const evaluar = (cond: Record<string, unknown>) => evaluarJson(JSON.stringify(cond))

  const aplica = async (slug: string) => {
    const ce = configPorSlug[slug]
    // Un slug sin configuración en la línea no es un bloque de este proceso.
    if (!ce) return false
    if (ce.desactivado === true) return false
    const cond = ce.condition as Record<string, unknown> | undefined
    return cond ? evaluar(cond) : true
  }

  const etiqueta = (slug: string, field: string, valor: unknown): string | null => {
    const campos = (configPorSlug[slug]?.fields ?? []) as Campo[]
    const opciones = campos.find(c => c.slug === field)?.opciones ?? []
    const o = opciones.find(op => String(op.value) === String(valor))
    return typeof o?.label === 'string' ? o.label : null
  }

  return { porSlug, aplica, evaluar, etiqueta }
}
