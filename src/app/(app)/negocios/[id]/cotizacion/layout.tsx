import type { ReactNode } from 'react'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { leerMarcoDelNegocio } from '@/lib/cotizaciones/marco-negocio-datos'
import type { MarcoDelNegocio } from '@/lib/cotizaciones/marco-negocio'
import MarcoCotizacion from '@/app/(app)/negocios/marco-cotizacion'

/**
 * El marco del negocio alrededor de la cotización de viaje (`marco-cotizacion.tsx`).
 *
 * Es layout y no parte de la página para que, al saltar de una cotización a otra del
 * mismo negocio, el encabezado y la columna se queden donde están. Para cualquier línea
 * que no cotiza viajes —o si la lectura falla— devuelve la página tal cual (R6).
 */
export default async function CotizacionNegocioLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  let marco: MarcoDelNegocio | null = null
  try {
    const { supabase, workspaceId } = await getWorkspace()
    if (workspaceId) marco = await leerMarcoDelNegocio(supabase, workspaceId, id)
  } catch (e) {
    console.warn('[cotizacion] no se pudo leer el marco del negocio:', e instanceof Error ? e.message : e)
  }
  if (!marco) return children
  return <MarcoCotizacion marco={marco}>{children}</MarcoCotizacion>
}
