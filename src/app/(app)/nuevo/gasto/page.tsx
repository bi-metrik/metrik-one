import { getDestinosParaGasto } from './gasto-action'
import NuevoGastoForm from './nuevo-gasto-form'

export default async function NuevoGastoPage({ searchParams }: { searchParams: Promise<{ proyecto?: string; negocio?: string }> }) {
  const [destinos, params] = await Promise.all([getDestinosParaGasto(), searchParams])
  return <NuevoGastoForm destinos={destinos} defaultNegocioId={params.negocio} defaultProyectoId={params.proyecto} />
}
