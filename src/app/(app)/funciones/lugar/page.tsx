import { redirect } from 'next/navigation'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { exigirModulo, REQUISITO } from '@/lib/modulos/exigir-modulo'
import { leerNegocio } from '@/lib/funciones/datos'
import { puedeEditarFunciones } from '@/lib/funciones/reglas'
import { LugarCliente } from './lugar-cliente'

export const dynamic = 'force-dynamic'

/** `/funciones/lugar`: el ajuste del módulo con los datos del lugar (P11), una vez por workspace. */
export default async function LugarPage() {
  const { workspaceId, role, supabase, error } = await getWorkspace()
  if (error || !workspaceId) redirect('/')
  if (!(await exigirModulo(REQUISITO.funciones)).ok) redirect('/')
  const negocio = await leerNegocio(supabase as unknown as SupabaseClient, workspaceId)
  return <LugarCliente negocio={negocio} puedeEditar={puedeEditarFunciones(role)} />
}
