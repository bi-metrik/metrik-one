import { notFound, redirect } from 'next/navigation'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { exigirModulo, REQUISITO } from '@/lib/modulos/exigir-modulo'
import { leerFuncion } from '@/lib/funciones/datos'
import { puedeEditarFunciones } from '@/lib/funciones/reglas'
import { MapaCliente } from './mapa-cliente'

export const dynamic = 'force-dynamic'

/**
 * `/funciones/[id]`: el mapa de la función (§4.1). Ocupación por mesa y puesto de `funcion_ocupacion`; asignar,
 * mover, repartir y liberar pasan por `funcion_asignar_mesas`, que valida todo dentro del candado de la función.
 */
export default async function FuncionPage({ params }: { params: Promise<{ id: string }> }) {
  const { workspaceId, role, supabase, error } = await getWorkspace()
  if (error || !workspaceId) redirect('/')
  if (!(await exigirModulo(REQUISITO.funciones)).ok) redirect('/')

  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()
  const funcion = await leerFuncion(supabase as unknown as SupabaseClient, id)
  if (!funcion) notFound()

  return <MapaCliente funcion={funcion} puedeEditar={puedeEditarFunciones(role)} />
}
