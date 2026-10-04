import 'server-only'

/**
 * Costo ejecutado de cada negocio: gastos + horas valoradas al salario del staff / 160.
 *
 * Vive aparte de `getNegociosV2` porque la lista paginada de `/negocios` solo lo necesita
 * para las tarjetas que pinta (una página), y `gastos`/`horas` se filtran con los ids en
 * la URL: con el universo entero de SOENA (466 abiertos, 2026-10-03) eran ~18 KB de URL
 * por consulta. Con una página son ~1 KB.
 *
 * Mismo cálculo que antes vivía en línea en `getNegociosV2`; no cambia ninguna cifra.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = (c: unknown): any => c

/**
 * PostgREST devuelve la query ENTERA en la cabecera `Content-Location`. Con los 466 ids
 * abiertos de SOENA son 18.236 bytes, y el `fetch` de Node (undici) corta las cabeceras
 * en 16 KB: `HeadersOverflowError`, que supabase-js entrega como `{ error }` (medido el
 * 2026-10-03). 100 ids son ~4 KB.
 */
const TAMANO_LOTE = 100

export async function costosEjecutadosPorNegocio(
  supabase: unknown,
  workspaceId: string,
  negocioIds: string[],
): Promise<Record<string, number>> {
  if (negocioIds.length === 0) return {}
  const lotes: string[][] = []
  for (let i = 0; i < negocioIds.length; i += TAMANO_LOTE) lotes.push(negocioIds.slice(i, i + TAMANO_LOTE))
  const leer = async (tabla: 'gastos' | 'horas', columnas: string) => {
    const respuestas = await Promise.all(
      lotes.map((ids) =>
        db(supabase).from(tabla).select(columnas).eq('workspace_id', workspaceId).in('negocio_id', ids),
      ),
    )
    const filas: unknown[] = []
    for (const r of respuestas as Array<{ data: unknown[] | null; error: { message?: string } | null }>) {
      // Antes el error se tragaba (`?? []`) y el costo salía 0. Se sigue sin tumbar la
      // lista por un dato de tarjeta, pero queda en el log.
      if (r.error) console.error(`[costos-ejecutados] ${tabla}: ${r.error.message ?? r.error}`)
      filas.push(...(r.data ?? []))
    }
    return { data: filas }
  }
  const [gastosRes, horasRes, staffRes] = await Promise.all([
    leer('gastos', 'negocio_id, monto'),
    leer('horas', 'negocio_id, horas, staff_id'),
    db(supabase).from('staff').select('id, salary').eq('workspace_id', workspaceId),
  ])

  const salario: Record<string, number> = {}
  for (const s of ((staffRes.data ?? []) as Array<{ id: string; salary: number | null }>)) {
    salario[s.id] = s.salary ?? 0
  }

  const total: Record<string, number> = {}
  for (const g of ((gastosRes.data ?? []) as Array<{ negocio_id: string; monto: number }>)) {
    total[g.negocio_id] = (total[g.negocio_id] ?? 0) + (g.monto ?? 0)
  }
  for (const h of ((horasRes.data ?? []) as Array<{ negocio_id: string; horas: number; staff_id: string | null }>)) {
    const s = h.staff_id ? (salario[h.staff_id] ?? 0) : 0
    const tarifa = s > 0 ? s / 160 : 0
    total[h.negocio_id] = (total[h.negocio_id] ?? 0) + (h.horas ?? 0) * tarifa
  }
  const redondeado: Record<string, number> = {}
  for (const [id, v] of Object.entries(total)) redondeado[id] = Math.round(v)
  return redondeado
}
