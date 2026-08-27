import { redirect } from 'next/navigation'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { getRolePermissions } from '@/lib/roles'
import { getComercialData, getOperativoData, getFinancieroData, getRentabilidadComercialData, getProcesoPorSeccional } from './actions'
import {
  getComercialResumen, getComercialMes, getComercialSerie, getComercialSerieSeccional,
  getComercialSerieVendedor, getMetasComerciales,
  getComercialOrigenMes, getComercialSeccionalMes, getComercialPlanPagoMes, getCapacidadSeccional,
} from '../equipo/comercial-actions'
import { getOperacionesBono } from './operaciones-actions'
import { getDatosDueno } from '../calidad/actions'
import { bogotaYearMonth, bogotaParts } from '@/lib/dates/bogota'
import { necesitaDatosGenericos } from '@/lib/tableros/pestanas'
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
    // En un workspace de solo calidad, `/negocios` es un callejon sin salida:
    // el modulo no existe y la persona aterriza en una pantalla vacia. Se
    // resuelve el destino contra lo que el workspace SI tiene.
    redirect(await destinoSinNumeros(supabase, workspaceId))
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

  // Las tres genericas (Financiero/Comercial/Operativo) solo se consultan cuando
  // se van a pintar: son tres rondas de consultas y un workspace con tableros
  // propios no muestra ninguna. La condicion es la MISMA que usa la pantalla
  // para dibujarlas (`@/lib/tableros/pestanas`), escrita una sola vez.
  const [comercial, operativo, financiero] = necesitaDatosGenericos(modules)
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
    // El mes anterior se trae desde el servidor junto con el actual: la comparación
    // del panel (#41) tiene que estar en el primer render, o el tablero mostraría un
    // instante sin deltas que se lee como "no cambió nada".
    const prev = mesSel === 1
      ? { anio: anioSel - 1, mes: 12 }
      : { anio: anioSel, mes: mesSel - 1 }
    // Ventana de la capacidad por seccional (#43): los 6 meses cerrados hacia atras y
    // los 3 hacia adelante. Hacia ADELANTE porque una cita se agenda para el futuro y
    // ahi esta justo el dato que decide cuanto se puede vender este mes.
    const ventana = (meses: number) => {
      const d = new Date(Date.UTC(anioSel, mesSel - 1 + meses, 1))
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`
    }
    const [equipo, mesData, mesPrevio, origen, seccional, planPago, capacidad, serie, serieSeccional, serieVendedor, metas] = await Promise.all([
      getComercialResumen(),
      getComercialMes(anioSel, mesSel),
      getComercialMes(prev.anio, prev.mes),
      getComercialOrigenMes(anioSel, mesSel),
      getComercialSeccionalMes(anioSel, mesSel),
      getComercialPlanPagoMes(anioSel, mesSel),
      getCapacidadSeccional(ventana(-5), ventana(3)),
      getComercialSerie(12),
      getComercialSerieSeccional(12),
      getComercialSerieVendedor(12),
      getMetasComerciales(anioSel, mesSel),
    ])
    comercialNegocios = {
      equipo,
      mesInicial: mesData,
      mesAnteriorInicial: mesPrevio,
      origenInicial: origen,
      seccionalInicial: seccional,
      planPagoInicial: planPago,
      capacidad,
      serie,
      serieSeccional,
      serieVendedor,
      metasIniciales: metas,
      anioInicial: anioSel,
      mesNumInicial: mesSel,
      // El mes en curso se resuelve en el SERVIDOR y en hora de Bogotá: calcularlo en
      // el navegador lo ataría al reloj de quien mira, y Vercel corre en UTC.
      mesEnCurso: bogotaYearMonth(),
      diaEnCurso: bogotaParts().day,
      puedeEditarMetas: ['owner', 'admin', 'supervisor'].includes(role || ''),
    }
  }

  // Calidad de llamadas: dinero, embudo de cobro y riesgo. Gateado por su
  // propio flag Y por el permiso de dinero — es la unica superficie del modulo
  // que lleva plata, y `canViewNumbers` no alcanza: un supervisor lo tiene.
  //
  // No arrastra `mod.business`: la pestaña se empuja fuera de esa rama, igual
  // que ya lo hace Cumplimiento. Los flags son disjuntos, asi que ningun
  // workspace existente ve esto.
  const calidad = modules.calidad_llamadas && getRolePermissions(role || '').canViewCalidadDinero
    ? await getDatosDueno()
    : null

  // Vista "Casos" de la pestaña Operaciones: foto del proceso por etapa (gate
  // propio). La pestaña Operativo generica mide `proyectos`, vacio en los
  // workspaces Clarity; esta mide `negocios`.
  const procesoSeccional = modules.proceso_semanal ? await getProcesoPorSeccional() : null

  // Vista "Personas" de la misma pestaña (gate propio). Mide a las PERSONAS del
  // area, no el estado de los casos: son preguntas distintas y por eso cada una
  // conserva su modulo. El recorte del dinero lo hace la accion.
  const [anioOps, mesOps] = bogotaYearMonth().split('-')
  const operaciones = modules.operaciones_bonos
    ? await getOperacionesBono(Number(anioOps), Number(mesOps))
    : null

  return (
    <TablerosClient
      initialOperaciones={operaciones}
      initialProcesoSeccional={procesoSeccional}
      initialComercial={comercial}
      initialOperativo={operativo}
      initialFinanciero={financiero}
      initialRentabilidad={rentabilidad}
      initialComercialNegocios={comercialNegocios}
      initialCalidad={calidad}
      modules={modules}
    />
  )
}


/**
 * A donde mandar a quien no puede ver Numeros.
 *
 * `/negocios` era el destino unico y es correcto mientras el workspace tenga
 * el modulo de negocios. En uno de solo calidad no existe, asi que la persona
 * caia en una pantalla vacia sin forma de volver. El destino se resuelve
 * contra lo que el workspace realmente tiene.
 */
async function destinoSinNumeros(
  supabase: Awaited<ReturnType<typeof getWorkspace>>['supabase'],
  workspaceId: string | null,
): Promise<string> {
  if (!workspaceId || !supabase) return '/negocios'
  const { data } = await supabase.from('workspaces').select('modules').eq('id', workspaceId).single()
  const mods = (data?.modules as Record<string, boolean> | null) ?? {}
  if (!mods.business && mods.calidad_llamadas) return '/calidad'
  return '/negocios'
}
