import { getCotizacion, getCotizacionItems } from '../../cotizaciones/actions-v2'
import { getFiscalProfile } from '@/app/(app)/config/fiscal-actions'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { notFound } from 'next/navigation'
import CotizacionEditor from './cotizacion-editor'

export default async function CotizacionDetailPage({ params }: { params: Promise<{ id: string; cotId: string }> }) {
  const { id, cotId } = await params
  const [cotizacion, items, fiscalResult] = await Promise.all([
    getCotizacion(cotId),
    getCotizacionItems(cotId),
    getFiscalProfile(),
  ])

  if (!cotizacion) notFound()

  // Check if any cotizacion in this oportunidad has estado='aceptada'
  let frozen = false
  try {
    const { supabase: sbCheck } = await getWorkspace()
    const { data: accepted } = await sbCheck
      .from('cotizaciones')
      .select('id')
      .eq('oportunidad_id', id)
      .eq('estado', 'aceptada')
      .limit(1)
    if (accepted && accepted.length > 0 && accepted[0].id !== cotId) {
      frozen = true
    }
  } catch {
    // Non-critical
  }

  // Extract client fiscal data from the oportunidad → empresa join
  const empresa = (cotizacion as any)?.oportunidades?.empresas ?? null
  const clientFiscal = empresa ? {
    person_type: empresa.tipo_persona ?? empresa.person_type ?? null,
    tax_regime: empresa.regimen_tributario ?? empresa.tax_regime ?? null,
    gran_contribuyente: empresa.gran_contribuyente ?? false,
    agente_retenedor: empresa.agente_retenedor ?? false,
  } : null

  const fiscalProfile = fiscalResult.success ? fiscalResult.data ?? null : null

  // Fetch staff for mano de obra datalist
  let staffMembers: { id: string; nombre: string; tarifa_hora: number }[] = []
  try {
    const { supabase, workspaceId } = await getWorkspace()
    if (workspaceId) {
      const { data } = await supabase
        .from('staff')
        .select('id, full_name, salary, horas_disponibles_mes')
        .eq('workspace_id', workspaceId)
        .eq('is_active', true)
        .order('full_name')
      staffMembers = (data ?? []).map(s => ({
        id: s.id,
        nombre: s.full_name,
        tarifa_hora: (s.salary && s.horas_disponibles_mes) ? s.salary / s.horas_disponibles_mes : 0,
      }))
    }
  } catch {
    // Staff data is not critical for the editor
  }

  return (
    <CotizacionEditor
      oportunidadId={id}
      cotizacion={cotizacion}
      initialItems={items}
      fiscalProfile={fiscalProfile}
      clientFiscal={clientFiscal}
      staffMembers={staffMembers}
      frozen={frozen}
    />
  )
}
