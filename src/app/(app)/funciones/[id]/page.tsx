import { notFound, redirect } from 'next/navigation'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { exigirModulo, REQUISITO } from '@/lib/modulos/exigir-modulo'
import { leerFuncion } from '@/lib/funciones/datos'
import { puedeEditarFunciones } from '@/lib/funciones/reglas'
import { DetalleCliente } from './detalle-cliente'

export const dynamic = 'force-dynamic'

/**
 * `/funciones/[id]`: el detalle de la función, con su cupo (`funcion_ocupacion`) y sus reservas activas. Sin mapa: Sabor
 * no asigna puestos (alcance del 2026-10-22).
 */
export default async function FuncionPage({ params }: { params: Promise<{ id: string }> }) {
  const { workspaceId, role, supabase, error } = await getWorkspace()
  if (error || !workspaceId) redirect('/')
  if (!(await exigirModulo(REQUISITO.funciones)).ok) redirect('/')

  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()
  const funcion = await leerFuncion(supabase as unknown as SupabaseClient, id)
  if (!funcion) notFound()

  return <DetalleCliente funcion={funcion} puedeEditar={puedeEditarFunciones(role)} />
}
