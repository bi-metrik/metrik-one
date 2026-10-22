import { redirect } from 'next/navigation'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { exigirModulo, REQUISITO } from '@/lib/modulos/exigir-modulo'
import { leerExperiencias, leerPanelCampanas } from '@/lib/funciones/datos'
import { puedeEditarFunciones } from '@/lib/funciones/reglas'
import { NuevaCampanaCliente } from './nueva-campana-cliente'

export const dynamic = 'force-dynamic'

/** `/funciones/campanas/nueva`: crear una campaña en 3 pasos (§4.3). Los precios y cupos salen de la campaña anterior. */
export default async function NuevaCampanaPage() {
  const { workspaceId, role, supabase, error } = await getWorkspace()
  if (error || !workspaceId) redirect('/')
  if (!(await exigirModulo(REQUISITO.funciones)).ok) redirect('/')
  if (!puedeEditarFunciones(role)) redirect('/funciones')

  const db = supabase as unknown as SupabaseClient
  const [experiencias, campanas] = await Promise.all([leerExperiencias(db, workspaceId), leerPanelCampanas(db, workspaceId)])
  const anterior = [...campanas].sort((a, b) => b.created_at.localeCompare(a.created_at)).find((c) => c.precio_persona !== null) ?? null
  return <NuevaCampanaCliente experiencias={experiencias} anterior={anterior} ahoraMs={Date.now()} />
}
