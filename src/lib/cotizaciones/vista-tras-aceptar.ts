import 'server-only'

import { getCotizacionItems } from '@/app/(app)/negocios/cotizacion-actions'
import { getAdicionalesDeCotizacion } from '@/app/(app)/negocios/adicional-actions'
import { getWorkspace } from '@/lib/actions/get-workspace'
import type { VistaFresca } from './vista-fresca'

/**
 * V2 (re-verificación D) · la cotización tal como quedó después de «Aceptar», en la MISMA
 * respuesta. Antes, la asesora veía el precio y el total cuando volvía una segunda petición
 * (`/api/cotizaciones/[id]/vista`, `vista-fresca.ts`): una ida más de su navegador a ONE después
 * de que el servidor ya había terminado. Son las mismas lecturas y la misma forma que esa ruta,
 * con el cliente de la sesión; aquí las tres van en paralelo porque la cotización ya se sabe que
 * existe. SOLO LECTURA. `null` si algo no se pudo leer: el editor se pone al día como siempre.
 */
export async function vistaTrasAceptar(cotizacionId: string): Promise<VistaFresca | null> {
  // La marca se toma ANTES de leer, igual que en la ruta: lo leído es al menos así de nuevo.
  const leidaEn = new Date().toISOString()
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return null
  try {
    const [{ data: cot }, items, adicionales] = await Promise.all([
      supabase.from('cotizaciones').select('id, valor_total').eq('id', cotizacionId).maybeSingle(),
      getCotizacionItems(cotizacionId),
      getAdicionalesDeCotizacion(cotizacionId),
    ])
    if (!cot) return null
    return {
      leidaEn,
      items,
      adicionalesPorItem: adicionales.porItem,
      valorTotal: (cot as { valor_total?: number | null }).valor_total ?? null,
    }
  } catch {
    return null
  }
}
