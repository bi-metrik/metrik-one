import 'server-only'

/**
 * Lecturas del módulo `funciones` para las pantallas. Todas con el cliente de la SESIÓN (`authenticated`): el RLS
 * acota al workspace y `funcion_ocupacion` verifica que la persona sea de ese workspace. Nada aquí escribe.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { rangoDiaBogota, reservaActiva, type EstadoFuncion, type EstadoReserva, type PagoEstado } from './reglas'

export interface Ocupacion {
  funcion_id: string
  experiencia_id: string
  experiencia: string
  inicia_at: string
  estado: EstadoFuncion
  cierra_venta_at: string | null
  cupo_total: number
  ocupadas: number
  libres: number
}

export interface ReservaVista {
  id: string
  nombre: string | null
  personas: number
  estado: EstadoReserva
  pago_estado: PagoEstado
  vence_at: string | null
  /** Lo que pidió el cliente («vamos 6, queremos estar juntos»), en sus palabras. Sin lógica de mesa. */
  solicitud_cliente: string | null
  /** Solo si hay autorización sensible: la base no deja guardarlas de otra forma. */
  restricciones: string | null
  autorizada: boolean
  canal: string
  telefono: string | null
  origen: 'asistente' | 'equipo'
}

export interface FuncionDelDia {
  ocupacion: Ocupacion
  reservas: ReservaVista[]
}

const COLUMNAS_RESERVA =
  'id, nombre, personas, estado, pago_estado, vence_at, solicitud_cliente, restricciones, consentimiento_sensible_id, canal, telefono, origen'

type FilaReserva = {
  id: string
  nombre: string | null
  personas: number
  estado: EstadoReserva
  pago_estado: PagoEstado
  vence_at: string | null
  solicitud_cliente: string | null
  restricciones: string | null
  consentimiento_sensible_id: string | null
  canal: string
  telefono: string | null
  origen: 'asistente' | 'equipo'
}

function vistaReserva(r: FilaReserva): ReservaVista {
  return {
    id: r.id,
    nombre: r.nombre,
    personas: r.personas,
    estado: r.estado,
    pago_estado: r.pago_estado,
    vence_at: r.vence_at,
    solicitud_cliente: r.solicitud_cliente,
    restricciones: r.consentimiento_sensible_id ? r.restricciones : null,
    autorizada: !!r.consentimiento_sensible_id,
    canal: r.canal,
    telefono: r.telefono,
    origen: r.origen,
  }
}

export async function leerOcupacion(db: SupabaseClient, funcionId: string): Promise<Ocupacion | null> {
  const { data, error } = await db.rpc('funcion_ocupacion', { p_funcion_id: funcionId })
  if (error || !data) return null
  return data as Ocupacion
}

/** Las reservas ACTIVAS de una función (las que ocupan cupo). */
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
}

export async function leerProximas(db: SupabaseClient, workspaceId: string, dias = 45): Promise<FuncionProxima[]> {
  const { data, error } = await db
    .from('funcion_funciones')
    .select('id, inicia_at, estado, cupo_total, funcion_experiencias(nombre)')
    .eq('workspace_id', workspaceId)
    .gte('inicia_at', new Date(Date.now() - 6 * 3_600_000).toISOString())
    .lt('inicia_at', new Date(Date.now() + dias * 86_400_000).toISOString())
    .order('inicia_at', { ascending: true })
    .limit(200)
  if (error) throw new Error(`No se pudieron leer las funciones: ${error.message}`)
  type Fila = { id: string; inicia_at: string; estado: EstadoFuncion; cupo_total: number; funcion_experiencias: { nombre: string } | null }
  return ((data ?? []) as unknown as Fila[]).map((f) => ({
    id: f.id,
    inicia_at: f.inicia_at,
    estado: f.estado,
    cupo_total: f.cupo_total,
    experiencia: f.funcion_experiencias?.nombre ?? '',
  }))
}

export interface ExperienciaCatalogo {
  id: string
  nombre: string
  minutos_apartado: number | null
  activa: boolean
}

export async function leerExperiencias(db: SupabaseClient, workspaceId: string): Promise<ExperienciaCatalogo[]> {
  const { data, error } = await db.from('funcion_experiencias').select('id, nombre, minutos_apartado, activa').eq('workspace_id', workspaceId).order('nombre')
  if (error) throw new Error(`No se pudieron leer las experiencias: ${error.message}`)
  return (data ?? []) as ExperienciaCatalogo[]
}
