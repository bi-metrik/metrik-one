import { getCotizacion, getCotizacionItems } from '@/app/(app)/pipeline/[id]/cotizaciones/actions-v2'
import { getFiscalProfile } from '@/app/(app)/config/fiscal-actions'
import { notFound } from 'next/navigation'
import CotizacionEditor from '@/app/(app)/pipeline/[id]/cotizacion/[cotId]/cotizacion-editor'

export default async function CotizacionNegocioPage({
  params,
}: {
  params: Promise<{ id: string; cotId: string }>
}) {
  const { id, cotId } = await params
  const [cotizacion, items, fiscalResult] = await Promise.all([
    getCotizacion(cotId),
    getCotizacionItems(cotId),
    getFiscalProfile(),
  ])

  if (!cotizacion) notFound()

  // Intentar obtener datos fiscales del cliente
  // 1. Desde la oportunidad vinculada (flujo pipeline)
  const opp = (cotizacion as Record<string, unknown>)?.oportunidades as Record<string, unknown> | null
  let empresaData = opp?.empresas as Record<string, unknown> | null

  // 2. Si no hay oportunidad, buscar empresa desde el negocio
  if (!empresaData) {
    const { supabase: sb } = await (await import('@/lib/actions/get-workspace')).getWorkspace()
    if (sb) {
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (
    <CotizacionEditor
      oportunidadId={id}
      cotizacion={cotizacion}
      initialItems={items as Parameters<typeof CotizacionEditor>[0]['initialItems']}
      fiscalProfile={fiscalProfile}
      clientFiscal={clientFiscal}
      backUrl={`/negocios/${id}`}
    />
  )
}
