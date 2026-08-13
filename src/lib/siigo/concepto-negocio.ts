import 'server-only'
import {
  conceptoFactura,
  type ConceptoResuelto,
  type ConceptosConfig,
} from './concepto'

/**
 * Resuelve el concepto de UN negocio leyendo sus insumos de la base.
 *
 * La cola de facturación resuelve por lote (trae los bloques de 181 casos de
 * una) y la emisión resuelve uno solo: la lectura no puede compartirse sin
 * castigar a una de las dos. Lo que SÍ se comparte, y es lo que importa, es la
 * decisión — las dos llaman a `conceptoFactura`. Si la regla cambia, cambia en
 * un solo archivo.
 */
export async function resolverConceptoDeNegocio(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  svc: any,
  negocioId: string,
  lineaId: string | null,
  productoCodeBase: string,
): Promise<ConceptoResuelto> {
  // Qué contrató el cliente. El bloque vive en Negociación y se hereda de solo
  // lectura aguas abajo; cualquiera de las instancias sirve, así que se toma la
  // primera con valor. Guarda PLANO (`data.servicio`), no bajo `campos`.
  const { data: bloques } = await svc
    .from('negocio_bloques')
    .select('data, bloque_configs!inner(slug)')
    .eq('negocio_id', negocioId)
    .eq('bloque_configs.slug', 'servicio_contratado')

  let servicio: unknown = null
  for (const b of ((bloques ?? []) as Array<{ data: Record<string, unknown> | null }>)) {
    const v = b.data?.servicio
    if (v != null && v !== '') { servicio = v; break }
  }

  // Mapeo servicio → producto, declarado por la línea.
  let conceptos: ConceptosConfig | undefined
  if (lineaId) {
    const { data: linea } = await svc
      .from('lineas_negocio')
      .select('config_extra')
      .eq('id', lineaId)
      .single()
    const s = ((linea?.config_extra ?? {}) as Record<string, unknown>).siigo as
      | { conceptos?: ConceptosConfig }
      | undefined
    conceptos = s?.conceptos
  }

  return conceptoFactura(servicio, conceptos, productoCodeBase)
}
