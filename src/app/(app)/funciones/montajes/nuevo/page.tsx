import { redirect } from 'next/navigation'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { exigirModulo, REQUISITO } from '@/lib/modulos/exigir-modulo'
import { leerCatalogo } from '@/lib/funciones/datos'
import { puedeEditarFunciones } from '@/lib/funciones/reglas'
import { FormularioMontaje } from '../formulario-montaje'

export const dynamic = 'force-dynamic'

export default async function NuevoMontajePage() {
  const { workspaceId, role, supabase, error } = await getWorkspace()
  if (error || !workspaceId) redirect('/')
  if (!(await exigirModulo(REQUISITO.funciones)).ok) redirect('/')
  if (!puedeEditarFunciones(role)) redirect('/funciones/montajes')

  const { experiencias } = await leerCatalogo(supabase as unknown as SupabaseClient, workspaceId)
  return <FormularioMontaje experiencias={experiencias} montaje={null} />
}
