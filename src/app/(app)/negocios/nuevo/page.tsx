import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import NuevoNegocioForm from './nuevo-negocio-form'

export default async function NuevoNegocioPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('workspace_id')
    .eq('id', user.id)
    .single()
  if (!profile) redirect('/onboarding')

  // Workspace tipo + líneas disponibles para selector Clarity
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: wsData } = await (supabase.from('workspaces') as any)
    .select('tipo')
    .eq('id', profile.workspace_id)
    .single() as { data: { tipo: string } | null }
  const workspaceTipo = (wsData?.tipo ?? 'nativo') as 'nativo' | 'clarity'

  // Para Clarity: cargar líneas del workspace para selector
  let lineas: { id: string; nombre: string; descripcion: string | null }[] = []
  if (workspaceTipo === 'clarity') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase as any)
      .from('lineas_negocio')
      .select('id, nombre, descripcion')
      .eq('workspace_id', profile.workspace_id)
      .order('nombre')
    lineas = (data ?? []) as typeof lineas
  }

  return <NuevoNegocioForm workspaceTipo={workspaceTipo} lineasClarity={lineas} />
}
