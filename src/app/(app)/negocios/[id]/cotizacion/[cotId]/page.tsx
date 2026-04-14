import { getCotizacion, getCotizacionItems } from '@/app/(app)/pipeline/[id]/cotizaciones/actions-v2'
import { getFiscalProfile } from '@/app/(app)/config/fiscal-actions'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { notFound, redirect } from 'next/navigation'
import CotizacionEditor from '@/app/(app)/pipeline/[id]/cotizacion/[cotId]/cotizacion-editor'

export default async function CotizacionNegocioPage({
  params,
}: {
  params: Promise<{ id: string; cotId: string }>
}) {
  const { id, cotId } = await params

  // getFiscalProfile tiene getWorkspace() interno que THROWS — catch para no crashear
  const [cotizacion, items, fiscalResult] = await Promise.all([
    getCotizacion(cotId),
    getCotizacionItems(cotId),
    getFiscalProfile().catch(() => ({ success: false as const, data: null })),
  ])

  if (!cotizacion) notFound()

  // Check if any cotizacion in this negocio has estado='aceptada'
  let frozen = false
  try {
    const { supabase: sbCheck } = await getWorkspace()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: accepted } = await (sbCheck as any)
      .from('cotizaciones')
      .select('id')
      .eq('negocio_id', id)
      .eq('estado', 'aceptada')
      .limit(1)
    // Freeze if there's an accepted quote AND the current one is NOT the accepted one
    if (accepted && accepted.length > 0 && accepted[0].id !== cotId) {
      frozen = true
    }
  } catch {
    // Non-critical — if check fails, don't freeze
  }

  // Obtener datos fiscales del cliente
  // 1. Desde la oportunidad vinculada (flujo pipeline)
  const opp = (cotizacion as Record<string, unknown>)?.oportunidades as Record<string, unknown> | null
  let empresaData = opp?.empresas as Record<string, unknown> | null

  // 2. Si no hay oportunidad, buscar empresa desde el negocio
  if (!empresaData) {
    try {
      const { supabase: sb } = await getWorkspace()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: negocio } = await (sb as any)
        .from('negocios')
        .select('empresa_id')
        .eq('id', id)
        .single()

      if (negocio?.empresa_id) {
        const { data: emp } = await sb
          .from('empresas')
          .select('id, nombre, numero_documento, tipo_documento, tipo_persona, regimen_tributario, gran_contribuyente, agente_retenedor, autorretenedor')
          .eq('id', negocio.empresa_id)
          .single()
        empresaData = emp as Record<string, unknown> | null
      }
    } catch {
      // Datos fiscales del cliente no son críticos para el editor
    }
  }

  const clientFiscal = empresaData
    ? {
        person_type: (empresaData.tipo_persona ?? null) as string | null,
        tax_regime: (empresaData.regimen_tributario ?? null) as string | null,
        gran_contribuyente: (empresaData.gran_contribuyente ?? false) as boolean,
        agente_retenedor: (empresaData.agente_retenedor ?? false) as boolean,
      }
    : null

  const fiscalProfile = fiscalResult.success ? fiscalResult.data ?? null : null

  // Fetch staff for mano de obra datalist
  let staffMembers: { id: string; nombre: string; tarifa_hora: number }[] = []
  try {
    const { supabase: sbStaff, workspaceId: wsId } = await getWorkspace()
    if (wsId) {
      const { data } = await sbStaff
        .from('staff')
        .select('id, full_name, salary, horas_disponibles_mes')
        .eq('workspace_id', wsId)
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
      initialItems={items as Parameters<typeof CotizacionEditor>[0]['initialItems']}
      fiscalProfile={fiscalProfile}
      clientFiscal={clientFiscal}
      backUrl={`/negocios/${id}`}
      staffMembers={staffMembers}
      frozen={frozen}
    />
  )
}
