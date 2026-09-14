import { getCotizacion, getCotizacionItems } from '@/app/(app)/negocios/cotizacion-actions'
import { getEstadoItinerarios } from '@/app/(app)/negocios/itinerario-actions'
import { getFiscalProfile } from '@/app/(app)/config/fiscal-actions'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { notFound } from 'next/navigation'
import CotizacionEditor from '@/app/(app)/negocios/cotizacion-editor'
import {
  politicaMargenDeLinea,
  umbralesDeCotizacion,
  UMBRALES_MARGEN_POR_DEFECTO,
  type UmbralesMargen,
} from '@/lib/cotizaciones/convencion-margen'

export default async function CotizacionNegocioPage({
  params,
}: {
  params: Promise<{ id: string; cotId: string }>
}) {
  const { id, cotId } = await params

  // getFiscalProfile tiene getWorkspace() interno que THROWS — catch para no crashear
  const [cotizacion, items, fiscalResult, itinerarios] = await Promise.all([
    getCotizacion(cotId),
    getCotizacionItems(cotId),
    getFiscalProfile().catch(() => ({ success: false as const, data: null })),
    // La tabla de combinaciones. Devuelve vacio cuando la cotizacion no tiene
    // opciones —que es toda cotizacion anterior a este frente— y tambien cuando la
    // migracion no esta aplicada: en los dos casos la pantalla se ve como hoy.
    getEstadoItinerarios(cotId),
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
  // Tambien capturamos linea_id para filtrar catalogo de servicios por linea
  let negocioLineaId: string | null = null
  if (!empresaData) {
    try {
      const { supabase: sb } = await getWorkspace()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: negocio } = await (sb as any)
        .from('negocios')
        .select('empresa_id, linea_id')
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
      negocioLineaId = negocio?.linea_id ?? null
    } catch {
      // Datos fiscales del cliente no son críticos para el editor
    }
  } else {
    // Si vino por oportunidad, igual buscamos linea_id del negocio para filtrar catalogo
    try {
      const { supabase: sb } = await getWorkspace()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: negocio } = await (sb as any)
        .from('negocios').select('linea_id').eq('id', id).single()
      negocioLineaId = negocio?.linea_id ?? null
    } catch {}
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

  // Los umbrales de margen: manda lo que la cotización CONGELÓ al nacer y la política
  // de la línea solo entra donde la cotización no diga nada. La precedencia se resuelve
  // aquí, una sola vez, con el helper puro — la pantalla recibe dos números y ya.
  //
  // Mientras la migración `20260914160000` no esté aplicada, las dos columnas llegan
  // como `undefined` (el `select('*')` de `getCotizacion` no falla por columnas que no
  // existen) y todo cae a la línea, que es el comportamiento de hoy.
  let politicaLinea: UmbralesMargen = UMBRALES_MARGEN_POR_DEFECTO
  if (negocioLineaId) {
    try {
      const { supabase: sbLinea } = await getWorkspace()
      const { data: linea } = await sbLinea
        .from('lineas_negocio')
        .select('config_extra')
        .eq('id', negocioLineaId)
        .maybeSingle()
      const { pisoPct, avisoPct } = politicaMargenDeLinea(
        (linea as { config_extra?: unknown } | null)?.config_extra,
      )
      politicaLinea = { pisoPct, avisoPct }
    } catch {
      // Sin la línea rigen los umbrales por defecto: el color de una cifra no puede
      // depender de que una consulta secundaria responda.
    }
  }

  const cotRow = cotizacion as unknown as { piso_margen_pct?: number | null; aviso_margen_pct?: number | null }
  const umbrales = umbralesDeCotizacion(
    { pisoPct: cotRow.piso_margen_pct, avisoPct: cotRow.aviso_margen_pct },
    politicaLinea,
  )

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
      lineaId={negocioLineaId}
      umbrales={umbrales}
      itinerarios={itinerarios}
    />
  )
}
