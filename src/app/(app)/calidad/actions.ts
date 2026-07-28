'use server'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { createServiceClient } from '@/lib/supabase/server'
import { getRolePermissions } from '@/lib/roles'
import type {
  DineroCuota,
  DuenoData,
  EventoCinta,
  Hallazgo,
  LlamadaDetalle,
  LlamadaResumen,
  MuroData,
  Semaforo,
  Severidad,
} from './types'

/**
 * Las tablas `calidad_*` todavia no estan en el `database.ts` generado.
 * Regenerarlo obliga a re-agregar a mano los ~26 alias custom del final del
 * archivo y arrastraria drift de schema de otras ramas abiertas, asi que se usa
 * el mismo escape puntual que ya emplean `kyc_expediente_ref` y
 * `bloque-locks.ts`: un cast acotado, en un solo sitio.
 *
 * DEUDA: al regenerar los tipos, borrar `sinTipar` y consultar el cliente
 * directo. Mientras tanto, todo acceso a calidad_* pasa por aqui — no se
 * dispersan `as any` por el modulo.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sinTipar = (cliente: unknown) => cliente as any

/**
 * Contexto resuelto una vez por request: workspace, rol, permisos de calidad y
 * el staff del usuario.
 *
 * `staffId` viene de getWorkspace() y es `staff.id` (resuelto por profile_id).
 * Es el MISMO id contra el que el seed asigna `agente_staff_id`; si divergen,
 * el ejecutor ve cero llamadas.
 */
async function ctxCalidad() {
  const { supabase, workspaceId, role, staffId } = await getWorkspace()
  if (!workspaceId || !role) return null

  const { data: ws } = await supabase
    .from('workspaces')
    .select('name, modules, config_extra')
    .eq('id', workspaceId)
    .single()

  const modules = (ws as { modules: Record<string, boolean> | null } | null)?.modules
  if (!modules?.calidad_llamadas) return null

  const perms = getRolePermissions(role)
  if (!perms.canViewCalidad) return null

  return {
    supabase,
    workspaceId,
    role,
    staffId,
    perms,
    nombreWorkspace: (ws as { name: string } | null)?.name ?? '',
    configExtra: (ws as { config_extra: Record<string, unknown> | null } | null)?.config_extra ?? {},
  }
}

/** Expuesto a las pages para decidir el guard sin duplicar la resolucion. */
export async function getContextoCalidad() {
  const ctx = await ctxCalidad()
  if (!ctx) return null
  return {
    role: ctx.role,
    nombreWorkspace: ctx.nombreWorkspace,
    canViewCalidadTodos: ctx.perms.canViewCalidadTodos as boolean,
    canViewCalidadDinero: ctx.perms.canViewCalidadDinero as boolean,
    muroToken: (ctx.configExtra as { muro_token?: string }).muro_token ?? null,
    muroPublico: (ctx.configExtra as { muro_publico?: boolean }).muro_publico === true,
  }
}

type FilaLlamada = {
  id: string
  cliente_ref: string
  fecha_hora: string
  direccion: string
  duracion_seg: number
  agente_nombre: string
  puntaje_tecnico: number
  semaforo: string
  detalle_completo: boolean
  es_real: boolean
}

/**
 * Lista de llamadas del workspace.
 *
 * LIMITACION HONESTA, a proposito por escrito: el filtro del ejecutor es de
 * APLICACION, no de base de datos — igual que hoy en /negocios. Un ejecutor con
 * la anon key y PostgREST directo veria las llamadas de sus companeros, porque
 * la policy RLS aisla por workspace, no por agente. No es una regresion
 * (replica el modelo vigente del producto), pero tampoco cierra ese hueco.
 */
export async function getLlamadas(): Promise<LlamadaResumen[]> {
  const ctx = await ctxCalidad()
  if (!ctx) return []

  let q = sinTipar(ctx.supabase)
    .from('calidad_llamadas')
    .select(
      'id, cliente_ref, fecha_hora, direccion, duracion_seg, agente_nombre, puntaje_tecnico, semaforo, detalle_completo, es_real',
    )
    .eq('workspace_id', ctx.workspaceId)
    .order('fecha_hora', { ascending: false })

  if (!ctx.perms.canViewCalidadTodos) {
    // Fail-closed: sin staff resuelto no se devuelve nada. Devolver todo seria
    // exactamente el bug que este filtro existe para evitar.
    if (!ctx.staffId) return []
    q = q.eq('agente_staff_id', ctx.staffId)
  }

  const { data, error } = await q
  if (error || !data) return []

  const filas = data as FilaLlamada[]
  const ids = filas.map((f) => f.id)
  if (ids.length === 0) return []

  const { data: hallazgos } = await sinTipar(ctx.supabase)
    .from('calidad_llamadas_hallazgos')
    .select('llamada_id, codigo, severidad')
    .eq('workspace_id', ctx.workspaceId)
    .eq('eje', 'cumplimiento')
    .in('llamada_id', ids)

  const porLlamada = new Map<string, { codigos: Set<string>; criticas: number }>()
  for (const h of (hallazgos ?? []) as { llamada_id: string; codigo: string | null; severidad: string | null }[]) {
    if (!h.codigo) continue
    const acc = porLlamada.get(h.llamada_id) ?? { codigos: new Set<string>(), criticas: 0 }
    acc.codigos.add(h.codigo)
    if (h.severidad === 'critica') acc.criticas += 1
    porLlamada.set(h.llamada_id, acc)
  }

  return filas.map((f) => {
    const agg = porLlamada.get(f.id)
    return {
      id: f.id,
      clienteRef: f.cliente_ref,
      fechaHora: f.fecha_hora,
      direccion: f.direccion as LlamadaResumen['direccion'],
      duracionSeg: f.duracion_seg,
      agenteNombre: f.agente_nombre,
      puntajeTecnico: f.puntaje_tecnico,
      semaforo: f.semaforo as Semaforo,
      detalleCompleto: f.detalle_completo,
      esReal: f.es_real,
      codigos: agg ? [...agg.codigos].sort() : [],
      criticas: agg?.criticas ?? 0,
    }
  })
}

/**
 * Detalle de una llamada.
 *
 * El filtro del ejecutor se repite AQUI, no solo en la lista. Filtrar unicamente
 * la lista deja abierto /calidad/llamada/<id-ajeno> por URL directa: ese es el
 * hueco clasico. Devuelve null → la page hace notFound().
 */
export async function getLlamadaDetalle(id: string): Promise<LlamadaDetalle | null> {
  const ctx = await ctxCalidad()
  if (!ctx) return null

  let q = sinTipar(ctx.supabase)
    .from('calidad_llamadas')
    .select('*')
    .eq('workspace_id', ctx.workspaceId)
    .eq('id', id)

  if (!ctx.perms.canViewCalidadTodos) {
    if (!ctx.staffId) return null
    q = q.eq('agente_staff_id', ctx.staffId)
  }

  const { data: fila } = await q.maybeSingle()
  if (!fila) return null

  const l = fila as FilaLlamada & {
    habla_agente_pct: number | null
    habla_cliente_pct: number | null
    turnos: number | null
    repreguntas: number | null
    monologos_45s: number | null
  }

  const [{ data: bloquesRaw }, { data: hallazgosRaw }] = await Promise.all([
    sinTipar(ctx.supabase)
      .from('calidad_llamadas_bloques')
      .select('orden, nombre, puntaje, puntaje_max')
      .eq('llamada_id', id)
      .order('orden'),
    sinTipar(ctx.supabase)
      .from('calidad_llamadas_hallazgos')
      .select('id, eje, codigo, severidad, titulo, hecho, cita, segundo, turno_ref')
      .eq('llamada_id', id)
      .order('segundo'),
  ])

  const hallazgos = (hallazgosRaw ?? []) as {
    id: string
    eje: string
    codigo: string | null
    severidad: string | null
    titulo: string
    hecho: string | null
    cita: string | null
    segundo: number
    turno_ref: string | null
  }[]

  const banderas: Hallazgo[] = hallazgos
    .filter((h) => h.eje === 'cumplimiento' && h.codigo)
    .map((h) => ({
      id: h.id,
      codigo: h.codigo!,
      severidad: (h.severidad ?? 'media') as Severidad,
      titulo: h.titulo,
      hecho: h.hecho,
      cita: h.cita,
      segundo: h.segundo,
      turnoRef: h.turno_ref,
    }))
    .sort((a, b) => a.codigo.localeCompare(b.codigo))

  const eventos: EventoCinta[] = hallazgos
    .filter((h) => h.eje === 'tecnica')
    .map((h) => ({ id: h.id, titulo: h.titulo, segundo: h.segundo }))

  return {
    id: l.id,
    clienteRef: l.cliente_ref,
    fechaHora: l.fecha_hora,
    direccion: l.direccion as LlamadaResumen['direccion'],
    duracionSeg: l.duracion_seg,
    agenteNombre: l.agente_nombre,
    puntajeTecnico: l.puntaje_tecnico,
    semaforo: l.semaforo as Semaforo,
    detalleCompleto: l.detalle_completo,
    esReal: l.es_real,
    codigos: [...new Set(banderas.map((b) => b.codigo))].sort(),
    criticas: banderas.filter((b) => b.severidad === 'critica').length,
    hablaAgentePct: l.habla_agente_pct,
    hablaClientePct: l.habla_cliente_pct,
    turnos: l.turnos,
    repreguntas: l.repreguntas,
    monologos45s: l.monologos_45s,
    bloques: ((bloquesRaw ?? []) as {
      orden: number
      nombre: string
      puntaje: number
      puntaje_max: number
    }[]).map((b) => ({
      orden: b.orden,
      nombre: b.nombre,
      puntaje: b.puntaje,
      puntajeMax: b.puntaje_max,
    })),
    banderas,
    eventos,
  }
}

/**
 * Muro del dia. Sale de la RPC get_calidad_muro, que por construccion no
 * devuelve `cliente_ref` ni ninguna columna monetaria.
 */
export async function getMuro(fecha?: string): Promise<MuroData | null> {
  const ctx = await ctxCalidad()
  if (!ctx) return null
  return getMuroPorWorkspace(ctx.workspaceId, fecha)
}

/**
 * Version sin sesion, para el muro publico por enlace. La usa
 * (public)/muro/[token], que ya valido el modulo, el opt-in y el token.
 * Corre con service_role.
 */
export async function getMuroPorWorkspace(workspaceId: string, fecha?: string): Promise<MuroData | null> {
  const svc = createServiceClient()
  // La RPC tampoco esta en el database.ts generado todavia (misma deuda que las
  // tablas): pasa por `sinTipar`.
  const { data, error } = await sinTipar(svc).rpc('get_calidad_muro', {
    p_workspace_id: workspaceId,
    ...(fecha ? { p_fecha: fecha } : {}),
  })
  if (error || !data) return null
  return data as MuroData
}

/**
 * Vista de dueno: vendido contra recaudado hasta la cuota 6.
 *
 * `calidad_dinero_cuotas` no tiene grant a `authenticated` ni policy: se lee
 * SOLO con service_role. Por eso este action valida el rol a mano antes de
 * tocar la tabla — no hay RLS que lo respalde aguas abajo.
 */
export async function getDatosDueno(): Promise<DuenoData | null> {
  const ctx = await ctxCalidad()
  if (!ctx) return null
  if (!ctx.perms.canViewCalidadDinero) return null

  const svc = createServiceClient()

  const { data: cuotasRaw } = await sinTipar(svc)
    .from('calidad_dinero_cuotas')
    .select('cuota, ventas, vendido_usd, recaudado_usd')
    .eq('workspace_id', ctx.workspaceId)
    .order('cuota')

  const cuotas: DineroCuota[] = ((cuotasRaw ?? []) as {
    cuota: number
    ventas: number
    vendido_usd: string | number
    recaudado_usd: string | number
  }[]).map((c) => ({
    cuota: c.cuota,
    ventas: c.ventas,
    vendidoUsd: Number(c.vendido_usd),
    recaudadoUsd: Number(c.recaudado_usd),
  }))

  const vendidoTotal = cuotas.reduce((a, c) => a + c.vendidoUsd, 0)
  const recaudadoTotal = cuotas.reduce((a, c) => a + c.recaudadoUsd, 0)

  // Banderas criticas abiertas del workspace, agregadas por codigo.
  const { data: criticasRaw } = await sinTipar(ctx.supabase)
    .from('calidad_llamadas_hallazgos')
    .select('codigo, titulo')
    .eq('workspace_id', ctx.workspaceId)
    .eq('eje', 'cumplimiento')
    .eq('severidad', 'critica')

  const agg = new Map<string, { titulo: string; veces: number }>()
  for (const h of (criticasRaw ?? []) as { codigo: string | null; titulo: string }[]) {
    if (!h.codigo) continue
    const prev = agg.get(h.codigo)
    agg.set(h.codigo, { titulo: prev?.titulo ?? h.titulo, veces: (prev?.veces ?? 0) + 1 })
  }

  return {
    cuotas,
    vendidoTotal,
    recaudadoTotal,
    recaudoPct: vendidoTotal > 0 ? Math.round((recaudadoTotal / vendidoTotal) * 100) : 0,
    ventasCerradas: cuotas[0]?.ventas ?? 0,
    llegaronCuota6: cuotas[cuotas.length - 1]?.ventas ?? 0,
    criticasAbiertas: [...agg.entries()]
      .map(([codigo, v]) => ({ codigo, ...v }))
      .sort((a, b) => b.veces - a.veces),
  }
}
