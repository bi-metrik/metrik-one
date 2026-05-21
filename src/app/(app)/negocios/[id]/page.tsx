import { notFound } from 'next/navigation'
import { getNegocioDetalleCompleto } from '../negocio-v2-actions'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { createServiceClient } from '@/lib/supabase/server'
import { listarConsultasPorNegocio } from '@/lib/actions/valida-consultas'
import { getDatosSarlaft, getScoreNegocio } from '@/lib/actions/valida-score'
import NegocioDetailClient from './negocio-detail-client'
import BloqueValida from './bloques/BloqueValida'
import BloqueRiesgoSarlaft from './bloques/BloqueRiesgoSarlaft'
import CerradoHeaderBanner from './cerrado-header-banner'
import EtapasHistorialAccordion from '@/components/etapas-historial-accordion'

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
  const { workspaceId, staffId, role } = await getWorkspace()

  // Areas efectivas del staff actual (para gatear boton "Reabrir" como supervisor)
  let hasAreaComercial = false
  if (staffId) {
    const svc2 = createServiceClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: areas } = await (svc2.from('staff_areas') as any)
      .select('area')
      .eq('staff_id', staffId)
    const areaList = ((areas ?? []) as Array<{ area: string }>).map((r) => r.area)
    hasAreaComercial = areaList.includes('comercial') || areaList.includes('direccion')
  }
  const negocioCerrado = data.negocio.cierre_motivo !== null
  let validaConsultas: Awaited<ReturnType<typeof listarConsultasPorNegocio>> | null = null
  let datosSarlaft: Awaited<ReturnType<typeof getDatosSarlaft>> | null = null
  let scoreSarlaft: Awaited<ReturnType<typeof getScoreNegocio>> | null = null
  let validaActivo = false
  if (workspaceId) {
    const svc = createServiceClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: ws } = await (svc.from('workspaces') as any)
      .select('modules')
      .eq('id', workspaceId)
      .single()
    const modules = (ws?.modules ?? {}) as Record<string, boolean>
    if (modules.valida_consulta) {
      validaActivo = true
      validaConsultas = await listarConsultasPorNegocio(id)
      datosSarlaft = await getDatosSarlaft(id)
      scoreSarlaft = await getScoreNegocio(id)
    }
  }

  return (
    <>
      {negocioCerrado && data.negocio.cierre_motivo && (
        <div className="mx-auto max-w-2xl px-4 pt-4">
          <CerradoHeaderBanner
            negocioId={id}
            cierreMotivo={data.negocio.cierre_motivo}
            closedAt={data.negocio.closed_at}
            razonCierre={data.negocio.razon_cierre}
            role={role}
            hasAreaComercial={hasAreaComercial}
          />
        </div>
      )}
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
      <div className="mx-auto max-w-2xl px-4 pb-4">
        <EtapasHistorialAccordion negocioId={id} />
      </div>
      {validaActivo && (
        <div className="mx-auto max-w-2xl px-4 pb-4 space-y-3">
          <BloqueRiesgoSarlaft
            negocioId={id}
            datosIniciales={datosSarlaft?.ok ? datosSarlaft.datos : null}
            scoreInicial={scoreSarlaft?.ok ? scoreSarlaft.score : null}
          />
          {validaConsultas && (
            <BloqueValida
              negocioId={id}
              consultas={validaConsultas.ok ? validaConsultas.consultas : []}
              error={validaConsultas.ok ? null : validaConsultas.error}
            />
          )}
        </div>
      )}
    </>
  )
}
