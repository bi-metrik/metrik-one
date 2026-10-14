/**
 * El estado de una fila de servicio y quién puede tocarla. Módulo puro (servidor y navegador).
 *
 * Resolución C6 de Vera: solo «por reservar», «reservado» y «cancelado» se ESCRIBEN. «Pagado»,
 * «Confirmado» y «Esperando a Edgar» se DERIVAN de la plata y de las aprobaciones, porque un
 * estado escrito a mano que no coincide con la plata es el defecto que este plan vino a quitar:
 *  · Pagado: Σ gastos del servicio ≥ valor a pagar, cada gasto con soporte, medio y titular, y
 *    sin aprobación pedida abierta.
 *  · Confirmado: Pagado y con la confirmación del proveedor final.
 *  · Esperando a Edgar: hay una aprobación `solicitada` sobre el servicio.
 *
 * Una aprobación RECHAZADA sobre un pago que ya salió también deja la fila sin contar (C5 b):
 * el gasto sigue (salió plata) y solo la dirección levanta el bloqueo.
 */

export type EstadoEscrito = 'por_reservar' | 'reservado' | 'cancelado'
export type EstadoServicio = EstadoEscrito | 'esperando' | 'no_aprobado' | 'pagado' | 'confirmado'

export const ETIQUETA_ESTADO: Record<EstadoServicio, string> = {
  por_reservar: 'Por reservar',
  reservado: 'Reservado',
  esperando: 'Esperando a Edgar',
  no_aprobado: 'No aprobado',
  pagado: 'Pagado',
  confirmado: 'Confirmado',
  cancelado: 'No va',
}

export interface ServicioParaEstado {
  estado: EstadoEscrito
  costo_cotizado: number
  valor_por_pagar: number | null
  confirmacion_ref: string | null
}

export interface GastoDelServicio {
  monto: number
  soporte_url: string | null
  medio_pago: string | null
  titular_medio: string | null
}

export interface AprobacionDelServicio {
  estado: 'solicitada' | 'aprobada' | 'rechazada' | 'caducada'
}

/** Lo que hay que pagarle al proveedor: lo que cobra si es distinto, si no lo cotizado. */
export function valorAPagar(s: Pick<ServicioParaEstado, 'costo_cotizado' | 'valor_por_pagar'>): number {
  const v = s.valor_por_pagar ?? s.costo_cotizado
  return Number.isFinite(Number(v)) ? Number(v) : 0
}

/** Lo pagado al proveedor por este servicio (cada gasto una vez, aunque el pago vaya partido). */
export function pagadoDelServicio(gastos: readonly GastoDelServicio[]): number {
  return gastos.reduce((s, g) => s + (Number.isFinite(Number(g.monto)) ? Number(g.monto) : 0), 0)
}

function gastoCompleto(g: GastoDelServicio): boolean {
  return !!g.soporte_url && !!g.medio_pago && (g.titular_medio === 'empresa' || g.titular_medio === 'personal')
}

export function estadoDelServicio(
  servicio: ServicioParaEstado,
  gastos: readonly GastoDelServicio[] = [],
  aprobaciones: readonly AprobacionDelServicio[] = [],
): EstadoServicio {
  if (servicio.estado === 'cancelado') return 'cancelado'
  if (aprobaciones.some(a => a.estado === 'solicitada')) return 'esperando'
  if (aprobaciones.some(a => a.estado === 'rechazada') && gastos.length > 0) return 'no_aprobado'
  const aPagar = valorAPagar(servicio)
  const pagado = gastos.length > 0 && pagadoDelServicio(gastos) >= aPagar && gastos.every(gastoCompleto)
  if (pagado) return servicio.confirmacion_ref ? 'confirmado' : 'pagado'
  return servicio.estado
}

// ── Permisos (Vera §7.4) ─────────────────────────────────────────────────────

export interface QuienEdita {
  role: string | null | undefined
  areas: readonly string[] | null | undefined
  staffId: string | null | undefined
  /** `lineas_negocio.config_extra.aprobaciones.staff_ids`: la dirección (Edgar por defecto). */
  aprobadores?: readonly string[] | null
  /** ¿Es responsable del negocio? Solo cuenta para la comercial que adjunta vouchers. */
  esResponsable?: boolean
}

/** Dirección: owner/admin o aprobadores de la línea. Aprueba, rechaza y edita todo. */
export function esDireccion(q: Pick<QuienEdita, 'role' | 'staffId' | 'aprobadores'>): boolean {
  if (q.role === 'owner' || q.role === 'admin') return true
  return !!q.staffId && (q.aprobadores ?? []).includes(q.staffId)
}

/** Editar filas (reserva, fecha límite, estado, confirmación): operaciones y dirección. */
export function puedeEditarServicios(q: QuienEdita): boolean {
  if (esDireccion(q)) return true
  const rolOperativo = q.role === 'supervisor' || q.role === 'operator'
  return rolOperativo && (q.areas ?? []).includes('operaciones')
}

/** Adjuntar el voucher: lo anterior y, además, la comercial responsable (le llegan a ella). */
export function puedeAdjuntarVoucher(q: QuienEdita): boolean {
  if (puedeEditarServicios(q)) return true
  const rolOperativo = q.role === 'supervisor' || q.role === 'operator'
  return rolOperativo && (q.areas ?? []).includes('comercial') && q.esResponsable === true
}

/** Traer las filas de la cotización aceptada (botón idempotente): quien edita o la comercial responsable. */
export function puedeTraerServicios(q: QuienEdita): boolean {
  return puedeAdjuntarVoucher(q)
}

/** ¿El interruptor de la línea está encendido? Ausente o distinto de `true` = apagado. */
export function serviciosViajeActivo(configLinea: unknown): boolean {
  const c = configLinea as { servicios_viaje?: { activo?: unknown } } | null | undefined
  return c?.servicios_viaje?.activo === true
}

/** Los aprobadores de la línea (`config_extra.aprobaciones.staff_ids`). */
export function aprobadoresDeLinea(configLinea: unknown): string[] {
  const ids = (configLinea as { aprobaciones?: { staff_ids?: unknown } } | null | undefined)?.aprobaciones?.staff_ids
  return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : []
}
