/**
 * Un solo bloque «Pagar» para los CDA, sin doble cobro (brief del 2026-11-03,
 * proyectos/metrik/valida/docs/2026-11-03_brief-max-pago-unico-cda.md). Puro: lo usan el bloque de la
 * pestaña Pagos (`tarjeta-cda-servidor.ts`), el cobro con la tarjeta (`cobro-token-servidor.ts`) y sus
 * pruebas.
 *
 * Un CDA paga por DOS caminos que hasta hoy no se enteraban el uno del otro: el enlace de Bold de cada
 * cuota (PSE y demás medios) y la tarjeta guardada en ePayco. La exclusión mutua:
 *
 *   - Una cuota que la tarjeta va a cobrar sola no ofrece enlace, salvo que la tarjeta ya la haya
 *     rechazado (lo mismo que hace el paso 6 del cron, Carmen §2.3).
 *   - Antes de cada cargo a la tarjeta se consulta el enlace de Bold de la cuota: con un pago
 *     `PROCESSING` o `PAID` no se cobra la tarjeta.
 *
 * ## Bold no anula enlaces
 *
 * La API de Link de pagos de Bold tiene tres operaciones: consultar los métodos de pago
 * (`GET /online/link/v1/payment_methods`), crear un enlace (`POST /online/link/v1`) y consultar uno
 * (`GET /online/link/v1/{payment_link}`). Ninguna lo cancela, lo desactiva ni le acorta la vigencia; el
 * estado `CANCELLED` es «El pago fue cancelado por el usuario o fue fallido», no una acción del comercio
 * (https://developers.bold.co/pagos-en-linea/api-link-de-pagos, leída el 2026-11-03). Por eso «retirar»
 * un enlace en ONE es dejar de mostrarlo (vencerlo en `cobros.enlace_pago_expira`) SIN borrar la URL: el
 * enlace sigue pagable en Bold hasta su propio vencimiento, la URL es la que deja al webhook encontrar
 * el cobro (`cobrosPorIdEnlace`) y la consulta de su estado antes del cargo. Si el cliente lo paga igual
 * con la cuota ya cobrada, entra como doble pago y se avisa para devolución (`aviso-doble-pago.ts`).
 */

import type { CuotaConEstado } from './pago-pendiente'
import { entraAlCobroAutomatico } from './tarjeta-cda'

// ── El estado del enlace de Bold antes de un cargo ───────────────────────────────────────

/**
 * Qué dice el enlace de Bold de una cuota antes de cobrarla con la tarjeta.
 *   - `libre`: no hay enlace de Bold, o el suyo no tiene un pago en curso ni hecho (ACTIVE, REJECTED,
 *     CANCELLED, EXPIRED). Se puede cobrar la tarjeta.
 *   - `en_curso`: Bold dice PROCESSING (el pago va) o PAID (pagado; el webhook todavía no lo registra).
 *   - `sin_consulta`: había enlace y no se pudo saber su estado. No se cobra: el lado de no cobrar dos veces.
 */
export type EstadoPagoPorEnlace =
  | { tipo: 'libre' }
  | { tipo: 'en_curso'; estado: 'PROCESSING' | 'PAID'; idEnlace: string }
  | { tipo: 'sin_consulta'; idEnlace: string; error: string }

/** Los estados de un enlace de Bold que dejan cobrar la tarjeta. Cualquier otro (o uno nuevo) no deja. */
const ESTADOS_LIBRES = new Set(['ACTIVE', 'REJECTED', 'CANCELLED', 'EXPIRED'])

export function estadoDelEnlace(idEnlace: string, consulta: { ok: true; estado: string } | { ok: false; error: string }): EstadoPagoPorEnlace {
  if (!consulta.ok) return { tipo: 'sin_consulta', idEnlace, error: consulta.error }
  const estado = consulta.estado.trim().toUpperCase()
  if (estado === 'PROCESSING' || estado === 'PAID') return { tipo: 'en_curso', estado, idEnlace }
  if (ESTADOS_LIBRES.has(estado)) return { tipo: 'libre' }
  return { tipo: 'sin_consulta', idEnlace, error: `Bold devolvió un estado que ONE no conoce: «${consulta.estado}»` }
}

/** Lo que se le dice a la persona que pidió cobrar lo pendiente con la tarjeta. */
export function textoPagoPorEnlaceEnCurso(periodo: string, e: Exclude<EstadoPagoPorEnlace, { tipo: 'libre' }>): string {
  if (e.tipo === 'sin_consulta') {
    return `No pudimos confirmar si tu pago del período ${periodo} por PSE u otro medio sigue en curso, así que no cobramos la tarjeta. Intenta de nuevo en unos minutos.`
  }
  if (e.estado === 'PAID') {
    return `Tu pago del período ${periodo} por PSE u otro medio ya quedó aprobado: no cobramos la tarjeta. En unos minutos lo verás en tus pagos.`
  }
  return `Tu pago del período ${periodo} por PSE u otro medio está en curso: no cobramos la tarjeta. Si el banco lo rechaza, puedes volver a intentarlo.`
}

/** La línea del rastro cuando se salta un cargo a la tarjeta por un pago del enlace. */
export function textoCargoSaltado(numeroCuota: number, e: Exclude<EstadoPagoPorEnlace, { tipo: 'libre' }>, manual: boolean): string {
  const quien = manual ? 'El cobro con tarjeta que pidió la persona designada' : 'El cobro con tarjeta del día'
  if (e.tipo === 'sin_consulta') {
    return `${quien} de la cuota ${numeroCuota} no se hizo: no se pudo consultar el enlace de Bold ${e.idEnlace} (${e.error}). No se cobra la tarjeta sin saber si hay un pago en curso.`
  }
  return `${quien} de la cuota ${numeroCuota} no se hizo: el enlace de Bold ${e.idEnlace} está en ${e.estado}. Se evita el doble cobro; la tarjeta no se toca mientras ese pago siga.`
}

// ── «Pagar solo este mes» (PSE u otro medio) ─────────────────────────────────────────────

export interface MesPorEnlace {
  cuotaId: string
  numero: number
  saldo: number
  /** El enlace vigente de la cuota, o `null`: se pide en el momento (`generarEnlacePagoCuota`). */
  enlace: string | null
}

/**
 * La cuota que «Pagar solo este mes» paga por el enlace: la más vieja con saldo. Con la tarjeta activa,
 * `null` si esa cuota la cobra la tarjeta sola (y no la ha rechazado) o si tiene un cargo a la tarjeta en
 * curso, pendiente o aprobado: ahí un enlace invitaría a pagar dos veces.
 *
 * `rechazadas` y `conCargo`: números de cuota con un intento de la tarjeta `rechazado`, y con uno
 * `en_curso`, `pendiente` o `aprobado` (`cobro_intentos_tarjeta`).
 */
export function mesPorEnlace(p: {
  cuotas: readonly CuotaConEstado[]
  tarjeta: { cobroDesde: string } | null
  rechazadas: ReadonlySet<number>
  conCargo: ReadonlySet<number>
}): MesPorEnlace | null {
  const c = p.cuotas.find((x) => x.estado !== 'pagada' && x.saldo > 0 && x.cuotaId)
  if (!c?.cuotaId) return null
  if (p.tarjeta) {
    if (p.conCargo.has(c.numero)) return null
    if (entraAlCobroAutomatico(c, p.tarjeta.cobroDesde) && !p.rechazadas.has(c.numero)) return null
  }
  return { cuotaId: c.cuotaId, numero: c.numero, saldo: c.saldo, enlace: c.enlacePago }
}

/**
 * Al registrar la tarjeta: las cuotas cuyo enlace vigente se retira, porque la tarjeta las va a cobrar
 * solas. Lo atrasado (D3) conserva su enlace: no se cobra solo, y el enlace es una de sus dos formas de
 * pagarlo; el suyo se retira cuando la persona pide cobrarlo con la tarjeta.
 */
export function cuotasConEnlaceARetirar(cuotas: readonly CuotaConEstado[], cobroDesde: string): number[] {
  return cuotas.filter((c) => c.estado !== 'pagada' && c.enlacePago && entraAlCobroAutomatico(c, cobroDesde)).map((c) => c.numero)
}

/** El texto del bloque para «Pagar solo este mes». */
export const TEXTO_SOLO_ESTE_MES = 'Pagar solo este mes (PSE u otro medio)'

/** Lo que se dice cuando el mes lo cobra la tarjeta y alguien pide el enlace igual. */
export const TEXTO_MES_EN_TARJETA = 'Este período se cobra a tu tarjeta en su fecha de renovación. Si el cobro no pasa, aquí aparece el pago por PSE u otro medio.'
