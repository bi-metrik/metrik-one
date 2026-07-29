'use server'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { createServiceClient } from '@/lib/supabase/server'
import { getRolePermissions } from '@/lib/roles'
import { slugAgente } from './types'
import type {
  DuenoData,
  PerfilAgente,
  EventoCinta,
  Hallazgo,
  LlamadaDetalle,
  LlamadaResumen,
  ListaLlamadas,
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
  fecha_grabacion: string | null
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
/**
 * Lista de llamadas del periodo, con sus banderas, sus KPIs y su tope.
 *
 * Todo sale de UNA consulta (`get_calidad_lista`). Antes eran dos: una traia
 * las filas y otra pedia los hallazgos con `.in('llamada_id', [...ids])`. Esa
 * segunda consulta se rompia en silencio pasados ~300 ids (la URL supera los
 * 14 KB) y la columna de banderas quedaba vacia en TODAS las filas, incluida la
 * llamada real que tiene seis. Comprobado midiendo el corte, no supuesto.
 *
 * El tope es explicito y viaja de vuelta (`total` y `mostradas`) para que la
 * pantalla pueda decir cuantas enseña de cuantas, en vez de presentar el limite
 * por defecto de PostgREST como si fuera el dato.
 */
export async function getLlamadas(dias = 30, limite = 300): Promise<ListaLlamadas | null> {
  const ctx = await ctxCalidad()
  if (!ctx) return null

  // Fail-closed: un ejecutor sin staff resuelto no ve nada. Devolver todo seria
  // exactamente el agujero que este filtro existe para tapar.
  let staffId: string | null = null
  if (!ctx.perms.canViewCalidadTodos) {
    if (!ctx.staffId) return null
    staffId = ctx.staffId
  }

  const { data, error } = await sinTipar(ctx.supabase).rpc('get_calidad_lista', {
    p_workspace_id: ctx.workspaceId,
    p_staff_id: staffId,
    p_dias: dias,
    p_limite: limite,
  })
  if (error || !data) return null
  return data as ListaLlamadas
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
    fechaGrabacion: l.fecha_grabacion,
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
/**
 * Vista de dueño: vendido contra recaudado, cuota por cuota.
 *
 * Las ventas y el vendido salen de `get_calidad_dinero`, que los cuenta sobre
 * `calidad_llamadas` — la MISMA fuente y el mismo corte que el muro. Antes
 * venian de `calidad_dinero_cuotas`, una tabla sembrada aparte, y al reanclar
 * la historia las dos pantallas quedaron diciendo cosas distintas del mismo
 * mes: 37 ventas aqui contra 626 cierres alla. Con una sola fuente esa
 * contradiccion deja de ser posible, que es la razon del cambio y no el ahorro
 * de una consulta.
 *
 * El reparto a seis cuotas se deriva con la regla escrita en la migracion, a
 * partir del recobro real. Las banderas criticas siguen contandose sobre los
 * hallazgos.
 */
export async function getDatosDueno(): Promise<DuenoData | null> {
  const ctx = await ctxCalidad()
  if (!ctx) return null
  if (!ctx.perms.canViewCalidadDinero) return null

  const { data, error } = await sinTipar(ctx.supabase).rpc('get_calidad_dinero', {
    p_workspace_id: ctx.workspaceId,
    p_dias: 30,
  })
  if (error || !data) return null
  const dinero = data as Omit<DuenoData, 'criticasAbiertas'>

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
    ...dinero,
    criticasAbiertas: [...agg.entries()]
      .map(([codigo, v]) => ({ codigo, ...v }))
      .sort((a, b) => b.veces - a.veces),
  }
}

/**
 * Perfil de un agente: como viene, hacia donde va y donde entrenar.
 *
 * El agente se identifica por SLUG del nombre, no por su nombre en la URL:
 * "felipe-sandoval" en vez de "Felipe%20Sandoval". El slug se resuelve contra
 * los agentes que existen en el workspace, asi que la URL no es un canal para
 * pedir un nombre arbitrario — solo puede apuntar a alguien que ya audita aqui.
 *
 * PERMISOS. Un ejecutor solo puede abrir SU perfil. No es cosmetico: el perfil
 * lleva el desglose por bloque de otra persona, que es exactamente lo que la
 * segmentacion por rol existe para no mostrar. Se valida contra el nombre
 * resuelto desde su `staff_id`, no contra el slug que venga en la URL.
 */
export async function getPerfilAgente(
  slug: string,
  dias = 30,
): Promise<PerfilAgente | null> {
  const ctx = await ctxCalidad()
  if (!ctx) return null

  // Agentes reales del workspace. `distinct` en el cliente porque PostgREST no
  // expone DISTINCT: son pocas filas por pagina y solo se leen nombres.
  const { data: filas } = await sinTipar(ctx.supabase)
    .from('calidad_llamadas')
    .select('agente_nombre, agente_staff_id')
    .eq('workspace_id', ctx.workspaceId)
    .limit(4000)

  const nombres = new Map<string, string | null>()
  for (const f of (filas ?? []) as { agente_nombre: string; agente_staff_id: string | null }[]) {
    if (!nombres.has(f.agente_nombre) || f.agente_staff_id) {
      nombres.set(f.agente_nombre, f.agente_staff_id ?? nombres.get(f.agente_nombre) ?? null)
    }
  }

  const entrada = [...nombres.entries()].find(([n]) => slugAgente(n) === slug)
  if (!entrada) return null
  const [nombre, staffDelAgente] = entrada

  // Fail-closed: sin staff resuelto, un ejecutor no abre ningun perfil.
  if (!ctx.perms.canViewCalidadTodos) {
    if (!ctx.staffId) return null
    if (staffDelAgente !== ctx.staffId) return null
  }

  const hasta = new Date()
  const desde = new Date(hasta)
  desde.setDate(desde.getDate() - (dias - 1))
  const iso = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' })

  const { data, error } = await sinTipar(ctx.supabase).rpc('get_calidad_perfil_agente', {
    p_workspace_id: ctx.workspaceId,
    p_agente: nombre,
    p_desde: iso(desde),
    p_hasta: iso(hasta),
  })
  if (error || !data) return null
  return data as PerfilAgente
}

/** Lista de agentes con llamadas, para el indice del perfil. */
export async function getAgentes(): Promise<{ nombre: string; slug: string }[]> {
  const ctx = await ctxCalidad()
  if (!ctx) return []

  let q = sinTipar(ctx.supabase)
    .from('calidad_llamadas')
    .select('agente_nombre, agente_staff_id')
    .eq('workspace_id', ctx.workspaceId)
    .limit(4000)

  if (!ctx.perms.canViewCalidadTodos) {
    if (!ctx.staffId) return []
    q = q.eq('agente_staff_id', ctx.staffId)
  }

  const { data } = await q
  const set = new Set<string>()
  for (const f of (data ?? []) as { agente_nombre: string }[]) set.add(f.agente_nombre)
  return [...set].sort().map((nombre) => ({ nombre, slug: slugAgente(nombre) }))
}
