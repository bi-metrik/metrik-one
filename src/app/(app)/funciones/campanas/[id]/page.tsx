import { notFound, redirect } from 'next/navigation'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { exigirModulo, REQUISITO } from '@/lib/modulos/exigir-modulo'
import { leerPanelCampana } from '@/lib/funciones/datos'
import { puedeEditarFunciones } from '@/lib/funciones/reglas'
import { CampanaCliente } from './campana-cliente'

export const dynamic = 'force-dynamic'

/** `/funciones/campanas/[id]`: la campaña con su estado, precios, agenda y post (§4.2, §4.5, §4.6). */
export default async function CampanaPage({ params }: { params: Promise<{ id: string }> }) {
  const { workspaceId, role, supabase, error } = await getWorkspace()
  if (error || !workspaceId) redirect('/')
  if (!(await exigirModulo(REQUISITO.funciones)).ok) redirect('/')

  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()
  const campana = await leerPanelCampana(supabase as unknown as SupabaseClient, id)
  if (!campana) notFound()
  return <CampanaCliente campana={campana} puedeEditar={puedeEditarFunciones(role)} ahoraMs={Date.now()} />
}
