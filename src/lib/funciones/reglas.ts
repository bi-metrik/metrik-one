/**
 * Piezas puras del módulo `funciones` que comparten las pantallas y las acciones. Lo que decide (cupo, candados,
 * quién escribe) vive en la base (migración 20261021120000); esto solo lo muestra igual que la base lo calcula.
 */

export type EstadoReserva = 'apartada' | 'confirmada' | 'cancelada' | 'vencida'
export type PagoEstado = 'pendiente' | 'aprobado' | 'verificado_manual' | 'rechazado'
export type EstadoFuncion = 'abierta' | 'cerrada' | 'cancelada'

/** La misma definición que `funcion_ocupadas`: ocupa la confirmada y la apartada que no ha vencido. Pura. */
export function reservaActiva(r: { estado: string; vence_at: string | null }, ahora: number = Date.now()): boolean {
  return r.estado === 'confirmada' || (r.estado === 'apartada' && !!r.vence_at && Date.parse(r.vence_at) > ahora)
}

/** Colombia no tiene horario de verano: el día de Bogotá es [00:00-05:00, +24 h). Pura. */
export function rangoDiaBogota(fecha: string): { desde: string; hasta: string } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return null
  const desde = new Date(`${fecha}T00:00:00-05:00`)
  if (Number.isNaN(desde.getTime())) return null
  return { desde: desde.toISOString(), hasta: new Date(desde.getTime() + 86_400_000).toISOString() }
}

/** Fecha (YYYY-MM-DD) y hora (HH:MM) de Bogotá → ISO con su zona. `null` si no se entiende. Pura. */
export function inicioBogota(fecha: string, hora: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(hora)) return null
  const d = new Date(`${fecha}T${hora}:00-05:00`)
  return Number.isNaN(d.getTime()) ? null : `${fecha}T${hora}:00-05:00`
}

const HORA = new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', hour: 'numeric', minute: '2-digit', hour12: true })
const FECHA = new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

export const horaBogota = (iso: string) => HORA.format(new Date(iso))
export const fechaBogota = (iso: string) => FECHA.format(new Date(iso))

export const ETIQUETA_ESTADO_RESERVA: Record<EstadoReserva, string> = {
  apartada: 'Apartada',
  confirmada: 'Confirmada',
  cancelada: 'Cancelada',
  vencida: 'Vencida',
}

export const ETIQUETA_PAGO: Record<PagoEstado, string> = {
  pendiente: 'Pago pendiente',
  aprobado: 'Pago aprobado',
  verificado_manual: 'Pago verificado a mano',
  rechazado: 'Pago rechazado',
}

export const ETIQUETA_ESTADO_FUNCION: Record<EstadoFuncion, string> = {
  abierta: 'Abierta',
  cerrada: 'Venta cerrada',
  cancelada: 'Cancelada',
}

/** Lo que dice la pantalla por cada código estable de la base. */
const MENSAJES: Record<string, string> = {
  sin_cupo: 'No hay cupo para esa cantidad de personas.',
  funcion_cerrada: 'La función no está abierta para vender.',
  venta_cerrada: 'La venta de esta función ya cerró.',
  sin_regla_apartado: 'La experiencia no tiene definido cuánto dura un apartado sin pago.',
  mesa_llena: 'Esa mesa no tiene puestos para tantas personas.',
  mesa_de_otro_montaje: 'Esa mesa no es del plano de esta función.',
  personas_no_cuadran: 'Las personas repartidas en las mesas no suman las de la reserva.',
  reserva_inactiva: 'La reserva ya no está activa (cancelada o vencida).',
  reserva_no_existe: 'La reserva no existe.',
  funcion_no_existe: 'La función no existe.',
  funcion_sin_montaje: 'Esta función no tiene plano del salón.',
  sin_permiso: 'Tu rol no puede hacer este cambio.',
  pago_estado_invalido: 'Ese estado de pago no lo puede marcar el equipo.',
  sin_autorizacion_sensible: 'Sin autorización del cliente para guardar ese dato.',
  cupo_sobre_puestos: 'El cupo pasa los puestos del montaje.',
  cupo_bajo_ocupacion: 'Hay más personas reservadas que ese cupo.',
  mesa_con_asignaciones: 'Esa mesa tiene reservas sentadas en una función futura.',
  etiqueta_repetida: 'Dos mesas tienen la misma etiqueta.',
  puestos_invalidos: 'Cada mesa tiene que tener entre 1 y 100 puestos.',
  montaje_en_uso: 'Un montaje que ya usa una función no se cambia de experiencia.',
  montaje_no_existe: 'El montaje no existe.',
  experiencia_no_existe: 'La experiencia no existe.',
  montaje_de_otra_experiencia: 'Ese montaje es de otra experiencia.',
  fecha_pasada: 'Una de las fechas ya pasó.',
  funcion_con_mesas: 'Hay reservas sentadas: primero se liberan las mesas.',
  asignaciones_invalidas: 'La asignación de mesas no se entiende.',
  datos_invalidos: 'Revisa los datos del formulario.',
}

/** El código estable del error de la base (el mensaje ES el código) y su texto, con el detalle si lo hay. Pura. */
export function mensajeDeError(e: { message?: string; details?: string | null } | null | undefined): string {
  const codigo = (e?.message ?? '').trim()
  const base = MENSAJES[codigo]
  if (!base) return 'No se pudo guardar. Intenta de nuevo.'
  const detalle = (e?.details ?? '').trim()
  if (!detalle) return base
  return codigo === 'datos_invalidos' ? `${base} (${detalle})` : `${base} ${detalle}`
}

/** Posición por defecto de la mesa `i` de `n` en la cuadrícula 0-100 (para el formulario sin plano). Pura. */
export function posicionPorDefecto(i: number, n: number): { x: number; y: number } {
  const columnas = Math.max(1, Math.ceil(Math.sqrt(n)))
  const paso = 90 / columnas
  return { x: Math.round((5 + (i % columnas) * paso) * 100) / 100, y: Math.round((5 + Math.floor(i / columnas) * paso) * 100) / 100 }
}

/** Los roles que la base deja escribir (`funcion_actor`). La pantalla solo esconde botones; decide la base. Pura. */
export const puedeEditarFunciones = (rol: string | null | undefined) =>
  rol === 'owner' || rol === 'admin' || rol === 'supervisor' || rol === 'operator'
