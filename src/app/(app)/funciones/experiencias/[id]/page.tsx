import { notFound, redirect } from 'next/navigation'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { exigirModulo, REQUISITO } from '@/lib/modulos/exigir-modulo'
import { leerExperiencias, leerPanelCampanas } from '@/lib/funciones/datos'
import { puedeEditarFunciones } from '@/lib/funciones/reglas'
import { ExperienciaCliente } from './experiencia-cliente'

export const dynamic = 'force-dynamic'

/** `/funciones/experiencias/[id]`: la ficha de la película (los campos que ya tiene) y sus campañas (§4.1). */
export default async function ExperienciaPage({ params }: { params: Promise<{ id: string }> }) {
  const { workspaceId, role, supabase, error } = await getWorkspace()
  if (error || !workspaceId) redirect('/')
  if (!(await exigirModulo(REQUISITO.funciones)).ok) redirect('/')

  const { id } = await params
  const db = supabase as unknown as SupabaseClient
  const [experiencias, campanas] = await Promise.all([leerExperiencias(db, workspaceId), leerPanelCampanas(db, workspaceId)])
  const experiencia = experiencias.find((e) => e.id === id)
  if (!experiencia) notFound()
  return <ExperienciaCliente experiencia={experiencia} campanas={campanas.filter((c) => c.experiencia_id === id)} puedeEditar={puedeEditarFunciones(role)} />
}
