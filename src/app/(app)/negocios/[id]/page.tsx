import { notFound } from 'next/navigation'
import { getNegocioDetalleCompleto } from '../negocio-v2-actions'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { createServiceClient } from '@/lib/supabase/server'
import { listarConsultasPorNegocio } from '@/lib/actions/valida-consultas'
import NegocioDetailClient from './negocio-detail-client'
import BloqueValida from './bloques/BloqueValida'

export const maxDuration = 60

interface Props {
  params: Promise<{ id: string }>
  searchParams: Promise<{ err?: string }>
}

export default async function NegocioDetailPage({ params, searchParams }: Props) {
  const { id } = await params
  const { err } = await searchParams
  const data = await getNegocioDetalleCompleto(id)

  if (!data) notFound()

  // Cargar consultas Valida solo si el workspace tiene el flag activo
  const { workspaceId } = await getWorkspace()
  let validaConsultas: Awaited<ReturnType<typeof listarConsultasPorNegocio>> | null = null
  if (workspaceId) {
    const svc = createServiceClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: ws } = await (svc.from('workspaces') as any)
      .select('modules')
      .eq('id', workspaceId)
      .single()
    const modules = (ws?.modules ?? {}) as Record<string, boolean>
    if (modules.valida_consulta) {
      validaConsultas = await listarConsultasPorNegocio(id)
    }
  }

  return (
    <>
      <NegocioDetailClient
        negocio={data.negocio}
        bloques={data.bloques}
        etapasLinea={data.etapasLinea}
        profiles={data.profiles}
        currentUserId={data.currentUserId}
        userRole={data.userRole}
        cobros={data.cobros}
        cotizacionesNegocio={data.cotizacionesNegocio}
        resumenFinanciero={data.resumenFinanciero}
        ejecucionData={data.ejecucionData}
        historialData={data.historialData}
        actividad={data.actividad}
        staffList={data.staffList}
        datosOtrasEtapas={data.datosOtrasEtapas}
        pausaEnabled={data.pausaEnabled}
        errorMsg={err}
      />
      {validaConsultas && (
        <div className="mx-auto max-w-2xl px-4 pb-4">
          <BloqueValida
            negocioId={id}
            consultas={validaConsultas.ok ? validaConsultas.consultas : []}
            error={validaConsultas.ok ? null : validaConsultas.error}
          />
        </div>
      )}
    </>
  )
}
