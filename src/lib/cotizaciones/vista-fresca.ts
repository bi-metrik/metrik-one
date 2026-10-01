/**
 * Lo que cambia el costo se ve sin recargar (brief Trappvel del 2026-10-01, PR 2).
 *
 * El síntoma, medido en producción dos veces: tras «Confirmar y cargar el costo» (COT-2026-0019)
 * y tras «Corregir datos» (#963) la base ya tenía el dato nuevo, el `router.refresh()` SÍ salió
 * (registros de Vercel: el GET llega ~2 s después del POST) y aun así la tarjeta siguió pintando
 * los rubros, el costo y las fechas de antes hasta que alguien recargó. No se pudo reproducir
 * fuera de producción (tampoco el 2026-09-16, con el editor real en `next dev`).
 *
 * En vez de perseguir el router, el editor del flujo de viaje deja de depender solo de él:
 * después de cada acción pide la cotización por `fetch` a una ruta de solo lectura
 * (`/api/cotizaciones/[id]/vista`) y pinta la MÁS NUEVA entre esa y la de la página, comparando
 * la hora del servidor en que se leyó cada una. Si el refresco llega bien, gana la página; si
 * no llega, gana la lectura propia. Las dos son lecturas de la base, así que lo que se ve es
 * siempre lo guardado, no una suposición de la pantalla.
 *
 * Va por `fetch` y no por server action a propósito: Next pone server actions y refrescos en
 * UNA fila, y una acción larga deja esperando todo lo demás (#907).
 */

export interface VistaFresca<Item = unknown, Adicional = unknown> {
  /** Hora del servidor en que se leyó (ISO). Es lo que decide cuál de las dos lecturas gana. */
  leidaEn: string
  items: Item[]
  adicionalesPorItem: Record<string, Adicional[]>
  /** `cotizaciones.valor_total`: el total que pinta la columna de la derecha. */
  valorTotal: number | null
}

/** ¿La lectura propia es más nueva que la que trajo la página? */
export function vistaFrescaVigente(
  fresca: Pick<VistaFresca, 'leidaEn'> | null | undefined,
  leidaEnPagina: string | null | undefined,
): boolean {
  if (!fresca?.leidaEn) return false
  // Una página sin marca (una versión vieja del servidor) no puede ganarle a una lectura que sí la tiene.
  if (!leidaEnPagina) return true
  return fresca.leidaEn > leidaEnPagina
}

/**
 * Las líneas y los adicionales que pinta el editor: los de la lectura propia si es más nueva,
 * los de la página si no. `activo` = flujo de viaje; fuera de él, siempre los de la página.
 */
export function lineasParaPintar<I, A>(
  pagina: { items: I[]; adicionalesPorItem: Record<string, A[]>; leidaEn: string | null | undefined },
  fresca: VistaFresca | null,
  activo: boolean,
): { items: I[]; adicionalesPorItem: Record<string, A[]>; deLaLecturaPropia: boolean } {
  if (activo && fresca && vistaFrescaVigente(fresca, pagina.leidaEn)) {
    return {
      items: fresca.items as I[],
      adicionalesPorItem: fresca.adicionalesPorItem as Record<string, A[]>,
      deLaLecturaPropia: true,
    }
  }
  return { items: pagina.items, adicionalesPorItem: pagina.adicionalesPorItem, deLaLecturaPropia: false }
}

/** Entre dos lecturas propias que llegan en desorden, se queda la más nueva. */
export function laMasNueva<V extends Pick<VistaFresca, 'leidaEn'>>(actual: V | null, nueva: V): V {
  if (!actual) return nueva
  return nueva.leidaEn > actual.leidaEn ? nueva : actual
}

/** La respuesta de la ruta, validada. Lo que no tenga la forma esperada se descarta (`null`). */
export function interpretarVistaFresca(cuerpo: unknown): VistaFresca | null {
  if (!cuerpo || typeof cuerpo !== 'object') return null
  const c = cuerpo as Record<string, unknown>
  if (c.ok !== true) return null
  if (typeof c.leidaEn !== 'string' || !c.leidaEn) return null
  if (!Array.isArray(c.items)) return null
  const adicionales = c.adicionalesPorItem
  const adicionalesPorItem: Record<string, unknown[]> = {}
  if (adicionales && typeof adicionales === 'object') {
    for (const [k, v] of Object.entries(adicionales as Record<string, unknown>)) {
      if (Array.isArray(v)) adicionalesPorItem[k] = v
    }
  }
  const total = c.valorTotal
  const valorTotal = typeof total === 'number' && Number.isFinite(total)
    ? total
    : typeof total === 'string' && Number.isFinite(Number(total)) ? Number(total) : null
  return { leidaEn: c.leidaEn, items: c.items, adicionalesPorItem, valorTotal }
}

/** La ruta de la lectura. */
export function rutaVistaFresca(cotizacionId: string): string {
  return `/api/cotizaciones/${encodeURIComponent(cotizacionId)}/vista`
}

/**
 * Pide la cotización a la ruta. Cualquier falla (sin sesión, red caída, respuesta rara)
 * devuelve `null` y la pantalla se queda con lo que traiga el refresco: nunca empeora lo de hoy.
 */
export async function traerVistaFresca(
  cotizacionId: string,
  hacerFetch: typeof fetch = fetch,
): Promise<VistaFresca | null> {
  try {
    const r = await hacerFetch(rutaVistaFresca(cotizacionId), {
      method: 'GET',
      cache: 'no-store',
      headers: { accept: 'application/json' },
    })
    if (!r.ok) return null
    return interpretarVistaFresca(await r.json())
  } catch {
    return null
  }
}
