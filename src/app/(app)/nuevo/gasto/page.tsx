import { getWorkspace } from '@/lib/actions/get-workspace'
import { getDestinosParaGasto } from './gasto-action'
import NuevoGastoForm from './nuevo-gasto-form'

/**
 * ¿Este workspace reparte sus gastos por centro de costos?
 *
 * Opt-in por `workspaces.modules`, como el resto de las capacidades. Ausente = no, que
 * es lo correcto para todo workspace nuevo: el reparto se habilita cuando alguien lo
 * va a usar, no por defecto.
 */
async function usaCentroCostos(): Promise<boolean> {
  const { supabase, workspaceId } = await getWorkspace()
  if (!workspaceId) return false
  const { data } = await supabase
    .from('workspaces').select('modules').eq('id', workspaceId).maybeSingle()
  const modules = (data?.modules ?? {}) as Record<string, boolean>
  return modules.centro_costos === true
}

export default async function NuevoGastoPage({ searchParams }: { searchParams: Promise<{ proyecto?: string; negocio?: string }> }) {
  const [destinos, params, centroCostosEnabled] = await Promise.all([
    getDestinosParaGasto(),
    searchParams,
    usaCentroCostos(),
  ])
  return (
    <NuevoGastoForm
      destinos={destinos}
      defaultNegocioId={params.negocio}
      defaultProyectoId={params.proyecto}
      centroCostosEnabled={centroCostosEnabled}
    />
  )
}
