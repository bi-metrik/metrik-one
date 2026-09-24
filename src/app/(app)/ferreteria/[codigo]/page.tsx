import { notFound, redirect } from 'next/navigation'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { exigirModulo, REQUISITO } from '@/lib/modulos/exigir-modulo'
import { leerDetalle } from '@/lib/ferreteria/datos'
import { puedeEditarFerreteria } from '@/lib/ferreteria/reglas'
import { todayBogotaISO } from '@/lib/dates/bogota'
import { PublicacionCliente } from './publicacion-cliente'

export const dynamic = 'force-dynamic'

/** Detalle de una publicación: ficha, costos, bitácora, mediciones, conversaciones y ventas (§4.2). */
export default async function PublicacionPage({ params }: { params: Promise<{ codigo: string }> }) {
  const { workspaceId, role, supabase, error } = await getWorkspace()
  if (error || !workspaceId) redirect('/')
  if (!(await exigirModulo(REQUISITO.ferreteria)).ok) redirect('/')

  const codigo = decodeURIComponent((await params).codigo)
  const detalle = await leerDetalle(supabase as unknown as SupabaseClient, workspaceId, codigo)
  if (!detalle) notFound()

  return (
    <PublicacionCliente
      detalle={detalle}
      hoy={todayBogotaISO()}
      ahoraIso={new Date().toISOString()}
      puedeEditar={puedeEditarFerreteria(role)}
    />
  )
}
