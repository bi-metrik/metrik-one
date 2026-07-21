import { redirect } from 'next/navigation'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { getRolePermissions } from '@/lib/roles'
import { getComercialData, getOperativoData, getFinancieroData, getRentabilidadComercialData } from './actions'
import { getComercialResumen, getComercialMes, getComercialSerie, getMetasComerciales } from '../equipo/comercial-actions'
import { bogotaYearMonth } from '@/lib/dates/bogota'
import TablerosClient from './tableros-client'
import VitrinaPlaceholder from '@/components/vitrina-placeholder'
import { getVitrinaCopy } from '@/lib/workspace/vitrina'

export default async function TablerosPage() {
  const { supabase, workspaceId, role } = await getWorkspace()

  // Modo vitrina: el workspace solo compró Valida. Tableros se muestra como vitrina
  // comercial de upsell a ONE — bypassa el guard de permiso canViewNumbers.
  const vitrina = await getVitrinaCopy(supabase, workspaceId)
  if (vitrina) {
    return <VitrinaPlaceholder title="Tableros" body={vitrina.tableros} />
  }

  const perms = getRolePermissions(role || '')
  if (!perms.canViewNumbers) {
    redirect('/negocios')
  }

  // Load workspace modules
  let modules: Record<string, boolean> = { business: true }
  if (workspaceId && supabase) {
    const { data: ws } = await supabase
      .from('workspaces')
      .select('modules')
      .eq('id', workspaceId)
      .single()
    modules = (ws?.modules as Record<string, boolean> | null) ?? { business: true }
  }

  // Only fetch business data if business module is active
  const [comercial, operativo, financiero] = modules.business
    ? await Promise.all([
        getComercialData('mes'),
        getOperativoData('mes'),
        getFinancieroData('6meses'),
      ])
    : [null, null, null]

  // Rentabilidad Comercial: gateado por su propio modulo (alimentado por ventas_hechos)
  const rentabilidad = modules.rentabilidad_comercial
    ? await getRentabilidadComercialData()
    : null

  // Tablero comercial sobre negocios (Clarity, ej. SOENA): gateado por modulo
  // comercial_negocios + rol gerencial (owner/admin/supervisor). Vive en la pestaña
  // "Comercial" de Tableros (los indicadores AGREGADOS no son de Equipo).
  const puedeVerComercialNegocios = modules.comercial_negocios
    && ['owner', 'admin', 'supervisor'].includes(role || '')
  let comercialNegocios = null
  if (puedeVerComercialNegocios) {
    const [anioStr, mesStr] = bogotaYearMonth().split('-')
    const anioSel = Number(anioStr)
    const mesSel = Number(mesStr)
    const [equipo, mesData, serie, metas] = await Promise.all([
      getComercialResumen(),
      getComercialMes(anioSel, mesSel),
      getComercialSerie(12),
      getMetasComerciales(anioSel, mesSel),
    ])
    comercialNegocios = {
      equipo,
      mesInicial: mesData,
      serie,
      metasIniciales: metas,
      anioInicial: anioSel,
      mesNumInicial: mesSel,
      puedeEditarMetas: ['owner', 'admin', 'supervisor'].includes(role || ''),
    }
  }

  return (
    <TablerosClient
      initialComercial={comercial}
      initialOperativo={operativo}
      initialFinanciero={financiero}
      initialRentabilidad={rentabilidad}
      initialComercialNegocios={comercialNegocios}
      modules={modules}
    />
  )
}
