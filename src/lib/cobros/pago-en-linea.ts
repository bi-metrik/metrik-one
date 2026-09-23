/**
 * Qué hace ONE con un evento de una pasarela de pago en línea YA VERIFICADO por su adaptador. Es
 * el MISMO código para todas las pasarelas (hoy Bold; ePayco cuando exista la cuenta en Davivienda):
 * cada ruta de webhook verifica con su adaptador y entrega aquí un `EventoPasarela` normalizado.
 * Sin red ni base: todo pasa por `RepoPagoEnLinea`, para poder probar la lógica sin un doble de
 * Supabase.
 *
 * Idempotencia, en dos capas (las pasarelas mandan varias notificaciones de la misma transacción y
 * reintentan si no reciben 200 a tiempo):
 *   1. Por id de NOTIFICACIÓN: cada evento deja su fila en `pasarela_eventos`, única por pasarela +
 *      evento. Una notificación que ya terminó se contesta «duplicado» sin tocar nada. Una que quedó
 *      a medias (el proceso se cayó después de registrarla) se vuelve a procesar.
 *   2. Por id de TRANSACCIÓN: el pago queda en `cobros.external_ref = evento.referenciaPago` (la
 *      forma la decide cada adaptador) y `cobros.fuente = <pasarela>`. Otra notificación de la misma
 *      transacción encuentra el cobro con fecha y esa referencia, y responde «ya pagado».
 *
 * El pago se registra por la MISMA escritura que el botón «Confirmar pago manual» del bloque de
 * cobros (`confirmarPagoCobroProgramado`): fecha, referencia, fuente y el monto que entró. No hay un
 * segundo camino de escritura a `cobros`.
 *
 * Lo que ONE no decide solo, y deja marcado para una persona (`requiere_revision`):
 *   · un pago sobre una cuota que ya estaba pagada por otra vía (posible doble pago);
 *   · un pago por MENOS de lo esperado (el enlace es de monto cerrado: no debería pasar);
 *   · una anulación aprobada en la pasarela (deshacer un pago confirmado no lo hace un webhook);
 *   · una moneda distinta de COP o un monto ilegible.
 * Un pago por MÁS de lo esperado sí se registra, con el monto real: el excedente lo descuenta de la
 * siguiente cuota el reparto FIFO al generar su enlace (regla del excedente).
 *
 * Retención de IVA (`retencion-iva.ts`): si el enlace salió por el neto, el cobro ya trae la
 * retención en «certificado pendiente» y aquí se conserva: el pago del neto deja la cuota en cero.
 * Si el cliente pagó el total (no retuvo), la retención se quita: contarla además del total le
 * descontaría de más la cuota siguiente.
 *
 * La marca de conciliación (`cobros.split_json.confirmado_at`, #738) NO aplica aquí: solo cuenta en
 * porciones que el comercial propuso repartir (`origen = 'comercial'`), y un cobro programado pagado
 * por su enlace no es una porción de un reparto.
 */

import type { EventoPasarela } from '@/lib/suscripciones/pasarela/adapter'
import type { ConfirmacionPago, ResultadoConfirmacion } from './confirmar-cobro-programado'
import { cobroDeReferencia } from './referencia-enlace'

export type ResultadoPagoEnLinea =
  | 'registrado'
  | 'duplicado'
  | 'ya_pagado'
  | 'ignorado'
  | 'sin_cobro'
  | 'requiere_revision'

/** Resultados con los que una notificación se da por terminada: repetirla no hace nada. */
export const RESULTADOS_FINALES: readonly string[] = ['registrado', 'ya_pagado', 'ignorado', 'sin_cobro', 'requiere_revision']

export interface CobroParaPago {
  id: string
  workspaceId: string
  negocioId: string | null
  monto: number
  fecha: string | null
  anuladoAt: string | null
  tipoCobro: string | null
  externalRef: string | null
  notas: string | null
  /**
   * La retención de IVA que el cliente practica sobre la cuota (`cobros.retencion_iva`), escrita al
   * generar el enlace por el neto. `monto` es el neto que se espera en efectivo.
   */
  retencionIva?: number
}

export interface RepoPagoEnLinea {
  /** La pasarela que atiende este webhook: va en `pasarela_eventos` y en `cobros.fuente`. */
  readonly pasarela: string
  /** Deja la fila del evento. `nuevo: false` si ya existía, con el resultado que tenía. */
  registrarEvento(e: EventoPasarela): Promise<{ nuevo: boolean; resultadoPrevio: string | null }>
  cerrarEvento(eventoId: string, r: { resultado: ResultadoPagoEnLinea; detalle: string; cobro: CobroParaPago | null }): Promise<void>
  cobroPorId(id: string): Promise<CobroParaPago | null>
  /** Cobros cuyo enlace es ese id de la pasarela. Más de uno es ambiguo y no se toca. */
  cobrosPorIdEnlace(idEnlace: string): Promise<CobroParaPago[]>
  confirmarPago(c: ConfirmacionPago): Promise<ResultadoConfirmacion>
  /** Deja la línea en el timeline del negocio. No lanza: el pago ya quedó registrado o marcado. */
  anotarEnNegocio(cobro: CobroParaPago, texto: string): Promise<void>
}

export interface SalidaPagoEnLinea {
  resultado: ResultadoPagoEnLinea
  detalle: string
  cobroId: string | null
}

type Salida = SalidaPagoEnLinea & { cobro: CobroParaPago | null }

/** 'YYYY-MM-DD' del pago, de la marca de la pasarela en hora de Bogotá (ISO con -05:00). */
function fechaDelPago(e: EventoPasarela, hoy: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})T/.exec(e.ocurridoAt ?? '')
  return m ? m[1] : hoy
}

async function resolverCobro(
  e: EventoPasarela,
  repo: RepoPagoEnLinea,
): Promise<{ cobro: CobroParaPago } | { cobro: null; detalle: string; resultado: ResultadoPagoEnLinea }> {
  // 1. La referencia de ONE (ONE-<cobro>-<ms>) dice el cobro sin buscar.
  const idCobro = cobroDeReferencia(e.referencia)
  if (idCobro) {
    const cobro = await repo.cobroPorId(idCobro)
    if (cobro) return { cobro }
    return { cobro: null, resultado: 'sin_cobro', detalle: `La referencia ${e.referencia} apunta a un cobro que no existe.` }
  }
  // 2. El id del enlace de la pasarela, contra la URL del enlace cargado en el cobro (sirve también
  //    para los enlaces que se crearon a mano en el panel de la pasarela).
  if (e.idEnlace) {
    const cobros = await repo.cobrosPorIdEnlace(e.idEnlace)
    if (cobros.length === 1) return { cobro: cobros[0] }
    if (cobros.length > 1) {
      return { cobro: null, resultado: 'requiere_revision', detalle: `El enlace ${e.idEnlace} está en ${cobros.length} cobros: no se sabe cuál se pagó.` }
    }
    return { cobro: null, resultado: 'sin_cobro', detalle: `Ningún cobro de ONE tiene el enlace ${e.idEnlace}.` }
  }
  return {
    cobro: null,
    resultado: 'sin_cobro',
    detalle: e.referencia
      ? `La referencia ${e.referencia} no es de un enlace de ONE (venta por otro canal).`
      : 'La venta llegó sin referencia: no es de un enlace de ONE.',
  }
}

/**
 * Registra un pago APROBADO en el cobro de su cuota. Es la función común a todas las pasarelas: lo
 * que cambia entre ellas ya viene resuelto en el evento (`referenciaPago`, `idEnlace`, monto).
 */
export async function registrarPagoAprobado(
  e: EventoPasarela,
  cobro: CobroParaPago,
  repo: RepoPagoEnLinea,
  hoy: string,
): Promise<Salida> {
  const refPago = e.referenciaPago

  if (cobro.anuladoAt) {
    return { resultado: 'requiere_revision', detalle: `Entró un pago en línea (${refPago}) sobre un cobro anulado.`, cobroId: cobro.id, cobro }
  }
  if (cobro.tipoCobro !== 'programado') {
    return { resultado: 'requiere_revision', detalle: `El cobro ${cobro.id} no es un cobro programado de cuota.`, cobroId: cobro.id, cobro }
  }
  if (cobro.fecha) {
    if (cobro.externalRef === refPago) {
      return { resultado: 'ya_pagado', detalle: `El pago ${refPago} ya estaba registrado.`, cobroId: cobro.id, cobro }
    }
    return {
      resultado: 'requiere_revision',
      detalle: `Entró un pago en línea (${refPago}) sobre una cuota que ya estaba pagada (${cobro.fecha}${cobro.externalRef ? `, ${cobro.externalRef}` : ''}): posible doble pago.`,
      cobroId: cobro.id,
      cobro,
    }
  }
  if (e.moneda && e.moneda.toUpperCase() !== 'COP') {
    return { resultado: 'requiere_revision', detalle: `El pago ${refPago} llegó en ${e.moneda}, no en pesos.`, cobroId: cobro.id, cobro }
  }
  if (e.monto === null || !(e.monto > 0)) {
    return { resultado: 'requiere_revision', detalle: `El pago ${refPago} llegó sin monto legible.`, cobroId: cobro.id, cobro }
  }
  const esperado = Math.round(cobro.monto)
  const pagado = Math.round(e.monto)
  if (pagado < esperado) {
    return {
      resultado: 'requiere_revision',
      detalle: `El pago ${refPago} fue de $${pagado} y la cuota esperaba $${esperado}. No se registró: revisar.`,
      cobroId: cobro.id,
      cobro,
    }
  }

  const retencion = Math.max(0, Math.round(cobro.retencionIva ?? 0))
  // Pagó el total en vez del neto: no retuvo. La cuota se cubre con la plata, no con la retención.
  const noRetuvo = retencion > 0 && pagado >= esperado + retencion
  const excedente = pagado - (noRetuvo ? esperado + retencion : esperado)
  const notasNuevas = [
    noRetuvo ? `Pagado en línea por el total, sin retención de IVA: se quitó la retención de $${retencion}.` : null,
    excedente > 0 ? `Pagado en línea con $${excedente} de más: se descuenta de la siguiente cuota.` : null,
  ].filter((x): x is string => x !== null)
  const r = await repo.confirmarPago({
    cobroId: cobro.id,
    workspaceId: cobro.workspaceId,
    fecha: fechaDelPago(e, hoy),
    externalRef: refPago,
    fuente: repo.pasarela,
    monto: pagado,
    notas: notasNuevas.length > 0 ? [cobro.notas, ...notasNuevas].filter(Boolean).join(' · ') : null,
    ...(noRetuvo ? { quitarRetencionIva: true } : {}),
  })
  if (r.ok) {
    const conRetencion = retencion > 0 && !noRetuvo ? `, con $${retencion} de retención de IVA por certificar` : ''
    return {
      resultado: 'registrado',
      detalle: `Pago en línea de $${pagado} registrado (${refPago})${conRetencion}${excedente > 0 ? `, con $${excedente} de excedente` : ''}.`,
      cobroId: cobro.id,
      cobro,
    }
  }
  if (r.motivo === 'ya_confirmado') {
    // Otra notificación (o una persona) lo confirmó entre la lectura y la escritura.
    return { resultado: 'requiere_revision', detalle: `El cobro se confirmó por otra vía mientras llegaba el pago ${refPago}.`, cobroId: cobro.id, cobro }
  }
  // Error de base: se lanza para que el webhook responda 500 y la pasarela reintente. La fila del
  // evento queda sin cerrar, así que el reintento la vuelve a procesar.
  throw new Error(`No se pudo registrar el pago del cobro ${cobro.id}: ${r.error}`)
}

async function procesar(e: EventoPasarela, repo: RepoPagoEnLinea, hoy: string): Promise<Salida> {
  if (e.tipo === 'rechazado') {
    return { resultado: 'ignorado', detalle: 'Pago rechazado por la pasarela: el enlace sigue sirviendo para volver a intentar.', cobroId: null, cobro: null }
  }
  if (e.tipo === 'otro') {
    return { resultado: 'ignorado', detalle: `Evento ${e.tipoOriginal}: ONE no hace nada con él.`, cobroId: null, cobro: null }
  }

  const encontrado = await resolverCobro(e, repo)
  if (!encontrado.cobro) return { resultado: encontrado.resultado, detalle: encontrado.detalle, cobroId: null, cobro: null }
  const cobro = encontrado.cobro

  if (e.tipo === 'anulado') {
    return {
      resultado: 'requiere_revision',
      detalle: `La pasarela aprobó la anulación del pago ${e.referenciaPago}. El cobro no se deshace solo: revisarlo y anularlo a mano si corresponde.`,
      cobroId: cobro.id,
      cobro,
    }
  }
  return registrarPagoAprobado(e, cobro, repo, hoy)
}

export async function procesarEventoPasarela(e: EventoPasarela, repo: RepoPagoEnLinea, hoy: string): Promise<SalidaPagoEnLinea> {
  const reg = await repo.registrarEvento(e)
  if (!reg.nuevo && reg.resultadoPrevio && RESULTADOS_FINALES.includes(reg.resultadoPrevio)) {
    return { resultado: 'duplicado', detalle: `Notificación ${e.eventoId} ya procesada (${reg.resultadoPrevio}).`, cobroId: null }
  }
  const salida = await procesar(e, repo, hoy)
  await repo.cerrarEvento(e.eventoId, { resultado: salida.resultado, detalle: salida.detalle, cobro: salida.cobro })
  // Lo que pasó con la plata de un negocio se ve en su timeline; lo que pide revisión, sobre todo.
  if (salida.cobro && (salida.resultado === 'registrado' || salida.resultado === 'requiere_revision')) {
    const prefijo = salida.resultado === 'registrado' ? 'Pago en línea' : 'Pago en línea · revisar'
    await repo.anotarEnNegocio(salida.cobro, `${prefijo}: ${salida.detalle}`)
  }
  return { resultado: salida.resultado, detalle: salida.detalle, cobroId: salida.cobroId }
}
