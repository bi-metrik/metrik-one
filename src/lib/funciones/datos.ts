import 'server-only'

/**
 * Lecturas del módulo `funciones` para las pantallas. Todas con el cliente de la SESIÓN (`authenticated`): el RLS
 * acota al workspace y `funcion_ocupacion` verifica que la persona sea de ese workspace. Nada aquí escribe.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { rangoDiaBogota, reservaActiva, type EstadoFuncion, type EstadoReserva, type PagoEstado } from './reglas'

export interface MesaOcupacion {
  mesa_id: string
  etiqueta: string
  zona: string | null
  condicion: string | null
  puestos: number
  ocupados: number
  libres: number
  x: number
  y: number
  ancho: number
  alto: number
  forma: 'redonda' | 'rectangular'
  orden: number
  reservas: Array<{ reserva_id: string; nombre: string | null; personas: number; estado: EstadoReserva; pago_estado: PagoEstado }>
}

export interface Ocupacion {
  funcion_id: string
  experiencia_id: string
  experiencia: string
  inicia_at: string
  estado: EstadoFuncion
  cierra_venta_at: string | null
  montaje_id: string | null
  cupo_total: number
  ocupadas: number
  libres: number
  mesas: MesaOcupacion[] | null
}

export interface ReservaVista {
  id: string
  nombre: string | null
  personas: number
  estado: EstadoReserva
  pago_estado: PagoEstado
  vence_at: string | null
  preferencia_mesa: string | null
  /** Solo si hay autorización sensible: la base no deja guardarlas de otra forma. */
  restricciones: string | null
  autorizada: boolean
  canal: string
  telefono: string | null
  origen: 'asistente' | 'equipo'
  mesas: Array<{ mesa_id: string; etiqueta: string; personas: number }>
}

export interface FuncionDelDia {
  ocupacion: Ocupacion
  reservas: ReservaVista[]
}

const COLUMNAS_RESERVA =
  'id, nombre, personas, estado, pago_estado, vence_at, preferencia_mesa, restricciones, consentimiento_sensible_id, canal, telefono, origen, ' +
  'funcion_reserva_mesas(mesa_id, personas, funcion_mesas(etiqueta))'

type FilaReserva = {
  id: string
  nombre: string | null
  personas: number
  estado: EstadoReserva
  pago_estado: PagoEstado
  vence_at: string | null
  preferencia_mesa: string | null
  restricciones: string | null
  consentimiento_sensible_id: string | null
  canal: string
  telefono: string | null
  origen: 'asistente' | 'equipo'
  funcion_reserva_mesas: Array<{ mesa_id: string; personas: number; funcion_mesas: { etiqueta: string } | null }> | null
}

function vistaReserva(r: FilaReserva): ReservaVista {
  return {
    id: r.id,
    nombre: r.nombre,
    personas: r.personas,
    estado: r.estado,
    pago_estado: r.pago_estado,
    vence_at: r.vence_at,
    preferencia_mesa: r.preferencia_mesa,
    restricciones: r.consentimiento_sensible_id ? r.restricciones : null,
    autorizada: !!r.consentimiento_sensible_id,
    canal: r.canal,
    telefono: r.telefono,
    origen: r.origen,
    mesas: (r.funcion_reserva_mesas ?? [])
      .map((m) => ({ mesa_id: m.mesa_id, etiqueta: m.funcion_mesas?.etiqueta ?? '?', personas: m.personas }))
      .sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, 'es', { numeric: true })),
  }
}

export async function leerOcupacion(db: SupabaseClient, funcionId: string): Promise<Ocupacion | null> {
  const { data, error } = await db.rpc('funcion_ocupacion', { p_funcion_id: funcionId })
  if (error || !data) return null
  return data as Ocupacion
}

/** Las reservas ACTIVAS de una función (las que ocupan cupo), con sus mesas. */
export async function leerReservasActivas(db: SupabaseClient, funcionId: string): Promise<ReservaVista[]> {
  const { data, error } = await db
    .from('funcion_reservas')
    .select(COLUMNAS_RESERVA)
    .eq('funcion_id', funcionId)
    .in('estado', ['apartada', 'confirmada'])
    .order('created_at', { ascending: true })
  if (error) throw new Error(`No se pudieron leer las reservas: ${error.message}`)
  const ahora = Date.now()
  return ((data ?? []) as unknown as FilaReserva[]).filter((r) => reservaActiva(r, ahora)).map(vistaReserva)
}

export async function leerFuncion(db: SupabaseClient, funcionId: string): Promise<FuncionDelDia | null> {
  const ocupacion = await leerOcupacion(db, funcionId)
  if (!ocupacion) return null
  return { ocupacion, reservas: await leerReservasActivas(db, funcionId) }
}

/** Las funciones de un día de Bogotá, en orden de hora, con su cupo y sus reservas activas. */
export async function leerDia(db: SupabaseClient, workspaceId: string, fecha: string): Promise<FuncionDelDia[]> {
  const rango = rangoDiaBogota(fecha)
  if (!rango) return []
  const { data, error } = await db
    .from('funcion_funciones')
    .select('id')
    .eq('workspace_id', workspaceId)
    .gte('inicia_at', rango.desde)
    .lt('inicia_at', rango.hasta)
    .order('inicia_at', { ascending: true })
  if (error) throw new Error(`No se pudieron leer las funciones: ${error.message}`)
  const ids = ((data ?? []) as Array<{ id: string }>).map((f) => f.id)
  const filas = await Promise.all(ids.map((id) => leerFuncion(db, id)))
  return filas.filter((f): f is FuncionDelDia => !!f)
}

export interface FuncionProxima {
  id: string
  inicia_at: string
  estado: EstadoFuncion
  cupo_total: number
  experiencia: string
  montaje: string | null
}

export async function leerProximas(db: SupabaseClient, workspaceId: string, dias = 45): Promise<FuncionProxima[]> {
  const { data, error } = await db
    .from('funcion_funciones')
    .select('id, inicia_at, estado, cupo_total, funcion_experiencias(nombre), funcion_montajes(nombre)')
    .eq('workspace_id', workspaceId)
    .gte('inicia_at', new Date(Date.now() - 6 * 3_600_000).toISOString())
    .lt('inicia_at', new Date(Date.now() + dias * 86_400_000).toISOString())
    .order('inicia_at', { ascending: true })
    .limit(200)
  if (error) throw new Error(`No se pudieron leer las funciones: ${error.message}`)
  type Fila = { id: string; inicia_at: string; estado: EstadoFuncion; cupo_total: number; funcion_experiencias: { nombre: string } | null; funcion_montajes: { nombre: string } | null }
  return ((data ?? []) as unknown as Fila[]).map((f) => ({
    id: f.id,
    inicia_at: f.inicia_at,
    estado: f.estado,
    cupo_total: f.cupo_total,
    experiencia: f.funcion_experiencias?.nombre ?? '',
    montaje: f.funcion_montajes?.nombre ?? null,
  }))
}

export interface ExperienciaCatalogo {
  id: string
  nombre: string
  minutos_apartado: number | null
  activa: boolean
}

export interface MontajeCatalogo {
  id: string
  experiencia_id: string
  nombre: string
  notas: string | null
  mesas: Array<{ id: string; etiqueta: string; puestos: number; zona: string | null; condicion: string | null; x: number; y: number; ancho: number; alto: number; forma: 'redonda' | 'rectangular'; orden: number }>
}

export async function leerCatalogo(db: SupabaseClient, workspaceId: string): Promise<{ experiencias: ExperienciaCatalogo[]; montajes: MontajeCatalogo[] }> {
  const [e, m] = await Promise.all([
    db.from('funcion_experiencias').select('id, nombre, minutos_apartado, activa').eq('workspace_id', workspaceId).order('nombre'),
    db
      .from('funcion_montajes')
      .select('id, experiencia_id, nombre, notas, funcion_mesas(id, etiqueta, puestos, zona, condicion, x, y, ancho, alto, forma, orden)')
      .eq('workspace_id', workspaceId)
      .order('nombre'),
  ])
  if (e.error || m.error) throw new Error(`No se pudo leer el catálogo: ${(e.error ?? m.error)!.message}`)
  type FilaMontaje = Omit<MontajeCatalogo, 'mesas'> & { funcion_mesas: MontajeCatalogo['mesas'] | null }
  return {
    experiencias: (e.data ?? []) as ExperienciaCatalogo[],
    montajes: ((m.data ?? []) as unknown as FilaMontaje[]).map(({ funcion_mesas, ...resto }) => ({
      ...resto,
      mesas: (funcion_mesas ?? []).map((x) => ({ ...x, x: Number(x.x), y: Number(x.y), ancho: Number(x.ancho), alto: Number(x.alto) })).sort((a, b) => a.orden - b.orden),
    })),
  }
}
