import { redirect } from 'next/navigation'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { exigirModulo, REQUISITO } from '@/lib/modulos/exigir-modulo'
import { leerExperiencias } from '@/lib/funciones/datos'
import { puedeEditarFunciones } from '@/lib/funciones/reglas'
import { FormularioFunciones } from './formulario-funciones'

export const dynamic = 'force-dynamic'

/** `/funciones/nueva`: una o varias funciones de una experiencia (§4.3). */
export default async function NuevaFuncionPage() {
  const { workspaceId, role, supabase, error } = await getWorkspace()
  if (error || !workspaceId) redirect('/')
  if (!(await exigirModulo(REQUISITO.funciones)).ok) redirect('/')
  if (!puedeEditarFunciones(role)) redirect('/funciones')

  const experiencias = await leerExperiencias(supabase as unknown as SupabaseClient, workspaceId)
  return <FormularioFunciones experiencias={experiencias} />
}
