/**
 * Lectura de las tarifas de un servicio y decisión del esquema de una propuesta.
 *
 * Recibe el cliente de Supabase del llamador (con la sesión del usuario: la tabla tiene
 * RLS por workspace). La regla en sí vive en `tarifas.ts`, que es puro y tiene pruebas.
 */

import { todayBogotaISO } from '@/lib/dates/bogota'
import { decidirEsquema, type EsquemaPropuesta, type TarifaCongelada, type TarifaVersion } from './tarifas'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = any

export async function leerVersionesTarifa(supabase: Sb, servicioId: string | null | undefined): Promise<TarifaVersion[]> {
  if (!servicioId) return []
  const { data, error } = await supabase
    .from('servicio_tarifas_versiones')
    .select('id, servicio_id, version, vigente_desde, planes, rutas, no_ofrece, cap_descuento_pct, creado_por, created_at, nota')
    .eq('servicio_id', servicioId)
    .order('version', { ascending: true })
  if (error) {
    // Sin la tabla (migración sin aplicar) o sin permiso: la propuesta sigue con el
    // esquema anterior, que es exactamente el comportamiento de antes de este cambio.
    console.warn('[propuesta] no se pudieron leer las tarifas del servicio:', error.message)
    return []
  }
  return ((data ?? []) as Array<Record<string, unknown>>).map(f => ({
    ...(f as unknown as TarifaVersion),
    cap_descuento_pct: Number(f.cap_descuento_pct),
    planes: ((f.planes ?? []) as TarifaVersion['planes']).map(p => ({ ...p, valor: Number(p.valor) })),
    rutas: ((f.rutas ?? []) as TarifaVersion['rutas']).map(r => ({ ...r, pct: Number(r.pct) })),
    no_ofrece: (f.no_ofrece ?? []) as TarifaVersion['no_ofrece'],
  }))
}

/**
 * Esquema de la propuesta de un negocio. Lee las versiones del servicio y la fecha de
 * creación del negocio; el resto lo decide `decidirEsquema`.
 */
export async function resolverEsquemaPropuesta(
  supabase: Sb,
  input: {
    servicioId: string | null | undefined
    negocioId: string
    congelada: Partial<TarifaCongelada> | null | undefined
    versionesEmitidas: number
  },
): Promise<EsquemaPropuesta> {
  const versiones = await leerVersionesTarifa(supabase, input.servicioId)
  if (versiones.length === 0) return { esquema: 'anterior', motivo: 'sin_tarifas' }

  const { data: neg } = await supabase
    .from('negocios')
    .select('created_at')
    .eq('id', input.negocioId)
    .maybeSingle()
  const creado = (neg as { created_at?: string } | null)?.created_at
  // Sin fecha de creación no hay cómo saber qué versión rige: se queda en el esquema
  // anterior antes que adivinar un valor.
  if (!creado) return { esquema: 'anterior', motivo: 'creado_antes' }

  return decidirEsquema({
    versiones,
    congelada: input.congelada,
    versionesEmitidas: input.versionesEmitidas,
    creadoEl: todayBogotaISO(new Date(creado)),
  })
}
