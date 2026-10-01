/**
 * La cotización tal como está guardada ahora, para que el editor del flujo de viaje se ponga al
 * día sin recargar (ver `src/lib/cotizaciones/vista-fresca.ts`). SOLO LECTURA.
 *
 * Mismas lecturas y misma forma que la página (`getCotizacionItems`,
 * `getAdicionalesDeCotizacion`), con el cliente de la sesión: el RLS del workspace decide qué se
 * ve, igual que en la página. Va por `fetch` y no por server action para no hacer fila detrás de
 * las acciones (#907).
 */
import { NextResponse } from 'next/server'

import { getCotizacionItems } from '@/app/(app)/negocios/cotizacion-actions'
import { getAdicionalesDeCotizacion } from '@/app/(app)/negocios/adicional-actions'
import { getWorkspace } from '@/lib/actions/get-workspace'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SIN_CACHE = { 'cache-control': 'no-store' }

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  // La marca se toma ANTES de leer, igual que en la página: lo leído es al menos así de nuevo.
  const leidaEn = new Date().toISOString()
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) {
    return NextResponse.json({ ok: false }, { status: 401, headers: SIN_CACHE })
  }

  const { data: cot } = await supabase
    .from('cotizaciones')
    .select('id, valor_total')
    .eq('id', id)
    .maybeSingle()
  if (!cot) return NextResponse.json({ ok: false }, { status: 404, headers: SIN_CACHE })

  const [items, adicionales] = await Promise.all([
    getCotizacionItems(id),
    getAdicionalesDeCotizacion(id),
  ])

  return NextResponse.json(
    {
      ok: true,
      leidaEn,
      items,
      adicionalesPorItem: adicionales.porItem,
      valorTotal: (cot as { valor_total?: number | null }).valor_total ?? null,
    },
    { headers: SIN_CACHE },
  )
}
