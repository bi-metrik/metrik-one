import { redirect } from 'next/navigation'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { getRolePermissions } from '@/lib/roles'
import { getComercialData, getOperativoData, getFinancieroData, getRentabilidadComercialData, getProcesoPorSeccional } from './actions'
import { getDirectivo } from './directivo-actions'
import {
  getComercialResumen, getComercialMes, getComercialSerie, getComercialSerieSeccional,
  getComercialSerieVendedor,
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

  // Gate del tablero comercial sobre negocios y de la pestaña Direccion: el modulo
  // mas un rol gerencial. Las dos miran las mismas cifras agregadas de la operacion.
  const puedeVerComercialNegocios = modules.comercial_negocios
    && ['owner', 'admin', 'supervisor'].includes(role || '')

  // Todo lo que alimenta las pestanas se pide DE UNA VEZ, no en fila.
  //
  // Cada bloque venia con su propio `await`, asi que el servidor esperaba a que
  // terminara uno para empezar el siguiente: en SOENA eso daba ~9 s de espera en
  // blanco antes del primer pixel, con la base respondiendo cada consulta en
  // milisegundos. Ninguno de estos bloques depende del resultado de otro (todos
  // dependen solo de `modules` y `role`, que ya estan resueltos), asi que el
  // tiempo de la pantalla pasa a ser el del bloque MAS LENTO en vez de la suma.
  //
  // Cada rama conserva su gate: un bloque apagado no consulta nada, igual que antes.
  const [
    genericas,
    rentabilidad,
    comercialNegocios,
    directivo,
    calidad,
    procesoSeccional,
    operaciones,
  ] = await Promise.all([
    // Las tres genericas (Financiero/Comercial/Operativo) solo se consultan cuando
    // se van a pintar: son tres rondas de consultas y un workspace con tableros
    // propios no muestra ninguna. La condicion es la MISMA que usa la pantalla
    // para dibujarlas (`@/lib/tableros/pestanas`), escrita una sola vez.
    necesitaDatosGenericos(modules)
      ? Promise.all([
          getComercialData('mes'),
          getOperativoData('mes'),
          getFinancieroData('6meses'),
        ])
      : Promise.resolve([null, null, null] as const),

    // Rentabilidad Comercial: gateado por su propio modulo (alimentado por ventas_hechos)
    modules.rentabilidad_comercial ? getRentabilidadComercialData() : null,

    // Tablero comercial sobre negocios (Clarity, ej. SOENA): gateado por modulo
    // comercial_negocios + rol gerencial (owner/admin/supervisor). Vive en la pestaña
    // "Comercial" de Tableros (los indicadores AGREGADOS no son de Equipo).
    puedeVerComercialNegocios ? cargarComercialNegocios(role) : null,

    // Pestana Direccion: la replica del Sheet que JD lleva a mano. Mismo gate que el
    // tablero comercial (modulo + rol gerencial), porque son las mismas cifras agregadas
    // de toda la operacion vistas desde arriba.
    puedeVerComercialNegocios
      ? getDirectivo(Number(bogotaYearMonth().split('-')[0]), Number(bogotaYearMonth().split('-')[1]))
      : null,

    // Calidad de llamadas: dinero, embudo de cobro y riesgo. Gateado por su
    // propio flag Y por el permiso de dinero — es la unica superficie del modulo
    // que lleva plata, y `canViewNumbers` no alcanza: un supervisor lo tiene.
    //
    // No arrastra `mod.business`: la pestaña se empuja fuera de esa rama, igual
    // que ya lo hace Cumplimiento. Los flags son disjuntos, asi que ningun
    // workspace existente ve esto.
    modules.calidad_llamadas && getRolePermissions(role || '').canViewCalidadDinero
      ? getDatosDueno()
      : null,

    // Vista "Casos" de la pestaña Operaciones: foto del proceso por etapa (gate
    // propio). La pestaña Operativo generica mide `proyectos`, vacio en los
    // workspaces Clarity; esta mide `negocios`.
    modules.proceso_semanal ? getProcesoPorSeccional() : null,

    // Vista "Personas" de la misma pestaña (gate propio). Mide a las PERSONAS del
    // area, no el estado de los casos: son preguntas distintas y por eso cada una
    // conserva su modulo. El recorte del dinero lo hace la accion.
    modules.operaciones_bonos
      ? getOperacionesBono(
          Number(bogotaYearMonth().split('-')[0]),
          Number(bogotaYearMonth().split('-')[1]),
        )
      : null,
  ])

  const [comercial, operativo, financiero] = genericas

  return (
    <TablerosClient
      initialDirectivo={directivo}
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
 * Las once consultas del tablero comercial sobre negocios (Clarity).
 *
 * Vivia en linea dentro de la pagina; se saco aparte para que el `Promise.all`
 * que lanza todos los bloques quepa en una pantalla y se vea que ninguno
 * espera a otro.
 */
async function cargarComercialNegocios(role: string | null) {
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
  const [equipo, mesData, mesPrevio, origen, seccional, planPago, capacidad, serie, serieSeccional, serieVendedor] = await Promise.all([
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
  ])
  return {
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
    anioInicial: anioSel,
    mesNumInicial: mesSel,
    // El mes en curso se resuelve en el SERVIDOR y en hora de Bogotá: calcularlo en
    // el navegador lo ataría al reloj de quien mira, y Vercel corre en UTC.
    mesEnCurso: bogotaYearMonth(),
    diaEnCurso: bogotaParts().day,
    puedeEditarMetas: ['owner', 'admin', 'supervisor'].includes(role || ''),
  }
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
