/**
 * Por qué se reprocesa un caso: una lista cerrada por tipo de reproceso.
 *
 * Hasta el 2026-10-07 un reproceso solo traía la causa (error propio o criterio del
 * tercero) y un texto libre. Medido ese día en SOENA: 54 de 59 reprocesos son «Devolución
 * DIAN», y en la mitad la DIAN no rechazó nada (el cliente estaba fuera del país, no le
 * llegó el enlace de cargue, no fue a la cita). Con texto libre no hay forma de contar
 * cuántos rechazos hubo por formulario mal diligenciado contra cuántos por el cliente.
 *
 * SOE-001 (decisión de Mauricio): el rechazo de la DIAN lo devuelve el operativo del caso
 * por reproceso «con motivo específico, de una lista de motivos de rechazo DIAN». La lista
 * salió de los 59 textos libres reales, agrupados.
 *
 * Cada motivo trae la CAUSA que le corresponde. Para dirección y supervisión es solo la
 * sugerencia inicial del formulario (la pueden cambiar). Para el operativo es la causa que
 * queda: el bono de calidad le cuelga a la misma área que reporta, y elegir la causa sería
 * elegir si el error le cuenta.
 *
 * Sin `server-only`: lo usan el server action y el formulario del navegador.
 */

import type { CausaReproceso, TipoReproceso } from './atribucion-reproceso'

export type MotivoReproceso = {
  value: string
  label: string
  causa: CausaReproceso
}

/** El motivo de descarte. El detalle sigue siendo obligatorio para todos, como antes. */
export const MOTIVO_OTRO = 'otro'

export const MOTIVOS_REPROCESO: Record<TipoReproceso, readonly MotivoReproceso[]> = {
  devolucion_dian: [
    // ── Nuestro ──
    { value: 'documento_propio_mal_diligenciado', label: 'Documento nuestro mal diligenciado (010, relación de facturas, declaración)', causa: 'error_propio' },
    { value: 'documento_equivocado_enviado', label: 'Le enviamos al cliente un documento equivocado o desactualizado', causa: 'error_propio' },
    { value: 'envio_tardio_al_cliente', label: 'No le enviamos los documentos a tiempo para la cita', causa: 'error_propio' },
    // ── Del cliente ──
    { value: 'cliente_no_firmo', label: 'El cliente no firmó a mano o dejó documentos sin firmar', causa: 'criterio_tercero' },
    { value: 'cliente_no_radico', label: 'El cliente no radicó, no fue a la cita o no cargó los documentos', causa: 'criterio_tercero' },
    { value: 'cliente_radico_incompleto', label: 'El cliente radicó documentos incompletos o ilegibles', causa: 'criterio_tercero' },
    { value: 'rut_desactualizado', label: 'El RUT del cliente estaba desactualizado', causa: 'criterio_tercero' },
    { value: 'certificado_bancario_vencido', label: 'El certificado bancario estaba vencido', causa: 'criterio_tercero' },
    { value: 'factura_vehiculo_rechazada', label: 'La DIAN no aceptó la factura del vehículo (anulada, no válida)', causa: 'criterio_tercero' },
    // ── De la DIAN o de la UPME ──
    { value: 'doble_titularidad', label: 'Doble titularidad: hay que corregir el certificado de la UPME', causa: 'criterio_tercero' },
    { value: 'dian_sin_enlace_o_radicado', label: 'La DIAN no envió el enlace de cargue o el radicado, o canceló la cita', causa: 'criterio_tercero' },
    { value: 'dian_criterio_funcionario', label: 'El funcionario de la DIAN pidió algo distinto a lo usual', causa: 'criterio_tercero' },
    { value: MOTIVO_OTRO, label: 'Otro (descríbelo abajo)', causa: 'criterio_tercero' },
  ],
  certificacion_upme: [
    { value: 'dato_mal_en_certificado', label: 'Quedó mal un dato del certificado (nombre, correo, vehículo)', causa: 'error_propio' },
    { value: 'doble_titularidad', label: 'El certificado salió a una sola persona y es doble titularidad', causa: 'error_propio' },
    { value: 'pago_upme_rechazado', label: 'La UPME no dejó pagar o rechazó el pago (Bizagi)', causa: 'criterio_tercero' },
    { value: MOTIVO_OTRO, label: 'Otro (descríbelo abajo)', causa: 'criterio_tercero' },
  ],
}

export function motivosDelTipo(tipo: TipoReproceso): readonly MotivoReproceso[] {
  return MOTIVOS_REPROCESO[tipo] ?? []
}

export function motivoDelTipo(tipo: TipoReproceso, value: string | null | undefined): MotivoReproceso | null {
  if (!value) return null
  return motivosDelTipo(tipo).find((m) => m.value === value) ?? null
}

/** Etiqueta para pintar un motivo guardado. Un valor que ya no está en la lista se muestra tal cual. */
export function etiquetaMotivo(tipo: string | null | undefined, value: string | null | undefined): string | null {
  if (!value) return null
  const lista = MOTIVOS_REPROCESO[tipo as TipoReproceso] ?? []
  return lista.find((m) => m.value === value)?.label ?? value
}

/**
 * Valida lo que llega del formulario y decide la causa que queda.
 *
 * - El motivo es obligatorio y tiene que ser del tipo elegido.
 * - `causaFija`: el operativo no elige la causa, queda la del motivo.
 *
 * El detalle (texto libre) lo sigue exigiendo el server action para todos: el motivo dice
 * QUÉ clase de rechazo fue, el detalle dice lo que hace falta para rehacerlo («regresa el
 * 20 de noviembre, no pedirle cita antes»).
 */
export function validarMotivoReproceso(input: {
  tipo: TipoReproceso
  motivo: string | null | undefined
  causa: CausaReproceso
  causaFija: boolean
}): { ok: true; motivo: MotivoReproceso; causa: CausaReproceso } | { ok: false; error: string } {
  const motivo = motivoDelTipo(input.tipo, input.motivo)
  if (!motivo) return { ok: false, error: 'Elige el motivo del reproceso' }
  return { ok: true, motivo, causa: input.causaFija ? motivo.causa : input.causa }
}
