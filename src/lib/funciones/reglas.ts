/**
 * Piezas puras del módulo `funciones` que comparten las pantallas y las acciones. Lo que decide (cupo, candados,
 * quién escribe) vive en la base (migración 20261022170000); esto solo lo muestra igual que la base lo calcula.
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
  reserva_inactiva: 'La reserva ya no está activa (cancelada o vencida).',
  reserva_no_existe: 'La reserva no existe.',
  funcion_no_existe: 'La función no existe.',
  sin_permiso: 'Tu rol no puede hacer este cambio.',
  pago_estado_invalido: 'Ese estado de pago no lo puede marcar el equipo.',
  sin_autorizacion_sensible: 'Sin autorización del cliente para guardar ese dato.',
  cupo_bajo_ocupacion: 'Hay más personas reservadas que ese cupo.',
  experiencia_no_existe: 'La experiencia no existe.',
  fecha_pasada: 'Una de las fechas ya pasó.',
  datos_invalidos: 'Revisa los datos del formulario.',
  sin_precio: 'La función no tiene precio por persona.',
  modalidad_no_permitida: 'Esa forma de pago no está habilitada para esta función.',
  capacidad_bajo_ocupacion: 'Hay más personas reservadas que esa capacidad.',
  cupo_asistente_invalido: 'El cupo del asistente va de 1 a la capacidad.',
  abono_sobre_precio: 'El abono no puede pasar el precio por persona.',
  campana_no_publicada: 'La campaña se activa al publicar la agenda.',
  campana_sin_funciones: 'Agrega al menos una función futura antes de publicar.',
  funcion_sin_precio: 'Hay funciones sin precio por persona.',
  campana_no_existe: 'La campaña no existe.',
  campana_cerrada: 'La campaña está cerrada.',
  codigo_repetido: 'Ese código ya lo usa otra campaña.',
  codigo_invalido: 'El código va de 2 a 20 letras, números o guiones, sin espacios.',
  codigo_publicado: 'El código de una campaña publicada no cambia.',
  horario_repetido: 'Esa fecha y hora ya está en la agenda.',
  horario_invalido: 'Una línea de la agenda no se entiende.',
  precio_invalido: 'Los precios van en pesos, sin decimales.',
  tope_bajo_capacidad: 'El tope de sobreventa no puede ser menor que la capacidad.',
  anuncio_invalido: 'El id del anuncio va sin espacios.',
  anuncio_de_otra_campana: 'Ese anuncio ya está asociado a otra campaña.',
  dato_no_admitido: 'Ese dato no se guarda en una reserva.',
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

/** Los roles que la base deja escribir (`funcion_actor`). La pantalla solo esconde botones; decide la base. Pura. */
export const puedeEditarFunciones = (rol: string | null | undefined) =>
  rol === 'owner' || rol === 'admin' || rol === 'supervisor' || rol === 'operator'

/** La insignia de una función, con las palabras de Sabor (§4.5). Pura. */
export function insigniaFuncion(f: { estado: string; capacidad: number; cupo_asistente: number; ocupadas: number }):
  'Disponible' | 'Llena para el asistente' | 'Llena' | 'Pausada' | 'Cancelada' {
  if (f.estado === 'cancelada') return 'Cancelada'
  if (f.estado === 'pausada') return 'Pausada'
  if (f.ocupadas >= f.capacidad) return 'Llena'
  if (f.ocupadas >= f.cupo_asistente) return 'Llena para el asistente'
  return 'Disponible'
}

export const ETIQUETA_ESTADO_CAMPANA: Record<string, string> = {
  borrador: 'Borrador',
  activa: 'Activa',
  pausada: 'Pausada',
  cerrada: 'Cerrada',
  agotada: 'Agotada',
}

/** «$180.000». Pura. */
export const pesos = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : `$${Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`

/** El instante de referencia de una pantalla (hoy y «ya pasó» de la agenda). Fuera del render, para que sea puro. */
export const instanteActual = () => Date.now()
