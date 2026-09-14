// ============================================================
// Lecturas de la base para resolver la factura de un negocio.
//
// La regla es pura y vive en `factura-del-negocio.ts`. Aquí solo se traen sus dos
// entradas —la fila del bloque de factura ORIGINAL y la configuración de la línea—
// para que la cola, la emisión, la carga manual y la ficha las lean igual.
//
// Server-only.
// ============================================================

import { traerTodo } from '@/lib/supabase/paginar'
import {
  resolverFacturaDelNegocio,
  type MarcaFacturaMinima,
  type ResolucionFactura,
} from './factura-del-negocio'

/** Slug del bloque de factura cuando la línea no lo declara: el de siempre. */
export const SLUG_FACTURA_POR_DEFECTO = 'factura_emitida'

/** Lo que el gate `factura:emitida` declara en la etapa de la línea que lo tiene. */
export interface GateFactura {
  bloque_slug?: string
  nit_campo?: string
  numero_campo?: string
  emisor_nit_esperado?: string
}

/**
 * Data del bloque de factura ORIGINAL de cada negocio.
 *
 * Se filtra por el `slug` de la config, y las copias heredadas no tienen slug: por
 * construcción aquí no entra ninguna copia. Paginado: una fila por negocio, pero la
 * cola crece con el negocio del cliente.
 */
export async function leerOriginalesDeFactura(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  svc: any,
  negocioIds: string[],
  slugs: string[],
): Promise<Map<string, Record<string, unknown> | null>> {
  const out = new Map<string, Record<string, unknown> | null>()
  if (negocioIds.length === 0 || slugs.length === 0) return out
  const filas = await traerTodo<{ negocio_id: string; data: Record<string, unknown> | null }>(
    (d, h) => svc
      .from('negocio_bloques')
      .select('id, negocio_id, data, bloque_configs!inner(slug)')
      .in('negocio_id', negocioIds)
      .in('bloque_configs.slug', slugs)
      .order('id')
      .range(d, h),
    { etiqueta: 'facturacion/negocio_bloques(factura original)' },
  )
  for (const f of filas) out.set(f.negocio_id, f.data ?? null)
  return out
}

/** El `factura_gate` declarado en alguna etapa de cada línea, si lo hay. */
export async function gatesDeFacturaPorLinea(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  svc: any,
  lineaIds: string[],
): Promise<Map<string, GateFactura>> {
  const out = new Map<string, GateFactura>()
  if (lineaIds.length === 0) return out
  const etapas = await traerTodo<{ linea_id: string; config_extra: Record<string, unknown> | null }>(
    (d, h) => svc
      .from('etapas_negocio')
      .select('id, linea_id, config_extra')
      .in('linea_id', lineaIds)
      .order('id')
      .range(d, h),
    { etiqueta: 'facturacion/etapas_negocio(factura_gate)' },
  )
  for (const e of etapas) {
    const gate = e.config_extra?.factura_gate as GateFactura | undefined
    if (gate && !out.has(e.linea_id)) out.set(e.linea_id, gate)
  }
  return out
}

/** Slug del bloque de factura de una línea, desde su config de Siigo. */
export function slugFacturaDeLinea(configExtraLinea: Record<string, unknown> | null | undefined): string {
  const s = (configExtraLinea?.siigo as { bloque_factura_slug?: string } | undefined)?.bloque_factura_slug
  return s || SLUG_FACTURA_POR_DEFECTO
}

export interface FacturaDeUnNegocio {
  resolucion: ResolucionFactura
  /** Data del bloque original tal como está, o null si el negocio no tiene esa fila. */
  original: Record<string, unknown> | null
  marca: MarcaFacturaMinima | null
  slug: string
  gate: GateFactura | null
  lineaId: string | null
}

/** La factura de UN negocio, con las mismas lecturas que usa la cola. */
export async function leerFacturaDeUnNegocio(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  svc: any,
  workspaceId: string,
  negocioId: string,
): Promise<FacturaDeUnNegocio | null> {
  const { data: neg } = await svc
    .from('negocios')
    .select('id, linea_id, metadata')
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  if (!neg) return null
  const lineaId = (neg.linea_id as string | null) ?? null

  let configLinea: Record<string, unknown> | null = null
  if (lineaId) {
    const { data: linea } = await svc.from('lineas_negocio').select('config_extra').eq('id', lineaId).maybeSingle()
    configLinea = (linea?.config_extra ?? null) as Record<string, unknown> | null
  }
  const slug = slugFacturaDeLinea(configLinea)
  const [originales, gates] = await Promise.all([
    leerOriginalesDeFactura(svc, [negocioId], [slug]),
    lineaId ? gatesDeFacturaPorLinea(svc, [lineaId]) : Promise.resolve(new Map<string, GateFactura>()),
  ])
  const original = originales.get(negocioId) ?? null
  const gate = (lineaId ? gates.get(lineaId) : undefined) ?? null
  const marca = ((neg.metadata as Record<string, unknown> | null)?.siigo_factura ?? null) as MarcaFacturaMinima | null
  const resolucion = resolverFacturaDelNegocio({
    original,
    marca,
    emisorNitEsperado: gate?.emisor_nit_esperado,
    nitCampo: gate?.nit_campo,
    numeroCampo: gate?.numero_campo,
  })
  return { resolucion, original, marca, slug, gate, lineaId }
}
