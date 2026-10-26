import 'server-only'

/**
 * Lecturas del módulo `funciones` para las pantallas.
 *
 * Puente MÍNIMO con el modelo del 2026-10-22 (campañas, dos cupos, precios): las pantallas de hoy siguen viendo
 * `cupo_total` y los estados `abierta`/`cerrada`/`cancelada`; aquí se traducen desde `capacidad` y
 * `activa`/`pausada`/`cancelada`. Se reemplaza con el panel nuevo (Noor y Sofía), que todavía no está. Todas con el cliente de la SESIÓN (`authenticated`): el RLS
 * acota al workspace y `funcion_ocupacion` verifica que la persona sea de ese workspace. Nada aquí escribe.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { SaldoReserva, TarifaPublica } from '../../../supabase/functions/_shared/funciones/tipos.ts'
import { saldoDeLaBase } from '../../../supabase/functions/_shared/funciones/supabase.ts'
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
  /** La foto: si se paga con abono (por persona) y si se permite el total. Deciden qué ofrece «Pago verificado». */
  abono_unitario: number | null
  permite_pago_total: boolean
  /** El saldo calculado por la base (`funcion_saldos`); solo de las confirmadas. */
  saldo: SaldoReserva | null
}

export interface FuncionDelDia {
  ocupacion: Ocupacion
  reservas: ReservaVista[]
}

const COLUMNAS_RESERVA =
  'id, nombre, personas, estado, pago_estado, vence_at, solicitud_cliente, restricciones, consentimiento_sensible_id, canal, telefono, origen, abono_unitario, permite_pago_total'

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
  abono_unitario: number | null
  permite_pago_total: boolean
}

function vistaReserva(r: FilaReserva, saldo: SaldoReserva | null = null): ReservaVista {
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
    abono_unitario: r.abono_unitario,
    permite_pago_total: r.permite_pago_total,
    saldo,
  }
}

/** `activa`/`pausada`/`cancelada` de la base → los estados que muestran las pantallas de hoy. Pura. */
export const estadoParaPantalla = (e: string): EstadoFuncion => (e === 'activa' ? 'abierta' : e === 'cancelada' ? 'cancelada' : 'cerrada')

export async function leerOcupacion(db: SupabaseClient, funcionId: string): Promise<Ocupacion | null> {
  const { data, error } = await db.rpc('funcion_ocupacion', { p_funcion_id: funcionId })
  if (error || !data) return null
  const o = data as Omit<Ocupacion, 'cupo_total' | 'estado'> & { capacidad: number; estado: string }
  return { ...o, cupo_total: o.capacidad, estado: estadoParaPantalla(o.estado) }
}

/** Las reservas ACTIVAS de una función (las que ocupan cupo), con el saldo de las confirmadas (una llamada). */
export async function leerReservasActivas(db: SupabaseClient, funcionId: string): Promise<ReservaVista[]> {
  const [{ data, error }, saldos] = await Promise.all([
    db
      .from('funcion_reservas')
      .select(COLUMNAS_RESERVA)
      .eq('funcion_id', funcionId)
      .in('estado', ['apartada', 'confirmada'])
      .order('created_at', { ascending: true }),
    db.rpc('funcion_saldos', { p_funcion_id: funcionId }),
  ])
  if (error) throw new Error(`No se pudieron leer las reservas: ${error.message}`)
  // Sin saldos (falla la lectura) la lista sigue: cada fila dice «saldo sin leer» en vez de inventar un cero.
  const porReserva = new Map(((saldos.data ?? []) as unknown[]).map((x) => saldoDeLaBase(x)).map((x) => [x.reserva_id, x]))
  const ahora = Date.now()
  return ((data ?? []) as unknown as FilaReserva[]).filter((r) => reservaActiva(r, ahora)).map((r) => vistaReserva(r, porReserva.get(r.id) ?? null))
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

/** La ficha de la experiencia (P11): los textos de la oferta y del grupo, tal cual los escribe Sabor. */
export interface FichaExperienciaDatos {
  nombre: string
  titulo_oferta: string | null
  frase_gancho: string | null
  intro: string | null
  que_incluye: string[] | null
  emojis_tema: string | null
  saludo_grupo: string | null
  relato_grupo: string | null
  edad_minima: number | null
}

const COLUMNAS_FICHA = 'nombre, titulo_oferta, frase_gancho, intro, que_incluye, emojis_tema, saludo_grupo, relato_grupo, edad_minima'

export interface Experiencia extends FichaExperienciaDatos {
  id: string
  activa: boolean
  created_at: string
}

/** Las experiencias, la más reciente primero (Sabor estrena experiencia cada semana). */
export async function leerExperiencias(db: SupabaseClient, workspaceId: string): Promise<Experiencia[]> {
  const { data, error } = await db
    .from('funcion_experiencias')
    .select(`id, ${COLUMNAS_FICHA}, activa, created_at`)
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
  if (error) throw new Error(`No se pudieron leer las experiencias: ${error.message}`)
  return (data ?? []) as Experiencia[]
}

export type EstadoCampana = 'borrador' | 'activa' | 'pausada' | 'cerrada' | 'agotada'

/** Una fila del inicio del panel (`funcion_panel_campanas`): estado efectivo, conteos y precios. */
export interface CampanaResumen {
  campana_id: string
  nombre: string
  codigo: string
  experiencia_id: string
  experiencia: string
  estado: EstadoCampana
  desde: string | null
  hasta: string | null
  precio_persona: number | null
  precio_preventa_persona: number | null
  abono_persona: number | null
  permite_pago_total: boolean
  minutos_apartado: number | null
  tope_sobreventa: number | null
  /** Plazo del saldo: días antes de la función (0 a 30, 0 = hasta que empieza; la base lo llena con 1). */
  dias_saldo_antes: number
  funciones: number
  llenas: number
  llenas_asistente: number
  llenas_asistente_semana: number
  proxima: string | null
  ultima_capacidad: number | null
  ultima_cupo_asistente: number | null
  created_at: string
}

export async function leerPanelCampanas(db: SupabaseClient, workspaceId: string): Promise<CampanaResumen[]> {
  const { data, error } = await db.rpc('funcion_panel_campanas', { p_workspace_id: workspaceId })
  if (error) throw new Error(`No se pudieron leer las campañas: ${error.message}`)
  return (data ?? []) as CampanaResumen[]
}

export interface FuncionAgenda {
  funcion_id: string
  inicia_at: string
  inicia_texto: string
  estado: 'activa' | 'pausada' | 'cancelada'
  es_preventa: boolean
  /** Fin de la preventa (AAAA-MM-DD, inclusive, día de Bogotá); `null` = sin fecha. */
  preventa_hasta: string | null
  cierra_venta_at: string | null
  capacidad: number
  cupo_asistente: number
  ocupadas: number
  reservas_activas: number
  tarifa: TarifaPublica
}

/** Una campaña con su experiencia, anuncios y agenda (`funcion_panel_campana`). */
export interface CampanaPanel {
  campana_id: string
  nombre: string
  codigo: string
  estado: EstadoCampana
  estado_guardado: 'borrador' | 'activa' | 'pausada' | 'cerrada'
  publicada: boolean
  desde: string | null
  hasta: string | null
  minutos_apartado: number | null
  precio_persona: number | null
  precio_preventa_persona: number | null
  abono_persona: number | null
  permite_pago_total: boolean
  tope_sobreventa: number | null
  /** Plazo del saldo: días antes de la función (0 a 30, 0 = hasta que empieza; la base lo llena con 1). */
  dias_saldo_antes: number
  experiencia: FichaExperienciaDatos & { experiencia_id: string }
  anuncios: string[]
  funciones: FuncionAgenda[]
}

export async function leerPanelCampana(db: SupabaseClient, campanaId: string): Promise<CampanaPanel | null> {
  const { data, error } = await db.rpc('funcion_panel_campana', { p_campana_id: campanaId })
  if (error || !data) return null
  return data as CampanaPanel
}

/** Los datos del lugar (`funcion_negocio`), una fila por workspace. Sin fila = todo vacío (los textos dicen «[FALTA]»). */
export interface Negocio {
  direccion: string | null
  piso: string | null
  recepcion: string | null
  parqueadero: string | null
  firma: string | null
}

export const NEGOCIO_VACIO: Negocio = { direccion: null, piso: null, recepcion: null, parqueadero: null, firma: null }

export async function leerNegocio(db: SupabaseClient, workspaceId: string): Promise<Negocio> {
  const { data, error } = await db
    .from('funcion_negocio')
    .select('direccion, piso, recepcion, parqueadero, firma')
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  if (error) throw new Error(`No se pudieron leer los datos del lugar: ${error.message}`)
  return (data as Negocio | null) ?? NEGOCIO_VACIO
}
