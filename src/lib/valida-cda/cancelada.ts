/**
 * La suscripción Cancelada de un CDA y su reactivación (Términos del Plan CDA v1.5, cláusulas 2.5, 9.3,
 * 11.3, 11.4 y 11.7). PR B del diseño del 4-nov-2026, con la revisión de Emilio de D2 y D3. Puro.
 *
 * ## La Cancelada se guarda, no se calcula (D1)
 *
 * El día 31 desde la fecha de renovación el cron (paso 8e, `cancelada-servidor.ts`) deja el contrato en
 * `pausado` con `cancelada_desde`. No `terminado` ni `cancelado` (D2, Emilio): la 11.3 dice que no es
 * terminación y la 11.4 reactiva la misma suscripción. `terminado` nunca es automático.
 *
 * Guardarla es lo que permite cumplir a la vez la 2.5 (los períodos desde el 1-dic que no se pagaron no
 * se cobran: se anulan sus cuotas, `cuotasParaAnular`) y la 11.4 (al reactivar, la fecha de renovación
 * es la del pago): si fuera un cálculo sobre la cuota impaga, anular la cuota abriría Valida y pagar la
 * vieja volvería a la fecha vieja.
 *
 * ## El plan vigente y la cartera (D3, Emilio)
 *
 * La reactivación crea un plan NUEVO desde el día del pago (`planDeReactivacion`): `renovar-ciclo` ancla
 * el calendario en `fecha_inicio`. Desde `reactivada_desde`, la mora, la Suspendida, la Cancelada y el
 * reparto de lo pagado solo miran el plan nuevo (`separarPorEpoca`): el pago de la reactivación nunca
 * tapa cuotas viejas. Lo de antes que siga sin pagar es cartera (`carteraDe`): SOLO períodos que empiezan
 * antes del 1-dic-2026 (11.7, «se deben y no se condonan»), sin intereses ni recargos (2.5), cobrable por
 * enlace, nunca condición para reactivar ni para consultar.
 */

import { formatCOP, formatFechaLetras } from '@/lib/cobros/format'
import { diaMes, sumarDias, sumarMeses } from '@/lib/cobros/enrolar-ciclo'
import { quitarPeriodo } from '@/lib/cobros/periodo-en-concepto'
import { PALETA } from '@/lib/marca/paleta'
import { escaparHtml } from '@/lib/usuarios-espacio/correo'
import type { CuotaConEstado } from './pago-pendiente'
import { fechaDiaMes, fechaDiaMesLargo, periodoDeCuota } from './plazos'
import { PLAN_CDA } from './redaccion-fiscal'

/** Contacto oficial de MéTRIK (cláusula 9.3 y dudas del pago). */
export const CORREO_METRIK = 'mauricio.moreno@metrik.com.co'
const WHATSAPP_METRIK = '+57 315 950 9103'

/** El motivo con que se anula la cuota de un período que no se cobra (2.5). */
export const MOTIVO_ANULACION_2_5 = 'Términos v1.5, 2.5: período que empieza desde el 1-dic-2026 y no se pagó; no se cobra.'

// ── El plan vigente y la cartera ────────────────────────────────────────────────────────

/** Lo que una cuota o un cobro trae para decidir a qué plan pertenece (de las RPC o de las tablas). */
export interface MarcaDeCuota {
  /** `plan_cobro_cuotas.anulada_at` no nulo: la cuota no se cobra (2.5). */
  anulada?: boolean
  /** `planes_cobro.fecha_inicio` del plan de la cuota. */
  planFechaInicio?: string | null
}

export interface MarcaDeCobro {
  /** `planes_cobro.fecha_inicio` del plan del cobro; `null` = cobro sin plan. */
  planFechaInicio?: string | null
  /** Es el cobro del enlace «Reactivar» (`servicios_contratados.reactivacion_cobro_id`). */
  esReactivacion?: boolean
}

export interface PorEpoca<Q, C> {
  /** El plan que manda: la mora, la pestaña Pagos y la 16.4. */
  vigente: { cuotas: Q[]; cobros: C[] }
  /** Lo de antes de la reactivación: la cartera sale de aquí. Vacío sin reactivación. */
  anterior: { cuotas: Q[]; cobros: C[] }
}

/** ¿Un plan que empieza en `inicio` es el de la reactivación (o posterior)? */
function delPlanNuevo(inicio: string | null | undefined, reactivadaDesde: string): boolean {
  return typeof inicio === 'string' && inicio.slice(0, 10) >= reactivadaDesde
}

/**
 * Separa las cuotas y los cobros del contrato entre el plan vigente y lo anterior a la reactivación.
 *
 *   - Una cuota anulada (2.5) no está en ninguno de los dos: no es deuda.
 *   - Sin reactivación (`reactivadaDesde` nulo), todo es vigente, como siempre. Salvo el pago del enlace
 *     «Reactivar» mientras no tenga plan: no es plata de ninguna cuota vieja (nunca tapa la cartera).
 *   - Con reactivación, es vigente lo del plan que empieza desde ese día; lo demás (incluidos los pagos
 *     sueltos sin plan) es anterior.
 */
export function separarPorEpoca<Q extends MarcaDeCuota, C extends MarcaDeCobro>(p: {
  cuotas: readonly Q[]
  cobros: readonly C[]
  reactivadaDesde: string | null | undefined
}): PorEpoca<Q, C> {
  const r = p.reactivadaDesde && /^\d{4}-\d{2}-\d{2}/.test(p.reactivadaDesde) ? p.reactivadaDesde.slice(0, 10) : null
  const out: PorEpoca<Q, C> = { vigente: { cuotas: [], cobros: [] }, anterior: { cuotas: [], cobros: [] } }
  for (const q of p.cuotas) {
    if (q.anulada === true) continue
    if (!r || delPlanNuevo(q.planFechaInicio, r)) out.vigente.cuotas.push(q)
    else out.anterior.cuotas.push(q)
  }
  for (const c of p.cobros) {
    if (r && delPlanNuevo(c.planFechaInicio, r)) out.vigente.cobros.push(c)
    else if (c.esReactivacion === true) continue
    else if (!r) out.vigente.cobros.push(c)
    else out.anterior.cobros.push(c)
  }
  return out
}

/** El día en que empieza el período de una cuota: el del concepto; sin él, su vencimiento. */
export function inicioDelPeriodo(c: { concepto: string | null; fechaVencimiento: string }): string {
  return periodoDeCuota(c)?.desde ?? c.fechaVencimiento
}

/**
 * Las cuotas que se anulan al quedar Cancelada (2.5, D4): de períodos que empiezan desde la vigencia de la
 * v1.5 (`transicion`, 1-dic-2026), con saldo y SIN ningún abono. Las de la transición (11.7) no se anulan:
 * se deben. Un período con un abono parcial no se anula solo: lo mira una persona (`conAbono`).
 * `cuotas` es el reparto del plan vigente (`cuotasConEstado`).
 */
export function cuotasParaAnular(cuotas: readonly CuotaConEstado[], transicion: string): { anular: CuotaConEstado[]; conAbono: CuotaConEstado[] } {
  const anular: CuotaConEstado[] = []
  const conAbono: CuotaConEstado[] = []
  for (const c of cuotas) {
    if (c.estado === 'pagada' || c.saldo <= 0) continue
    if (inicioDelPeriodo(c) < transicion) continue
    if (c.abonado > 0) conAbono.push(c)
    else if (c.cuotaId) anular.push(c)
  }
  return { anular, conAbono }
}

/** La cartera: cuotas con saldo de períodos que empiezan antes de la vigencia de la v1.5 (11.7). */
export function carteraDe(cuotas: readonly CuotaConEstado[], transicion: string): CuotaConEstado[] {
  return cuotas.filter((c) => c.estado !== 'pagada' && c.saldo > 0 && inicioDelPeriodo(c) < transicion)
}

// ── La reactivación (11.4) ──────────────────────────────────────────────────────────────

/**
 * El valor de un período (2.1 + 2.3): el precio mensual del contrato más los usuarios adicionales
 * vigentes. `null` sin precio en el contrato.
 */
export function valorDeUnPeriodo(parametros: Record<string, unknown> | null | undefined, adicionales: readonly { valorMensual: number }[]): number | null {
  const precio = Number(parametros?.precio_mensual)
  if (!Number.isFinite(precio) || precio <= 0) return null
  const extra = adicionales.reduce((s, a) => s + (Number.isFinite(a.valorMensual) && a.valorMensual > 0 ? a.valorMensual : 0), 0)
  return Math.round(precio + extra)
}

export interface PlanReactivacion {
  plan: {
    monto: number
    frecuencia: 'mensual'
    fecha_inicio: string
    fecha_fin: string
    total_cuotas: 1
    auto_renovar: true
    activo: false
    concepto_detalle_template: string
  }
  cuota: {
    numero: 1
    tipo: 'cuota'
    monto: number
    fecha_vencimiento: string
    concepto_detalle: string
  }
}

/**
 * El plan nuevo de la reactivación: empieza el día del pago aprobado (11.4 y 11.5), que pasa a ser la
 * fecha de renovación; su cuota 1 es ese período y vence el día en que empieza (D7: el vencimiento de los
 * planes nuevos es el inicio del período). Se renueva solo, como el de siempre (`renovar-ciclo`), desde
 * su propia `fecha_inicio`: la regla del 29 al 31 la resuelve `sumarMeses`.
 */
export function planDeReactivacion(p: { fechaPago: string; montoPeriodo: number; precioMensual: number; conceptoBase?: string | null }): PlanReactivacion {
  const desde = p.fechaPago.slice(0, 10)
  const hasta = sumarDias(sumarMeses(desde, 1), -1)
  const base = (p.conceptoBase && quitarPeriodo(p.conceptoBase).trim()) || PLAN_CDA
  return {
    plan: {
      monto: Math.round(p.precioMensual),
      frecuencia: 'mensual',
      fecha_inicio: desde,
      fecha_fin: hasta,
      total_cuotas: 1,
      auto_renovar: true,
      activo: false,
      concepto_detalle_template: base,
    },
    cuota: {
      numero: 1,
      tipo: 'cuota',
      monto: Math.round(p.montoPeriodo),
      fecha_vencimiento: desde,
      concepto_detalle: `${base} · periodo del ${diaMes(desde)} al ${diaMes(hasta)}`,
    },
  }
}

// ── Lo que se dice ──────────────────────────────────────────────────────────────────────
//
// ⚠️ Textos propuestos por Max el 2026-11-04, pendientes de Sofía y del visto de Vera. Sin lenguaje de
// amenaza y sin invitar a irse: dicen el estado, lo que sigue disponible y cómo volver.

/** La pantalla de `/valida` con la suscripción Cancelada (11.3), para TODOS los usuarios, sin montos. */
export function textosPantallaCancelada(p: { canceladaDesde: string; puedeReactivar: boolean }): {
  titulo: string
  estado: string
  informacion: string
  reactivar: string
  boton: string | null
} {
  return {
    titulo: 'La suscripción de Valida está Cancelada',
    estado:
      `La suscripción está Cancelada desde el ${fechaDiaMesLargo(p.canceladaDesde)} por falta de pago (cláusula 11.3 de los Términos). ` +
      'Mientras esté Cancelada no se pueden hacer consultas ni ver el historial ni los reportes en la plataforma.',
    informacion:
      'Tu información está guardada íntegra. Durante 10 años puedes pedir, sin costo, la exportación de tu bitácora y de tus ' +
      `reportes escribiendo desde un correo registrado a ${CORREO_METRIK} (cláusula 9.3).`,
    reactivar: p.puedeReactivar
      ? 'Para reactivarla, paga un período: corre desde el día del pago, que pasa a ser tu nueva fecha de renovación, y con el pago ' +
        'vuelven las consultas, el historial y los reportes (cláusula 11.4).'
      : 'La persona designada por tu empresa puede reactivarla pagando un período desde la sección Suscripción.',
    boton: p.puedeReactivar ? 'Reactivar: pagar un período' : null,
  }
}

/** Lo que responde cualquier acción de Valida con la suscripción Cancelada. */
export function mensajeCancelada(canceladaDesde: string): string {
  return (
    `La suscripción de Valida está Cancelada desde el ${fechaDiaMesLargo(canceladaDesde)} por falta de pago: no se pueden hacer ` +
    'consultas ni ver el historial ni los reportes. Se reactiva pagando un período desde la sección Suscripción.'
  )
}

/** El contrato terminado o cancelado sin otro vigente: la puerta cierra el módulo entero. */
export const TEXTO_SIN_SUSCRIPCION_VIGENTE = {
  titulo: 'La suscripción de Valida de tu empresa no está vigente',
  detalle:
    `Tu información está guardada. Para pedir la exportación de tu bitácora y de tus reportes, o si crees que es un error, escríbenos a ${CORREO_METRIK}.`,
} as const

/** El chip y el mensaje de `/suscripcion` con la suscripción Cancelada. */
export function resumenCancelada(canceladaDesde: string): { chip: string; mensaje: string } {
  return {
    chip: 'Cancelada',
    mensaje:
      `La suscripción está Cancelada desde el ${fechaDiaMes(canceladaDesde)}: no se pueden hacer consultas ni ver el historial. ` +
      'Se reactiva pagando un período, y tu nueva fecha de renovación será el día del pago.',
  }
}

/** El bloque «Reactivar» de la pestaña Pagos, para la persona designada. */
export function textosBloqueReactivar(p: { monto: number | null; hayCartera: boolean }): { titulo: string; detalle: string; cartera: string | null; boton: string } {
  return {
    titulo: 'Reactivar la suscripción',
    detalle:
      `${p.monto ? `Pagas un período de ${formatCOP(p.monto)}.` : 'Pagas un período.'} Corre desde el día del pago, que pasa a ser tu nueva ` +
      'fecha de renovación, y con el pago vuelven las consultas, el historial y los reportes (cláusula 11.4).',
    cartera: p.hayCartera
      ? 'Los períodos anteriores al 1 de diciembre de 2026 que no se pagaron aparecen abajo como saldo pendiente. Pagarlos no es condición para reactivar.'
      : null,
    boton: 'Pagar un período',
  }
}

/** La sección de cartera de la pestaña Pagos (11.7, 2.5). */
export const TEXTO_CARTERA = {
  titulo: 'Saldo pendiente de períodos anteriores',
  detalle:
    'Son períodos que empezaron antes del 1 de diciembre de 2026 y no se pagaron (cláusula 11.7). No generan intereses ni recargos, ' +
    'y pagarlos no es condición para reactivar la suscripción ni para hacer consultas.',
  sinEnlace: `Para pagarlo, escríbenos a ${CORREO_METRIK} y te enviamos el enlace de pago.`,
} as const

// ── Correo del día de la Cancelada (11.3, D6 y D8) ──────────────────────────────────────

export interface PeriodoCartera {
  periodo: string
  saldo: number
}

export interface DatosCorreoCancelada {
  razonSocial: string
  canceladaDesde: string
  /** `/suscripcion?tab=pagos` del espacio del CDA. */
  urlPagos: string
  /** Períodos de la transición sin pagar (11.7). */
  cartera: PeriodoCartera[]
  /** Hubo períodos desde el 1-dic sin pagar, anulados por la 2.5. */
  hayAnulados: boolean
}

export function asuntoCorreoCancelada(d: Pick<DatosCorreoCancelada, 'razonSocial' | 'canceladaDesde'>): string {
  return `Valida: la suscripción de ${d.razonSocial} está Cancelada desde el ${formatFechaLetras(d.canceladaDesde)}`
}

function parrafosCancelada(d: DatosCorreoCancelada): string[] {
  const p: string[] = [
    `Desde el ${formatFechaLetras(d.canceladaDesde)}, la suscripción de Valida de ${d.razonSocial} está Cancelada por falta de pago (cláusula 11.3 de los Términos).`,
    'Mientras esté Cancelada, tu equipo puede entrar a la plataforma, pero no puede hacer consultas ni ver el historial ni los reportes.',
    'Tu información está guardada íntegra. Durante 10 años puedes pedir, sin costo, la exportación de tu bitácora y de tus reportes ' +
      `escribiendo desde un correo registrado a ${CORREO_METRIK}; la entregamos dentro de los 5 días hábiles siguientes (cláusula 9.3).`,
    'Para reactivarla, la persona designada paga un período con el enlace de pago de la sección Suscripción de MéTRIK ONE: ' +
      `${d.urlPagos}. Tu nueva fecha de renovación será el día del pago y, con el pago, vuelven las consultas, el historial y los reportes (cláusula 11.4).`,
  ]
  if (d.cartera.length > 0) {
    const lista = d.cartera.map((c) => `el período ${c.periodo} (${formatCOP(c.saldo)})`)
    const enumerados = lista.length === 1 ? lista[0] : `${lista.slice(0, -1).join(', ')} y ${lista[lista.length - 1]}`
    p.push(
      `Siguen pendientes los períodos que empezaron antes del 1 de diciembre de 2026 y no se pagaron (cláusula 11.7): ${enumerados}. ` +
        'No generan intereses ni recargos, y pagarlos no es condición para reactivar la suscripción.',
    )
  }
  if (d.hayAnulados) p.push('Los períodos que empezaron desde el 1 de diciembre de 2026 y no se pagaron no se cobran (cláusula 2.5).')
  p.push(`Si tienes alguna duda, escríbenos a ${CORREO_METRIK} o al WhatsApp ${WHATSAPP_METRIK}.`)
  return p
}

export function textoCorreoCancelada(d: DatosCorreoCancelada): string {
  return ['Hola.', '', ...parrafosCancelada(d).flatMap((l) => [l, '']), 'METRIK IA S.A.S.'].join('\n')
}

function htmlCorreo(p: { titulo: string; parrafos: string[]; boton: { texto: string; url: string } | null; razonSocial: string }): string {
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><title>${escaparHtml(p.titulo)}</title></head>
<body style="margin:0;padding:0;background:${PALETA.papel};font-family:'Helvetica Neue',Arial,sans-serif;color:${PALETA.tinta};">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#FFFFFF;border-radius:8px;border:1px solid #E5E7EB;">
        <tr><td style="padding:24px 28px 4px 28px;">
          <div style="font-size:20px;font-weight:700;color:${PALETA.tinta};">MéTRIK</div>
          <div style="height:2px;width:42px;background:${PALETA.acento};margin-top:4px;"></div>
        </td></tr>
        <tr><td style="padding:12px 28px 0 28px;font-size:14px;line-height:1.6;">
          <p style="margin:0 0 10px 0;">Hola.</p>
          ${p.parrafos.map((l) => `<p style="margin:0 0 12px 0;">${escaparHtml(l)}</p>`).join('\n          ')}
          ${
            p.boton
              ? `<p style="margin:18px 0 0 0;"><a href="${escaparHtml(p.boton.url)}" style="display:inline-block;padding:11px 22px;background:${PALETA.acento};color:#FFFFFF;text-decoration:none;border-radius:6px;font-weight:600;font-size:14px;">${escaparHtml(p.boton.texto)}</a></p>`
              : ''
          }
        </td></tr>
        <tr><td style="padding:18px 28px 22px 28px;font-size:11px;color:${PALETA.tintaSuave};">
          METRIK IA S.A.S. · Recibes este correo porque es un correo registrado de la suscripción de ${escaparHtml(p.razonSocial)}.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

export function htmlCorreoCancelada(d: DatosCorreoCancelada): string {
  return htmlCorreo({
    titulo: 'Suscripción Cancelada',
    parrafos: parrafosCancelada(d),
    boton: { texto: 'Ir a Suscripción', url: d.urlPagos },
    razonSocial: d.razonSocial,
  })
}

// ── Correo del borrado de la tarjeta (11.3) ─────────────────────────────────────────────

export interface DatosCorreoTarjeta {
  razonSocial: string
  canceladaDesde: string
  ultimos4: string | null
}

export function asuntoCorreoTarjetaCancelada(d: DatosCorreoTarjeta): string {
  return d.ultimos4
    ? `Valida: pedimos eliminar la tarjeta terminada en ${d.ultimos4} de la suscripción de ${d.razonSocial}`
    : `Valida: pedimos eliminar la tarjeta registrada de la suscripción de ${d.razonSocial}`
}

function parrafosTarjeta(d: DatosCorreoTarjeta): string[] {
  const tarjeta = d.ultimos4 ? `la tarjeta terminada en ${d.ultimos4}` : 'la tarjeta'
  return [
    `Como la suscripción de Valida de ${d.razonSocial} quedó Cancelada el ${formatFechaLetras(d.canceladaDesde)}, le pedimos a la pasarela de pagos ` +
      `(ePayco) eliminar ${tarjeta} que estaba registrada para el pago automático (cláusula 11.3 de los Términos). Desde ese día no se hace ` +
      'ningún cobro automático a esa tarjeta.',
    'Si reactivas la suscripción y quieres volver al pago automático, puedes registrar una tarjeta de nuevo en la sección Suscripción de MéTRIK ONE.',
    `Si tienes alguna duda, escríbenos a ${CORREO_METRIK} o al WhatsApp ${WHATSAPP_METRIK}.`,
  ]
}

export function textoCorreoTarjetaCancelada(d: DatosCorreoTarjeta): string {
  return ['Hola.', '', ...parrafosTarjeta(d).flatMap((l) => [l, '']), 'METRIK IA S.A.S.'].join('\n')
}

export function htmlCorreoTarjetaCancelada(d: DatosCorreoTarjeta): string {
  return htmlCorreo({ titulo: 'Tarjeta eliminada', parrafos: parrafosTarjeta(d), boton: null, razonSocial: d.razonSocial })
}
