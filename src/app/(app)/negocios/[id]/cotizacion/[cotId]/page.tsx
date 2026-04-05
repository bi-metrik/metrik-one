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

  // Para cotizaciones de negocios sin oportunidad vinculada, clientFiscal es null
  // Si en el futuro se vincula empresa al negocio, se puede extender aquí
  const empresa = (cotizacion as Record<string, unknown>)?.oportunidades as Record<string, unknown> | null
  const empresaData = empresa?.empresas as Record<string, unknown> | null
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
