import { redirect } from 'next/navigation'
import { getWorkspace } from '@/lib/actions/get-workspace'
import DirectorioTabs from '../directorio-tabs'
import AliadosList from './aliados-list'
import { getAliados, puedeGestionarAliados } from './actions'

export default async function AliadosPage() {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) redirect('/login')

  // Módulo opt-in: solo workspaces con modules.aliados = true.
  const { data: ws } = await supabase
    .from('workspaces')
    .select('modules')
    .eq('id', workspaceId)
    .single()

  const modules = (ws as { modules: Record<string, boolean> | null } | null)?.modules
  if (!modules?.aliados) redirect('/directorio/contactos')

  const [aliados, puedeGestionar] = await Promise.all([
    getAliados(),
    puedeGestionarAliados(),
  ])

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-6">
      {/* Header */}
      <div>
        <h1 className="text-lg font-bold">Directorio</h1>
        <p className="text-xs text-muted-foreground">
          Gestiona tus contactos, empresas y aliados
        </p>
      </div>

      {/* Tabs */}
      <DirectorioTabs showAliados />

      {/* List */}
      <AliadosList aliados={aliados} puedeGestionar={puedeGestionar} />
    </div>
  )
}
