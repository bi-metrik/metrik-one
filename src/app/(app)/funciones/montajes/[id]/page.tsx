import { notFound, redirect } from 'next/navigation'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { exigirModulo, REQUISITO } from '@/lib/modulos/exigir-modulo'
import { leerCatalogo } from '@/lib/funciones/datos'
import { puedeEditarFunciones } from '@/lib/funciones/reglas'
import { FormularioMontaje } from '../formulario-montaje'

export const dynamic = 'force-dynamic'

/** Editar un montaje: los candados de §1.2 (mesas con reservas sentadas, cupo de funciones futuras) los dice la base. */
export default async function EditarMontajePage({ params }: { params: Promise<{ id: string }> }) {
  const { workspaceId, role, supabase, error } = await getWorkspace()
  if (error || !workspaceId) redirect('/')
  if (!(await exigirModulo(REQUISITO.funciones)).ok) redirect('/')
  if (!puedeEditarFunciones(role)) redirect('/funciones/montajes')

  const { id } = await params
  const { experiencias, montajes } = await leerCatalogo(supabase as unknown as SupabaseClient, workspaceId)
  const montaje = montajes.find((m) => m.id === id)
  if (!montaje) notFound()
  return <FormularioMontaje experiencias={experiencias} montaje={montaje} />
}
