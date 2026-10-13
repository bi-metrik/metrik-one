/**
 * El CIERRE de toda acción de la cotización por pasos que toca opciones o tarifas (C2): las
 * tarifas quedan completas y con la Recomendada en la propuesta, la autorización del dueño se
 * revisa contra la huella nueva y el total se recalcula UNA vez.
 *
 * No es un archivo `'use server'` a propósito: `tarifasTrasAceptar` recibe la foto de ANTES
 * (con funciones adentro) y la llama la ruta de la bandeja, no el navegador. Si fuera una
 * server action, cualquiera podría mandarle una foto inventada.
 *
 * ⚠️ Ningún lector de plata importa este archivo (N4).
 */

import { revalidatePath } from 'next/cache'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { recalcularTotales } from '@/app/(app)/negocios/cotizacion-actions'
import { exigirPorPasos } from './por-pasos-datos'
import { fotoDeTarifas, sincronizarTarifas, type FotoDeTarifas } from './tarifas-por-pasos-datos'
import {
  aceptarCapturaDeBandeja,
  type BorradorParaAceptar,
  type ResultadoAceptarCaptura,
} from '@/app/(app)/negocios/tarifa-pax-actions'
import { revisarExcepcionTrasCambio } from './piso-salida-datos'
import { createServiceClient } from '@/lib/supabase/server'

export type ResultadoPorPasos<T = object> = ({ success: true } & T) | { success: false; error: string }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Supabase = any

/**
 * Lo que corre después de toda acción de la forma nueva que toca opciones o tarifas: las
 * tarifas quedan completas y con la Recomendada en la propuesta (`sincronizarTarifas`), la
 * autorización del dueño se revisa contra la huella nueva, y el total se recalcula UNA vez.
 */
export async function cerrarAccionPorPasos(
  supabase: Supabase,
  args: { workspaceId: string; cotizacionId: string; antes: FotoDeTarifas | null; staffId?: string | null },
): Promise<ResultadoPorPasos<{ valorTotal: number | null }>> {
  const s = await sincronizarTarifas(supabase, { workspaceId: args.workspaceId, cotizacionId: args.cotizacionId, antes: args.antes })
  if (!s.ok) return { success: false, error: s.error }
  try {
    await revisarExcepcionTrasCambio(supabase, {
      servicio: createServiceClient,
      workspaceId: args.workspaceId,
      cotizacionId: args.cotizacionId,
      staffId: args.staffId ?? null,
    })
  } catch (e) {
    console.error('[por-pasos] no se pudo revisar la excepción de margen:', e instanceof Error ? e.message : String(e))
  }
  const r = await recalcularTotales(args.cotizacionId)
  const negocioId = s.despues.ctx.negocioId
  if (negocioId) revalidatePath(`/negocios/${negocioId}`)
  return { success: true, valorTotal: 'valorVenta' in r ? (r.valorVenta as number) : null }
}

/**
 * Después de aceptar uno o varios pantallazos desde la bandeja de la forma nueva: la opción
 * nueva entra en las tarifas (propuesta de ONE) y la Recomendada queda en la propuesta. Lo
 * llaman las rutas de la bandeja con la foto de ANTES de aceptar. Comprueba el interruptor.
 */
export async function tarifasTrasAceptar(
  cotizacionId: string,
  antes: FotoDeTarifas | null,
): Promise<ResultadoPorPasos<{ valorTotal: number | null }>> {
  const { supabase, workspaceId, staffId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }
  const guard = await exigirPorPasos(supabase, cotizacionId)
  if (!guard.ok) return { success: false, error: guard.error }
  return cerrarAccionPorPasos(supabase, { workspaceId, cotizacionId, antes, staffId })
}

/**
 * «Aceptar» de la bandeja de la forma por pasos: el de siempre (`aceptarCapturaDeBandeja`) y,
 * después, las tarifas con la opción nueva. El interruptor se relee ANTES de aceptar: con él
 * apagado (una pestaña vieja) no se acepta nada y se pide recargar.
 */
export async function aceptarPorPasos(cotizacionId: string, borrador: BorradorParaAceptar): Promise<ResultadoAceptarCaptura & { tarifas?: string }> {
  const { supabase } = await getWorkspace()
  const guard = await exigirPorPasos(supabase, cotizacionId)
  if (!guard.ok) return { ok: false, codigo: 'POR_PASOS', mensaje: guard.error }
  const antes = await fotoDeTarifas(supabase, cotizacionId)
  const aceptada = await aceptarCapturaDeBandeja(cotizacionId, borrador)
  if (!aceptada.ok) return aceptada
  const t = await tarifasTrasAceptar(cotizacionId, antes)
  return t.success ? aceptada : { ...aceptada, tarifas: t.error }
}
