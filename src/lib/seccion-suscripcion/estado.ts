/**
 * Quién ve la sección Suscripción y en qué estado está. Puro: todo entra por parámetro.
 *
 * ## Quién la ve (pedido de Mauricio, 2026-09-23)
 *
 * SOLO la persona designada del contrato (`aceptante_designado_id`): la que acepta los Términos es la
 * que maneja la plata y las licencias. El dueño, los administradores, los supervisores y los
 * operadores que no sean la persona designada no la ven: la ruta no existe (404, no «sin permiso») y
 * el menú no la muestra. Un contrato sin persona designada: nadie del espacio la ve.
 *
 * La persona que se compara es la EFECTIVA: con «Ver como», un platform admin ve exactamente lo que
 * vería la persona que está mirando (si mira como la designada, la ve; como un operador, no). Esa
 * vista es de SOLO LECTURA (`puedeOperarSuscripcion`): ni acepta términos, ni compra licencias, ni
 * toca usuarios, ni pide la demostración de Sustenta a nombre del cliente.
 *
 * Es la regla ÚNICA: la usan el menú, `/suscripcion`, la franja y los avisos de `/valida`, las
 * pestañas y archivos de pagos (`puedeVerPagosCda`) y cada acción de `/suscripcion`.
 *
 * ## Los cinco estados
 *
 * | Estado                | Tono   | Cuándo                                                      |
 * |-----------------------|--------|-------------------------------------------------------------|
 * | terminos_pendientes   | ámbar  | términos sin aceptar, dentro del plazo (rojo sin plazo)     |
 * | al_dia                | verde  | sin cuota pendiente, o la pendiente vence en más de 5 días   |
 * | por_vencer            | ámbar  | la cuota pendiente vence en 5 días o menos                  |
 * | en_mora               | ámbar fuerte | cuota vencida, dentro de los 30 días de la cláusula 11.1 |
 * | pausado               | rojo   | más de 30 días de mora                                      |
 *
 * Los términos pendientes mandan sobre el pago: mientras no se acepten, la tarjeta de pago cede su
 * lugar al botón «Revisar y aceptar».
 */

import type { ProximoPago } from '@/lib/valida-cda/pago-pendiente'
import { fechaDiaMes, sumarDias, type EstadoMora } from '@/lib/valida-cda/plazos'

/**
 * ¿La persona ve la sección Suscripción (y la plata del contrato donde aparezca)? Solo si es la persona
 * designada del contrato. `usuarioId` es la persona EFECTIVA (la de «Ver como» si la hay).
 */
export function puedeVerSuscripcion(p: {
  usuarioId: string | null | undefined
  designadoId: string | null | undefined
}): boolean {
  return Boolean(p.usuarioId && p.designadoId && p.usuarioId === p.designadoId)
}

/**
 * ¿Además puede OPERARLA (comprar, retirar, invitar, aceptar, pedir Sustenta)? Solo la persona designada
 * en su propia sesión: un platform admin en «Ver como» la ve, pero en solo lectura.
 */
export function puedeOperarSuscripcion(p: {
  usuarioId: string | null | undefined
  designadoId: string | null | undefined
  impersonando: boolean
}): boolean {
  return !p.impersonando && puedeVerSuscripcion(p)
}

/** Días antes del vencimiento en que la cuota pasa a «próxima a vencer». */
export const DIAS_AVISO_VENCIMIENTO = 5

export type EstadoSuscripcion = 'terminos_pendientes' | 'al_dia' | 'por_vencer' | 'en_mora' | 'pausado' | 'desconocido'
export type Tono = 'verde' | 'ambar' | 'ambar_fuerte' | 'rojo' | 'gris'

export interface ResumenEstado {
  estado: EstadoSuscripcion
  tono: Tono
  /** El texto del chip. */
  chip: string
  mensaje: string
  /** Hay algo que hacer: la franja de /valida y el punto del menú lo usan. */
  requiereAccion: boolean
}

export type TerminosDeEntrada =
  | { estado: 'aprobada' }
  | { estado: 'pendiente'; plazoHasta: string | null; enPlazo: boolean }

const MESES_LARGOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'] as const

/** '2027-01-15' → '15-ene-2027'. */
export function fechaConAnio(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return iso
  return `${Number(m[3])}-${MESES_LARGOS[Number(m[2]) - 1]}-${m[1]}`
}

/** El periodo de una cuota dicho corto: del concepto si lo trae, si no el mes del vencimiento. */
export function periodoCorto(concepto: string | null, fechaVencimiento: string): string {
  const m = concepto ? /periodo del (\d{2})\/(\d{2})\/\d{4} al (\d{2})\/(\d{2})\/\d{4}/i.exec(concepto) : null
  if (m) return `${Number(m[1])}-${MESES_LARGOS[Number(m[2]) - 1]} al ${Number(m[3])}-${MESES_LARGOS[Number(m[4]) - 1]}`
  return fechaDiaMes(fechaVencimiento)
}

export function resumenEstado(p: {
  terminos: TerminosDeEntrada
  /** `null` = no se pudo leer el pago. */
  pago: ProximoPago | null
  mora: EstadoMora
  hoy: string
}): ResumenEstado {
  if (p.terminos.estado === 'pendiente') {
    if (p.terminos.enPlazo && p.terminos.plazoHasta) {
      return {
        estado: 'terminos_pendientes',
        tono: 'ambar',
        chip: 'Términos pendientes',
        mensaje: `Acepta los Términos a más tardar el ${fechaDiaMes(p.terminos.plazoHasta)} para seguir usando Valida sin interrupción.`,
        requiereAccion: true,
      }
    }
    return {
      estado: 'terminos_pendientes',
      tono: 'rojo',
      chip: 'Términos pendientes',
      mensaje: 'Valida está en pausa hasta que la persona designada por tu empresa acepte los Términos.',
      requiereAccion: true,
    }
  }

  if (p.mora.estado === 'suspendido') {
    return {
      estado: 'pausado',
      tono: 'rojo',
      chip: 'En pausa',
      mensaje: 'Valida está en pausa por una cuota vencida hace más de 30 días. Al pagar, el servicio se reactiva.',
      requiereAccion: true,
    }
  }

  if (p.mora.estado === 'en_mora') {
    const periodo = p.pago?.estado === 'pendiente' ? periodoCorto(p.pago.concepto, p.pago.fechaVencimiento) : fechaDiaMes(p.mora.vencio)
    return {
      estado: 'en_mora',
      tono: 'ambar_fuerte',
      chip: 'Cuota vencida',
      mensaje: `Tu cuota del ${periodo} está vencida. Paga antes del ${fechaDiaMes(p.mora.corteDesde)} para evitar la pausa del servicio.`,
      requiereAccion: true,
    }
  }

  if (p.pago === null) {
    return {
      estado: 'desconocido',
      tono: 'gris',
      chip: 'Sin datos de pago',
      mensaje: 'No se pudo cargar el estado de tu pago en este momento.',
      requiereAccion: false,
    }
  }

  if (p.pago.estado === 'pendiente') {
    const limite = sumarDias(p.hoy, DIAS_AVISO_VENCIMIENTO)
    if (p.pago.fechaVencimiento <= limite) {
      return {
        estado: 'por_vencer',
        tono: 'ambar',
        chip: 'Próxima a vencer',
        mensaje: `Tu cuota vence el ${fechaDiaMes(p.pago.fechaVencimiento)}.`,
        requiereAccion: true,
      }
    }
    return {
      estado: 'al_dia',
      tono: 'verde',
      chip: 'Al día',
      mensaje: `Estás al día. Tu próxima cuota vence el ${fechaDiaMes(p.pago.fechaVencimiento)}.`,
      requiereAccion: false,
    }
  }

  return { estado: 'al_dia', tono: 'verde', chip: 'Al día', mensaje: 'Estás al día.', requiereAccion: false }
}

/** El punto del menú: el tono del estado, sin el gris (sin datos no se pinta punto). */
export function tonoDelPunto(r: ResumenEstado): 'verde' | 'ambar' | 'rojo' | null {
  if (r.tono === 'gris') return null
  if (r.tono === 'rojo') return 'rojo'
  if (r.tono === 'verde') return 'verde'
  return 'ambar'
}

/**
 * La franja de una línea que ve en /valida quien maneja la suscripción, cuando hay algo que hacer.
 * `null` = nada que decir (al día, o un estado que ya cubren los avisos obligatorios de todos).
 */
export function franjaValida(r: ResumenEstado, pago: ProximoPago | null): string | null {
  if (r.estado === 'por_vencer' && pago?.estado === 'pendiente') {
    return `Tu cuota vence el ${fechaDiaMes(pago.fechaVencimiento)}`
  }
  if (r.estado === 'en_mora') return 'Tienes una cuota vencida'
  return null
}
