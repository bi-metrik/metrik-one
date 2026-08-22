'use server'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { bogotaYearMonth } from '@/lib/dates/bogota'
import { canonizarSeccional } from '@/lib/dian/seccionales'
import { normalizarCortePlanPago } from './comercial-plan-pago'
import type {
  ComercialResumenRow,
  ComercialPerfil,
  ComercialVentaCaso,
  ComercialOrigenMes,
  ComercialPerdido,
  ComercialSeccionalFila,
  ComercialSeccionalMes,
  ComercialPlanPagoFila,
  ComercialPlanPagoMes,
  CapacidadPunto,
  CapacidadSeccional,
} from './comercial-types'

/**
 * Resumen comercial por responsable del workspace activo (incluye bucket sin
 * responsable). Alimenta la vista /equipo en workspaces con
 * modules.comercial_negocios. Sobre negocios+responsable_id, NO ventas_hechos.
 */
export async function getComercialResumen(
  anio: number | null = null,
  mes: number | null = null,
): Promise<ComercialResumenRow[]> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId || !supabase) return []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any).rpc('get_comercial_resumen_soena', {
    p_workspace_id: workspaceId,
    p_anio: anio,
    p_mes: mes,
  })
  return (data as ComercialResumenRow[]) ?? []
}

/**
 * Perfil de un responsable. staffId === 'sin-responsable' resuelve el bucket de
 * negocios sin responsable_id (la RPC lo interpreta como p_responsable_id NULL).
 */
export async function getComercialPerfil(
  staffId: string,
  anio: number | null = null,
  mes: number | null = null,
): Promise<ComercialPerfil | null> {
  const { supabase, workspaceId } = await getWorkspace()
  if (!workspaceId || !supabase) return null
  const responsableId = staffId === 'sin-responsable' ? null : staffId
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any).rpc('get_comercial_perfil_soena', {
    p_responsable_id: responsableId,
    p_anio: anio,
    p_mes: mes,
  })
  if (!data) return null
  return data as ComercialPerfil
}

// ── Iteracion 2: KPIs del mes, series, metas ──

import { revalidatePath } from 'next/cache'
import type {
  ComercialMesResponse,
  ComercialSerieResponse,
  MetaComercial,
} from './comercial-types'

/** KPIs + tabla por vendedor de un mes (default: mes actual Bogota). */
export async function getComercialMes(anio: number, mes: number): Promise<ComercialMesResponse | null> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId || !supabase) return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any).rpc('get_comercial_kpis_mes_soena', {
    p_workspace_id: workspaceId,
    p_anio: anio,
    p_mes: mes,
  })
  return (data as ComercialMesResponse) ?? null
}

/** Serie historica de los ultimos N meses. */
export async function getComercialSerie(meses = 12): Promise<ComercialSerieResponse | null> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId || !supabase) return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any).rpc('get_comercial_serie_mensual_soena', {
    p_workspace_id: workspaceId,
    p_meses: meses,
  })
  return (data as ComercialSerieResponse) ?? null
}

/** Metas del mes (global + por vendedor) para la mini UI de edicion. */
export async function getMetasComerciales(anio: number, mes: number): Promise<MetaComercial[]> {
  const { supabase, workspaceId } = await getWorkspace()
  if (!workspaceId || !supabase) return []
  // metas_comerciales aun no esta en database.ts generado -> cast puntual (mismo patron que otras tablas nuevas).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from('metas_comerciales')
    .select('id, staff_id, anio, mes, meta_num_ventas, meta_valor')
    .eq('workspace_id', workspaceId)
    .eq('anio', anio)
    .eq('mes', mes)
  return (data as MetaComercial[]) ?? []
}

/**
 * Mapa staff_id -> meta_num_ventas para un PERIODO, para el ranking de cumplimiento.
 *
 * - Por mes (anio+mes): la meta de ese vendedor en ese mes.
 * - Acumulado (anio+mes null): SUMA de las metas mensuales del vendedor en el anio
 *   en curso (Bogota). No se usa la meta global ni se reparte: un vendedor sin metas
 *   propias no aparece en el mapa (degrada a "sin meta" en el ranking).
 *
 * Solo cuenta metas con staff_id (por vendedor). La meta global (staff_id NULL) NO
 * entra: el cumplimiento por vendedor exige meta por vendedor.
 */
export async function getMetasPorVendedorPeriodo(
  anio: number | null,
  mes: number | null,
): Promise<Map<string, number>> {
  const { supabase, workspaceId } = await getWorkspace()
  const out = new Map<string, number>()
  if (!workspaceId || !supabase) return out
  // Acumulado: sumar todas las metas del anio en curso (Bogota). Por mes: solo ese mes.
  const anioBase = anio ?? Number(bogotaYearMonth().split('-')[0])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (supabase as any)
    .from('metas_comerciales')
    .select('staff_id, meta_num_ventas, mes')
    .eq('workspace_id', workspaceId)
    .eq('anio', anioBase)
    .not('staff_id', 'is', null)
  if (mes != null) query = query.eq('mes', mes)
  const { data } = await query
  for (const row of (data as { staff_id: string; meta_num_ventas: number | null }[]) ?? []) {
    if (!row.staff_id || row.meta_num_ventas == null) continue
    out.set(row.staff_id, (out.get(row.staff_id) ?? 0) + row.meta_num_ventas)
  }
  return out
}

// Editar metas: misma puerta que conciliacion (owner/admin/supervisor).
const ROLES_EDITAN_METAS = ['owner', 'admin', 'supervisor']

/**
 * Upsert de una meta (staffId null = meta global del equipo). Gate de rol
 * server-side. Valores null limpian la meta. Conflicto por (workspace, staff,
 * anio, mes) via indice unico NULLS NOT DISTINCT.
 */
export async function guardarMetaComercial(input: {
  staffId: string | null
  anio: number
  mes: number
  metaNumVentas: number | null
  metaValor: number | null
}): Promise<{ ok: boolean; error?: string }> {
  const { supabase, workspaceId, role, userId } = await getWorkspace()
  if (!workspaceId || !supabase) return { ok: false, error: 'Sin sesion' }
  if (!ROLES_EDITAN_METAS.includes(role ?? '')) {
    return { ok: false, error: 'Solo un supervisor, administrador o dueno puede editar metas.' }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from('metas_comerciales')
    .upsert(
      {
        workspace_id: workspaceId,
        staff_id: input.staffId,
        anio: input.anio,
        mes: input.mes,
        meta_num_ventas: input.metaNumVentas,
        meta_valor: input.metaValor,
        created_by: userId ?? null,
        updated_at: new Date().toISOString(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      { onConflict: 'workspace_id,staff_id,anio,mes' },
    )
  if (error) return { ok: false, error: error.message }
  revalidatePath('/equipo')
  return { ok: true }
}

/**
 * Los casos detras de una cifra del tablero comercial (drill-down).
 *
 * Se carga bajo demanda al hacer clic: la tabla no arrastra el detalle de las 30 ventas
 * del mes por si acaso. Mismo periodo y mismo criterio que la cifra, porque la RPC
 * consume la misma vista que la produjo.
 */
export async function getComercialVentasMes(input: {
  anio: number
  mes: number
  /** Filtra a un vendedor. `null` = todos. */
  responsableId?: string | null
  /** `true` = solo casos completos, `false` = solo incompletos, ausente = todos. */
  soloCompletos?: boolean | null
  /** Abre el bucket de negocios sin comercial atribuido. */
  sinResponsable?: boolean
  /** 'YYYY-MM-DD'. Abre las ventas de UN dia (la barra del gráfico diario). */
  dia?: string | null
  /**
   * Abre las ventas de UNA campaña. La cadena vacía abre el bucket de las que
   * vinieron de Meta sin campaña atribuida: es una pregunta distinta de "todas",
   * y por eso no comparte valor con `null`.
   */
  campana?: string | null
  /**
   * `true` = solo las ventas BONIFICABLES (#13), `false` = solo las que no lo son,
   * ausente = todas. Las que no se pudieron medir no caen en ninguno de los dos
   * filtros: no se sabe de qué lado van, y meterlas en uno sería inventarlo.
   */
  soloBonificables?: boolean | null
  /**
   * Acota a un conjunto EXPLÍCITO de casos. Lo usa el corte por seccional (#22): la
   * canonización vive en TS, así que el servidor no sabe qué negocios son "Bogotá" —
   * se le pasan los que ya sumaron la cifra, y la lista no puede discrepar de ella.
   * Un arreglo vacío acota a nada; `null`/ausente no acota.
   */
  negocioIds?: string[] | null
}): Promise<ComercialVentaCaso[]> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId || !supabase) return []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error: rpcError } = await (supabase as any).rpc('get_comercial_ventas_mes_soena', {
    p_workspace_id: workspaceId,
    p_anio: input.anio,
    p_mes: input.mes,
    p_responsable_id: input.responsableId ?? null,
    p_solo_completos: input.soloCompletos ?? null,
    p_sin_responsable: input.sinResponsable ?? false,
    p_dia: input.dia ?? null,
    p_campana: input.campana ?? null,
    p_solo_bonificables: input.soloBonificables ?? null,
    p_negocio_ids: input.negocioIds ?? null,
  })
  // El error se lee y se registra: descartarlo devuelve lista vacia y la pantalla diria
  // "no hay casos aqui" sobre una cifra que dice que si los hay — el fallo mudo que este
  // repo ya documenta con los selectores que "no encuentran nada".
  if (rpcError) {
    console.error('[comercial] no se pudieron traer los casos del mes:', rpcError)
    return []
  }
  return (data as ComercialVentaCaso[]) ?? []
}

/**
 * De dónde vinieron las ventas del mes (punto #23: el origen decide la comisión).
 *
 * Consume las MISMAS vistas que la cifra y que su drill, así que el desglose no
 * puede contradecir al total del panel. Devuelve `null` cuando la consulta falla,
 * para que la pantalla pueda callar en vez de pintar ceros: un cero aquí se leería
 * como "ninguna venta vino de Meta", que es una afirmación, no una ausencia.
 */
export async function getComercialOrigenMes(
  anio: number,
  mes: number,
): Promise<ComercialOrigenMes | null> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId || !supabase) return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error: rpcError } = await (supabase as any).rpc('get_comercial_origen_mes_soena', {
    p_workspace_id: workspaceId,
    p_anio: anio,
    p_mes: mes,
  })
  if (rpcError) {
    console.error('[comercial] no se pudo traer el origen del mes:', rpcError)
    return null
  }
  return (data as ComercialOrigenMes) ?? null
}

/**
 * Los casos detrás de la tasa de cancelación del mes.
 *
 * Va por su propia RPC y no por el drill de ventas porque un negocio perdido puede
 * no tener ningún cobro, y entonces no existe en `v_venta_mes_comercial`.
 */
export async function getComercialPerdidosMes(
  anio: number,
  mes: number,
): Promise<ComercialPerdido[]> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId || !supabase) return []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error: rpcError } = await (supabase as any).rpc('get_comercial_perdidos_mes_soena', {
    p_workspace_id: workspaceId,
    p_anio: anio,
    p_mes: mes,
  })
  if (rpcError) {
    console.error('[comercial] no se pudieron traer los casos perdidos:', rpcError)
    return []
  }
  return (data as ComercialPerdido[]) ?? []
}

// ── Corte por seccional DIAN (puntos #22 y #43) ─────────────────────────────
//
// ⚠️ La canonización vive AQUÍ y no en SQL a propósito. El catálogo de las 35
// seccionales está en `src/lib/dian/seccionales.ts`; copiarlo a una función de
// Postgres crearía una segunda fuente que se desincroniza el día que la DIAN
// cambie una, y el síntoma sería una ciudad partida en dos columnas — exactamente
// lo que el PR #236 vino a cerrar. Las RPC devuelven el texto CRUDO y aquí se
// colapsa, igual que hace `getProcesoPorSeccional` con las fotos históricas.

/** Nombre canónico de una seccional, o `null` si no hay dato. Nunca inventa. */
function canonizar(cruda: string | null | undefined): string | null {
  const t = cruda?.trim()
  if (!t) return null
  // Si el texto no está en el catálogo se conserva tal cual en vez de descartarlo:
  // perder la ciudad de un caso es peor que mostrar una grafía inesperada.
  return canonizarSeccional(t) ?? t
}

/**
 * Las cifras del mes abiertas por seccional (punto #22).
 *
 * Devuelve `null` cuando la consulta falla, para que la pantalla pueda callar en vez
 * de pintar una tabla vacía que se leería como "ninguna venta tiene seccional".
 */
export async function getComercialSeccionalMes(
  anio: number,
  mes: number,
): Promise<ComercialSeccionalMes | null> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId || !supabase) return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error: rpcError } = await (supabase as any).rpc('get_comercial_seccional_mes_soena', {
    p_workspace_id: workspaceId,
    p_anio: anio,
    p_mes: mes,
  })
  if (rpcError) {
    console.error('[comercial] no se pudo traer el corte por seccional:', rpcError)
    return null
  }
  if (!data) return null

  type Cruda = Omit<ComercialSeccionalFila, 'seccional'> & { seccional_cruda: string | null }
  const crudas = ((data.filas ?? []) as Cruda[])

  // Dos grafías de la misma ciudad SE SUMAN. Si se dejaran separadas, la comparación
  // contra el total del panel no cuadraría y aparecerían dos "Bogotá" en la tabla.
  const porSeccional = new Map<string, ComercialSeccionalFila>()
  for (const f of crudas) {
    const seccional = canonizar(f.seccional_cruda)
    const clave = seccional ?? ' sin-registrar'
    const acc = porSeccional.get(clave)
    if (!acc) {
      porSeccional.set(clave, { ...f, seccional, negocio_ids: [...(f.negocio_ids ?? [])] })
      continue
    }
    acc.ventas += f.ventas
    acc.valor_sin_iva += f.valor_sin_iva
    acc.valor_con_iva += f.valor_con_iva
    acc.primer_pago += f.primer_pago
    acc.segundo_pago += f.segundo_pago
    acc.recaudado += f.recaudado
    acc.casos_completos += f.casos_completos
    // `null + n` no es `n`: si una de las dos grafías no se pudo medir, la suma
    // tampoco. Sumar tratando el null como 0 diría que esas ventas no bonifican.
    acc.bonificables = acc.bonificables === null || f.bonificables === null
      ? null
      : acc.bonificables + f.bonificables
    acc.negocio_ids.push(...(f.negocio_ids ?? []))
  }

  // Orden de lectura: la seccional con más ventas primero, y el bucket sin registrar
  // SIEMPRE al final — es un hueco de dato, no una plaza del ranking de ciudades.
  const filas = [...porSeccional.values()].sort((a, b) => {
    if ((a.seccional === null) !== (b.seccional === null)) return a.seccional === null ? 1 : -1
    return b.ventas - a.ventas || (a.seccional ?? '').localeCompare(b.seccional ?? '')
  })

  return { total_ventas: Number(data.total_ventas ?? 0), filas }
}

// ── Corte por plan de pago ──────────────────────────────────────────────────

/**
 * Las ventas del mes cortadas por el plan con el que se cobra el honorario.
 *
 * Los dos planes se muestran SIEMPRE, incluso con cero ventas: "ninguna venta de agosto
 * es 50/50" es un dato del mes, y una fila ausente se lee como si nadie la hubiera
 * medido. El tercer grupo, `plan_pago = null`, es el de los negocios donde nadie declaró
 * plan, y no se pliega a plan 2 — que es exactamente lo que la vista hacía en silencio.
 *
 * Devuelve `null` cuando la consulta falla, para que la pantalla pueda callar en vez de
 * pintar una tabla vacía que se leería como "este mes no se vendió nada".
 */
export async function getComercialPlanPagoMes(
  anio: number,
  mes: number,
): Promise<ComercialPlanPagoMes | null> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId || !supabase) return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error: rpcError } = await (supabase as any).rpc('get_comercial_plan_pago_mes_soena', {
    p_workspace_id: workspaceId,
    p_anio: anio,
    p_mes: mes,
  })
  if (rpcError) {
    console.error('[comercial] no se pudo traer el corte por plan de pago:', rpcError)
    return null
  }
  if (!data) return null

  // La regla vive en `comercial-plan-pago.ts`, pura y con pruebas: es la que decide si
  // una casilla se lee como "no pagó" o como "no aplica".
  return normalizarCortePlanPago(
    (data.filas ?? []) as ComercialPlanPagoFila[],
    Number(data.total_ventas ?? 0),
  )
}

/**
 * Capacidad mensual por seccional (punto #43).
 *
 * `null` = la línea no declaró de dónde sale cada serie (`config_extra.capacidad`), o
 * la consulta falló. En los dos casos la pantalla calla: dibujar las series vacías
 * afirmaría que no hubo ni una cita ni un certificado en el periodo.
 */
export async function getCapacidadSeccional(
  desde: string,
  hasta: string,
): Promise<CapacidadSeccional | null> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId || !supabase) return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error: rpcError } = await (supabase as any).rpc('get_capacidad_seccional_soena', {
    p_workspace_id: workspaceId,
    p_desde: desde,
    p_hasta: hasta,
  })
  if (rpcError) {
    console.error('[comercial] no se pudo traer la capacidad por seccional:', rpcError)
    return null
  }
  if (!data) return null

  type PuntoCrudo = { seccional_cruda: string | null; mes: string; n: number }
  const colapsar = (puntos: PuntoCrudo[] | null | undefined): CapacidadPunto[] => {
    const acc = new Map<string, CapacidadPunto>()
    for (const p of puntos ?? []) {
      const seccional = canonizar(p.seccional_cruda)
      const clave = `${seccional ?? ' '}::${p.mes}`
      const prev = acc.get(clave)
      if (prev) prev.n += Number(p.n)
      else acc.set(clave, { seccional, mes: p.mes, n: Number(p.n) })
    }
    return [...acc.values()]
  }

  return {
    desde: data.desde,
    hasta: data.hasta,
    rastro_etapas_desde: data.rastro_etapas_desde ?? null,
    certificaciones_cobertura: data.certificaciones_cobertura ?? { con_rastro: 0, con_evidencia: 0 },
    errores_sin_fuente: Boolean(data.errores_sin_fuente),
    citas: colapsar(data.citas),
    certificaciones: colapsar(data.certificaciones),
    finalizados: colapsar(data.finalizados),
  }
}
