/**
 * El aviso de factura cargada: reglas puras (pedido de Mauricio, 2026-10-22: «debemos enviar una
 * notificación al usuario pagador cuando quede cargada la factura. Ahí a la campanita de ONE»).
 *
 * Cuando el cobrador (metrik) carga la factura electrónica de una cuota (`cargarFacturaCuota`), el
 * espacio que PAGA el contrato recibe un aviso en la campana con el enlace a la pestaña Pagos de
 * `/suscripcion`, que es donde la descarga.
 *
 * ## A quién
 *
 * A quien puede ver esa pestaña: SOLO la persona designada del contrato (`aceptante_designado_id`,
 * regla única `puedeVerSuscripcion` / `puedeVerPagosCda`). El dueño o un administrador que no sea la
 * persona designada no ven Pagos (la ruta les da 404): un aviso que lleva a una página que no existe
 * para ellos es ruido. Sin persona designada no hay a quién avisar.
 *
 * ## Qué contrato
 *
 * El del ancla del plan de la cuota, cobrado por el espacio que carga. Un negocio puede tener un
 * contrato cancelado y otro activo (El Carmen, 2026-09-23, con designados distintos): manda el activo
 * y, entre iguales, el de vigencia más reciente, el MISMO orden que `designacionDelEspacio`.
 *
 * ## Sin duplicar
 *
 * Una identidad por cuota (`grupo_clave = factura_cuota:<cuota>`). Recargar la factura (el XML después
 * del PDF, un número corregido) con un aviso todavía pendiente lo ACTUALIZA, no crea otro. Si la
 * persona ya lo leyó, la recarga sí avisa de nuevo: la factura cambió.
 */

export const TIPO_AVISO_FACTURA = 'factura_cargada'

export const PREFIJO_AVISO_FACTURA = 'factura_cuota:'

/** Donde el pagador descarga la factura. */
export const ENLACE_PAGOS = '/suscripcion?tab=pagos'

export function grupoClaveFactura(cuotaId: string): string {
  return `${PREFIJO_AVISO_FACTURA}${cuotaId}`
}

export function contenidoAvisoFactura(p: {
  numeroFactura: string
  numeroCuota: number | string | null | undefined
  reemplazo: boolean
}): string {
  const cuota = p.numeroCuota === null || p.numeroCuota === undefined || p.numeroCuota === '' ? '' : ` de la cuota ${p.numeroCuota}`
  const hecho = p.reemplazo ? `Se actualizó tu factura ${p.numeroFactura}${cuota}` : `Ya está tu factura ${p.numeroFactura}${cuota}`
  return `${hecho}. Descárgala en Pagos.`
}

export interface ContratoAviso {
  id: string
  estado: string
  vigente_desde: string | null
  workspace_pagador_id: string | null
  aceptante_designado_id: string | null
}

/** El contrato que decide a quién se avisa: el activo primero, luego el de vigencia más reciente. */
export function elegirContrato<C extends ContratoAviso>(contratos: readonly C[]): C | null {
  const orden = [...contratos].sort(
    (a, b) =>
      Number(b.estado === 'activo') - Number(a.estado === 'activo') ||
      (b.vigente_desde ?? '').localeCompare(a.vigente_desde ?? ''),
  )
  return orden[0] ?? null
}

/** Quién recibe el aviso: la persona designada, si la hay. Lista por si mañana la pestaña la ven más. */
export function destinatariosAvisoFactura(contrato: ContratoAviso | null): string[] {
  return contrato?.aceptante_designado_id ? [contrato.aceptante_designado_id] : []
}

export interface PendientePrevio {
  id: string
  destinatario_id: string | null
}

/**
 * Qué hacer con cada destinatario: actualizar su aviso pendiente de esta cuota (si lo tiene) o crear
 * uno. Un pendiente de alguien que ya no es destinatario se deja como está: no es de este aviso decidir.
 */
export function planAvisoFactura(
  destinatarios: readonly string[],
  pendientes: readonly PendientePrevio[],
): { actualizar: string[]; crear: string[] } {
  const actualizar: string[] = []
  const crear: string[] = []
  for (const d of new Set(destinatarios)) {
    const previas = pendientes.filter((p) => p.destinatario_id === d)
    if (previas.length > 0) actualizar.push(...previas.map((p) => p.id))
    else crear.push(d)
  }
  return { actualizar, crear }
}
