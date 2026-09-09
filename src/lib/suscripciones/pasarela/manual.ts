/**
 * Pasarela `manual`: la de hoy. No cobra nada.
 *
 * El ciclo deja el cobro programado de la cuota y alguien confirma el pago desde el
 * bloque de cobros (`confirmarCobroProgramado`) cuando la plata llega por
 * transferencia. En la corrida siguiente el ciclo ve el cobro con `fecha` y registra
 * el `pago_recibido`. Es exactamente lo que pasa hoy con los tres clientes de
 * licencia, con una suscripción que ahora lo observa.
 */

import type { PasarelaAdapter, ResultadoCargo, SolicitudCargo } from './adapter'

export const DETALLE_MANUAL = 'Pago manual: se confirma desde el bloque de cobros cuando entra la transferencia.'

export const pasarelaManual: PasarelaAdapter = {
  nombre: 'manual',
  capacidades: { cobroSinClic: false, tokenizacion: false, linkDePago: false, webhook: false },

  async cobrar(_solicitud: SolicitudCargo): Promise<ResultadoCargo> {
    return { estado: 'pendiente', externalRef: null, detalle: DETALLE_MANUAL }
  },

  async consultar(_externalRef: string): Promise<ResultadoCargo> {
    // No hay a quién preguntarle: el pago manual solo se resuelve cuando alguien
    // pone `fecha` en el cobro, y eso lo lee el ciclo directamente.
    return { estado: 'pendiente', externalRef: null, detalle: DETALLE_MANUAL }
  },
}
