/**
 * La fecha del rótulo «Cerrado {fecha}» de la ficha del negocio (QA Trappvel G11, 2026-10-30).
 *
 * La canónica es la del primer cobro (`v_venta_mes_comercial.fecha_venta`): la que fecha la venta en
 * `/numeros`, `/equipo` y la cartera, y no cambia aquí. Pero en una línea que registra la
 * confirmación del cliente (`metadata.confirmacion_cliente.fecha`, viajes) la venta se cierra cuando
 * el cliente dice que sí, no cuando paga: en la QA un anticipo con comprobante del 29 oct dejó la
 * ficha diciendo «Cerrado 29 oct» de un viaje que se confirmó el 30. Con confirmación, manda ella.
 *
 * Puro. `null` cuando no hay ni confirmación ni cobro.
 */
export function fechaDeCierreDeVenta(fechaPrimerCobro: string | null, metadata: unknown): string | null {
  const conf = (metadata as { confirmacion_cliente?: { fecha?: unknown } } | null | undefined)?.confirmacion_cliente
  const fecha = typeof conf?.fecha === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(conf.fecha) ? conf.fecha : null
  return fecha ?? fechaPrimerCobro
}
